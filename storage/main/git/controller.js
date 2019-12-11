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
    constructor(fs, repoUrl, authorName, authorEmail, username, upstreamRepoUrl, workDir, corsProxy) {
        this.fs = fs;
        this.repoUrl = repoUrl;
        this.authorName = authorName;
        this.authorEmail = authorEmail;
        this.username = username;
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
        this.loadAuth();
        await git.clone(Object.assign({ dir: this.workDir, url: this.repoUrl, ref: 'master', singleBranch: true, depth: 1, corsProxy: this.corsProxy }, this.auth));
        log.verbose("SSE: GitController: Initialize: Cloned");
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
        if (await this.isInitialized()) {
            await this.configSet('user.name', this.authorName);
            await this.configSet('user.email', this.authorEmail);
            await this.configSet('credentials.username', this.username);
        }
        this.auth.username = this.username;
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
            author: { name: this.authorName, email: this.authorEmail },
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
        if (e.code === 'FastForwardFail' || e.code === 'MergeNotSupportedFail') {
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
            const isInitialized = await this.isInitialized();
            await this.loadAuth();
            let hasUncommittedChanges;
            if (!isInitialized) {
                hasUncommittedChanges = false;
            }
            else {
                hasUncommittedChanges = await this.checkUncommitted();
            }
            if (!hasUncommittedChanges) {
                const isOffline = (await checkOnlineStatus()) === false;
                await sendRemoteStatus({ isOffline });
                if (!isOffline) {
                    const needsPassword = this.needsPassword();
                    await sendRemoteStatus({ needsPassword });
                    if (needsPassword) {
                        return;
                    }
                    if (isInitialized) {
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
                    else {
                        await sendRemoteStatus({ isPulling: true });
                        await this.forceInitialize();
                        await sendRemoteStatus({
                            statusRelativeToLocal: 'updated',
                            isMisconfigured: false,
                            needsPassword: false,
                        });
                        return;
                    }
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
    settings.register(new Setting('gitUsername', "Username", 'dataSync'));
    settings.register(new Setting('gitAuthorName', "Author name", 'dataSync'));
    settings.register(new Setting('gitAuthorEmail', "Author email", 'dataSync'));
    const repoUrl = await settings.getValue('gitRepoUrl') || (await requestRepoUrl(configWindow));
    const authorName = await settings.getValue('gitAuthorName');
    const authorEmail = await settings.getValue('gitAuthorEmail');
    const username = await settings.getValue('gitUsername');
    const gitCtrl = new GitController(fs, repoUrl, authorName, authorEmail, username, upstreamRepoUrl, workDir, corsProxyUrl);
    if (await gitCtrl.isInitialized()) {
        await gitCtrl.loadAuth();
    }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zdG9yYWdlL21haW4vZ2l0L2NvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxLQUFLLEdBQUcsTUFBTSxLQUFLLENBQUM7QUFDM0IsT0FBTyxLQUFLLElBQUksTUFBTSxNQUFNLENBQUM7QUFDN0IsT0FBTyxLQUFLLEVBQUUsTUFBTSxVQUFVLENBQUM7QUFDL0IsT0FBTyxTQUFTLE1BQU0sWUFBWSxDQUFDO0FBQ25DLE9BQU8sS0FBSyxHQUFHLE1BQU0sZ0JBQWdCLENBQUM7QUFDdEMsT0FBTyxLQUFLLEdBQUcsTUFBTSxjQUFjLENBQUM7QUFFcEMsT0FBTyxFQUFFLE9BQU8sRUFBRSxNQUFNLFVBQVUsQ0FBQztBQUVuQyxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFDM0MsT0FBTyxFQUFFLE9BQU8sRUFBa0IsTUFBTSx3QkFBd0IsQ0FBQztBQUNqRSxPQUFPLEVBQUUsZ0JBQWdCLEVBQXNCLFVBQVUsRUFBRSxNQUFNLHNCQUFzQixDQUFDO0FBT3hGLE1BQU0sZUFBZSxHQUFHLFVBQVUsQ0FBQztBQUNuQyxNQUFNLFdBQVcsR0FBRyxRQUFRLENBQUM7QUFHN0IsTUFBTSxPQUFPLGFBQWE7SUFNeEIsWUFDWSxFQUFPLEVBRVAsT0FBZSxFQUNmLFVBQWtCLEVBQ2xCLFdBQW1CLEVBQ25CLFFBQWdCLEVBRWhCLGVBQXVCLEVBQ3hCLE9BQWUsRUFDZCxTQUFpQjtRQVRqQixPQUFFLEdBQUYsRUFBRSxDQUFLO1FBRVAsWUFBTyxHQUFQLE9BQU8sQ0FBUTtRQUNmLGVBQVUsR0FBVixVQUFVLENBQVE7UUFDbEIsZ0JBQVcsR0FBWCxXQUFXLENBQVE7UUFDbkIsYUFBUSxHQUFSLFFBQVEsQ0FBUTtRQUVoQixvQkFBZSxHQUFmLGVBQWUsQ0FBUTtRQUN4QixZQUFPLEdBQVAsT0FBTyxDQUFRO1FBQ2QsY0FB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RDs7Ozs7OzsrQkFPK0I7QUFDL0IsTUFBTSxDQUFDLEtBQUssVUFBVSxjQUFjLENBQUMsWUFBZ0M7SUFDbkUsT0FBTyxJQUFJLE9BQU8sQ0FBUyxLQUFLLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO1FBRW5ELEdBQUcsQ0FBQyxJQUFJLENBQUMsOERBQThELENBQUMsQ0FBQztRQUV6RSxPQUFPLENBQUMsRUFBRSxDQUFDLGFBQWEsRUFBRSxhQUFhLENBQUMsQ0FBQztRQUV6QyxTQUFTLGFBQWEsQ0FBQyxHQUFRLEVBQUUsSUFBWSxFQUFFLEtBQWE7WUFDMUQsSUFBSSxJQUFJLEtBQUssWUFBWSxFQUFFO2dCQUN6QixHQUFHLENBQUMsSUFBSSxDQUFDLGlEQUFpRCxDQUFDLENBQUM7Z0JBQzVELE9BQU8sQ0FBQyxjQUFjLENBQUMsYUFBYSxFQUFFLGFBQWEsQ0FBQyxDQUFDO2dCQUNyRCxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7YUFDaEI7UUFDSCxDQUFDO1FBRUQsTUFBTSxVQUFVLENBQUMsWUFBWSxDQUFDLENBQUM7SUFFakMsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDO0FBR0QsS0FBSyxVQUFVLGlCQUFpQjtJQUM5QixJQUFJLFNBQWtCLENBQUM7SUFDdkIsSUFBSTtRQUNGLE1BQU0sR0FBRyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDeEMsU0FBUyxHQUFHLEtBQUssQ0FBQztLQUNuQjtJQUFDLE9BQU8sQ0FBQyxFQUFFO1FBQ1YsU0FBUyxHQUFHLElBQUksQ0FBQztLQUNsQjtJQUNELE9BQU8sQ0FBQyxTQUFTLENBQUM7QUFDcEIsQ0FBQztBQUdELEtBQUssVUFBVSxnQkFBZ0IsQ0FBQyxNQUFvQztJQUNsRSxNQUFNLGdCQUFnQixDQUFDLHVCQUF1QixFQUFFLE1BQU0sQ0FBQyxDQUFDO0FBQzFELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBkbnMgZnJvbSAnZG5zJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcy1leHRyYSc7XG5pbXBvcnQgQXN5bmNMb2NrIGZyb20gJ2FzeW5jLWxvY2snO1xuaW1wb3J0ICogYXMgZ2l0IGZyb20gJ2lzb21vcnBoaWMtZ2l0JztcbmltcG9ydCAqIGFzIGxvZyBmcm9tICdlbGVjdHJvbi1sb2cnO1xuXG5pbXBvcnQgeyBpcGNNYWluIH0gZnJvbSAnZWxlY3Ryb24nO1xuXG5pbXBvcnQgeyBsaXN0ZW4gfSBmcm9tICcuLi8uLi8uLi9hcGkvbWFpbic7XG5pbXBvcnQgeyBTZXR0aW5nLCBTZXR0aW5nTWFuYWdlciB9IGZyb20gJy4uLy4uLy4uL3NldHRpbmdzL21haW4nO1xuaW1wb3J0IHsgbm90aWZ5QWxsV2luZG93cywgV2luZG93T3BlbmVyUGFyYW1zLCBvcGVuV2luZG93IH0gZnJvbSAnLi4vLi4vLi4vbWFpbi93aW5kb3cnO1xuXG5pbXBvcnQgeyBSZW1vdGVTdG9yYWdlU3RhdHVzIH0gZnJvbSAnLi4vcmVtb3RlJztcblxuaW1wb3J0IHsgR2l0QXV0aGVudGljYXRpb24gfSBmcm9tICcuL3R5cGVzJztcblxuXG5jb25zdCBVUFNUUkVBTV9SRU1PVEUgPSAndXBzdHJlYW0nO1xuY29uc3QgTUFJTl9SRU1PVEUgPSAnb3JpZ2luJztcblxuXG5leHBvcnQgY2xhc3MgR2l0Q29udHJvbGxlciB7XG5cbiAgcHJpdmF0ZSBhdXRoOiBHaXRBdXRoZW50aWNhdGlvbiA9IHt9O1xuXG4gIHByaXZhdGUgc3RhZ2luZ0xvY2s6IEFzeW5jTG9jaztcblxuICBjb25zdHJ1Y3RvcihcbiAgICAgIHByaXZhdGUgZnM6IGFueSxcblxuICAgICAgcHJpdmF0ZSByZXBvVXJsOiBzdHJpbmcsXG4gICAgICBwcml2YXRlIGF1dGhvck5hbWU6IHN0cmluZyxcbiAgICAgIHByaXZhdGUgYXV0aG9yRW1haWw6IHN0cmluZyxcbiAgICAgIHByaXZhdGUgdXNlcm5hbWU6IHN0cmluZyxcblxuICAgICAgcHJpdmF0ZSB1cHN0cmVhbVJlcG9Vcmw6IHN0cmluZyxcbiAgICAgIHB1YmxpYyB3b3JrRGlyOiBzdHJpbmcsXG4gICAgICBwcml2YXRlIGNvcnNQcm94eTogc3RyaW5nKSB7XG5cbiAgICBnaXQucGx1Z2lucy5zZXQoJ2ZzJywgZnMpO1xuXG4gICAgdGhpcy5zdGFnaW5nTG9jayA9IG5ldyBBc3luY0xvY2soeyB0aW1lb3V0OiAyMDAwMCwgbWF4UGVuZGluZzogMTAgfSk7XG5cbiAgICAvLyBNYWtlcyBpdCBlYXNpZXIgdG8gYmluZCB0aGVzZSB0byBJUEMgZXZlbnRzXG4gICAgdGhpcy5zeW5jaHJvbml6ZSA9IHRoaXMuc3luY2hyb25pemUuYmluZCh0aGlzKTtcbiAgICB0aGlzLnJlc2V0RmlsZXMgPSB0aGlzLnJlc2V0RmlsZXMuYmluZCh0aGlzKTtcbiAgICB0aGlzLmNoZWNrVW5jb21taXR0ZWQgPSB0aGlzLmNoZWNrVW5jb21taXR0ZWQuYmluZCh0aGlzKTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBpc0luaXRpYWxpemVkKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGxldCBoYXNHaXREaXJlY3Rvcnk6IGJvb2xlYW47XG4gICAgdHJ5IHtcbiAgICAgIGhhc0dpdERpcmVjdG9yeSA9IChhd2FpdCB0aGlzLmZzLnN0YXQocGF0aC5qb2luKHRoaXMud29ya0RpciwgJy5naXQnKSkpLmlzRGlyZWN0b3J5KCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgaGFzR2l0RGlyZWN0b3J5ID0gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiBoYXNHaXREaXJlY3Rvcnk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgaXNVc2luZ1JlbW90ZVVSTHMocmVtb3RlVXJsczogeyBvcmlnaW46IHN0cmluZywgdXBzdHJlYW06IHN0cmluZyB9KTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3Qgb3JpZ2luID0gKGF3YWl0IHRoaXMuZ2V0T3JpZ2luVXJsKCkgfHwgJycpLnRyaW0oKTtcbiAgICBjb25zdCB1cHN0cmVhbSA9IChhd2FpdCB0aGlzLmdldFVwc3RyZWFtVXJsKCkgfHwgJycpLnRyaW0oKTtcbiAgICByZXR1cm4gb3JpZ2luID09PSByZW1vdGVVcmxzLm9yaWdpbiAmJiB1cHN0cmVhbSA9PT0gcmVtb3RlVXJscy51cHN0cmVhbTtcbiAgfVxuXG4gIHB1YmxpYyBuZWVkc1Bhc3N3b3JkKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiAodGhpcy5hdXRoLnBhc3N3b3JkIHx8ICcnKS50cmltKCkgPT09ICcnO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGZvcmNlSW5pdGlhbGl6ZSgpIHtcbiAgICAvKiBJbml0aWFsaXplcyBmcm9tIHNjcmF0Y2g6IHdpcGVzIHdvcmsgZGlyZWN0b3J5LCBjbG9uZXMgYWdhaW4sIGFkZHMgcmVtb3Rlcy4gKi9cblxuICAgIGxvZy53YXJuKFwiU1NFOiBHaXRDb250cm9sbGVyOiBGb3JjZSBpbml0aWFsaXppbmdcIik7XG4gICAgbG9nLndhcm4oXCJTU0U6IEdpdENvbnRyb2xsZXI6IEluaXRpYWxpemU6IFJlbW92aW5nIGRhdGEgZGlyZWN0b3J5XCIpO1xuXG4gICAgYXdhaXQgdGhpcy5mcy5yZW1vdmUodGhpcy53b3JrRGlyKTtcblxuICAgIGxvZy5zaWxseShcIlNTRTogR2l0Q29udHJvbGxlcjogSW5pdGlhbGl6ZTogRW5zdXJpbmcgZGF0YSBkaXJlY3RvcnkgZXhpc3RzXCIpO1xuXG4gICAgYXdhaXQgdGhpcy5mcy5lbnN1cmVEaXIodGhpcy53b3JrRGlyKTtcblxuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBJbml0aWFsaXplOiBDbG9uaW5nXCIsIHRoaXMucmVwb1VybCk7XG5cbiAgICB0aGlzLmxvYWRBdXRoKCk7XG5cbiAgICBhd2FpdCBnaXQuY2xvbmUoe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICB1cmw6IHRoaXMucmVwb1VybCxcbiAgICAgIHJlZjogJ21hc3RlcicsXG4gICAgICBzaW5nbGVCcmFuY2g6IHRydWUsXG4gICAgICBkZXB0aDogMSxcbiAgICAgIGNvcnNQcm94eTogdGhpcy5jb3JzUHJveHksXG4gICAgICAuLi50aGlzLmF1dGgsXG4gICAgfSk7XG5cbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogSW5pdGlhbGl6ZTogQ2xvbmVkXCIpO1xuXG4gICAgYXdhaXQgZ2l0LmFkZFJlbW90ZSh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIHJlbW90ZTogVVBTVFJFQU1fUkVNT1RFLFxuICAgICAgdXJsOiB0aGlzLnVwc3RyZWFtUmVwb1VybCxcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBjb25maWdTZXQocHJvcDogc3RyaW5nLCB2YWw6IHN0cmluZykge1xuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBTZXQgY29uZmlnXCIpO1xuICAgIGF3YWl0IGdpdC5jb25maWcoeyBkaXI6IHRoaXMud29ya0RpciwgcGF0aDogcHJvcCwgdmFsdWU6IHZhbCB9KTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBjb25maWdHZXQocHJvcDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogR2V0IGNvbmZpZ1wiLCBwcm9wKTtcbiAgICByZXR1cm4gYXdhaXQgZ2l0LmNvbmZpZyh7IGRpcjogdGhpcy53b3JrRGlyLCBwYXRoOiBwcm9wIH0pO1xuICB9XG5cbiAgcHVibGljIHNldFBhc3N3b3JkKHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpIHtcbiAgICB0aGlzLmF1dGgucGFzc3dvcmQgPSB2YWx1ZTtcbiAgfVxuXG4gIGFzeW5jIGxvYWRBdXRoKCkge1xuICAgIGlmIChhd2FpdCB0aGlzLmlzSW5pdGlhbGl6ZWQoKSkge1xuICAgICAgYXdhaXQgdGhpcy5jb25maWdTZXQoJ3VzZXIubmFtZScsIHRoaXMuYXV0aG9yTmFtZSk7XG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ1NldCgndXNlci5lbWFpbCcsIHRoaXMuYXV0aG9yRW1haWwpO1xuICAgICAgYXdhaXQgdGhpcy5jb25maWdTZXQoJ2NyZWRlbnRpYWxzLnVzZXJuYW1lJywgdGhpcy51c2VybmFtZSk7XG4gICAgfVxuXG4gICAgdGhpcy5hdXRoLnVzZXJuYW1lID0gdGhpcy51c2VybmFtZTtcbiAgfVxuXG4gIGFzeW5jIHB1bGwoKSB7XG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IFB1bGxpbmcgbWFzdGVyIHdpdGggZmFzdC1mb3J3YXJkIG1lcmdlXCIpO1xuXG4gICAgcmV0dXJuIGF3YWl0IGdpdC5wdWxsKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgc2luZ2xlQnJhbmNoOiB0cnVlLFxuICAgICAgZmFzdEZvcndhcmRPbmx5OiB0cnVlLFxuICAgICAgZmFzdDogdHJ1ZSxcbiAgICAgIC4uLnRoaXMuYXV0aCxcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIHN0YWdlKHBhdGhTcGVjczogc3RyaW5nW10pIHtcbiAgICBsb2cudmVyYm9zZShgU1NFOiBHaXRDb250cm9sbGVyOiBBZGRpbmcgY2hhbmdlczogJHtwYXRoU3BlY3Muam9pbignLCAnKX1gKTtcblxuICAgIGZvciAoY29uc3QgcGF0aFNwZWMgb2YgcGF0aFNwZWNzKSB7XG4gICAgICBhd2FpdCBnaXQuYWRkKHtcbiAgICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICAgIGZpbGVwYXRoOiBwYXRoU3BlYyxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGNvbW1pdChtc2c6IHN0cmluZykge1xuICAgIGxvZy52ZXJib3NlKGBTU0U6IEdpdENvbnRyb2xsZXI6IENvbW1pdHRpbmcgd2l0aCBtZXNzYWdlICR7bXNnfWApO1xuXG4gICAgcmV0dXJuIGF3YWl0IGdpdC5jb21taXQoe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICBtZXNzYWdlOiBtc2csXG4gICAgICBhdXRob3I6IHsgbmFtZTogdGhpcy5hdXRob3JOYW1lLCBlbWFpbDogdGhpcy5hdXRob3JFbWFpbCB9LFxuICAgICAgLy8gZ2l0LWNvbmZpZyB2YWx1ZXMgc2hvdWxkIGJlIHVzZWQgdGhlb3JldGljYWxseSwgYnV0IHRoZXJl4oCZcyBhIHF1aXJrIHRoZXJlLlxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgZmV0Y2hSZW1vdGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgZ2l0LmZldGNoKHsgZGlyOiB0aGlzLndvcmtEaXIsIHJlbW90ZTogTUFJTl9SRU1PVEUsIC4uLnRoaXMuYXV0aCB9KTtcbiAgfVxuXG4gIGFzeW5jIGZldGNoVXBzdHJlYW0oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgZ2l0LmZldGNoKHsgZGlyOiB0aGlzLndvcmtEaXIsIHJlbW90ZTogVVBTVFJFQU1fUkVNT1RFLCAuLi50aGlzLmF1dGggfSk7XG4gIH1cblxuICBhc3luYyBwdXNoKGZvcmNlID0gZmFsc2UpIHtcbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogUHVzaGluZ1wiKTtcblxuICAgIHJldHVybiBhd2FpdCBnaXQucHVzaCh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIHJlbW90ZTogTUFJTl9SRU1PVEUsXG4gICAgICBmb3JjZTogZm9yY2UsXG4gICAgICAuLi50aGlzLmF1dGgsXG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgcmVzZXRGaWxlcyhwYXRocz86IHN0cmluZ1tdKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc3RhZ2luZ0xvY2suYWNxdWlyZSgnMScsIGFzeW5jICgpID0+IHtcbiAgICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBGb3JjZSByZXNldHRpbmcgZmlsZXNcIik7XG5cbiAgICAgIHJldHVybiBhd2FpdCBnaXQuZmFzdENoZWNrb3V0KHtcbiAgICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICAgIGZvcmNlOiB0cnVlLFxuICAgICAgICBmaWxlcGF0aHM6IHBhdGhzIHx8IChhd2FpdCB0aGlzLmxpc3RDaGFuZ2VkRmlsZXMoKSksXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGdldE9yaWdpblVybCgpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICByZXR1cm4gKChhd2FpdCBnaXQubGlzdFJlbW90ZXMoe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgfSkpLmZpbmQociA9PiByLnJlbW90ZSA9PT0gTUFJTl9SRU1PVEUpIHx8IHsgdXJsOiBudWxsIH0pLnVybDtcbiAgfVxuXG4gIGFzeW5jIGdldFVwc3RyZWFtVXJsKCk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIHJldHVybiAoKGF3YWl0IGdpdC5saXN0UmVtb3Rlcyh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICB9KSkuZmluZChyID0+IHIucmVtb3RlID09PSBVUFNUUkVBTV9SRU1PVEUpIHx8IHsgdXJsOiBudWxsIH0pLnVybDtcbiAgfVxuXG4gIGFzeW5jIGxpc3RMb2NhbENvbW1pdHMoKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAgIC8qIFJldHVybnMgYSBsaXN0IG9mIGNvbW1pdCBtZXNzYWdlcyBmb3IgY29tbWl0cyB0aGF0IHdlcmUgbm90IHB1c2hlZCB5ZXQuXG5cbiAgICAgICBVc2VmdWwgdG8gY2hlY2sgd2hpY2ggY29tbWl0cyB3aWxsIGJlIHRocm93biBvdXRcbiAgICAgICBpZiB3ZSBmb3JjZSB1cGRhdGUgdG8gcmVtb3RlIG1hc3Rlci5cblxuICAgICAgIERvZXMgc28gYnkgd2Fsa2luZyB0aHJvdWdoIGxhc3QgMTAwIGNvbW1pdHMgc3RhcnRpbmcgZnJvbSBjdXJyZW50IEhFQUQuXG4gICAgICAgV2hlbiBpdCBlbmNvdW50ZXJzIHRoZSBmaXJzdCBsb2NhbCBjb21taXQgdGhhdCBkb2VzbuKAmXQgZGVzY2VuZHMgZnJvbSByZW1vdGUgbWFzdGVyIEhFQUQsXG4gICAgICAgaXQgY29uc2lkZXJzIGFsbCBwcmVjZWRpbmcgY29tbWl0cyB0byBiZSBhaGVhZC9sb2NhbCBhbmQgcmV0dXJucyB0aGVtLlxuXG4gICAgICAgSWYgaXQgZmluaXNoZXMgdGhlIHdhbGsgd2l0aG91dCBmaW5kaW5nIGFuIGFuY2VzdG9yLCB0aHJvd3MgYW4gZXJyb3IuXG4gICAgICAgSXQgaXMgYXNzdW1lZCB0aGF0IHRoZSBhcHAgZG9lcyBub3QgYWxsb3cgdG8gYWNjdW11bGF0ZVxuICAgICAgIG1vcmUgdGhhbiAxMDAgY29tbWl0cyB3aXRob3V0IHB1c2hpbmcgKGV2ZW4gMTAwIGlzIHRvbyBtYW55ISksXG4gICAgICAgc28gdGhlcmXigJlzIHByb2JhYmx5IHNvbWV0aGluZyBzdHJhbmdlIGdvaW5nIG9uLlxuXG4gICAgICAgT3RoZXIgYXNzdW1wdGlvbnM6XG5cbiAgICAgICAqIGdpdC5sb2cgcmV0dXJucyBjb21taXRzIGZyb20gbmV3ZXN0IHRvIG9sZGVzdC5cbiAgICAgICAqIFRoZSByZW1vdGUgd2FzIGFscmVhZHkgZmV0Y2hlZC5cblxuICAgICovXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5zdGFnaW5nTG9jay5hY3F1aXJlKCcxJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbGF0ZXN0UmVtb3RlQ29tbWl0ID0gYXdhaXQgZ2l0LnJlc29sdmVSZWYoe1xuICAgICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgICAgcmVmOiBgJHtNQUlOX1JFTU9URX0vbWFzdGVyYCxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBsb2NhbENvbW1pdHMgPSBhd2FpdCBnaXQubG9nKHtcbiAgICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICAgIGRlcHRoOiAxMDAsXG4gICAgICB9KTtcblxuICAgICAgdmFyIGNvbW1pdHMgPSBbXSBhcyBzdHJpbmdbXTtcbiAgICAgIGZvciAoY29uc3QgY29tbWl0IG9mIGxvY2FsQ29tbWl0cykge1xuICAgICAgICBpZiAoYXdhaXQgZ2l0LmlzRGVzY2VuZGVudCh7IGRpcjogdGhpcy53b3JrRGlyLCBvaWQ6IGNvbW1pdC5vaWQsIGFuY2VzdG9yOiBsYXRlc3RSZW1vdGVDb21taXQgfSkpIHtcbiAgICAgICAgICBjb21taXRzLnB1c2goY29tbWl0Lm1lc3NhZ2UpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBjb21taXRzO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkRpZCBub3QgZmluZCBhIGxvY2FsIGNvbW1pdCB0aGF0IGlzIGFuIGFuY2VzdG9yIG9mIHJlbW90ZSBtYXN0ZXJcIik7XG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgbGlzdENoYW5nZWRGaWxlcyhwYXRoU3BlY3MgPSBbJy4nXSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICAvKiBMaXN0cyByZWxhdGl2ZSBwYXRocyB0byBhbGwgZmlsZXMgdGhhdCB3ZXJlIGNoYW5nZWQgYW5kIGhhdmUgbm90IGJlZW4gY29tbWl0dGVkLiAqL1xuXG4gICAgY29uc3QgRklMRSA9IDAsIEhFQUQgPSAxLCBXT1JLRElSID0gMjtcblxuICAgIHJldHVybiAoYXdhaXQgZ2l0LnN0YXR1c01hdHJpeCh7IGRpcjogdGhpcy53b3JrRGlyLCBmaWxlcGF0aHM6IHBhdGhTcGVjcyB9KSlcbiAgICAgIC5maWx0ZXIocm93ID0+IHJvd1tIRUFEXSAhPT0gcm93W1dPUktESVJdKVxuICAgICAgLm1hcChyb3cgPT4gcm93W0ZJTEVdKVxuICAgICAgLmZpbHRlcihmaWxlcGF0aCA9PiAhZmlsZXBhdGguc3RhcnRzV2l0aCgnLi4nKSk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgc3RhZ2VBbmRDb21taXQocGF0aFNwZWNzOiBzdHJpbmdbXSwgbXNnOiBzdHJpbmcpOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIC8qIFN0YWdlcyBhbmQgY29tbWl0cyBmaWxlcyBtYXRjaGluZyBnaXZlbiBwYXRoIHNwZWMgd2l0aCBnaXZlbiBtZXNzYWdlLlxuXG4gICAgICAgQW55IG90aGVyIGZpbGVzIHN0YWdlZCBhdCB0aGUgdGltZSBvZiB0aGUgY2FsbCB3aWxsIGJlIHVuc3RhZ2VkLlxuXG4gICAgICAgUmV0dXJucyB0aGUgbnVtYmVyIG9mIG1hdGNoaW5nIGZpbGVzIHdpdGggdW5zdGFnZWQgY2hhbmdlcyBwcmlvciB0byBzdGFnaW5nLlxuICAgICAgIElmIG5vIG1hdGNoaW5nIGZpbGVzIHdlcmUgZm91bmQgaGF2aW5nIHVuc3RhZ2VkIGNoYW5nZXMsXG4gICAgICAgc2tpcHMgdGhlIHJlc3QgYW5kIHJldHVybnMgemVyby5cblxuICAgICAgIElmIGZhaWxJZkRpdmVyZ2VkIGlzIGdpdmVuLCBhdHRlbXB0cyBhIGZhc3QtZm9yd2FyZCBwdWxsIGFmdGVyIHRoZSBjb21taXQuXG4gICAgICAgSXQgd2lsbCBmYWlsIGltbWVkaWF0ZWx5IGlmIG1haW4gcmVtb3RlIGhhZCBvdGhlciBjb21taXRzIGFwcGVhciBpbiBtZWFudGltZS5cblxuICAgICAgIExvY2tzIHNvIHRoYXQgdGhpcyBtZXRob2QgY2Fubm90IGJlIHJ1biBjb25jdXJyZW50bHkgKGJ5IHNhbWUgaW5zdGFuY2UpLlxuICAgICovXG5cbiAgICBpZiAocGF0aFNwZWNzLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIldhc27igJl0IGdpdmVuIGFueSBwYXRocyB0byBjb21taXQhXCIpO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnN0YWdpbmdMb2NrLmFjcXVpcmUoJzEnLCBhc3luYyAoKSA9PiB7XG4gICAgICBsb2cudmVyYm9zZShgU1NFOiBHaXRDb250cm9sbGVyOiBTdGFnaW5nIGFuZCBjb21taXR0aW5nOiAke3BhdGhTcGVjcy5qb2luKCcsICcpfWApO1xuXG4gICAgICBjb25zdCBmaWxlc0NoYW5nZWQgPSAoYXdhaXQgdGhpcy5saXN0Q2hhbmdlZEZpbGVzKHBhdGhTcGVjcykpLmxlbmd0aDtcbiAgICAgIGlmIChmaWxlc0NoYW5nZWQgPCAxKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLnVuc3RhZ2VBbGwoKTtcbiAgICAgIGF3YWl0IHRoaXMuc3RhZ2UocGF0aFNwZWNzKTtcbiAgICAgIGF3YWl0IHRoaXMuY29tbWl0KG1zZyk7XG5cbiAgICAgIHJldHVybiBmaWxlc0NoYW5nZWQ7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHVuc3RhZ2VBbGwoKSB7XG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IFVuc3RhZ2luZyBhbGwgY2hhbmdlc1wiKTtcbiAgICBhd2FpdCBnaXQucmVtb3ZlKHsgZGlyOiB0aGlzLndvcmtEaXIsIGZpbGVwYXRoOiAnLicgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIF9oYW5kbGVHaXRFcnJvcihlOiBFcnJvciAmIHsgY29kZTogc3RyaW5nIH0pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoZS5jb2RlID09PSAnRmFzdEZvcndhcmRGYWlsJyB8fCBlLmNvZGUgPT09ICdNZXJnZU5vdFN1cHBvcnRlZEZhaWwnKSB7XG4gICAgICAvLyBOT1RFOiBUaGVyZeKAmXMgYWxzbyBQdXNoUmVqZWN0ZWROb25GYXN0Rm9yd2FyZCwgYnV0IGl0IHNlZW1zIHRvIGJlIHRocm93blxuICAgICAgLy8gZm9yIHVucmVsYXRlZCBjYXNlcyBkdXJpbmcgcHVzaCAoZmFsc2UgcG9zaXRpdmUpLlxuICAgICAgLy8gQmVjYXVzZSBvZiB0aGF0IGZhbHNlIHBvc2l0aXZlLCB3ZSBpZ25vcmUgdGhhdCBlcnJvciBhbmQgaW5zdGVhZCBkbyBwdWxsIGZpcnN0LFxuICAgICAgLy8gY2F0Y2hpbmcgYWN0dWFsIGZhc3QtZm9yd2FyZCBmYWlscyBvbiB0aGF0IHN0ZXAgYmVmb3JlIHB1c2guXG4gICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgc3RhdHVzUmVsYXRpdmVUb0xvY2FsOiAnZGl2ZXJnZWQnIH0pO1xuICAgIH0gZWxzZSBpZiAoWydNaXNzaW5nVXNlcm5hbWVFcnJvcicsICdNaXNzaW5nQXV0aG9yRXJyb3InLCAnTWlzc2luZ0NvbW1pdHRlckVycm9yJ10uaW5kZXhPZihlLmNvZGUpID49IDApIHtcbiAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc01pc2NvbmZpZ3VyZWQ6IHRydWUgfSk7XG4gICAgfSBlbHNlIGlmIChlLmNvZGUgPT09ICdNaXNzaW5nUGFzc3dvcmRUb2tlbkVycm9yJyB8fCAoZS5jb2RlID09PSAnSFRUUEVycm9yJyAmJiBlLm1lc3NhZ2UuaW5kZXhPZignVW5hdXRob3JpemVkJykgPj0gMCkpIHtcbiAgICAgIHRoaXMuc2V0UGFzc3dvcmQodW5kZWZpbmVkKTtcbiAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBuZWVkc1Bhc3N3b3JkOiB0cnVlIH0pO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBjaGVja1VuY29tbWl0dGVkKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIC8qIENoZWNrcyBmb3IgYW55IHVuY29tbWl0dGVkIGNoYW5nZXMgbG9jYWxseSBwcmVzZW50LlxuICAgICAgIE5vdGlmaWVzIGFsbCB3aW5kb3dzIGFib3V0IHRoZSBzdGF0dXMuICovXG5cbiAgICBsb2cuZGVidWcoXCJTU0U6IEdpdDogQ2hlY2tpbmcgZm9yIHVuY29tbWl0dGVkIGNoYW5nZXNcIik7XG4gICAgY29uc3QgaGFzVW5jb21taXR0ZWRDaGFuZ2VzID0gKGF3YWl0IHRoaXMubGlzdENoYW5nZWRGaWxlcygpKS5sZW5ndGggPiAwO1xuICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBoYXNMb2NhbENoYW5nZXM6IGhhc1VuY29tbWl0dGVkQ2hhbmdlcyB9KTtcbiAgICByZXR1cm4gaGFzVW5jb21taXR0ZWRDaGFuZ2VzO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHN5bmNocm9uaXplKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8qIENoZWNrcyBmb3IgY29ubmVjdGlvbiwgbG9jYWwgY2hhbmdlcyBhbmQgdW5wdXNoZWQgY29tbWl0cyxcbiAgICAgICB0cmllcyB0byBwdXNoIGFuZCBwdWxsIHdoZW4gdGhlcmXigJlzIG9wcG9ydHVuaXR5LlxuXG4gICAgICAgTm90aWZpZXMgYWxsIHdpbmRvd3MgYWJvdXQgdGhlIHN0YXR1cyBpbiBwcm9jZXNzLiAqL1xuXG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdDogUXVldWVpbmcgc3luY1wiKTtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5zdGFnaW5nTG9jay5hY3F1aXJlKCcxJywgYXN5bmMgKCkgPT4ge1xuICAgICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdDogU3RhcnRpbmcgc3luY1wiKTtcblxuICAgICAgY29uc3QgaXNJbml0aWFsaXplZCA9IGF3YWl0IHRoaXMuaXNJbml0aWFsaXplZCgpO1xuICAgICAgYXdhaXQgdGhpcy5sb2FkQXV0aCgpO1xuXG4gICAgICBsZXQgaGFzVW5jb21taXR0ZWRDaGFuZ2VzOiBib29sZWFuO1xuICAgICAgaWYgKCFpc0luaXRpYWxpemVkKSB7XG4gICAgICAgIGhhc1VuY29tbWl0dGVkQ2hhbmdlcyA9IGZhbHNlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaGFzVW5jb21taXR0ZWRDaGFuZ2VzID0gYXdhaXQgdGhpcy5jaGVja1VuY29tbWl0dGVkKCk7XG4gICAgICB9XG5cbiAgICAgIGlmICghaGFzVW5jb21taXR0ZWRDaGFuZ2VzKSB7XG5cbiAgICAgICAgY29uc3QgaXNPZmZsaW5lID0gKGF3YWl0IGNoZWNrT25saW5lU3RhdHVzKCkpID09PSBmYWxzZTtcbiAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IGlzT2ZmbGluZSB9KTtcblxuICAgICAgICBpZiAoIWlzT2ZmbGluZSkge1xuXG4gICAgICAgICAgY29uc3QgbmVlZHNQYXNzd29yZCA9IHRoaXMubmVlZHNQYXNzd29yZCgpO1xuICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBuZWVkc1Bhc3N3b3JkIH0pO1xuICAgICAgICAgIGlmIChuZWVkc1Bhc3N3b3JkKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGlzSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc1B1bGxpbmc6IHRydWUgfSk7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnB1bGwoKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgbG9nLmVycm9yKGUpO1xuICAgICAgICAgICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaXNQdWxsaW5nOiBmYWxzZSB9KTtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5faGFuZGxlR2l0RXJyb3IoZSk7XG4gICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc1B1bGxpbmc6IGZhbHNlIH0pO1xuXG4gICAgICAgICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaXNQdXNoaW5nOiB0cnVlIH0pO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wdXNoKCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IGlzUHVzaGluZzogZmFsc2UgfSk7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUdpdEVycm9yKGUpO1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaXNQdXNoaW5nOiBmYWxzZSB9KTtcblxuICAgICAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7XG4gICAgICAgICAgICAgIHN0YXR1c1JlbGF0aXZlVG9Mb2NhbDogJ3VwZGF0ZWQnLFxuICAgICAgICAgICAgICBpc01pc2NvbmZpZ3VyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgICBuZWVkc1Bhc3N3b3JkOiBmYWxzZSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc1B1bGxpbmc6IHRydWUgfSk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmZvcmNlSW5pdGlhbGl6ZSgpO1xuICAgICAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7XG4gICAgICAgICAgICAgIHN0YXR1c1JlbGF0aXZlVG9Mb2NhbDogJ3VwZGF0ZWQnLFxuICAgICAgICAgICAgICBpc01pc2NvbmZpZ3VyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgICBuZWVkc1Bhc3N3b3JkOiBmYWxzZSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICB9XG5cblxuICAvKiBJUEMgZW5kcG9pbnQgc2V0dXAgKi9cblxuICBzZXRVcEFQSUVuZHBvaW50cygpIHtcbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogU2V0dGluZyB1cCBBUEkgZW5kcG9pbnRzXCIpO1xuXG4gICAgbGlzdGVuPHsgbmFtZTogc3RyaW5nLCBlbWFpbDogc3RyaW5nLCB1c2VybmFtZTogc3RyaW5nIH0sIHsgc3VjY2VzczogdHJ1ZSB9PlxuICAgICgnZ2l0LWNvbmZpZy1zZXQnLCBhc3luYyAoeyBuYW1lLCBlbWFpbCwgdXNlcm5hbWUgfSkgPT4ge1xuICAgICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IHJlY2VpdmVkIGdpdC1jb25maWctc2V0IHJlcXVlc3RcIik7XG5cbiAgICAgIGF3YWl0IHRoaXMuY29uZmlnU2V0KCd1c2VyLm5hbWUnLCBuYW1lKTtcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlnU2V0KCd1c2VyLmVtYWlsJywgZW1haWwpO1xuICAgICAgYXdhaXQgdGhpcy5jb25maWdTZXQoJ2NyZWRlbnRpYWxzLnVzZXJuYW1lJywgdXNlcm5hbWUpO1xuXG4gICAgICB0aGlzLmF1dGgudXNlcm5hbWUgPSB1c2VybmFtZTtcblxuICAgICAgdGhpcy5zeW5jaHJvbml6ZSgpO1xuXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gICAgfSk7XG5cbiAgICBsaXN0ZW48eyBwYXNzd29yZDogc3RyaW5nIH0sIHsgc3VjY2VzczogdHJ1ZSB9PlxuICAgICgnZ2l0LXNldC1wYXNzd29yZCcsIGFzeW5jICh7IHBhc3N3b3JkIH0pID0+IHtcbiAgICAgIC8vIFdBUk5JTkc6IERvbuKAmXQgbG9nIHBhc3N3b3JkXG4gICAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogcmVjZWl2ZWQgZ2l0LXNldC1wYXNzd29yZCByZXF1ZXN0XCIpO1xuXG4gICAgICB0aGlzLnNldFBhc3N3b3JkKHBhc3N3b3JkKTtcbiAgICAgIHRoaXMuc3luY2hyb25pemUoKTtcblxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICAgIH0pO1xuXG4gICAgbGlzdGVuPHt9LCB7IG9yaWdpblVSTDogc3RyaW5nIHwgbnVsbCwgbmFtZTogc3RyaW5nIHwgbnVsbCwgZW1haWw6IHN0cmluZyB8IG51bGwsIHVzZXJuYW1lOiBzdHJpbmcgfCBudWxsIH0+XG4gICAgKCdnaXQtY29uZmlnLWdldCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiByZWNlaXZlZCBnaXQtY29uZmlnIHJlcXVlc3RcIik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBvcmlnaW5VUkw6IGF3YWl0IHRoaXMuZ2V0T3JpZ2luVXJsKCksXG4gICAgICAgIG5hbWU6IGF3YWl0IHRoaXMuY29uZmlnR2V0KCd1c2VyLm5hbWUnKSxcbiAgICAgICAgZW1haWw6IGF3YWl0IHRoaXMuY29uZmlnR2V0KCd1c2VyLmVtYWlsJyksXG4gICAgICAgIHVzZXJuYW1lOiBhd2FpdCB0aGlzLmNvbmZpZ0dldCgnY3JlZGVudGlhbHMudXNlcm5hbWUnKSxcbiAgICAgICAgLy8gUGFzc3dvcmQgbXVzdCBub3QgYmUgcmV0dXJuZWQsIG9mIGNvdXJzZVxuICAgICAgfTtcbiAgICB9KTtcbiAgfVxufVxuXG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBpbml0UmVwbyhcbiAgICB3b3JrRGlyOiBzdHJpbmcsXG4gICAgdXBzdHJlYW1SZXBvVXJsOiBzdHJpbmcsXG4gICAgY29yc1Byb3h5VXJsOiBzdHJpbmcsXG4gICAgZm9yY2U6IGJvb2xlYW4sXG4gICAgc2V0dGluZ3M6IFNldHRpbmdNYW5hZ2VyLFxuICAgIGNvbmZpZ1dpbmRvdzogV2luZG93T3BlbmVyUGFyYW1zKTogUHJvbWlzZTxHaXRDb250cm9sbGVyPiB7XG5cbiAgc2V0dGluZ3MuY29uZmlndXJlUGFuZSh7XG4gICAgaWQ6ICdkYXRhU3luYycsXG4gICAgbGFiZWw6IFwiRGF0YSBzeW5jaHJvbml6YXRpb25cIixcbiAgICBpY29uOiAnZ2l0LW1lcmdlJyxcbiAgfSk7XG5cbiAgc2V0dGluZ3MucmVnaXN0ZXIobmV3IFNldHRpbmc8c3RyaW5nPihcbiAgICAnZ2l0UmVwb1VybCcsXG4gICAgXCJHaXQgcmVwb3NpdG9yeSBVUkxcIixcbiAgICAnZGF0YVN5bmMnLFxuICApKTtcblxuICBzZXR0aW5ncy5yZWdpc3RlcihuZXcgU2V0dGluZzxzdHJpbmc+KFxuICAgICdnaXRVc2VybmFtZScsXG4gICAgXCJVc2VybmFtZVwiLFxuICAgICdkYXRhU3luYycsXG4gICkpO1xuXG4gIHNldHRpbmdzLnJlZ2lzdGVyKG5ldyBTZXR0aW5nPHN0cmluZz4oXG4gICAgJ2dpdEF1dGhvck5hbWUnLFxuICAgIFwiQXV0aG9yIG5hbWVcIixcbiAgICAnZGF0YVN5bmMnLFxuICApKTtcblxuICBzZXR0aW5ncy5yZWdpc3RlcihuZXcgU2V0dGluZzxzdHJpbmc+KFxuICAgICdnaXRBdXRob3JFbWFpbCcsXG4gICAgXCJBdXRob3IgZW1haWxcIixcbiAgICAnZGF0YVN5bmMnLFxuICApKTtcblxuICBjb25zdCByZXBvVXJsID0gKGF3YWl0IHNldHRpbmdzLmdldFZhbHVlKCdnaXRSZXBvVXJsJykgYXMgc3RyaW5nKSB8fCAoYXdhaXQgcmVxdWVzdFJlcG9VcmwoY29uZmlnV2luZG93KSk7XG5cbiAgY29uc3QgYXV0aG9yTmFtZSA9IGF3YWl0IHNldHRpbmdzLmdldFZhbHVlKCdnaXRBdXRob3JOYW1lJykgYXMgc3RyaW5nO1xuICBjb25zdCBhdXRob3JFbWFpbCA9IGF3YWl0IHNldHRpbmdzLmdldFZhbHVlKCdnaXRBdXRob3JFbWFpbCcpIGFzIHN0cmluZztcbiAgY29uc3QgdXNlcm5hbWUgPSBhd2FpdCBzZXR0aW5ncy5nZXRWYWx1ZSgnZ2l0VXNlcm5hbWUnKSBhcyBzdHJpbmc7XG5cbiAgY29uc3QgZ2l0Q3RybCA9IG5ldyBHaXRDb250cm9sbGVyKGZzLCByZXBvVXJsLCBhdXRob3JOYW1lLCBhdXRob3JFbWFpbCwgdXNlcm5hbWUsIHVwc3RyZWFtUmVwb1VybCwgd29ya0RpciwgY29yc1Byb3h5VXJsKTtcblxuICBpZiAoYXdhaXQgZ2l0Q3RybC5pc0luaXRpYWxpemVkKCkpIHtcbiAgICBhd2FpdCBnaXRDdHJsLmxvYWRBdXRoKCk7XG4gIH1cblxuICByZXR1cm4gZ2l0Q3RybDtcbn1cblxuXG4vKiBQcm9taXNlcyB0byByZXR1cm4gYW4gb2JqZWN0IGNvbnRhaW5pbmcgc3RyaW5nIHdpdGggcmVwb3NpdG9yeSBVUkxcbiAgIGFuZCBhIGZsYWcgaW5kaWNhdGluZyB3aGV0aGVyIGl04oCZcyBiZWVuIHJlc2V0XG4gICAod2hpY2ggaWYgdHJ1ZSB3b3VsZCBjYXVzZSBgaW5pdFJlcG8oKWAgdG8gcmVpbml0aWFsaXplIHRoZSByZXBvc2l0b3J5KS5cblxuICAgSWYgcmVwb3NpdG9yeSBVUkwgaXMgbm90IGNvbmZpZ3VyZWQgKGUuZy4sIG9uIGZpcnN0IHJ1biwgb3IgYWZ0ZXIgcmVzZXQpXG4gICBvcGVucyBhIHdpbmRvdyB3aXRoIHNwZWNpZmllZCBvcHRpb25zIHRvIGFzayB0aGUgdXNlciB0byBwcm92aWRlIHRoZSBzZXR0aW5nLlxuICAgVGhlIHdpbmRvdyBpcyBleHBlY3RlZCB0byBhc2sgdGhlIHVzZXIgdG8gc3BlY2lmeSB0aGUgVVJMIGFuZCBzZW5kIGEgYCdzZXQtc2V0dGluZydgXG4gICBldmVudCBmb3IgYCdnaXRSZXBvVXJsJ2AuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVxdWVzdFJlcG9VcmwoY29uZmlnV2luZG93OiBXaW5kb3dPcGVuZXJQYXJhbXMpOiBQcm9taXNlPHN0cmluZz4ge1xuICByZXR1cm4gbmV3IFByb21pc2U8c3RyaW5nPihhc3luYyAocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG5cbiAgICBsb2cud2FybihcIlNTRTogR2l0Q29udHJvbGxlcjogT3BlbiBjb25maWcgd2luZG93IHRvIGNvbmZpZ3VyZSByZXBvIFVSTFwiKTtcblxuICAgIGlwY01haW4ub24oJ3NldC1zZXR0aW5nJywgaGFuZGxlU2V0dGluZyk7XG5cbiAgICBmdW5jdGlvbiBoYW5kbGVTZXR0aW5nKGV2dDogYW55LCBuYW1lOiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcpIHtcbiAgICAgIGlmIChuYW1lID09PSAnZ2l0UmVwb1VybCcpIHtcbiAgICAgICAgbG9nLmluZm8oXCJTU0U6IEdpdENvbnRyb2xsZXI6IHJlY2VpdmVkIGdpdFJlcG9Vcmwgc2V0dGluZ1wiKTtcbiAgICAgICAgaXBjTWFpbi5yZW1vdmVMaXN0ZW5lcignc2V0LXNldHRpbmcnLCBoYW5kbGVTZXR0aW5nKTtcbiAgICAgICAgcmVzb2x2ZSh2YWx1ZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgb3BlbldpbmRvdyhjb25maWdXaW5kb3cpO1xuXG4gIH0pO1xufVxuXG5cbmFzeW5jIGZ1bmN0aW9uIGNoZWNrT25saW5lU3RhdHVzKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBsZXQgaXNPZmZsaW5lOiBib29sZWFuO1xuICB0cnkge1xuICAgIGF3YWl0IGRucy5wcm9taXNlcy5sb29rdXAoJ2dpdGh1Yi5jb20nKTtcbiAgICBpc09mZmxpbmUgPSBmYWxzZTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlzT2ZmbGluZSA9IHRydWU7XG4gIH1cbiAgcmV0dXJuICFpc09mZmxpbmU7XG59XG5cblxuYXN5bmMgZnVuY3Rpb24gc2VuZFJlbW90ZVN0YXR1cyh1cGRhdGU6IFBhcnRpYWw8UmVtb3RlU3RvcmFnZVN0YXR1cz4pIHtcbiAgYXdhaXQgbm90aWZ5QWxsV2luZG93cygncmVtb3RlLXN0b3JhZ2Utc3RhdHVzJywgdXBkYXRlKTtcbn1cbiJdfQ==