import * as path from 'path';
import * as fs from 'fs-extra';
import * as git from 'isomorphic-git';
import * as log from 'electron-log';

import { ipcMain } from 'electron';

import { listen } from '../../api/main';
import { Setting, SettingManager } from '../../settings/main';
import { WindowOpenerParams, openWindow } from '../../main/window';

import { GitAuthentication } from '../git';


const UPSTREAM_REMOTE = 'upstream';
const MAIN_REMOTE = 'origin';


export class GitController {
  private auth: GitAuthentication = {};

  constructor(
      private fs: any,
      private repoUrl: string,
      private upstreamRepoUrl: string,
      private workDir: string,
      private corsProxy: string) {

    git.plugins.set('fs', fs);
  }

  async isInitialized(): Promise<boolean> {
    let hasGitDirectory: boolean;
    try {
      hasGitDirectory = (await this.fs.stat(path.join(this.workDir, '.git'))).isDirectory();
    } catch (e) {
      hasGitDirectory = false;
    }
    return hasGitDirectory;
  }

  async isUsingRemoteURLs(remoteUrls: { origin: string, upstream: string }): Promise<boolean> {
    const origin = (await this.getOriginUrl() || '').trim();
    const upstream = (await this.getUpstreamUrl() || '').trim();
    return origin === remoteUrls.origin && upstream === remoteUrls.upstream;
  }

  async forceInitialize() {
    log.warn("SSE: GitController: Force initializing");
    log.warn("SSE: GitController: Initialize: Removing data directory");

    await this.fs.remove(this.workDir);

    log.silly("SSE: GitController: Initialize: Ensuring data directory exists");

    await this.fs.ensureDir(this.workDir);

    log.verbose("SSE: GitController: Initialize: Cloning");

    await git.clone({
      dir: this.workDir,
      url: this.repoUrl,
      ref: 'master',
      singleBranch: true,
      depth: 10,
      corsProxy: this.corsProxy,
      ...this.auth,
    });

    await git.addRemote({
      dir: this.workDir,
      remote: UPSTREAM_REMOTE,
      url: this.upstreamRepoUrl,
    });

    // Configure auth with git-config username, if set
    const username = await git.config({ dir: this.workDir, path: 'credentials.username' });
    if (username) {
      this.auth.username = username;
    }
  }

  async configSet(prop: string, val: string) {
    log.verbose("SSE: GitController: Set config");
    await git.config({ dir: this.workDir, path: prop, value: val });
  }

  async configGet(prop: string): Promise<string> {
    log.verbose("SSE: GitController: Get config", prop);
    return await git.config({ dir: this.workDir, path: prop });
  }

  async pull() {
    log.verbose("SSE: GitController: Pulling with auto fast-forward merge");
    await git.pull({
      dir: this.workDir,
      ref: 'master',
      singleBranch: true,
      fastForwardOnly: true,
      ...this.auth,
    });
  }

  async listChangedFiles(): Promise<string[]> {
    const FILE = 0, HEAD = 1, WORKDIR = 2;

    return (await git.statusMatrix({ dir: this.workDir }))
      .filter(row => row[HEAD] !== row[WORKDIR])
      .map(row => row[FILE]);
  }

  async stageAllLocalChanges() {
    log.verbose("SSE: GitController: Adding all changes");

    await git.add({
      dir: this.workDir,
      filepath: '.',
    });
  }

  async commitAllLocalChanges(withMsg: string): Promise<number> {
    const filesChanged = (await this.listChangedFiles()).length;
    if (filesChanged < 1) {
      return 0;
    }

    await this.stageAllLocalChanges();
    await this.commit(withMsg);

    return filesChanged;
  }

  async commit(msg: string) {
    log.verbose("SSE: GitController: Committing");
    await git.commit({
      dir: this.workDir,
      message: msg,
      author: {},
    });
  }

