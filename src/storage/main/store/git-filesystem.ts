import * as path from 'path';
import * as log from 'electron-log';

import { Index, IndexableObject, AnyIDType } from '../../query';
import { FilesystemBackend } from '../filesystem/base';
import { GitController } from '../git-controller';
import { VersionedStore, IDTakenError, CommitError } from './base';


export class GitFilesystemStore<
  O extends IndexableObject<IDType>,
  FSBackend extends FilesystemBackend<any>,
  IDType extends AnyIDType>
implements VersionedStore<O, IDType> {
  /* Combines a filesystem storage with Git. */

  protected _index: Index<O> | undefined = undefined;
  private fsBaseRelativeToGit: string;

  constructor(
      public objectLabel: string,
      private fs: FSBackend,
      private git: GitController,
      private idField: keyof O = 'id') {

    // Ensure that FS backend base directory is underneat Git working directory.
    // TODO: Instead of validating this in the constructor,
    // we could simply request a relative path and instantiate FS backend here,
    // taking backend params as an object.
    const relativeFsBase = path.relative(git.workDir, fs.baseDir);
    if (relativeFsBase.startsWith('..') || path.isAbsolute(relativeFsBase)) {
      // NOTE: Files/directories which names begin with double period will cause false positive.
      throw new Error("FS backend base directory must be within Git controller working directory");
    }

    this.fsBaseRelativeToGit = relativeFsBase;
  }

  public async read(objId: IDType) {
    return await this.fs.read(this.getRef(objId)) as O;
  }

  public async listIDsWithUncommittedChanges() {
    const changedFiles = await this.git.listChangedFiles([this.fsBaseRelativeToGit]);
    const changedFilesRelative = changedFiles.map(fp => path.relative(this.fsBaseRelativeToGit, fp));

    const resolvedObjects = await Promise.all(changedFilesRelative.map(async (fp) => {
      let ref: string | undefined;
      try { ref = await this.fs.resolveObjectId(fp); }
      catch (e) { ref = undefined; }
      return { path: fp, ref: ref };
    }));

    const orphanFiles = resolvedObjects.filter(obj => obj.ref === undefined);
    if (orphanFiles.length > 0) {
      log.warn("SSE: GitFilesystem: Resetting orphaned files",
        orphanFiles.map(obj => this.gitRelativePath(obj.path)));
      await this.git.resetFiles(orphanFiles.map(obj => this.gitRelativePath(obj.path)));
    }

    return resolvedObjects.
      filter(obj => obj.ref !== undefined).
      reduce((acc, obj) => {
        var paths = [ ...(acc[obj.ref as string] || []) ];
        paths.push(obj.path);
        acc[obj.ref as string] = paths;
        return acc;
      }, {} as { [key: string]: string[] });
  }

  public async getIndex() {
    const objs: O[] = await this.fs.readAll();
    var idx: Index<O> = {};
    for (const obj of objs) {
      idx[`${obj[this.idField]}`] = obj as O;
    }
    return idx;
  }

  public async create(obj: O, commit: boolean | string = false) {
    const objPath = this.getRef(obj[this.idField]);

    if (await this.fs.exists(objPath)) {
      throw new IDTakenError(obj[this.idField]);
    }

    const paths = await this.fs.write(objPath, obj);

    if (commit !== false) {
      await this.gitCommit(
        paths,
        commit !== true ? commit : null,
        { verb: 'delete', objId: obj[this.idField], obj });
    }
  }

  public async update(objId: IDType, newData: O, commit: boolean | string = false) {
    if (objId !== newData[this.idField]) {
      throw new Error("Updating object IDs is not supported at the moment.");
    }

    const affectedPaths = await this.fs.write(this.getRef(objId), newData);

    if (commit !== false) {
      await this.gitCommit(
        affectedPaths,
        commit !== true ? commit : null,
        { verb: 'update', objId, obj: newData });
    }
  }

  public async delete(objId: IDType, commit: string | boolean = false) {
    const paths = await this.fs.write(this.getRef(objId), undefined);

    if (commit !== false) {
      await this.gitCommit(
        paths,
        commit !== true ? commit : null,
        { verb: 'delete', objId });
    }
  }

  private async gitCommit(fsPaths: string[], commitMessage: string | null, autoCommitOpts: AutoCommitMessageOptions<O, IDType>) {
    try {
      await this.git.stageAndCommit(
        fsPaths.map(p => this.gitRelativePath(p)),
        commitMessage !== null
          ? commitMessage
          : this.formatCommitMessage(autoCommitOpts.verb, autoCommitOpts.objId, autoCommitOpts.obj));

    } catch (e) {
      if (isGitError(e)) {
        throw new CommitError(e.code, e.message);
      } else {
        throw e;
      }
    }
  }

  private formatObjectName(objId: IDType, obj?: O) {
    return `${objId}`;
  }

  private formatCommitMessage(verb: string, objId: IDType, obj?: O) {
    return `${verb} ${this.objectLabel} ${this.formatObjectName(objId, obj)}`;
  }

  private getRef(objId: IDType): string {
    /* Returns FS backend reference given object ID. */
    return `${objId}`;
  }

  private gitRelativePath(fsPath: string): string {
    return path.join(this.fsBaseRelativeToGit, fsPath);
  }
}


interface AutoCommitMessageOptions<O, IDType> {
  verb: string,
  objId: IDType,
  obj?: O,
}


// TODO: Temporary workaround since isomorphic-git doesn’t seem to export its GitError class
// in any way available to TS, so we can’t use instanceof :(

function isGitError(e: Error & { code: string }) {
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
