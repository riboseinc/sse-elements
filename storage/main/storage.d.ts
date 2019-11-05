import { Index, IndexableObject } from '../query';
import { Workspace } from '../workspace';
import { YAMLStorage } from './yaml';
export declare abstract class StoreManager<O extends IndexableObject> {
    rootDir: string;
    protected _index: Index<O> | undefined;
    constructor(rootDir: string);
    storeIndex(storage: Storage<any>, newIdx: Index<O> | undefined): Promise<boolean>;
    getIndex(storage: Storage<any>): Promise<Index<O>>;
    findObjects(storage: Storage<any>, query?: string): Promise<Index<O>>;
    private _loadIndex;
    store(obj: O, storage: Storage<any>, updateIndex?: boolean): Promise<boolean>;
    updateIndexedItem(obj: O, storage: Storage<any>): Promise<void>;
    toStoreableObject(obj: O): any;
    postLoad(obj: any): O;
    objectMatchesQuery(obj: O, query: string): boolean;
}
export declare abstract class Storage<W extends Workspace> {
    fs: typeof import('fs-extra');
    workDir: string;
    storeManagers: {
        [key: string]: StoreManager<any>;
    };
    yaml: YAMLStorage;
    workspace: W;
    constructor(fs: typeof import('fs-extra'), workDir: string, storeManagers: {
        [key: string]: StoreManager<any>;
    });
    abstract findObjects(query?: string): Promise<W>;
    loadWorkspace(): Promise<void>;
    storeWorkspace(): Promise<boolean>;
    loadObject(objDir: string): Promise<any | undefined>;
    setUpAPIEndpoints(notifier: (notify: string[]) => void): void;
}
