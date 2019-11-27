import { AbstractLockingFilesystemBackend } from '../base';
declare class YAMLBackend<T = any> extends AbstractLockingFilesystemBackend<T> {
    protected isYAMLFile(objId: string): boolean;
    isValidId(objId: string): Promise<boolean>;
    resolveObjectId(objId: string): Promise<string>;
    expandPath(objId: string): string;
    protected parseData(data: string): any;
    protected dumpData(data: any): string;
}
interface YAMLDirectoryStoreableContents {
    meta: any;
    [key: string]: any;
}
export declare class YAMLDirectoryBackend extends YAMLBackend<YAMLDirectoryStoreableContents> {
    private metaProperties;
    constructor(baseDir: string, metaProperties: string[]);
    private expandDirectoryPath;
    exists(objId: string): Promise<boolean>;
    isValidId(value: string): Promise<boolean>;
    read(objId: string): Promise<any>;
    write(objId: string, newData: any): Promise<string[]>;
}
export {};
