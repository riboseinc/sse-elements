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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zdG9yYWdlL21haW4vZ2l0L2NvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxLQUFLLEdBQUcsTUFBTSxLQUFLLENBQUM7QUFDM0IsT0FBTyxLQUFLLElBQUksTUFBTSxNQUFNLENBQUM7QUFDN0IsT0FBTyxLQUFLLEVBQUUsTUFBTSxVQUFVLENBQUM7QUFDL0IsT0FBTyxTQUFTLE1BQU0sWUFBWSxDQUFDO0FBQ25DLE9BQU8sS0FBSyxHQUFHLE1BQU0sZ0JBQWdCLENBQUM7QUFDdEMsT0FBTyxLQUFLLEdBQUcsTUFBTSxjQUFjLENBQUM7QUFFcEMsT0FBTyxFQUFFLE9BQU8sRUFBRSxNQUFNLFVBQVUsQ0FBQztBQUVuQyxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFDM0MsT0FBTyxFQUFFLE9BQU8sRUFBa0IsTUFBTSx3QkFBd0IsQ0FBQztBQUNqRSxPQUFPLEVBQUUsZ0JBQWdCLEVBQXNCLFVBQVUsRUFBRSxNQUFNLHNCQUFzQixDQUFDO0FBT3hGLE1BQU0sZUFBZSxHQUFHLFVBQVUsQ0FBQztBQUNuQyxNQUFNLFdBQVcsR0FBRyxRQUFRLENBQUM7QUFHN0IsTUFBTSxPQUFPLGFBQWE7SUFNeEIsWUFDWSxFQUFPLEVBRVAsT0FBZSxFQUNmLFVBQWtCLEVBQ2xCLFdBQW1CLEVBQ25CLFFBQWdCLEVBRWhCLGVBQXVCLEVBQ3hCLE9BQWUsRUFDZCxTQUFpQjtRQVRqQixPQUFFLEdBQUYsRUFBRSxDQUFLO1FBRVAsWUFBTyxHQUFQLE9BQU8sQ0FBUTtRQUNmLGVBQVUsR0FBVixVQUFVLENBQVE7UUFDbEIsZ0JBQVcsR0FBWCxXQUFXLENBQVE7UUFDbkIsYUFBUSxHQUFSLFFBQVEsQ0FBUTtRQUVoQixvQkFBZSxHQUFmLGVBQWUsQ0FBUTtRQUN4QixZQUFPLEdBQVAsT0FBTyxDQUFRO1FBQ2QsY0FB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RSxPQUFPLElBQUksT0FBTyxDQUFTLEtBQUssRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFFbkQsR0FBRyxDQUFDLElBQUksQ0FBQyw4REFBOEQsQ0FBQyxDQUFDO1FBRXpFLE9BQU8sQ0FBQyxFQUFFLENBQUMsYUFBYSxFQUFFLGFBQWEsQ0FBQyxDQUFDO1FBRXpDLFNBQVMsYUFBYSxDQUFDLEdBQVEsRUFBRSxJQUFZLEVBQUUsS0FBYTtZQUMxRCxJQUFJLElBQUksS0FBSyxZQUFZLEVBQUU7Z0JBQ3pCLEdBQUcsQ0FBQyxJQUFJLENBQUMsaURBQWlELENBQUMsQ0FBQztnQkFDNUQsT0FBTyxDQUFDLGNBQWMsQ0FBQyxhQUFhLEVBQUUsYUFBYSxDQUFDLENBQUM7Z0JBQ3JELE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQzthQUNoQjtRQUNILENBQUM7UUFFRCxNQUFNLFVBQVUsQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUVqQyxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUM7QUFHRCxLQUFLLFVBQVUsaUJBQWlCO0lBQzlCLElBQUksU0FBa0IsQ0FBQztJQUN2QixJQUFJO1FBQ0YsTUFBTSxHQUFHLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUN4QyxTQUFTLEdBQUcsS0FBSyxDQUFDO0tBQ25CO0lBQUMsT0FBTyxDQUFDLEVBQUU7UUFDVixTQUFTLEdBQUcsSUFBSSxDQUFDO0tBQ2xCO0lBQ0QsT0FBTyxDQUFDLFNBQVMsQ0FBQztBQUNwQixDQUFDO0FBR0QsS0FBSyxVQUFVLGdCQUFnQixDQUFDLE1BQW9DO0lBQ2xFLE1BQU0sZ0JBQWdCLENBQUMsdUJBQXVCLEVBQUUsTUFBTSxDQUFDLENBQUM7QUFDMUQsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGRucyBmcm9tICdkbnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzLWV4dHJhJztcbmltcG9ydCBBc3luY0xvY2sgZnJvbSAnYXN5bmMtbG9jayc7XG5pbXBvcnQgKiBhcyBnaXQgZnJvbSAnaXNvbW9ycGhpYy1naXQnO1xuaW1wb3J0ICogYXMgbG9nIGZyb20gJ2VsZWN0cm9uLWxvZyc7XG5cbmltcG9ydCB7IGlwY01haW4gfSBmcm9tICdlbGVjdHJvbic7XG5cbmltcG9ydCB7IGxpc3RlbiB9IGZyb20gJy4uLy4uLy4uL2FwaS9tYWluJztcbmltcG9ydCB7IFNldHRpbmcsIFNldHRpbmdNYW5hZ2VyIH0gZnJvbSAnLi4vLi4vLi4vc2V0dGluZ3MvbWFpbic7XG5pbXBvcnQgeyBub3RpZnlBbGxXaW5kb3dzLCBXaW5kb3dPcGVuZXJQYXJhbXMsIG9wZW5XaW5kb3cgfSBmcm9tICcuLi8uLi8uLi9tYWluL3dpbmRvdyc7XG5cbmltcG9ydCB7IFJlbW90ZVN0b3JhZ2VTdGF0dXMgfSBmcm9tICcuLi9yZW1vdGUnO1xuXG5pbXBvcnQgeyBHaXRBdXRoZW50aWNhdGlvbiB9IGZyb20gJy4vdHlwZXMnO1xuXG5cbmNvbnN0IFVQU1RSRUFNX1JFTU9URSA9ICd1cHN0cmVhbSc7XG5jb25zdCBNQUlOX1JFTU9URSA9ICdvcmlnaW4nO1xuXG5cbmV4cG9ydCBjbGFzcyBHaXRDb250cm9sbGVyIHtcblxuICBwcml2YXRlIGF1dGg6IEdpdEF1dGhlbnRpY2F0aW9uID0ge307XG5cbiAgcHJpdmF0ZSBzdGFnaW5nTG9jazogQXN5bmNMb2NrO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgICAgcHJpdmF0ZSBmczogYW55LFxuXG4gICAgICBwcml2YXRlIHJlcG9Vcmw6IHN0cmluZyxcbiAgICAgIHByaXZhdGUgYXV0aG9yTmFtZTogc3RyaW5nLFxuICAgICAgcHJpdmF0ZSBhdXRob3JFbWFpbDogc3RyaW5nLFxuICAgICAgcHJpdmF0ZSB1c2VybmFtZTogc3RyaW5nLFxuXG4gICAgICBwcml2YXRlIHVwc3RyZWFtUmVwb1VybDogc3RyaW5nLFxuICAgICAgcHVibGljIHdvcmtEaXI6IHN0cmluZyxcbiAgICAgIHByaXZhdGUgY29yc1Byb3h5OiBzdHJpbmcpIHtcblxuICAgIGdpdC5wbHVnaW5zLnNldCgnZnMnLCBmcyk7XG5cbiAgICB0aGlzLnN0YWdpbmdMb2NrID0gbmV3IEFzeW5jTG9jayh7IHRpbWVvdXQ6IDIwMDAwLCBtYXhQZW5kaW5nOiAxMCB9KTtcblxuICAgIC8vIE1ha2VzIGl0IGVhc2llciB0byBiaW5kIHRoZXNlIHRvIElQQyBldmVudHNcbiAgICB0aGlzLnN5bmNocm9uaXplID0gdGhpcy5zeW5jaHJvbml6ZS5iaW5kKHRoaXMpO1xuICAgIHRoaXMucmVzZXRGaWxlcyA9IHRoaXMucmVzZXRGaWxlcy5iaW5kKHRoaXMpO1xuICAgIHRoaXMuY2hlY2tVbmNvbW1pdHRlZCA9IHRoaXMuY2hlY2tVbmNvbW1pdHRlZC5iaW5kKHRoaXMpO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGlzSW5pdGlhbGl6ZWQoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgbGV0IGhhc0dpdERpcmVjdG9yeTogYm9vbGVhbjtcbiAgICB0cnkge1xuICAgICAgaGFzR2l0RGlyZWN0b3J5ID0gKGF3YWl0IHRoaXMuZnMuc3RhdChwYXRoLmpvaW4odGhpcy53b3JrRGlyLCAnLmdpdCcpKSkuaXNEaXJlY3RvcnkoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBoYXNHaXREaXJlY3RvcnkgPSBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIGhhc0dpdERpcmVjdG9yeTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBpc1VzaW5nUmVtb3RlVVJMcyhyZW1vdGVVcmxzOiB7IG9yaWdpbjogc3RyaW5nLCB1cHN0cmVhbTogc3RyaW5nIH0pOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCBvcmlnaW4gPSAoYXdhaXQgdGhpcy5nZXRPcmlnaW5VcmwoKSB8fCAnJykudHJpbSgpO1xuICAgIGNvbnN0IHVwc3RyZWFtID0gKGF3YWl0IHRoaXMuZ2V0VXBzdHJlYW1VcmwoKSB8fCAnJykudHJpbSgpO1xuICAgIHJldHVybiBvcmlnaW4gPT09IHJlbW90ZVVybHMub3JpZ2luICYmIHVwc3RyZWFtID09PSByZW1vdGVVcmxzLnVwc3RyZWFtO1xuICB9XG5cbiAgcHVibGljIG5lZWRzUGFzc3dvcmQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuICh0aGlzLmF1dGgucGFzc3dvcmQgfHwgJycpLnRyaW0oKSA9PT0gJyc7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgZm9yY2VJbml0aWFsaXplKCkge1xuICAgIC8qIEluaXRpYWxpemVzIGZyb20gc2NyYXRjaDogd2lwZXMgd29yayBkaXJlY3RvcnksIGNsb25lcyBhZ2FpbiwgYWRkcyByZW1vdGVzLiAqL1xuXG4gICAgbG9nLndhcm4oXCJTU0U6IEdpdENvbnRyb2xsZXI6IEZvcmNlIGluaXRpYWxpemluZ1wiKTtcbiAgICBsb2cud2FybihcIlNTRTogR2l0Q29udHJvbGxlcjogSW5pdGlhbGl6ZTogUmVtb3ZpbmcgZGF0YSBkaXJlY3RvcnlcIik7XG5cbiAgICBhd2FpdCB0aGlzLmZzLnJlbW92ZSh0aGlzLndvcmtEaXIpO1xuXG4gICAgbG9nLnNpbGx5KFwiU1NFOiBHaXRDb250cm9sbGVyOiBJbml0aWFsaXplOiBFbnN1cmluZyBkYXRhIGRpcmVjdG9yeSBleGlzdHNcIik7XG5cbiAgICBhd2FpdCB0aGlzLmZzLmVuc3VyZURpcih0aGlzLndvcmtEaXIpO1xuXG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IEluaXRpYWxpemU6IENsb25pbmdcIiwgdGhpcy5yZXBvVXJsKTtcblxuICAgIHRoaXMubG9hZEF1dGgoKTtcblxuICAgIGF3YWl0IGdpdC5jbG9uZSh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIHVybDogdGhpcy5yZXBvVXJsLFxuICAgICAgcmVmOiAnbWFzdGVyJyxcbiAgICAgIHNpbmdsZUJyYW5jaDogdHJ1ZSxcbiAgICAgIGRlcHRoOiAxLFxuICAgICAgY29yc1Byb3h5OiB0aGlzLmNvcnNQcm94eSxcbiAgICAgIC4uLnRoaXMuYXV0aCxcbiAgICB9KTtcblxuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBJbml0aWFsaXplOiBDbG9uZWRcIik7XG5cbiAgICBhd2FpdCBnaXQuYWRkUmVtb3RlKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgcmVtb3RlOiBVUFNUUkVBTV9SRU1PVEUsXG4gICAgICB1cmw6IHRoaXMudXBzdHJlYW1SZXBvVXJsLFxuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGNvbmZpZ1NldChwcm9wOiBzdHJpbmcsIHZhbDogc3RyaW5nKSB7XG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IFNldCBjb25maWdcIik7XG4gICAgYXdhaXQgZ2l0LmNvbmZpZyh7IGRpcjogdGhpcy53b3JrRGlyLCBwYXRoOiBwcm9wLCB2YWx1ZTogdmFsIH0pO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGNvbmZpZ0dldChwcm9wOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBHZXQgY29uZmlnXCIsIHByb3ApO1xuICAgIHJldHVybiBhd2FpdCBnaXQuY29uZmlnKHsgZGlyOiB0aGlzLndvcmtEaXIsIHBhdGg6IHByb3AgfSk7XG4gIH1cblxuICBwdWJsaWMgc2V0UGFzc3dvcmQodmFsdWU6IHN0cmluZyB8IHVuZGVmaW5lZCkge1xuICAgIHRoaXMuYXV0aC5wYXNzd29yZCA9IHZhbHVlO1xuICB9XG5cbiAgYXN5bmMgbG9hZEF1dGgoKSB7XG4gICAgaWYgKGF3YWl0IHRoaXMuaXNJbml0aWFsaXplZCgpKSB7XG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ1NldCgndXNlci5uYW1lJywgdGhpcy5hdXRob3JOYW1lKTtcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlnU2V0KCd1c2VyLmVtYWlsJywgdGhpcy5hdXRob3JFbWFpbCk7XG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ1NldCgnY3JlZGVudGlhbHMudXNlcm5hbWUnLCB0aGlzLnVzZXJuYW1lKTtcbiAgICB9XG5cbiAgICB0aGlzLmF1dGgudXNlcm5hbWUgPSB0aGlzLnVzZXJuYW1lO1xuICB9XG5cbiAgYXN5bmMgcHVsbCgpIHtcbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogUHVsbGluZyBtYXN0ZXIgd2l0aCBmYXN0LWZvcndhcmQgbWVyZ2VcIik7XG5cbiAgICByZXR1cm4gYXdhaXQgZ2l0LnB1bGwoe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICBzaW5nbGVCcmFuY2g6IHRydWUsXG4gICAgICBmYXN0Rm9yd2FyZE9ubHk6IHRydWUsXG4gICAgICBmYXN0OiB0cnVlLFxuICAgICAgLi4udGhpcy5hdXRoLFxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgc3RhZ2UocGF0aFNwZWNzOiBzdHJpbmdbXSkge1xuICAgIGxvZy52ZXJib3NlKGBTU0U6IEdpdENvbnRyb2xsZXI6IEFkZGluZyBjaGFuZ2VzOiAke3BhdGhTcGVjcy5qb2luKCcsICcpfWApO1xuXG4gICAgZm9yIChjb25zdCBwYXRoU3BlYyBvZiBwYXRoU3BlY3MpIHtcbiAgICAgIGF3YWl0IGdpdC5hZGQoe1xuICAgICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgICAgZmlsZXBhdGg6IHBhdGhTcGVjLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgY29tbWl0KG1zZzogc3RyaW5nKSB7XG4gICAgbG9nLnZlcmJvc2UoYFNTRTogR2l0Q29udHJvbGxlcjogQ29tbWl0dGluZyB3aXRoIG1lc3NhZ2UgJHttc2d9YCk7XG5cbiAgICByZXR1cm4gYXdhaXQgZ2l0LmNvbW1pdCh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIG1lc3NhZ2U6IG1zZyxcbiAgICAgIGF1dGhvcjoge30sICAvLyBnaXQtY29uZmlnIHZhbHVlcyB3aWxsIGJlIHVzZWRcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGZldGNoUmVtb3RlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IGdpdC5mZXRjaCh7IGRpcjogdGhpcy53b3JrRGlyLCByZW1vdGU6IE1BSU5fUkVNT1RFLCAuLi50aGlzLmF1dGggfSk7XG4gIH1cblxuICBhc3luYyBmZXRjaFVwc3RyZWFtKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IGdpdC5mZXRjaCh7IGRpcjogdGhpcy53b3JrRGlyLCByZW1vdGU6IFVQU1RSRUFNX1JFTU9URSwgLi4udGhpcy5hdXRoIH0pO1xuICB9XG5cbiAgYXN5bmMgcHVzaChmb3JjZSA9IGZhbHNlKSB7XG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IFB1c2hpbmdcIik7XG5cbiAgICByZXR1cm4gYXdhaXQgZ2l0LnB1c2goe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICByZW1vdGU6IE1BSU5fUkVNT1RFLFxuICAgICAgZm9yY2U6IGZvcmNlLFxuICAgICAgLi4udGhpcy5hdXRoLFxuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHJlc2V0RmlsZXMocGF0aHM/OiBzdHJpbmdbXSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnN0YWdpbmdMb2NrLmFjcXVpcmUoJzEnLCBhc3luYyAoKSA9PiB7XG4gICAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogRm9yY2UgcmVzZXR0aW5nIGZpbGVzXCIpO1xuXG4gICAgICByZXR1cm4gYXdhaXQgZ2l0LmZhc3RDaGVja291dCh7XG4gICAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgICBmb3JjZTogdHJ1ZSxcbiAgICAgICAgZmlsZXBhdGhzOiBwYXRocyB8fCAoYXdhaXQgdGhpcy5saXN0Q2hhbmdlZEZpbGVzKCkpLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBnZXRPcmlnaW5VcmwoKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gICAgcmV0dXJuICgoYXdhaXQgZ2l0Lmxpc3RSZW1vdGVzKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgIH0pKS5maW5kKHIgPT4gci5yZW1vdGUgPT09IE1BSU5fUkVNT1RFKSB8fCB7IHVybDogbnVsbCB9KS51cmw7XG4gIH1cblxuICBhc3luYyBnZXRVcHN0cmVhbVVybCgpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICByZXR1cm4gKChhd2FpdCBnaXQubGlzdFJlbW90ZXMoe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgfSkpLmZpbmQociA9PiByLnJlbW90ZSA9PT0gVVBTVFJFQU1fUkVNT1RFKSB8fCB7IHVybDogbnVsbCB9KS51cmw7XG4gIH1cblxuICBhc3luYyBsaXN0TG9jYWxDb21taXRzKCk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICAvKiBSZXR1cm5zIGEgbGlzdCBvZiBjb21taXQgbWVzc2FnZXMgZm9yIGNvbW1pdHMgdGhhdCB3ZXJlIG5vdCBwdXNoZWQgeWV0LlxuXG4gICAgICAgVXNlZnVsIHRvIGNoZWNrIHdoaWNoIGNvbW1pdHMgd2lsbCBiZSB0aHJvd24gb3V0XG4gICAgICAgaWYgd2UgZm9yY2UgdXBkYXRlIHRvIHJlbW90ZSBtYXN0ZXIuXG5cbiAgICAgICBEb2VzIHNvIGJ5IHdhbGtpbmcgdGhyb3VnaCBsYXN0IDEwMCBjb21taXRzIHN0YXJ0aW5nIGZyb20gY3VycmVudCBIRUFELlxuICAgICAgIFdoZW4gaXQgZW5jb3VudGVycyB0aGUgZmlyc3QgbG9jYWwgY29tbWl0IHRoYXQgZG9lc27igJl0IGRlc2NlbmRzIGZyb20gcmVtb3RlIG1hc3RlciBIRUFELFxuICAgICAgIGl0IGNvbnNpZGVycyBhbGwgcHJlY2VkaW5nIGNvbW1pdHMgdG8gYmUgYWhlYWQvbG9jYWwgYW5kIHJldHVybnMgdGhlbS5cblxuICAgICAgIElmIGl0IGZpbmlzaGVzIHRoZSB3YWxrIHdpdGhvdXQgZmluZGluZyBhbiBhbmNlc3RvciwgdGhyb3dzIGFuIGVycm9yLlxuICAgICAgIEl0IGlzIGFzc3VtZWQgdGhhdCB0aGUgYXBwIGRvZXMgbm90IGFsbG93IHRvIGFjY3VtdWxhdGVcbiAgICAgICBtb3JlIHRoYW4gMTAwIGNvbW1pdHMgd2l0aG91dCBwdXNoaW5nIChldmVuIDEwMCBpcyB0b28gbWFueSEpLFxuICAgICAgIHNvIHRoZXJl4oCZcyBwcm9iYWJseSBzb21ldGhpbmcgc3RyYW5nZSBnb2luZyBvbi5cblxuICAgICAgIE90aGVyIGFzc3VtcHRpb25zOlxuXG4gICAgICAgKiBnaXQubG9nIHJldHVybnMgY29tbWl0cyBmcm9tIG5ld2VzdCB0byBvbGRlc3QuXG4gICAgICAgKiBUaGUgcmVtb3RlIHdhcyBhbHJlYWR5IGZldGNoZWQuXG5cbiAgICAqL1xuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc3RhZ2luZ0xvY2suYWNxdWlyZSgnMScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGxhdGVzdFJlbW90ZUNvbW1pdCA9IGF3YWl0IGdpdC5yZXNvbHZlUmVmKHtcbiAgICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICAgIHJlZjogYCR7TUFJTl9SRU1PVEV9L21hc3RlcmAsXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgbG9jYWxDb21taXRzID0gYXdhaXQgZ2l0LmxvZyh7XG4gICAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgICBkZXB0aDogMTAwLFxuICAgICAgfSk7XG5cbiAgICAgIHZhciBjb21taXRzID0gW10gYXMgc3RyaW5nW107XG4gICAgICBmb3IgKGNvbnN0IGNvbW1pdCBvZiBsb2NhbENvbW1pdHMpIHtcbiAgICAgICAgaWYgKGF3YWl0IGdpdC5pc0Rlc2NlbmRlbnQoeyBkaXI6IHRoaXMud29ya0Rpciwgb2lkOiBjb21taXQub2lkLCBhbmNlc3RvcjogbGF0ZXN0UmVtb3RlQ29tbWl0IH0pKSB7XG4gICAgICAgICAgY29tbWl0cy5wdXNoKGNvbW1pdC5tZXNzYWdlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gY29tbWl0cztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJEaWQgbm90IGZpbmQgYSBsb2NhbCBjb21taXQgdGhhdCBpcyBhbiBhbmNlc3RvciBvZiByZW1vdGUgbWFzdGVyXCIpO1xuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGxpc3RDaGFuZ2VkRmlsZXMocGF0aFNwZWNzID0gWycuJ10pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgLyogTGlzdHMgcmVsYXRpdmUgcGF0aHMgdG8gYWxsIGZpbGVzIHRoYXQgd2VyZSBjaGFuZ2VkIGFuZCBoYXZlIG5vdCBiZWVuIGNvbW1pdHRlZC4gKi9cblxuICAgIGNvbnN0IEZJTEUgPSAwLCBIRUFEID0gMSwgV09SS0RJUiA9IDI7XG5cbiAgICByZXR1cm4gKGF3YWl0IGdpdC5zdGF0dXNNYXRyaXgoeyBkaXI6IHRoaXMud29ya0RpciwgZmlsZXBhdGhzOiBwYXRoU3BlY3MgfSkpXG4gICAgICAuZmlsdGVyKHJvdyA9PiByb3dbSEVBRF0gIT09IHJvd1tXT1JLRElSXSlcbiAgICAgIC5tYXAocm93ID0+IHJvd1tGSUxFXSlcbiAgICAgIC5maWx0ZXIoZmlsZXBhdGggPT4gIWZpbGVwYXRoLnN0YXJ0c1dpdGgoJy4uJykpO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHN0YWdlQW5kQ29tbWl0KHBhdGhTcGVjczogc3RyaW5nW10sIG1zZzogc3RyaW5nKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICAvKiBTdGFnZXMgYW5kIGNvbW1pdHMgZmlsZXMgbWF0Y2hpbmcgZ2l2ZW4gcGF0aCBzcGVjIHdpdGggZ2l2ZW4gbWVzc2FnZS5cblxuICAgICAgIEFueSBvdGhlciBmaWxlcyBzdGFnZWQgYXQgdGhlIHRpbWUgb2YgdGhlIGNhbGwgd2lsbCBiZSB1bnN0YWdlZC5cblxuICAgICAgIFJldHVybnMgdGhlIG51bWJlciBvZiBtYXRjaGluZyBmaWxlcyB3aXRoIHVuc3RhZ2VkIGNoYW5nZXMgcHJpb3IgdG8gc3RhZ2luZy5cbiAgICAgICBJZiBubyBtYXRjaGluZyBmaWxlcyB3ZXJlIGZvdW5kIGhhdmluZyB1bnN0YWdlZCBjaGFuZ2VzLFxuICAgICAgIHNraXBzIHRoZSByZXN0IGFuZCByZXR1cm5zIHplcm8uXG5cbiAgICAgICBJZiBmYWlsSWZEaXZlcmdlZCBpcyBnaXZlbiwgYXR0ZW1wdHMgYSBmYXN0LWZvcndhcmQgcHVsbCBhZnRlciB0aGUgY29tbWl0LlxuICAgICAgIEl0IHdpbGwgZmFpbCBpbW1lZGlhdGVseSBpZiBtYWluIHJlbW90ZSBoYWQgb3RoZXIgY29tbWl0cyBhcHBlYXIgaW4gbWVhbnRpbWUuXG5cbiAgICAgICBMb2NrcyBzbyB0aGF0IHRoaXMgbWV0aG9kIGNhbm5vdCBiZSBydW4gY29uY3VycmVudGx5IChieSBzYW1lIGluc3RhbmNlKS5cbiAgICAqL1xuXG4gICAgaWYgKHBhdGhTcGVjcy5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJXYXNu4oCZdCBnaXZlbiBhbnkgcGF0aHMgdG8gY29tbWl0IVwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5zdGFnaW5nTG9jay5hY3F1aXJlKCcxJywgYXN5bmMgKCkgPT4ge1xuICAgICAgbG9nLnZlcmJvc2UoYFNTRTogR2l0Q29udHJvbGxlcjogU3RhZ2luZyBhbmQgY29tbWl0dGluZzogJHtwYXRoU3BlY3Muam9pbignLCAnKX1gKTtcblxuICAgICAgY29uc3QgZmlsZXNDaGFuZ2VkID0gKGF3YWl0IHRoaXMubGlzdENoYW5nZWRGaWxlcyhwYXRoU3BlY3MpKS5sZW5ndGg7XG4gICAgICBpZiAoZmlsZXNDaGFuZ2VkIDwgMSkge1xuICAgICAgICByZXR1cm4gMDtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy51bnN0YWdlQWxsKCk7XG4gICAgICBhd2FpdCB0aGlzLnN0YWdlKHBhdGhTcGVjcyk7XG4gICAgICBhd2FpdCB0aGlzLmNvbW1pdChtc2cpO1xuXG4gICAgICByZXR1cm4gZmlsZXNDaGFuZ2VkO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB1bnN0YWdlQWxsKCkge1xuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBVbnN0YWdpbmcgYWxsIGNoYW5nZXNcIik7XG4gICAgYXdhaXQgZ2l0LnJlbW92ZSh7IGRpcjogdGhpcy53b3JrRGlyLCBmaWxlcGF0aDogJy4nIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBfaGFuZGxlR2l0RXJyb3IoZTogRXJyb3IgJiB7IGNvZGU6IHN0cmluZyB9KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKGUuY29kZSA9PT0gJ0Zhc3RGb3J3YXJkRmFpbCcgfHwgZS5jb2RlID09PSAnTWVyZ2VOb3RTdXBwb3J0ZWRGYWlsJykge1xuICAgICAgLy8gTk9URTogVGhlcmXigJlzIGFsc28gUHVzaFJlamVjdGVkTm9uRmFzdEZvcndhcmQsIGJ1dCBpdCBzZWVtcyB0byBiZSB0aHJvd25cbiAgICAgIC8vIGZvciB1bnJlbGF0ZWQgY2FzZXMgZHVyaW5nIHB1c2ggKGZhbHNlIHBvc2l0aXZlKS5cbiAgICAgIC8vIEJlY2F1c2Ugb2YgdGhhdCBmYWxzZSBwb3NpdGl2ZSwgd2UgaWdub3JlIHRoYXQgZXJyb3IgYW5kIGluc3RlYWQgZG8gcHVsbCBmaXJzdCxcbiAgICAgIC8vIGNhdGNoaW5nIGFjdHVhbCBmYXN0LWZvcndhcmQgZmFpbHMgb24gdGhhdCBzdGVwIGJlZm9yZSBwdXNoLlxuICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IHN0YXR1c1JlbGF0aXZlVG9Mb2NhbDogJ2RpdmVyZ2VkJyB9KTtcbiAgICB9IGVsc2UgaWYgKFsnTWlzc2luZ1VzZXJuYW1lRXJyb3InLCAnTWlzc2luZ0F1dGhvckVycm9yJywgJ01pc3NpbmdDb21taXR0ZXJFcnJvciddLmluZGV4T2YoZS5jb2RlKSA+PSAwKSB7XG4gICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaXNNaXNjb25maWd1cmVkOiB0cnVlIH0pO1xuICAgIH0gZWxzZSBpZiAoZS5jb2RlID09PSAnTWlzc2luZ1Bhc3N3b3JkVG9rZW5FcnJvcicgfHwgKGUuY29kZSA9PT0gJ0hUVFBFcnJvcicgJiYgZS5tZXNzYWdlLmluZGV4T2YoJ1VuYXV0aG9yaXplZCcpID49IDApKSB7XG4gICAgICB0aGlzLnNldFBhc3N3b3JkKHVuZGVmaW5lZCk7XG4gICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgbmVlZHNQYXNzd29yZDogdHJ1ZSB9KTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgY2hlY2tVbmNvbW1pdHRlZCgpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAvKiBDaGVja3MgZm9yIGFueSB1bmNvbW1pdHRlZCBjaGFuZ2VzIGxvY2FsbHkgcHJlc2VudC5cbiAgICAgICBOb3RpZmllcyBhbGwgd2luZG93cyBhYm91dCB0aGUgc3RhdHVzLiAqL1xuXG4gICAgbG9nLmRlYnVnKFwiU1NFOiBHaXQ6IENoZWNraW5nIGZvciB1bmNvbW1pdHRlZCBjaGFuZ2VzXCIpO1xuICAgIGNvbnN0IGhhc1VuY29tbWl0dGVkQ2hhbmdlcyA9IChhd2FpdCB0aGlzLmxpc3RDaGFuZ2VkRmlsZXMoKSkubGVuZ3RoID4gMDtcbiAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaGFzTG9jYWxDaGFuZ2VzOiBoYXNVbmNvbW1pdHRlZENoYW5nZXMgfSk7XG4gICAgcmV0dXJuIGhhc1VuY29tbWl0dGVkQ2hhbmdlcztcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzeW5jaHJvbml6ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvKiBDaGVja3MgZm9yIGNvbm5lY3Rpb24sIGxvY2FsIGNoYW5nZXMgYW5kIHVucHVzaGVkIGNvbW1pdHMsXG4gICAgICAgdHJpZXMgdG8gcHVzaCBhbmQgcHVsbCB3aGVuIHRoZXJl4oCZcyBvcHBvcnR1bml0eS5cblxuICAgICAgIE5vdGlmaWVzIGFsbCB3aW5kb3dzIGFib3V0IHRoZSBzdGF0dXMgaW4gcHJvY2Vzcy4gKi9cblxuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXQ6IFF1ZXVlaW5nIHN5bmNcIik7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc3RhZ2luZ0xvY2suYWNxdWlyZSgnMScsIGFzeW5jICgpID0+IHtcbiAgICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXQ6IFN0YXJ0aW5nIHN5bmNcIik7XG5cbiAgICAgIGNvbnN0IGlzSW5pdGlhbGl6ZWQgPSBhd2FpdCB0aGlzLmlzSW5pdGlhbGl6ZWQoKTtcbiAgICAgIGF3YWl0IHRoaXMubG9hZEF1dGgoKTtcblxuICAgICAgbGV0IGhhc1VuY29tbWl0dGVkQ2hhbmdlczogYm9vbGVhbjtcbiAgICAgIGlmICghaXNJbml0aWFsaXplZCkge1xuICAgICAgICBoYXNVbmNvbW1pdHRlZENoYW5nZXMgPSBmYWxzZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGhhc1VuY29tbWl0dGVkQ2hhbmdlcyA9IGF3YWl0IHRoaXMuY2hlY2tVbmNvbW1pdHRlZCgpO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWhhc1VuY29tbWl0dGVkQ2hhbmdlcykge1xuXG4gICAgICAgIGNvbnN0IGlzT2ZmbGluZSA9IChhd2FpdCBjaGVja09ubGluZVN0YXR1cygpKSA9PT0gZmFsc2U7XG4gICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc09mZmxpbmUgfSk7XG5cbiAgICAgICAgaWYgKCFpc09mZmxpbmUpIHtcblxuICAgICAgICAgIGNvbnN0IG5lZWRzUGFzc3dvcmQgPSB0aGlzLm5lZWRzUGFzc3dvcmQoKTtcbiAgICAgICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgbmVlZHNQYXNzd29yZCB9KTtcbiAgICAgICAgICBpZiAobmVlZHNQYXNzd29yZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChpc0luaXRpYWxpemVkKSB7XG4gICAgICAgICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaXNQdWxsaW5nOiB0cnVlIH0pO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wdWxsKCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IGlzUHVsbGluZzogZmFsc2UgfSk7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUdpdEVycm9yKGUpO1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaXNQdWxsaW5nOiBmYWxzZSB9KTtcblxuICAgICAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IGlzUHVzaGluZzogdHJ1ZSB9KTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMucHVzaCgpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICBsb2cuZXJyb3IoZSk7XG4gICAgICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoeyBpc1B1c2hpbmc6IGZhbHNlIH0pO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLl9oYW5kbGVHaXRFcnJvcihlKTtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYXdhaXQgc2VuZFJlbW90ZVN0YXR1cyh7IGlzUHVzaGluZzogZmFsc2UgfSk7XG5cbiAgICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoe1xuICAgICAgICAgICAgICBzdGF0dXNSZWxhdGl2ZVRvTG9jYWw6ICd1cGRhdGVkJyxcbiAgICAgICAgICAgICAgaXNNaXNjb25maWd1cmVkOiBmYWxzZSxcbiAgICAgICAgICAgICAgbmVlZHNQYXNzd29yZDogZmFsc2UsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBhd2FpdCBzZW5kUmVtb3RlU3RhdHVzKHsgaXNQdWxsaW5nOiB0cnVlIH0pO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5mb3JjZUluaXRpYWxpemUoKTtcbiAgICAgICAgICAgIGF3YWl0IHNlbmRSZW1vdGVTdGF0dXMoe1xuICAgICAgICAgICAgICBzdGF0dXNSZWxhdGl2ZVRvTG9jYWw6ICd1cGRhdGVkJyxcbiAgICAgICAgICAgICAgaXNNaXNjb25maWd1cmVkOiBmYWxzZSxcbiAgICAgICAgICAgICAgbmVlZHNQYXNzd29yZDogZmFsc2UsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG5cbiAgLyogSVBDIGVuZHBvaW50IHNldHVwICovXG5cbiAgc2V0VXBBUElFbmRwb2ludHMoKSB7XG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IFNldHRpbmcgdXAgQVBJIGVuZHBvaW50c1wiKTtcblxuICAgIGxpc3Rlbjx7IG5hbWU6IHN0cmluZywgZW1haWw6IHN0cmluZywgdXNlcm5hbWU6IHN0cmluZyB9LCB7IHN1Y2Nlc3M6IHRydWUgfT5cbiAgICAoJ2dpdC1jb25maWctc2V0JywgYXN5bmMgKHsgbmFtZSwgZW1haWwsIHVzZXJuYW1lIH0pID0+IHtcbiAgICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiByZWNlaXZlZCBnaXQtY29uZmlnLXNldCByZXF1ZXN0XCIpO1xuXG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ1NldCgndXNlci5uYW1lJywgbmFtZSk7XG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ1NldCgndXNlci5lbWFpbCcsIGVtYWlsKTtcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlnU2V0KCdjcmVkZW50aWFscy51c2VybmFtZScsIHVzZXJuYW1lKTtcblxuICAgICAgdGhpcy5hdXRoLnVzZXJuYW1lID0gdXNlcm5hbWU7XG5cbiAgICAgIHRoaXMuc3luY2hyb25pemUoKTtcblxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICAgIH0pO1xuXG4gICAgbGlzdGVuPHsgcGFzc3dvcmQ6IHN0cmluZyB9LCB7IHN1Y2Nlc3M6IHRydWUgfT5cbiAgICAoJ2dpdC1zZXQtcGFzc3dvcmQnLCBhc3luYyAoeyBwYXNzd29yZCB9KSA9PiB7XG4gICAgICAvLyBXQVJOSU5HOiBEb27igJl0IGxvZyBwYXNzd29yZFxuICAgICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IHJlY2VpdmVkIGdpdC1zZXQtcGFzc3dvcmQgcmVxdWVzdFwiKTtcblxuICAgICAgdGhpcy5zZXRQYXNzd29yZChwYXNzd29yZCk7XG4gICAgICB0aGlzLnN5bmNocm9uaXplKCk7XG5cbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgICB9KTtcblxuICAgIGxpc3Rlbjx7fSwgeyBvcmlnaW5VUkw6IHN0cmluZyB8IG51bGwsIG5hbWU6IHN0cmluZyB8IG51bGwsIGVtYWlsOiBzdHJpbmcgfCBudWxsLCB1c2VybmFtZTogc3RyaW5nIHwgbnVsbCB9PlxuICAgICgnZ2l0LWNvbmZpZy1nZXQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogcmVjZWl2ZWQgZ2l0LWNvbmZpZyByZXF1ZXN0XCIpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgb3JpZ2luVVJMOiBhd2FpdCB0aGlzLmdldE9yaWdpblVybCgpLFxuICAgICAgICBuYW1lOiBhd2FpdCB0aGlzLmNvbmZpZ0dldCgndXNlci5uYW1lJyksXG4gICAgICAgIGVtYWlsOiBhd2FpdCB0aGlzLmNvbmZpZ0dldCgndXNlci5lbWFpbCcpLFxuICAgICAgICB1c2VybmFtZTogYXdhaXQgdGhpcy5jb25maWdHZXQoJ2NyZWRlbnRpYWxzLnVzZXJuYW1lJyksXG4gICAgICAgIC8vIFBhc3N3b3JkIG11c3Qgbm90IGJlIHJldHVybmVkLCBvZiBjb3Vyc2VcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cbn1cblxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaW5pdFJlcG8oXG4gICAgd29ya0Rpcjogc3RyaW5nLFxuICAgIHVwc3RyZWFtUmVwb1VybDogc3RyaW5nLFxuICAgIGNvcnNQcm94eVVybDogc3RyaW5nLFxuICAgIGZvcmNlOiBib29sZWFuLFxuICAgIHNldHRpbmdzOiBTZXR0aW5nTWFuYWdlcixcbiAgICBjb25maWdXaW5kb3c6IFdpbmRvd09wZW5lclBhcmFtcyk6IFByb21pc2U8R2l0Q29udHJvbGxlcj4ge1xuXG4gIHNldHRpbmdzLmNvbmZpZ3VyZVBhbmUoe1xuICAgIGlkOiAnZGF0YVN5bmMnLFxuICAgIGxhYmVsOiBcIkRhdGEgc3luY2hyb25pemF0aW9uXCIsXG4gICAgaWNvbjogJ2dpdC1tZXJnZScsXG4gIH0pO1xuXG4gIHNldHRpbmdzLnJlZ2lzdGVyKG5ldyBTZXR0aW5nPHN0cmluZz4oXG4gICAgJ2dpdFJlcG9VcmwnLFxuICAgIFwiR2l0IHJlcG9zaXRvcnkgVVJMXCIsXG4gICAgJ2RhdGFTeW5jJyxcbiAgKSk7XG5cbiAgc2V0dGluZ3MucmVnaXN0ZXIobmV3IFNldHRpbmc8c3RyaW5nPihcbiAgICAnZ2l0VXNlcm5hbWUnLFxuICAgIFwiVXNlcm5hbWVcIixcbiAgICAnZGF0YVN5bmMnLFxuICApKTtcblxuICBzZXR0aW5ncy5yZWdpc3RlcihuZXcgU2V0dGluZzxzdHJpbmc+KFxuICAgICdnaXRBdXRob3JOYW1lJyxcbiAgICBcIkF1dGhvciBuYW1lXCIsXG4gICAgJ2RhdGFTeW5jJyxcbiAgKSk7XG5cbiAgc2V0dGluZ3MucmVnaXN0ZXIobmV3IFNldHRpbmc8c3RyaW5nPihcbiAgICAnZ2l0QXV0aG9yRW1haWwnLFxuICAgIFwiQXV0aG9yIGVtYWlsXCIsXG4gICAgJ2RhdGFTeW5jJyxcbiAgKSk7XG5cbiAgY29uc3QgcmVwb1VybCA9IChhd2FpdCBzZXR0aW5ncy5nZXRWYWx1ZSgnZ2l0UmVwb1VybCcpIGFzIHN0cmluZykgfHwgKGF3YWl0IHJlcXVlc3RSZXBvVXJsKGNvbmZpZ1dpbmRvdykpO1xuXG4gIGNvbnN0IGF1dGhvck5hbWUgPSBhd2FpdCBzZXR0aW5ncy5nZXRWYWx1ZSgnZ2l0QXV0aG9yTmFtZScpIGFzIHN0cmluZztcbiAgY29uc3QgYXV0aG9yRW1haWwgPSBhd2FpdCBzZXR0aW5ncy5nZXRWYWx1ZSgnZ2l0QXV0aG9yRW1haWwnKSBhcyBzdHJpbmc7XG4gIGNvbnN0IHVzZXJuYW1lID0gYXdhaXQgc2V0dGluZ3MuZ2V0VmFsdWUoJ2dpdFVzZXJuYW1lJykgYXMgc3RyaW5nO1xuXG4gIGNvbnN0IGdpdEN0cmwgPSBuZXcgR2l0Q29udHJvbGxlcihmcywgcmVwb1VybCwgYXV0aG9yTmFtZSwgYXV0aG9yRW1haWwsIHVzZXJuYW1lLCB1cHN0cmVhbVJlcG9VcmwsIHdvcmtEaXIsIGNvcnNQcm94eVVybCk7XG5cbiAgaWYgKGF3YWl0IGdpdEN0cmwuaXNJbml0aWFsaXplZCgpKSB7XG4gICAgYXdhaXQgZ2l0Q3RybC5sb2FkQXV0aCgpO1xuICB9XG5cbiAgcmV0dXJuIGdpdEN0cmw7XG59XG5cblxuLyogUHJvbWlzZXMgdG8gcmV0dXJuIGFuIG9iamVjdCBjb250YWluaW5nIHN0cmluZyB3aXRoIHJlcG9zaXRvcnkgVVJMXG4gICBhbmQgYSBmbGFnIGluZGljYXRpbmcgd2hldGhlciBpdOKAmXMgYmVlbiByZXNldFxuICAgKHdoaWNoIGlmIHRydWUgd291bGQgY2F1c2UgYGluaXRSZXBvKClgIHRvIHJlaW5pdGlhbGl6ZSB0aGUgcmVwb3NpdG9yeSkuXG5cbiAgIElmIHJlcG9zaXRvcnkgVVJMIGlzIG5vdCBjb25maWd1cmVkIChlLmcuLCBvbiBmaXJzdCBydW4sIG9yIGFmdGVyIHJlc2V0KVxuICAgb3BlbnMgYSB3aW5kb3cgd2l0aCBzcGVjaWZpZWQgb3B0aW9ucyB0byBhc2sgdGhlIHVzZXIgdG8gcHJvdmlkZSB0aGUgc2V0dGluZy5cbiAgIFRoZSB3aW5kb3cgaXMgZXhwZWN0ZWQgdG8gYXNrIHRoZSB1c2VyIHRvIHNwZWNpZnkgdGhlIFVSTCBhbmQgc2VuZCBhIGAnc2V0LXNldHRpbmcnYFxuICAgZXZlbnQgZm9yIGAnZ2l0UmVwb1VybCdgLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlcXVlc3RSZXBvVXJsKGNvbmZpZ1dpbmRvdzogV2luZG93T3BlbmVyUGFyYW1zKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlPHN0cmluZz4oYXN5bmMgKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuXG4gICAgbG9nLndhcm4oXCJTU0U6IEdpdENvbnRyb2xsZXI6IE9wZW4gY29uZmlnIHdpbmRvdyB0byBjb25maWd1cmUgcmVwbyBVUkxcIik7XG5cbiAgICBpcGNNYWluLm9uKCdzZXQtc2V0dGluZycsIGhhbmRsZVNldHRpbmcpO1xuXG4gICAgZnVuY3Rpb24gaGFuZGxlU2V0dGluZyhldnQ6IGFueSwgbmFtZTogc3RyaW5nLCB2YWx1ZTogc3RyaW5nKSB7XG4gICAgICBpZiAobmFtZSA9PT0gJ2dpdFJlcG9VcmwnKSB7XG4gICAgICAgIGxvZy5pbmZvKFwiU1NFOiBHaXRDb250cm9sbGVyOiByZWNlaXZlZCBnaXRSZXBvVXJsIHNldHRpbmdcIik7XG4gICAgICAgIGlwY01haW4ucmVtb3ZlTGlzdGVuZXIoJ3NldC1zZXR0aW5nJywgaGFuZGxlU2V0dGluZyk7XG4gICAgICAgIHJlc29sdmUodmFsdWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IG9wZW5XaW5kb3coY29uZmlnV2luZG93KTtcblxuICB9KTtcbn1cblxuXG5hc3luYyBmdW5jdGlvbiBjaGVja09ubGluZVN0YXR1cygpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgbGV0IGlzT2ZmbGluZTogYm9vbGVhbjtcbiAgdHJ5IHtcbiAgICBhd2FpdCBkbnMucHJvbWlzZXMubG9va3VwKCdnaXRodWIuY29tJyk7XG4gICAgaXNPZmZsaW5lID0gZmFsc2U7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpc09mZmxpbmUgPSB0cnVlO1xuICB9XG4gIHJldHVybiAhaXNPZmZsaW5lO1xufVxuXG5cbmFzeW5jIGZ1bmN0aW9uIHNlbmRSZW1vdGVTdGF0dXModXBkYXRlOiBQYXJ0aWFsPFJlbW90ZVN0b3JhZ2VTdGF0dXM+KSB7XG4gIGF3YWl0IG5vdGlmeUFsbFdpbmRvd3MoJ3JlbW90ZS1zdG9yYWdlLXN0YXR1cycsIHVwZGF0ZSk7XG59XG4iXX0=