import * as path from 'path';
import * as fs from 'fs-extra';
import AsyncLock from 'async-lock';
import * as git from 'isomorphic-git';
import * as log from 'electron-log';
import { ipcMain } from 'electron';
import { listen } from '../../api/main';
import { Setting } from '../../settings/main';
import { openWindow } from '../../main/window';
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
        this.stagingLock = new AsyncLock();
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
    async loadAuth() {
        /* Configure auth with git-config username, if set.
           Supposed to be happening automatically? Maybe not.
           This method must be manually called before making operations that need auth. */
        const username = await this.configGet('credentials.username');
        if (username) {
            this.auth.username = username;
        }
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
    async pull() {
        log.verbose("SSE: GitController: Pulling master with fast-forward merge");
        return await git.pull(Object.assign({ dir: this.workDir, singleBranch: true, fastForwardOnly: true }, this.auth));
    }
    async listChangedFiles(pathSpecs = ['.']) {
        /* Lists relative paths to all files that were changed and have not been committed. */
        const FILE = 0, HEAD = 1, WORKDIR = 2;
        return (await git.statusMatrix({ dir: this.workDir, filepaths: pathSpecs }))
            .filter(row => row[HEAD] !== row[WORKDIR])
            .map(row => row[FILE])
            .filter(filepath => !filepath.startsWith('..'));
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
        return this.stagingLock.acquire('1', async () => {
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
    }
    async fetchRemote() {
        await git.fetch({ dir: this.workDir, remote: MAIN_REMOTE });
    }
    async push(force = false) {
        log.verbose("SSE: GitController: Pushing");
        return await git.push(Object.assign({ dir: this.workDir, remote: MAIN_REMOTE, force: force }, this.auth));
    }
    async resetFiles(paths) {
        log.verbose("SSE: GitController: Force resetting files");
        return await git.fastCheckout({
            dir: this.workDir,
            force: true,
            filepaths: paths,
        });
    }
    /* Fork/upstream workflow.
  
       Operates two remotes, origin (for author’s individual fork) and upstream.
  
       Allows to reset to upstream.
  
       WARNING: resetting to upstream will cause data loss
       if there are local changes or fork (origin) is ahead of upstream.
  
       Does not handle incorporating changes from the fork into upstream.
       The author is expected to create a pull request from their fork to upstream
       using hosted Git service GUI.
    */
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
    async fetchUpstream() {
        await git.fetch({ dir: this.workDir, remote: UPSTREAM_REMOTE });
    }
    // These are broken.
    // async upstreamIsAhead(): Promise<boolean> {
    //   // Consider upstream ahead if our current HEAD is a descendant of latest upstream commit
    //   const headRef = await git.resolveRef({ dir: this.workDir, ref: 'HEAD' });
    //   const latestUpstreamRef = await git.resolveRef({ dir: this.workDir, ref: `${UPSTREAM_REMOTE}/master` });
    //   return await git.isDescendent({ dir: this.workDir, oid: headRef, ancestor: latestUpstreamRef, depth: -1 });
    // }
    // async isAheadOfUpstream(): Promise<boolean> {
    //   // If we have local changes, we’re definitely ahead
    //   // const filesLocallyModified = await this.listChangedFiles();
    //   // if (filesLocallyModified.length > 0) {
    //   //   return true;
    //   // }
    //   // Consider us ahead if latest upstream commit is a descendant of our current HEAD
    //   const headRef = await git.resolveRef({ dir: this.workDir, ref: 'HEAD' });
    //   const latestUpstreamRef = await git.resolveRef({ dir: this.workDir, ref: `${UPSTREAM_REMOTE}/master` });
    //   return await git.isDescendent({ dir: this.workDir, oid: latestUpstreamRef, ancestor: headRef, depth: -1 });
    // }
    async resetToUpstream() {
        const gitDir = path.join(this.workDir, '.git');
        await git.fetch({ dir: this.workDir, remote: UPSTREAM_REMOTE });
        const latestUpstreamRef = await git.resolveRef({ dir: this.workDir, ref: `${UPSTREAM_REMOTE}/master` });
        // Equivalent of resetting repo to given commit
        await fs.writeFile(path.join(gitDir, 'refs', 'heads', 'master'), latestUpstreamRef);
        await fs.unlink(path.join(gitDir, 'index'));
        await git.checkout({ dir: this.workDir, ref: 'master' });
        await this.push(true);
        return { success: true };
    }
    /* API setup */
    setUpAPIEndpoints() {
        log.verbose("SSE: GitController: Setting up API endpoints");
        listen('git-config-set', async ({ name, email, username }) => {
            log.verbose("SSE: GitController: received git-config-set request");
            await this.configSet('user.name', name);
            await this.configSet('user.email', email);
            await this.configSet('credentials.username', username);
            this.auth.username = username;
            return { errors: [] };
        });
        listen('git-set-password', async ({ password }) => {
            // WARNING: Don’t log password
            log.verbose("SSE: GitController: received git-set-password request");
            this.setPassword(password);
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
        listen('list-local-changes', async () => {
            log.verbose("SSE: GitController: received list-local-changes request");
            return { filenames: await this.listChangedFiles() };
        });
        listen('discard-local-changes', async ({ paths }) => {
            log.verbose(`SSE: GitController: received discard-local-changes with files ${paths.join(', ')}`);
            await this.resetFiles(paths);
            return { success: true };
        });
        listen('commit-files', async ({ paths, commitMsg }) => {
            log.verbose(`SSE: GitController: received commit-files with files ${paths.join(', ')} and message ${commitMsg}`);
            await this.stageAndCommit(paths, commitMsg);
            return { success: true };
        });
        listen('sync-to-remote', async () => {
            log.verbose("SSE: GitController: received sync-to-remote request");
            try {
                await this.push();
            }
            catch (e) {
                return { errors: [`Error syncing to remote: ${e.toString()}`] };
            }
            return { errors: [] };
        });
    }
}
export async function initRepo(workDir, repoUrl, upstreamRepoUrl, corsProxyUrl, force) {
    const gitCtrl = new GitController(fs, repoUrl, upstreamRepoUrl, workDir, corsProxyUrl);
    const isInitialized = await gitCtrl.isInitialized();
    const remotesMatch = await gitCtrl.isUsingRemoteURLs({ origin: repoUrl, upstream: upstreamRepoUrl });
    if (isInitialized === true && remotesMatch === true && force === false) {
        log.verbose("SSE: GitController: Already initialized");
    }
    else {
        log.warn("SSE: GitController is not initialized, has mismatching remote URLs, or force is true");
        log.debug(`SSE: GitController: remotes match: ${remotesMatch}`);
        log.debug(`SSE: GitController: force is ${force}`);
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
export async function setRepoUrl(configWindow, settings) {
    settings.configurePane({
        id: 'dataSync',
        label: "Data synchronization",
        icon: 'git-merge',
    });
    settings.register(new Setting('gitRepoUrl', "Git repository URL", 'dataSync'));
    const repoUrl = await settings.getValue('gitRepoUrl');
    if (repoUrl) {
        log.warn("SSE: GitController: Repo URL found in settings, skip config window");
        return Promise.resolve({ url: repoUrl, hasChanged: false });
    }
    else {
        return new Promise(async (resolve, reject) => {
            log.warn("SSE: GitController: Repo URL not set, open initial config window to let user configure");
            await openWindow(configWindow);
            ipcMain.on('set-setting', handleSetting);
            function handleSetting(evt, name, value) {
                if (name === 'gitRepoUrl') {
                    log.info("SSE: GitController: received gitRepoUrl setting");
                    ipcMain.removeListener('set-setting', handleSetting);
                    resolve({ url: value, hasChanged: true });
                }
                evt.reply('ok');
            }
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2l0LWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3RvcmFnZS9tYWluL2dpdC1jb250cm9sbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sS0FBSyxJQUFJLE1BQU0sTUFBTSxDQUFDO0FBQzdCLE9BQU8sS0FBSyxFQUFFLE1BQU0sVUFBVSxDQUFDO0FBQy9CLE9BQU8sU0FBUyxNQUFNLFlBQVksQ0FBQztBQUNuQyxPQUFPLEtBQUssR0FBRyxNQUFNLGdCQUFnQixDQUFDO0FBQ3RDLE9BQU8sS0FBSyxHQUFHLE1BQU0sY0FBYyxDQUFDO0FBRXBDLE9BQU8sRUFBRSxPQUFPLEVBQUUsTUFBTSxVQUFVLENBQUM7QUFFbkMsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLGdCQUFnQixDQUFDO0FBQ3hDLE9BQU8sRUFBRSxPQUFPLEVBQWtCLE1BQU0scUJBQXFCLENBQUM7QUFDOUQsT0FBTyxFQUFzQixVQUFVLEVBQUUsTUFBTSxtQkFBbUIsQ0FBQztBQUtuRSxNQUFNLGVBQWUsR0FBRyxVQUFVLENBQUM7QUFDbkMsTUFBTSxXQUFXLEdBQUcsUUFBUSxDQUFDO0FBRzdCLE1BQU0sT0FBTyxhQUFhO0lBTXhCLFlBQ1ksRUFBTyxFQUNQLE9BQWUsRUFDZixlQUF1QixFQUN4QixPQUFlLEVBQ2QsU0FBaUI7UUFKakIsT0FBRSxHQUFGLEVBQUUsQ0FBSztRQUNQLFlBQU8sR0FBUCxPQUFPLENBQVE7UUFDZixvQkFBZSxHQUFmLGVBQWUsQ0FBUTtRQUN4QixZQUFPLEdBQVAsT0FBTyxDQUFRO1FBQ2QsY0FBUyxHQUFULFNBQVMsQ0FBUTtRQVRyQixTQUFJLEdBQXNCLEVBQUUsQ0FBQztRQVduQyxHQUFHLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFMUIsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLFNBQVMsRUFBRSxDQUFDO0lBQ3JDLENBQUM7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LE9BQU8sQ0FBdUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUNqRixHQUFHLENBQUMsSUFBSSxDQUFDLHdGQUF3RixDQUFDLENBQUM7WUFFbkcsTUFBTSxVQUFVLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDL0IsT0FBTyxDQUFDLEVBQUUsQ0FBQyxhQUFhLEVBQUUsYUFBYSxDQUFDLENBQUM7WUFFekMsU0FBUyxhQUFhLENBQUMsR0FBUSxFQUFFLElBQVksRUFBRSxLQUFhO2dCQUMxRCxJQUFJLElBQUksS0FBSyxZQUFZLEVBQUU7b0JBQ3pCLEdBQUcsQ0FBQyxJQUFJLENBQUMsaURBQWlELENBQUMsQ0FBQztvQkFDNUQsT0FBTyxDQUFDLGNBQWMsQ0FBQyxhQUFhLEVBQUUsYUFBYSxDQUFDLENBQUM7b0JBQ3JELE9BQU8sQ0FBQyxFQUFFLEdBQUcsRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7aUJBQzNDO2dCQUNELEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDbEIsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDO0tBQ0o7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzLWV4dHJhJztcbmltcG9ydCBBc3luY0xvY2sgZnJvbSAnYXN5bmMtbG9jayc7XG5pbXBvcnQgKiBhcyBnaXQgZnJvbSAnaXNvbW9ycGhpYy1naXQnO1xuaW1wb3J0ICogYXMgbG9nIGZyb20gJ2VsZWN0cm9uLWxvZyc7XG5cbmltcG9ydCB7IGlwY01haW4gfSBmcm9tICdlbGVjdHJvbic7XG5cbmltcG9ydCB7IGxpc3RlbiB9IGZyb20gJy4uLy4uL2FwaS9tYWluJztcbmltcG9ydCB7IFNldHRpbmcsIFNldHRpbmdNYW5hZ2VyIH0gZnJvbSAnLi4vLi4vc2V0dGluZ3MvbWFpbic7XG5pbXBvcnQgeyBXaW5kb3dPcGVuZXJQYXJhbXMsIG9wZW5XaW5kb3cgfSBmcm9tICcuLi8uLi9tYWluL3dpbmRvdyc7XG5cbmltcG9ydCB7IEdpdEF1dGhlbnRpY2F0aW9uIH0gZnJvbSAnLi4vZ2l0JztcblxuXG5jb25zdCBVUFNUUkVBTV9SRU1PVEUgPSAndXBzdHJlYW0nO1xuY29uc3QgTUFJTl9SRU1PVEUgPSAnb3JpZ2luJztcblxuXG5leHBvcnQgY2xhc3MgR2l0Q29udHJvbGxlciB7XG5cbiAgcHJpdmF0ZSBhdXRoOiBHaXRBdXRoZW50aWNhdGlvbiA9IHt9O1xuXG4gIHByaXZhdGUgc3RhZ2luZ0xvY2s6IEFzeW5jTG9jaztcblxuICBjb25zdHJ1Y3RvcihcbiAgICAgIHByaXZhdGUgZnM6IGFueSxcbiAgICAgIHByaXZhdGUgcmVwb1VybDogc3RyaW5nLFxuICAgICAgcHJpdmF0ZSB1cHN0cmVhbVJlcG9Vcmw6IHN0cmluZyxcbiAgICAgIHB1YmxpYyB3b3JrRGlyOiBzdHJpbmcsXG4gICAgICBwcml2YXRlIGNvcnNQcm94eTogc3RyaW5nKSB7XG5cbiAgICBnaXQucGx1Z2lucy5zZXQoJ2ZzJywgZnMpO1xuXG4gICAgdGhpcy5zdGFnaW5nTG9jayA9IG5ldyBBc3luY0xvY2soKTtcbiAgfVxuXG4gIGFzeW5jIGlzSW5pdGlhbGl6ZWQoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgbGV0IGhhc0dpdERpcmVjdG9yeTogYm9vbGVhbjtcbiAgICB0cnkge1xuICAgICAgaGFzR2l0RGlyZWN0b3J5ID0gKGF3YWl0IHRoaXMuZnMuc3RhdChwYXRoLmpvaW4odGhpcy53b3JrRGlyLCAnLmdpdCcpKSkuaXNEaXJlY3RvcnkoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBoYXNHaXREaXJlY3RvcnkgPSBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIGhhc0dpdERpcmVjdG9yeTtcbiAgfVxuXG4gIGFzeW5jIGlzVXNpbmdSZW1vdGVVUkxzKHJlbW90ZVVybHM6IHsgb3JpZ2luOiBzdHJpbmcsIHVwc3RyZWFtOiBzdHJpbmcgfSk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IG9yaWdpbiA9IChhd2FpdCB0aGlzLmdldE9yaWdpblVybCgpIHx8ICcnKS50cmltKCk7XG4gICAgY29uc3QgdXBzdHJlYW0gPSAoYXdhaXQgdGhpcy5nZXRVcHN0cmVhbVVybCgpIHx8ICcnKS50cmltKCk7XG4gICAgcmV0dXJuIG9yaWdpbiA9PT0gcmVtb3RlVXJscy5vcmlnaW4gJiYgdXBzdHJlYW0gPT09IHJlbW90ZVVybHMudXBzdHJlYW07XG4gIH1cblxuICBuZWVkc1Bhc3N3b3JkKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiAodGhpcy5hdXRoLnBhc3N3b3JkIHx8ICcnKS50cmltKCkgPT09ICcnO1xuICB9XG5cbiAgYXN5bmMgZm9yY2VJbml0aWFsaXplKCkge1xuICAgIC8qIEluaXRpYWxpemVzIGZyb20gc2NyYXRjaDogd2lwZXMgd29yayBkaXJlY3RvcnksIGNsb25lcyBhZ2FpbiwgYWRkcyByZW1vdGVzLiAqL1xuXG4gICAgbG9nLndhcm4oXCJTU0U6IEdpdENvbnRyb2xsZXI6IEZvcmNlIGluaXRpYWxpemluZ1wiKTtcbiAgICBsb2cud2FybihcIlNTRTogR2l0Q29udHJvbGxlcjogSW5pdGlhbGl6ZTogUmVtb3ZpbmcgZGF0YSBkaXJlY3RvcnlcIik7XG5cbiAgICBhd2FpdCB0aGlzLmZzLnJlbW92ZSh0aGlzLndvcmtEaXIpO1xuXG4gICAgbG9nLnNpbGx5KFwiU1NFOiBHaXRDb250cm9sbGVyOiBJbml0aWFsaXplOiBFbnN1cmluZyBkYXRhIGRpcmVjdG9yeSBleGlzdHNcIik7XG5cbiAgICBhd2FpdCB0aGlzLmZzLmVuc3VyZURpcih0aGlzLndvcmtEaXIpO1xuXG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IEluaXRpYWxpemU6IENsb25pbmdcIiwgdGhpcy5yZXBvVXJsKTtcblxuICAgIGF3YWl0IGdpdC5jbG9uZSh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIHVybDogdGhpcy5yZXBvVXJsLFxuICAgICAgcmVmOiAnbWFzdGVyJyxcbiAgICAgIHNpbmdsZUJyYW5jaDogdHJ1ZSxcbiAgICAgIGRlcHRoOiA1LFxuICAgICAgY29yc1Byb3h5OiB0aGlzLmNvcnNQcm94eSxcbiAgICAgIC4uLnRoaXMuYXV0aCxcbiAgICB9KTtcblxuICAgIGF3YWl0IGdpdC5hZGRSZW1vdGUoe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICByZW1vdGU6IFVQU1RSRUFNX1JFTU9URSxcbiAgICAgIHVybDogdGhpcy51cHN0cmVhbVJlcG9VcmwsXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBsb2FkQXV0aCgpIHtcbiAgICAvKiBDb25maWd1cmUgYXV0aCB3aXRoIGdpdC1jb25maWcgdXNlcm5hbWUsIGlmIHNldC5cbiAgICAgICBTdXBwb3NlZCB0byBiZSBoYXBwZW5pbmcgYXV0b21hdGljYWxseT8gTWF5YmUgbm90LlxuICAgICAgIFRoaXMgbWV0aG9kIG11c3QgYmUgbWFudWFsbHkgY2FsbGVkIGJlZm9yZSBtYWtpbmcgb3BlcmF0aW9ucyB0aGF0IG5lZWQgYXV0aC4gKi9cbiAgICBjb25zdCB1c2VybmFtZSA9IGF3YWl0IHRoaXMuY29uZmlnR2V0KCdjcmVkZW50aWFscy51c2VybmFtZScpO1xuICAgIGlmICh1c2VybmFtZSkge1xuICAgICAgdGhpcy5hdXRoLnVzZXJuYW1lID0gdXNlcm5hbWU7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgY29uZmlnU2V0KHByb3A6IHN0cmluZywgdmFsOiBzdHJpbmcpIHtcbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogU2V0IGNvbmZpZ1wiKTtcbiAgICBhd2FpdCBnaXQuY29uZmlnKHsgZGlyOiB0aGlzLndvcmtEaXIsIHBhdGg6IHByb3AsIHZhbHVlOiB2YWwgfSk7XG4gIH1cblxuICBhc3luYyBjb25maWdHZXQocHJvcDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogR2V0IGNvbmZpZ1wiLCBwcm9wKTtcbiAgICByZXR1cm4gYXdhaXQgZ2l0LmNvbmZpZyh7IGRpcjogdGhpcy53b3JrRGlyLCBwYXRoOiBwcm9wIH0pO1xuICB9XG5cbiAgcHVibGljIHNldFBhc3N3b3JkKHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpIHtcbiAgICB0aGlzLmF1dGgucGFzc3dvcmQgPSB2YWx1ZTtcbiAgfVxuXG4gIGFzeW5jIHB1bGwoKSB7XG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IFB1bGxpbmcgbWFzdGVyIHdpdGggZmFzdC1mb3J3YXJkIG1lcmdlXCIpO1xuXG4gICAgcmV0dXJuIGF3YWl0IGdpdC5wdWxsKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgc2luZ2xlQnJhbmNoOiB0cnVlLFxuICAgICAgZmFzdEZvcndhcmRPbmx5OiB0cnVlLFxuICAgICAgLi4udGhpcy5hdXRoLFxuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGxpc3RDaGFuZ2VkRmlsZXMocGF0aFNwZWNzID0gWycuJ10pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgLyogTGlzdHMgcmVsYXRpdmUgcGF0aHMgdG8gYWxsIGZpbGVzIHRoYXQgd2VyZSBjaGFuZ2VkIGFuZCBoYXZlIG5vdCBiZWVuIGNvbW1pdHRlZC4gKi9cblxuICAgIGNvbnN0IEZJTEUgPSAwLCBIRUFEID0gMSwgV09SS0RJUiA9IDI7XG5cbiAgICByZXR1cm4gKGF3YWl0IGdpdC5zdGF0dXNNYXRyaXgoeyBkaXI6IHRoaXMud29ya0RpciwgZmlsZXBhdGhzOiBwYXRoU3BlY3MgfSkpXG4gICAgICAuZmlsdGVyKHJvdyA9PiByb3dbSEVBRF0gIT09IHJvd1tXT1JLRElSXSlcbiAgICAgIC5tYXAocm93ID0+IHJvd1tGSUxFXSlcbiAgICAgIC5maWx0ZXIoZmlsZXBhdGggPT4gIWZpbGVwYXRoLnN0YXJ0c1dpdGgoJy4uJykpO1xuICB9XG5cbiAgYXN5bmMgc3RhZ2UocGF0aFNwZWNzOiBzdHJpbmdbXSkge1xuICAgIGxvZy52ZXJib3NlKGBTU0U6IEdpdENvbnRyb2xsZXI6IEFkZGluZyBjaGFuZ2VzOiAke3BhdGhTcGVjcy5qb2luKCcsICcpfWApO1xuXG4gICAgZm9yIChjb25zdCBwYXRoU3BlYyBvZiBwYXRoU3BlY3MpIHtcbiAgICAgIGF3YWl0IGdpdC5hZGQoe1xuICAgICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgICAgZmlsZXBhdGg6IHBhdGhTcGVjLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgY29tbWl0KG1zZzogc3RyaW5nKSB7XG4gICAgbG9nLnZlcmJvc2UoYFNTRTogR2l0Q29udHJvbGxlcjogQ29tbWl0dGluZyB3aXRoIG1lc3NhZ2UgJHttc2d9YCk7XG5cbiAgICByZXR1cm4gYXdhaXQgZ2l0LmNvbW1pdCh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIG1lc3NhZ2U6IG1zZyxcbiAgICAgIGF1dGhvcjoge30sICAvLyBnaXQtY29uZmlnIHZhbHVlcyB3aWxsIGJlIHVzZWRcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzdGFnZUFuZENvbW1pdChwYXRoU3BlY3M6IHN0cmluZ1tdLCBtc2c6IHN0cmluZyk6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgLyogU3RhZ2VzIGFuZCBjb21taXRzIGZpbGVzIG1hdGNoaW5nIGdpdmVuIHBhdGggc3BlYyB3aXRoIGdpdmVuIG1lc3NhZ2UuXG5cbiAgICAgICBBbnkgb3RoZXIgZmlsZXMgc3RhZ2VkIGF0IHRoZSB0aW1lIG9mIHRoZSBjYWxsIHdpbGwgYmUgdW5zdGFnZWQuXG5cbiAgICAgICBSZXR1cm5zIHRoZSBudW1iZXIgb2YgbWF0Y2hpbmcgZmlsZXMgd2l0aCB1bnN0YWdlZCBjaGFuZ2VzIHByaW9yIHRvIHN0YWdpbmcuXG4gICAgICAgSWYgbm8gbWF0Y2hpbmcgZmlsZXMgd2VyZSBmb3VuZCBoYXZpbmcgdW5zdGFnZWQgY2hhbmdlcyxcbiAgICAgICBza2lwcyB0aGUgcmVzdCBhbmQgcmV0dXJucyB6ZXJvLlxuXG4gICAgICAgSWYgZmFpbElmRGl2ZXJnZWQgaXMgZ2l2ZW4sIGF0dGVtcHRzIGEgZmFzdC1mb3J3YXJkIHB1bGwgYWZ0ZXIgdGhlIGNvbW1pdC5cbiAgICAgICBJdCB3aWxsIGZhaWwgaW1tZWRpYXRlbHkgaWYgbWFpbiByZW1vdGUgaGFkIG90aGVyIGNvbW1pdHMgYXBwZWFyIGluIG1lYW50aW1lLlxuXG4gICAgICAgTG9ja3Mgc28gdGhhdCB0aGlzIG1ldGhvZCBjYW5ub3QgYmUgcnVuIGNvbmN1cnJlbnRseSAoYnkgc2FtZSBpbnN0YW5jZSkuXG4gICAgKi9cblxuICAgIHJldHVybiB0aGlzLnN0YWdpbmdMb2NrLmFjcXVpcmUoJzEnLCBhc3luYyAoKSA9PiB7XG4gICAgICBsb2cudmVyYm9zZShgU1NFOiBHaXRDb250cm9sbGVyOiBTdGFnaW5nIGFuZCBjb21taXR0aW5nOiAke3BhdGhTcGVjcy5qb2luKCcsICcpfWApO1xuXG4gICAgICBjb25zdCBmaWxlc0NoYW5nZWQgPSAoYXdhaXQgdGhpcy5saXN0Q2hhbmdlZEZpbGVzKHBhdGhTcGVjcykpLmxlbmd0aDtcbiAgICAgIGlmIChmaWxlc0NoYW5nZWQgPCAxKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLnVuc3RhZ2VBbGwoKTtcbiAgICAgIGF3YWl0IHRoaXMuc3RhZ2UocGF0aFNwZWNzKTtcbiAgICAgIGF3YWl0IHRoaXMuY29tbWl0KG1zZyk7XG5cbiAgICAgIHJldHVybiBmaWxlc0NoYW5nZWQ7XG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgdW5zdGFnZUFsbCgpIHtcbiAgICBsb2cudmVyYm9zZShcIlNTRTogR2l0Q29udHJvbGxlcjogVW5zdGFnaW5nIGFsbCBjaGFuZ2VzXCIpO1xuICAgIGF3YWl0IGdpdC5yZW1vdmUoeyBkaXI6IHRoaXMud29ya0RpciwgZmlsZXBhdGg6ICcuJyB9KTtcbiAgfVxuXG4gIGFzeW5jIGxpc3RMb2NhbENvbW1pdHMoKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAgIC8qIFJldHVybnMgYSBsaXN0IG9mIGNvbW1pdCBtZXNzYWdlcyBmb3IgY29tbWl0cyB0aGF0IHdlcmUgbm90IHB1c2hlZCB5ZXQuXG5cbiAgICAgICBVc2VmdWwgdG8gY2hlY2sgd2hpY2ggY29tbWl0cyB3aWxsIGJlIHRocm93biBvdXRcbiAgICAgICBpZiB3ZSBmb3JjZSB1cGRhdGUgdG8gcmVtb3RlIG1hc3Rlci5cblxuICAgICAgIERvZXMgc28gYnkgd2Fsa2luZyB0aHJvdWdoIGxhc3QgMTAwIGNvbW1pdHMgc3RhcnRpbmcgZnJvbSBjdXJyZW50IEhFQUQuXG4gICAgICAgV2hlbiBpdCBlbmNvdW50ZXJzIHRoZSBmaXJzdCBsb2NhbCBjb21taXQgdGhhdCBkb2VzbuKAmXQgZGVzY2VuZHMgZnJvbSByZW1vdGUgbWFzdGVyIEhFQUQsXG4gICAgICAgaXQgY29uc2lkZXJzIGFsbCBwcmVjZWRpbmcgY29tbWl0cyB0byBiZSBhaGVhZC9sb2NhbCBhbmQgcmV0dXJucyB0aGVtLlxuXG4gICAgICAgSWYgaXQgZmluaXNoZXMgdGhlIHdhbGsgd2l0aG91dCBmaW5kaW5nIGFuIGFuY2VzdG9yLCB0aHJvd3MgYW4gZXJyb3IuXG4gICAgICAgSXQgaXMgYXNzdW1lZCB0aGF0IHRoZSBhcHAgZG9lcyBub3QgYWxsb3cgdG8gYWNjdW11bGF0ZVxuICAgICAgIG1vcmUgdGhhbiAxMDAgY29tbWl0cyB3aXRob3V0IHB1c2hpbmcgKGV2ZW4gMTAwIGlzIHRvbyBtYW55ISksXG4gICAgICAgc28gdGhlcmXigJlzIHByb2JhYmx5IHNvbWV0aGluZyBzdHJhbmdlIGdvaW5nIG9uLlxuXG4gICAgICAgT3RoZXIgYXNzdW1wdGlvbnM6XG5cbiAgICAgICAqIGdpdC5sb2cgcmV0dXJucyBjb21taXRzIGZyb20gbmV3ZXN0IHRvIG9sZGVzdC5cbiAgICAgICAqIFRoZSByZW1vdGUgd2FzIGFscmVhZHkgZmV0Y2hlZC5cblxuICAgICovXG5cbiAgICBjb25zdCBsYXRlc3RSZW1vdGVDb21taXQgPSBhd2FpdCBnaXQucmVzb2x2ZVJlZih7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIHJlZjogYCR7TUFJTl9SRU1PVEV9L21hc3RlcmAsXG4gICAgfSk7XG5cbiAgICBjb25zdCBsb2NhbENvbW1pdHMgPSBhd2FpdCBnaXQubG9nKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgZGVwdGg6IDEwMCxcbiAgICB9KTtcblxuICAgIHZhciBjb21taXRzID0gW10gYXMgc3RyaW5nW107XG4gICAgZm9yIChjb25zdCBjb21taXQgb2YgbG9jYWxDb21taXRzKSB7XG4gICAgICBpZiAoYXdhaXQgZ2l0LmlzRGVzY2VuZGVudCh7IGRpcjogdGhpcy53b3JrRGlyLCBvaWQ6IGNvbW1pdC5vaWQsIGFuY2VzdG9yOiBsYXRlc3RSZW1vdGVDb21taXQgfSkpIHtcbiAgICAgICAgY29tbWl0cy5wdXNoKGNvbW1pdC5tZXNzYWdlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBjb21taXRzO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihcIkRpZCBub3QgZmluZCBhIGxvY2FsIGNvbW1pdCB0aGF0IGlzIGFuIGFuY2VzdG9yIG9mIHJlbW90ZSBtYXN0ZXJcIik7XG4gIH1cblxuICBhc3luYyBmZXRjaFJlbW90ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBnaXQuZmV0Y2goeyBkaXI6IHRoaXMud29ya0RpciwgcmVtb3RlOiBNQUlOX1JFTU9URSB9KTtcbiAgfVxuXG4gIGFzeW5jIHB1c2goZm9yY2UgPSBmYWxzZSkge1xuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBQdXNoaW5nXCIpO1xuXG4gICAgcmV0dXJuIGF3YWl0IGdpdC5wdXNoKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgcmVtb3RlOiBNQUlOX1JFTU9URSxcbiAgICAgIGZvcmNlOiBmb3JjZSxcbiAgICAgIC4uLnRoaXMuYXV0aCxcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIHJlc2V0RmlsZXMocGF0aHM6IHN0cmluZ1tdKSB7XG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IEZvcmNlIHJlc2V0dGluZyBmaWxlc1wiKTtcblxuICAgIHJldHVybiBhd2FpdCBnaXQuZmFzdENoZWNrb3V0KHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgZm9yY2U6IHRydWUsXG4gICAgICBmaWxlcGF0aHM6IHBhdGhzLFxuICAgIH0pO1xuICB9XG5cblxuICAvKiBGb3JrL3Vwc3RyZWFtIHdvcmtmbG93LlxuXG4gICAgIE9wZXJhdGVzIHR3byByZW1vdGVzLCBvcmlnaW4gKGZvciBhdXRob3LigJlzIGluZGl2aWR1YWwgZm9yaykgYW5kIHVwc3RyZWFtLlxuXG4gICAgIEFsbG93cyB0byByZXNldCB0byB1cHN0cmVhbS5cblxuICAgICBXQVJOSU5HOiByZXNldHRpbmcgdG8gdXBzdHJlYW0gd2lsbCBjYXVzZSBkYXRhIGxvc3NcbiAgICAgaWYgdGhlcmUgYXJlIGxvY2FsIGNoYW5nZXMgb3IgZm9yayAob3JpZ2luKSBpcyBhaGVhZCBvZiB1cHN0cmVhbS5cblxuICAgICBEb2VzIG5vdCBoYW5kbGUgaW5jb3Jwb3JhdGluZyBjaGFuZ2VzIGZyb20gdGhlIGZvcmsgaW50byB1cHN0cmVhbS5cbiAgICAgVGhlIGF1dGhvciBpcyBleHBlY3RlZCB0byBjcmVhdGUgYSBwdWxsIHJlcXVlc3QgZnJvbSB0aGVpciBmb3JrIHRvIHVwc3RyZWFtXG4gICAgIHVzaW5nIGhvc3RlZCBHaXQgc2VydmljZSBHVUkuXG4gICovXG5cbiAgYXN5bmMgZ2V0T3JpZ2luVXJsKCk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIHJldHVybiAoKGF3YWl0IGdpdC5saXN0UmVtb3Rlcyh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICB9KSkuZmluZChyID0+IHIucmVtb3RlID09PSBNQUlOX1JFTU9URSkgfHwgeyB1cmw6IG51bGwgfSkudXJsO1xuICB9XG5cbiAgYXN5bmMgZ2V0VXBzdHJlYW1VcmwoKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gICAgcmV0dXJuICgoYXdhaXQgZ2l0Lmxpc3RSZW1vdGVzKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgIH0pKS5maW5kKHIgPT4gci5yZW1vdGUgPT09IFVQU1RSRUFNX1JFTU9URSkgfHwgeyB1cmw6IG51bGwgfSkudXJsO1xuICB9XG5cbiAgYXN5bmMgZmV0Y2hVcHN0cmVhbSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBnaXQuZmV0Y2goeyBkaXI6IHRoaXMud29ya0RpciwgcmVtb3RlOiBVUFNUUkVBTV9SRU1PVEUgfSk7XG4gIH1cblxuICAvLyBUaGVzZSBhcmUgYnJva2VuLlxuICAvLyBhc3luYyB1cHN0cmVhbUlzQWhlYWQoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIC8vICAgLy8gQ29uc2lkZXIgdXBzdHJlYW0gYWhlYWQgaWYgb3VyIGN1cnJlbnQgSEVBRCBpcyBhIGRlc2NlbmRhbnQgb2YgbGF0ZXN0IHVwc3RyZWFtIGNvbW1pdFxuICAvLyAgIGNvbnN0IGhlYWRSZWYgPSBhd2FpdCBnaXQucmVzb2x2ZVJlZih7IGRpcjogdGhpcy53b3JrRGlyLCByZWY6ICdIRUFEJyB9KTtcbiAgLy8gICBjb25zdCBsYXRlc3RVcHN0cmVhbVJlZiA9IGF3YWl0IGdpdC5yZXNvbHZlUmVmKHsgZGlyOiB0aGlzLndvcmtEaXIsIHJlZjogYCR7VVBTVFJFQU1fUkVNT1RFfS9tYXN0ZXJgIH0pO1xuICAvLyAgIHJldHVybiBhd2FpdCBnaXQuaXNEZXNjZW5kZW50KHsgZGlyOiB0aGlzLndvcmtEaXIsIG9pZDogaGVhZFJlZiwgYW5jZXN0b3I6IGxhdGVzdFVwc3RyZWFtUmVmLCBkZXB0aDogLTEgfSk7XG4gIC8vIH1cblxuICAvLyBhc3luYyBpc0FoZWFkT2ZVcHN0cmVhbSgpOiBQcm9taXNlPGJvb2xlYW4+IHtcblxuICAvLyAgIC8vIElmIHdlIGhhdmUgbG9jYWwgY2hhbmdlcywgd2XigJlyZSBkZWZpbml0ZWx5IGFoZWFkXG4gIC8vICAgLy8gY29uc3QgZmlsZXNMb2NhbGx5TW9kaWZpZWQgPSBhd2FpdCB0aGlzLmxpc3RDaGFuZ2VkRmlsZXMoKTtcbiAgLy8gICAvLyBpZiAoZmlsZXNMb2NhbGx5TW9kaWZpZWQubGVuZ3RoID4gMCkge1xuICAvLyAgIC8vICAgcmV0dXJuIHRydWU7XG4gIC8vICAgLy8gfVxuXG4gIC8vICAgLy8gQ29uc2lkZXIgdXMgYWhlYWQgaWYgbGF0ZXN0IHVwc3RyZWFtIGNvbW1pdCBpcyBhIGRlc2NlbmRhbnQgb2Ygb3VyIGN1cnJlbnQgSEVBRFxuICAvLyAgIGNvbnN0IGhlYWRSZWYgPSBhd2FpdCBnaXQucmVzb2x2ZVJlZih7IGRpcjogdGhpcy53b3JrRGlyLCByZWY6ICdIRUFEJyB9KTtcbiAgLy8gICBjb25zdCBsYXRlc3RVcHN0cmVhbVJlZiA9IGF3YWl0IGdpdC5yZXNvbHZlUmVmKHsgZGlyOiB0aGlzLndvcmtEaXIsIHJlZjogYCR7VVBTVFJFQU1fUkVNT1RFfS9tYXN0ZXJgIH0pO1xuICAvLyAgIHJldHVybiBhd2FpdCBnaXQuaXNEZXNjZW5kZW50KHsgZGlyOiB0aGlzLndvcmtEaXIsIG9pZDogbGF0ZXN0VXBzdHJlYW1SZWYsIGFuY2VzdG9yOiBoZWFkUmVmLCBkZXB0aDogLTEgfSk7XG4gIC8vIH1cblxuICBhc3luYyByZXNldFRvVXBzdHJlYW0oKTogUHJvbWlzZTx7IHN1Y2Nlc3M6IGJvb2xlYW4gfT4ge1xuICAgIGNvbnN0IGdpdERpciA9IHBhdGguam9pbih0aGlzLndvcmtEaXIsICcuZ2l0Jyk7XG5cbiAgICBhd2FpdCBnaXQuZmV0Y2goeyBkaXI6IHRoaXMud29ya0RpciwgcmVtb3RlOiBVUFNUUkVBTV9SRU1PVEUgfSk7XG4gICAgY29uc3QgbGF0ZXN0VXBzdHJlYW1SZWYgPSBhd2FpdCBnaXQucmVzb2x2ZVJlZih7IGRpcjogdGhpcy53b3JrRGlyLCByZWY6IGAke1VQU1RSRUFNX1JFTU9URX0vbWFzdGVyYCB9KTtcblxuICAgIC8vIEVxdWl2YWxlbnQgb2YgcmVzZXR0aW5nIHJlcG8gdG8gZ2l2ZW4gY29tbWl0XG4gICAgYXdhaXQgZnMud3JpdGVGaWxlKHBhdGguam9pbihnaXREaXIsICdyZWZzJywgJ2hlYWRzJywgJ21hc3RlcicpLCBsYXRlc3RVcHN0cmVhbVJlZik7XG4gICAgYXdhaXQgZnMudW5saW5rKHBhdGguam9pbihnaXREaXIsICdpbmRleCcpKTtcblxuICAgIGF3YWl0IGdpdC5jaGVja291dCh7IGRpcjogdGhpcy53b3JrRGlyLCByZWY6ICdtYXN0ZXInIH0pO1xuICAgIGF3YWl0IHRoaXMucHVzaCh0cnVlKTtcblxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgfVxuXG5cbiAgLyogQVBJIHNldHVwICovXG5cbiAgc2V0VXBBUElFbmRwb2ludHMoKSB7XG4gICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IFNldHRpbmcgdXAgQVBJIGVuZHBvaW50c1wiKTtcblxuICAgIGxpc3Rlbjx7IG5hbWU6IHN0cmluZywgZW1haWw6IHN0cmluZywgdXNlcm5hbWU6IHN0cmluZyB9LCB7IGVycm9yczogc3RyaW5nW10gfT5cbiAgICAoJ2dpdC1jb25maWctc2V0JywgYXN5bmMgKHsgbmFtZSwgZW1haWwsIHVzZXJuYW1lIH0pID0+IHtcbiAgICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiByZWNlaXZlZCBnaXQtY29uZmlnLXNldCByZXF1ZXN0XCIpO1xuXG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ1NldCgndXNlci5uYW1lJywgbmFtZSk7XG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ1NldCgndXNlci5lbWFpbCcsIGVtYWlsKTtcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlnU2V0KCdjcmVkZW50aWFscy51c2VybmFtZScsIHVzZXJuYW1lKTtcblxuICAgICAgdGhpcy5hdXRoLnVzZXJuYW1lID0gdXNlcm5hbWU7XG5cbiAgICAgIHJldHVybiB7IGVycm9yczogW10gfTtcbiAgICB9KTtcblxuICAgIGxpc3Rlbjx7IHBhc3N3b3JkOiBzdHJpbmcgfSwgeyBzdWNjZXNzOiB0cnVlIH0+XG4gICAgKCdnaXQtc2V0LXBhc3N3b3JkJywgYXN5bmMgKHsgcGFzc3dvcmQgfSkgPT4ge1xuICAgICAgLy8gV0FSTklORzogRG9u4oCZdCBsb2cgcGFzc3dvcmRcbiAgICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiByZWNlaXZlZCBnaXQtc2V0LXBhc3N3b3JkIHJlcXVlc3RcIik7XG5cbiAgICAgIHRoaXMuc2V0UGFzc3dvcmQocGFzc3dvcmQpO1xuXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gICAgfSk7XG5cbiAgICBsaXN0ZW48e30sIHsgb3JpZ2luVVJMOiBzdHJpbmcgfCBudWxsLCBuYW1lOiBzdHJpbmcgfCBudWxsLCBlbWFpbDogc3RyaW5nIHwgbnVsbCwgdXNlcm5hbWU6IHN0cmluZyB8IG51bGwgfT5cbiAgICAoJ2dpdC1jb25maWctZ2V0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgbG9nLnZlcmJvc2UoXCJTU0U6IEdpdENvbnRyb2xsZXI6IHJlY2VpdmVkIGdpdC1jb25maWcgcmVxdWVzdFwiKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG9yaWdpblVSTDogYXdhaXQgdGhpcy5nZXRPcmlnaW5VcmwoKSxcbiAgICAgICAgbmFtZTogYXdhaXQgdGhpcy5jb25maWdHZXQoJ3VzZXIubmFtZScpLFxuICAgICAgICBlbWFpbDogYXdhaXQgdGhpcy5jb25maWdHZXQoJ3VzZXIuZW1haWwnKSxcbiAgICAgICAgdXNlcm5hbWU6IGF3YWl0IHRoaXMuY29uZmlnR2V0KCdjcmVkZW50aWFscy51c2VybmFtZScpLFxuICAgICAgICAvLyBQYXNzd29yZCBtdXN0IG5vdCBiZSByZXR1cm5lZCwgb2YgY291cnNlXG4gICAgICB9O1xuICAgIH0pO1xuXG4gICAgbGlzdGVuPHt9LCB7IGZpbGVuYW1lczogc3RyaW5nW10gfT5cbiAgICAoJ2xpc3QtbG9jYWwtY2hhbmdlcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiByZWNlaXZlZCBsaXN0LWxvY2FsLWNoYW5nZXMgcmVxdWVzdFwiKTtcbiAgICAgIHJldHVybiB7IGZpbGVuYW1lczogYXdhaXQgdGhpcy5saXN0Q2hhbmdlZEZpbGVzKCkgfTtcbiAgICB9KTtcblxuICAgIGxpc3Rlbjx7IHBhdGhzOiBzdHJpbmdbXSB9LCB7IHN1Y2Nlc3M6IHRydWUgfT5cbiAgICAoJ2Rpc2NhcmQtbG9jYWwtY2hhbmdlcycsIGFzeW5jICh7IHBhdGhzIH0pID0+IHtcbiAgICAgIGxvZy52ZXJib3NlKGBTU0U6IEdpdENvbnRyb2xsZXI6IHJlY2VpdmVkIGRpc2NhcmQtbG9jYWwtY2hhbmdlcyB3aXRoIGZpbGVzICR7cGF0aHMuam9pbignLCAnKX1gKTtcbiAgICAgIGF3YWl0IHRoaXMucmVzZXRGaWxlcyhwYXRocyk7XG4gICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gICAgfSk7XG5cbiAgICBsaXN0ZW48eyBwYXRoczogc3RyaW5nW10sIGNvbW1pdE1zZzogc3RyaW5nIH0sIHsgc3VjY2VzczogdHJ1ZSB9PlxuICAgICgnY29tbWl0LWZpbGVzJywgYXN5bmMgKHsgcGF0aHMsIGNvbW1pdE1zZyB9KSA9PiB7XG4gICAgICBsb2cudmVyYm9zZShgU1NFOiBHaXRDb250cm9sbGVyOiByZWNlaXZlZCBjb21taXQtZmlsZXMgd2l0aCBmaWxlcyAke3BhdGhzLmpvaW4oJywgJyl9IGFuZCBtZXNzYWdlICR7Y29tbWl0TXNnfWApO1xuICAgICAgYXdhaXQgdGhpcy5zdGFnZUFuZENvbW1pdChwYXRocywgY29tbWl0TXNnKTtcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgICB9KTtcblxuICAgIGxpc3Rlbjx7fSwgeyBlcnJvcnM6IHN0cmluZ1tdIH0+XG4gICAgKCdzeW5jLXRvLXJlbW90ZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiByZWNlaXZlZCBzeW5jLXRvLXJlbW90ZSByZXF1ZXN0XCIpO1xuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnB1c2goKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgcmV0dXJuIHsgZXJyb3JzOiBbYEVycm9yIHN5bmNpbmcgdG8gcmVtb3RlOiAke2UudG9TdHJpbmcoKX1gXSB9O1xuICAgICAgfVxuICAgICAgcmV0dXJuIHsgZXJyb3JzOiBbXSB9O1xuICAgIH0pO1xuXG4gIH1cbn1cblxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaW5pdFJlcG8oXG4gICAgd29ya0Rpcjogc3RyaW5nLFxuICAgIHJlcG9Vcmw6IHN0cmluZyxcbiAgICB1cHN0cmVhbVJlcG9Vcmw6IHN0cmluZyxcbiAgICBjb3JzUHJveHlVcmw6IHN0cmluZyxcbiAgICBmb3JjZTogYm9vbGVhbik6IFByb21pc2U8R2l0Q29udHJvbGxlcj4ge1xuXG4gIGNvbnN0IGdpdEN0cmwgPSBuZXcgR2l0Q29udHJvbGxlcihmcywgcmVwb1VybCwgdXBzdHJlYW1SZXBvVXJsLCB3b3JrRGlyLCBjb3JzUHJveHlVcmwpO1xuICBjb25zdCBpc0luaXRpYWxpemVkID0gYXdhaXQgZ2l0Q3RybC5pc0luaXRpYWxpemVkKCk7XG4gIGNvbnN0IHJlbW90ZXNNYXRjaCA9IGF3YWl0IGdpdEN0cmwuaXNVc2luZ1JlbW90ZVVSTHMoeyBvcmlnaW46IHJlcG9VcmwsIHVwc3RyZWFtOiB1cHN0cmVhbVJlcG9VcmwgfSk7XG5cbiAgaWYgKGlzSW5pdGlhbGl6ZWQgPT09IHRydWUgJiYgcmVtb3Rlc01hdGNoID09PSB0cnVlICYmIGZvcmNlID09PSBmYWxzZSkge1xuICAgIGxvZy52ZXJib3NlKFwiU1NFOiBHaXRDb250cm9sbGVyOiBBbHJlYWR5IGluaXRpYWxpemVkXCIpO1xuXG4gIH0gZWxzZSB7XG4gICAgbG9nLndhcm4oXCJTU0U6IEdpdENvbnRyb2xsZXIgaXMgbm90IGluaXRpYWxpemVkLCBoYXMgbWlzbWF0Y2hpbmcgcmVtb3RlIFVSTHMsIG9yIGZvcmNlIGlzIHRydWVcIik7XG4gICAgbG9nLmRlYnVnKGBTU0U6IEdpdENvbnRyb2xsZXI6IHJlbW90ZXMgbWF0Y2g6ICR7cmVtb3Rlc01hdGNofWApO1xuICAgIGxvZy5kZWJ1ZyhgU1NFOiBHaXRDb250cm9sbGVyOiBmb3JjZSBpcyAke2ZvcmNlfWApO1xuICAgIGF3YWl0IGdpdEN0cmwuZm9yY2VJbml0aWFsaXplKCk7XG5cbiAgfVxuICBhd2FpdCBnaXRDdHJsLmxvYWRBdXRoKCk7XG4gIHJldHVybiBnaXRDdHJsO1xufVxuXG5cbi8qIFByb21pc2VzIHRvIHJldHVybiBhbiBvYmplY3QgY29udGFpbmluZyBzdHJpbmcgd2l0aCByZXBvc2l0b3J5IFVSTFxuICAgYW5kIGEgZmxhZyBpbmRpY2F0aW5nIHdoZXRoZXIgaXTigJlzIGJlZW4gcmVzZXRcbiAgICh3aGljaCBpZiB0cnVlIHdvdWxkIGNhdXNlIGBpbml0UmVwbygpYCB0byByZWluaXRpYWxpemUgdGhlIHJlcG9zaXRvcnkpLlxuXG4gICBJZiByZXBvc2l0b3J5IFVSTCBpcyBub3QgY29uZmlndXJlZCAoZS5nLiwgb24gZmlyc3QgcnVuLCBvciBhZnRlciByZXNldClcbiAgIG9wZW5zIGEgd2luZG93IHdpdGggc3BlY2lmaWVkIG9wdGlvbnMgdG8gYXNrIHRoZSB1c2VyIHRvIHByb3ZpZGUgdGhlIHNldHRpbmcuXG4gICBUaGUgd2luZG93IGlzIGV4cGVjdGVkIHRvIGFzayB0aGUgdXNlciB0byBzcGVjaWZ5IHRoZSBVUkwgYW5kIHNlbmQgYSBgJ3NldC1zZXR0aW5nJ2BcbiAgIGV2ZW50IGZvciBgJ2dpdFJlcG9VcmwnYC4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzZXRSZXBvVXJsKFxuICAgIGNvbmZpZ1dpbmRvdzogV2luZG93T3BlbmVyUGFyYW1zLFxuICAgIHNldHRpbmdzOiBTZXR0aW5nTWFuYWdlcik6IFByb21pc2U8eyB1cmw6IHN0cmluZywgaGFzQ2hhbmdlZDogYm9vbGVhbiB9PiB7XG5cbiAgc2V0dGluZ3MuY29uZmlndXJlUGFuZSh7XG4gICAgaWQ6ICdkYXRhU3luYycsXG4gICAgbGFiZWw6IFwiRGF0YSBzeW5jaHJvbml6YXRpb25cIixcbiAgICBpY29uOiAnZ2l0LW1lcmdlJyxcbiAgfSk7XG5cbiAgc2V0dGluZ3MucmVnaXN0ZXIobmV3IFNldHRpbmc8c3RyaW5nPihcbiAgICAnZ2l0UmVwb1VybCcsXG4gICAgXCJHaXQgcmVwb3NpdG9yeSBVUkxcIixcbiAgICAnZGF0YVN5bmMnLFxuICApKTtcblxuICBjb25zdCByZXBvVXJsOiBzdHJpbmcgPSBhd2FpdCBzZXR0aW5ncy5nZXRWYWx1ZSgnZ2l0UmVwb1VybCcpIGFzIHN0cmluZztcblxuICBpZiAocmVwb1VybCkge1xuICAgIGxvZy53YXJuKFwiU1NFOiBHaXRDb250cm9sbGVyOiBSZXBvIFVSTCBmb3VuZCBpbiBzZXR0aW5ncywgc2tpcCBjb25maWcgd2luZG93XCIpO1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoeyB1cmw6IHJlcG9VcmwsIGhhc0NoYW5nZWQ6IGZhbHNlIH0pO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZTx7IHVybDogc3RyaW5nLCBoYXNDaGFuZ2VkOiBib29sZWFuIH0+KGFzeW5jIChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGxvZy53YXJuKFwiU1NFOiBHaXRDb250cm9sbGVyOiBSZXBvIFVSTCBub3Qgc2V0LCBvcGVuIGluaXRpYWwgY29uZmlnIHdpbmRvdyB0byBsZXQgdXNlciBjb25maWd1cmVcIik7XG5cbiAgICAgIGF3YWl0IG9wZW5XaW5kb3coY29uZmlnV2luZG93KTtcbiAgICAgIGlwY01haW4ub24oJ3NldC1zZXR0aW5nJywgaGFuZGxlU2V0dGluZyk7XG5cbiAgICAgIGZ1bmN0aW9uIGhhbmRsZVNldHRpbmcoZXZ0OiBhbnksIG5hbWU6IHN0cmluZywgdmFsdWU6IHN0cmluZykge1xuICAgICAgICBpZiAobmFtZSA9PT0gJ2dpdFJlcG9VcmwnKSB7XG4gICAgICAgICAgbG9nLmluZm8oXCJTU0U6IEdpdENvbnRyb2xsZXI6IHJlY2VpdmVkIGdpdFJlcG9Vcmwgc2V0dGluZ1wiKTtcbiAgICAgICAgICBpcGNNYWluLnJlbW92ZUxpc3RlbmVyKCdzZXQtc2V0dGluZycsIGhhbmRsZVNldHRpbmcpO1xuICAgICAgICAgIHJlc29sdmUoeyB1cmw6IHZhbHVlLCBoYXNDaGFuZ2VkOiB0cnVlIH0pO1xuICAgICAgICB9XG4gICAgICAgIGV2dC5yZXBseSgnb2snKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuIl19