import * as path from 'path';
import * as fs from 'fs-extra';
import * as yaml from 'js-yaml';
import { Schema } from './schema';

import { AbstractLockingFilesystemBackend } from '../base';


const YAML_EXT = '.yaml';


export class YAMLBackend<T = any> extends AbstractLockingFilesystemBackend<T> {

  protected isYAMLFile(objId: string) {
    return path.extname(objId) === YAML_EXT;
  }

  public async isValidId(objId: string) {
    return this.isYAMLFile(objId);
  }

  public async resolveObjectId(objId: string) {
    // Drop YAML extension from resolved path fragment.
    const idWithExt = await super.resolveObjectId(objId);
    return path.basename(idWithExt, YAML_EXT);
  }

  public expandPath(objId: string) {
    // In this case, path to object should include YAML extension.
    return `${super.expandPath(objId)}${YAML_EXT}`;
  }

  protected parseData(data: string): any {
    return yaml.load(data, { schema: Schema });
  }

  protected dumpData(data: any): string {
    if (data !== undefined && data !== null) {
      return yaml.dump(data, {
        schema: Schema,
        noRefs: true,
        noCompatMode: true,
      });

    } else {
      throw new Error("Attempt to write invalid data (null or undefined)");

    }
  }
}


interface YAMLDirectoryStoreableContents {
  meta: any,
  [key: string]: any,
};

export class YAMLDirectoryBackend extends YAMLBackend<YAMLDirectoryStoreableContents> {

  constructor(baseDir: string, private metaProperties: string[]) { super(baseDir); }

  private expandDirectoryPath(objId: string) {
    return path.join(this.baseDir, objId);
  }

  public async exists(objId: string) {
    const dirPath = this.expandDirectoryPath(objId);
    if (await fs.pathExists(dirPath)) {
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) {
        throw new Error("File is expected to be a directory");
      }
      return true;
    }
    return false;
  }

  public async isValidId(value: string) {
    const metaFile = path.join(this.expandDirectoryPath(value), `meta${YAML_EXT}`);
    let metaFileIsFile: boolean;
    try {
      metaFileIsFile = (await fs.stat(metaFile)).isFile();
    } catch (e) {
      return false;
    }
    if (!metaFileIsFile) {
      return false;
    }
    return metaFileIsFile;
  }

  public async read(objId: string) {
    const objAbsPath = this.expandDirectoryPath(objId);

    const metaId = 'meta';

    const metaAbsPath = path.join(objAbsPath, `${metaId}${YAML_EXT}`);
    let metaFileIsFile: boolean;
    try {
      metaFileIsFile = (await fs.stat(metaAbsPath)).isFile();
    } catch (e) {
      throw new Error(`Exception accessing meta file for ${objId}: ${metaAbsPath}: ${e.toString()} ${e.stack}`);
    }
    if (!metaFileIsFile) {
      throw new Error(`Meta file for ${objId} is not a file: ${metaAbsPath}`);
    }

    var objData: any = {};

    const metaPath = path.join(objId, metaId);
    const meta = await super.read(metaPath) || {};
    for (const key of this.metaProperties) {
      objData[key] = meta[key];
    }

    const dirContents = await fs.readdir(objAbsPath);
    for (const filename of dirContents) {
      if (this.isYAMLFile(filename)) {
        const fieldName = path.basename(filename, YAML_EXT);
        if (fieldName != 'meta') {
          objData[fieldName] = await super.read(path.join(objId, fieldName));
        }
      }
    }

    // Blindly hope that data structure loaded from YAML
    // is valid for given type.
    return objData;
  }

  public async write(objId: string, newData: any) {
    const objPath = this.expandDirectoryPath(objId);

    await fs.ensureDir(objPath);

    var dataToStore: YAMLDirectoryStoreableContents = { meta: {} };
    var modifiedPaths = [] as string[];

    for (const key of Object.keys(newData)) {
      if (this.metaProperties.indexOf(key) >= 0) {
        dataToStore.meta[key] = newData[key];
      } else {
        dataToStore[key] = newData[key];
      }
    }

    for (const [fieldName, fieldValue] of Object.entries(dataToStore)) {
      modifiedPaths = [
        ...modifiedPaths,
        ...(await super.write(path.join(objId, fieldName), fieldValue)),
      ];
    }

    return modifiedPaths;
  }
}
