import { AnyIDType, Model } from '../models';
import { SettingManager } from '../../settings/main';
import { Index } from '../query';


export interface Backend<IDType = AnyIDType> {
  init(): Promise<void>
  authenticate(...args: any[]): Promise<void>
  readAll<T extends Record<string, any>>(...args: any[]): Promise<Index<T>>
  read(objID: IDType, ...args: any[]): Promise<object>
  create<T extends Record<string, any>>(obj: T, ...args: any[]): Promise<void>
  update<T extends Record<string, any>>(objID: IDType, obj: T, ...args: any[]): Promise<void>
  delete(objID: IDType, ...args: any[]): Promise<void>

  setUpIPC?(dbID: string): void
  /* Initializes IPC endpoints to enable e.g. to configure the database
     or invoke specific utility methods from within app’s renderer process. */
}


export interface BackendClass<InitialOptions extends object, Options extends InitialOptions> {
  /* Initial options are supplied by the developer.
     Full options include options configurable by the user, some of which may be required.
     NOTE: By “Option”, backend constructor parameter is meant.
     TODO: This is a misnomer since some of those are non-optional. */

  new (options: Options): Backend
  // Constructor signature

  registerSettingsForConfigurableOptions?(
    settings: SettingManager,
    initialOptions: Partial<InitialOptions>,
    dbID: string): void
  /* Given initial options and a settings manager,
     register user-configurable settings that control this DB’s behavior.
     This method can make a setting required if corresponding option
     is not provided by the developer in the initial options. */

  completeOptionsFromSettings?(
    settings: SettingManager,
    initialOptions: Partial<InitialOptions>,
    dbID: string): Promise<Options>
  /* Given initial options and a settings manager,
     retrieve any user-configured options if needed
     and return full options object required by this backend. */
}


export interface VersionedBackend<T = object, IDType = AnyIDType> extends Backend<IDType> {

  discard(objIDs: IDType[]): Promise<void>
  /* Discard any uncommitted changes made to objects with specified IDs. */

  commit(objIDs: IDType[], commitMessage: string): Promise<void>
  /* Commit any uncommitted changes made to objects with specified IDs,
     with specified commit message. */

  listUncommitted?(): Promise<IDType[]>
  /* List IDs of objects with uncommitted changes. */

}


export interface VersionedFilesystemBackend extends VersionedBackend<object, string> {
  registerManager(manager: VersionedFilesystemManager): void

  resetOrphanedFileChanges(): Promise<void>
  /* Housekeeping method for file-based DB backend. */

  getWorkDir(): string
}


export interface VersionedManager<M extends Model, IDType extends AnyIDType> {
  /* Passes calls on to corresponding Backend & VersionedBackend methods,
     but limits their scope only to objects manipulated by this manager. */

  create(obj: M, commit: boolean | string): Promise<void>
  update(objID: IDType, obj: M, commit: boolean | string): Promise<void>;
  delete(objID: IDType, commit: boolean | string): Promise<void>;

  discard?(objIDs: IDType[]): Promise<void>
  commit?(objIDs: IDType[], commitMessage: string): Promise<void>

  listUncommitted?(): Promise<IDType[]>
  /* List IDs of objects with uncommitted changes. */

  setUpIPC?(modelName: string): void
  /* Initializes IPC endpoints to query or update managed data. */
}


export interface VersionedFilesystemManager {
  managesFileAtPath(filePath: string): boolean
}


export class CommitError extends Error {
  constructor(public code: string, msg: string) {
    super(msg);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
