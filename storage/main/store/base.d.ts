import { AnyIDType, Index, IndexableObject } from '../../query';
export interface Store<O extends IndexableObject<IDType>, IDType extends AnyIDType> {
    getIndex(rebuild?: true): Promise<Index<O>>;
    read(objId: IDType): Promise<O>;
    create(obj: O, ...args: any[]): Promise<void>;
    update(objId: IDType, obj: O, ...args: any[]): Promise<void>;
    delete(objId: IDType, ...args: any[]): Promise<void>;
}
export interface VersionedStore<O extends IndexableObject<IDType>, IDType extends AnyIDType> extends Store<O, IDType> {
    create(obj: O, commit: boolean | string): Promise<void>;
    update(objId: IDType, obj: O, commit: boolean | string): Promise<void>;
    delete(objId: IDType, commit: boolean | string): Promise<void>;
    discard?(objIds: IDType[]): Promise<void>;
    commit?(objIds: IDType[], commitMessage: string): Promise<void>;
    listUncommitted?(): Promise<IDType[]>;
}
export declare class StoreError<O extends IndexableObject> extends Error {
    constructor(msg: string);
}
export declare class IDTakenError<O extends IndexableObject<IDType>, IDType extends AnyIDType> extends StoreError<O> {
    objectId: IDType;
    constructor(objectId: IDType);
}
export declare class CommitError extends Error {
    code: string;
    constructor(code: string, msg: string);
}
