interface YAMLStorageOptions {
    debugLog: boolean;
}
export declare class YAMLStorage {
    private fs;
    private opts;
    constructor(fs: any, opts?: YAMLStorageOptions);
    private debugLog;
    load(filePath: string): Promise<any>;
    private loadIfExists;
    store(filePath: string, data: any): Promise<any>;
}
export {};
