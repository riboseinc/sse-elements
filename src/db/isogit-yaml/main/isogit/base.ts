import * as dns from 'dns';
import * as path from 'path';
import AsyncLock from 'async-lock';
import * as git from 'isomorphic-git';
import * as log from 'electron-log';

import { BackendStatusReporter } from '../base';

import { GitAuthentication } from './types';


const UPSTREAM_REMOTE = 'upstream';
const MAIN_REMOTE = 'origin';


export class IsoGitWrapper {

  private auth: GitAuthentication = {};

  private stagingLock: AsyncLock;

  constructor(
      private fs: any,
      private repoUrl: string,
      private upstreamRepoUrl: string,
      public workDir: string,
      private corsProxy: string) {

    git.plugins.set('fs', fs);

    this.stagingLock = new AsyncLock({ timeout: 20000, maxPending: 2 });

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
    /* Initializes from scratch: wipes work directory, clones repository, adds remotes. */

    log.warn("SSE: IsoGitWrapper: Force initializing");
    log.warn("SSE: IsoGitWrapper: Initialize: Removing data directory");

    await this.fs.remove(this.workDir);

    log.silly("SSE: IsoGitWrapper: Initialize: Ensuring data directory exists");

    await this.fs.ensureDir(this.workDir);

    log.verbose("SSE: IsoGitWrapper: Initialize: Cloning", this.repoUrl);

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
    log.verbose("SSE: IsoGitWrapper: Set config");
    await git.config({ dir: this.workDir, path: prop, value: val });
  }

  public async configGet(prop: string): Promise<string> {
    log.verbose("SSE: IsoGitWrapper: Get config", prop);
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
    log.verbose("SSE: IsoGitWrapper: Pulling master with fast-forward merge");

    return await git.pull({
      dir: this.workDir,
      singleBranch: true,
      fastForwardOnly: true,
      fast: true,
      ...this.auth,
    });
  }

  async stage(pathSpecs: string[]) {
    log.verbose(`SSE: IsoGitWrapper: Adding changes: ${pathSpecs.join(', ')}`);

    for (const pathSpec of pathSpecs) {
      await git.add({
        dir: this.workDir,
        filepath: pathSpec,
      });
    }
  }

  async commit(msg: string) {
    log.verbose(`SSE: IsoGitWrapper: Committing with message ${msg}`);

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
    log.verbose("SSE: IsoGitWrapper: Pushing");

    return await git.push({
      dir: this.workDir,
      remote: MAIN_REMOTE,
      force: force,
      ...this.auth,
    });
  }

