declare type Saver<I> = (input: I) => Promise<void>;
declare type Fetcher<O> = (params: any) => Promise<O>;
export declare function makeEndpoint<T>(name: string, fetcher: Fetcher<T>, saver?: Saver<{
    newData: T;
    notify?: string[];
}>): void;
export declare function makeWriteOnlyEndpoint(name: string, dataSaver: (...args: any[]) => void): void;
export declare function makeWindowEndpoint(name: string, getWindowOpts: (...args: string[]) => any): void;
export {};
