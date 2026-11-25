import { isInside as insideData } from '@brobot2/shared/paths'
import { lstat, opendir, realpath, statfs } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import {
  isAProfilesWork,
  isProviderHistory,
  mayHoldAProfilesWork,
  mayHoldProviderHistory,
} from '../providers/workspace-layout.mjs'
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

/** The data folder's folder of per-piece output folders, made by earlier versions of the app. */
export const WORKER_OUTPUT_DIRNAME = 'worker-output'

export interface StorageRoots {
  readonly data: string
  readonly workspace: string
  readonly providers: string
  readonly output: string
  readonly database: readonly string[]
  readonly backups: readonly string[]
  readonly recovery?: string
  readonly plugins: string | null
  readonly sharedPlugins?: string | null
  readonly cache: string | null
  readonly resources: string
}
export type StorageRequest =
  | { readonly kind: 'measure' }
  | { readonly kind: 'children'; readonly location: StorageLocation }
  | { readonly kind: 'reveal'; readonly location?: StorageLocation }
export type StorageReply = StorageOverview | StorageDirectory | { readonly path: string }
type StorageRoot = { path: string; part: StoragePartId; segments: readonly string[] }
/**
 * A size is never worth walking a whole tree: every entry visited is file-system work, and an
 * on-access scanner repeats it. Each part, or each row of an opened folder, takes at most
 * `entries` steps (about two for each file or folder it visits), and one request at most `total`.
 * A size cut short is reported as partial.
 */
const STORAGE_BOUNDS = { entries: 10_000, total: 50_000, depth: 64 } as const
/** A worker that reports no progress for this long is judged stalled; a slow walk that keeps reporting is not. */
export const STORAGE_STALL_TIMEOUT = 15_000

export class StorageFailure extends Error {
  constructor(readonly reason: StorageError) {
    super(reason)
  }
}
export const storageReason = (error: unknown): StorageError =>
  error instanceof StorageFailure ? error.reason : 'unavailable'
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'

export async function storageFreeBytes(path: string): Promise<number | null> {
  try {
    const fs = await statfs(path)
    return fs.bavail * fs.bsize
  } catch {
    return null
  }
}

/** This engine runs in a disposable worker. It never reads file contents or follows links. */
export class StorageEngine {
  private visited = 0
  private spent = 0
  private canonicalData = ''
  constructor(
    private readonly roots: StorageRoots,
    private readonly bounds: {
      entries: number
      total: number
      depth: number
    } = STORAGE_BOUNDS,
    private readonly cancelled: () => boolean = () => false,
    private readonly progressed: () => void = () => {},
  ) {}

  private checkpoint(): void {
    if (this.cancelled()) throw new StorageFailure('cancelled')
    this.visited++
    this.spent++
    if (this.exhausted()) throw new StorageFailure('limit')
    this.progressed()
  }

