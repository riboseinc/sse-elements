import { IndexableObject } from './query';


export interface Storage {
  [contentTypeId: string]: IndexableObject,
}
/* Describes available content types,
   mapping IndexableObject instances to content type identifiers. */
