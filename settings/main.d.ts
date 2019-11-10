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
export declare class SettingManager {
    settingsPath: string;
    private registry;
    private panes;
    private data;
    private yaml;
    constructor(settingsPath: string);
    getValue(id: string): Promise<unknown>;
    setValue(id: string, val: unknown): Promise<void>;
    deleteValue(id: string): Promise<void>;
    private commit;
    private get;
    register(setting: Setting<any>): void;
    configurePane(pane: Pane): void;
    setUpAPIEndpoints(): void;
}
