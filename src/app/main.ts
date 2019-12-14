import { app, App } from 'electron';
import * as log from 'electron-log';
import { AppConfig, Window } from '../config/app';
import { MainConfig } from '../config/main';
import { VersionedFilesystemBackend, VersionedManager } from '../db/main/base';

import { makeWindowEndpoint } from '../api/main';
import { openWindow } from '../main/window';


export const initMain = async <C extends MainConfig<any>>(config: C): Promise<MainApp<any, C>> => {

  if (config.singleInstance && !app.requestSingleInstanceLock()) {
    // Ensure only one instance of the app can run at a time on given user’s machine
    // by exiting any future instances
    app.exit(0);
  }

  if (config.disableGPU) {
    app.disableHardwareAcceleration();
  }

  // Catch unhandled errors in electron-log
  log.catchErrors({ showDialog: true });

  const isMacOS = process.platform === 'darwin';
  const isDevelopment = process.env.NODE_ENV !== 'production';

  // Initialize databases
  type DBs = MainApp<any, C>["databases"];
  const databases: DBs = (await Promise.all(Object.entries(config.databases).
  map(async ([dbName, dbConf]) => {
    const DBBackendClass = (await dbConf.backend()).default;
    const backend = new DBBackendClass(dbConf.options);
    await backend.init();
    return { [dbName]: backend };
  }))).reduce((val, acc) => ({ ...acc, ...val }), {} as Partial<DBs>) as DBs;

  // Initialize model managers
  type Managers = MainApp<any, C>["managers"];
  const managers: Managers = (await Promise.all(Object.entries(config.managers).
  map(async ([modelName, managerConf]) => {
    const modelConf = config.app.data[modelName];
    const db = databases[managerConf.dbName];
    const ManagerClass = (await managerConf.options.cls()).default;
    const manager = new ManagerClass(db, managerConf.options, modelConf);
    return { [modelName]: manager };
  }))).reduce((val, acc) => ({ ...acc, ...val }), {} as Partial<Managers>) as Managers;

  app.whenReady()
  .then(() => {
    const defaultWindowParams = config.app.windows.default.openerParams;
    openWindow({
      ...defaultWindowParams,
      component: 'default',
    });
    for (const [windowName, window] of Object.entries(config.app.windows)) {
      makeWindowEndpoint(windowName, () => ({
        ...(window as Window).openerParams,
        component: windowName,
      }));
    }
  });

  return {
    app,
    isMacOS,
    isDevelopment,
    managers,
    databases,
  };
};


interface MainApp<A extends AppConfig, M extends MainConfig<A>> {
  app: App,
  isMacOS: boolean
  isDevelopment: boolean
  managers: Record<keyof A["data"], VersionedManager<any, any>>
  databases: Record<keyof M["databases"], VersionedFilesystemBackend>
}
