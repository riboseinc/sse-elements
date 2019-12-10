import * as log from 'electron-log';

import { DatabaseBackendOptions } from '../../../config/main';
import { Index } from '../../query';

import { VersionedFilesystemBackend, VersionedFilesystemManager } from '../base';
import { YAMLDirectoryWrapper } from './yaml';
import { IsoGitWrapper } from './isogit';
import { UniqueConstraintError } from '../../errors';


export class Backend implements VersionedFilesystemBackend {
  /* Combines a filesystem storage with Git. */

  private git: IsoGitWrapper;
  private fs: YAMLDirectoryWrapper;
  private managers: VersionedFilesystemManager[];

  constructor(private opts: DatabaseBackendOptions) {
    this.fs = new YAMLDirectoryWrapper(this.opts.workDir);

    this.managers = [];

    // this.collections = Object.entries(this.opts.collections).map(([collectionID, collectionOptions]) => {
    //   return { [collectionID]: { index: {}, opts: collectionOptions } } as Partial<Collections>;
    // }).reduce((val, acc) => ({ ...acc, ...val }), {} as Partial<Collections>) as Collections;
  }

  public getWorkDir() {
    return this.opts.workDir;
  }

  public async registerManager(manager: VersionedFilesystemManager) {
    this.managers.push(manager);
  }

  public async init() {}

  public async authenticate() {
    // Authenticates Git
  }

  public async read(objID: string, metaFields: string[]) {
    return await this.fs.read(this.getRef(objID), metaFields) as object;
  }

  public async create<O extends Record<string, any>>(obj: O, objPath: string, metaFields: (keyof O)[]) {
    if (await this.fs.exists(objPath)) {
      throw new UniqueConstraintError("filesystem path", objPath);
    }

    await this.fs.write(objPath, obj, metaFields);
  }

  public async commit(objIDs: string[], message: string) {
    await this.resetOrphanedFileChanges();

    const paths: string[] = (await this.readUncommittedFileInfo()).
      filter(fileinfo => objIDs.indexOf(fileinfo.path) >= 0).
      map(fileinfo => fileinfo.path);

    if (paths.length > 0) {
      await this.git.stageAndCommit(paths, message);
    }
  }

  public async discard(objIDs: string[]) {
    const paths: string[] = (await this.readUncommittedFileInfo()).
      filter(fileinfo => objIDs.indexOf(fileinfo.path) >= 0).
      map(fileinfo => fileinfo.path);

    if (paths.length > 0) {
      await this.git.resetFiles(paths);
    }
  }

  public async listUncommitted() {
    const files = await this.readUncommittedFileInfo();

    const objIDs: string[] = files.
      map(fileinfo => fileinfo.path);

    return objIDs.filter(function (objID, idx, self) {
      return idx === self.indexOf(objID);
    });
  }

  public async readAll(idField: string) {
    const objs = await this.fs.readAll();
    var idx: Index<any> = {};
    for (const obj of objs) {
      idx[`${obj[idField]}`] = obj;
    }
    return idx;
  }

  public async update(objID: string, newData: Record<string, any>, idField: string) {
    if (objID !== newData[idField]) {
      throw new Error("Updating object IDs is not supported at the moment.");
    }

    await this.fs.write(this.getRef(objID), newData);
  }

  public async delete(objID: string) {
    await this.fs.write(this.getRef(objID), undefined);
  }

  public async resetOrphanedFileChanges(): Promise<void> {
    /* Remove from filesystem any files under our FS backend path
       that the backend cannot account for. */

    const orphanFilePaths = (await this.readUncommittedFileInfo()).
    map(fileinfo => fileinfo.path).
    filter(filepath => this.managers.map(mgr => mgr.managesFileAtPath(filepath)).indexOf(true) >= 0);

    if (orphanFilePaths.length > 0) {
      log.warn("SSE: GitFilesystem: Resetting orphaned files", orphanFilePaths);
      await this.git.resetFiles(orphanFilePaths);
    }
  }

  private async readUncommittedFileInfo(): Promise<{ path: string }[]> {
    /* Returns a list of objects that map Git-relative paths to actual object IDs.
       Where object ID is undefined, that implies file is “orphaned”
       (not recognized as belonging to any object managed by this store). */

    const changedFiles: string[] = await this.git.listChangedFiles(['.']);
    return await Promise.all(changedFiles.map(fp => {
      return { path: fp };
    }));
  }

  private getRef(objID: string | number): string {
    /* Returns FS backend reference given object ID. */
    return `${objID}`;
  }
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


export default Backend;