  private exhausted(): boolean {
    return this.visited > this.bounds.entries || this.spent > this.bounds.total
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
    const trusted = part === 'plugins' ? [this.roots.plugins, this.roots.sharedPlugins] : []
    const root = trusted.find((candidate) => candidate != null && insideData(candidate, path))
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
      // The old shared workspace where it still exists, and each profile's own home.
      case 'workspace':
        return [this.roots.workspace, this.roots.providers]
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
        return [this.roots.plugins, ...(this.roots.sharedPlugins ? [this.roots.sharedPlugins] : [])]
      case 'cache':
        if (this.roots.cache === null) throw new StorageFailure('unavailable')
        return [this.roots.cache]
      case 'app-resources':
        return [this.roots.resources]
    }
  }

  /** Whether a folder is walked into, or a file counted (`asAFile`), for a part. */
  private allowed(part: StoragePartId, segments: readonly string[], asAFile = false): boolean {
    if (part === 'workspace') {
      // Below the provider homes, only a profile's own work: its provider homes are counted elsewhere.
      const homes = this.groupedPaths('workspace')[1]!.name
      if (segments[0] !== homes) return true
      return (asAFile ? isAProfilesWork : mayHoldAProfilesWork)(segments.slice(1))
    }
    if (part !== 'provider-conversations') return true
    return (asAFile ? isProviderHistory : mayHoldProviderHistory)(segments)
  }

  /** A part of several roots names each by its group, which is not a level of the folders walked. */
  private depthOf(part: StoragePartId, segments: readonly string[]): number {
    return this.virtual(part) ? Math.max(0, segments.length - 1) : segments.length
  }

  private countedByEarlierRoot(path: string, roots: readonly StorageRoot[]): boolean {
    return roots.some((root) => {
      if (!insideData(root.path, path)) return false
      const rel = relative(root.path, path)
      return this.allowed(root.part, [...root.segments, ...(rel ? rel.split(sep) : [])], true)
    })
  }

  private async size(
    path: string,
    part: StoragePartId,
    segments: readonly string[],
    state: { error?: StorageError },
    checkedParent = false,
    earlierRoots: readonly StorageRoot[] = [],
    rootState?: { started: boolean },
  ): Promise<number> {
    let bytes = 0
    let enumerating = false
    if (this.depthOf(part, segments) > this.bounds.depth) {
      state.error = 'limit'
      return 0
    }
    try {
      this.checkpoint()
      const safe = checkedParent ? path : await this.checked(path, part)
      const stat = await lstat(safe)
      if (stat.isSymbolicLink()) throw new StorageFailure('linked-path')
      const actual = await realpath(safe)
      if (!insideData(safe, actual)) throw new StorageFailure('outside-data')
      if (stat.isFile()) {
        if (rootState) rootState.started = true
        if (!this.allowed(part, segments, true)) return 0
        return this.countedByEarlierRoot(actual, earlierRoots) ? 0 : stat.size
      }
      if (!stat.isDirectory()) {
        state.error ??= 'unavailable'
        return 0
      }
      const directory = await opendir(actual)
      if (rootState) rootState.started = true
      enumerating = true
      for await (const entry of directory) {
        this.checkpoint()
        const child = [...segments, entry.name]
        if (!this.allowed(part, child)) continue
        bytes += await this.size(join(actual, entry.name), part, child, state, true, earlierRoots)
        if (this.exhausted()) break
      }
      return bytes
    } catch (error) {
      if (missing(error) && !enumerating) return 0
      if (storageReason(error) === 'cancelled') throw error
      if (storageReason(error) === 'limit') {
        state.error = 'limit'
        return bytes
      }
      state.error ??= storageReason(error)
      return bytes
    }
  }

  private virtual(part: StoragePartId): boolean {
    return (
      part === 'workspace' ||
      part === 'database' ||
      part === 'backups' ||
      (part === 'plugins' && !!this.roots.sharedPlugins)
    )
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
    const earlierRoots: StorageRoot[] = []
    let freeBytes: number | null = null
    try {
      await this.initialise()
      freeBytes = await storageFreeBytes(this.canonicalData)
      for (const id of STORAGE_PART_IDS) {
        let bytes = 0
        const state: { error?: StorageError } = {}
        try {
          // A part of several roots names each by its group, as its disclosure does.
          const roots = this.virtual(id)
            ? this.groupedPaths(id).map(({ name, path }) => ({ path, segments: [name] }))
            : this.paths(id).map((path) => ({ path, segments: [] }))
          for (const { path, segments } of roots) {
            // A large or slow root must not spend the budget of every later one.
            this.visited = 0
            try {
              const safe = await this.checked(path, id)
              const rootState = { started: false }
              bytes += await this.size(safe, id, segments, state, true, earlierRoots, rootState)
              if (rootState.started) earlierRoots.push({ path: safe, part: id, segments })
            } catch (error) {
              if (missing(error)) continue
              if (storageReason(error) === 'cancelled') throw error
              state.error ??= storageReason(error)
            }
          }
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
      const entries: StorageEntry[] = []
      let smallerCount = 0
      let smallerBytes = 0
      const state: { error?: StorageError } = {}
      const keep = (entry: StorageEntry): void => {
        entries.push(entry)
        entries.sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1) || a.name.localeCompare(b.name))
        if (entries.length > 10) {
          const smaller = entries.pop()!
          smallerCount++
          smallerBytes += smaller.bytes ?? 0
        }
      }
      const include = async (entry: {
        name: string
        path: string
        segments: readonly string[]
      }): Promise<boolean> => {
        try {
          const safe = await this.checked(entry.path, location.part)
          const stat = await lstat(safe)
          if (!stat.isFile() && !stat.isDirectory()) {
            state.error ??= 'unavailable'
            return true
          }
          if (stat.isFile() && !this.allowed(location.part, entry.segments, true)) return true
          if (
            location.part === 'backups' &&
            location.segments.length === 0 &&
            stat.isDirectory() &&
            (await this.emptyRecovery(entry.path, safe))
          )
            return true
          const row: { error?: StorageError } = {}
          const bytes = await this.size(entry.path, location.part, entry.segments, row)
          if (row.error) state.error ??= row.error
          keep({
            name: entry.name,
            bytes,
            isDirectory: stat.isDirectory(),
            ...(row.error ? { partial: true as const } : {}),
          })
        } catch (error) {
          const reason = storageReason(error)
          if (reason === 'cancelled') throw error
          if (reason === 'linked-path') {
            keep({ name: entry.name, bytes: null, isDirectory: false, isLink: true })
          }
          if (!missing(error)) state.error ??= reason
          if (reason === 'limit') return false
        }
        return true
      }
      // Each row gets the same budget, as each root of a part does in a measure.
      if (this.virtual(location.part) && location.segments.length === 0) {
        for (const entry of this.groupedPaths(location.part)) {
          this.visited = 0
          if (!(await include({ ...entry, segments: [entry.name] }))) break
        }
      } else {
        const path = this.locationPath(location)
        const safe = await this.checked(path, location.part)
        if (!(await lstat(safe)).isDirectory()) throw new StorageFailure('not-directory')
        const directory = await opendir(safe)
        try {
          for await (const entry of directory) {
            this.visited = 0
            this.checkpoint()
            const segments = [...location.segments, entry.name]
            if (
              this.allowed(location.part, segments) &&
              !(await include({ name: entry.name, path: join(path, entry.name), segments }))
            )
              break
          }
        } catch (error) {
          if (storageReason(error) === 'cancelled') throw error
          state.error ??= storageReason(error)
        }
      }
      return {
        location,
        entries,
        smallerCount,
        smallerBytes,
        totalBytes: smallerBytes + entries.reduce((n, entry) => n + (entry.bytes ?? 0), 0),
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

export { insideData }
