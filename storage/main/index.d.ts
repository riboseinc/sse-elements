import { Storage } from '..';
import { Store } from './store/base';
export declare type MainStorage<S extends Storage> = {
    [K in keyof S]: Store<S[K], any>;
};
