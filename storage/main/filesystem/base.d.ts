declare type FilesystemPath = string;
export interface FilesystemBackend<T> {
    baseDir: string;
    read(objId: string): Promise<T>;
    readAll(): Promise<T[]>;
    write(objId: string, newData: T | undefined): Promise<FilesystemPath[]>;
    expandPath(objId: string): string;
    resolveObjectId(path: string): Promise<string>;
    exists(objId: string): Promise<boolean>;
    isValidId(filepath: string): Promise<boolean>;
}
export declare abstract class AbstractLockingFilesystemBackend<T> implements FilesystemBackend<T> {
    baseDir: string;
    private fileAccessLock;
    constructor(baseDir: string);
    expandPath(objId: string): string;
    makeRelativePath(absPath: string): string;
    isValidId(value: string): Promise<boolean>;
    resolveObjectId(filepath: string): Promise<string>;
    readAll(): Promise<T[]>;
    exists(objId: string): Promise<boolean>;
    read(objId: string): Promise<T>;
    write(objId: string, newContents: T | undefined): Promise<string[]>;
    protected abstract parseData(contents: string): T;
    protected abstract dumpData(data: T): string;
}
export {};
