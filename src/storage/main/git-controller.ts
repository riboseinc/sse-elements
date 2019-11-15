import * as path from 'path';
import * as fs from 'fs-extra';
import * as git from 'isomorphic-git';
import * as log from 'electron-log';

import { ipcMain } from 'electron';

import { listen } from '../../api/main';
import { Setting, SettingManager } from '../../settings/main';
import { WindowOpenerParams, openWindow } from '../../main/window';

import { GitAuthor, GitAuthentication } from '../git';


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

  async getAuthor(): Promise<GitAuthor> {
    const name = await git.config({ dir: this.workDir, path: 'user.name' });
    const email = await git.config({ dir: this.workDir, path: 'user.email' });
    return { name: name, email: email };
  }

  async setAuthor(author: GitAuthor) {
    log.verbose("SSE: GitController: Set author");
    await git.config({ dir: this.workDir, path: 'user.name', value: author.name });
    await git.config({ dir: this.workDir, path: 'user.email', value: author.email });
  }

  async setAuth(auth: GitAuthentication): Promise<boolean> {
    // DANGER: never log `auth` value here!
    log.verbose("SSE: GitController: Set auth");
    try {
      // Try fetching with auth; will throw if auth is invalid
      git.fetch({dir: this.workDir, ...auth });
    } catch (e) {
      return false;
    }

    this.auth = auth;
    return true;
  }

  async isInitialized(): Promise<boolean> {
    let gitInitialized: boolean;

    try {
      gitInitialized = (await this.fs.stat(path.join(this.workDir, '.git'))).isDirectory();
    } catch (e) {
      gitInitialized = false;
    }

    return gitInitialized;
  }

  async addAllChanges() {
    log.verbose("SSE: GitController: Adding all changes");
    await git.add({
      dir: this.workDir,
      filepath: '.',
    });
  }

  async listChangedFiles(): Promise<string[]> {
    const FILE = 0, HEAD = 1, WORKDIR = 2;

    return (await git.statusMatrix({ dir: this.workDir }))
      .filter(row => row[HEAD] !== row[WORKDIR])
      .map(row => row[FILE]);
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
  }


  /* Fork/upstream workflow.

     Operates two remotes, origin (for author’s individual fork) and upstream.

     Allows to reset to upstream.

     WARNING: resetting to upstream will cause data loss
     if fork (origin) happens to be ahead of upstream
     (have changes not incorporated into upstream).

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

  async isAheadOfUpstream(): Promise<boolean> {

    // If we have local changes, we’re definitely ahead
    const filesLocallyModified = await this.listChangedFiles();
    if (filesLocallyModified.length > 0) {
      return true;
    }

    // Otherwise, consider us ahead if latest upstream commit is a descendant of our current HEAD
    await git.fetch({ dir: this.workDir, remote: UPSTREAM_REMOTE });
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


  /* API setup */

  setUpAPIEndpoints() {
    log.verbose("SSE: GitController: Setting up API endpoints");

    listen<{}, { originURL: string | null, author: GitAuthor }>('git-config', async () => {
      log.verbose("SSE: GitController: received git-config request");
      return {
        originURL: await this.getOriginUrl(),
        author: await this.getAuthor(),
      };
    });

    listen<{}, { filenames: string[] }>('list-local-changes', async () => {
      log.verbose("SSE: GitController: received list-local-changes request");
      return { filenames: await this.listChangedFiles() };
    });

    type SubmitChangesEndpointParameters = {
      commitMsg: string,
      authorName: string,
      authorEmail: string,
      gitUsername: string,
      gitPassword: string,
    };
    listen<SubmitChangesEndpointParameters, { errors: string[] }>
    ('fetch-commit-push', async ({ commitMsg, authorName, authorEmail, gitUsername, gitPassword }) => {

      // DANGER: Never log gitUsername & gitPassword values

      log.verbose("SSE: GitController: received fetch-commit-push request");

      const changedFiles = await this.listChangedFiles();
      if (changedFiles.length < 1) {
        return { errors: ["No changes to submit!"] };
      }

      await this.setAuthor({ name: authorName, email: authorEmail });

      try {
        await this.setAuth({ username: gitUsername, password: gitPassword });
      } catch (e) {
        return { errors: [`Error while authenticating: ${e.toString()}`] };
      }

      await this.addAllChanges();
      await this.commit(commitMsg);

      try {
        await this.pull();
      } catch (e) {
        log.warn("SSE: GitController: Failed to pull & merge changes!");
        return { errors: [`Error while fetching and merging changes: ${e.toString()}`] };
      }

      try {
        await this.push();
      } catch (e) {
        log.warn("SSE: GitController: Failed to push changes!");
        return { errors: [`Error while pushing changes: ${e.toString()}`] };
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

  if ((await gitCtrl.isInitialized()) === true && force === false) {
    log.verbose("SSE: GitController: Already initialized");

    const remoteUrl = await gitCtrl.getOriginUrl();
    if (remoteUrl !== null && remoteUrl.trim() === repoUrl.trim()) {
      log.verbose("SSE: GitController: Current remote URL matches configured repo URL");
      const changedFiles = await gitCtrl.listChangedFiles();
      if (changedFiles.length < 1) {
        log.verbose("SSE: GitController: There are no local changes, let’s pull");
        await gitCtrl.pull();
      } else {
        log.verbose("SSE: GitController: There are some local changes, not pulling");
      }
    } else {
      log.warn("SSE: GitController: Current remote URL does NOT match configured repo URL");
      await gitCtrl.forceInitialize();
    }
  } else {
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
