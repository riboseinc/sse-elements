import { Index, IndexableObject, AnyIDType } from '../../query';
import { FilesystemBackend } from '../filesystem/base';
import { GitController } from '../git/controller';
import { VersionedStore } from './base';
export declare class GitFilesystemStore<O extends IndexableObject<IDType>, FSBackend extends FilesystemBackend<any>, IDType extends AnyIDType> implements VersionedStore<O, IDType> {
    objectLabel: string;
    private fs;
    private git;
    private idField;
    protected _index: Index<O> | undefined;
    private fsBaseRelativeToGit;
    constructor(objectLabel: string, fs: FSBackend, git: GitController, idField?: keyof O);
    read(objId: IDType): Promise<O>;
    commit(objIds: IDType[], message: string): Promise<void>;
    discard(objIds: IDType[]): Promise<void>;
    listUncommitted(): Promise<IDType[]>;
    getIndex(): Promise<Index<O>>;
    create(obj: O, commit?: boolean | string): Promise<void>;
    update(objId: IDType, newData: O, commit?: boolean | string): Promise<void>;
    delete(objId: IDType, commit?: string | boolean): Promise<void>;
    private gitCommit;
    private resetOrphanFileChanges;
    private readUncommittedFileInfo;
    private formatObjectName;
    private formatCommitMessage;
    private getRef;
    private gitRelativePath;
    private fsRelativePath;
}
