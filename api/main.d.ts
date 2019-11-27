import { WindowOpenerParams } from '../main/window';
declare type Handler<I, O> = (params: I) => Promise<O>;
export declare function listen<I, O>(name: string, handler: Handler<I, O>): void;
export declare function makeWindowEndpoint(name: string, getWindowOpts: (params: any) => WindowOpenerParams): void;
export {};
