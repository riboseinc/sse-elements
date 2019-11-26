export interface RemoteStorageStatus {
  isMisconfigured: boolean,
  isOffline: boolean,
  hasLocalChanges: boolean,
  needsPassword: boolean,
  statusRelativeToLocal: 'ahead' | 'behind' | 'diverged' | 'updated' | undefined,
  isPushing: boolean,
  isPulling: boolean,
}
