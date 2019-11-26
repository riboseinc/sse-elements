//import { Store } from './store/base';
import { Index } from '../query';
import { MainStorage } from '.';
import { Storage } from '..';
import { listen } from '../../api/main';
import { VersionedStore, ModifiedObjectPaths } from './store/base';


export function provideAll<CTypeName extends keyof S, S extends Storage>
(storage: MainStorage<S>, contentTypeName: CTypeName) {
  return listen<{}, Index<S[CTypeName]>>
  (`storage-read-all-${contentTypeName}`, async () => {
    return await storage[contentTypeName].getIndex();
  });
}


// provideModified(mainStorage, ctypename) can only be called if mainStorage[ctypename] is a GitFilesystemStore.
export function provideModified<CTypeName extends keyof S, M extends MainStorage<S>, S extends Storage>
(storage: M[CTypeName] extends VersionedStore<S[CTypeName], any> ? M : never, contentTypeName: CTypeName) {
  return listen<{}, ModifiedObjectPaths>
  (`storage-read-modified-in-${contentTypeName}`, async () => {
    const store = storage[contentTypeName] as unknown as VersionedStore<S[CTypeName], any>;
    return await store.listIDsWithUncommittedChanges();
  });
}


export function provideOne<CTypeName extends keyof S, S extends Storage>
(storage: MainStorage<S>, contentTypeName: CTypeName) {
  return listen<{ objectId: S[CTypeName]["id"] }, Index<S[CTypeName]>>
  (`storage-read-one-in-${contentTypeName}`, async ({ objectId }) => {
    return await storage[contentTypeName].read(objectId);
  });
}
