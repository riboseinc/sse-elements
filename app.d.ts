import { IndexableObject } from './storage/query';
declare type ModuleRef = string;
declare type DatabaseBackendOptions = Object;
interface Database {
    backend: ModuleRef;
    options: DatabaseBackendOptions;
}
interface DataType<Databases extends AppDatabases> {
    model: IndexableObject<any>;
    dbName?: keyof Databases;
}
export interface Aspect<App extends AppConfig> {
    data: {
        [modelName: string]: DataType<App["databases"]>;
    };
    windows: {
        [windowName: string]: Window;
    };
}
interface Window {
    params: Object;
    component: ModuleRef;
}
interface AppDatabases {
    default: Database;
    [dbName: string]: Database;
}
export interface AppConfig {
    title: string;
    aspects: {
        [aspectName: string]: ModuleRef;
    };
    databases: AppDatabases;
    windows: {
        default: Window;
        [windowName: string]: Window;
    };
}
export {};
