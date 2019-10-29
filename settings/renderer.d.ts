/// <reference types="react" />
export declare function useSetting<T>(name: string, initialValue: T): {
    value: T;
    set: import("react").Dispatch<import("react").SetStateAction<T>>;
    commit: () => Promise<void>;
};
