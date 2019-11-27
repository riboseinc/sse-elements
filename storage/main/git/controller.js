import * as dns from 'dns';
import * as path from 'path';
import * as fs from 'fs-extra';
import AsyncLock from 'async-lock';
import * as git from 'isomorphic-git';
import * as log from 'electron-log';
import { ipcMain } from 'electron';
import { listen } from '../../../api/main';
import { Setting } from '../../../settings/main';
import { notifyAllWindows, openWindow } from '../../../main/window';
const UPSTREAM_REMOTE = 'upstream';
const MAIN_REMOTE = 'origin';
export class GitController {
    constructor(fs, repoUrl, upstreamRepoUrl, workDir, corsProxy) {
        this.fs = fs;
        this.repoUrl = repoUrl;
        this.upstreamRepoUrl = upstreamRepoUrl;
        this.workDir = workDir;
        this.corsProxy = corsProxy;
        this.auth = {};
        git.plugins.set('fs', fs);
        this.stagingLock = new AsyncLock({ timeout: 20000, maxPending: 10 });
        // Makes it easier to bind these to IPC events
        this.synchronize = this.synchronize.bind(this);
        this.resetFiles = this.resetFiles.bind(this);
        this.checkUncommitted = this.checkUncommitted.bind(this);
    }
    async isInitialized() {
        let hasGitDirectory;
        try {
            hasGitDirectory = (await this.fs.stat(path.join(this.workDir, '.git'))).isDirectory();
        }
        catch (e) {
            hasGitDirectory = false;
        }
        return hasGitDirectory;
    }
    async isUsingRemoteURLs(remoteUrls) {
        const origin = (await this.getOriginUrl() || '').trim();
        const upstream = (await this.getUpstreamUrl() || '').trim();
        return origin === remoteUrls.origin && upstream === remoteUrls.upstream;
    }
    needsPassword() {
        return (this.auth.password || '').trim() === '';
    }
    async forceInitialize() {
        /* Initializes from scratch: wipes work directory, clones again, adds remotes. */
        log.warn("SSE: GitController: Force initializing");
        log.warn("SSE: GitController: Initialize: Removing data directory");
        await this.fs.remove(this.workDir);
        log.silly("SSE: GitController: Initialize: Ensuring data directory exists");
        await this.fs.ensureDir(this.workDir);
        log.verbose("SSE: GitController: Initialize: Cloning", this.repoUrl);
        await git.clone(Object.assign({ dir: this.workDir, url: this.repoUrl, ref: 'master', singleBranch: true, depth: 5, corsProxy: this.corsProxy }, this.auth));
        await git.addRemote({
            dir: this.workDir,
            remote: UPSTREAM_REMOTE,
            url: this.upstreamRepoUrl,
        });
    }
    async configSet(prop, val) {
        log.verbose("SSE: GitController: Set config");
        await git.config({ dir: this.workDir, path: prop, value: val });
    }
    async configGet(prop) {
        log.verbose("SSE: GitController: Get config", prop);
        return await git.config({ dir: this.workDir, path: prop });
    }
    setPassword(value) {
        this.auth.password = value;
    }
    async loadAuth() {
        /* Configure auth with git-config username, if set.
           Supposed to be happening automatically? Maybe not.
           This method must be manually called before making operations that need auth. */
        const username = await this.configGet('credentials.username');
        if (username) {
            this.auth.username = username;
        }
    }
    async pull() {
        log.verbose("SSE: GitController: Pulling master with fast-forward merge");
        return await git.pull(Object.assign({ dir: this.workDir, singleBranch: true, fastForwardOnly: true, fast: true }, this.auth));
    }
    async stage(pathSpecs) {
        log.verbose(`SSE: GitController: Adding changes: ${pathSpecs.join(', ')}`);
        for (const pathSpec of pathSpecs) {
            await git.add({
                dir: this.workDir,
                filepath: pathSpec,
            });
        }
    }
    async commit(msg) {
        log.verbose(`SSE: GitController: Committing with message ${msg}`);
        return await git.commit({
            dir: this.workDir,
            message: msg,
            author: {},
        });
    }
    async fetchRemote() {
        await git.fetch(Object.assign({ dir: this.workDir, remote: MAIN_REMOTE }, this.auth));
    }
    async fetchUpstream() {
        await git.fetch(Object.assign({ dir: this.workDir, remote: UPSTREAM_REMOTE }, this.auth));
    }
    async push(force = false) {
        log.verbose("SSE: GitController: Pushing");
        return await git.push(Object.assign({ dir: this.workDir, remote: MAIN_REMOTE, force: force }, this.auth));
    }
    async resetFiles(paths) {
        return await this.stagingLock.acquire('1', async () => {
            log.verbose("SSE: GitController: Force resetting files");
            return await git.fastCheckout({
                dir: this.workDir,
                force: true,
                filepaths: paths || (await this.listChangedFiles()),
            });
        });
    }
    async getOriginUrl() {
        return ((await git.listRemotes({
            dir: this.workDir,
        })).find(r => r.remote === MAIN_REMOTE) || { url: null }).url;
    }
    async getUpstreamUrl() {
        return ((await git.listRemotes({
            dir: this.workDir,
        })).find(r => r.remote === UPSTREAM_REMOTE) || { url: null }).url;
    }
    async listLocalCommits() {
        /* Returns a list of commit messages for commits that were not pushed yet.
    
           Useful to check which commits will be thrown out
           if we force update to remote master.
    
           Does so by walking through last 100 commits starting from current HEAD.
           When it encounters the first local commit that doesn’t descends from remote master HEAD,
           it considers all preceding commits to be ahead/local and returns them.
    
           If it finishes the walk without finding an ancestor, throws an error.
           It is assumed that the app does not allow to accumulate
           more than 100 commits without pushing (even 100 is too many!),
           so there’s probably something strange going on.
    
           Other assumptions:
    
           * git.log returns commits from newest to oldest.
           * The remote was already fetched.
    
        */
        return await this.stagingLock.acquire('1', async () => {
            const latestRemoteCommit = await git.resolveRef({
                dir: this.workDir,
                ref: `${MAIN_REMOTE}/master`,
            });
            const localCommits = await git.log({
                dir: this.workDir,
                depth: 100,
            });
            var commits = [];
            for (const commit of localCommits) {
                if (await git.isDescendent({ dir: this.workDir, oid: commit.oid, ancestor: latestRemoteCommit })) {
                    commits.push(commit.message);
                }
                else {
                    return commits;
                }
            }
            throw new Error("Did not find a local commit that is an ancestor of remote master");
        });
    }
    async listChangedFiles(pathSpecs = ['.']) {
        /* Lists relative paths to all files that were changed and have not been committed. */
        const FILE = 0, HEAD = 1, WORKDIR = 2;
        return (await git.statusMatrix({ dir: this.workDir, filepaths: pathSpecs }))
            .filter(row => row[HEAD] !== row[WORKDIR])
            .map(row => row[FILE])
            .filter(filepath => !filepath.startsWith('..'));
    }
    async stageAndCommit(pathSpecs, msg) {
        /* Stages and commits files matching given path spec with given message.
    
           Any other files staged at the time of the call will be unstaged.
    
           Returns the number of matching files with unstaged changes prior to staging.
           If no matching files were found having unstaged changes,
           skips the rest and returns zero.
    
           If failIfDiverged is given, attempts a fast-forward pull after the commit.
           It will fail immediately if main remote had other commits appear in meantime.
    
           Locks so that this method cannot be run concurrently (by same instance).
        */
        if (pathSpecs.length < 1) {
            throw new Error("Wasn’t given any paths to commit!");
        }
        return await this.stagingLock.acquire('1', async () => {
            log.verbose(`SSE: GitController: Staging and committing: ${pathSpecs.join(', ')}`);
            const filesChanged = (await this.listChangedFiles(pathSpecs)).length;
            if (filesChanged < 1) {
                return 0;
            }
            await this.unstageAll();
            await this.stage(pathSpecs);
            await this.commit(msg);
            return filesChanged;
        });
    }
    async unstageAll() {
        log.verbose("SSE: GitController: Unstaging all changes");
        await git.remove({ dir: this.workDir, filepath: '.' });
    }
    async _handleGitError(e) {
        if (e.code === 'FastForwardFail') {
            // NOTE: There’s also PushRejectedNonFastForward, but it seems to be thrown
            // for unrelated cases during push (false positive).
            // Because of that false positive, we ignore that error and instead do pull first,
            // catching actual fast-forward fails on that step before push.
            await sendRemoteStatus({ statusRelativeToLocal: 'diverged' });
        }
        else if (['MissingUsernameError', 'MissingAuthorError', 'MissingCommitterError'].indexOf(e.code) >= 0) {
            await sendRemoteStatus({ isMisconfigured: true });
        }
        else if (e.code === 'MissingPasswordTokenError' || (e.code === 'HTTPError' && e.message.indexOf('Unauthorized') >= 0)) {
            this.setPassword(undefined);
            await sendRemoteStatus({ needsPassword: true });
        }
    }
    async checkUncommitted() {
        /* Checks for any uncommitted changes locally present.
           Notifies all windows about the status. */
        log.debug("SSE: Git: Checking for uncommitted changes");
        const hasUncommittedChanges = (await this.listChangedFiles()).length > 0;
        await sendRemoteStatus({ hasLocalChanges: hasUncommittedChanges });
        return hasUncommittedChanges;
    }
    async synchronize() {
        /* Checks for connection, local changes and unpushed commits,
           tries to push and pull when there’s opportunity.
    
           Notifies all windows about the status in process. */
        log.verbose("SSE: Git: Queueing sync");
        return await this.stagingLock.acquire('1', async () => {
            log.verbose("SSE: Git: Starting sync");
            const hasUncommittedChanges = await this.checkUncommitted();
            if (!hasUncommittedChanges) {
                const isOffline = (await checkOnlineStatus()) === false;
                await sendRemoteStatus({ isOffline });
                if (!isOffline) {
                    const needsPassword = this.needsPassword();
                    await sendRemoteStatus({ needsPassword });
                    if (needsPassword) {
                        return;
                    }
                    await sendRemoteStatus({ isPulling: true });
                    try {
                        await this.pull();
                    }
                    catch (e) {
                        log.error(e);
                        await sendRemoteStatus({ isPulling: false });
                        await this._handleGitError(e);
                        return;
                    }
                    await sendRemoteStatus({ isPulling: false });
                    await sendRemoteStatus({ isPushing: true });
                    try {
                        await this.push();
                    }
                    catch (e) {
                        log.error(e);
                        await sendRemoteStatus({ isPushing: false });
                        await this._handleGitError(e);
                        return;
                    }
                    await sendRemoteStatus({ isPushing: false });
                    await sendRemoteStatus({
                        statusRelativeToLocal: 'updated',
                        isMisconfigured: false,
                        needsPassword: false,
                    });
                }
            }
        });
    }
    /* IPC endpoint setup */
    setUpAPIEndpoints() {
        log.verbose("SSE: GitController: Setting up API endpoints");
        listen('git-config-set', async ({ name, email, username }) => {
            log.verbose("SSE: GitController: received git-config-set request");
            await this.configSet('user.name', name);
            await this.configSet('user.email', email);
            await this.configSet('credentials.username', username);
            this.auth.username = username;
            this.synchronize();
            return { success: true };
        });
        listen('git-set-password', async ({ password }) => {
            // WARNING: Don’t log password
            log.verbose("SSE: GitController: received git-set-password request");
            this.setPassword(password);
            this.synchronize();
            return { success: true };
        });
        listen('git-config-get', async () => {
            log.verbose("SSE: GitController: received git-config request");
            return {
                originURL: await this.getOriginUrl(),
                name: await this.configGet('user.name'),
                email: await this.configGet('user.email'),
                username: await this.configGet('credentials.username'),
            };
        });
    }
}
export async function initRepo(workDir, upstreamRepoUrl, corsProxyUrl, force, settings, configWindow) {
    settings.configurePane({
        id: 'dataSync',
        label: "Data synchronization",
        icon: 'git-merge',
    });
    settings.register(new Setting('gitRepoUrl', "Git repository URL", 'dataSync'));
    const repoUrl = await settings.getValue('gitRepoUrl') || (await requestRepoUrl(configWindow));
    const gitCtrl = new GitController(fs, repoUrl, upstreamRepoUrl, workDir, corsProxyUrl);
    let doInitialize;
    if (force === true) {
        log.warn("SSE: Git is being force reinitialized");
        doInitialize = true;
    }
    else if (!(await gitCtrl.isInitialized())) {
        log.warn("SSE: Git is not initialized yet");
        doInitialize = true;
    }
    else if (!(await gitCtrl.isUsingRemoteURLs({ origin: repoUrl, upstream: upstreamRepoUrl }))) {
        log.warn("SSE: Git has mismatching remote URLs, reinitializing");
        doInitialize = true;
    }
    else {
        log.info("SSE: Git is already initialized");
        doInitialize = false;
    }
    if (doInitialize) {
        await gitCtrl.forceInitialize();
    }
    await gitCtrl.loadAuth();
    return gitCtrl;
}
/* Promises to return an object containing string with repository URL
   and a flag indicating whether it’s been reset
   (which if true would cause `initRepo()` to reinitialize the repository).

   If repository URL is not configured (e.g., on first run, or after reset)
   opens a window with specified options to ask the user to provide the setting.
   The window is expected to ask the user to specify the URL and send a `'set-setting'`
   event for `'gitRepoUrl'`. */
