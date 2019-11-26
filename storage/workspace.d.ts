import { Index, IndexableObject } from './query';
export declare type Workspace = {
    [indexName: string]: Index<IndexableObject>;
};
export declare type EmptyPartialWorkspace<W extends Workspace> = {
    [K in keyof W]?: {};
};
