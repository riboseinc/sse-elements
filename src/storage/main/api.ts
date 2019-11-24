//import { Store } from './store/base';
import { Index } from '../query';
import { MainStorage } from '.';
import { Storage } from '..';
import { listen } from '../../api/main';


export function provideAll<CTypeName extends keyof S, S extends Storage>
(storage: MainStorage<S>, contentTypeName: CTypeName) {
  return listen<{}, Index<S[CTypeName]>>
  (`storage-read-all-${contentTypeName}`, async () => {
    return await storage[contentTypeName].getIndex();
  });
}


export function provideOne<CTypeName extends keyof S, S extends Storage>
(storage: MainStorage<S>, contentTypeName: CTypeName) {
  return listen<{ objectId: S[CTypeName]["id"] }, Index<S[CTypeName]>>
  (`storage-read-one-in-${contentTypeName}`, async ({ objectId }) => {
    return await storage[contentTypeName].read(objectId);
  });
}
