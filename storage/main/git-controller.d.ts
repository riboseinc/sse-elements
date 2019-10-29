import { SettingManager } from '../../settings/main';
import { WindowOpenerParams } from '../../main/window';
import { GitAuthor, GitAuthentication } from '../git';
export declare class GitController {
    private fs;
    private repoUrl;
    private workDir;
    private corsProxy;
    private auth;
    constructor(fs: any, repoUrl: string, workDir: string, corsProxy: string);
    getAuthor(): Promise<GitAuthor>;
    setAuthor(author: GitAuthor): Promise<void>;
    setAuth(auth: GitAuthentication): Promise<boolean>;
    isInitialized(): Promise<boolean>;
    getOriginUrl(): Promise<string | null>;
    getUpstreamUrl(): Promise<string | null>;
    addAllChanges(): Promise<void>;
    listChangedFiles(): Promise<string[]>;
    pull(): Promise<void>;
    commit(msg: string): Promise<void>;
    push(): Promise<void>;
    reset(): Promise<void>;
    setUpAPIEndpoints(): void;
}
export declare function initRepo(workDir: string, repoUrl: string, corsProxyUrl: string, settings: SettingManager): Promise<GitController>;
export declare function setRepoUrl(configWindow: WindowOpenerParams, settings: SettingManager): Promise<string>;
