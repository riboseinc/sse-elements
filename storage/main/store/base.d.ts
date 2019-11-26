import { Index, IndexableObject } from '../../query';
export interface Store<O extends IndexableObject<IDType>, IDType> {
    getIndex(rebuild?: true): Promise<Index<O>>;
    read(objId: IDType): Promise<O>;
    create(obj: O, ...args: any[]): Promise<void>;
    update(objId: IDType, obj: O, ...args: any[]): Promise<void>;
    delete(objId: IDType, ...args: any[]): Promise<void>;
}
export interface ModifiedObjectPaths {
    [objId: string]: string[];
}
export interface VersionedStore<O extends IndexableObject<IDType>, IDType> extends Store<O, IDType> {
    listIDsWithUncommittedChanges(): Promise<ModifiedObjectPaths>;
    create(obj: O, commit: boolean | string): Promise<void>;
    update(objId: IDType, obj: O, commit: boolean | string): Promise<void>;
    delete(objId: IDType, commit: boolean | string): Promise<void>;
}
export declare class StoreError<O extends IndexableObject<IDType>, IDType> extends Error {
    constructor(msg: string);
}
export declare class IDTakenError<O extends IndexableObject<IDType>, IDType> extends StoreError<O, IDType> {
    objectId: IDType;
    constructor(objectId: IDType);
}
export declare class CommitError extends Error {
    code: string;
    constructor(code: string, msg: string);
}
