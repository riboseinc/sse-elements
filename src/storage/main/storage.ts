import * as path from 'path';
import * as log from 'electron-log';

import { listen } from '../../api/main';

import { Index, IndexableObject } from '../query';
import { Workspace, EmptyPartialWorkspace } from '../workspace';

import { YAMLStorage } from './yaml';


const YAML_EXT = '.yaml';


export abstract class StoreManager<O extends IndexableObject> {
  protected _index: Index<O> | undefined = undefined;

  constructor(public rootDir: string) {}


  /* Intended to be overridden */

  // Converts object into data valid for storage
  public toStoreableObject(obj: O): any {
    return { meta: obj as any };
  };

  // Converts raw loaded data into valid object
  public toUseableObject(data: any): O {
    return data as O;
  }

  public objectMatchesQuery(obj: O, query: string): boolean {
    return false;
  }

  public formatObjectNameForCommitMessage(obj: O): string {
    return `${path.basename(this.rootDir)}#${obj.id}`;
  }


  /* Can be called from outside */

  public async getIndex(storage: Storage<any>, force = false): Promise<Index<O>> {
    if (this._index === undefined || force === true) {
      this._index = await this._loadIndex(storage);
    }
    return this._index;
  }

  public async findObjects(storage: Storage<any>, query?: string): Promise<Index<O>> {
    const index = await this.getIndex(storage);
    if (query !== undefined) {
      var results: Index<O> = {};
      for (let key of Object.keys(index)) {
        const obj = index[key]
        if (this.objectMatchesQuery(obj, query)) {
          results[key] = obj;
        }
      }
      return results;
    } else {
      return index;
    }
  }

  // Loads object data from given directory, reading YAML files.
  // meta.yaml is treated specially, populating top-level object payload.
  // Other YAML files populate corresponding object properties.
  public async load(objDir: string, storage: Storage<any>): Promise<any | undefined> {
    const objPath = path.join(storage.workDir, objDir);
    const metaFile = path.join(objPath, 'meta.yaml');

    let metaFileIsFile: boolean;
    try {
      metaFileIsFile = (await storage.fs.stat(metaFile)).isFile();
    } catch (e) {
      return undefined;
    }
    if (!metaFileIsFile) {
      return undefined;
    }

    var objData: any = await storage.yaml.load(metaFile) || {};

    const dirContents = await storage.fs.readdir(objPath);
    for (const item of dirContents) {
      if (path.extname(item) == YAML_EXT) {
        const basename = path.basename(item, YAML_EXT);
        if (basename != 'meta') {
          objData[basename] = await storage.yaml.load(path.join(objPath, item));
        }
      }
    }

    // Blindly hope that data structure loaded from YAML
    // is valid for given type.
    return objData;
  }

  public async store(obj: O, storage: Storage<any>, updateIndex = true): Promise<boolean> {
    //log.debug(`SSE: StorageManager for ${this.rootDir}: Storing object ${obj.id}`);
    //log.silly(`SSE: StorageManager for ${this.rootDir}: Storing object ${obj.id}: ${JSON.stringify(obj)}`);

    const objPath = this.resolveObjectPath(`${obj.id}`, storage);
    const storeable = this.toStoreableObject(obj);

    await storage.fs.ensureDir(objPath);
    for (const key of Object.keys(storeable)) {
      const data = storeable[key];
      await storage.yaml.store(path.join(objPath, `${key}.yaml`), data);
    }

    if (updateIndex === true) {
      await this.updateInIndex(obj, storage);
    }

    return true;
  }

  public async delete(objId: string, storage: Storage<any>, updateIndex = true): Promise<boolean> {
    const objPath = this.resolveObjectPath(objId, storage);

    log.info(`Deleting path with subdirectories: ${objPath}`);

    await storage.fs.remove(objPath);

    if (updateIndex === true) {
      await this.deleteFromIndex(objId, storage);
    }

    return true;
  }


