import { TimeTravel } from 'time-travel/renderer';
export declare function apiRequest<T>(request: string, ...args: string[]): Promise<T>;
export declare function useWorkspace<T>(request: string, reducer: any, initData: T, ...args: any[]): TimeTravel;
export declare function useWorkspaceRO<T>(request: string, initData: T, poll?: boolean): T;
