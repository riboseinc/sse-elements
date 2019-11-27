export declare function notifyAllWindows(evtName: string, payload?: any): Promise<void>;
export declare function request<T>(endpointName: string, ...args: any[]): Promise<T>;
export declare function openWindow(endpointName: string, params?: any): void;
