import { Index, IndexableObject } from './query';
export declare type Workspace = {
    [indexName: string]: Index<IndexableObject>;
};
