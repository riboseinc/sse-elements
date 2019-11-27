export declare type AnyIDType = string | number;
export interface IndexableObject<IDType extends AnyIDType = AnyIDType> {
    id: IDType;
    [fieldName: string]: any;
}
export interface Index<T extends IndexableObject> {
    [stringifiedFieldValue: string]: T;
}
interface ArraySorter {
    (a: [string, unknown], b: [string, unknown]): number;
}
export declare class QuerySet<T extends IndexableObject> {
    index: Index<T>;
    order: ArraySorter;
    items: [string, T][];
    _ordered: boolean;
    constructor(index: Index<T>, order?: ArraySorter, items?: [string, T][] | undefined, ordered?: boolean);
    get(id: string): T;
    add(obj: T): void;
    orderBy(comparison: ArraySorter): QuerySet<T>;
    filter(func: (item: [string, T]) => boolean): QuerySet<T>;
    all(): T[];
}
export declare const sortAlphabeticallyAscending: ArraySorter;
export declare const sortIntegerDescending: ArraySorter;
export declare const sortIntegerAscending: ArraySorter;
export {};
