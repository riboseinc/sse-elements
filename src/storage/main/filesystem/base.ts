import * as fs from 'fs-extra';
import * as path from 'path';
import AsyncLock from 'async-lock';


type FilesystemPath = string;


export interface FilesystemBackend<T> {
  /* Spec for filesystem backends
     that can be used with Git filesystem object store.

     It has its own concept of “object IDs”,
     which are references to filesystem entries.
     If backend operates on files of single type,
     object IDs would probably exclude filename extension.
     The Store using this backend would convert object IDs to */

  baseDir: string;
  /* Absolute path.
     Backend is not concerned with files outside this path.
     TODO: Could better be made read-only, behind accessor method. */

  read(objId: string): Promise<T>;

  readAll(): Promise<T[]>;
  /* Scan filesystem and returns all the objects found. */

  write(objId: string, newData: T | undefined): Promise<FilesystemPath[]>;
  /* Updates given object and returns a list of filesystem paths that could be affected.
     If `newData` is undefined, the object is expected to be deleted. */

  expandPath(objId: string): string;
  /* Returns an absolute path to object file or root directory,
     given object ID. Adds an extension where applicable.
     Used by read(), write() under the hood. TODO: Should be made private? */

  resolveObjectId(path: string): string;
  /* Given path, returns object’s FS backend ID */


  // TODO: Following two can be renamed for clarity.

  exists(objId: string): Promise<boolean>;
  /* Given object ID, returns true if the object actually exists.
     Used when storing e.g. to avoid overwriting an existing object. */

  isValidId(filepath: string): Promise<boolean>;
  /* Given a path, returns true if it looks like a valid object ID.

     This is intended to be used for weeding out random files
     that are not part of the database, e.g. system files/directories,
     when loading objects from filesystem.

     This can be as simple as comparing the extension
     but if necessary can do further checks on file/directory contents. */

}


export abstract class AbstractLockingFilesystemBackend<T> implements FilesystemBackend<T> {
  /* Basic filesystem backend around Node.js fs-extra,
     providing stub methods for parsing/dumping data from/to raw string file contents
     and implementing locking around file reads/writes
     (locks based on file path, so that it cannot be written to while it’s being read from/written to).
  */

  private fileAccessLock: AsyncLock;

  constructor(public baseDir: string) {
    this.fileAccessLock = new AsyncLock();
  }

  public expandPath(objId: string) {
    return path.join(this.baseDir, objId);
  }

  public makeRelativePath(absPath: string) {
    if (path.isAbsolute(absPath)) {
      return path.relative(this.baseDir, absPath);
    } else {
      throw new Error("Expecting an absolute path, but got relative");
    }
  }

  public async isValidId(value: string) {
    return true;
  }

  public resolveObjectId(filepath: string) {
    const objId = filepath.split(path.sep)[0];
    if (!objId) {
      throw new Error(`Unable to resolve object ID for path ${filepath}`);
    }
    return objId;
  }

  public async readAll() {
    const objIds = await fs.readdir(this.baseDir);
    var objs = [];
    for (const objId of objIds) {
      if (await this.isValidId(objId)) {
        objs.push(await this.read(objId));
      }
    }
    return objs;
  }

  public async exists(objId: string) {
    return await fs.pathExists(this.expandPath(objId));
  }

  public async read(objId: string) {
    const filePath = this.expandPath(objId);
    return await this.fileAccessLock.acquire(filePath, async () => {
      return this.parseData(await fs.readFile(filePath, { encoding: 'utf8' }));
    });
  }

  public async write(objId: string, newContents: T | undefined) {
    const filePath = this.expandPath(objId);
    return await this.fileAccessLock.acquire(filePath, async () => {
      if (newContents !== undefined) {
        await fs.writeFile(filePath, this.dumpData(newContents), { encoding: 'utf8' });
      } else {
        await fs.remove(filePath);
      }
      return [this.makeRelativePath(filePath)];
    });
  }

  protected abstract parseData(contents: string): T

  protected abstract dumpData(data: T): string

}
