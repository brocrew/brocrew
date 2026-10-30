import { lstat, opendir, realpath, statfs } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { providerConversationDirectories } from '../providers/conversation-layout'
import {
  STORAGE_PART_IDS,
  isStorageLocation,
  type StorageDirectory,
  type StorageError,
  type StorageEntry,
  type StorageLocation,
  type StorageOverview,
  type StoragePart,
  type StoragePartId,
} from '../../shared/storage'

export interface StorageRoots {
  readonly data: string
  readonly workspace: string
  readonly providers: string
  readonly output: string
  readonly database: readonly string[]
  readonly backups: readonly string[]
  readonly recovery?: string
  readonly plugins: string | null
  readonly cache: string | null
  readonly resources: string
}
export type StorageRequest =
  | { readonly kind: 'measure' }
  | { readonly kind: 'children'; readonly location: StorageLocation }
  | { readonly kind: 'reveal'; readonly location?: StorageLocation }
export type StorageReply = StorageOverview | StorageDirectory | { readonly path: string }
export const STORAGE_BOUNDS = { entries: 100_000, depth: 64, milliseconds: 10_000 } as const

export class StorageFailure extends Error {
  constructor(readonly reason: StorageError) {
    super(reason)
  }
}
export const storageReason = (error: unknown): StorageError =>
  error instanceof StorageFailure ? error.reason : 'unavailable'
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'
export function insideData(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/** This engine runs in a disposable worker. It never reads file contents or follows links. */
export class StorageEngine {
  private visited = 0
  private readonly started = performance.now()
  private canonicalData = ''
  constructor(
    private readonly roots: StorageRoots,
    private readonly bounds: {
      entries: number
      depth: number
      milliseconds: number
    } = STORAGE_BOUNDS,
    private readonly cancelled: () => boolean = () => false,
  ) {}

  private checkpoint(): void {
    if (this.cancelled()) throw new StorageFailure('cancelled')
    if (
      ++this.visited > this.bounds.entries ||
      performance.now() - this.started > this.bounds.milliseconds
    )
      throw new StorageFailure('limit')
  }

  private async initialise(): Promise<void> {
    const stat = await lstat(this.roots.data)
    if (stat.isSymbolicLink()) throw new StorageFailure('linked-path')
    if (!stat.isDirectory()) throw new StorageFailure('not-directory')
    this.canonicalData = await realpath(this.roots.data)
  }

  private boundary(path: string, part?: StoragePartId): string {
    if (insideData(this.roots.data, path)) return this.roots.data
    if (insideData(this.canonicalData, path)) return this.canonicalData
    const trusted = part === 'plugins' ? [this.roots.plugins] : []
    const root = trusted.find((candidate) => candidate !== null && insideData(candidate, path))
    if (!root) throw new StorageFailure('outside-data')
    return root
  }

  /** Check every component below a host-resolved root; never follow a link encountered there. */
  private async checked(path: string, part?: StoragePartId): Promise<string> {
    this.checkpoint()
    const root = this.boundary(path, part)
    const rel = relative(resolve(root), resolve(path))
    let at = root === this.roots.data ? this.canonicalData : resolve(root)
    const rootStat = await lstat(at)
    if (rootStat.isSymbolicLink()) throw new StorageFailure('linked-path')
    const canonicalRoot = await realpath(at)
    at = canonicalRoot
    for (const segment of rel ? rel.split(sep) : []) {
      at = join(at, segment)
      const stat = await lstat(at)
      if (stat.isSymbolicLink()) throw new StorageFailure('linked-path')
    }
    const actual = await realpath(at)
    if (!insideData(canonicalRoot, actual)) throw new StorageFailure('outside-data')
    return actual
  }

  private paths(part: StoragePartId): readonly string[] {
    switch (part) {
      case 'workspace':
        return [this.roots.workspace]
      case 'provider-conversations':
        return [this.roots.providers]
      case 'agent-output':
        return [this.roots.output]
      case 'database':
        return this.roots.database
      case 'backups':
        return this.roots.backups
      case 'plugins':
        if (this.roots.plugins === null) throw new StorageFailure('unavailable')
        return [this.roots.plugins]
      case 'cache':
        if (this.roots.cache === null) throw new StorageFailure('unavailable')
        return [this.roots.cache]
      case 'app-resources':
        return [this.roots.resources]
    }
  }

  private allowed(part: StoragePartId, segments: readonly string[]): boolean {
    if (part !== 'provider-conversations') return true
    if (segments.length >= 1 && segments[0] !== 'default') return false
    if (segments.length < 3) return true
    const directories = providerConversationDirectories.get(segments[2]!)
    return directories !== undefined && (segments.length < 4 || directories.includes(segments[3]!))
  }

  private async size(
    path: string,
    part: StoragePartId,
    segments: readonly string[],
    state: { error?: StorageError },
  ): Promise<number> {
    let bytes = 0
    if (segments.length > this.bounds.depth) {
      state.error = 'limit'
      return 0
    }
    try {
      const safe = await this.checked(path, part)
      const stat = await lstat(safe)
      if (stat.isFile()) return stat.size
      if (!stat.isDirectory()) {
        state.error ??= 'unavailable'
        return 0
      }
      const directory = await opendir(safe)
      for await (const entry of directory) {
        this.checkpoint()
        const child = [...segments, entry.name]
        if (!this.allowed(part, child)) continue
        bytes += await this.size(join(path, entry.name), part, child, state)
      }
      return bytes
    } catch (error) {
      if (missing(error)) return 0
      if (storageReason(error) === 'cancelled') throw error
      if (storageReason(error) === 'limit') {
        state.error = 'limit'
        return bytes
      }
      state.error ??= storageReason(error)
      return 0
    }
  }

  private virtual(part: StoragePartId): boolean {
    return part === 'database' || part === 'backups'
  }

  private groupedPaths(part: StoragePartId): { name: string; path: string }[] {
    const names = new Set<string>()
    return this.paths(part).map((path) => {
      const base = basename(path)
      let name = base
      let ordinal = 1
      while (names.has(name)) name = `${base} (${++ordinal})`
      names.add(name)
      return { name, path }
    })
  }

  private async emptyRecovery(path: string, safe: string): Promise<boolean> {
    if (this.roots.recovery === undefined || resolve(path) !== resolve(this.roots.recovery))
      return false
    this.checkpoint()
    const directory = await opendir(safe)
    try {
      return (await directory.read()) === null
    } finally {
      await directory.close()
    }
  }

  private locationPath(location: StorageLocation): string {
    if (!isStorageLocation(location) || !this.allowed(location.part, location.segments))
      throw new StorageFailure('invalid-location')
    const paths = this.paths(location.part)
    if (this.virtual(location.part)) {
      const [first, ...rest] = location.segments
      const base = this.groupedPaths(location.part).find((entry) => entry.name === first)?.path
      if (!base || (location.part === 'database' && rest.length))
        throw new StorageFailure('invalid-location')
      return join(base, ...rest)
    }
    return join(paths[0]!, ...location.segments)
  }

  async measure(): Promise<StorageOverview> {
    const parts: StoragePart[] = []
    let freeBytes: number | null = null
    try {
      await this.initialise()
      try {
        const fs = await statfs(this.canonicalData)
        freeBytes = fs.bavail * fs.bsize
      } catch {
        // Individual parts can still be measured when the filesystem has no free-space reading.
      }
      for (const id of STORAGE_PART_IDS) {
        let bytes = 0
        const state: { error?: StorageError } = {}
        try {
          for (const path of this.paths(id)) bytes += await this.size(path, id, [], state)
          parts.push({
            id,
            bytes: state.error && bytes === 0 ? null : bytes,
            partial: state.error !== undefined,
            ...state,
          })
        } catch (error) {
          parts.push({ id, bytes: bytes || null, partial: true, error: storageReason(error) })
        }
      }
      return {
        totalBytes: parts.reduce((n, part) => n + (part.bytes ?? 0), 0),
        freeBytes,
        measuredAt: Date.now(),
        parts,
        partial: freeBytes === null || parts.some((part) => part.partial),
      }
    } catch (error) {
      return { ...failedOverview(storageReason(error)), freeBytes }
    }
  }

  async children(location: StorageLocation): Promise<StorageDirectory> {
    const empty = {
      location,
      entries: [],
      smallerCount: 0,
      smallerBytes: 0,
      totalBytes: 0,
      partial: true,
    }
    try {
      if (!isStorageLocation(location)) throw new StorageFailure('invalid-location')
      await this.initialise()
      const candidates: { name: string; path: string; segments: readonly string[] }[] = []
      if (this.virtual(location.part) && location.segments.length === 0) {
        for (const entry of this.groupedPaths(location.part))
          candidates.push({ ...entry, segments: [] })
      } else {
        const path = this.locationPath(location)
        const safe = await this.checked(path, location.part)
        if (!(await lstat(safe)).isDirectory()) throw new StorageFailure('not-directory')
        const directory = await opendir(safe)
        for await (const entry of directory) {
          this.checkpoint()
          const segments = [...location.segments, entry.name]
          if (this.allowed(location.part, segments))
            candidates.push({ name: entry.name, path: join(path, entry.name), segments })
        }
      }
      const entries: StorageEntry[] = []
      const state: { error?: StorageError } = {}
      for (const entry of candidates) {
        try {
          const safe = await this.checked(entry.path, location.part)
          const stat = await lstat(safe)
          if (!stat.isFile() && !stat.isDirectory()) {
            state.error ??= 'unavailable'
            continue
          }
          if (
            location.part === 'backups' &&
            location.segments.length === 0 &&
            stat.isDirectory() &&
            (await this.emptyRecovery(entry.path, safe))
          )
            continue
          const bytes = await this.size(entry.path, location.part, entry.segments, state)
          entries.push({ name: entry.name, bytes, isDirectory: stat.isDirectory() })
        } catch (error) {
          if (storageReason(error) === 'linked-path') {
            entries.push({ name: entry.name, bytes: null, isDirectory: false, isLink: true })
          }
          if (!missing(error)) state.error ??= storageReason(error)
          if (state.error === 'limit' || state.error === 'cancelled') break
        }
      }
      entries.sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1) || a.name.localeCompare(b.name))
      return {
        location,
        entries: entries.slice(0, 10),
        smallerCount: Math.max(0, entries.length - 10),
        smallerBytes: entries.slice(10).reduce((n, entry) => n + (entry.bytes ?? 0), 0),
        totalBytes: entries.reduce((n, entry) => n + (entry.bytes ?? 0), 0),
        partial: state.error !== undefined,
        ...state,
      }
    } catch (error) {
      return { ...empty, error: storageReason(error) }
    }
  }

  async reveal(location?: StorageLocation): Promise<{ path: string }> {
    if (location && !isStorageLocation(location)) throw new StorageFailure('invalid-location')
    await this.initialise()
    if (location && this.virtual(location.part) && location.segments.length === 0) {
      for (const path of this.paths(location.part)) {
        try {
          const safe = await this.checked(path, location.part)
          const stat = await lstat(safe)
          if (
            location.part === 'backups' &&
            stat.isDirectory() &&
            (await this.emptyRecovery(path, safe))
          )
            continue
          if (location.part === 'database' ? stat.isFile() : stat.isDirectory())
            return { path: safe }
        } catch (error) {
          if (!missing(error)) throw error
        }
      }
      throw new StorageFailure('unavailable')
    }
    return {
      path: await this.checked(
        location ? this.locationPath(location) : this.roots.data,
        location?.part,
      ),
    }
  }
}

export function failedOverview(error: StorageError): StorageOverview {
  return {
    totalBytes: 0,
    freeBytes: null,
    measuredAt: Date.now(),
    parts: STORAGE_PART_IDS.map((id) => ({ id, bytes: null, partial: true, error })),
    partial: true,
    error,
  }
}
