import * as path from 'path'
import { format as formatUrl } from 'url';
import { BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron';


const isDevelopment = process.env.NODE_ENV !== 'production';
const isMacOS = process.platform === 'darwin';

// Keeps track of windows and ensures (?) they do not get garbage collected
export var windows: BrowserWindow[] = [];

// Allows to locate window ID by label
var windowsByTitle: { [title: string]: BrowserWindow } = {};


// Open new window, or focus if one with the same title already exists
export interface WindowOpenerParams {
  title: string,
  url?: string,
  component?: string,
  componentParams?: string,
  dimensions?: {
    minHeight?: number,
    minWidth?: number,
    height?: number,
    width?: number,
    maxHeight?: number,
    maxWidth?: number,
  },
  frameless?: boolean,
  winParams?: any,
  menuTemplate?: MenuItemConstructorOptions[],
  ignoreCache?: boolean,
}
export type WindowOpener = (props: WindowOpenerParams) => Promise<BrowserWindow>;
export const openWindow: WindowOpener = async ({
    title,
    url, component, componentParams,
    dimensions, frameless,
    winParams, menuTemplate, ignoreCache }) => {

  if ((component || '').trim() === '' && (url || '').trim() === '') {
    throw new Error("openWindow() requires either `component` or `url`");
  }

  const _existingWindow = getWindowByTitle(title);
  if (_existingWindow !== undefined) {
    _existingWindow.show();
    _existingWindow.focus();
    return _existingWindow;
  }

  const _framelessOpts = {
    titleBarStyle: isMacOS ? 'hiddenInset' : undefined,
  };

  const _winParams = {
    width: (dimensions || {}).width,
    minWidth: (dimensions || {}).minWidth,
    height: (dimensions || {}).height,
    minHeight: (dimensions || {}).minHeight,
    ...(frameless === true ? _framelessOpts : {}),
    ...winParams,
  };

  let window: BrowserWindow;

  if (component) {
    const params = `c=${component}&${componentParams ? componentParams : ''}`;
    window = await createWindowForLocalComponent(title, params, _winParams);
  } else if (url) {
    window = await createWindow(title, url, _winParams, ignoreCache);
  } else {
    throw new Error("Either component or url must be given to openWindow()");
  }

  if (menuTemplate && !isMacOS) {
    window.setMenu(Menu.buildFromTemplate(menuTemplate));
  }

  windows.push(window);
  windowsByTitle[title] = window;
  window.on('closed', () => { delete windowsByTitle[title]; cleanUpWindows(); });

  return window;
}


export function getWindowByTitle(title: string): BrowserWindow | undefined {
  return windowsByTitle[title];
}


export function getWindow(func: (win: BrowserWindow) => boolean): BrowserWindow | undefined {
  return windows.find(func);
}


// Iterate over array of windows and try accessing window ID.
// If it throws, window was closed and we remove it from the array.
// Supposed to be run after any window is closed
function cleanUpWindows() {
  var deletedWindows: number[] = [];
  for (const [idx, win] of windows.entries()) {
    // When accessing the id attribute of a closed window,
    // it’ll throw. We’ll mark its index for deletion then.
    try {
      win.id;
    } catch (e) {
      deletedWindows.push(idx - deletedWindows.length);
    }
  }
  for (const idx of deletedWindows) {
    windows.splice(idx, 1);
  }
}


function createWindowForLocalComponent(title: string, params: string, winParams: any): Promise<BrowserWindow> {
  let url: string;

  if (isDevelopment) {
    url = `http://localhost:${process.env.ELECTRON_WEBPACK_WDS_PORT}?${params}`;
  }
  else {
    url = `${formatUrl({
      pathname: path.join(__dirname, 'index.html'),
      protocol: 'file',
      slashes: true,
    })}?${params}`;
  }

  return createWindow(title, url, winParams);
}


function createWindow(title: string, url: string, winParams: any, ignoreCache: boolean = false): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    webPreferences: {nodeIntegration: true},
    title: title,
    show: false,
    ...winParams
  });

  const promise = new Promise<BrowserWindow>((resolve, reject) => {
    window.once('ready-to-show', () => {
      window.show();
      resolve(window);
    });
  });

  if (isDevelopment) {
    window.webContents.openDevTools();
  }

  if (ignoreCache) {
    window.loadURL(url, {'extraHeaders': 'pragma: no-cache\n'});
  } else {
    window.loadURL(url);
  }

  window.webContents.on('devtools-opened', () => {
    window.focus();
    setImmediate(() => {
      window.focus()
    });
  });

  return promise;
}


export async function notifyAllWindows(eventName: string, payload?: any) {
  return await Promise.all(windows.map(async (window) => {
    if (window) {
      await window.webContents.send(eventName, payload);
    }
    return;
  }));
}


export async function notifyWindow(windowTitle: string, eventName: string, payload?: any) {
  const window = getWindowByTitle(windowTitle);
  if (window) {
    await window.webContents.send(eventName, payload);
  }
}
