import { YAMLStorage } from 'storage/main/yaml';
export interface Pane {
    id: string;
    label: string;
    icon?: string;
}
export declare class Setting<T> {
    id: string;
    label: string;
    paneId: string;
    constructor(id: string, label: string, paneId: string);
    toUseable(val: unknown): T;
    toStoreable(val: T): any;
}
declare class SettingManager {
    private yaml;
    private registry;
    private panes;
    private data;
    constructor(yaml: YAMLStorage);
    getValue(id: string): Promise<unknown>;
    setValue(id: string, val: unknown): Promise<void>;
    deleteValue(id: string): Promise<void>;
    private commit;
    private get;
    register(setting: Setting<any>): void;
    configurePane(pane: Pane): void;
    setUpAPIEndpoints(): void;
}
export declare const manager: SettingManager;
export {};
