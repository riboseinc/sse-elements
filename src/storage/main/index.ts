import { Storage } from '..';
import { Store } from './store/base';


export type MainStorage<S extends Storage> = {
  [K in keyof S]: Store<S[K], any>;
}
/* Has the same keys as Storage,
   but each content type identifier is assigned a Store for that content type class. */
