import { Index } from './query';
import { Storage } from '.';


export type RendererStorage<S extends Storage> = {
  [K in keyof S]: Index<S[K]>
}
/* Has the same keys as Storage,
   but each content type identifier is assigned an ID-based index
   of that content type’s objects. */


// Of the form: { objType1: [id1, id2], objType2: [id3, id4] }
export type ModifiedObjectStatus<R extends RendererStorage<any>> = {
  [K in keyof R]: (string | number)[]
}


export interface StorageContextSpec<R extends RendererStorage<any>> {
  // Snapshot of all objects, per type
  current: R,
  refresh(): Promise<void>,

  // Snapshot of modified object IDs, per type
  modified: ModifiedObjectStatus<R>,
  refreshModified(hasLocalChanges?: boolean): Promise<void>,
}
