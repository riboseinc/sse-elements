import * as dns from 'dns';
import * as path from 'path';
import * as fs from 'fs-extra';
import AsyncLock from 'async-lock';
import * as git from 'isomorphic-git';
import * as log from 'electron-log';

import { ipcMain } from 'electron';

import { listen } from '../../../api/main';
import { Setting, SettingManager } from '../../../settings/main';
import { notifyAllWindows, WindowOpenerParams, openWindow } from '../../../main/window';

import { RemoteStorageStatus } from '../remote';

import { GitAuthentication } from './types';


const UPSTREAM_REMOTE = 'upstream';
const MAIN_REMOTE = 'origin';


export class GitController {

  private auth: GitAuthentication = {};

  private stagingLock: AsyncLock;

  constructor(
      private fs: any,
      private repoUrl: string,
      private upstreamRepoUrl: string,
      public workDir: string,
      private corsProxy: string) {

    git.plugins.set('fs', fs);

    this.stagingLock = new AsyncLock({ timeout: 20000, maxPending: 10 });

    // Makes it easier to bind these to IPC events
    this.synchronize = this.synchronize.bind(this);
    this.resetFiles = this.resetFiles.bind(this);
    this.checkUncommitted = this.checkUncommitted.bind(this);
  }

  public async isInitialized(): Promise<boolean> {
    let hasGitDirectory: boolean;
    try {
      hasGitDirectory = (await this.fs.stat(path.join(this.workDir, '.git'))).isDirectory();
    } catch (e) {
      hasGitDirectory = false;
    }
    return hasGitDirectory;
  }

  public async isUsingRemoteURLs(remoteUrls: { origin: string, upstream: string }): Promise<boolean> {
    const origin = (await this.getOriginUrl() || '').trim();
    const upstream = (await this.getUpstreamUrl() || '').trim();
    return origin === remoteUrls.origin && upstream === remoteUrls.upstream;
  }

  public needsPassword(): boolean {
    return (this.auth.password || '').trim() === '';
  }

  public async forceInitialize() {
    /* Initializes from scratch: wipes work directory, clones again, adds remotes. */

    log.warn("SSE: GitController: Force initializing");
    log.warn("SSE: GitController: Initialize: Removing data directory");

    await this.fs.remove(this.workDir);

    log.silly("SSE: GitController: Initialize: Ensuring data directory exists");

    await this.fs.ensureDir(this.workDir);

    log.verbose("SSE: GitController: Initialize: Cloning", this.repoUrl);

    await git.clone({
      dir: this.workDir,
      url: this.repoUrl,
      ref: 'master',
      singleBranch: true,
      depth: 5,
      corsProxy: this.corsProxy,
      ...this.auth,
    });

    await git.addRemote({
      dir: this.workDir,
      remote: UPSTREAM_REMOTE,
      url: this.upstreamRepoUrl,
    });
  }

  public async configSet(prop: string, val: string) {
    log.verbose("SSE: GitController: Set config");
    await git.config({ dir: this.workDir, path: prop, value: val });
  }

  public async configGet(prop: string): Promise<string> {
    log.verbose("SSE: GitController: Get config", prop);
    return await git.config({ dir: this.workDir, path: prop });
  }

  public setPassword(value: string | undefined) {
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

    return await git.pull({
      dir: this.workDir,
      singleBranch: true,
      fastForwardOnly: true,
      fast: true,
      ...this.auth,
    });
  }

  async stage(pathSpecs: string[]) {
    log.verbose(`SSE: GitController: Adding changes: ${pathSpecs.join(', ')}`);

    for (const pathSpec of pathSpecs) {
      await git.add({
        dir: this.workDir,
        filepath: pathSpec,
      });
    }
  }

  async commit(msg: string) {
    log.verbose(`SSE: GitController: Committing with message ${msg}`);

    return await git.commit({
      dir: this.workDir,
      message: msg,
      author: {},  // git-config values will be used
    });
  }

  async fetchRemote(): Promise<void> {
    await git.fetch({ dir: this.workDir, remote: MAIN_REMOTE, ...this.auth });
  }

  async fetchUpstream(): Promise<void> {
    await git.fetch({ dir: this.workDir, remote: UPSTREAM_REMOTE, ...this.auth });
  }

  async push(force = false) {
    log.verbose("SSE: GitController: Pushing");

    return await git.push({
      dir: this.workDir,
      remote: MAIN_REMOTE,
      force: force,
      ...this.auth,
    });
  }

  public async resetFiles(paths?: string[]) {
    return await this.stagingLock.acquire('1', async () => {
      log.verbose("SSE: GitController: Force resetting files");

      return await git.fastCheckout({
        dir: this.workDir,
        force: true,
        filepaths: paths || (await this.listChangedFiles()),
      });
    });
  }

  async getOriginUrl(): Promise<string | null> {
    return ((await git.listRemotes({
      dir: this.workDir,
    })).find(r => r.remote === MAIN_REMOTE) || { url: null }).url;
  }

  async getUpstreamUrl(): Promise<string | null> {
    return ((await git.listRemotes({
      dir: this.workDir,
    })).find(r => r.remote === UPSTREAM_REMOTE) || { url: null }).url;
  }

