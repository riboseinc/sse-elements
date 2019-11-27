import * as path from 'path';
import * as log from 'electron-log';
import { IDTakenError, CommitError } from './base';
export class GitFilesystemStore {
    constructor(objectLabel, fs, git, idField = 'id') {
        this.objectLabel = objectLabel;
        this.fs = fs;
        this.git = git;
        this.idField = idField;
        /* Combines a filesystem storage with Git. */
        this._index = undefined;
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
    async read(objId) {
        return await this.fs.read(this.getRef(objId));
    }
    async commit(objIds, message) {
        const paths = (await this.readUncommittedFileInfo()).
            filter(fileinfo => fileinfo.objId !== undefined).
            filter(fileinfo => objIds.indexOf(fileinfo.objId) >= 0).
            map(fileinfo => fileinfo.path);
        if (paths.length > 0) {
            await this.git.stageAndCommit(paths, message);
        }
    }
    async discard(objIds) {
        const paths = (await this.readUncommittedFileInfo()).
            filter(fileinfo => fileinfo.objId !== undefined).
            filter(fileinfo => objIds.indexOf(fileinfo.objId) >= 0).
            map(fileinfo => fileinfo.path);
        if (paths.length > 0) {
            await this.git.resetFiles(paths);
        }
    }
    async listUncommitted() {
        const files = await this.readUncommittedFileInfo();
        const objIds = files.
            map(fileinfo => fileinfo.objId).
            filter(objId => objId !== undefined);
        return objIds.filter(function (objId, idx, self) {
            return idx === self.indexOf(objId);
        });
    }
    async getIndex() {
        const objs = await this.fs.readAll();
        var idx = {};
        for (const obj of objs) {
            idx[`${obj[this.idField]}`] = obj;
        }
        return idx;
    }
    async create(obj, commit = false) {
        const objPath = this.getRef(obj[this.idField]);
        if (await this.fs.exists(objPath)) {
            throw new IDTakenError(obj[this.idField]);
        }
        const paths = await this.fs.write(objPath, obj);
        if (commit !== false) {
            await this.gitCommit(paths, commit !== true ? commit : null, { verb: 'create', objId: obj[this.idField], obj });
        }
    }
    async update(objId, newData, commit = false) {
        if (objId !== newData[this.idField]) {
            throw new Error("Updating object IDs is not supported at the moment.");
        }
        const affectedPaths = await this.fs.write(this.getRef(objId), newData);
        if (commit !== false) {
            await this.gitCommit(affectedPaths, commit !== true ? commit : null, { verb: 'update', objId, obj: newData });
        }
    }
    async delete(objId, commit = false) {
        const paths = await this.fs.write(this.getRef(objId), undefined);
        if (commit !== false) {
            await this.gitCommit(paths, commit !== true ? commit : null, { verb: 'delete', objId });
        }
    }
    async gitCommit(fsPaths, commitMessage, autoCommitOpts) {
        await this.resetOrphanFileChanges();
        try {
            await this.git.stageAndCommit(fsPaths.map(p => this.gitRelativePath(p)), commitMessage !== null
                ? commitMessage
                : this.formatCommitMessage(autoCommitOpts.verb, autoCommitOpts.objId, autoCommitOpts.obj));
        }
        catch (e) {
            if (isGitError(e)) {
                throw new CommitError(e.code, e.message);
            }
            else {
                throw e;
            }
        }
    }
    async resetOrphanFileChanges() {
        /* Remove from filesystem any files under our FS backend path
           that the backend cannot account for. */
        const orphanFilePaths = (await this.readUncommittedFileInfo()).
            filter(fileinfo => fileinfo.objId === undefined).
            map(fileinfo => fileinfo.path);
        if (orphanFilePaths.length > 0) {
            log.warn("SSE: GitFilesystem: Resetting orphaned files", orphanFilePaths.map(fp => this.gitRelativePath(fp)));
            await this.git.resetFiles(orphanFilePaths.map(fp => this.gitRelativePath(fp)));
        }
    }
    async readUncommittedFileInfo() {
        /* Returns a list of objects that map Git-relative paths to actual object IDs.
           Where object ID is undefined, that implies file is “orphaned”
           (not recognized as belonging to any object managed by this store). */
        const changedFiles = await this.git.listChangedFiles([this.fsBaseRelativeToGit]);
        console.debug("Uncommitted files", changedFiles);
        const idx = await this.getIndex();
        return await Promise.all(changedFiles.map(async (fp) => {
            let ref;
            try {
                ref = await this.fs.resolveObjectId(this.fsRelativePath(fp));
            }
            catch (e) {
                ref = undefined;
            }
            const obj = ref !== undefined ? idx[ref] : undefined;
            let objId;
            if (obj !== undefined) {
                objId = obj[this.idField];
            }
            else {
                objId = undefined;
            }
            return { path: fp, objId };
        }));
    }
    formatObjectName(objId, obj) {
        return `${objId}`;
    }
    formatCommitMessage(verb, objId, obj) {
        return `${verb} ${this.objectLabel} ${this.formatObjectName(objId, obj)}`;
    }
    getRef(objId) {
        /* Returns FS backend reference given object ID. */
        return `${objId}`;
    }
    gitRelativePath(fsPath) {
        return path.join(this.fsBaseRelativeToGit, fsPath);
    }
    fsRelativePath(gitPath) {
        if (path.isAbsolute(gitPath)) {
            throw new Error("fsRelativePath() must be given Git-relative path");
        }
        return path.relative(this.fsBaseRelativeToGit, gitPath);
    }
}
// TODO: Temporary workaround since isomorphic-git doesn’t seem to export its GitError class
// in any way available to TS, so we can’t use instanceof :(
function isGitError(e) {
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
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2l0LWZpbGVzeXN0ZW0uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc3RvcmFnZS9tYWluL3N0b3JlL2dpdC1maWxlc3lzdGVtLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sS0FBSyxJQUFJLE1BQU0sTUFBTSxDQUFDO0FBQzdCLE9BQU8sS0FBSyxHQUFHLE1BQU0sY0FBYyxDQUFDO0FBS3BDLE9BQU8sRUFBa0IsWUFBWSxFQUFFLFdBQVcsRUFBRSxNQUFNLFFBQVEsQ0FBQztBQUduRSxNQUFNLE9BQU8sa0JBQWtCO0lBVTdCLFlBQ1csV0FBbUIsRUFDbEIsRUFBYSxFQUNiLEdBQWtCLEVBQ2xCLFVBQW1CLElBQUk7UUFIeEIsZ0JBQVcsR0FBWCxXQUFXLENBQVE7UUFDbEIsT0FBRSxHQUFGLEVBQUUsQ0FBVztRQUNiLFFBQUcsR0FBSCxHQUFHLENBQWU7UUFDbEIsWUFBTyxHQUFQLE9BQU8sQ0FBZ0I7UUFUbkMsNkNBQTZDO1FBRW5DLFdBQU0sR0FBeUIsU0FBUyxDQUFDO1FBU2pELDRFQUE0RTtRQUM1RSx1REFBdUQ7UUFDdkQsMkVBQTJFO1FBQzNFLHNDQUFzQztRQUN0QyxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQzlELElBQUksY0FBYyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsSUFBSSxJQUFJLENBQUMsVUFBVSxDQUFDLGNBQWMsQ0FBQyxFQUFFO1lBQ3RFLDBGQUEwRjtZQUMxRixNQUFNLElBQUksS0FBSyxDQUFDLDJFQUEyRSxDQUFDLENBQUM7U0FDOUY7UUFFRCxJQUFJLENBQUMsbUJBQW1CLEdBQUcsY0FBYyxDQUFDO0lBQzVDLENBQUM7SUFFTSxLQUFLLENBQUMsSUFBSSxDQUFDLEtBQWE7UUFDN0IsT0FBTyxNQUFNLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLElB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QUUsNEJBQTRCO0lBQ3hELHFCQUFxQixFQUFFLHVCQUF1QjtJQUM5QywwQkFBMEIsRUFBRSw0QkFBNEI7SUFDeEQsZUFBZSxFQUFFLGlCQUFpQjtJQUNsQyxZQUFZLEVBQUUsY0FBYztJQUM1QixxQkFBcUIsRUFBRSx1QkFBdUI7SUFDOUMsa0JBQWtCLEVBQUUsb0JBQW9CO0lBQ3hDLGlCQUFpQixFQUFFLG1CQUFtQjtJQUN0QyxnQkFBZ0IsRUFBRSxrQkFBa0I7SUFDcEMscUJBQXFCLEVBQUUsdUJBQXVCO0NBQy9DLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgbG9nIGZyb20gJ2VsZWN0cm9uLWxvZyc7XG5cbmltcG9ydCB7IEluZGV4LCBJbmRleGFibGVPYmplY3QsIEFueUlEVHlwZSB9IGZyb20gJy4uLy4uL3F1ZXJ5JztcbmltcG9ydCB7IEZpbGVzeXN0ZW1CYWNrZW5kIH0gZnJvbSAnLi4vZmlsZXN5c3RlbS9iYXNlJztcbmltcG9ydCB7IEdpdENvbnRyb2xsZXIgfSBmcm9tICcuLi9naXQvY29udHJvbGxlcic7XG5pbXBvcnQgeyBWZXJzaW9uZWRTdG9yZSwgSURUYWtlbkVycm9yLCBDb21taXRFcnJvciB9IGZyb20gJy4vYmFzZSc7XG5cblxuZXhwb3J0IGNsYXNzIEdpdEZpbGVzeXN0ZW1TdG9yZTxcbiAgTyBleHRlbmRzIEluZGV4YWJsZU9iamVjdDxJRFR5cGU+LFxuICBGU0JhY2tlbmQgZXh0ZW5kcyBGaWxlc3lzdGVtQmFja2VuZDxhbnk+LFxuICBJRFR5cGUgZXh0ZW5kcyBBbnlJRFR5cGU+XG5pbXBsZW1lbnRzIFZlcnNpb25lZFN0b3JlPE8sIElEVHlwZT4ge1xuICAvKiBDb21iaW5lcyBhIGZpbGVzeXN0ZW0gc3RvcmFnZSB3aXRoIEdpdC4gKi9cblxuICBwcm90ZWN0ZWQgX2luZGV4OiBJbmRleDxPPiB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSBmc0Jhc2VSZWxhdGl2ZVRvR2l0OiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgICBwdWJsaWMgb2JqZWN0TGFiZWw6IHN0cmluZyxcbiAgICAgIHByaXZhdGUgZnM6IEZTQmFja2VuZCxcbiAgICAgIHByaXZhdGUgZ2l0OiBHaXRDb250cm9sbGVyLFxuICAgICAgcHJpdmF0ZSBpZEZpZWxkOiBrZXlvZiBPID0gJ2lkJykge1xuXG4gICAgLy8gRW5zdXJlIHRoYXQgRlMgYmFja2VuZCBiYXNlIGRpcmVjdG9yeSBpcyB1bmRlcm5lYXQgR2l0IHdvcmtpbmcgZGlyZWN0b3J5LlxuICAgIC8vIFRPRE86IEluc3RlYWQgb2YgdmFsaWRhdGluZyB0aGlzIGluIHRoZSBjb25zdHJ1Y3RvcixcbiAgICAvLyB3ZSBjb3VsZCBzaW1wbHkgcmVxdWVzdCBhIHJlbGF0aXZlIHBhdGggYW5kIGluc3RhbnRpYXRlIEZTIGJhY2tlbmQgaGVyZSxcbiAgICAvLyB0YWtpbmcgYmFja2VuZCBwYXJhbXMgYXMgYW4gb2JqZWN0LlxuICAgIGNvbnN0IHJlbGF0aXZlRnNCYXNlID0gcGF0aC5yZWxhdGl2ZShnaXQud29ya0RpciwgZnMuYmFzZURpcik7XG4gICAgaWYgKHJlbGF0aXZlRnNCYXNlLnN0YXJ0c1dpdGgoJy4uJykgfHwgcGF0aC5pc0Fic29sdXRlKHJlbGF0aXZlRnNCYXNlKSkge1xuICAgICAgLy8gTk9URTogRmlsZXMvZGlyZWN0b3JpZXMgd2hpY2ggbmFtZXMgYmVnaW4gd2l0aCBkb3VibGUgcGVyaW9kIHdpbGwgY2F1c2UgZmFsc2UgcG9zaXRpdmUuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGUyBiYWNrZW5kIGJhc2UgZGlyZWN0b3J5IG11c3QgYmUgd2l0aGluIEdpdCBjb250cm9sbGVyIHdvcmtpbmcgZGlyZWN0b3J5XCIpO1xuICAgIH1cblxuICAgIHRoaXMuZnNCYXNlUmVsYXRpdmVUb0dpdCA9IHJlbGF0aXZlRnNCYXNlO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHJlYWQob2JqSWQ6IElEVHlwZSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZzLnJlYWQodGhpcy5nZXRSZWYob2JqSWQpKSBhcyBPO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGNvbW1pdChvYmpJZHM6IElEVHlwZVtdLCBtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBjb25zdCBwYXRocyA9IChhd2FpdCB0aGlzLnJlYWRVbmNvbW1pdHRlZEZpbGVJbmZvKCkpLlxuICAgICAgZmlsdGVyKGZpbGVpbmZvID0+IGZpbGVpbmZvLm9iaklkICE9PSB1bmRlZmluZWQpLlxuICAgICAgZmlsdGVyKGZpbGVpbmZvID0+IG9iaklkcy5pbmRleE9mKGZpbGVpbmZvLm9iaklkIGFzIElEVHlwZSkgPj0gMCkuXG4gICAgICBtYXAoZmlsZWluZm8gPT4gZmlsZWluZm8ucGF0aCk7XG5cbiAgICBpZiAocGF0aHMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgdGhpcy5naXQuc3RhZ2VBbmRDb21taXQocGF0aHMsIG1lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBkaXNjYXJkKG9iaklkczogSURUeXBlW10pIHtcbiAgICBjb25zdCBwYXRocyA9IChhd2FpdCB0aGlzLnJlYWRVbmNvbW1pdHRlZEZpbGVJbmZvKCkpLlxuICAgICAgZmlsdGVyKGZpbGVpbmZvID0+IGZpbGVpbmZvLm9iaklkICE9PSB1bmRlZmluZWQpLlxuICAgICAgZmlsdGVyKGZpbGVpbmZvID0+IG9iaklkcy5pbmRleE9mKGZpbGVpbmZvLm9iaklkIGFzIElEVHlwZSkgPj0gMCkuXG4gICAgICBtYXAoZmlsZWluZm8gPT4gZmlsZWluZm8ucGF0aCk7XG5cbiAgICBpZiAocGF0aHMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgdGhpcy5naXQucmVzZXRGaWxlcyhwYXRocyk7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIGFzeW5jIGxpc3RVbmNvbW1pdHRlZCgpIHtcbiAgICBjb25zdCBmaWxlcyA9IGF3YWl0IHRoaXMucmVhZFVuY29tbWl0dGVkRmlsZUluZm8oKTtcbiAgICBjb25zdCBvYmpJZHM6IElEVHlwZVtdID0gZmlsZXMuXG4gICAgICBtYXAoZmlsZWluZm8gPT4gZmlsZWluZm8ub2JqSWQpLlxuICAgICAgZmlsdGVyKG9iaklkID0+IG9iaklkICE9PSB1bmRlZmluZWQpIGFzIElEVHlwZVtdO1xuXG4gICAgcmV0dXJuIG9iaklkcy5maWx0ZXIoZnVuY3Rpb24gKG9iaklkLCBpZHgsIHNlbGYpIHtcbiAgICAgIHJldHVybiBpZHggPT09IHNlbGYuaW5kZXhPZihvYmpJZCk7XG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgZ2V0SW5kZXgoKSB7XG4gICAgY29uc3Qgb2JqczogT1tdID0gYXdhaXQgdGhpcy5mcy5yZWFkQWxsKCk7XG4gICAgdmFyIGlkeDogSW5kZXg8Tz4gPSB7fTtcbiAgICBmb3IgKGNvbnN0IG9iaiBvZiBvYmpzKSB7XG4gICAgICBpZHhbYCR7b2JqW3RoaXMuaWRGaWVsZF19YF0gPSBvYmogYXMgTztcbiAgICB9XG4gICAgcmV0dXJuIGlkeDtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBjcmVhdGUob2JqOiBPLCBjb21taXQ6IGJvb2xlYW4gfCBzdHJpbmcgPSBmYWxzZSkge1xuICAgIGNvbnN0IG9ialBhdGggPSB0aGlzLmdldFJlZihvYmpbdGhpcy5pZEZpZWxkXSk7XG5cbiAgICBpZiAoYXdhaXQgdGhpcy5mcy5leGlzdHMob2JqUGF0aCkpIHtcbiAgICAgIHRocm93IG5ldyBJRFRha2VuRXJyb3Iob2JqW3RoaXMuaWRGaWVsZF0pO1xuICAgIH1cblxuICAgIGNvbnN0IHBhdGhzID0gYXdhaXQgdGhpcy5mcy53cml0ZShvYmpQYXRoLCBvYmopO1xuXG4gICAgaWYgKGNvbW1pdCAhPT0gZmFsc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMuZ2l0Q29tbWl0KFxuICAgICAgICBwYXRocyxcbiAgICAgICAgY29tbWl0ICE9PSB0cnVlID8gY29tbWl0IDogbnVsbCxcbiAgICAgICAgeyB2ZXJiOiAnY3JlYXRlJywgb2JqSWQ6IG9ialt0aGlzLmlkRmllbGRdLCBvYmogfSk7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIGFzeW5jIHVwZGF0ZShvYmpJZDogSURUeXBlLCBuZXdEYXRhOiBPLCBjb21taXQ6IGJvb2xlYW4gfCBzdHJpbmcgPSBmYWxzZSkge1xuICAgIGlmIChvYmpJZCAhPT0gbmV3RGF0YVt0aGlzLmlkRmllbGRdKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJVcGRhdGluZyBvYmplY3QgSURzIGlzIG5vdCBzdXBwb3J0ZWQgYXQgdGhlIG1vbWVudC5cIik7XG4gICAgfVxuXG4gICAgY29uc3QgYWZmZWN0ZWRQYXRocyA9IGF3YWl0IHRoaXMuZnMud3JpdGUodGhpcy5nZXRSZWYob2JqSWQpLCBuZXdEYXRhKTtcblxuICAgIGlmIChjb21taXQgIT09IGZhbHNlKSB7XG4gICAgICBhd2FpdCB0aGlzLmdpdENvbW1pdChcbiAgICAgICAgYWZmZWN0ZWRQYXRocyxcbiAgICAgICAgY29tbWl0ICE9PSB0cnVlID8gY29tbWl0IDogbnVsbCxcbiAgICAgICAgeyB2ZXJiOiAndXBkYXRlJywgb2JqSWQsIG9iajogbmV3RGF0YSB9KTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgZGVsZXRlKG9iaklkOiBJRFR5cGUsIGNvbW1pdDogc3RyaW5nIHwgYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgcGF0aHMgPSBhd2FpdCB0aGlzLmZzLndyaXRlKHRoaXMuZ2V0UmVmKG9iaklkKSwgdW5kZWZpbmVkKTtcblxuICAgIGlmIChjb21taXQgIT09IGZhbHNlKSB7XG4gICAgICBhd2FpdCB0aGlzLmdpdENvbW1pdChcbiAgICAgICAgcGF0aHMsXG4gICAgICAgIGNvbW1pdCAhPT0gdHJ1ZSA/IGNvbW1pdCA6IG51bGwsXG4gICAgICAgIHsgdmVyYjogJ2RlbGV0ZScsIG9iaklkIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2l0Q29tbWl0KGZzUGF0aHM6IHN0cmluZ1tdLCBjb21taXRNZXNzYWdlOiBzdHJpbmcgfCBudWxsLCBhdXRvQ29tbWl0T3B0czogQXV0b0NvbW1pdE1lc3NhZ2VPcHRpb25zPE8sIElEVHlwZT4pIHtcbiAgICBhd2FpdCB0aGlzLnJlc2V0T3JwaGFuRmlsZUNoYW5nZXMoKTtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmdpdC5zdGFnZUFuZENvbW1pdChcbiAgICAgICAgZnNQYXRocy5tYXAocCA9PiB0aGlzLmdpdFJlbGF0aXZlUGF0aChwKSksXG4gICAgICAgIGNvbW1pdE1lc3NhZ2UgIT09IG51bGxcbiAgICAgICAgICA/IGNvbW1pdE1lc3NhZ2VcbiAgICAgICAgICA6IHRoaXMuZm9ybWF0Q29tbWl0TWVzc2FnZShhdXRvQ29tbWl0T3B0cy52ZXJiLCBhdXRvQ29tbWl0T3B0cy5vYmpJZCwgYXV0b0NvbW1pdE9wdHMub2JqKSk7XG5cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAoaXNHaXRFcnJvcihlKSkge1xuICAgICAgICB0aHJvdyBuZXcgQ29tbWl0RXJyb3IoZS5jb2RlLCBlLm1lc3NhZ2UpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlc2V0T3JwaGFuRmlsZUNoYW5nZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLyogUmVtb3ZlIGZyb20gZmlsZXN5c3RlbSBhbnkgZmlsZXMgdW5kZXIgb3VyIEZTIGJhY2tlbmQgcGF0aFxuICAgICAgIHRoYXQgdGhlIGJhY2tlbmQgY2Fubm90IGFjY291bnQgZm9yLiAqL1xuXG4gICAgY29uc3Qgb3JwaGFuRmlsZVBhdGhzID0gKGF3YWl0IHRoaXMucmVhZFVuY29tbWl0dGVkRmlsZUluZm8oKSkuXG4gICAgZmlsdGVyKGZpbGVpbmZvID0+IGZpbGVpbmZvLm9iaklkID09PSB1bmRlZmluZWQpLlxuICAgIG1hcChmaWxlaW5mbyA9PiBmaWxlaW5mby5wYXRoKTtcblxuICAgIGlmIChvcnBoYW5GaWxlUGF0aHMubGVuZ3RoID4gMCkge1xuICAgICAgbG9nLndhcm4oXCJTU0U6IEdpdEZpbGVzeXN0ZW06IFJlc2V0dGluZyBvcnBoYW5lZCBmaWxlc1wiLFxuICAgICAgICBvcnBoYW5GaWxlUGF0aHMubWFwKGZwID0+IHRoaXMuZ2l0UmVsYXRpdmVQYXRoKGZwKSkpO1xuICAgICAgYXdhaXQgdGhpcy5naXQucmVzZXRGaWxlcyhvcnBoYW5GaWxlUGF0aHMubWFwKGZwID0+IHRoaXMuZ2l0UmVsYXRpdmVQYXRoKGZwKSkpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVhZFVuY29tbWl0dGVkRmlsZUluZm8oKTogUHJvbWlzZTx7IHBhdGg6IHN0cmluZywgb2JqSWQ6IElEVHlwZSB8IHVuZGVmaW5lZCB9W10+IHtcbiAgICAvKiBSZXR1cm5zIGEgbGlzdCBvZiBvYmplY3RzIHRoYXQgbWFwIEdpdC1yZWxhdGl2ZSBwYXRocyB0byBhY3R1YWwgb2JqZWN0IElEcy5cbiAgICAgICBXaGVyZSBvYmplY3QgSUQgaXMgdW5kZWZpbmVkLCB0aGF0IGltcGxpZXMgZmlsZSBpcyDigJxvcnBoYW5lZOKAnVxuICAgICAgIChub3QgcmVjb2duaXplZCBhcyBiZWxvbmdpbmcgdG8gYW55IG9iamVjdCBtYW5hZ2VkIGJ5IHRoaXMgc3RvcmUpLiAqL1xuXG4gICAgY29uc3QgY2hhbmdlZEZpbGVzID0gYXdhaXQgdGhpcy5naXQubGlzdENoYW5nZWRGaWxlcyhbdGhpcy5mc0Jhc2VSZWxhdGl2ZVRvR2l0XSk7XG4gICAgY29uc29sZS5kZWJ1ZyhcIlVuY29tbWl0dGVkIGZpbGVzXCIsIGNoYW5nZWRGaWxlcyk7XG4gICAgY29uc3QgaWR4ID0gYXdhaXQgdGhpcy5nZXRJbmRleCgpO1xuXG4gICAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKGNoYW5nZWRGaWxlcy5tYXAoYXN5bmMgKGZwKSA9PiB7XG4gICAgICBsZXQgcmVmOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgICB0cnkgeyByZWYgPSBhd2FpdCB0aGlzLmZzLnJlc29sdmVPYmplY3RJZCh0aGlzLmZzUmVsYXRpdmVQYXRoKGZwKSk7IH1cbiAgICAgIGNhdGNoIChlKSB7IHJlZiA9IHVuZGVmaW5lZDsgfVxuXG4gICAgICBjb25zdCBvYmogPSByZWYgIT09IHVuZGVmaW5lZCA/IGlkeFtyZWZdIDogdW5kZWZpbmVkO1xuXG4gICAgICBsZXQgb2JqSWQ6IElEVHlwZSB8IHVuZGVmaW5lZDtcbiAgICAgIGlmIChvYmogIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBvYmpJZCA9IG9ialt0aGlzLmlkRmllbGRdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb2JqSWQgPSB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7IHBhdGg6IGZwLCBvYmpJZCB9O1xuICAgIH0pKTtcbiAgfVxuXG4gIHByaXZhdGUgZm9ybWF0T2JqZWN0TmFtZShvYmpJZDogSURUeXBlLCBvYmo/OiBPKSB7XG4gICAgcmV0dXJuIGAke29iaklkfWA7XG4gIH1cblxuICBwcml2YXRlIGZvcm1hdENvbW1pdE1lc3NhZ2UodmVyYjogc3RyaW5nLCBvYmpJZDogSURUeXBlLCBvYmo/OiBPKSB7XG4gICAgcmV0dXJuIGAke3ZlcmJ9ICR7dGhpcy5vYmplY3RMYWJlbH0gJHt0aGlzLmZvcm1hdE9iamVjdE5hbWUob2JqSWQsIG9iail9YDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0UmVmKG9iaklkOiBJRFR5cGUpOiBzdHJpbmcge1xuICAgIC8qIFJldHVybnMgRlMgYmFja2VuZCByZWZlcmVuY2UgZ2l2ZW4gb2JqZWN0IElELiAqL1xuICAgIHJldHVybiBgJHtvYmpJZH1gO1xuICB9XG5cbiAgcHJpdmF0ZSBnaXRSZWxhdGl2ZVBhdGgoZnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBwYXRoLmpvaW4odGhpcy5mc0Jhc2VSZWxhdGl2ZVRvR2l0LCBmc1BhdGgpO1xuICB9XG5cbiAgcHJpdmF0ZSBmc1JlbGF0aXZlUGF0aChnaXRQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGlmIChwYXRoLmlzQWJzb2x1dGUoZ2l0UGF0aCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcImZzUmVsYXRpdmVQYXRoKCkgbXVzdCBiZSBnaXZlbiBHaXQtcmVsYXRpdmUgcGF0aFwiKTtcbiAgICB9XG4gICAgcmV0dXJuIHBhdGgucmVsYXRpdmUodGhpcy5mc0Jhc2VSZWxhdGl2ZVRvR2l0LCBnaXRQYXRoKTtcbiAgfVxufVxuXG5cbmludGVyZmFjZSBBdXRvQ29tbWl0TWVzc2FnZU9wdGlvbnM8TywgSURUeXBlPiB7XG4gIHZlcmI6IHN0cmluZyxcbiAgb2JqSWQ6IElEVHlwZSxcbiAgb2JqPzogTyxcbn1cblxuXG4vLyBUT0RPOiBUZW1wb3Jhcnkgd29ya2Fyb3VuZCBzaW5jZSBpc29tb3JwaGljLWdpdCBkb2VzbuKAmXQgc2VlbSB0byBleHBvcnQgaXRzIEdpdEVycm9yIGNsYXNzXG4vLyBpbiBhbnkgd2F5IGF2YWlsYWJsZSB0byBUUywgc28gd2UgY2Fu4oCZdCB1c2UgaW5zdGFuY2VvZiA6KFxuXG5mdW5jdGlvbiBpc0dpdEVycm9yKGU6IEVycm9yICYgeyBjb2RlOiBzdHJpbmcgfSkge1xuICBpZiAoIWUuY29kZSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gT2JqZWN0LmtleXMoSXNvbW9ycGhpY0dpdEVycm9yQ29kZXMpLmluZGV4T2YoZS5jb2RlKSA+PSAwO1xufVxuXG5jb25zdCBJc29tb3JwaGljR2l0RXJyb3JDb2RlcyA9IHtcbiAgRmlsZVJlYWRFcnJvcjogYEZpbGVSZWFkRXJyb3JgLFxuICBNaXNzaW5nUmVxdWlyZWRQYXJhbWV0ZXJFcnJvcjogYE1pc3NpbmdSZXF1aXJlZFBhcmFtZXRlckVycm9yYCxcbiAgSW52YWxpZFJlZk5hbWVFcnJvcjogYEludmFsaWRSZWZOYW1lRXJyb3JgLFxuICBJbnZhbGlkUGFyYW1ldGVyQ29tYmluYXRpb25FcnJvcjogYEludmFsaWRQYXJhbWV0ZXJDb21iaW5hdGlvbkVycm9yYCxcbiAgUmVmRXhpc3RzRXJyb3I6IGBSZWZFeGlzdHNFcnJvcmAsXG4gIFJlZk5vdEV4aXN0c0Vycm9yOiBgUmVmTm90RXhpc3RzRXJyb3JgLFxuICBCcmFuY2hEZWxldGVFcnJvcjogYEJyYW5jaERlbGV0ZUVycm9yYCxcbiAgTm9IZWFkQ29tbWl0RXJyb3I6IGBOb0hlYWRDb21taXRFcnJvcmAsXG4gIENvbW1pdE5vdEZldGNoZWRFcnJvcjogYENvbW1pdE5vdEZldGNoZWRFcnJvcmAsXG4gIE9iamVjdFR5cGVVbmtub3duRmFpbDogYE9iamVjdFR5cGVVbmtub3duRmFpbGAsXG4gIE9iamVjdFR5cGVBc3NlcnRpb25GYWlsOiBgT2JqZWN0VHlwZUFzc2VydGlvbkZhaWxgLFxuICBPYmplY3RUeXBlQXNzZXJ0aW9uSW5UcmVlRmFpbDogYE9iamVjdFR5cGVBc3NlcnRpb25JblRyZWVGYWlsYCxcbiAgT2JqZWN0VHlwZUFzc2VydGlvbkluUmVmRmFpbDogYE9iamVjdFR5cGVBc3NlcnRpb25JblJlZkZhaWxgLFxuICBPYmplY3RUeXBlQXNzZXJ0aW9uSW5QYXRoRmFpbDogYE9iamVjdFR5cGVBc3NlcnRpb25JblBhdGhGYWlsYCxcbiAgTWlzc2luZ0F1dGhvckVycm9yOiBgTWlzc2luZ0F1dGhvckVycm9yYCxcbiAgTWlzc2luZ0NvbW1pdHRlckVycm9yOiBgTWlzc2luZ0NvbW1pdHRlckVycm9yYCxcbiAgTWlzc2luZ1RhZ2dlckVycm9yOiBgTWlzc2luZ1RhZ2dlckVycm9yYCxcbiAgR2l0Um9vdE5vdEZvdW5kRXJyb3I6IGBHaXRSb290Tm90Rm91bmRFcnJvcmAsXG4gIFVucGFyc2VhYmxlU2VydmVyUmVzcG9uc2VGYWlsOiBgVW5wYXJzZWFibGVTZXJ2ZXJSZXNwb25zZUZhaWxgLFxuICBJbnZhbGlkRGVwdGhQYXJhbWV0ZXJFcnJvcjogYEludmFsaWREZXB0aFBhcmFtZXRlckVycm9yYCxcbiAgUmVtb3RlRG9lc05vdFN1cHBvcnRTaGFsbG93RmFpbDogYFJlbW90ZURvZXNOb3RTdXBwb3J0U2hhbGxvd0ZhaWxgLFxuICBSZW1vdGVEb2VzTm90U3VwcG9ydERlZXBlblNpbmNlRmFpbDogYFJlbW90ZURvZXNOb3RTdXBwb3J0RGVlcGVuU2luY2VGYWlsYCxcbiAgUmVtb3RlRG9lc05vdFN1cHBvcnREZWVwZW5Ob3RGYWlsOiBgUmVtb3RlRG9lc05vdFN1cHBvcnREZWVwZW5Ob3RGYWlsYCxcbiAgUmVtb3RlRG9lc05vdFN1cHBvcnREZWVwZW5SZWxhdGl2ZUZhaWw6IGBSZW1vdGVEb2VzTm90U3VwcG9ydERlZXBlblJlbGF0aXZlRmFpbGAsXG4gIFJlbW90ZURvZXNOb3RTdXBwb3J0U21hcnRIVFRQOiBgUmVtb3RlRG9lc05vdFN1cHBvcnRTbWFydEhUVFBgLFxuICBDb3JydXB0U2hhbGxvd09pZEZhaWw6IGBDb3JydXB0U2hhbGxvd09pZEZhaWxgLFxuICBGYXN0Rm9yd2FyZEZhaWw6IGBGYXN0Rm9yd2FyZEZhaWxgLFxuICBNZXJnZU5vdFN1cHBvcnRlZEZhaWw6IGBNZXJnZU5vdFN1cHBvcnRlZEZhaWxgLFxuICBEaXJlY3RvcnlTZXBhcmF0b3JzRXJyb3I6IGBEaXJlY3RvcnlTZXBhcmF0b3JzRXJyb3JgLFxuICBSZXNvbHZlVHJlZUVycm9yOiBgUmVzb2x2ZVRyZWVFcnJvcmAsXG4gIFJlc29sdmVDb21taXRFcnJvcjogYFJlc29sdmVDb21taXRFcnJvcmAsXG4gIERpcmVjdG9yeUlzQUZpbGVFcnJvcjogYERpcmVjdG9yeUlzQUZpbGVFcnJvcmAsXG4gIFRyZWVPckJsb2JOb3RGb3VuZEVycm9yOiBgVHJlZU9yQmxvYk5vdEZvdW5kRXJyb3JgLFxuICBOb3RJbXBsZW1lbnRlZEZhaWw6IGBOb3RJbXBsZW1lbnRlZEZhaWxgLFxuICBSZWFkT2JqZWN0RmFpbDogYFJlYWRPYmplY3RGYWlsYCxcbiAgTm90QW5PaWRGYWlsOiBgTm90QW5PaWRGYWlsYCxcbiAgTm9SZWZzcGVjQ29uZmlndXJlZEVycm9yOiBgTm9SZWZzcGVjQ29uZmlndXJlZEVycm9yYCxcbiAgTWlzbWF0Y2hSZWZWYWx1ZUVycm9yOiBgTWlzbWF0Y2hSZWZWYWx1ZUVycm9yYCxcbiAgUmVzb2x2ZVJlZkVycm9yOiBgUmVzb2x2ZVJlZkVycm9yYCxcbiAgRXhwYW5kUmVmRXJyb3I6IGBFeHBhbmRSZWZFcnJvcmAsXG4gIEVtcHR5U2VydmVyUmVzcG9uc2VGYWlsOiBgRW1wdHlTZXJ2ZXJSZXNwb25zZUZhaWxgLFxuICBBc3NlcnRTZXJ2ZXJSZXNwb25zZUZhaWw6IGBBc3NlcnRTZXJ2ZXJSZXNwb25zZUZhaWxgLFxuICBIVFRQRXJyb3I6IGBIVFRQRXJyb3JgLFxuICBSZW1vdGVVcmxQYXJzZUVycm9yOiBgUmVtb3RlVXJsUGFyc2VFcnJvcmAsXG4gIFVua25vd25UcmFuc3BvcnRFcnJvcjogYFVua25vd25UcmFuc3BvcnRFcnJvcmAsXG4gIEFjcXVpcmVMb2NrRmlsZUZhaWw6IGBBY3F1aXJlTG9ja0ZpbGVGYWlsYCxcbiAgRG91YmxlUmVsZWFzZUxvY2tGaWxlRmFpbDogYERvdWJsZVJlbGVhc2VMb2NrRmlsZUZhaWxgLFxuICBJbnRlcm5hbEZhaWw6IGBJbnRlcm5hbEZhaWxgLFxuICBVbmtub3duT2F1dGgyRm9ybWF0OiBgVW5rbm93bk9hdXRoMkZvcm1hdGAsXG4gIE1pc3NpbmdQYXNzd29yZFRva2VuRXJyb3I6IGBNaXNzaW5nUGFzc3dvcmRUb2tlbkVycm9yYCxcbiAgTWlzc2luZ1VzZXJuYW1lRXJyb3I6IGBNaXNzaW5nVXNlcm5hbWVFcnJvcmAsXG4gIE1peFBhc3N3b3JkVG9rZW5FcnJvcjogYE1peFBhc3N3b3JkVG9rZW5FcnJvcmAsXG4gIE1peFVzZXJuYW1lUGFzc3dvcmRUb2tlbkVycm9yOiBgTWl4VXNlcm5hbWVQYXNzd29yZFRva2VuRXJyb3JgLFxuICBNaXNzaW5nVG9rZW5FcnJvcjogYE1pc3NpbmdUb2tlbkVycm9yYCxcbiAgTWl4VXNlcm5hbWVPYXV0aDJmb3JtYXRNaXNzaW5nVG9rZW5FcnJvcjogYE1peFVzZXJuYW1lT2F1dGgyZm9ybWF0TWlzc2luZ1Rva2VuRXJyb3JgLFxuICBNaXhQYXNzd29yZE9hdXRoMmZvcm1hdE1pc3NpbmdUb2tlbkVycm9yOiBgTWl4UGFzc3dvcmRPYXV0aDJmb3JtYXRNaXNzaW5nVG9rZW5FcnJvcmAsXG4gIE1peFVzZXJuYW1lUGFzc3dvcmRPYXV0aDJmb3JtYXRNaXNzaW5nVG9rZW5FcnJvcjogYE1peFVzZXJuYW1lUGFzc3dvcmRPYXV0aDJmb3JtYXRNaXNzaW5nVG9rZW5FcnJvcmAsXG4gIE1peFVzZXJuYW1lT2F1dGgyZm9ybWF0VG9rZW5FcnJvcjogYE1peFVzZXJuYW1lT2F1dGgyZm9ybWF0VG9rZW5FcnJvcmAsXG4gIE1peFBhc3N3b3JkT2F1dGgyZm9ybWF0VG9rZW5FcnJvcjogYE1peFBhc3N3b3JkT2F1dGgyZm9ybWF0VG9rZW5FcnJvcmAsXG4gIE1peFVzZXJuYW1lUGFzc3dvcmRPYXV0aDJmb3JtYXRUb2tlbkVycm9yOiBgTWl4VXNlcm5hbWVQYXNzd29yZE9hdXRoMmZvcm1hdFRva2VuRXJyb3JgLFxuICBNYXhTZWFyY2hEZXB0aEV4Y2VlZGVkOiBgTWF4U2VhcmNoRGVwdGhFeGNlZWRlZGAsXG4gIFB1c2hSZWplY3RlZE5vbkZhc3RGb3J3YXJkOiBgUHVzaFJlamVjdGVkTm9uRmFzdEZvcndhcmRgLFxuICBQdXNoUmVqZWN0ZWRUYWdFeGlzdHM6IGBQdXNoUmVqZWN0ZWRUYWdFeGlzdHNgLFxuICBBZGRpbmdSZW1vdGVXb3VsZE92ZXJ3cml0ZTogYEFkZGluZ1JlbW90ZVdvdWxkT3ZlcndyaXRlYCxcbiAgUGx1Z2luVW5kZWZpbmVkOiBgUGx1Z2luVW5kZWZpbmVkYCxcbiAgQ29yZU5vdEZvdW5kOiBgQ29yZU5vdEZvdW5kYCxcbiAgUGx1Z2luU2NoZW1hVmlvbGF0aW9uOiBgUGx1Z2luU2NoZW1hVmlvbGF0aW9uYCxcbiAgUGx1Z2luVW5yZWNvZ25pemVkOiBgUGx1Z2luVW5yZWNvZ25pemVkYCxcbiAgQW1iaWd1b3VzU2hvcnRPaWQ6IGBBbWJpZ3VvdXNTaG9ydE9pZGAsXG4gIFNob3J0T2lkTm90Rm91bmQ6IGBTaG9ydE9pZE5vdEZvdW5kYCxcbiAgQ2hlY2tvdXRDb25mbGljdEVycm9yOiBgQ2hlY2tvdXRDb25mbGljdEVycm9yYFxufVxuIl19