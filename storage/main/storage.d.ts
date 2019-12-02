import { Index, IndexableObject } from '../query';
import { Workspace } from '../workspace';
import { YAMLStorage } from './yaml';
export declare abstract class StoreManager<O extends IndexableObject> {
    rootDir: string;
    protected _index: Index<O> | undefined;
    constructor(rootDir: string);
    toStoreableObject(obj: O): any;
    toUseableObject(data: any): O;
    objectMatchesQuery(obj: O, query: string): boolean;
    formatObjectNameForCommitMessage(obj: O): string;
    getIndex(storage: Storage<any>, force?: boolean): Promise<Index<O>>;
    findObjects(storage: Storage<any>, query?: string): Promise<Index<O>>;
    load(objDir: string, storage: Storage<any>): Promise<any | undefined>;
    store(obj: O, storage: Storage<any>, updateIndex?: boolean): Promise<boolean>;
    delete(objId: string, storage: Storage<any>, updateIndex?: boolean): Promise<boolean>;
    resolveObjectPath(objId: string, storage: Storage<any>): string;
    private updateInIndex;
    private deleteFromIndex;
    private _loadIndex;
}
export declare abstract class Storage<W extends Workspace> {
    fs: typeof import('fs-extra');
    workDir: string;
    storeManagers: {
        [K in keyof W]: StoreManager<any>;
    };
    yaml: YAMLStorage;
    workspace: W;
    constructor(fs: typeof import('fs-extra'), workDir: string, storeManagers: {
        [K in keyof W]: StoreManager<any>;
    }, debugBackend?: true);
    abstract findObjects(query?: string): Promise<W>;
    loadWorkspace(force?: boolean): Promise<void>;
    setUpAPIEndpoints(notifier: (notify: string[]) => void): void;
}