  async listLocalCommits(): Promise<string[]> {
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

      var commits = [] as string[];
      for (const commit of localCommits) {
        if (await git.isDescendent({ dir: this.workDir, oid: commit.oid, ancestor: latestRemoteCommit })) {
          commits.push(commit.message);
        } else {
          return commits;
        }
      }

      throw new Error("Did not find a local commit that is an ancestor of remote master");
    });
  }

  public async listChangedFiles(pathSpecs = ['.']): Promise<string[]> {
    /* Lists relative paths to all files that were changed and have not been committed. */

    const FILE = 0, HEAD = 1, WORKDIR = 2;

    return (await git.statusMatrix({ dir: this.workDir, filepaths: pathSpecs }))
      .filter(row => row[HEAD] !== row[WORKDIR])
      .map(row => row[FILE])
      .filter(filepath => !filepath.startsWith('..'));
  }

  public async stageAndCommit(pathSpecs: string[], msg: string): Promise<number> {
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

  private async unstageAll() {
    log.verbose("SSE: GitController: Unstaging all changes");
    await git.remove({ dir: this.workDir, filepath: '.' });
  }

  private async _handleGitError(e: Error & { code: string }): Promise<void> {
    if (e.code === 'FastForwardFail') {
      // NOTE: There’s also PushRejectedNonFastForward, but it seems to be thrown
      // for unrelated cases during push (false positive).
      // Because of that false positive, we ignore that error and instead do pull first,
      // catching actual fast-forward fails on that step before push.
      await sendRemoteStatus({ statusRelativeToLocal: 'diverged' });
    } else if (['MissingUsernameError', 'MissingAuthorError', 'MissingCommitterError'].indexOf(e.code) >= 0) {
      await sendRemoteStatus({ isMisconfigured: true });
    } else if (e.code === 'MissingPasswordTokenError' || (e.code === 'HTTPError' && e.message.indexOf('Unauthorized') >= 0)) {
      this.setPassword(undefined);
      await sendRemoteStatus({ needsPassword: true });
    }
  }

  public async checkUncommitted(): Promise<boolean> {
    /* Checks for any uncommitted changes locally present.
       Notifies all windows about the status. */

    log.debug("SSE: Git: Checking for uncommitted changes");
    const hasUncommittedChanges = (await this.listChangedFiles()).length > 0;
    await sendRemoteStatus({ hasLocalChanges: hasUncommittedChanges });
    return hasUncommittedChanges;
  }

  public async synchronize(): Promise<void> {
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
          } catch (e) {
            log.error(e);
            await sendRemoteStatus({ isPulling: false });
            await this._handleGitError(e);
            return;
          }
          await sendRemoteStatus({ isPulling: false });

          await sendRemoteStatus({ isPushing: true });
          try {
            await this.push();
          } catch (e) {
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

    listen<{ name: string, email: string, username: string }, { success: true }>
    ('git-config-set', async ({ name, email, username }) => {
      log.verbose("SSE: GitController: received git-config-set request");

      await this.configSet('user.name', name);
      await this.configSet('user.email', email);
      await this.configSet('credentials.username', username);

      this.auth.username = username;

      this.synchronize();

      return { success: true };
    });

    listen<{ password: string }, { success: true }>
    ('git-set-password', async ({ password }) => {
      // WARNING: Don’t log password
      log.verbose("SSE: GitController: received git-set-password request");

      this.setPassword(password);
      this.synchronize();

      return { success: true };
    });

    listen<{}, { originURL: string | null, name: string | null, email: string | null, username: string | null }>
    ('git-config-get', async () => {
      log.verbose("SSE: GitController: received git-config request");
      return {
        originURL: await this.getOriginUrl(),
        name: await this.configGet('user.name'),
        email: await this.configGet('user.email'),
        username: await this.configGet('credentials.username'),
        // Password must not be returned, of course
      };
    });
  }
}


export async function initRepo(
    workDir: string,
    upstreamRepoUrl: string,
    corsProxyUrl: string,
    force: boolean,
    settings: SettingManager,
    configWindow: WindowOpenerParams): Promise<GitController> {

  settings.configurePane({
    id: 'dataSync',
    label: "Data synchronization",
    icon: 'git-merge',
  });

  settings.register(new Setting<string>(
    'gitRepoUrl',
    "Git repository URL",
    'dataSync',
  ));

  const repoUrl = (await settings.getValue('gitRepoUrl') as string) || (await requestRepoUrl(configWindow));

  const gitCtrl = new GitController(fs, repoUrl, upstreamRepoUrl, workDir, corsProxyUrl);

  let doInitialize: boolean;

  if (force === true) {
    log.warn("SSE: Git is being force reinitialized");
    doInitialize = true;
  } else if (!(await gitCtrl.isInitialized())) {
    log.warn("SSE: Git is not initialized yet");
    doInitialize = true;
  } else if (!(await gitCtrl.isUsingRemoteURLs({ origin: repoUrl, upstream: upstreamRepoUrl }))) {
    log.warn("SSE: Git has mismatching remote URLs, reinitializing");
    doInitialize = true;
  } else {
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
export async function requestRepoUrl(configWindow: WindowOpenerParams): Promise<string> {
  return new Promise<string>(async (resolve, reject) => {

    log.warn("SSE: GitController: Open config window to configure repo URL");

    ipcMain.on('set-setting', handleSetting);

    function handleSetting(evt: any, name: string, value: string) {
      if (name === 'gitRepoUrl') {
        log.info("SSE: GitController: received gitRepoUrl setting");
        ipcMain.removeListener('set-setting', handleSetting);
        resolve(value);
      }
    }

    await openWindow(configWindow);

  });
}


async function checkOnlineStatus(): Promise<boolean> {
  let isOffline: boolean;
  try {
    await dns.promises.lookup('github.com');
    isOffline = false;
  } catch (e) {
    isOffline = true;
  }
  return !isOffline;
}


async function sendRemoteStatus(update: Partial<RemoteStorageStatus>) {
  await notifyAllWindows('remote-storage-status', update);
}
