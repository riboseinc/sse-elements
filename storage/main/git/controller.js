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
        this.synchronize = this.synchronize.bind(this);
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
        log.verbose("SSE: GitController: Force resetting files");
        return await this.stagingLock.acquire('1', async () => {
            return await git.fastCheckout({
                dir: this.workDir,
                force: true,
                filepaths: paths,
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
    async synchronize() {
        /* Checks for connection, local changes and unpushed commits,
           tries to push and pull when there’s opportunity. */
        log.verbose("SSE: Git: Queueing sync");
        return await this.stagingLock.acquire('1', async () => {
            log.verbose("SSE: Git: Starting sync");
            const isOffline = (await checkOnlineStatus()) === false;
            await sendRemoteStatus({ isOffline });
            const hasUncommittedChanges = (await this.listChangedFiles()).length > 0;
            await sendRemoteStatus({ hasLocalChanges: hasUncommittedChanges });
            if (!isOffline) {
                const needsPassword = this.needsPassword();
                await sendRemoteStatus({ needsPassword });
                if (needsPassword) {
                    return;
                }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zdG9yYWdlL21haW4vZ2l0L2NvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxLQUFLLEdBQUcsTUFBTSxLQUFLLENBQUM7QUFDM0IsT0FBTyxLQUFLLElBQUksTUFBTSxNQUFNLENBQUM7QUFDN0IsT0FBTyxLQUFLLEVBQUUsTUFBTSxVQUFVLENBQUM7QUFDL0IsT0FBTyxTQUFTLE1BQU0sWUFBWSxDQUFDO0FBQ25DLE9BQU8sS0FBSyxHQUFHLE1BQU0sZ0JBQWdCLENBQUM7QUFDdEMsT0FBTyxLQUFLLEdBQUcsTUFBTSxjQUFjLENBQUM7QUFFcEMsT0FBTyxFQUFFLE9BQU8sRUFBRSxNQUFNLFVBQVUsQ0FBQztBQUVuQyxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFDM0MsT0FBTyxFQUFFLE9BQU8sRUFBa0IsTUFBTSx3QkFBd0IsQ0FBQztBQUNqRSxPQUFPLEVBQUUsZ0JBQWdCLEVBQXNCLFVBQVUsRUFBRSxNQUFNLHNCQUFzQixDQUFDO0FBT3hGLE1BQU0sZUFBZSxHQUFHLFVBQVUsQ0FBQztBQUNuQyxNQUFNLFdBQVcsR0FBRyxRQUFRLENBQUM7QUFHN0IsTUFBTSxPQUFPLGFBQWE7SUFNeEIsWUFDWSxFQUFPLEVBQ1AsT0FBZSxFQUNmLGVBQXVCLEVBQ3hCLE9BQWUsRUFDZCxTQUFpQjtRQUpqQixPQUFFLEdBQUYsRUFBRSxDQUFLO1FBQ1AsWUFBTyxHQUFQLE9BQU8sQ0FBUTtRQUNmLG9CQUFlLEdBQWYsZUFBZSxDQUFRO1FBQ3hCLFlBQU8sR0FBUCxPQUFPLENBQVE7UUFDZCxjQUFTLEdBQVQsU0FBUyxDQUFRO1FBVHJCLFNBQUksR0FBc0IsRUFBRSxDQUFDO1FBV25DLEdBQUcsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQztRQUUxQixJQUFJ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SUFBSSxLQUFLLFlBQVksRUFBRTtnQkFDekIsR0FBRyxDQUFDLElBQUksQ0FBQyxpREFBaUQsQ0FBQyxDQUFDO2dCQUM1RCxPQUFPLENBQUMsY0FBYyxDQUFDLGFBQWEsRUFBRSxhQUFhLENBQUMsQ0FBQztnQkFDckQsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO2FBQ2hCO1FBQ0gsQ0FBQztRQUVELE1BQU0sVUFBVSxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBRWpDLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQztBQUdELEtBQUssVUFBVSxpQkFBaUI7SUFDOUIsSUFBSSxTQUFrQixDQUFDO0lBQ3ZCLElBQUk7UUFDRixNQUFNLEdBQUcsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ3hDLFNBQVMsR0FBRyxLQUFLLENBQUM7S0FDbkI7SUFBQyxPQUFPLENBQUMsRUFBRTtRQUNWLFNBQVMsR0FBRyxJQUFJLENBQUM7S0FDbEI7SUFDRCxPQUFPLENBQUMsU0FBUyxDQUFDO0FBQ3BCLENBQUM7QUFHRCxLQUFLLFVBQVUsZ0JBQWdCLENBQUMsTUFBb0M7SUFDbEUsTUFBTSxnQkFBZ0IsQ0FBQyx1QkFBdUIsRUFBRSxNQUFNLENBQUMsQ0FBQztBQUMxRCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgZG5zIGZyb20gJ2Rucyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMtZXh0cmEnO1xuaW1wb3J0IEFzeW5jTG9jayBmcm9tICdhc3luYy1sb2NrJztcbmltcG9ydCAqIGFzIGdpdCBmcm9tICdpc29tb3JwaGljLWdpdCc7XG5pbXBvcnQgKiBhcyBsb2cgZnJvbSAnZWxlY3Ryb24tbG9nJztcblxuaW1wb3J0IHsgaXBjTWFpbiB9IGZyb20gJ2VsZWN0cm9uJztcblxuaW1wb3J0IHsgbGlzdGVuIH0gZnJvbSAnLi4vLi4vLi4vYXBpL21haW4nO1xuaW1wb3J0IHsgU2V0dGluZywgU2V0dGluZ01hbmFnZXIgfSBmcm9tICcuLi8uLi8uLi9zZXR0aW5ncy9tYWluJztcbmltcG9ydCB7IG5vdGlmeUFsbFdpbmRvd3MsIFdpbmRvd09wZW5lclBhcmFtcywgb3BlbldpbmRvdyB9IGZyb20gJy4uLy4uLy4uL21haW4vd2luZG93JztcblxuaW1wb3J0IHsgUmVtb3RlU3RvcmFnZVN0YXR1cyB9IGZyb20gJy4uL3JlbW90ZSc7XG5cbmltcG9ydCB7IEdpdEF1dGhlbnRpY2F0aW9uIH0gZnJvbSAnLi90eXBlcyc7XG5cblxuY29uc3QgVVBTVFJFQU1fUkVNT1RFID0gJ3Vwc3RyZWFtJztcbmNvbnN0IE1BSU5fUkVNT1RFID0gJ29yaWdpbic7XG5cblxuZXhwb3J0IGNsYXNzIEdpdENvbnRyb2xsZXIge1xuXG4gIHByaXZhdGUgYXV0aDogR2l0QXV0aGVudGljYXRpb24gPSB7fTtcblxuICBwcml2YXRlIHN0YWdpbmdMb2NrOiBBc3luY0xvY2s7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgICBwcml2YXRlIGZzOiBhbnksXG4gICAgICBwcml2YXRlIHJlcG9Vcmw6IHN0cmluZyxcbiAgICAgIHByaXZhdGUgdXBzdHJlYW1SZXBvVXJsOiBzdHJpbmcsXG4gICAgICBwdWJsaWMgd29ya0Rpcjogc3RyaW5nLFxuICAgICAgcHJpdmF0ZSBjb3JzUHJveHk6IHN0cmluZykge1xuXG4gICAgZ2l0LnBsdWdpbnMuc2V0KCdmcycsIGZzKTtcblxuICAgIHRoaXMuc3RhZ2luZ0xvY2sgPSBuZXcgQXN5bmNMb2NrKHsgdGltZW91dDogMjAwMDAsIG1heFBlbmRpbmc6IDEwIH0pO1xuXG4gICAgdGhpcy5zeW5jaHJvbml6ZSA9IHRoaXMuc3luY2hyb25pemUuYmluZCh0aGlzKTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBpc0luaXRpYWxpemVkKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGxldCBoYXNHaXREaXJlY3Rvcnk6IGJvb2xlYW47XG4gICAgdHJ5IHtcbiAgICAgIGhhc0dpdERpcmVjdG9yeSA9IChhd2FpdCB0aGlzLmZzLnN0YXQocGF0aC5qb2luKHRoaXMud29ya0RpciwgJy5naXQnKSkpLmlzRGlyZWN0b3J5KCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgaGFzR2l0RGlyZWN0b3J5ID0gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiBoYXNHaXREaXJlY3Rvcnk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgaXNVc2luZ1JlbW90ZVVSTHMocmVtb3RlVXJsczogeyBvcmlnaW46IHN0cmluZywgdXBzdHJlYW06IHN0cmluZyB9KTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3Qgb3JpZ2luID0gKGF3YWl0IHRoaXMuZ2V0T3JpZ2luVXJsKCkgfHwgJycpLnRyaW0oKTtcbiAgICBjb25zdCB1cHN0cmVhbSA9IChhd2FpdCB0aGlzLmdldFVwc3RyZWFtVXJsKCkgfHwgJycpLnRyaW0oKTtcbiAgICByZXR1cm4gb3JpZ2luID09PSByZW1vdGVVcmxzLm9yaWdpbiAmJiB1cHN0cmVhbSA9PT0gcmVtb3RlVXJscy51cHN0cmVhbTtcbiAgfVxuXG4gIHB1YmxpYyBuZWVkc1Bhc3N3b3JkKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiAodGhpcy5hdXRoLnBhc3N3b3JkIHx8ICcnKS50cmltKCkgPT09ICcnO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGZvcmNlSW5pdGlhbGl6ZSgpIHtcbiAgICAvKiBJbml0aWFsaXplcyBmcm9tIHNjcmF0Y2g6IHdpcGVzIHdvcmsgZGlyZWN0b3J5LCBjbG9uZXMgYWdhaW4sIGFkZHMgcmVtb3Rlcy4gKi9cblxuICAgIGxvZy53YXJuKFwiU1NFOiBHaXRDb250cm9sbGVyOiBGb3JjZSBpbml0aWFsaXppbmdcIik7XG4gICAgbG9nLndhcm4oXCJTU0U6IEdpdENvbnRyb2xsZXI6IEluaXRpYWxpemU6IFJlbW92aW5nIGRhdGEgZGlyZWN0b3J5XCIpO1xuXG4gICAgYXdhaXQgdGhpcy5mcy5yZW1vdmUodGhpcy53b3JrRGlyKTtcblxuICAgIGxvZy5zaWxseShcIlNTRTogR2l0Q29udHJvbGxlcjogSW5pdGlhbGl6ZTogRW5zdXJpbmcgZGF0YSBkaXJlY3RvcnkgZXhpc3RzXCIpO1xuXG4gICAgYXdhaXQgdGhpcy5mcy5lbnN1cmVEaXIodGhpcy53b3JrRGlyKTtcblxuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBJbml0aWFsaXplOiBDbG9uaW5nXCIsIHRoaXMucmVwb1VybCk7XG5cbiAgICBhd2FpdCBnaXQuY2xvbmUoe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICB1cmw6IHRoaXMucmVwb1VybCxcbiAgICAgIHJlZjogJ21hc3RlcicsXG4gICAgICBzaW5nbGVCcmFuY2g6IHRydWUsXG4gICAgICBkZXB0aDogNSxcbiAgICAgIGNvcnNQcm94eTogdGhpcy5jb3JzUHJveHksXG4gICAgICAuLi50aGlzLmF1dGgsXG4gICAgfSk7XG5cbiAgICBhd2FpdCBnaXQuYWRkUmVtb3RlKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgcmVtb3RlOiBVUFNUUkVBTV9SRU1PVEUsXG4gICAgICB1cmw6IHRoaXMudXBzdHJlYW1SZXBvVXJsLFxuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGNvbmZpZ1NldChwcm9wOiBzdHJpbmcsIHZhbDogc3RyaW5nKSB7XG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IFNldCBjb25maWdcIik7XG4gICAgYXdhaXQgZ2l0LmNvbmZpZyh7IGRpcjogdGhpcy53b3JrRGlyLCBwYXRoOiBwcm9wLCB2YWx1ZTogdmFsIH0pO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGNvbmZpZ0dldChwcm9wOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBHZXQgY29uZmlnXCIsIHByb3ApO1xuICAgIHJldHVybiBhd2FpdCBnaXQuY29uZmlnKHsgZGlyOiB0aGlzLndvcmtEaXIsIHBhdGg6IHByb3AgfSk7XG4gIH1cblxuICBwdWJsaWMgc2V0UGFzc3dvcmQodmFsdWU6IHN0cmluZyB8IHVuZGVmaW5lZCkge1xuICAgIHRoaXMuYXV0aC5wYXNzd29yZCA9IHZhbHVlO1xuICB9XG5cbiAgYXN5bmMgbG9hZEF1dGgoKSB7XG4gICAgLyogQ29uZmlndXJlIGF1dGggd2l0aCBnaXQtY29uZmlnIHVzZXJuYW1lLCBpZiBzZXQuXG4gICAgICAgU3VwcG9zZWQgdG8gYmUgaGFwcGVuaW5nIGF1dG9tYXRpY2FsbHk/IE1heWJlIG5vdC5cbiAgICAgICBUaGlzIG1ldGhvZCBtdXN0IGJlIG1hbnVhbGx5IGNhbGxlZCBiZWZvcmUgbWFraW5nIG9wZXJhdGlvbnMgdGhhdCBuZWVkIGF1dGguICovXG4gICAgY29uc3QgdXNlcm5hbWUgPSBhd2FpdCB0aGlzLmNvbmZpZ0dldCgnY3JlZGVudGlhbHMudXNlcm5hbWUnKTtcbiAgICBpZiAodXNlcm5hbWUpIHtcbiAgICAgIHRoaXMuYXV0aC51c2VybmFtZSA9IHVzZXJuYW1lO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHB1bGwoKSB7XG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IFB1bGxpbmcgbWFzdGVyIHdpdGggZmFzdC1mb3J3YXJkIG1lcmdlXCIpO1xuXG4gICAgcmV0dXJuIGF3YWl0IGdpdC5wdWxsKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgc2luZ2xlQnJhbmNoOiB0cnVlLFxuICAgICAgZmFzdEZvcndhcmRPbmx5OiB0cnVlLFxuICAgICAgZmFzdDogdHJ1ZSxcbiAgICAgIC4uLnRoaXMuYXV0aCxcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIHN0YWdlKHBhdGhTcGVjczogc3RyaW5nW10pIHtcbiAgICBsb2cudmVyYm9zZShgU1NFOiBHaXRDb250cm9sbGVyOiBBZGRpbmcgY2hhbmdlczogJHtwYXRoU3BlY3Muam9pbignLCAnKX1gKTtcblxuICAgIGZvciAoY29uc3QgcGF0aFNwZWMgb2YgcGF0aFNwZWNzKSB7XG4gICAgICBhd2FpdCBnaXQuYWRkKHtcbiAgICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICAgIGZpbGVwYXRoOiBwYXRoU3BlYyxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGNvbW1pdChtc2c6IHN0cmluZykge1xuICAgIGxvZy52ZXJib3NlKGBTU0U6IEdpdENvbnRyb2xsZXI6IENvbW1pdHRpbmcgd2l0aCBtZXNzYWdlICR7bXNnfWApO1xuXG4gICAgcmV0dXJuIGF3YWl0IGdpdC5jb21taXQoe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICBtZXNzYWdlOiBtc2csXG4gICAgICBhdXRob3I6IHt9LCAgLy8gZ2l0LWNvbmZpZyB2YWx1ZXMgd2lsbCBiZSB1c2VkXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBmZXRjaFJlbW90ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBnaXQuZmV0Y2goeyBkaXI6IHRoaXMud29ya0RpciwgcmVtb3RlOiBNQUlOX1JFTU9URSwgLi4udGhpcy5hdXRoIH0pO1xuICB9XG5cbiAgYXN5bmMgZmV0Y2hVcHN0cmVhbSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBnaXQuZmV0Y2goeyBkaXI6IHRoaXMud29ya0RpciwgcmVtb3RlOiBVUFNUUkVBTV9SRU1PVEUsIC4uLnRoaXMuYXV0aCB9KTtcbiAgfVxuXG4gIGFzeW5jIHB1c2goZm9yY2UgPSBmYWxzZSkge1xuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBQdXNoaW5nXCIpO1xuXG4gICAgcmV0dXJuIGF3YWl0IGdpdC5wdXNoKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgcmVtb3RlOiBNQUlOX1JFTU9URSxcbiAgICAgIGZvcmNlOiBmb3JjZSxcbiAgICAgIC4uLnRoaXMuYXV0aCxcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIHJlc2V0RmlsZXMocGF0aHM6IHN0cmluZ1tdKSB7XG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IEZvcmNlIHJlc2V0dGluZyBmaWxlc1wiKTtcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnN0YWdpbmdMb2NrLmFjcXVpcmUoJzEnLCBhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgZ2l0LmZhc3RDaGVja291dCh7XG4gICAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgICBmb3JjZTogdHJ1ZSxcbiAgICAgICAgZmlsZXBhdGhzOiBwYXRocyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgZ2V0T3JpZ2luVXJsKCk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIHJldHVybiAoKGF3YWl0IGdpdC5saXN0UmVtb3Rlcyh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICB9KSkuZmluZChyID0+IHIucmVtb3RlID09PSBNQUlOX1JFTU9URSkgfHwgeyB1cmw6IG51bGwgfSkudXJsO1xuICB9XG5cbiAgYXN5bmMgZ2V0VXBzdHJlYW1VcmwoKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gICAgcmV0dXJuICgoYXdhaXQgZ2l0Lmxpc3RSZW1vdGVzKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgIH0pKS5maW5kKHIgPT4gci5yZW1vdGUgPT09IFVQU1RSRUFNX1JFTU9URSkgfHwgeyB1cmw6IG51bGwgfSkudXJsO1xuICB9XG5cbiAgYXN5bmMgbGlzdExvY2FsQ29tbWl0cygpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgLyogUmV0dXJucyBhIGxpc3Qgb2YgY29tbWl0IG1lc3NhZ2VzIGZvciBjb21taXRzIHRoYXQgd2VyZSBub3QgcHVzaGVkIHlldC5cblxuICAgICAgIFVzZWZ1bCB0byBjaGVjayB3aGljaCBjb21taXRzIHdpbGwgYmUgdGhyb3duIG91dFxuICAgICAgIGlmIHdlIGZvcmNlIHVwZGF0ZSB0byByZW1vdGUgbWFzdGVyLlxuXG4gICAgICAgRG9lcyBzbyBieSB3YWxraW5nIHRocm91Z2ggbGFzdCAxMDAgY29tbWl0cyBzdGFydGluZyBmcm9tIGN1cnJlbnQgSEVBRC5cbiAgICAgICBXaGVuIGl0IGVuY291bnRlcnMgdGhlIGZpcnN0IGxvY2FsIGNvbW1pdCB0aGF0IGRvZXNu4oCZdCBkZXNjZW5kcyBmcm9tIHJlbW90ZSBtYXN0ZXIgSEVBRCxcbiAgICAgICBpdCBjb25zaWRlcnMgYWxsIHByZWNlZGluZyBjb21taXRzIHRvIGJlIGFoZWFkL2xvY2FsIGFuZCByZXR1cm5zIHRoZW0uXG5cbiAgICAgICBJZiBpdCBmaW5pc2hlcyB0aGUgd2FsayB3aXRob3V0IGZpbmRpbmcgYW4gYW5jZXN0b3IsIHRocm93cyBhbiBlcnJvci5cbiAgICAgICBJdCBpcyBhc3N1bWVkIHRoYXQgdGhlIGFwcCBkb2VzIG5vdCBhbGxvdyB0byBhY2N1bXVsYXRlXG4gICAgICAgbW9yZSB0aGFuIDEwMCBjb21taXRzIHdpdGhvdXQgcHVzaGluZyAoZXZlbiAxMDAgaXMgdG9vIG1hbnkhKSxcbiAgICAgICBzbyB0aGVyZeKAmXMgcHJvYmFibHkgc29tZXRoaW5nIHN0cmFuZ2UgZ29pbmcgb24uXG5cbiAgICAgICBPdGhlciBhc3N1bXB0aW9uczpcblxuICAgICAgICogZ2l0LmxvZyByZXR1cm5zIGNvbW1pdHMgZnJvbSBuZXdlc3QgdG8gb2xkZXN0LlxuICAgICAgICogVGhlIHJlbW90ZSB3YXMgYWxyZWFkeSBmZXRjaGVkLlxuXG4gICAgKi9cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnN0YWdpbmdMb2NrLmFjcXVpcmUoJzEnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBsYXRlc3RSZW1vdGVDb21taXQgPSBhd2FpdCBnaXQucmVzb2x2ZVJlZih7XG4gICAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgICByZWY6IGAke01BSU5fUkVNT1RFfS9tYXN0ZXJgLFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGxvY2FsQ29tbWl0cyA9IGF3YWl0IGdpdC5sb2coe1xuICAgICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgICAgZGVwdGg6IDEwMCxcbiAgICAgIH0pO1xuXG4gICAgICB2YXIgY29tbWl0cyA9IFtdIGFzIHN0cmluZ1tdO1xuICAgICAgZm9yIChjb25zdCBjb21taXQgb2YgbG9jYWxDb21taXRzKSB7XG4gICAgICAgIGlmIChhd2FpdCBnaXQuaXNEZXNjZW5kZW50KHsgZGlyOiB0aGlzLndvcmtEaXIsIG9pZDogY29tbWl0Lm9pZCwgYW5jZXN0b3I6IGxhdGVzdFJlbW90ZUNvbW1pdCB9KSkge1xuICAgICAgICAgIGNvbW1pdHMucHVzaChjb21taXQubWVzc2FnZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIGNvbW1pdHM7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRGlkIG5vdCBmaW5kIGEgbG9jYWwgY29tbWl0IHRoYXQgaXMgYW4gYW5jZXN0b3Igb2YgcmVtb3RlIG1hc3RlclwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBsaXN0Q2hhbmdlZEZpbGVzKHBhdGhTcGVjcyA9IFsnLiddKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAgIC8qIExpc3RzIHJlbGF0aXZlIHBhdGhzIHRvIGFsbCBmaWxlcyB0aGF0IHdlcmUgY2hhbmdlZCBhbmQgaGF2ZSBub3QgYmVlbiBjb21taXR0ZWQuICovXG5cbiAgICBjb25zdCBGSUxFID0gMCwgSEVBRCA9IDEsIFdPUktESVIgPSAyO1xuXG4gICAgcmV0dXJuIChhd2FpdCBnaXQuc3RhdHVzTWF0cml4KHsgZGlyOiB0aGlzLndvcmtEaXIsIGZpbGVwYXRoczogcGF0aFNwZWNzIH0pKVxuICAgICAgLmZpbHRlcihyb3cgPT4gcm93W0hFQURdICE9PSByb3dbV09SS0RJUl0pXG4gICAgICAubWFwKHJvdyA9PiByb3dbRklMRV0pXG4gICAgICAuZmlsdGVyKGZpbGVwYXRoID0+ICFmaWxlcGF0aC5zdGFydHNXaXRoKCcuLicpKTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzdGFnZUFuZENvbW1pdChwYXRoU3BlY3M6IHN0cmluZ1tdLCBtc2c6IHN0cmluZyk6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgLyogU3RhZ2VzIGFuZCBjb21taXRzIGZpbGVzIG1hdGNoaW5nIGdpdmVuIHBhdGggc3BlYyB3aXRoIGdpdmVuIG1lc3NhZ2UuXG5cbiAgICAgICBBbnkgb3RoZXIgZmlsZXMgc3RhZ2VkIGF0IHRoZSB0aW1lIG9mIHRoZSBjYWxsIHdpbGwgYmUgdW5zdGFnZWQuXG5cbiAgICAgICBSZXR1cm5zIHRoZSBudW1iZXIgb2YgbWF0Y2hpbmcgZmlsZXMgd2l0aCB1bnN0YWdlZCBjaGFuZ2VzIHByaW9yIHRvIHN0YWdpbmcuXG4gICAgICAgSWYgbm8gbWF0Y2hpbmcgZmlsZXMgd2VyZSBmb3VuZCBoYXZpbmcgdW5zdGFnZWQgY2hhbmdlcyxcbiAgICAgICBza2lwcyB0aGUgcmVzdCBhbmQgcmV0dXJucyB6ZXJvLlxuXG4gICAgICAgSWYgZmFpbElmRGl2ZXJnZWQgaXMgZ2l2ZW4sIGF0dGVtcHRzIGEgZmFzdC1mb3J3YXJkIHB1bGwgYWZ0ZXIgdGhlIGNvbW1pdC5cbiAgICAgICBJdCB3aWxsIGZhaWwgaW1tZWRpYXRlbHkgaWYgbWFpbiByZW1vdGUgaGFkIG90aGVyIGNvbW1pdHMgYXBwZWFyIGluIG1lYW50aW1lLlxuXG4gICAgICAgTG9ja3Mgc28gdGhhdCB0aGlzIG1ldGhvZCBjYW5ub3QgYmUgcnVuIGNvbmN1cnJlbnRseSAoYnkgc2FtZSBpbnN0YW5jZSkuXG4gICAgKi9cblxuICAgIGlmIChwYXRoU3BlY3MubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiV2FzbuKAmXQgZ2l2ZW4gYW55IHBhdGhzIHRvIGNvbW1pdCFcIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc3RhZ2luZ0xvY2suYWNxdWlyZSgnMScsIGFzeW5jICgpID0+IHtcbiAgICAgIGxvZy52ZXJib3NlKGBTU0U6IEdpdENvbnRyb2xsZXI6IFN0YWdpbmcgYW5kIGNvbW1pdHRpbmc6ICR7cGF0aFNwZWNzLmpvaW4oJywgJyl9YCk7XG5cbiAgICAgIGNvbnN0IGZpbGVzQ2hhbmdlZCA9IChhd2FpdCB0aGlzLmxpc3RDaGFuZ2VkRmlsZXMocGF0aFNwZWNzKSkubGVuZ3RoO1xuICAgICAgaWYgKGZpbGVzQ2hhbmdlZCA8IDEpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMudW5zdGFnZUFsbCgpO1xuICAgICAgYXdhaXQgdGhpcy5zdGFnZShwYXRoU3BlY3MpO1xuICAgICAgYXdhaXQgdGhpcy5jb21taXQobXNnKTtcblxuICAgICAgcmV0dXJuIGZpbGVzQ2hhbmdlZDtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgdW5zdGFnZUFsbCgpIHtcbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogVW5zdGFnaW5nIGFsbCBjaGFuZ2VzXCIpO1xuICAgIGF3YWl0IGdpdC5yZW1vdmUoeyBkaXI6IHRoaXMud29ya0RpciwgZmlsZXBhdGg6ICcuJyB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgX2hhbmRsZUdpdEVycm9yKGU6IEVycm9yICYgeyBjb2RlOiBzdHJpbmcgfSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChlLmNvZGUgPT09ICdGYXN0Rm9yd2FyZEZhaWwnKSB7XG4gICAgICAvLyBOT1RFOiBUaGVyZeKAmXMgYWxzbyBQdXNoUmVqZWN0ZWROb25GYXN0Rm9yd2FyZCwgYnV0IGl0IHNlZW1zIHRvIGJlIHRocm93blxuICAgICAgLy8gZm9yIHVucmVsYXRlZCBjYXNlcyBkdXJpbmcgcHVzaCAoZmFsc2UgcG9zaXRpdmUpLlxuICAgICAgLy8gQmVjYXVzZSBvZiB0aGF0IGZhbHNlIHBvc2l0aXZlLCB3ZSBpZ25vcmUgdGhhdCBlcnJvciBhbmQgaW5zdGVhZCBkbyBwdWxsIGZpcnN0LFxuICAgICAgLy8gY2F0Y2hpbmcgYWN0dWFsIGZhc3QtZm9yd2FyZCBmYWlscyBvbiB0aGF0IHN0ZXAgYmVmb3JlIHB1c2guXG4gICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgc3RhdHVzUmVsYXRpdmVUb0xvY2FsOiAnZGl2ZXJnZWQnIH0pO1xuICAgIH0gZWxzZSBpZiAoWydNaXNzaW5nVXNlcm5hbWVFcnJvcicsICdNaXNzaW5nQXV0aG9yRXJyb3InLCAnTWlzc2luZ0NvbW1pdHRlckVycm9yJ10uaW5kZXhPZihlLmNvZGUpID49IDApIHtcbiAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc01pc2NvbmZpZ3VyZWQ6IHRydWUgfSk7XG4gICAgfSBlbHNlIGlmIChlLmNvZGUgPT09ICdNaXNzaW5nUGFzc3dvcmRUb2tlbkVycm9yJyB8fCAoZS5jb2RlID09PSAnSFRUUEVycm9yJyAmJiBlLm1lc3NhZ2UuaW5kZXhPZignVW5hdXRob3JpemVkJykgPj0gMCkpIHtcbiAgICAgIHRoaXMuc2V0UGFzc3dvcmQodW5kZWZpbmVkKTtcbiAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBuZWVkc1Bhc3N3b3JkOiB0cnVlIH0pO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzeW5jaHJvbml6ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvKiBDaGVja3MgZm9yIGNvbm5lY3Rpb24sIGxvY2FsIGNoYW5nZXMgYW5kIHVucHVzaGVkIGNvbW1pdHMsXG4gICAgICAgdHJpZXMgdG8gcHVzaCBhbmQgcHVsbCB3aGVuIHRoZXJl4oCZcyBvcHBvcnR1bml0eS4gKi9cblxuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXQ6IFF1ZXVlaW5nIHN5bmNcIik7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc3RhZ2luZ0xvY2suYWNxdWlyZSgnMScsIGFzeW5jICgpID0+IHtcbiAgICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXQ6IFN0YXJ0aW5nIHN5bmNcIik7XG5cbiAgICAgIGNvbnN0IGlzT2ZmbGluZSA9IChhd2FpdCBjaGVja09ubGluZVN0YXR1cygpKSA9PT0gZmFsc2U7XG4gICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaXNPZmZsaW5lIH0pO1xuXG4gICAgICBjb25zdCBoYXNVbmNvbW1pdHRlZENoYW5nZXMgPSAoYXdhaXQgdGhpcy5saXN0Q2hhbmdlZEZpbGVzKCkpLmxlbmd0aCA+IDA7XG4gICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaGFzTG9jYWxDaGFuZ2VzOiBoYXNVbmNvbW1pdHRlZENoYW5nZXMgfSk7XG5cbiAgICAgIGlmICghaXNPZmZsaW5lKSB7XG4gICAgICAgIGNvbnN0IG5lZWRzUGFzc3dvcmQgPSB0aGlzLm5lZWRzUGFzc3dvcmQoKTtcbiAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IG5lZWRzUGFzc3dvcmQgfSk7XG5cbiAgICAgICAgaWYgKG5lZWRzUGFzc3dvcmQpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWhhc1VuY29tbWl0dGVkQ2hhbmdlcykge1xuICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc1B1bGxpbmc6IHRydWUgfSk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucHVsbCgpO1xuICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc1B1bGxpbmc6IGZhbHNlIH0pO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5faGFuZGxlR2l0RXJyb3IoZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc1B1bGxpbmc6IGZhbHNlIH0pO1xuXG4gICAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IGlzUHVzaGluZzogdHJ1ZSB9KTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wdXNoKCk7XG4gICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgbG9nLmVycm9yKGUpO1xuICAgICAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IGlzUHVzaGluZzogZmFsc2UgfSk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9oYW5kbGVHaXRFcnJvcihlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IGlzUHVzaGluZzogZmFsc2UgfSk7XG5cbiAgICAgICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHtcbiAgICAgICAgICAgIHN0YXR1c1JlbGF0aXZlVG9Mb2NhbDogJ3VwZGF0ZWQnLFxuICAgICAgICAgICAgaXNNaXNjb25maWd1cmVkOiBmYWxzZSxcbiAgICAgICAgICAgIG5lZWRzUGFzc3dvcmQ6IGZhbHNlLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuXG4gIC8qIElQQyBlbmRwb2ludCBzZXR1cCAqL1xuXG4gIHNldFVwQVBJRW5kcG9pbnRzKCkge1xuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBTZXR0aW5nIHVwIEFQSSBlbmRwb2ludHNcIik7XG5cbiAgICBsaXN0ZW48eyBuYW1lOiBzdHJpbmcsIGVtYWlsOiBzdHJpbmcsIHVzZXJuYW1lOiBzdHJpbmcgfSwgeyBzdWNjZXNzOiB0cnVlIH0+XG4gICAgKCdnaXQtY29uZmlnLXNldCcsIGFzeW5jICh7IG5hbWUsIGVtYWlsLCB1c2VybmFtZSB9KSA9PiB7XG4gICAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogcmVjZWl2ZWQgZ2l0LWNvbmZpZy1zZXQgcmVxdWVzdFwiKTtcblxuICAgICAgYXdhaXQgdGhpcy5jb25maWdTZXQoJ3VzZXIubmFtZScsIG5hbWUpO1xuICAgICAgYXdhaXQgdGhpcy5jb25maWdTZXQoJ3VzZXIuZW1haWwnLCBlbWFpbCk7XG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ1NldCgnY3JlZGVudGlhbHMudXNlcm5hbWUnLCB1c2VybmFtZSk7XG5cbiAgICAgIHRoaXMuYXV0aC51c2VybmFtZSA9IHVzZXJuYW1lO1xuXG4gICAgICB0aGlzLnN5bmNocm9uaXplKCk7XG5cbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgICB9KTtcblxuICAgIGxpc3Rlbjx7IHBhc3N3b3JkOiBzdHJpbmcgfSwgeyBzdWNjZXNzOiB0cnVlIH0+XG4gICAgKCdnaXQtc2V0LXBhc3N3b3JkJywgYXN5bmMgKHsgcGFzc3dvcmQgfSkgPT4ge1xuICAgICAgLy8gV0FSTklORzogRG9u4oCZdCBsb2cgcGFzc3dvcmRcbiAgICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiByZWNlaXZlZCBnaXQtc2V0LXBhc3N3b3JkIHJlcXVlc3RcIik7XG5cbiAgICAgIHRoaXMuc2V0UGFzc3dvcmQocGFzc3dvcmQpO1xuICAgICAgdGhpcy5zeW5jaHJvbml6ZSgpO1xuXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gICAgfSk7XG5cbiAgICBsaXN0ZW48e30sIHsgb3JpZ2luVVJMOiBzdHJpbmcgfCBudWxsLCBuYW1lOiBzdHJpbmcgfCBudWxsLCBlbWFpbDogc3RyaW5nIHwgbnVsbCwgdXNlcm5hbWU6IHN0cmluZyB8IG51bGwgfT5cbiAgICAoJ2dpdC1jb25maWctZ2V0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IHJlY2VpdmVkIGdpdC1jb25maWcgcmVxdWVzdFwiKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG9yaWdpblVSTDogYXdhaXQgdGhpcy5nZXRPcmlnaW5VcmwoKSxcbiAgICAgICAgbmFtZTogYXdhaXQgdGhpcy5jb25maWdHZXQoJ3VzZXIubmFtZScpLFxuICAgICAgICBlbWFpbDogYXdhaXQgdGhpcy5jb25maWdHZXQoJ3VzZXIuZW1haWwnKSxcbiAgICAgICAgdXNlcm5hbWU6IGF3YWl0IHRoaXMuY29uZmlnR2V0KCdjcmVkZW50aWFscy51c2VybmFtZScpLFxuICAgICAgICAvLyBQYXNzd29yZCBtdXN0IG5vdCBiZSByZXR1cm5lZCwgb2YgY291cnNlXG4gICAgICB9O1xuICAgIH0pO1xuICB9XG59XG5cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGluaXRSZXBvKFxuICAgIHdvcmtEaXI6IHN0cmluZyxcbiAgICB1cHN0cmVhbVJlcG9Vcmw6IHN0cmluZyxcbiAgICBjb3JzUHJveHlVcmw6IHN0cmluZyxcbiAgICBmb3JjZTogYm9vbGVhbixcbiAgICBzZXR0aW5nczogU2V0dGluZ01hbmFnZXIsXG4gICAgY29uZmlnV2luZG93OiBXaW5kb3dPcGVuZXJQYXJhbXMpOiBQcm9taXNlPEdpdENvbnRyb2xsZXI+IHtcblxuICBzZXR0aW5ncy5jb25maWd1cmVQYW5lKHtcbiAgICBpZDogJ2RhdGFTeW5jJyxcbiAgICBsYWJlbDogXCJEYXRhIHN5bmNocm9uaXphdGlvblwiLFxuICAgIGljb246ICdnaXQtbWVyZ2UnLFxuICB9KTtcblxuICBzZXR0aW5ncy5yZWdpc3RlcihuZXcgU2V0dGluZzxzdHJpbmc+KFxuICAgICdnaXRSZXBvVXJsJyxcbiAgICBcIkdpdCByZXBvc2l0b3J5IFVSTFwiLFxuICAgICdkYXRhU3luYycsXG4gICkpO1xuXG4gIGNvbnN0IHJlcG9VcmwgPSAoYXdhaXQgc2V0dGluZ3MuZ2V0VmFsdWUoJ2dpdFJlcG9VcmwnKSBhcyBzdHJpbmcpIHx8IChhd2FpdCByZXF1ZXN0UmVwb1VybChjb25maWdXaW5kb3cpKTtcblxuICBjb25zdCBnaXRDdHJsID0gbmV3IEdpdENvbnRyb2xsZXIoZnMsIHJlcG9VcmwsIHVwc3RyZWFtUmVwb1VybCwgd29ya0RpciwgY29yc1Byb3h5VXJsKTtcblxuICBsZXQgZG9Jbml0aWFsaXplOiBib29sZWFuO1xuXG4gIGlmIChmb3JjZSA9PT0gdHJ1ZSkge1xuICAgIGxvZy53YXJuKFwiU1NFOiBHaXQgaXMgYmVpbmcgZm9yY2UgcmVpbml0aWFsaXplZFwiKTtcbiAgICBkb0luaXRpYWxpemUgPSB0cnVlO1xuICB9IGVsc2UgaWYgKCEoYXdhaXQgZ2l0Q3RybC5pc0luaXRpYWxpemVkKCkpKSB7XG4gICAgbG9nLndhcm4oXCJTU0U6IEdpdCBpcyBub3QgaW5pdGlhbGl6ZWQgeWV0XCIpO1xuICAgIGRvSW5pdGlhbGl6ZSA9IHRydWU7XG4gIH0gZWxzZSBpZiAoIShhd2FpdCBnaXRDdHJsLmlzVXNpbmdSZW1vdGVVUkxzKHsgb3JpZ2luOiByZXBvVXJsLCB1cHN0cmVhbTogdXBzdHJlYW1SZXBvVXJsIH0pKSkge1xuICAgIGxvZy53YXJuKFwiU1NFOiBHaXQgaGFzIG1pc21hdGNoaW5nIHJlbW90ZSBVUkxzLCByZWluaXRpYWxpemluZ1wiKTtcbiAgICBkb0luaXRpYWxpemUgPSB0cnVlO1xuICB9IGVsc2Uge1xuICAgIGxvZy5pbmZvKFwiU1NFOiBHaXQgaXMgYWxyZWFkeSBpbml0aWFsaXplZFwiKTtcbiAgICBkb0luaXRpYWxpemUgPSBmYWxzZTtcbiAgfVxuXG4gIGlmIChkb0luaXRpYWxpemUpIHtcbiAgICBhd2FpdCBnaXRDdHJsLmZvcmNlSW5pdGlhbGl6ZSgpO1xuICB9XG5cbiAgYXdhaXQgZ2l0Q3RybC5sb2FkQXV0aCgpO1xuXG4gIHJldHVybiBnaXRDdHJsO1xufVxuXG5cbi8qIFByb21pc2VzIHRvIHJldHVybiBhbiBvYmplY3QgY29udGFpbmluZyBzdHJpbmcgd2l0aCByZXBvc2l0b3J5IFVSTFxuICAgYW5kIGEgZmxhZyBpbmRpY2F0aW5nIHdoZXRoZXIgaXTigJlzIGJlZW4gcmVzZXRcbiAgICh3aGljaCBpZiB0cnVlIHdvdWxkIGNhdXNlIGBpbml0UmVwbygpYCB0byByZWluaXRpYWxpemUgdGhlIHJlcG9zaXRvcnkpLlxuXG4gICBJZiByZXBvc2l0b3J5IFVSTCBpcyBub3QgY29uZmlndXJlZCAoZS5nLiwgb24gZmlyc3QgcnVuLCBvciBhZnRlciByZXNldClcbiAgIG9wZW5zIGEgd2luZG93IHdpdGggc3BlY2lmaWVkIG9wdGlvbnMgdG8gYXNrIHRoZSB1c2VyIHRvIHByb3ZpZGUgdGhlIHNldHRpbmcuXG4gICBUaGUgd2luZG93IGlzIGV4cGVjdGVkIHRvIGFzayB0aGUgdXNlciB0byBzcGVjaWZ5IHRoZSBVUkwgYW5kIHNlbmQgYSBgJ3NldC1zZXR0aW5nJ2BcbiAgIGV2ZW50IGZvciBgJ2dpdFJlcG9VcmwnYC4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXF1ZXN0UmVwb1VybChjb25maWdXaW5kb3c6IFdpbmRvd09wZW5lclBhcmFtcyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIHJldHVybiBuZXcgUHJvbWlzZTxzdHJpbmc+KGFzeW5jIChyZXNvbHZlLCByZWplY3QpID0+IHtcblxuICAgIGxvZy53YXJuKFwiU1NFOiBHaXRDb250cm9sbGVyOiBPcGVuIGNvbmZpZyB3aW5kb3cgdG8gY29uZmlndXJlIHJlcG8gVVJMXCIpO1xuXG4gICAgaXBjTWFpbi5vbignc2V0LXNldHRpbmcnLCBoYW5kbGVTZXR0aW5nKTtcblxuICAgIGZ1bmN0aW9uIGhhbmRsZVNldHRpbmcoZXZ0OiBhbnksIG5hbWU6IHN0cmluZywgdmFsdWU6IHN0cmluZykge1xuICAgICAgaWYgKG5hbWUgPT09ICdnaXRSZXBvVXJsJykge1xuICAgICAgICBsb2cuaW5mbyhcIlNTRTogR2l0Q29udHJvbGxlcjogcmVjZWl2ZWQgZ2l0UmVwb1VybCBzZXR0aW5nXCIpO1xuICAgICAgICBpcGNNYWluLnJlbW92ZUxpc3RlbmVyKCdzZXQtc2V0dGluZycsIGhhbmRsZVNldHRpbmcpO1xuICAgICAgICByZXNvbHZlKHZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCBvcGVuV2luZG93KGNvbmZpZ1dpbmRvdyk7XG5cbiAgfSk7XG59XG5cblxuYXN5bmMgZnVuY3Rpb24gY2hlY2tPbmxpbmVTdGF0dXMoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGxldCBpc09mZmxpbmU6IGJvb2xlYW47XG4gIHRyeSB7XG4gICAgYXdhaXQgZG5zLnByb21pc2VzLmxvb2t1cCgnZ2l0aHViLmNvbScpO1xuICAgIGlzT2ZmbGluZSA9IGZhbHNlO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaXNPZmZsaW5lID0gdHJ1ZTtcbiAgfVxuICByZXR1cm4gIWlzT2ZmbGluZTtcbn1cblxuXG5hc3luYyBmdW5jdGlvbiBzZW5kUmVtb3RlU3RhdHVzKHVwZGF0ZTogUGFydGlhbDxSZW1vdGVTdG9yYWdlU3RhdHVzPikge1xuICBhd2FpdCBub3RpZnlBbGxXaW5kb3dzKCdyZW1vdGUtc3RvcmFnZS1zdGF0dXMnLCB1cGRhdGUpO1xufVxuIl19