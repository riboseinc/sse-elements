import { BrowserWindow, MenuItemConstructorOptions } from 'electron';
export declare var windows: BrowserWindow[];
export interface WindowOpenerParams {
    title: string;
    url?: string;
    component?: string;
    componentParams?: string;
    dimensions?: {
        minHeight?: number;
        minWidth?: number;
        width?: number;
        height?: number;
    };
    frameless?: boolean;
    winParams?: any;
    menuTemplate?: MenuItemConstructorOptions[];
}
export declare type WindowOpener = (props: WindowOpenerParams) => Promise<BrowserWindow>;
export declare const openWindow: WindowOpener;
export declare function getWindowByTitle(title: string): BrowserWindow | undefined;
export declare function getWindow(func: (win: BrowserWindow) => boolean): BrowserWindow | undefined;
