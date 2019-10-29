export declare class YAMLStorage {
    private fs;
    constructor(fs: any);
    load(filePath: string): Promise<any>;
    private loadIfExists;
    store(filePath: string, data: any): Promise<any>;
}
