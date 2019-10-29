import { CheckerResults } from './types';
import { Workspace } from 'storage/workspace';
interface PreflightChecker {
    id: string;
    label: string;
    process: (ws: Workspace) => Promise<CheckerResults>;
}
declare class PreflightCheckerRegistry {
    checkers: {
        [checkerId: string]: PreflightChecker;
    };
    register(id: string, checker: PreflightChecker): void;
}
export declare const registry: PreflightCheckerRegistry;
export {};