  public async resetFiles(paths?: string[]) {
    return await this.stagingLock.acquire('1', async () => {
      log.verbose("SSE: IsoGitWrapper: Force resetting files");

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
      log.verbose(`SSE: IsoGitWrapper: Staging and committing: ${pathSpecs.join(', ')}`);

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
    log.verbose("SSE: IsoGitWrapper: Unstaging all changes");
    await git.remove({ dir: this.workDir, filepath: '.' });
  }

  private async _handleGitError(
    sendRemoteStatus: BackendStatusReporter,
    e: Error & { code: string },
  ): Promise<void> {
    if (e.code === 'FastForwardFail' || e.code === 'MergeNotSupportedFail') {
      // NOTE: There’s also PushRejectedNonFastForward, but it seems to be thrown
      // for unrelated cases during push (false positive).
      // Because of that false positive, we ignore that error and instead do pull first,
      // catching actual fast-forward fails on that step before push.
      await sendRemoteStatus({ statusRelativeToLocal: 'diverged' });
    } else if (['MissingUsernameError', 'MissingAuthorError', 'MissingCommitterError'].indexOf(e.code) >= 0) {
      await sendRemoteStatus({ isMisconfigured: true });
    } else if (
        e.code === 'MissingPasswordTokenError'
        || (e.code === 'HTTPError' && e.message.indexOf('Unauthorized') >= 0)) {
      this.setPassword(undefined);
      await sendRemoteStatus({ needsPassword: true });
    }
  }

  public async checkUncommitted(sendRemoteStatus: BackendStatusReporter): Promise<boolean> {
    /* Checks for any uncommitted changes locally present.
       Notifies all windows about the status. */

    log.debug("SSE: Git: Checking for uncommitted changes");
    const hasUncommittedChanges = (await this.listChangedFiles()).length > 0;
    await sendRemoteStatus({ hasLocalChanges: hasUncommittedChanges });
    return hasUncommittedChanges;
  }

  public async synchronize(sendRemoteStatus: BackendStatusReporter): Promise<void> {
    /* Checks for connection, local changes and unpushed commits,
       tries to push and pull when there’s opportunity.

       Notifies all windows about the status in process. */

    log.verbose("SSE: Git: Queueing sync");
    return await this.stagingLock.acquire('1', async () => {
      log.verbose("SSE: Git: Starting sync");

      const hasUncommittedChanges = await this.checkUncommitted(sendRemoteStatus);

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
            await this._handleGitError(sendRemoteStatus, e);
            return;
          }
          await sendRemoteStatus({ isPulling: false });

          await sendRemoteStatus({ isPushing: true });
          try {
            await this.push();
          } catch (e) {
            log.error(e);
            await sendRemoteStatus({ isPushing: false });
            await this._handleGitError(sendRemoteStatus, e);
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


// TODO: Temporary workaround since isomorphic-git doesn’t seem to export its GitError class
// in any way available to TS, so we can’t use instanceof :(

export function isGitError(e: Error & { code: string }) {
  if (!e.code) {
    return false;
  }
  return Object.keys(IsomorphicGitErrorCodes).indexOf(e.code) >= 0;
}

const IsomorphicGitErrorCodes = {
  FileReadError: `FileReadError`,
  MissingRequiredParameterError: `MissingRequiredParameterError`,
  InvalidRefNameError: `InvalidRefNameError`,
  InvalidParameterCombinationError: `InvalidParameterCombinationError`,
  RefExistsError: `RefExistsError`,
  RefNotExistsError: `RefNotExistsError`,
  BranchDeleteError: `BranchDeleteError`,
  NoHeadCommitError: `NoHeadCommitError`,
  CommitNotFetchedError: `CommitNotFetchedError`,
  ObjectTypeUnknownFail: `ObjectTypeUnknownFail`,
  ObjectTypeAssertionFail: `ObjectTypeAssertionFail`,
  ObjectTypeAssertionInTreeFail: `ObjectTypeAssertionInTreeFail`,
  ObjectTypeAssertionInRefFail: `ObjectTypeAssertionInRefFail`,
  ObjectTypeAssertionInPathFail: `ObjectTypeAssertionInPathFail`,
  MissingAuthorError: `MissingAuthorError`,
  MissingCommitterError: `MissingCommitterError`,
  MissingTaggerError: `MissingTaggerError`,
  GitRootNotFoundError: `GitRootNotFoundError`,
  UnparseableServerResponseFail: `UnparseableServerResponseFail`,
  InvalidDepthParameterError: `InvalidDepthParameterError`,
  RemoteDoesNotSupportShallowFail: `RemoteDoesNotSupportShallowFail`,
  RemoteDoesNotSupportDeepenSinceFail: `RemoteDoesNotSupportDeepenSinceFail`,
  RemoteDoesNotSupportDeepenNotFail: `RemoteDoesNotSupportDeepenNotFail`,
  RemoteDoesNotSupportDeepenRelativeFail: `RemoteDoesNotSupportDeepenRelativeFail`,
  RemoteDoesNotSupportSmartHTTP: `RemoteDoesNotSupportSmartHTTP`,
  CorruptShallowOidFail: `CorruptShallowOidFail`,
  FastForwardFail: `FastForwardFail`,
  MergeNotSupportedFail: `MergeNotSupportedFail`,
  DirectorySeparatorsError: `DirectorySeparatorsError`,
  ResolveTreeError: `ResolveTreeError`,
  ResolveCommitError: `ResolveCommitError`,
  DirectoryIsAFileError: `DirectoryIsAFileError`,
  TreeOrBlobNotFoundError: `TreeOrBlobNotFoundError`,
  NotImplementedFail: `NotImplementedFail`,
  ReadObjectFail: `ReadObjectFail`,
  NotAnOidFail: `NotAnOidFail`,
  NoRefspecConfiguredError: `NoRefspecConfiguredError`,
  MismatchRefValueError: `MismatchRefValueError`,
  ResolveRefError: `ResolveRefError`,
  ExpandRefError: `ExpandRefError`,
  EmptyServerResponseFail: `EmptyServerResponseFail`,
  AssertServerResponseFail: `AssertServerResponseFail`,
  HTTPError: `HTTPError`,
  RemoteUrlParseError: `RemoteUrlParseError`,
  UnknownTransportError: `UnknownTransportError`,
  AcquireLockFileFail: `AcquireLockFileFail`,
  DoubleReleaseLockFileFail: `DoubleReleaseLockFileFail`,
  InternalFail: `InternalFail`,
  UnknownOauth2Format: `UnknownOauth2Format`,
  MissingPasswordTokenError: `MissingPasswordTokenError`,
  MissingUsernameError: `MissingUsernameError`,
  MixPasswordTokenError: `MixPasswordTokenError`,
  MixUsernamePasswordTokenError: `MixUsernamePasswordTokenError`,
  MissingTokenError: `MissingTokenError`,
  MixUsernameOauth2formatMissingTokenError: `MixUsernameOauth2formatMissingTokenError`,
  MixPasswordOauth2formatMissingTokenError: `MixPasswordOauth2formatMissingTokenError`,
  MixUsernamePasswordOauth2formatMissingTokenError: `MixUsernamePasswordOauth2formatMissingTokenError`,
  MixUsernameOauth2formatTokenError: `MixUsernameOauth2formatTokenError`,
  MixPasswordOauth2formatTokenError: `MixPasswordOauth2formatTokenError`,
  MixUsernamePasswordOauth2formatTokenError: `MixUsernamePasswordOauth2formatTokenError`,
  MaxSearchDepthExceeded: `MaxSearchDepthExceeded`,
  PushRejectedNonFastForward: `PushRejectedNonFastForward`,
  PushRejectedTagExists: `PushRejectedTagExists`,
  AddingRemoteWouldOverwrite: `AddingRemoteWouldOverwrite`,
  PluginUndefined: `PluginUndefined`,
  CoreNotFound: `CoreNotFound`,
  PluginSchemaViolation: `PluginSchemaViolation`,
  PluginUnrecognized: `PluginUnrecognized`,
  AmbiguousShortOid: `AmbiguousShortOid`,
  ShortOidNotFound: `ShortOidNotFound`,
  CheckoutConflictError: `CheckoutConflictError`
}

