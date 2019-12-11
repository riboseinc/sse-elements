import { Index } from './query';
import { Storage } from '.';
export declare type RendererStorage<S extends Storage> = {
    [K in keyof S]: Index<S[K]>;
};
export declare type ModifiedObjectStatus<R extends RendererStorage<any>> = {
    [K in keyof R]: (string | number)[];
};
export interface StorageContextSpec<R extends RendererStorage<any>> {
    current: R;
    refresh(): Promise<void>;
    modified: ModifiedObjectStatus<R>;
    refreshModified(hasLocalChanges?: boolean): Promise<void>;
}
