import { Index } from './query';
import { Storage } from '.';


export type RendererStorage<S extends Storage> = {
  [K in keyof S]: Index<S[K]>
}
/* Has the same keys as Storage,
   but each content type identifier is assigned an ID-based index
   of that content type’s objects. */