export async function requestRepoUrl(configWindow) {
    return new Promise(async (resolve, reject) => {
        log.warn("SSE: GitController: Open config window to configure repo URL");
        ipcMain.on('set-setting', handleSetting);
        function handleSetting(evt, name, value) {
            if (name === 'gitRepoUrl') {
                log.info("SSE: GitController: received gitRepoUrl setting");
                ipcMain.removeListener('set-setting', handleSetting);
                resolve(value);
            }
        }
        await openWindow(configWindow);
    });
}
async function checkOnlineStatus() {
    let isOffline;
    try {
        await dns.promises.lookup('github.com');
        isOffline = false;
    }
    catch (e) {
        isOffline = true;
    }
    return !isOffline;
}
async function sendRemoteStatus(update) {
    await notifyAllWindows('remote-storage-status', update);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zdG9yYWdlL21haW4vZ2l0L2NvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxLQUFLLEdBQUcsTUFBTSxLQUFLLENBQUM7QUFDM0IsT0FBTyxLQUFLLElBQUksTUFBTSxNQUFNLENBQUM7QUFDN0IsT0FBTyxLQUFLLEVBQUUsTUFBTSxVQUFVLENBQUM7QUFDL0IsT0FBTyxTQUFTLE1BQU0sWUFBWSxDQUFDO0FBQ25DLE9BQU8sS0FBSyxHQUFHLE1BQU0sZ0JBQWdCLENBQUM7QUFDdEMsT0FBTyxLQUFLLEdBQUcsTUFBTSxjQUFjLENBQUM7QUFFcEMsT0FBTyxFQUFFLE9BQU8sRUFBRSxNQUFNLFVBQVUsQ0FBQztBQUVuQyxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFDM0MsT0FBTyxFQUFFLE9BQU8sRUFBa0IsTUFBTSx3QkFBd0IsQ0FBQztBQUNqRSxPQUFPLEVBQUUsZ0JBQWdCLEVBQXNCLFVBQVUsRUFBRSxNQUFNLHNCQUFzQixDQUFDO0FBT3hGLE1BQU0sZUFBZSxHQUFHLFVBQVUsQ0FBQztBQUNuQyxNQUFNLFdBQVcsR0FBRyxRQUFRLENBQUM7QUFHN0IsTUFBTSxPQUFPLGFBQWE7SUFNeEIsWUFDWSxFQUFPLEVBQ1AsT0FBZSxFQUNmLGVBQXVCLEVBQ3hCLE9BQWUsRUFDZCxTQUFpQjtRQUpqQixPQUFFLEdBQUYsRUFBRSxDQUFLO1FBQ1AsWUFBTyxHQUFQLE9BQU8sQ0FBUTtRQUNmLG9CQUFlLEdBQWYsZUFBZSxDQUFRO1FBQ3hCLFlBQU8sR0FBUCxPQUFPLENBQVE7UUFDZCxjQUFTLEdBQVQsU0FBUyxDQUFRO1FBVHJCLFNBQUksR0FBc0IsRUFBRSxDQUFDO1FBV25DLEdBQUcsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQztRQUUxQixJQUFJ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TUFBTSxDQUFDLENBQUM7QUFDMUQsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGRucyBmcm9tICdkbnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzLWV4dHJhJztcbmltcG9ydCBBc3luY0xvY2sgZnJvbSAnYXN5bmMtbG9jayc7XG5pbXBvcnQgKiBhcyBnaXQgZnJvbSAnaXNvbW9ycGhpYy1naXQnO1xuaW1wb3J0ICogYXMgbG9nIGZyb20gJ2VsZWN0cm9uLWxvZyc7XG5cbmltcG9ydCB7IGlwY01haW4gfSBmcm9tICdlbGVjdHJvbic7XG5cbmltcG9ydCB7IGxpc3RlbiB9IGZyb20gJy4uLy4uLy4uL2FwaS9tYWluJztcbmltcG9ydCB7IFNldHRpbmcsIFNldHRpbmdNYW5hZ2VyIH0gZnJvbSAnLi4vLi4vLi4vc2V0dGluZ3MvbWFpbic7XG5pbXBvcnQgeyBub3RpZnlBbGxXaW5kb3dzLCBXaW5kb3dPcGVuZXJQYXJhbXMsIG9wZW5XaW5kb3cgfSBmcm9tICcuLi8uLi8uLi9tYWluL3dpbmRvdyc7XG5cbmltcG9ydCB7IFJlbW90ZVN0b3JhZ2VTdGF0dXMgfSBmcm9tICcuLi9yZW1vdGUnO1xuXG5pbXBvcnQgeyBHaXRBdXRoZW50aWNhdGlvbiB9IGZyb20gJy4vdHlwZXMnO1xuXG5cbmNvbnN0IFVQU1RSRUFNX1JFTU9URSA9ICd1cHN0cmVhbSc7XG5jb25zdCBNQUlOX1JFTU9URSA9ICdvcmlnaW4nO1xuXG5cbmV4cG9ydCBjbGFzcyBHaXRDb250cm9sbGVyIHtcblxuICBwcml2YXRlIGF1dGg6IEdpdEF1dGhlbnRpY2F0aW9uID0ge307XG5cbiAgcHJpdmF0ZSBzdGFnaW5nTG9jazogQXN5bmNMb2NrO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgICAgcHJpdmF0ZSBmczogYW55LFxuICAgICAgcHJpdmF0ZSByZXBvVXJsOiBzdHJpbmcsXG4gICAgICBwcml2YXRlIHVwc3RyZWFtUmVwb1VybDogc3RyaW5nLFxuICAgICAgcHVibGljIHdvcmtEaXI6IHN0cmluZyxcbiAgICAgIHByaXZhdGUgY29yc1Byb3h5OiBzdHJpbmcpIHtcblxuICAgIGdpdC5wbHVnaW5zLnNldCgnZnMnLCBmcyk7XG5cbiAgICB0aGlzLnN0YWdpbmdMb2NrID0gbmV3IEFzeW5jTG9jayh7IHRpbWVvdXQ6IDIwMDAwLCBtYXhQZW5kaW5nOiAxMCB9KTtcblxuICAgIC8vIE1ha2VzIGl0IGVhc2llciB0byBiaW5kIHRoZXNlIHRvIElQQyBldmVudHNcbiAgICB0aGlzLnN5bmNocm9uaXplID0gdGhpcy5zeW5jaHJvbml6ZS5iaW5kKHRoaXMpO1xuICAgIHRoaXMucmVzZXRGaWxlcyA9IHRoaXMucmVzZXRGaWxlcy5iaW5kKHRoaXMpO1xuICAgIHRoaXMuY2hlY2tVbmNvbW1pdHRlZCA9IHRoaXMuY2hlY2tVbmNvbW1pdHRlZC5iaW5kKHRoaXMpO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGlzSW5pdGlhbGl6ZWQoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgbGV0IGhhc0dpdERpcmVjdG9yeTogYm9vbGVhbjtcbiAgICB0cnkge1xuICAgICAgaGFzR2l0RGlyZWN0b3J5ID0gKGF3YWl0IHRoaXMuZnMuc3RhdChwYXRoLmpvaW4odGhpcy53b3JrRGlyLCAnLmdpdCcpKSkuaXNEaXJlY3RvcnkoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBoYXNHaXREaXJlY3RvcnkgPSBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIGhhc0dpdERpcmVjdG9yeTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBpc1VzaW5nUmVtb3RlVVJMcyhyZW1vdGVVcmxzOiB7IG9yaWdpbjogc3RyaW5nLCB1cHN0cmVhbTogc3RyaW5nIH0pOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCBvcmlnaW4gPSAoYXdhaXQgdGhpcy5nZXRPcmlnaW5VcmwoKSB8fCAnJykudHJpbSgpO1xuICAgIGNvbnN0IHVwc3RyZWFtID0gKGF3YWl0IHRoaXMuZ2V0VXBzdHJlYW1VcmwoKSB8fCAnJykudHJpbSgpO1xuICAgIHJldHVybiBvcmlnaW4gPT09IHJlbW90ZVVybHMub3JpZ2luICYmIHVwc3RyZWFtID09PSByZW1vdGVVcmxzLnVwc3RyZWFtO1xuICB9XG5cbiAgcHVibGljIG5lZWRzUGFzc3dvcmQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuICh0aGlzLmF1dGgucGFzc3dvcmQgfHwgJycpLnRyaW0oKSA9PT0gJyc7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgZm9yY2VJbml0aWFsaXplKCkge1xuICAgIC8qIEluaXRpYWxpemVzIGZyb20gc2NyYXRjaDogd2lwZXMgd29yayBkaXJlY3RvcnksIGNsb25lcyBhZ2FpbiwgYWRkcyByZW1vdGVzLiAqL1xuXG4gICAgbG9nLndhcm4oXCJTU0U6IEdpdENvbnRyb2xsZXI6IEZvcmNlIGluaXRpYWxpemluZ1wiKTtcbiAgICBsb2cud2FybihcIlNTRTogR2l0Q29udHJvbGxlcjogSW5pdGlhbGl6ZTogUmVtb3ZpbmcgZGF0YSBkaXJlY3RvcnlcIik7XG5cbiAgICBhd2FpdCB0aGlzLmZzLnJlbW92ZSh0aGlzLndvcmtEaXIpO1xuXG4gICAgbG9nLnNpbGx5KFwiU1NFOiBHaXRDb250cm9sbGVyOiBJbml0aWFsaXplOiBFbnN1cmluZyBkYXRhIGRpcmVjdG9yeSBleGlzdHNcIik7XG5cbiAgICBhd2FpdCB0aGlzLmZzLmVuc3VyZURpcih0aGlzLndvcmtEaXIpO1xuXG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IEluaXRpYWxpemU6IENsb25pbmdcIiwgdGhpcy5yZXBvVXJsKTtcblxuICAgIGF3YWl0IGdpdC5jbG9uZSh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIHVybDogdGhpcy5yZXBvVXJsLFxuICAgICAgcmVmOiAnbWFzdGVyJyxcbiAgICAgIHNpbmdsZUJyYW5jaDogdHJ1ZSxcbiAgICAgIGRlcHRoOiA1LFxuICAgICAgY29yc1Byb3h5OiB0aGlzLmNvcnNQcm94eSxcbiAgICAgIC4uLnRoaXMuYXV0aCxcbiAgICB9KTtcblxuICAgIGF3YWl0IGdpdC5hZGRSZW1vdGUoe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICByZW1vdGU6IFVQU1RSRUFNX1JFTU9URSxcbiAgICAgIHVybDogdGhpcy51cHN0cmVhbVJlcG9VcmwsXG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgY29uZmlnU2V0KHByb3A6IHN0cmluZywgdmFsOiBzdHJpbmcpIHtcbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogU2V0IGNvbmZpZ1wiKTtcbiAgICBhd2FpdCBnaXQuY29uZmlnKHsgZGlyOiB0aGlzLndvcmtEaXIsIHBhdGg6IHByb3AsIHZhbHVlOiB2YWwgfSk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgY29uZmlnR2V0KHByb3A6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IEdldCBjb25maWdcIiwgcHJvcCk7XG4gICAgcmV0dXJuIGF3YWl0IGdpdC5jb25maWcoeyBkaXI6IHRoaXMud29ya0RpciwgcGF0aDogcHJvcCB9KTtcbiAgfVxuXG4gIHB1YmxpYyBzZXRQYXNzd29yZCh2YWx1ZTogc3RyaW5nIHwgdW5kZWZpbmVkKSB7XG4gICAgdGhpcy5hdXRoLnBhc3N3b3JkID0gdmFsdWU7XG4gIH1cblxuICBhc3luYyBsb2FkQXV0aCgpIHtcbiAgICAvKiBDb25maWd1cmUgYXV0aCB3aXRoIGdpdC1jb25maWcgdXNlcm5hbWUsIGlmIHNldC5cbiAgICAgICBTdXBwb3NlZCB0byBiZSBoYXBwZW5pbmcgYXV0b21hdGljYWxseT8gTWF5YmUgbm90LlxuICAgICAgIFRoaXMgbWV0aG9kIG11c3QgYmUgbWFudWFsbHkgY2FsbGVkIGJlZm9yZSBtYWtpbmcgb3BlcmF0aW9ucyB0aGF0IG5lZWQgYXV0aC4gKi9cbiAgICBjb25zdCB1c2VybmFtZSA9IGF3YWl0IHRoaXMuY29uZmlnR2V0KCdjcmVkZW50aWFscy51c2VybmFtZScpO1xuICAgIGlmICh1c2VybmFtZSkge1xuICAgICAgdGhpcy5hdXRoLnVzZXJuYW1lID0gdXNlcm5hbWU7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcHVsbCgpIHtcbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogUHVsbGluZyBtYXN0ZXIgd2l0aCBmYXN0LWZvcndhcmQgbWVyZ2VcIik7XG5cbiAgICByZXR1cm4gYXdhaXQgZ2l0LnB1bGwoe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICBzaW5nbGVCcmFuY2g6IHRydWUsXG4gICAgICBmYXN0Rm9yd2FyZE9ubHk6IHRydWUsXG4gICAgICBmYXN0OiB0cnVlLFxuICAgICAgLi4udGhpcy5hdXRoLFxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgc3RhZ2UocGF0aFNwZWNzOiBzdHJpbmdbXSkge1xuICAgIGxvZy52ZXJib3NlKGBTU0U6IEdpdENvbnRyb2xsZXI6IEFkZGluZyBjaGFuZ2VzOiAke3BhdGhTcGVjcy5qb2luKCcsICcpfWApO1xuXG4gICAgZm9yIChjb25zdCBwYXRoU3BlYyBvZiBwYXRoU3BlY3MpIHtcbiAgICAgIGF3YWl0IGdpdC5hZGQoe1xuICAgICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgICAgZmlsZXBhdGg6IHBhdGhTcGVjLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgY29tbWl0KG1zZzogc3RyaW5nKSB7XG4gICAgbG9nLnZlcmJvc2UoYFNTRTogR2l0Q29udHJvbGxlcjogQ29tbWl0dGluZyB3aXRoIG1lc3NhZ2UgJHttc2d9YCk7XG5cbiAgICByZXR1cm4gYXdhaXQgZ2l0LmNvbW1pdCh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIG1lc3NhZ2U6IG1zZyxcbiAgICAgIGF1dGhvcjoge30sICAvLyBnaXQtY29uZmlnIHZhbHVlcyB3aWxsIGJlIHVzZWRcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGZldGNoUmVtb3RlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IGdpdC5mZXRjaCh7IGRpcjogdGhpcy53b3JrRGlyLCByZW1vdGU6IE1BSU5fUkVNT1RFLCAuLi50aGlzLmF1dGggfSk7XG4gIH1cblxuICBhc3luYyBmZXRjaFVwc3RyZWFtKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IGdpdC5mZXRjaCh7IGRpcjogdGhpcy53b3JrRGlyLCByZW1vdGU6IFVQU1RSRUFNX1JFTU9URSwgLi4udGhpcy5hdXRoIH0pO1xuICB9XG5cbiAgYXN5bmMgcHVzaChmb3JjZSA9IGZhbHNlKSB7XG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IFB1c2hpbmdcIik7XG5cbiAgICByZXR1cm4gYXdhaXQgZ2l0LnB1c2goe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICByZW1vdGU6IE1BSU5fUkVNT1RFLFxuICAgICAgZm9yY2U6IGZvcmNlLFxuICAgICAgLi4udGhpcy5hdXRoLFxuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHJlc2V0RmlsZXMocGF0aHM/OiBzdHJpbmdbXSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnN0YWdpbmdMb2NrLmFjcXVpcmUoJzEnLCBhc3luYyAoKSA9PiB7XG4gICAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogRm9yY2UgcmVzZXR0aW5nIGZpbGVzXCIpO1xuXG4gICAgICByZXR1cm4gYXdhaXQgZ2l0LmZhc3RDaGVja291dCh7XG4gICAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgICBmb3JjZTogdHJ1ZSxcbiAgICAgICAgZmlsZXBhdGhzOiBwYXRocyB8fCAoYXdhaXQgdGhpcy5saXN0Q2hhbmdlZEZpbGVzKCkpLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBnZXRPcmlnaW5VcmwoKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gICAgcmV0dXJuICgoYXdhaXQgZ2l0Lmxpc3RSZW1vdGVzKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgIH0pKS5maW5kKHIgPT4gci5yZW1vdGUgPT09IE1BSU5fUkVNT1RFKSB8fCB7IHVybDogbnVsbCB9KS51cmw7XG4gIH1cblxuICBhc3luYyBnZXRVcHN0cmVhbVVybCgpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICByZXR1cm4gKChhd2FpdCBnaXQubGlzdFJlbW90ZXMoe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgfSkpLmZpbmQociA9PiByLnJlbW90ZSA9PT0gVVBTVFJFQU1fUkVNT1RFKSB8fCB7IHVybDogbnVsbCB9KS51cmw7XG4gIH1cblxuICBhc3luYyBsaXN0TG9jYWxDb21taXRzKCk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICAvKiBSZXR1cm5zIGEgbGlzdCBvZiBjb21taXQgbWVzc2FnZXMgZm9yIGNvbW1pdHMgdGhhdCB3ZXJlIG5vdCBwdXNoZWQgeWV0LlxuXG4gICAgICAgVXNlZnVsIHRvIGNoZWNrIHdoaWNoIGNvbW1pdHMgd2lsbCBiZSB0aHJvd24gb3V0XG4gICAgICAgaWYgd2UgZm9yY2UgdXBkYXRlIHRvIHJlbW90ZSBtYXN0ZXIuXG5cbiAgICAgICBEb2VzIHNvIGJ5IHdhbGtpbmcgdGhyb3VnaCBsYXN0IDEwMCBjb21taXRzIHN0YXJ0aW5nIGZyb20gY3VycmVudCBIRUFELlxuICAgICAgIFdoZW4gaXQgZW5jb3VudGVycyB0aGUgZmlyc3QgbG9jYWwgY29tbWl0IHRoYXQgZG9lc27igJl0IGRlc2NlbmRzIGZyb20gcmVtb3RlIG1hc3RlciBIRUFELFxuICAgICAgIGl0IGNvbnNpZGVycyBhbGwgcHJlY2VkaW5nIGNvbW1pdHMgdG8gYmUgYWhlYWQvbG9jYWwgYW5kIHJldHVybnMgdGhlbS5cblxuICAgICAgIElmIGl0IGZpbmlzaGVzIHRoZSB3YWxrIHdpdGhvdXQgZmluZGluZyBhbiBhbmNlc3RvciwgdGhyb3dzIGFuIGVycm9yLlxuICAgICAgIEl0IGlzIGFzc3VtZWQgdGhhdCB0aGUgYXBwIGRvZXMgbm90IGFsbG93IHRvIGFjY3VtdWxhdGVcbiAgICAgICBtb3JlIHRoYW4gMTAwIGNvbW1pdHMgd2l0aG91dCBwdXNoaW5nIChldmVuIDEwMCBpcyB0b28gbWFueSEpLFxuICAgICAgIHNvIHRoZXJl4oCZcyBwcm9iYWJseSBzb21ldGhpbmcgc3RyYW5nZSBnb2luZyBvbi5cblxuICAgICAgIE90aGVyIGFzc3VtcHRpb25zOlxuXG4gICAgICAgKiBnaXQubG9nIHJldHVybnMgY29tbWl0cyBmcm9tIG5ld2VzdCB0byBvbGRlc3QuXG4gICAgICAgKiBUaGUgcmVtb3RlIHdhcyBhbHJlYWR5IGZldGNoZWQuXG5cbiAgICAqL1xuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc3RhZ2luZ0xvY2suYWNxdWlyZSgnMScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGxhdGVzdFJlbW90ZUNvbW1pdCA9IGF3YWl0IGdpdC5yZXNvbHZlUmVmKHtcbiAgICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICAgIHJlZjogYCR7TUFJTl9SRU1PVEV9L21hc3RlcmAsXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgbG9jYWxDb21taXRzID0gYXdhaXQgZ2l0LmxvZyh7XG4gICAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgICBkZXB0aDogMTAwLFxuICAgICAgfSk7XG5cbiAgICAgIHZhciBjb21taXRzID0gW10gYXMgc3RyaW5nW107XG4gICAgICBmb3IgKGNvbnN0IGNvbW1pdCBvZiBsb2NhbENvbW1pdHMpIHtcbiAgICAgICAgaWYgKGF3YWl0IGdpdC5pc0Rlc2NlbmRlbnQoeyBkaXI6IHRoaXMud29ya0Rpciwgb2lkOiBjb21taXQub2lkLCBhbmNlc3RvcjogbGF0ZXN0UmVtb3RlQ29tbWl0IH0pKSB7XG4gICAgICAgICAgY29tbWl0cy5wdXNoKGNvbW1pdC5tZXNzYWdlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gY29tbWl0cztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJEaWQgbm90IGZpbmQgYSBsb2NhbCBjb21taXQgdGhhdCBpcyBhbiBhbmNlc3RvciBvZiByZW1vdGUgbWFzdGVyXCIpO1xuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGxpc3RDaGFuZ2VkRmlsZXMocGF0aFNwZWNzID0gWycuJ10pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgLyogTGlzdHMgcmVsYXRpdmUgcGF0aHMgdG8gYWxsIGZpbGVzIHRoYXQgd2VyZSBjaGFuZ2VkIGFuZCBoYXZlIG5vdCBiZWVuIGNvbW1pdHRlZC4gKi9cblxuICAgIGNvbnN0IEZJTEUgPSAwLCBIRUFEID0gMSwgV09SS0RJUiA9IDI7XG5cbiAgICByZXR1cm4gKGF3YWl0IGdpdC5zdGF0dXNNYXRyaXgoeyBkaXI6IHRoaXMud29ya0RpciwgZmlsZXBhdGhzOiBwYXRoU3BlY3MgfSkpXG4gICAgICAuZmlsdGVyKHJvdyA9PiByb3dbSEVBRF0gIT09IHJvd1tXT1JLRElSXSlcbiAgICAgIC5tYXAocm93ID0+IHJvd1tGSUxFXSlcbiAgICAgIC5maWx0ZXIoZmlsZXBhdGggPT4gIWZpbGVwYXRoLnN0YXJ0c1dpdGgoJy4uJykpO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHN0YWdlQW5kQ29tbWl0KHBhdGhTcGVjczogc3RyaW5nW10sIG1zZzogc3RyaW5nKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICAvKiBTdGFnZXMgYW5kIGNvbW1pdHMgZmlsZXMgbWF0Y2hpbmcgZ2l2ZW4gcGF0aCBzcGVjIHdpdGggZ2l2ZW4gbWVzc2FnZS5cblxuICAgICAgIEFueSBvdGhlciBmaWxlcyBzdGFnZWQgYXQgdGhlIHRpbWUgb2YgdGhlIGNhbGwgd2lsbCBiZSB1bnN0YWdlZC5cblxuICAgICAgIFJldHVybnMgdGhlIG51bWJlciBvZiBtYXRjaGluZyBmaWxlcyB3aXRoIHVuc3RhZ2VkIGNoYW5nZXMgcHJpb3IgdG8gc3RhZ2luZy5cbiAgICAgICBJZiBubyBtYXRjaGluZyBmaWxlcyB3ZXJlIGZvdW5kIGhhdmluZyB1bnN0YWdlZCBjaGFuZ2VzLFxuICAgICAgIHNraXBzIHRoZSByZXN0IGFuZCByZXR1cm5zIHplcm8uXG5cbiAgICAgICBJZiBmYWlsSWZEaXZlcmdlZCBpcyBnaXZlbiwgYXR0ZW1wdHMgYSBmYXN0LWZvcndhcmQgcHVsbCBhZnRlciB0aGUgY29tbWl0LlxuICAgICAgIEl0IHdpbGwgZmFpbCBpbW1lZGlhdGVseSBpZiBtYWluIHJlbW90ZSBoYWQgb3RoZXIgY29tbWl0cyBhcHBlYXIgaW4gbWVhbnRpbWUuXG5cbiAgICAgICBMb2NrcyBzbyB0aGF0IHRoaXMgbWV0aG9kIGNhbm5vdCBiZSBydW4gY29uY3VycmVudGx5IChieSBzYW1lIGluc3RhbmNlKS5cbiAgICAqL1xuXG4gICAgaWYgKHBhdGhTcGVjcy5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJXYXNu4oCZdCBnaXZlbiBhbnkgcGF0aHMgdG8gY29tbWl0IVwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5zdGFnaW5nTG9jay5hY3F1aXJlKCcxJywgYXN5bmMgKCkgPT4ge1xuICAgICAgbG9nLnZlcmJvc2UoYFNTRTogR2l0Q29udHJvbGxlcjogU3RhZ2luZyBhbmQgY29tbWl0dGluZzogJHtwYXRoU3BlY3Muam9pbignLCAnKX1gKTtcblxuICAgICAgY29uc3QgZmlsZXNDaGFuZ2VkID0gKGF3YWl0IHRoaXMubGlzdENoYW5nZWRGaWxlcyhwYXRoU3BlY3MpKS5sZW5ndGg7XG4gICAgICBpZiAoZmlsZXNDaGFuZ2VkIDwgMSkge1xuICAgICAgICByZXR1cm4gMDtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy51bnN0YWdlQWxsKCk7XG4gICAgICBhd2FpdCB0aGlzLnN0YWdlKHBhdGhTcGVjcyk7XG4gICAgICBhd2FpdCB0aGlzLmNvbW1pdChtc2cpO1xuXG4gICAgICByZXR1cm4gZmlsZXNDaGFuZ2VkO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB1bnN0YWdlQWxsKCkge1xuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBVbnN0YWdpbmcgYWxsIGNoYW5nZXNcIik7XG4gICAgYXdhaXQgZ2l0LnJlbW92ZSh7IGRpcjogdGhpcy53b3JrRGlyLCBmaWxlcGF0aDogJy4nIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBfaGFuZGxlR2l0RXJyb3IoZTogRXJyb3IgJiB7IGNvZGU6IHN0cmluZyB9KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKGUuY29kZSA9PT0gJ0Zhc3RGb3J3YXJkRmFpbCcpIHtcbiAgICAgIC8vIE5PVEU6IFRoZXJl4oCZcyBhbHNvIFB1c2hSZWplY3RlZE5vbkZhc3RGb3J3YXJkLCBidXQgaXQgc2VlbXMgdG8gYmUgdGhyb3duXG4gICAgICAvLyBmb3IgdW5yZWxhdGVkIGNhc2VzIGR1cmluZyBwdXNoIChmYWxzZSBwb3NpdGl2ZSkuXG4gICAgICAvLyBCZWNhdXNlIG9mIHRoYXQgZmFsc2UgcG9zaXRpdmUsIHdlIGlnbm9yZSB0aGF0IGVycm9yIGFuZCBpbnN0ZWFkIGRvIHB1bGwgZmlyc3QsXG4gICAgICAvLyBjYXRjaGluZyBhY3R1YWwgZmFzdC1mb3J3YXJkIGZhaWxzIG9uIHRoYXQgc3RlcCBiZWZvcmUgcHVzaC5cbiAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBzdGF0dXNSZWxhdGl2ZVRvTG9jYWw6ICdkaXZlcmdlZCcgfSk7XG4gICAgfSBlbHNlIGlmIChbJ01pc3NpbmdVc2VybmFtZUVycm9yJywgJ01pc3NpbmdBdXRob3JFcnJvcicsICdNaXNzaW5nQ29tbWl0dGVyRXJyb3InXS5pbmRleE9mKGUuY29kZSkgPj0gMCkge1xuICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IGlzTWlzY29uZmlndXJlZDogdHJ1ZSB9KTtcbiAgICB9IGVsc2UgaWYgKGUuY29kZSA9PT0gJ01pc3NpbmdQYXNzd29yZFRva2VuRXJyb3InIHx8IChlLmNvZGUgPT09ICdIVFRQRXJyb3InICYmIGUubWVzc2FnZS5pbmRleE9mKCdVbmF1dGhvcml6ZWQnKSA+PSAwKSkge1xuICAgICAgdGhpcy5zZXRQYXNzd29yZCh1bmRlZmluZWQpO1xuICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IG5lZWRzUGFzc3dvcmQ6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIGFzeW5jIGNoZWNrVW5jb21taXR0ZWQoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgLyogQ2hlY2tzIGZvciBhbnkgdW5jb21taXR0ZWQgY2hhbmdlcyBsb2NhbGx5IHByZXNlbnQuXG4gICAgICAgTm90aWZpZXMgYWxsIHdpbmRvd3MgYWJvdXQgdGhlIHN0YXR1cy4gKi9cblxuICAgIGxvZy5kZWJ1ZyhcIlNTRTogR2l0OiBDaGVja2luZyBmb3IgdW5jb21taXR0ZWQgY2hhbmdlc1wiKTtcbiAgICBjb25zdCBoYXNVbmNvbW1pdHRlZENoYW5nZXMgPSAoYXdhaXQgdGhpcy5saXN0Q2hhbmdlZEZpbGVzKCkpLmxlbmd0aCA+IDA7XG4gICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IGhhc0xvY2FsQ2hhbmdlczogaGFzVW5jb21taXR0ZWRDaGFuZ2VzIH0pO1xuICAgIHJldHVybiBoYXNVbmNvbW1pdHRlZENoYW5nZXM7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgc3luY2hyb25pemUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLyogQ2hlY2tzIGZvciBjb25uZWN0aW9uLCBsb2NhbCBjaGFuZ2VzIGFuZCB1bnB1c2hlZCBjb21taXRzLFxuICAgICAgIHRyaWVzIHRvIHB1c2ggYW5kIHB1bGwgd2hlbiB0aGVyZeKAmXMgb3Bwb3J0dW5pdHkuXG5cbiAgICAgICBOb3RpZmllcyBhbGwgd2luZG93cyBhYm91dCB0aGUgc3RhdHVzIGluIHByb2Nlc3MuICovXG5cbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0OiBRdWV1ZWluZyBzeW5jXCIpO1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnN0YWdpbmdMb2NrLmFjcXVpcmUoJzEnLCBhc3luYyAoKSA9PiB7XG4gICAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0OiBTdGFydGluZyBzeW5jXCIpO1xuXG4gICAgICBjb25zdCBoYXNVbmNvbW1pdHRlZENoYW5nZXMgPSBhd2FpdCB0aGlzLmNoZWNrVW5jb21taXR0ZWQoKTtcblxuICAgICAgaWYgKCFoYXNVbmNvbW1pdHRlZENoYW5nZXMpIHtcblxuICAgICAgICBjb25zdCBpc09mZmxpbmUgPSAoYXdhaXQgY2hlY2tPbmxpbmVTdGF0dXMoKSkgPT09IGZhbHNlO1xuICAgICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaXNPZmZsaW5lIH0pO1xuXG4gICAgICAgIGlmICghaXNPZmZsaW5lKSB7XG5cbiAgICAgICAgICBjb25zdCBuZWVkc1Bhc3N3b3JkID0gdGhpcy5uZWVkc1Bhc3N3b3JkKCk7XG4gICAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IG5lZWRzUGFzc3dvcmQgfSk7XG4gICAgICAgICAgaWYgKG5lZWRzUGFzc3dvcmQpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaXNQdWxsaW5nOiB0cnVlIH0pO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnB1bGwoKTtcbiAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBsb2cuZXJyb3IoZSk7XG4gICAgICAgICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaXNQdWxsaW5nOiBmYWxzZSB9KTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUdpdEVycm9yKGUpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaXNQdWxsaW5nOiBmYWxzZSB9KTtcblxuICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc1B1c2hpbmc6IHRydWUgfSk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucHVzaCgpO1xuICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc1B1c2hpbmc6IGZhbHNlIH0pO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5faGFuZGxlR2l0RXJyb3IoZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc1B1c2hpbmc6IGZhbHNlIH0pO1xuXG4gICAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7XG4gICAgICAgICAgICBzdGF0dXNSZWxhdGl2ZVRvTG9jYWw6ICd1cGRhdGVkJyxcbiAgICAgICAgICAgIGlzTWlzY29uZmlndXJlZDogZmFsc2UsXG4gICAgICAgICAgICBuZWVkc1Bhc3N3b3JkOiBmYWxzZSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICB9XG5cblxuICAvKiBJUEMgZW5kcG9pbnQgc2V0dXAgKi9cblxuICBzZXRVcEFQSUVuZHBvaW50cygpIHtcbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogU2V0dGluZyB1cCBBUEkgZW5kcG9pbnRzXCIpO1xuXG4gICAgbGlzdGVuPHsgbmFtZTogc3RyaW5nLCBlbWFpbDogc3RyaW5nLCB1c2VybmFtZTogc3RyaW5nIH0sIHsgc3VjY2VzczogdHJ1ZSB9PlxuICAgICgnZ2l0LWNvbmZpZy1zZXQnLCBhc3luYyAoeyBuYW1lLCBlbWFpbCwgdXNlcm5hbWUgfSkgPT4ge1xuICAgICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IHJlY2VpdmVkIGdpdC1jb25maWctc2V0IHJlcXVlc3RcIik7XG5cbiAgICAgIGF3YWl0IHRoaXMuY29uZmlnU2V0KCd1c2VyLm5hbWUnLCBuYW1lKTtcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlnU2V0KCd1c2VyLmVtYWlsJywgZW1haWwpO1xuICAgICAgYXdhaXQgdGhpcy5jb25maWdTZXQoJ2NyZWRlbnRpYWxzLnVzZXJuYW1lJywgdXNlcm5hbWUpO1xuXG4gICAgICB0aGlzLmF1dGgudXNlcm5hbWUgPSB1c2VybmFtZTtcblxuICAgICAgdGhpcy5zeW5jaHJvbml6ZSgpO1xuXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gICAgfSk7XG5cbiAgICBsaXN0ZW48eyBwYXNzd29yZDogc3RyaW5nIH0sIHsgc3VjY2VzczogdHJ1ZSB9PlxuICAgICgnZ2l0LXNldC1wYXNzd29yZCcsIGFzeW5jICh7IHBhc3N3b3JkIH0pID0+IHtcbiAgICAgIC8vIFdBUk5JTkc6IERvbuKAmXQgbG9nIHBhc3N3b3JkXG4gICAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogcmVjZWl2ZWQgZ2l0LXNldC1wYXNzd29yZCByZXF1ZXN0XCIpO1xuXG4gICAgICB0aGlzLnNldFBhc3N3b3JkKHBhc3N3b3JkKTtcbiAgICAgIHRoaXMuc3luY2hyb25pemUoKTtcblxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICAgIH0pO1xuXG4gICAgbGlzdGVuPHt9LCB7IG9yaWdpblVSTDogc3RyaW5nIHwgbnVsbCwgbmFtZTogc3RyaW5nIHwgbnVsbCwgZW1haWw6IHN0cmluZyB8IG51bGwsIHVzZXJuYW1lOiBzdHJpbmcgfCBudWxsIH0+XG4gICAgKCdnaXQtY29uZmlnLWdldCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiByZWNlaXZlZCBnaXQtY29uZmlnIHJlcXVlc3RcIik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBvcmlnaW5VUkw6IGF3YWl0IHRoaXMuZ2V0T3JpZ2luVXJsKCksXG4gICAgICAgIG5hbWU6IGF3YWl0IHRoaXMuY29uZmlnR2V0KCd1c2VyLm5hbWUnKSxcbiAgICAgICAgZW1haWw6IGF3YWl0IHRoaXMuY29uZmlnR2V0KCd1c2VyLmVtYWlsJyksXG4gICAgICAgIHVzZXJuYW1lOiBhd2FpdCB0aGlzLmNvbmZpZ0dldCgnY3JlZGVudGlhbHMudXNlcm5hbWUnKSxcbiAgICAgICAgLy8gUGFzc3dvcmQgbXVzdCBub3QgYmUgcmV0dXJuZWQsIG9mIGNvdXJzZVxuICAgICAgfTtcbiAgICB9KTtcbiAgfVxufVxuXG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBpbml0UmVwbyhcbiAgICB3b3JrRGlyOiBzdHJpbmcsXG4gICAgdXBzdHJlYW1SZXBvVXJsOiBzdHJpbmcsXG4gICAgY29yc1Byb3h5VXJsOiBzdHJpbmcsXG4gICAgZm9yY2U6IGJvb2xlYW4sXG4gICAgc2V0dGluZ3M6IFNldHRpbmdNYW5hZ2VyLFxuICAgIGNvbmZpZ1dpbmRvdzogV2luZG93T3BlbmVyUGFyYW1zKTogUHJvbWlzZTxHaXRDb250cm9sbGVyPiB7XG5cbiAgc2V0dGluZ3MuY29uZmlndXJlUGFuZSh7XG4gICAgaWQ6ICdkYXRhU3luYycsXG4gICAgbGFiZWw6IFwiRGF0YSBzeW5jaHJvbml6YXRpb25cIixcbiAgICBpY29uOiAnZ2l0LW1lcmdlJyxcbiAgfSk7XG5cbiAgc2V0dGluZ3MucmVnaXN0ZXIobmV3IFNldHRpbmc8c3RyaW5nPihcbiAgICAnZ2l0UmVwb1VybCcsXG4gICAgXCJHaXQgcmVwb3NpdG9yeSBVUkxcIixcbiAgICAnZGF0YVN5bmMnLFxuICApKTtcblxuICBjb25zdCByZXBvVXJsID0gKGF3YWl0IHNldHRpbmdzLmdldFZhbHVlKCdnaXRSZXBvVXJsJykgYXMgc3RyaW5nKSB8fCAoYXdhaXQgcmVxdWVzdFJlcG9VcmwoY29uZmlnV2luZG93KSk7XG5cbiAgY29uc3QgZ2l0Q3RybCA9IG5ldyBHaXRDb250cm9sbGVyKGZzLCByZXBvVXJsLCB1cHN0cmVhbVJlcG9VcmwsIHdvcmtEaXIsIGNvcnNQcm94eVVybCk7XG5cbiAgbGV0IGRvSW5pdGlhbGl6ZTogYm9vbGVhbjtcblxuICBpZiAoZm9yY2UgPT09IHRydWUpIHtcbiAgICBsb2cud2FybihcIlNTRTogR2l0IGlzIGJlaW5nIGZvcmNlIHJlaW5pdGlhbGl6ZWRcIik7XG4gICAgZG9Jbml0aWFsaXplID0gdHJ1ZTtcbiAgfSBlbHNlIGlmICghKGF3YWl0IGdpdEN0cmwuaXNJbml0aWFsaXplZCgpKSkge1xuICAgIGxvZy53YXJuKFwiU1NFOiBHaXQgaXMgbm90IGluaXRpYWxpemVkIHlldFwiKTtcbiAgICBkb0luaXRpYWxpemUgPSB0cnVlO1xuICB9IGVsc2UgaWYgKCEoYXdhaXQgZ2l0Q3RybC5pc1VzaW5nUmVtb3RlVVJMcyh7IG9yaWdpbjogcmVwb1VybCwgdXBzdHJlYW06IHVwc3RyZWFtUmVwb1VybCB9KSkpIHtcbiAgICBsb2cud2FybihcIlNTRTogR2l0IGhhcyBtaXNtYXRjaGluZyByZW1vdGUgVVJMcywgcmVpbml0aWFsaXppbmdcIik7XG4gICAgZG9Jbml0aWFsaXplID0gdHJ1ZTtcbiAgfSBlbHNlIHtcbiAgICBsb2cuaW5mbyhcIlNTRTogR2l0IGlzIGFscmVhZHkgaW5pdGlhbGl6ZWRcIik7XG4gICAgZG9Jbml0aWFsaXplID0gZmFsc2U7XG4gIH1cblxuICBpZiAoZG9Jbml0aWFsaXplKSB7XG4gICAgYXdhaXQgZ2l0Q3RybC5mb3JjZUluaXRpYWxpemUoKTtcbiAgfVxuXG4gIGF3YWl0IGdpdEN0cmwubG9hZEF1dGgoKTtcblxuICByZXR1cm4gZ2l0Q3RybDtcbn1cblxuXG4vKiBQcm9taXNlcyB0byByZXR1cm4gYW4gb2JqZWN0IGNvbnRhaW5pbmcgc3RyaW5nIHdpdGggcmVwb3NpdG9yeSBVUkxcbiAgIGFuZCBhIGZsYWcgaW5kaWNhdGluZyB3aGV0aGVyIGl04oCZcyBiZWVuIHJlc2V0XG4gICAod2hpY2ggaWYgdHJ1ZSB3b3VsZCBjYXVzZSBgaW5pdFJlcG8oKWAgdG8gcmVpbml0aWFsaXplIHRoZSByZXBvc2l0b3J5KS5cblxuICAgSWYgcmVwb3NpdG9yeSBVUkwgaXMgbm90IGNvbmZpZ3VyZWQgKGUuZy4sIG9uIGZpcnN0IHJ1biwgb3IgYWZ0ZXIgcmVzZXQpXG4gICBvcGVucyBhIHdpbmRvdyB3aXRoIHNwZWNpZmllZCBvcHRpb25zIHRvIGFzayB0aGUgdXNlciB0byBwcm92aWRlIHRoZSBzZXR0aW5nLlxuICAgVGhlIHdpbmRvdyBpcyBleHBlY3RlZCB0byBhc2sgdGhlIHVzZXIgdG8gc3BlY2lmeSB0aGUgVVJMIGFuZCBzZW5kIGEgYCdzZXQtc2V0dGluZydgXG4gICBldmVudCBmb3IgYCdnaXRSZXBvVXJsJ2AuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVxdWVzdFJlcG9VcmwoY29uZmlnV2luZG93OiBXaW5kb3dPcGVuZXJQYXJhbXMpOiBQcm9taXNlPHN0cmluZz4ge1xuICByZXR1cm4gbmV3IFByb21pc2U8c3RyaW5nPihhc3luYyAocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG5cbiAgICBsb2cud2FybihcIlNTRTogR2l0Q29udHJvbGxlcjogT3BlbiBjb25maWcgd2luZG93IHRvIGNvbmZpZ3VyZSByZXBvIFVSTFwiKTtcblxuICAgIGlwY01haW4ub24oJ3NldC1zZXR0aW5nJywgaGFuZGxlU2V0dGluZyk7XG5cbiAgICBmdW5jdGlvbiBoYW5kbGVTZXR0aW5nKGV2dDogYW55LCBuYW1lOiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcpIHtcbiAgICAgIGlmIChuYW1lID09PSAnZ2l0UmVwb1VybCcpIHtcbiAgICAgICAgbG9nLmluZm8oXCJTU0U6IEdpdENvbnRyb2xsZXI6IHJlY2VpdmVkIGdpdFJlcG9Vcmwgc2V0dGluZ1wiKTtcbiAgICAgICAgaXBjTWFpbi5yZW1vdmVMaXN0ZW5lcignc2V0LXNldHRpbmcnLCBoYW5kbGVTZXR0aW5nKTtcbiAgICAgICAgcmVzb2x2ZSh2YWx1ZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgb3BlbldpbmRvdyhjb25maWdXaW5kb3cpO1xuXG4gIH0pO1xufVxuXG5cbmFzeW5jIGZ1bmN0aW9uIGNoZWNrT25saW5lU3RhdHVzKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBsZXQgaXNPZmZsaW5lOiBib29sZWFuO1xuICB0cnkge1xuICAgIGF3YWl0IGRucy5wcm9taXNlcy5sb29rdXAoJ2dpdGh1Yi5jb20nKTtcbiAgICBpc09mZmxpbmUgPSBmYWxzZTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlzT2ZmbGluZSA9IHRydWU7XG4gIH1cbiAgcmV0dXJuICFpc09mZmxpbmU7XG59XG5cblxuYXN5bmMgZnVuY3Rpb24gc2VuZFJlbW90ZVN0YXR1cyh1cGRhdGU6IFBhcnRpYWw8UmVtb3RlU3RvcmFnZVN0YXR1cz4pIHtcbiAgYXdhaXQgbm90aWZ5QWxsV2luZG93cygncmVtb3RlLXN0b3JhZ2Utc3RhdHVzJywgdXBkYXRlKTtcbn1cbiJdfQ==