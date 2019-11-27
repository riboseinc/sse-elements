import { Storage } from '..';
import { MainStorage } from '.';
import { VersionedStore } from './store/base';
export declare function provideAll<CTypeName extends keyof S, S extends Storage>(storage: MainStorage<S>, contentTypeName: CTypeName): void;
export declare function provideOne<CTypeName extends keyof S, S extends Storage>(storage: MainStorage<S>, contentTypeName: CTypeName): void;
export declare function provideModified<CTypeName extends keyof S, M extends MainStorage<S>, S extends Storage>(storage: M[CTypeName] extends VersionedStore<S[CTypeName], any> ? M : never, contentTypeName: CTypeName): void;
export declare function listenToBatchCommits<CTypeName extends keyof S, M extends MainStorage<S>, S extends Storage>(storage: M[CTypeName] extends VersionedStore<S[CTypeName], any> ? M : never, contentTypeName: CTypeName): void;
export declare function listenToBatchDiscardRequests<CTypeName extends keyof S, M extends MainStorage<S>, S extends Storage>(storage: M[CTypeName] extends VersionedStore<S[CTypeName], any> ? M : never, contentTypeName: CTypeName): void;
