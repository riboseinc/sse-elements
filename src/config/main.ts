import { AppConfig, ModelConfig } from './app';
import { Model } from '../db/models';
import { Backend as DatabaseBackend, VersionedManager } from '../db/main/base';


export interface MainConfig<App extends AppConfig> {
  app: App
  singleInstance: boolean
  disableGPU: boolean
  databases: {
    default: DatabaseConfig,
    [dbName: string]: DatabaseConfig,
  }
  managers: {
    [DT in keyof App["data"]]: ManagerConfig<this["databases"]>
  }
}


interface DatabaseConfig {
  backend: () => Promise<{ default: DatabaseBackendClass }>
  options: DatabaseBackendOptions
}


// Databases

export interface DatabaseBackendClass {
  new (options: DatabaseBackendOptions): DatabaseBackend
}

export interface DatabaseBackendOptions {
  workDir: string,
  repoURL: string,
  corsProxyURL: string,
}


// Model managers

export interface ManagerClass<M extends Model, DB extends DatabaseBackend> {
  new (db: DB, managerConfig: ManagerOptions<M>, modelConfig: ModelConfig): VersionedManager<M, any>
}

export interface ManagerOptions<M extends Model> {
  cls: () => Promise<{ default: ManagerClass<M, any> }>
  workDir: string
  metaFields: (keyof M)[]
  idField: keyof M
}

export interface ManagerConfig<D extends Record<string, DatabaseConfig>> {
  dbName: string
  options: ManagerOptions<any>
}
