// Jury-rig globa.fetch to make Isomorphic Git work under Node
import fetch from 'node-fetch';
(global as any).fetch = fetch;

import { app, App, ipcMain } from 'electron';
import * as log from 'electron-log';
import { AppConfig, Window } from '../config/app';
import { MainConfig } from '../config/main';
import { SettingManager } from '../settings/main';
import {
  VersionedFilesystemBackend,
  VersionedManager,
  BackendClass as DatabaseBackendClass,
} from '../db/main/base';

import { makeWindowEndpoint } from '../api/main';
import { openWindow, closeWindow } from '../main/window';


export let main: MainApp<any, any>;


export const initMain = async <C extends MainConfig<any>>(config: C): Promise<MainApp<any, C>> => {

  log.catchErrors({ showDialog: true });

  if (config.app.singleInstance) {
    // Ensure only one instance of the app can run at a time on given user’s machine
    // by exiting any future instances
    if (!app.requestSingleInstanceLock()) {
      app.exit(0);
    }
  }


  /* Helper functions */

  function _openWindow(windowName: keyof typeof config.app.windows) {
    const openerParams = config.app.windows[windowName].openerParams;
    return openWindow({ ...openerParams, component: windowName });
  }

  function _requestSettings(settings: string[]): Promise<void> {
    const settingsWindow = config.app.windows[config.app.settingsWindowID];
    if (settingsWindow) {
      return new Promise<void>(async (resolve, reject) => {
        var resolvedSettings: { [key: string]: any } = {};

        async function handleSetting(evt: any, name: string, value: any) {
          if (settings.indexOf(name) >= 0) {
            // If we got a value for one of our requested settings,
            // check if all requested settings have defined values
            // (close settings window & resolve promise if they do).
            resolvedSettings[name] = value;

            const allSettingsResolved =
              settings.filter(s => resolvedSettings[s] === undefined).length < 1;

            if (allSettingsResolved) {
              ipcMain.removeListener('set-setting', handleSetting);
              await closeWindow(settingsWindow.openerParams.title);
              resolve();
            }
          }
        }
        ipcMain.on('set-setting', handleSetting);
        await _openWindow(config.app.settingsWindowID);
      });
    } else {
      throw new Error("Settings were requested, but settings window is not specified");
    }
  }

  // TODO: This workaround may or may not be necessary
  if (config.disableGPU) {
    app.disableHardwareAcceleration();
  }

  // Catch unhandled errors in electron-log
  log.catchErrors({ showDialog: true });

  const isMacOS = process.platform === 'darwin';
  const isDevelopment = process.env.NODE_ENV !== 'production';

  const settings = new SettingManager(config.appDataPath, config.settingsFileName);
  settings.setUpIPC();

  // Prepare database backends & request configuration if needed
  const dbBackendClasses: { dbName: string, backendClass: DatabaseBackendClass<any, any>, backendOptions: any }[] = (await Promise.all(Object.entries(config.databases).
  map(async ([dbName, dbConf]) => {
    const DBBackendClass = (await dbConf.backend()).default;
    if (DBBackendClass.registerSettingsForConfigurableOptions) {
      DBBackendClass.registerSettingsForConfigurableOptions(settings, dbConf.options, dbName);
    }
    return {
      dbName: dbName,
      backendClass: DBBackendClass,
      backendOptions: dbConf.options,
    };
  })));


  // Request settings from user via an initial configuration window, if required
  const missingSettings = await settings.listMissingRequiredSettings();
  if (missingSettings.length > 0) {
    await _requestSettings(missingSettings);
  }


  // Initialize database backends
  type DBs = MainApp<any, C>["databases"];
  const databases: DBs = dbBackendClasses.
  map(async ({ dbName, backendClass, backendOptions }) => {
    const DBBackendClass = backendClass;

    let options: any;
    if (DBBackendClass.completeOptionsFromSettings) {
      options = await DBBackendClass.completeOptionsFromSettings(
        settings,
        backendOptions.options,
        dbName);
    } else {
      options = backendOptions.options;
    }

    const backend = new DBBackendClass(options);

    await backend.init();

    if (backend.setUpIPC) {
      backend.setUpIPC(dbName);
    }

    return { [dbName]: backend };
  }).reduce((val, acc) => ({ ...acc, ...val }), {} as Partial<DBs>) as DBs;


  // Initialize model managers
  type Managers = MainApp<any, C>["managers"];
  const managers: Managers = (await Promise.all(Object.entries(config.managers).
  map(async ([modelName, managerConf]) => {
    const modelConf = config.app.data[modelName];
    const db = databases[managerConf.dbName];
    const ManagerClass = (await managerConf.options.cls()).default;
    const manager = new ManagerClass(db, managerConf.options, modelConf);

    if (manager.setUpIPC) {
      manager.setUpIPC(modelName);
    }

    return { [modelName]: manager };
  }))).reduce((val, acc) => ({ ...acc, ...val }), {} as Partial<Managers>) as Managers;


  app.whenReady()
  .then(() => {
    _openWindow('default');

    // Initialize window-opening endpoints
    for (const [windowName, window] of Object.entries(config.app.windows)) {
      makeWindowEndpoint(windowName, () => ({
        ...(window as Window).openerParams,
        component: windowName,
      }));
    }
  });

  main = {
    app,
    isMacOS,
    isDevelopment,
    managers,
    databases,
    openWindow: _openWindow,
  };

  return main as MainApp<typeof config.app, typeof config>;
};


export interface MainApp<A extends AppConfig, M extends MainConfig<A>> {
  /* Object returned by initMain. */

  app: App,
  isMacOS: boolean
  isDevelopment: boolean
  managers: Record<keyof A["data"], VersionedManager<any, any>>
  databases: Record<keyof M["databases"], VersionedFilesystemBackend>
  openWindow: (windowName: keyof A["windows"]) => void
}
