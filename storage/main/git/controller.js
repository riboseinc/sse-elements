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
        const isOffline = (await checkOnlineStatus()) === false;
        await sendRemoteStatus({ isOffline });
        log.verbose("SSE: Git: Queueing sync");
        return await this.stagingLock.acquire('1', async () => {
            log.verbose("SSE: Git: Starting sync");
            if (!isOffline) {
                const needsPassword = this.needsPassword();
                await sendRemoteStatus({ needsPassword });
                if (needsPassword) {
                    return;
                }
                const hasUncommittedChanges = await this.checkUncommitted();
                if (!hasUncommittedChanges) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zdG9yYWdlL21haW4vZ2l0L2NvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxLQUFLLEdBQUcsTUFBTSxLQUFLLENBQUM7QUFDM0IsT0FBTyxLQUFLLElBQUksTUFBTSxNQUFNLENBQUM7QUFDN0IsT0FBTyxLQUFLLEVBQUUsTUFBTSxVQUFVLENBQUM7QUFDL0IsT0FBTyxTQUFTLE1BQU0sWUFBWSxDQUFDO0FBQ25DLE9BQU8sS0FBSyxHQUFHLE1BQU0sZ0JBQWdCLENBQUM7QUFDdEMsT0FBTyxLQUFLLEdBQUcsTUFBTSxjQUFjLENBQUM7QUFFcEMsT0FBTyxFQUFFLE9BQU8sRUFBRSxNQUFNLFVBQVUsQ0FBQztBQUVuQyxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFDM0MsT0FBTyxFQUFFLE9BQU8sRUFBa0IsTUFBTSx3QkFBd0IsQ0FBQztBQUNqRSxPQUFPLEVBQUUsZ0JBQWdCLEVBQXNCLFVBQVUsRUFBRSxNQUFNLHNCQUFzQixDQUFDO0FBT3hGLE1BQU0sZUFBZSxHQUFHLFVBQVUsQ0FBQztBQUNuQyxNQUFNLFdBQVcsR0FBRyxRQUFRLENBQUM7QUFHN0IsTUFBTSxPQUFPLGFBQWE7SUFNeEIsWUFDWSxFQUFPLEVBQ1AsT0FBZSxFQUNmLGVBQXVCLEVBQ3hCLE9BQWUsRUFDZCxTQUFpQjtRQUpqQixPQUFFLEdBQUYsRUFBRSxDQUFLO1FBQ1AsWUFBTyxHQUFQLE9BQU8sQ0FBUTtRQUNmLG9CQUFlLEdBQWYsZUFBZSxDQUFRO1FBQ3hCLFlBQU8sR0FBUCxPQUFPLENBQVE7UUFDZCxjQUFTLEdBQVQsU0FBUyxDQUFRO1FBVHJCLFNBQUksR0FBc0IsRUFBRSxDQUFDO1FBV25DLEdBQUcsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQztRQUUxQixJQUFJ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QUFNLENBQUMsQ0FBQztBQUMxRCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgZG5zIGZyb20gJ2Rucyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMtZXh0cmEnO1xuaW1wb3J0IEFzeW5jTG9jayBmcm9tICdhc3luYy1sb2NrJztcbmltcG9ydCAqIGFzIGdpdCBmcm9tICdpc29tb3JwaGljLWdpdCc7XG5pbXBvcnQgKiBhcyBsb2cgZnJvbSAnZWxlY3Ryb24tbG9nJztcblxuaW1wb3J0IHsgaXBjTWFpbiB9IGZyb20gJ2VsZWN0cm9uJztcblxuaW1wb3J0IHsgbGlzdGVuIH0gZnJvbSAnLi4vLi4vLi4vYXBpL21haW4nO1xuaW1wb3J0IHsgU2V0dGluZywgU2V0dGluZ01hbmFnZXIgfSBmcm9tICcuLi8uLi8uLi9zZXR0aW5ncy9tYWluJztcbmltcG9ydCB7IG5vdGlmeUFsbFdpbmRvd3MsIFdpbmRvd09wZW5lclBhcmFtcywgb3BlbldpbmRvdyB9IGZyb20gJy4uLy4uLy4uL21haW4vd2luZG93JztcblxuaW1wb3J0IHsgUmVtb3RlU3RvcmFnZVN0YXR1cyB9IGZyb20gJy4uL3JlbW90ZSc7XG5cbmltcG9ydCB7IEdpdEF1dGhlbnRpY2F0aW9uIH0gZnJvbSAnLi90eXBlcyc7XG5cblxuY29uc3QgVVBTVFJFQU1fUkVNT1RFID0gJ3Vwc3RyZWFtJztcbmNvbnN0IE1BSU5fUkVNT1RFID0gJ29yaWdpbic7XG5cblxuZXhwb3J0IGNsYXNzIEdpdENvbnRyb2xsZXIge1xuXG4gIHByaXZhdGUgYXV0aDogR2l0QXV0aGVudGljYXRpb24gPSB7fTtcblxuICBwcml2YXRlIHN0YWdpbmdMb2NrOiBBc3luY0xvY2s7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgICBwcml2YXRlIGZzOiBhbnksXG4gICAgICBwcml2YXRlIHJlcG9Vcmw6IHN0cmluZyxcbiAgICAgIHByaXZhdGUgdXBzdHJlYW1SZXBvVXJsOiBzdHJpbmcsXG4gICAgICBwdWJsaWMgd29ya0Rpcjogc3RyaW5nLFxuICAgICAgcHJpdmF0ZSBjb3JzUHJveHk6IHN0cmluZykge1xuXG4gICAgZ2l0LnBsdWdpbnMuc2V0KCdmcycsIGZzKTtcblxuICAgIHRoaXMuc3RhZ2luZ0xvY2sgPSBuZXcgQXN5bmNMb2NrKHsgdGltZW91dDogMjAwMDAsIG1heFBlbmRpbmc6IDEwIH0pO1xuXG4gICAgLy8gTWFrZXMgaXQgZWFzaWVyIHRvIGJpbmQgdGhlc2UgdG8gSVBDIGV2ZW50c1xuICAgIHRoaXMuc3luY2hyb25pemUgPSB0aGlzLnN5bmNocm9uaXplLmJpbmQodGhpcyk7XG4gICAgdGhpcy5yZXNldEZpbGVzID0gdGhpcy5yZXNldEZpbGVzLmJpbmQodGhpcyk7XG4gICAgdGhpcy5jaGVja1VuY29tbWl0dGVkID0gdGhpcy5jaGVja1VuY29tbWl0dGVkLmJpbmQodGhpcyk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgaXNJbml0aWFsaXplZCgpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBsZXQgaGFzR2l0RGlyZWN0b3J5OiBib29sZWFuO1xuICAgIHRyeSB7XG4gICAgICBoYXNHaXREaXJlY3RvcnkgPSAoYXdhaXQgdGhpcy5mcy5zdGF0KHBhdGguam9pbih0aGlzLndvcmtEaXIsICcuZ2l0JykpKS5pc0RpcmVjdG9yeSgpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGhhc0dpdERpcmVjdG9yeSA9IGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gaGFzR2l0RGlyZWN0b3J5O1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGlzVXNpbmdSZW1vdGVVUkxzKHJlbW90ZVVybHM6IHsgb3JpZ2luOiBzdHJpbmcsIHVwc3RyZWFtOiBzdHJpbmcgfSk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IG9yaWdpbiA9IChhd2FpdCB0aGlzLmdldE9yaWdpblVybCgpIHx8ICcnKS50cmltKCk7XG4gICAgY29uc3QgdXBzdHJlYW0gPSAoYXdhaXQgdGhpcy5nZXRVcHN0cmVhbVVybCgpIHx8ICcnKS50cmltKCk7XG4gICAgcmV0dXJuIG9yaWdpbiA9PT0gcmVtb3RlVXJscy5vcmlnaW4gJiYgdXBzdHJlYW0gPT09IHJlbW90ZVVybHMudXBzdHJlYW07XG4gIH1cblxuICBwdWJsaWMgbmVlZHNQYXNzd29yZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gKHRoaXMuYXV0aC5wYXNzd29yZCB8fCAnJykudHJpbSgpID09PSAnJztcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBmb3JjZUluaXRpYWxpemUoKSB7XG4gICAgLyogSW5pdGlhbGl6ZXMgZnJvbSBzY3JhdGNoOiB3aXBlcyB3b3JrIGRpcmVjdG9yeSwgY2xvbmVzIGFnYWluLCBhZGRzIHJlbW90ZXMuICovXG5cbiAgICBsb2cud2FybihcIlNTRTogR2l0Q29udHJvbGxlcjogRm9yY2UgaW5pdGlhbGl6aW5nXCIpO1xuICAgIGxvZy53YXJuKFwiU1NFOiBHaXRDb250cm9sbGVyOiBJbml0aWFsaXplOiBSZW1vdmluZyBkYXRhIGRpcmVjdG9yeVwiKTtcblxuICAgIGF3YWl0IHRoaXMuZnMucmVtb3ZlKHRoaXMud29ya0Rpcik7XG5cbiAgICBsb2cuc2lsbHkoXCJTU0U6IEdpdENvbnRyb2xsZXI6IEluaXRpYWxpemU6IEVuc3VyaW5nIGRhdGEgZGlyZWN0b3J5IGV4aXN0c1wiKTtcblxuICAgIGF3YWl0IHRoaXMuZnMuZW5zdXJlRGlyKHRoaXMud29ya0Rpcik7XG5cbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogSW5pdGlhbGl6ZTogQ2xvbmluZ1wiLCB0aGlzLnJlcG9VcmwpO1xuXG4gICAgYXdhaXQgZ2l0LmNsb25lKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgdXJsOiB0aGlzLnJlcG9VcmwsXG4gICAgICByZWY6ICdtYXN0ZXInLFxuICAgICAgc2luZ2xlQnJhbmNoOiB0cnVlLFxuICAgICAgZGVwdGg6IDUsXG4gICAgICBjb3JzUHJveHk6IHRoaXMuY29yc1Byb3h5LFxuICAgICAgLi4udGhpcy5hdXRoLFxuICAgIH0pO1xuXG4gICAgYXdhaXQgZ2l0LmFkZFJlbW90ZSh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIHJlbW90ZTogVVBTVFJFQU1fUkVNT1RFLFxuICAgICAgdXJsOiB0aGlzLnVwc3RyZWFtUmVwb1VybCxcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBjb25maWdTZXQocHJvcDogc3RyaW5nLCB2YWw6IHN0cmluZykge1xuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBTZXQgY29uZmlnXCIpO1xuICAgIGF3YWl0IGdpdC5jb25maWcoeyBkaXI6IHRoaXMud29ya0RpciwgcGF0aDogcHJvcCwgdmFsdWU6IHZhbCB9KTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBjb25maWdHZXQocHJvcDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogR2V0IGNvbmZpZ1wiLCBwcm9wKTtcbiAgICByZXR1cm4gYXdhaXQgZ2l0LmNvbmZpZyh7IGRpcjogdGhpcy53b3JrRGlyLCBwYXRoOiBwcm9wIH0pO1xuICB9XG5cbiAgcHVibGljIHNldFBhc3N3b3JkKHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpIHtcbiAgICB0aGlzLmF1dGgucGFzc3dvcmQgPSB2YWx1ZTtcbiAgfVxuXG4gIGFzeW5jIGxvYWRBdXRoKCkge1xuICAgIC8qIENvbmZpZ3VyZSBhdXRoIHdpdGggZ2l0LWNvbmZpZyB1c2VybmFtZSwgaWYgc2V0LlxuICAgICAgIFN1cHBvc2VkIHRvIGJlIGhhcHBlbmluZyBhdXRvbWF0aWNhbGx5PyBNYXliZSBub3QuXG4gICAgICAgVGhpcyBtZXRob2QgbXVzdCBiZSBtYW51YWxseSBjYWxsZWQgYmVmb3JlIG1ha2luZyBvcGVyYXRpb25zIHRoYXQgbmVlZCBhdXRoLiAqL1xuICAgIGNvbnN0IHVzZXJuYW1lID0gYXdhaXQgdGhpcy5jb25maWdHZXQoJ2NyZWRlbnRpYWxzLnVzZXJuYW1lJyk7XG4gICAgaWYgKHVzZXJuYW1lKSB7XG4gICAgICB0aGlzLmF1dGgudXNlcm5hbWUgPSB1c2VybmFtZTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBwdWxsKCkge1xuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBQdWxsaW5nIG1hc3RlciB3aXRoIGZhc3QtZm9yd2FyZCBtZXJnZVwiKTtcblxuICAgIHJldHVybiBhd2FpdCBnaXQucHVsbCh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIHNpbmdsZUJyYW5jaDogdHJ1ZSxcbiAgICAgIGZhc3RGb3J3YXJkT25seTogdHJ1ZSxcbiAgICAgIGZhc3Q6IHRydWUsXG4gICAgICAuLi50aGlzLmF1dGgsXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBzdGFnZShwYXRoU3BlY3M6IHN0cmluZ1tdKSB7XG4gICAgbG9nLnZlcmJvc2UoYFNTRTogR2l0Q29udHJvbGxlcjogQWRkaW5nIGNoYW5nZXM6ICR7cGF0aFNwZWNzLmpvaW4oJywgJyl9YCk7XG5cbiAgICBmb3IgKGNvbnN0IHBhdGhTcGVjIG9mIHBhdGhTcGVjcykge1xuICAgICAgYXdhaXQgZ2l0LmFkZCh7XG4gICAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgICBmaWxlcGF0aDogcGF0aFNwZWMsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBjb21taXQobXNnOiBzdHJpbmcpIHtcbiAgICBsb2cudmVyYm9zZShgU1NFOiBHaXRDb250cm9sbGVyOiBDb21taXR0aW5nIHdpdGggbWVzc2FnZSAke21zZ31gKTtcblxuICAgIHJldHVybiBhd2FpdCBnaXQuY29tbWl0KHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgbWVzc2FnZTogbXNnLFxuICAgICAgYXV0aG9yOiB7fSwgIC8vIGdpdC1jb25maWcgdmFsdWVzIHdpbGwgYmUgdXNlZFxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgZmV0Y2hSZW1vdGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgZ2l0LmZldGNoKHsgZGlyOiB0aGlzLndvcmtEaXIsIHJlbW90ZTogTUFJTl9SRU1PVEUsIC4uLnRoaXMuYXV0aCB9KTtcbiAgfVxuXG4gIGFzeW5jIGZldGNoVXBzdHJlYW0oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgZ2l0LmZldGNoKHsgZGlyOiB0aGlzLndvcmtEaXIsIHJlbW90ZTogVVBTVFJFQU1fUkVNT1RFLCAuLi50aGlzLmF1dGggfSk7XG4gIH1cblxuICBhc3luYyBwdXNoKGZvcmNlID0gZmFsc2UpIHtcbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogUHVzaGluZ1wiKTtcblxuICAgIHJldHVybiBhd2FpdCBnaXQucHVzaCh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIHJlbW90ZTogTUFJTl9SRU1PVEUsXG4gICAgICBmb3JjZTogZm9yY2UsXG4gICAgICAuLi50aGlzLmF1dGgsXG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgcmVzZXRGaWxlcyhwYXRocz86IHN0cmluZ1tdKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc3RhZ2luZ0xvY2suYWNxdWlyZSgnMScsIGFzeW5jICgpID0+IHtcbiAgICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBGb3JjZSByZXNldHRpbmcgZmlsZXNcIik7XG5cbiAgICAgIHJldHVybiBhd2FpdCBnaXQuZmFzdENoZWNrb3V0KHtcbiAgICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICAgIGZvcmNlOiB0cnVlLFxuICAgICAgICBmaWxlcGF0aHM6IHBhdGhzIHx8IChhd2FpdCB0aGlzLmxpc3RDaGFuZ2VkRmlsZXMoKSksXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGdldE9yaWdpblVybCgpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICByZXR1cm4gKChhd2FpdCBnaXQubGlzdFJlbW90ZXMoe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgfSkpLmZpbmQociA9PiByLnJlbW90ZSA9PT0gTUFJTl9SRU1PVEUpIHx8IHsgdXJsOiBudWxsIH0pLnVybDtcbiAgfVxuXG4gIGFzeW5jIGdldFVwc3RyZWFtVXJsKCk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIHJldHVybiAoKGF3YWl0IGdpdC5saXN0UmVtb3Rlcyh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICB9KSkuZmluZChyID0+IHIucmVtb3RlID09PSBVUFNUUkVBTV9SRU1PVEUpIHx8IHsgdXJsOiBudWxsIH0pLnVybDtcbiAgfVxuXG4gIGFzeW5jIGxpc3RMb2NhbENvbW1pdHMoKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAgIC8qIFJldHVybnMgYSBsaXN0IG9mIGNvbW1pdCBtZXNzYWdlcyBmb3IgY29tbWl0cyB0aGF0IHdlcmUgbm90IHB1c2hlZCB5ZXQuXG5cbiAgICAgICBVc2VmdWwgdG8gY2hlY2sgd2hpY2ggY29tbWl0cyB3aWxsIGJlIHRocm93biBvdXRcbiAgICAgICBpZiB3ZSBmb3JjZSB1cGRhdGUgdG8gcmVtb3RlIG1hc3Rlci5cblxuICAgICAgIERvZXMgc28gYnkgd2Fsa2luZyB0aHJvdWdoIGxhc3QgMTAwIGNvbW1pdHMgc3RhcnRpbmcgZnJvbSBjdXJyZW50IEhFQUQuXG4gICAgICAgV2hlbiBpdCBlbmNvdW50ZXJzIHRoZSBmaXJzdCBsb2NhbCBjb21taXQgdGhhdCBkb2VzbuKAmXQgZGVzY2VuZHMgZnJvbSByZW1vdGUgbWFzdGVyIEhFQUQsXG4gICAgICAgaXQgY29uc2lkZXJzIGFsbCBwcmVjZWRpbmcgY29tbWl0cyB0byBiZSBhaGVhZC9sb2NhbCBhbmQgcmV0dXJucyB0aGVtLlxuXG4gICAgICAgSWYgaXQgZmluaXNoZXMgdGhlIHdhbGsgd2l0aG91dCBmaW5kaW5nIGFuIGFuY2VzdG9yLCB0aHJvd3MgYW4gZXJyb3IuXG4gICAgICAgSXQgaXMgYXNzdW1lZCB0aGF0IHRoZSBhcHAgZG9lcyBub3QgYWxsb3cgdG8gYWNjdW11bGF0ZVxuICAgICAgIG1vcmUgdGhhbiAxMDAgY29tbWl0cyB3aXRob3V0IHB1c2hpbmcgKGV2ZW4gMTAwIGlzIHRvbyBtYW55ISksXG4gICAgICAgc28gdGhlcmXigJlzIHByb2JhYmx5IHNvbWV0aGluZyBzdHJhbmdlIGdvaW5nIG9uLlxuXG4gICAgICAgT3RoZXIgYXNzdW1wdGlvbnM6XG5cbiAgICAgICAqIGdpdC5sb2cgcmV0dXJucyBjb21taXRzIGZyb20gbmV3ZXN0IHRvIG9sZGVzdC5cbiAgICAgICAqIFRoZSByZW1vdGUgd2FzIGFscmVhZHkgZmV0Y2hlZC5cblxuICAgICovXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5zdGFnaW5nTG9jay5hY3F1aXJlKCcxJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbGF0ZXN0UmVtb3RlQ29tbWl0ID0gYXdhaXQgZ2l0LnJlc29sdmVSZWYoe1xuICAgICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgICAgcmVmOiBgJHtNQUlOX1JFTU9URX0vbWFzdGVyYCxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBsb2NhbENvbW1pdHMgPSBhd2FpdCBnaXQubG9nKHtcbiAgICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICAgIGRlcHRoOiAxMDAsXG4gICAgICB9KTtcblxuICAgICAgdmFyIGNvbW1pdHMgPSBbXSBhcyBzdHJpbmdbXTtcbiAgICAgIGZvciAoY29uc3QgY29tbWl0IG9mIGxvY2FsQ29tbWl0cykge1xuICAgICAgICBpZiAoYXdhaXQgZ2l0LmlzRGVzY2VuZGVudCh7IGRpcjogdGhpcy53b3JrRGlyLCBvaWQ6IGNvbW1pdC5vaWQsIGFuY2VzdG9yOiBsYXRlc3RSZW1vdGVDb21taXQgfSkpIHtcbiAgICAgICAgICBjb21taXRzLnB1c2goY29tbWl0Lm1lc3NhZ2UpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBjb21taXRzO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkRpZCBub3QgZmluZCBhIGxvY2FsIGNvbW1pdCB0aGF0IGlzIGFuIGFuY2VzdG9yIG9mIHJlbW90ZSBtYXN0ZXJcIik7XG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgbGlzdENoYW5nZWRGaWxlcyhwYXRoU3BlY3MgPSBbJy4nXSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICAvKiBMaXN0cyByZWxhdGl2ZSBwYXRocyB0byBhbGwgZmlsZXMgdGhhdCB3ZXJlIGNoYW5nZWQgYW5kIGhhdmUgbm90IGJlZW4gY29tbWl0dGVkLiAqL1xuXG4gICAgY29uc3QgRklMRSA9IDAsIEhFQUQgPSAxLCBXT1JLRElSID0gMjtcblxuICAgIHJldHVybiAoYXdhaXQgZ2l0LnN0YXR1c01hdHJpeCh7IGRpcjogdGhpcy53b3JrRGlyLCBmaWxlcGF0aHM6IHBhdGhTcGVjcyB9KSlcbiAgICAgIC5maWx0ZXIocm93ID0+IHJvd1tIRUFEXSAhPT0gcm93W1dPUktESVJdKVxuICAgICAgLm1hcChyb3cgPT4gcm93W0ZJTEVdKVxuICAgICAgLmZpbHRlcihmaWxlcGF0aCA9PiAhZmlsZXBhdGguc3RhcnRzV2l0aCgnLi4nKSk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgc3RhZ2VBbmRDb21taXQocGF0aFNwZWNzOiBzdHJpbmdbXSwgbXNnOiBzdHJpbmcpOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIC8qIFN0YWdlcyBhbmQgY29tbWl0cyBmaWxlcyBtYXRjaGluZyBnaXZlbiBwYXRoIHNwZWMgd2l0aCBnaXZlbiBtZXNzYWdlLlxuXG4gICAgICAgQW55IG90aGVyIGZpbGVzIHN0YWdlZCBhdCB0aGUgdGltZSBvZiB0aGUgY2FsbCB3aWxsIGJlIHVuc3RhZ2VkLlxuXG4gICAgICAgUmV0dXJucyB0aGUgbnVtYmVyIG9mIG1hdGNoaW5nIGZpbGVzIHdpdGggdW5zdGFnZWQgY2hhbmdlcyBwcmlvciB0byBzdGFnaW5nLlxuICAgICAgIElmIG5vIG1hdGNoaW5nIGZpbGVzIHdlcmUgZm91bmQgaGF2aW5nIHVuc3RhZ2VkIGNoYW5nZXMsXG4gICAgICAgc2tpcHMgdGhlIHJlc3QgYW5kIHJldHVybnMgemVyby5cblxuICAgICAgIElmIGZhaWxJZkRpdmVyZ2VkIGlzIGdpdmVuLCBhdHRlbXB0cyBhIGZhc3QtZm9yd2FyZCBwdWxsIGFmdGVyIHRoZSBjb21taXQuXG4gICAgICAgSXQgd2lsbCBmYWlsIGltbWVkaWF0ZWx5IGlmIG1haW4gcmVtb3RlIGhhZCBvdGhlciBjb21taXRzIGFwcGVhciBpbiBtZWFudGltZS5cblxuICAgICAgIExvY2tzIHNvIHRoYXQgdGhpcyBtZXRob2QgY2Fubm90IGJlIHJ1biBjb25jdXJyZW50bHkgKGJ5IHNhbWUgaW5zdGFuY2UpLlxuICAgICovXG5cbiAgICBpZiAocGF0aFNwZWNzLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIldhc27igJl0IGdpdmVuIGFueSBwYXRocyB0byBjb21taXQhXCIpO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnN0YWdpbmdMb2NrLmFjcXVpcmUoJzEnLCBhc3luYyAoKSA9PiB7XG4gICAgICBsb2cudmVyYm9zZShgU1NFOiBHaXRDb250cm9sbGVyOiBTdGFnaW5nIGFuZCBjb21taXR0aW5nOiAke3BhdGhTcGVjcy5qb2luKCcsICcpfWApO1xuXG4gICAgICBjb25zdCBmaWxlc0NoYW5nZWQgPSAoYXdhaXQgdGhpcy5saXN0Q2hhbmdlZEZpbGVzKHBhdGhTcGVjcykpLmxlbmd0aDtcbiAgICAgIGlmIChmaWxlc0NoYW5nZWQgPCAxKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLnVuc3RhZ2VBbGwoKTtcbiAgICAgIGF3YWl0IHRoaXMuc3RhZ2UocGF0aFNwZWNzKTtcbiAgICAgIGF3YWl0IHRoaXMuY29tbWl0KG1zZyk7XG5cbiAgICAgIHJldHVybiBmaWxlc0NoYW5nZWQ7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHVuc3RhZ2VBbGwoKSB7XG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IFVuc3RhZ2luZyBhbGwgY2hhbmdlc1wiKTtcbiAgICBhd2FpdCBnaXQucmVtb3ZlKHsgZGlyOiB0aGlzLndvcmtEaXIsIGZpbGVwYXRoOiAnLicgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIF9oYW5kbGVHaXRFcnJvcihlOiBFcnJvciAmIHsgY29kZTogc3RyaW5nIH0pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoZS5jb2RlID09PSAnRmFzdEZvcndhcmRGYWlsJykge1xuICAgICAgLy8gTk9URTogVGhlcmXigJlzIGFsc28gUHVzaFJlamVjdGVkTm9uRmFzdEZvcndhcmQsIGJ1dCBpdCBzZWVtcyB0byBiZSB0aHJvd25cbiAgICAgIC8vIGZvciB1bnJlbGF0ZWQgY2FzZXMgZHVyaW5nIHB1c2ggKGZhbHNlIHBvc2l0aXZlKS5cbiAgICAgIC8vIEJlY2F1c2Ugb2YgdGhhdCBmYWxzZSBwb3NpdGl2ZSwgd2UgaWdub3JlIHRoYXQgZXJyb3IgYW5kIGluc3RlYWQgZG8gcHVsbCBmaXJzdCxcbiAgICAgIC8vIGNhdGNoaW5nIGFjdHVhbCBmYXN0LWZvcndhcmQgZmFpbHMgb24gdGhhdCBzdGVwIGJlZm9yZSBwdXNoLlxuICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IHN0YXR1c1JlbGF0aXZlVG9Mb2NhbDogJ2RpdmVyZ2VkJyB9KTtcbiAgICB9IGVsc2UgaWYgKFsnTWlzc2luZ1VzZXJuYW1lRXJyb3InLCAnTWlzc2luZ0F1dGhvckVycm9yJywgJ01pc3NpbmdDb21taXR0ZXJFcnJvciddLmluZGV4T2YoZS5jb2RlKSA+PSAwKSB7XG4gICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaXNNaXNjb25maWd1cmVkOiB0cnVlIH0pO1xuICAgIH0gZWxzZSBpZiAoZS5jb2RlID09PSAnTWlzc2luZ1Bhc3N3b3JkVG9rZW5FcnJvcicgfHwgKGUuY29kZSA9PT0gJ0hUVFBFcnJvcicgJiYgZS5tZXNzYWdlLmluZGV4T2YoJ1VuYXV0aG9yaXplZCcpID49IDApKSB7XG4gICAgICB0aGlzLnNldFBhc3N3b3JkKHVuZGVmaW5lZCk7XG4gICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgbmVlZHNQYXNzd29yZDogdHJ1ZSB9KTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgY2hlY2tVbmNvbW1pdHRlZCgpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAvKiBDaGVja3MgZm9yIGFueSB1bmNvbW1pdHRlZCBjaGFuZ2VzIGxvY2FsbHkgcHJlc2VudC5cbiAgICAgICBOb3RpZmllcyBhbGwgd2luZG93cyBhYm91dCB0aGUgc3RhdHVzLiAqL1xuXG4gICAgbG9nLmRlYnVnKFwiU1NFOiBHaXQ6IENoZWNraW5nIGZvciB1bmNvbW1pdHRlZCBjaGFuZ2VzXCIpO1xuICAgIGNvbnN0IGhhc1VuY29tbWl0dGVkQ2hhbmdlcyA9IChhd2FpdCB0aGlzLmxpc3RDaGFuZ2VkRmlsZXMoKSkubGVuZ3RoID4gMDtcbiAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaGFzTG9jYWxDaGFuZ2VzOiBoYXNVbmNvbW1pdHRlZENoYW5nZXMgfSk7XG4gICAgcmV0dXJuIGhhc1VuY29tbWl0dGVkQ2hhbmdlcztcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzeW5jaHJvbml6ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvKiBDaGVja3MgZm9yIGNvbm5lY3Rpb24sIGxvY2FsIGNoYW5nZXMgYW5kIHVucHVzaGVkIGNvbW1pdHMsXG4gICAgICAgdHJpZXMgdG8gcHVzaCBhbmQgcHVsbCB3aGVuIHRoZXJl4oCZcyBvcHBvcnR1bml0eS5cblxuICAgICAgIE5vdGlmaWVzIGFsbCB3aW5kb3dzIGFib3V0IHRoZSBzdGF0dXMgaW4gcHJvY2Vzcy4gKi9cblxuICAgIGNvbnN0IGlzT2ZmbGluZSA9IChhd2FpdCBjaGVja09ubGluZVN0YXR1cygpKSA9PT0gZmFsc2U7XG4gICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IGlzT2ZmbGluZSB9KTtcblxuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXQ6IFF1ZXVlaW5nIHN5bmNcIik7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc3RhZ2luZ0xvY2suYWNxdWlyZSgnMScsIGFzeW5jICgpID0+IHtcbiAgICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXQ6IFN0YXJ0aW5nIHN5bmNcIik7XG5cbiAgICAgIGlmICghaXNPZmZsaW5lKSB7XG4gICAgICAgIGNvbnN0IG5lZWRzUGFzc3dvcmQgPSB0aGlzLm5lZWRzUGFzc3dvcmQoKTtcbiAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IG5lZWRzUGFzc3dvcmQgfSk7XG5cbiAgICAgICAgaWYgKG5lZWRzUGFzc3dvcmQpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBoYXNVbmNvbW1pdHRlZENoYW5nZXMgPSBhd2FpdCB0aGlzLmNoZWNrVW5jb21taXR0ZWQoKTtcblxuICAgICAgICBpZiAoIWhhc1VuY29tbWl0dGVkQ2hhbmdlcykge1xuICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc1B1bGxpbmc6IHRydWUgfSk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucHVsbCgpO1xuICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc1B1bGxpbmc6IGZhbHNlIH0pO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5faGFuZGxlR2l0RXJyb3IoZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc1B1bGxpbmc6IGZhbHNlIH0pO1xuXG4gICAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IGlzUHVzaGluZzogdHJ1ZSB9KTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wdXNoKCk7XG4gICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgbG9nLmVycm9yKGUpO1xuICAgICAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IGlzUHVzaGluZzogZmFsc2UgfSk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9oYW5kbGVHaXRFcnJvcihlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IGlzUHVzaGluZzogZmFsc2UgfSk7XG5cbiAgICAgICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHtcbiAgICAgICAgICAgIHN0YXR1c1JlbGF0aXZlVG9Mb2NhbDogJ3VwZGF0ZWQnLFxuICAgICAgICAgICAgaXNNaXNjb25maWd1cmVkOiBmYWxzZSxcbiAgICAgICAgICAgIG5lZWRzUGFzc3dvcmQ6IGZhbHNlLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuXG4gIC8qIElQQyBlbmRwb2ludCBzZXR1cCAqL1xuXG4gIHNldFVwQVBJRW5kcG9pbnRzKCkge1xuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBTZXR0aW5nIHVwIEFQSSBlbmRwb2ludHNcIik7XG5cbiAgICBsaXN0ZW48eyBuYW1lOiBzdHJpbmcsIGVtYWlsOiBzdHJpbmcsIHVzZXJuYW1lOiBzdHJpbmcgfSwgeyBzdWNjZXNzOiB0cnVlIH0+XG4gICAgKCdnaXQtY29uZmlnLXNldCcsIGFzeW5jICh7IG5hbWUsIGVtYWlsLCB1c2VybmFtZSB9KSA9PiB7XG4gICAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogcmVjZWl2ZWQgZ2l0LWNvbmZpZy1zZXQgcmVxdWVzdFwiKTtcblxuICAgICAgYXdhaXQgdGhpcy5jb25maWdTZXQoJ3VzZXIubmFtZScsIG5hbWUpO1xuICAgICAgYXdhaXQgdGhpcy5jb25maWdTZXQoJ3VzZXIuZW1haWwnLCBlbWFpbCk7XG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ1NldCgnY3JlZGVudGlhbHMudXNlcm5hbWUnLCB1c2VybmFtZSk7XG5cbiAgICAgIHRoaXMuYXV0aC51c2VybmFtZSA9IHVzZXJuYW1lO1xuXG4gICAgICB0aGlzLnN5bmNocm9uaXplKCk7XG5cbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgICB9KTtcblxuICAgIGxpc3Rlbjx7IHBhc3N3b3JkOiBzdHJpbmcgfSwgeyBzdWNjZXNzOiB0cnVlIH0+XG4gICAgKCdnaXQtc2V0LXBhc3N3b3JkJywgYXN5bmMgKHsgcGFzc3dvcmQgfSkgPT4ge1xuICAgICAgLy8gV0FSTklORzogRG9u4oCZdCBsb2cgcGFzc3dvcmRcbiAgICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiByZWNlaXZlZCBnaXQtc2V0LXBhc3N3b3JkIHJlcXVlc3RcIik7XG5cbiAgICAgIHRoaXMuc2V0UGFzc3dvcmQocGFzc3dvcmQpO1xuICAgICAgdGhpcy5zeW5jaHJvbml6ZSgpO1xuXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gICAgfSk7XG5cbiAgICBsaXN0ZW48e30sIHsgb3JpZ2luVVJMOiBzdHJpbmcgfCBudWxsLCBuYW1lOiBzdHJpbmcgfCBudWxsLCBlbWFpbDogc3RyaW5nIHwgbnVsbCwgdXNlcm5hbWU6IHN0cmluZyB8IG51bGwgfT5cbiAgICAoJ2dpdC1jb25maWctZ2V0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IHJlY2VpdmVkIGdpdC1jb25maWcgcmVxdWVzdFwiKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG9yaWdpblVSTDogYXdhaXQgdGhpcy5nZXRPcmlnaW5VcmwoKSxcbiAgICAgICAgbmFtZTogYXdhaXQgdGhpcy5jb25maWdHZXQoJ3VzZXIubmFtZScpLFxuICAgICAgICBlbWFpbDogYXdhaXQgdGhpcy5jb25maWdHZXQoJ3VzZXIuZW1haWwnKSxcbiAgICAgICAgdXNlcm5hbWU6IGF3YWl0IHRoaXMuY29uZmlnR2V0KCdjcmVkZW50aWFscy51c2VybmFtZScpLFxuICAgICAgICAvLyBQYXNzd29yZCBtdXN0IG5vdCBiZSByZXR1cm5lZCwgb2YgY291cnNlXG4gICAgICB9O1xuICAgIH0pO1xuICB9XG59XG5cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGluaXRSZXBvKFxuICAgIHdvcmtEaXI6IHN0cmluZyxcbiAgICB1cHN0cmVhbVJlcG9Vcmw6IHN0cmluZyxcbiAgICBjb3JzUHJveHlVcmw6IHN0cmluZyxcbiAgICBmb3JjZTogYm9vbGVhbixcbiAgICBzZXR0aW5nczogU2V0dGluZ01hbmFnZXIsXG4gICAgY29uZmlnV2luZG93OiBXaW5kb3dPcGVuZXJQYXJhbXMpOiBQcm9taXNlPEdpdENvbnRyb2xsZXI+IHtcblxuICBzZXR0aW5ncy5jb25maWd1cmVQYW5lKHtcbiAgICBpZDogJ2RhdGFTeW5jJyxcbiAgICBsYWJlbDogXCJEYXRhIHN5bmNocm9uaXphdGlvblwiLFxuICAgIGljb246ICdnaXQtbWVyZ2UnLFxuICB9KTtcblxuICBzZXR0aW5ncy5yZWdpc3RlcihuZXcgU2V0dGluZzxzdHJpbmc+KFxuICAgICdnaXRSZXBvVXJsJyxcbiAgICBcIkdpdCByZXBvc2l0b3J5IFVSTFwiLFxuICAgICdkYXRhU3luYycsXG4gICkpO1xuXG4gIGNvbnN0IHJlcG9VcmwgPSAoYXdhaXQgc2V0dGluZ3MuZ2V0VmFsdWUoJ2dpdFJlcG9VcmwnKSBhcyBzdHJpbmcpIHx8IChhd2FpdCByZXF1ZXN0UmVwb1VybChjb25maWdXaW5kb3cpKTtcblxuICBjb25zdCBnaXRDdHJsID0gbmV3IEdpdENvbnRyb2xsZXIoZnMsIHJlcG9VcmwsIHVwc3RyZWFtUmVwb1VybCwgd29ya0RpciwgY29yc1Byb3h5VXJsKTtcblxuICBsZXQgZG9Jbml0aWFsaXplOiBib29sZWFuO1xuXG4gIGlmIChmb3JjZSA9PT0gdHJ1ZSkge1xuICAgIGxvZy53YXJuKFwiU1NFOiBHaXQgaXMgYmVpbmcgZm9yY2UgcmVpbml0aWFsaXplZFwiKTtcbiAgICBkb0luaXRpYWxpemUgPSB0cnVlO1xuICB9IGVsc2UgaWYgKCEoYXdhaXQgZ2l0Q3RybC5pc0luaXRpYWxpemVkKCkpKSB7XG4gICAgbG9nLndhcm4oXCJTU0U6IEdpdCBpcyBub3QgaW5pdGlhbGl6ZWQgeWV0XCIpO1xuICAgIGRvSW5pdGlhbGl6ZSA9IHRydWU7XG4gIH0gZWxzZSBpZiAoIShhd2FpdCBnaXRDdHJsLmlzVXNpbmdSZW1vdGVVUkxzKHsgb3JpZ2luOiByZXBvVXJsLCB1cHN0cmVhbTogdXBzdHJlYW1SZXBvVXJsIH0pKSkge1xuICAgIGxvZy53YXJuKFwiU1NFOiBHaXQgaGFzIG1pc21hdGNoaW5nIHJlbW90ZSBVUkxzLCByZWluaXRpYWxpemluZ1wiKTtcbiAgICBkb0luaXRpYWxpemUgPSB0cnVlO1xuICB9IGVsc2Uge1xuICAgIGxvZy5pbmZvKFwiU1NFOiBHaXQgaXMgYWxyZWFkeSBpbml0aWFsaXplZFwiKTtcbiAgICBkb0luaXRpYWxpemUgPSBmYWxzZTtcbiAgfVxuXG4gIGlmIChkb0luaXRpYWxpemUpIHtcbiAgICBhd2FpdCBnaXRDdHJsLmZvcmNlSW5pdGlhbGl6ZSgpO1xuICB9XG5cbiAgYXdhaXQgZ2l0Q3RybC5sb2FkQXV0aCgpO1xuXG4gIHJldHVybiBnaXRDdHJsO1xufVxuXG5cbi8qIFByb21pc2VzIHRvIHJldHVybiBhbiBvYmplY3QgY29udGFpbmluZyBzdHJpbmcgd2l0aCByZXBvc2l0b3J5IFVSTFxuICAgYW5kIGEgZmxhZyBpbmRpY2F0aW5nIHdoZXRoZXIgaXTigJlzIGJlZW4gcmVzZXRcbiAgICh3aGljaCBpZiB0cnVlIHdvdWxkIGNhdXNlIGBpbml0UmVwbygpYCB0byByZWluaXRpYWxpemUgdGhlIHJlcG9zaXRvcnkpLlxuXG4gICBJZiByZXBvc2l0b3J5IFVSTCBpcyBub3QgY29uZmlndXJlZCAoZS5nLiwgb24gZmlyc3QgcnVuLCBvciBhZnRlciByZXNldClcbiAgIG9wZW5zIGEgd2luZG93IHdpdGggc3BlY2lmaWVkIG9wdGlvbnMgdG8gYXNrIHRoZSB1c2VyIHRvIHByb3ZpZGUgdGhlIHNldHRpbmcuXG4gICBUaGUgd2luZG93IGlzIGV4cGVjdGVkIHRvIGFzayB0aGUgdXNlciB0byBzcGVjaWZ5IHRoZSBVUkwgYW5kIHNlbmQgYSBgJ3NldC1zZXR0aW5nJ2BcbiAgIGV2ZW50IGZvciBgJ2dpdFJlcG9VcmwnYC4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXF1ZXN0UmVwb1VybChjb25maWdXaW5kb3c6IFdpbmRvd09wZW5lclBhcmFtcyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIHJldHVybiBuZXcgUHJvbWlzZTxzdHJpbmc+KGFzeW5jIChyZXNvbHZlLCByZWplY3QpID0+IHtcblxuICAgIGxvZy53YXJuKFwiU1NFOiBHaXRDb250cm9sbGVyOiBPcGVuIGNvbmZpZyB3aW5kb3cgdG8gY29uZmlndXJlIHJlcG8gVVJMXCIpO1xuXG4gICAgaXBjTWFpbi5vbignc2V0LXNldHRpbmcnLCBoYW5kbGVTZXR0aW5nKTtcblxuICAgIGZ1bmN0aW9uIGhhbmRsZVNldHRpbmcoZXZ0OiBhbnksIG5hbWU6IHN0cmluZywgdmFsdWU6IHN0cmluZykge1xuICAgICAgaWYgKG5hbWUgPT09ICdnaXRSZXBvVXJsJykge1xuICAgICAgICBsb2cuaW5mbyhcIlNTRTogR2l0Q29udHJvbGxlcjogcmVjZWl2ZWQgZ2l0UmVwb1VybCBzZXR0aW5nXCIpO1xuICAgICAgICBpcGNNYWluLnJlbW92ZUxpc3RlbmVyKCdzZXQtc2V0dGluZycsIGhhbmRsZVNldHRpbmcpO1xuICAgICAgICByZXNvbHZlKHZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCBvcGVuV2luZG93KGNvbmZpZ1dpbmRvdyk7XG5cbiAgfSk7XG59XG5cblxuYXN5bmMgZnVuY3Rpb24gY2hlY2tPbmxpbmVTdGF0dXMoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGxldCBpc09mZmxpbmU6IGJvb2xlYW47XG4gIHRyeSB7XG4gICAgYXdhaXQgZG5zLnByb21pc2VzLmxvb2t1cCgnZ2l0aHViLmNvbScpO1xuICAgIGlzT2ZmbGluZSA9IGZhbHNlO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaXNPZmZsaW5lID0gdHJ1ZTtcbiAgfVxuICByZXR1cm4gIWlzT2ZmbGluZTtcbn1cblxuXG5hc3luYyBmdW5jdGlvbiBzZW5kUmVtb3RlU3RhdHVzKHVwZGF0ZTogUGFydGlhbDxSZW1vdGVTdG9yYWdlU3RhdHVzPikge1xuICBhd2FpdCBub3RpZnlBbGxXaW5kb3dzKCdyZW1vdGUtc3RvcmFnZS1zdGF0dXMnLCB1cGRhdGUpO1xufVxuIl19