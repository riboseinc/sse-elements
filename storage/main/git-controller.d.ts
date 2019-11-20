import { SettingManager } from '../../settings/main';
import { WindowOpenerParams } from '../../main/window';
export declare class GitController {
    private fs;
    private repoUrl;
    private upstreamRepoUrl;
    private workDir;
    private corsProxy;
    private auth;
    constructor(fs: any, repoUrl: string, upstreamRepoUrl: string, workDir: string, corsProxy: string);
    isInitialized(): Promise<boolean>;
    isUsingRemoteURLs(remoteUrls: {
        origin: string;
        upstream: string;
    }): Promise<boolean>;
    forceInitialize(): Promise<void>;
    configSet(prop: string, val: string): Promise<void>;
    configGet(prop: string): Promise<string>;
    pull(): Promise<void>;
    listChangedFiles(): Promise<string[]>;
    stageAllLocalChanges(): Promise<void>;
    commitAllLocalChanges(withMsg: string): Promise<number>;
    commit(msg: string): Promise<void>;
    push(force?: boolean): Promise<void>;
    getOriginUrl(): Promise<string | null>;
    getUpstreamUrl(): Promise<string | null>;
    fetchUpstream(): Promise<void>;
    upstreamIsAhead(): Promise<boolean>;
    isAheadOfUpstream(): Promise<boolean>;
    resetToUpstream(): Promise<{
        success: boolean;
    }>;
    syncToRemote(): Promise<void>;
    setUpAPIEndpoints(): void;
}
export declare function initRepo(workDir: string, repoUrl: string, upstreamRepoUrl: string, corsProxyUrl: string, force: boolean): Promise<GitController>;
export declare function setRepoUrl(configWindow: WindowOpenerParams, settings: SettingManager): Promise<{
    url: string;
    hasChanged: boolean;
}>;
