import { listen } from '../../api/main';
import { notifyAllWindows } from '../../main/window';
import { Index, AnyIDType } from '../query';
import { Storage } from '..';
import { MainStorage } from '.';
import { VersionedStore } from './store/base';


export function provideAll<CTypeName extends keyof S, S extends Storage>
(storage: MainStorage<S>, contentTypeName: CTypeName) {
  return listen<{}, Index<S[CTypeName]>>
  (`storage-read-all-${contentTypeName}`, async () => {
    return await storage[contentTypeName].getIndex();
  });
}


export function provideOne<CTypeName extends keyof S, S extends Storage>
(storage: MainStorage<S>, contentTypeName: CTypeName) {
  return listen<{ objectId: AnyIDType }, Index<S[CTypeName]>>
  (`storage-read-one-in-${contentTypeName}`, async ({ objectId }) => {
    return await storage[contentTypeName].read(objectId);
  });
}


// Below can only be called if mainStorage[ctypename]
// is a VersionedStore that implements listUncommitted(), commit(), discard() methods.

export function provideModified<CTypeName extends keyof S, M extends MainStorage<S>, S extends Storage>
(storage: M[CTypeName] extends VersionedStore<S[CTypeName], any> ? M : never, contentTypeName: CTypeName) {
  return listen<{}, AnyIDType[]>
  (`storage-read-modified-in-${contentTypeName}`, async () => {
    const store = storage[contentTypeName] as unknown as VersionedStore<S[CTypeName], any>;
    if (store.listUncommitted) {
      return await store.listUncommitted();
    } else {
      throw new Error("Store does not support listUncommitted()");
    }
  });
}


export function listenToBatchCommits<CTypeName extends keyof S, M extends MainStorage<S>, S extends Storage>
(storage: M[CTypeName] extends VersionedStore<S[CTypeName], any> ? M : never, contentTypeName: CTypeName) {
  return listen<{ objIds: AnyIDType[], commitMsg: string }, { success: true }>
  (`storage-commit-objects-in-${contentTypeName}`, async ({ objIds, commitMsg }) => {
    const store = storage[contentTypeName] as unknown as VersionedStore<S[CTypeName], any>;
    if (store.commit) {
      await store.commit(objIds, commitMsg);
    } else {
      throw new Error("Store does not support commit()");
    }
    return { success: true };
  });
}


export function listenToBatchDiscardRequests<CTypeName extends keyof S, M extends MainStorage<S>, S extends Storage>
(storage: M[CTypeName] extends VersionedStore<S[CTypeName], any> ? M : never, contentTypeName: CTypeName) {
  return listen<{ objIds: AnyIDType[] }, { success: true }>
  (`storage-discard-uncommitted-changes-for-objects-in-${contentTypeName}`, async ({ objIds }) => {
    const store = storage[contentTypeName] as unknown as VersionedStore<S[CTypeName], any>;
    if (store.discard) {
      await store.discard(objIds);
    } else {
      throw new Error("Store does not support discard()");
    }
    await notifyAllWindows(`${contentTypeName}-changed`, { objIds });
    return { success: true };
  });
}
