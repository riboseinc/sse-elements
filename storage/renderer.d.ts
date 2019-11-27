import { Index } from './query';
import { Storage } from '.';
export declare type RendererStorage<S extends Storage> = {
    [K in keyof S]: Index<S[K]>;
};
