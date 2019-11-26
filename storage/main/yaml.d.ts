interface YAMLStorageOptions {
    debugLog: boolean;
}
export declare class YAMLStorage {
    private fs;
    private opts;
    private fileWriteLock;
    constructor(fs: any, opts?: YAMLStorageOptions);
    private debugLog;
    load(filePath: string): Promise<any>;
    store(filePath: string, data: any): Promise<any>;
}
export {};