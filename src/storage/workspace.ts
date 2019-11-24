import { Index, IndexableObject } from './query';

export type Workspace = { [indexName: string]: Index<IndexableObject> }
/* Workspace is the collection of indexes that the application operates on.
   There’s only one workspace.
   This is the abstract workspace, the app provides a workspace
   more precisely typed deriving from this type. */


export type EmptyPartialWorkspace<W extends Workspace> = { [K in keyof W]?: {} };
/* Represents an empty partial workspace, used only during app initialization. */
