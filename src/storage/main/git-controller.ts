import * as path from 'path';
import * as fs from 'fs-extra';
import * as git from 'isomorphic-git';

import { ipcMain } from 'electron';

import { makeEndpoint } from '../../api/main';
import { Setting, SettingManager } from '../../settings/main';
import { WindowOpenerParams, openWindow } from '../../main/window';

import { GitAuthor, GitAuthentication } from '../git';


export class GitController {
  private auth: GitAuthentication = {};

  constructor(
      private fs: any,
      private repoUrl: string,
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
    await git.config({ dir: this.workDir, path: 'user.name', value: author.name });
    await git.config({ dir: this.workDir, path: 'user.email', value: author.email });
  }

  async setAuth(auth: GitAuthentication): Promise<boolean> {
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

  async getOriginUrl(): Promise<string | null> {
    return ((await git.listRemotes({
      dir: this.workDir,
    })).find(r => r.remote === 'origin') || { url: null }).url;
  }

  async getUpstreamUrl(): Promise<string | null> {
    return ((await git.listRemotes({
      dir: this.workDir,
    })).find(r => r.remote === 'upstream') || { url: null }).url;
  }

  async addAllChanges() {
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
    await git.pull({
      dir: this.workDir,
      ref: 'master',
      singleBranch: true,
      fastForwardOnly: true,
      ...this.auth,
    });
  }

  async commit(msg: string) {
    await git.commit({
      dir: this.workDir,
      message: msg,
      author: {},
    });
  }

  async push() {
    await git.push({
      dir: this.workDir,
      remote: 'origin',
      ...this.auth,
    });
  }

  async reset() {
    await this.fs.remove(this.workDir);
    await this.fs.ensureDir(this.workDir);
    await git.clone({
      dir: this.workDir,
      url: this.repoUrl,
      ref: 'master',
      singleBranch: true,
      depth: 10,
      corsProxy: this.corsProxy,
      ...this.auth,
    });
  }

  setUpAPIEndpoints() {

    makeEndpoint<{ originURL: string | null, author: GitAuthor }>('git-config', async () => {
      return {
        originURL: await this.getOriginUrl(),
        author: await this.getAuthor(),
      };
    });

    makeEndpoint<{ filenames: string[] }>('list-local-changes', async () => {
      return { filenames: await this.listChangedFiles() };
    });

    makeEndpoint<{ errors: string[] }>('fetch-commit-push', async ({
        commitMsg,
        authorName,
        authorEmail,
        gitUsername,
        gitPassword,
      }: {
        commitMsg: string,
        authorName: string,
        authorEmail: string,
        gitUsername: string,
        gitPassword: string
      }) => {

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
        return { errors: [`Error while fetching and merging changes: ${e.toString()}`] };
      }

      try {
        await this.push();
      } catch (e) {
        return { errors: [`Error while pushing changes: ${e.toString()}`] };
      }

      return { errors: [] };
    });

  }
}


export async function initRepo(
    workDir: string,
    repoUrl: string,
    corsProxyUrl: string): Promise<GitController> {

  const gitCtrl = new GitController(fs, repoUrl, workDir, corsProxyUrl);

  if ((await gitCtrl.isInitialized()) === true) {
    const remoteUrl = await gitCtrl.getOriginUrl();
    if (remoteUrl !== null && remoteUrl.trim() === repoUrl.trim()) {
      const changedFiles = await gitCtrl.listChangedFiles();
      if (changedFiles.length < 1) {
        await gitCtrl.pull();
      }
    } else {
      await gitCtrl.reset();
    }
  } else {
    await gitCtrl.reset();
  }

  return gitCtrl;
}


/* Promises to return a string containing configured repository URL.
   If repository URL is not configured (e.g., on first run, or after reset)
   opens a window with specified options.
   The window is expected to ask the user to specify the URL and send a `'set-setting'`
   event for `'gitRepoUrl'`. */
export async function setRepoUrl(
    configWindow: WindowOpenerParams,
    settings: SettingManager): Promise<string> {

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

  return new Promise<string>(async (resolve, reject) => {
    if (!repoUrl) {
      await openWindow(configWindow);
      ipcMain.on('set-setting', handleSetting);

      function handleSetting(evt: any, name: string, value: string) {
        if (name === 'gitRepoUrl') {
          ipcMain.removeListener('set-setting', handleSetting);
          resolve(value);
        }
        evt.reply('ok');
      }
    } else {
      resolve(repoUrl);
    }
  });
}
