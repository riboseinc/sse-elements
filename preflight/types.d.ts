declare type Severity = 1 | 2 | 3;
interface Problem {
    resolved: boolean;
    severity: Severity;
    message: string;
    tags: string[];
}
export declare type CheckerResults = {
    [id: string]: Problem;
};
export declare type PreflightResults = {
    [checkerId: string]: CheckerResults;
};
export {};
