import { AnyIDType, Model } from '../models';
import { Index } from '../query';


export interface Backend<IDType = AnyIDType> {
  /* Basic object manipulation methods. */

  init(): Promise<void>
  authenticate(...args: any[]): Promise<void>
  readAll<T extends Record<string, any>>(...args: any[]): Promise<Index<T>>
  read(objID: IDType, ...args: any[]): Promise<object>
  create<T extends Record<string, any>>(obj: T, ...args: any[]): Promise<void>
  update<T extends Record<string, any>>(objID: IDType, obj: T, ...args: any[]): Promise<void>
  delete(objID: IDType, ...args: any[]): Promise<void>
}


export interface VersionedBackend<T = object, IDType = AnyIDType> extends Backend<IDType> {

  discard(objIDs: IDType[]): Promise<void>
  /* Discard any uncommitted changes made to objects with specified IDs. */

  commit(objIDs: IDType[], commitMessage: string): Promise<void>
  /* Commit any uncommitted changes made to objects with specified IDs,
     with specified commit message. */

  listUncommitted?(): Promise<IDType[]>
  /* List IDs of objects with uncommitted changes. */

}


export interface VersionedFilesystemBackend extends VersionedBackend<object, string> {
  registerManager(manager: VersionedFilesystemManager): void

  resetOrphanedFileChanges(): Promise<void>
  /* Housekeeping method for file-based DB backend. */

  getWorkDir(): string
}


export interface VersionedManager<M extends Model, IDType extends AnyIDType> {
  /* Passes calls on to their Backend & VersionedBackend implementations. */

  create(obj: M, commit: boolean | string): Promise<void>
  update(objID: IDType, obj: M, commit: boolean | string): Promise<void>;
  delete(objID: IDType, commit: boolean | string): Promise<void>;

  discard?(objIDs: IDType[]): Promise<void>
  commit?(objIDs: IDType[], commitMessage: string): Promise<void>

  listUncommitted?(): Promise<IDType[]>
  /* List IDs of objects with uncommitted changes. */
}


export interface VersionedFilesystemManager {
  managesFileAtPath(filePath: string): boolean
}


export class CommitError extends Error {
  constructor(public code: string, msg: string) {
    super(msg);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}