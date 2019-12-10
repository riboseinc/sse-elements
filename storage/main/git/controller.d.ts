import * as git from 'isomorphic-git';
import { SettingManager } from '../../../settings/main';
import { WindowOpenerParams } from '../../../main/window';
export declare class GitController {
    private fs;
    private repoUrl;
    private authorName;
    private authorEmail;
    private username;
    private upstreamRepoUrl;
    workDir: string;
    private corsProxy;
    private auth;
    private stagingLock;
    constructor(fs: any, repoUrl: string, authorName: string, authorEmail: string, username: string, upstreamRepoUrl: string, workDir: string, corsProxy: string);
    isInitialized(): Promise<boolean>;
    isUsingRemoteURLs(remoteUrls: {
        origin: string;
        upstream: string;
    }): Promise<boolean>;
    needsPassword(): boolean;
    forceInitialize(): Promise<void>;
    configSet(prop: string, val: string): Promise<void>;
    configGet(prop: string): Promise<string>;
    setPassword(value: string | undefined): void;
    loadAuth(): Promise<void>;
    pull(): Promise<any>;
    stage(pathSpecs: string[]): Promise<void>;
    commit(msg: string): Promise<string>;
    fetchRemote(): Promise<void>;
    fetchUpstream(): Promise<void>;
    push(force?: boolean): Promise<git.PushResponse>;
    resetFiles(paths?: string[]): Promise<void>;
    getOriginUrl(): Promise<string | null>;
    getUpstreamUrl(): Promise<string | null>;
    listLocalCommits(): Promise<string[]>;
    listChangedFiles(pathSpecs?: string[]): Promise<string[]>;
    stageAndCommit(pathSpecs: string[], msg: string): Promise<number>;
    private unstageAll;
    private _handleGitError;
    checkUncommitted(): Promise<boolean>;
    synchronize(): Promise<void>;
    setUpAPIEndpoints(): void;
}
export declare function initRepo(workDir: string, upstreamRepoUrl: string, corsProxyUrl: string, force: boolean, settings: SettingManager, configWindow: WindowOpenerParams): Promise<GitController>;
export declare function requestRepoUrl(configWindow: WindowOpenerParams): Promise<string>;
