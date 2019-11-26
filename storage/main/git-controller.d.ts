import * as git from 'isomorphic-git';
import { SettingManager } from '../../settings/main';
import { WindowOpenerParams } from '../../main/window';
export declare class GitController {
    private fs;
    private repoUrl;
    private upstreamRepoUrl;
    workDir: string;
    private corsProxy;
    private auth;
    private stagingLock;
    constructor(fs: any, repoUrl: string, upstreamRepoUrl: string, workDir: string, corsProxy: string);
    isInitialized(): Promise<boolean>;
    isUsingRemoteURLs(remoteUrls: {
        origin: string;
        upstream: string;
    }): Promise<boolean>;
    needsPassword(): boolean;
    forceInitialize(): Promise<void>;
    loadAuth(): Promise<void>;
    configSet(prop: string, val: string): Promise<void>;
    configGet(prop: string): Promise<string>;
    setPassword(value: string | undefined): void;
    pull(): Promise<void>;
    listChangedFiles(pathSpecs?: string[]): Promise<string[]>;
    stage(pathSpecs: string[]): Promise<void>;
    commit(msg: string): Promise<string>;
    stageAndCommit(pathSpecs: string[], msg: string): Promise<number>;
    unstageAll(): Promise<void>;
    listLocalCommits(): Promise<string[]>;
    fetchRemote(): Promise<void>;
    push(force?: boolean): Promise<git.PushResponse>;
    resetFiles(paths: string[]): Promise<void>;
    getOriginUrl(): Promise<string | null>;
    getUpstreamUrl(): Promise<string | null>;
    fetchUpstream(): Promise<void>;
    resetToUpstream(): Promise<{
        success: boolean;
    }>;
    setUpAPIEndpoints(): void;
}
export declare function initRepo(workDir: string, repoUrl: string, upstreamRepoUrl: string, corsProxyUrl: string, force: boolean): Promise<GitController>;
export declare function setRepoUrl(configWindow: WindowOpenerParams, settings: SettingManager): Promise<{
    url: string;
    hasChanged: boolean;
}>;
