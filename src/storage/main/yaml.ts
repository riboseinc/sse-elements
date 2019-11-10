import * as log from 'electron-log';
import * as yaml from 'js-yaml';
import { customTimestampType } from './yaml-custom-ts';


interface YAMLStorageOptions {
  debugLog: boolean;
}


export class YAMLStorage {
  constructor(private fs: any, private opts: YAMLStorageOptions = { debugLog: false }) { }

  private debugLog(message: string, level: 'silly' | 'debug' = 'debug') {
    if (this.opts.debugLog) {
      log[level](message);
    }
  }

  public async load(filePath: string): Promise<any> {
    this.debugLog(`SSE: YAMLStorage: Loading ${filePath}`);
    const data: string = await this.fs.readFile(filePath, { encoding: 'utf8' });
    return yaml.load(data, { schema: SCHEMA });
  }

  private async loadIfExists(filePath: string): Promise<any> {
    let fileExists: boolean;
    let oldData: any;

    try {
      fileExists = (await this.fs.stat(filePath)).isFile() === true;
    } catch (e) {
      fileExists = false;
    }

    if (fileExists) {
      oldData = await this.load(filePath);
    } else {
      oldData = {};
    }

    return oldData || {};
  }

  public async store(filePath: string, data: any): Promise<any> {
    this.debugLog(`SSE: YAMLStorage: Storing ${filePath}`)
    this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: ${JSON.stringify(data)}`, 'silly');

    if (data !== undefined && data !== null) {
      // Merge new data into old data; this way if some YAML properties
      // are not supported we will not lose them after the update.
      let newData: any;
      let oldData: any;
      let newContents: string;

      try {
        oldData = await this.loadIfExists(filePath);
        this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: Already existing data: ${oldData}`, 'silly');
        newData = Object.assign(oldData, data);
        this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: Combined data to write: ${newData}`, 'silly');
      } catch (e) {
        log.error(`SSE: YAMLStorage: Failed to store ${filePath}`);
        console.error("Bad input", filePath, oldData, data);
        throw e;
      }

      // console.debug(`Dumping contents for ${filePath} from ${data}`);
      // console.debug(oldData);

      try {
        newContents = yaml.dump(newData, {
          schema: SCHEMA,
          noRefs: true,
          noCompatMode: true,
        });
      } catch (e) {
        log.error(`SSE: YAMLStorage: Failed to dump ${filePath}: ${JSON.stringify(data)}`);
        console.error(`Failed to save ${filePath} with ${JSON.stringify(newData)}`, e);
        return;
      }

      // console.debug(`Writing to ${filePath}, file exists: ${fileExists}`);

      // if (fileExists) {
      //   const oldContents: string = await this.fs.readFile(filePath, { encoding: 'utf8' });
      //   console.debug(`Replacing contents of ${filePath}`, oldContents, newContents);
      // }

      this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: Writing file`);
      this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: Writing file: ${newContents}`, 'silly');
      await this.fs.writeFile(filePath, newContents, { encoding: 'utf8' });
      return data;
    } else {
      this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: Empty data given, removing file`);
      await this.fs.remove(filePath);
    }
  }
}


const SCHEMA = new yaml.Schema({
  include: [yaml.DEFAULT_SAFE_SCHEMA],

  // Trick because js-yaml API appears to not support augmenting implicit tags
  implicit: [
    ...(yaml.DEFAULT_SAFE_SCHEMA as any).implicit,
    ...[customTimestampType],
  ],
});
