import AsyncLock from 'async-lock';
import * as log from 'electron-log';
import * as yaml from 'js-yaml';
import { Schema as SCHEMA } from './filesystem/yaml/schema';


interface YAMLStorageOptions {
  debugLog: boolean;
}


export class YAMLStorage {
  private fileWriteLock: AsyncLock;

  constructor(private fs: any, private opts: YAMLStorageOptions = { debugLog: false }) {
    this.fileWriteLock = new AsyncLock();
  }

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

  public async store(filePath: string, data: any): Promise<any> {
    this.debugLog(`SSE: YAMLStorage: Storing ${filePath}`)
    this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: ${JSON.stringify(data)}`, 'silly');

    // Ensure the same file is not written to simultaneously from two separate store() calls
    return await this.fileWriteLock.acquire(filePath, async () => {
      this.debugLog(`SSE: YAMLStorage: Start writing ${filePath}`);

      if (data !== undefined && data !== null) {
        let newContents: string;
        try {
          newContents = yaml.dump(data, {
            schema: SCHEMA,
            noRefs: true,
            noCompatMode: true,
          });
        } catch (e) {
          log.error(`SSE: YAMLStorage: Failed to dump ${filePath}: ${JSON.stringify(data)}`);
          console.error(`Failed to save ${filePath} with ${JSON.stringify(data)}`, e);
          return;
        }

        this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: Writing file`);
        this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: Writing file: ${newContents}`, 'silly');

        await this.fs.writeFile(filePath, newContents, { encoding: 'utf8' });

      } else {
        this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: Empty data given, removing file`);

        await this.fs.remove(filePath);

      }
      this.debugLog(`SSE: YAMLStorage: Finish writing ${filePath}`);
      return data;
    });
  }
}
