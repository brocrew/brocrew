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
export type StorageEntry = { readonly name: string } & (
  | { readonly bytes: number; readonly isDirectory: boolean; readonly isLink?: false }
  | { readonly bytes: null; readonly isDirectory: false; readonly isLink: true }
)
export interface StorageDirectory {
  readonly location: StorageLocation
  /** At most ten immediate children, descending by recursively measured bytes. */
  readonly entries: readonly StorageEntry[]
  readonly smallerCount: number
  readonly smallerBytes: number
  readonly totalBytes: number
  readonly partial: boolean
  readonly error?: StorageError
}
export type StorageAction =
  { readonly ok: true } | { readonly ok: false; readonly error: StorageError }
export interface StorageBridge {
  measure(): Promise<StorageOverview>
  children(location: StorageLocation): Promise<StorageDirectory>
  reveal(location?: StorageLocation): Promise<StorageAction>
  clearCache(): Promise<StorageAction>
}
export const STORAGE_CHANNELS = {
  measure: 'storage:measure',
  children: 'storage:children',
  reveal: 'storage:reveal',
  clearCache: 'storage:clear-cache',
} as const

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
