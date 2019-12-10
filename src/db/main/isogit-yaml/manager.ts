import * as path from 'path';
//import * as log from 'electron-log';

import { ModelConfig } from '../../../config/app';
import { ManagerOptions } from '../../../config/main';
import { Model, AnyIDType } from '../../models';
import { Index } from '../../query';
import { VersionedManager, VersionedFilesystemManager, CommitError } from '../base';
import { Backend, isGitError } from './base';


class Manager<M extends Model, IDType extends AnyIDType>
implements VersionedManager<M, IDType>, VersionedFilesystemManager {
  /* Combines a filesystem storage with Git. */

  constructor(
      private db: Backend,
      private managerConfig: ManagerOptions<M>,
      private modelConfig: ModelConfig) {
    db.registerManager(this as VersionedFilesystemManager);
  }

  public managesFileAtPath(filePath: string) {
    return true;
  }


  // CRUD methods

  public async create(obj: M, commit: boolean | string = false) {
    const objID = obj[this.managerConfig.idField];
    await this.db.create(obj, this.getDBRef(objID), this.managerConfig.metaFields);

    if (commit !== false) {
      await this.commitOne(
        objID,
        commit !== true ? commit : null,
        'create');
    }
  }

  public async read(objID: IDType) {
    return await this.db.read(this.getDBRef(objID), this.managerConfig.metaFields as string[]) as M;
  }

  public async commit(objIDs: IDType[], message: string) {
    if (objIDs.length > 0) {
      await this.db.commit(objIDs.map(objID => this.getDBRef(objID)), message);
    }
  }

  public async discard(objIDs: IDType[]) {
    if (objIDs.length > 0) {
      await this.db.discard(objIDs.map(objID => this.getDBRef(objID)));
    }
  }

  public async listUncommitted() {
    const dbRefs = await this.db.listUncommitted();

    const objIDs: IDType[] = dbRefs.
      filter(ref => this.managesFileAtPath(ref)).
      map(ref => this.getObjID(ref));

    return objIDs.filter(function (objID, idx, self) {
      // Discard any duplicates from the list of object IDs
      return idx === self.indexOf(objID);
    });
  }

  public async readAll() {
    var idx: Index<M> = await this.db.readAll(this.managerConfig.idField as string);;
    return idx;
  }

  public async update(objID: IDType, newData: M, commit: boolean | string = false) {
    if (objID !== newData[this.managerConfig.idField]) {
      throw new Error("Updating object IDs is not supported at the moment.");
    }

    await this.db.update(this.getDBRef(objID), newData, this.managerConfig.idField as string);

    if (commit !== false) {
      await this.commitOne(
        objID,
        commit !== true ? commit : null,
        'update',
        newData);
    }
  }

  public async delete(objID: IDType, commit: string | boolean = false) {
    await this.db.delete(this.getDBRef(objID));

    if (commit !== false) {
      await this.commitOne(
        objID,
        commit !== true ? commit : null,
        'delete');
    }
  }

  private async commitOne(objID: IDType, commitMessage: string | null, verb: string, obj?: M) {
    try {
      await this.db.commit(
        [this.getDBRef(objID)],
        commitMessage !== null
          ? commitMessage
          : this.formatCommitMessage(verb, objID, obj));

    } catch (e) {
      if (isGitError(e)) {
        throw new CommitError(e.code, e.message);
      } else {
        throw e;
      }
    }
  }

  private formatObjectName(objID: IDType, obj?: M) {
    return `${objID}`;
  }

  private formatCommitMessage(verb: string, objID: IDType, obj?: M) {
    return `${verb} ${this.modelConfig.shortName} ${this.formatObjectName(objID, obj)}`;
  }

  private getDBRef(objID: IDType): string {
    /* Returns DB backend’s full ID given object ID. */
    return path.join(this.managerConfig.workDir, `${objID}`);
  }

  public getObjID(dbRef: string) {
    if (path.isAbsolute(dbRef)) {
      throw new Error("getObjID() received dbRef which is an absolute filesystem path");
    }
    const relativeRef = path.relative(this.managerConfig.workDir, dbRef);
    const baseComponent = relativeRef.split(path.sep)[0];

    // if (!objId || !(await this.isValidId(objId))) {
    //   throw new Error(`Unable to resolve object ID for path ${filepath}`);
    // }

    return baseComponent as IDType;
  }
}


export default Manager;