  async push(force = false) {
    log.verbose("SSE: GitController: Pushing");
    await git.push({
      dir: this.workDir,
      remote: MAIN_REMOTE,
      force: force,
      ...this.auth,
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

  async fetchUpstream(): Promise<void> {
    await git.fetch({ dir: this.workDir, remote: UPSTREAM_REMOTE });
  }

  async upstreamIsAhead(): Promise<boolean> {
    // Consider upstream ahead if our current HEAD is a descendant of latest upstream commit
    const headRef = await git.resolveRef({ dir: this.workDir, ref: 'HEAD' });
    const latestUpstreamRef = await git.resolveRef({ dir: this.workDir, ref: `${UPSTREAM_REMOTE}/master` });
    return await git.isDescendent({ dir: this.workDir, oid: headRef, ancestor: latestUpstreamRef, depth: -1 });
  }

  async isAheadOfUpstream(): Promise<boolean> {

    // If we have local changes, we’re definitely ahead
    // const filesLocallyModified = await this.listChangedFiles();
    // if (filesLocallyModified.length > 0) {
    //   return true;
    // }

    // Consider us ahead if latest upstream commit is a descendant of our current HEAD
    const headRef = await git.resolveRef({ dir: this.workDir, ref: 'HEAD' });
    const latestUpstreamRef = await git.resolveRef({ dir: this.workDir, ref: `${UPSTREAM_REMOTE}/master` });
    return await git.isDescendent({ dir: this.workDir, oid: latestUpstreamRef, ancestor: headRef, depth: -1 });
  }

  async resetToUpstream(): Promise<{ success: boolean }> {
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

  async syncToRemote() {
    // Operating on fork mean we shouldn’t have the need to pull
    // try {
    //   await this.pull();
    // } catch (e) {
    //   log.warn("SSE: GitController: Failed to pull & merge changes!");
    //   return { errors: [`Error while fetching and merging changes: ${e.toString()}`] };
    // }

    // TODO: Short-cut this if no unpushed changes are present
    await this.push();
  }


  /* API setup */

  setUpAPIEndpoints() {
    log.verbose("SSE: GitController: Setting up API endpoints");

    listen<{ name: string, email: string, username: string }, { errors: string[] }>
    ('git-config-set', async ({ name, email, username }) => {
      log.verbose("SSE: GitController: received git-config-set request");

      await this.configSet('user.name', name);
      await this.configSet('user.email', email);
      await this.configSet('credentials.username', username);

      this.auth.username = username;

      return { errors: [] };
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

    listen<{}, { filenames: string[] }>
    ('list-local-changes', async () => {
      log.verbose("SSE: GitController: received list-local-changes request");
      return { filenames: await this.listChangedFiles() };
    });

    listen<{ commitMsg: string }, { errors: string[] }>
    ('commit-changes', async ({ commitMsg }) => {
      log.verbose("SSE: GitController: received commit-changes request");

      try {
        await this.commitAllLocalChanges(commitMsg);
      } catch (e) {
        return { errors: [`Error committing local changes: ${e.toString()}`] };
      }
      return { errors: [] };
    });

    listen<{}, { errors: string[] }>
    ('sync-to-remote', async () => {
      log.verbose("SSE: GitController: received sync-to-remote request");

      try {
        await this.syncToRemote();
      } catch (e) {
        return { errors: [`Error syncing to remote: ${e.toString()}`] };
      }
      return { errors: [] };
    });

  }
}


export async function initRepo(
    workDir: string,
    repoUrl: string,
    upstreamRepoUrl: string,
    corsProxyUrl: string,
    force: boolean): Promise<GitController> {

  const gitCtrl = new GitController(fs, repoUrl, upstreamRepoUrl, workDir, corsProxyUrl);
  const isInitialized = await gitCtrl.isInitialized();
  const remotesMatch = await gitCtrl.isUsingRemoteURLs({ origin: repoUrl, upstream: upstreamRepoUrl });

  if (isInitialized === true && remotesMatch === true && force === false) {
    log.verbose("SSE: GitController: Already initialized");

    log.verbose("SSE: GitController: Current remote URL matches configured repo URL");
    const changedFiles = await gitCtrl.listChangedFiles();
    if (changedFiles.length < 1) {
      log.verbose("SSE: GitController: There are no local changes, let’s pull");
      await gitCtrl.pull();
    } else {
      log.verbose("SSE: GitController: There are some local changes, not pulling");
    }

  } else {
    log.warn("SSE: GitController is not initialized, has mismatching remote URLs, or force is true");
    log.debug(`SSE: GitController: remotes match: ${remotesMatch}`);
    log.debug(`SSE: GitController: force is ${force}`);
    await gitCtrl.forceInitialize();

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
export async function setRepoUrl(
    configWindow: WindowOpenerParams,
    settings: SettingManager): Promise<{ url: string, hasChanged: boolean }> {

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

  const repoUrl: string = await settings.getValue('gitRepoUrl') as string;

  if (repoUrl) {
    log.warn("SSE: GitController: Repo URL found in settings, skip config window");
    return Promise.resolve({ url: repoUrl, hasChanged: false });
  } else {
    return new Promise<{ url: string, hasChanged: boolean }>(async (resolve, reject) => {
      log.warn("SSE: GitController: Repo URL not set, open initial config window to let user configure");

      await openWindow(configWindow);
      ipcMain.on('set-setting', handleSetting);

      function handleSetting(evt: any, name: string, value: string) {
        if (name === 'gitRepoUrl') {
          log.warn("SSE: GitController: received gitRepoUrl setting");
          ipcMain.removeListener('set-setting', handleSetting);
          resolve({ url: value, hasChanged: true });
        }
        evt.reply('ok');
      }
    });
  }
}
