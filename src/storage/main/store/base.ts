import { AnyIDType, Index, IndexableObject } from '../../query';


export interface Store<O extends IndexableObject<IDType>, IDType extends AnyIDType> {
  getIndex(rebuild?: true): Promise<Index<O>>;

  read(objId: IDType): Promise<O>;
  create(obj: O, ...args: any[]): Promise<void>;
  update(objId: IDType, obj: O, ...args: any[]): Promise<void>;
  delete(objId: IDType, ...args: any[]): Promise<void>;
}


export interface ModifiedObjectPaths {
  [objId: string]: string[],
}


export interface VersionedStore<O extends IndexableObject<IDType>, IDType> extends Store<O, IDType> {
  listIDsWithUncommittedChanges(): Promise<ModifiedObjectPaths>;
  /* List IDs of uncommitted objects, pointing to paths of changed files. */

  /* Object manipulation methods for versioned store
     support optional `commit` flag, containing either a commit message
     or simply `true` for automatic commit message. */
  create(obj: O, commit: boolean | string): Promise<void>;
  update(objId: IDType, obj: O, commit: boolean | string): Promise<void>;
  delete(objId: IDType, commit: boolean | string): Promise<void>;
}


export class StoreError<O extends IndexableObject> extends Error {
  constructor(msg: string) {
    super(msg);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}


export class IDTakenError<O extends IndexableObject<IDType>, IDType extends AnyIDType> extends StoreError<O> {
  constructor(public objectId: IDType) {
    super(`ID is taken, such an object already exists: ${objectId}`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}


export class CommitError extends Error {
  constructor(public code: string, msg: string) {
    super(msg);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
