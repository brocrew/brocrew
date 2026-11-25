export const STORAGE_PART_IDS = [
  'workspace',
  'provider-conversations',
  'agent-output',
  'database',
  'backups',
  'plugins',
  'cache',
  'app-resources',
] as const

export type StoragePartId = (typeof STORAGE_PART_IDS)[number]
export interface StorageLocation {
  readonly part: StoragePartId
  readonly segments: readonly string[]
}
export type StorageError =
  | 'invalid-location'
  | 'outside-data'
  | 'linked-path'
  | 'unavailable'
  | 'not-directory'
  | 'limit'
  | 'cancelled'
  | 'busy'
export interface StoragePart {
  readonly id: StoragePartId
  readonly bytes: number | null
  readonly partial: boolean
  readonly error?: StorageError
}
export interface StorageOverview {
  /** Sum of the measured parts, excluding unavailable parts. */
  readonly totalBytes: number
  readonly freeBytes: number | null
  readonly measuredAt: number
  readonly parts: readonly StoragePart[]
  readonly partial: boolean
  readonly error?: StorageError
}
/** The piece a finished worker folder was made for: nothing open still uses that folder. */
export interface StorageFinishedWork {
  readonly label: string
  readonly title: string
}
export type StorageEntry = { readonly name: string } & (
  | {
      readonly bytes: number
      readonly isDirectory: boolean
      readonly isLink?: false
      /** Epoch ms of the newest change anywhere inside, when one was read. */
      readonly lastWrittenAt?: number
      /** Set only on agent output's own folders that can be removed. */
      readonly finished?: StorageFinishedWork
    }
  | { readonly bytes: null; readonly isDirectory: false; readonly isLink: true }
)
export interface StorageDirectory {
  readonly location: StorageLocation
  /** Immediate children, descending by recursively measured bytes: ten unless more were asked for. */
  readonly entries: readonly StorageEntry[]
  readonly smallerCount: number
  readonly smallerBytes: number
  readonly totalBytes: number
  readonly partial: boolean
  readonly error?: StorageError
}
export type StorageAction =
  { readonly ok: true } | { readonly ok: false; readonly error: StorageError }
/** A removal names the ticked folders it kept because something uses them again. */
export type StorageRemoval =
  | { readonly ok: true; readonly kept: readonly string[] }
  | { readonly ok: false; readonly error: StorageError }
export type CacheClearState = { readonly id: number } & (
  | { readonly status: 'clearing' | 'pending' | 'complete' }
  | { readonly status: 'failed'; readonly error: StorageError }
)
/** An accepted request carries its state; only complete means the cache was cleared. */
export type CacheClearReply =
  | { readonly ok: true; readonly operation: CacheClearState }
  | { readonly ok: false; readonly error: StorageError }
export interface StorageBridge {
  freeSpace(): Promise<number | null>
  measure(): Promise<StorageOverview>
  children(location: StorageLocation, limit?: number): Promise<StorageDirectory>
  reveal(location?: StorageLocation): Promise<StorageAction>
  clearCache(): Promise<CacheClearReply>
  watchCacheClear(
    onState: (state: CacheClearState | null) => void,
    onError: (error: unknown) => void,
  ): () => void
  pruneBackups(): Promise<StorageAction>
  /** Removes those of these worker folders, by name, that are still finished work. */
  removeFinished(names: readonly string[]): Promise<StorageRemoval>
}
export const STORAGE_CHANNELS = {
  freeSpace: 'storage:free-space',
  measure: 'storage:measure',
  children: 'storage:children',
  reveal: 'storage:reveal',
  clearCache: 'storage:clear-cache',
  pruneBackups: 'storage:prune-backups',
  removeFinished: 'storage:remove-finished',
  watchCacheClear: 'storage:watch-cache-clear',
  unwatchCacheClear: 'storage:unwatch-cache-clear',
  cacheClearChanged: 'storage:cache-clear-changed',
} as const

/** A worker folder is named after the piece it was made for. */
export const FINISHED_WORK_NAME = /^work_[a-z0-9-]{36}$/u

/** How many children a read gives: ten by default, or every one. */
export function isStorageLimit(value: unknown): value is number {
  return value === Infinity || (Number.isSafeInteger(value) && (value as number) > 0)
}

export function isStorageLocation(value: unknown): value is StorageLocation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return (
    Object.keys(input).every((key) => key === 'part' || key === 'segments') &&
    STORAGE_PART_IDS.includes(input.part as StoragePartId) &&
    Array.isArray(input.segments) &&
    input.segments.length <= 64 &&
    input.segments.every(
      (segment: unknown) =>
        typeof segment === 'string' &&
        segment.length > 0 &&
        segment.length <= 255 &&
        segment !== '.' &&
        segment !== '..' &&
        !/[\\/:]/u.test(segment) &&
        !Array.from(segment).some((character) => character.charCodeAt(0) < 32) &&
        !/[. ]$/u.test(segment) &&
        !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(segment),
    )
  )
}
