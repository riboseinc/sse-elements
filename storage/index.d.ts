import { IndexableObject } from './query';
export interface Storage {
    [contentTypeId: string]: IndexableObject;
}