  /* Private */

  public resolveObjectPath(objId: string, storage: Storage<any>): string {
    const objDir = path.join(this.rootDir, objId);
    return path.join(storage.workDir, objDir);
  }

  private async updateInIndex(obj: O, storage: Storage<any>) {
    await this.getIndex(storage);
    (this._index as Index<O>)[obj.id] = obj;
  }

  private async deleteFromIndex(objId: string, storage: Storage<any>) {
    await this.getIndex(storage);
    delete (this._index as Index<O>)[objId];
  }

  private async _loadIndex(storage: Storage<any>): Promise<Index<O>> {
    const rootPath = this.rootDir;
    const dirs = await storage.fs.readdir(path.join(storage.workDir, rootPath));
    var idx: Index<O> = {};

    for (const dir of dirs) {
      if (dir != '.DS_Store') {
        let objData: any;
        try {
          objData = await this.load(path.join(rootPath, dir), storage);
        } catch (e) {
          log.error(`Failed to load object from ${dir} when loading index ${this.rootDir}`);
        }
        if (objData) {
          const obj: O = this.toUseableObject(objData);
          if (obj.id) {
            idx[`${obj.id}`] = obj;
          }
        }
      }
    }
    return idx;
  }
}


export abstract class Storage<W extends Workspace> {
  public yaml: YAMLStorage;
  public workspace: W;

  constructor(
      public fs: typeof import('fs-extra'),
      public workDir: string,
      public storeManagers: { [K in keyof W]: StoreManager<any> },
      debugBackend?: true) {
    this.fs = fs;
    this.workDir = workDir;
    this.yaml = new YAMLStorage(fs, { debugLog: debugBackend || false });

    this.workspace = Object.keys(storeManagers).
    reduce((ws: EmptyPartialWorkspace<W>, indexName: keyof W) => {
      ws[indexName] = {};
      return ws;
    }, {}) as W;
  }

  public abstract async findObjects(query?: string): Promise<W>

  public async loadWorkspace(force = false): Promise<void> {
    // Loads workspace object with an index for each store manager.
    // To force store manager to re-read index from filesystem, pass force = true.
    this.workspace = await Object.keys(this.storeManagers).
    reduce(async (wsP: Promise<EmptyPartialWorkspace<W>>, indexName: keyof W) => {
      const ws = await wsP;
      ws[indexName] = await this.storeManagers[indexName].getIndex(this, force);
      return ws;
    }, Promise.resolve({})) as W;
  }

  setUpAPIEndpoints(notifier: (notify: string[]) => void) {
    log.verbose("SSE: Storage: Setting API endpoints");

    for (let indexName of Object.keys(this.workspace)) {

      listen<{}, Index<any>>
      (`storage-read-all-in-${indexName}`, async () => {
        return this.workspace[indexName];
      });

      listen<{ objectId: string, newData: IndexableObject  }, { success: boolean }>
      (`storage-create-one-in-${indexName}`, async ({ objectId, newData }) => {
        await this.storeManagers[indexName].store(newData, this);
        notifier([indexName]);
        return { success: true };
      });

      listen<{ objectId: string }, IndexableObject | undefined>
      (`storage-read-one-in-${indexName}`, async ({ objectId }) => {
        return this.workspace[indexName][objectId] || undefined;
      });

      listen<{ objectId: string, newData: IndexableObject  }, { success: boolean }>
      (`storage-update-one-in-${indexName}`, async ({ objectId, newData }) => {
        await this.storeManagers[indexName].store(newData, this);
        notifier([indexName]);
        return { success: true };
      });

      listen<{ objectId: string }, { success: boolean }>
      (`storage-delete-one-in-${indexName}`, async ({ objectId }) => {
        await this.storeManagers[indexName].delete(objectId, this);
        notifier([indexName]);
        return { success: true };
      });

    }
  }
}
