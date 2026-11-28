import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { stageAtomicWriteSync, writeAtomicallySync } from '@brobot2/runtime/atomic-write'
import { openDirectoryNotThroughALink, realPath, syncDirectory } from '../private-files'
import { PluginFence } from './fence'
import { PluginStateError, refuseState, STATE_FILE } from './format'
import { readJournal } from './journal'
import { decodeStateFile, encodeStateFile, newLifecycle, type LifecycleState } from './machine'

export interface PluginDiskOptions {
  /** Explicit global plugin root. There is deliberately no workspace/live-root fallback. */
  root: string
  workspaceRoots: readonly string[]
  /** Fault seam for fictional-root tests: the new state is written but not yet in place, or in place. */
  fault?: (point: 'staged' | 'published') => void
}
/**
 * Written next to the old journal once its migration is done. Older builds refuse any name in
 * this folder that is not an operation id, so an older app stops with "Plugin recovery is
 * required" instead of acting on the journal as it was on the day of the migration.
 */
export const MOVED_MARKER = 'moved-to-plugin-state'

function unsafe(error: unknown): PluginStateError {
  return error instanceof PluginStateError ? error : new PluginStateError('unsafe-path')
}
/** The state stays out of every workspace, so no workspace backup or restore carries it. */
function checkedRoot(options: PluginDiskOptions, create: boolean): string {
  if (!isAbsolute(options.root)) refuseState('unsafe-path')
  const root = resolve(options.root),
    parent = dirname(root)
  if (realPath(parent) !== parent) refuseState('unsafe-path')
  const workspaces = options.workspaceRoots.map((path) =>
    lstatSync(realPath(path), { bigint: true }),
  )
  // Physical ancestry, so a differently cased spelling of a workspace is still found.
  for (let at = create ? parent : realPath(root); workspaces.length > 0;) {
    const stat = lstatSync(at, { bigint: true })
    if (workspaces.some((one) => one.dev === stat.dev && one.ino === stat.ino))
      refuseState('unsafe-path')
    const above = dirname(at)
    if (above === at) break
    at = above
  }
  return root
}

/** The plugin service's one state file, written atomically by its one writer. */
export class PluginStateDisk {
  #state: LifecycleState | undefined
  private fence: PluginFence | undefined
  private readonly path: string
  private readonly lock: string
  private constructor(
    private readonly root: string,
    private readonly fault: PluginDiskOptions['fault'],
  ) {
    this.path = join(root, STATE_FILE)
    this.lock = join(root, 'writer-lock.sqlite')
    this.fence = PluginFence.acquire(this.lock)
  }
  static create(options: PluginDiskOptions): PluginStateDisk {
    let root: string
    try {
      root = checkedRoot(options, true)
      mkdirSync(root, { mode: 0o700 })
      const parent = openDirectoryNotThroughALink(dirname(root))
      try {
        syncDirectory(parent)
      } finally {
        closeSync(parent)
      }
    } catch (error) {
      throw unsafe(error)
    }
    return PluginStateDisk.opened(root, options, (file) =>
      file.write(newLifecycle(randomUUID(), randomUUID())),
    )
  }
  /** Reads the state file, or migrates the old journal once when there is none yet. */
  static open(options: PluginDiskOptions): PluginStateDisk {
    let root: string
    try {
      root = checkedRoot(options, false)
    } catch (error) {
      throw unsafe(error)
    }
    return PluginStateDisk.opened(root, options, (file) => file.readOrMigrate())
  }
  private static opened(
    root: string,
    options: PluginDiskOptions,
    first: (file: PluginStateDisk) => void,
  ): PluginStateDisk {
    let file: PluginStateDisk
    try {
      file = new PluginStateDisk(root, options.fault)
    } catch (error) {
      throw unsafe(error)
    }
    try {
      file.exclusive(() => first(file))
      return file
    } catch (error) {
      file.close()
      throw error
    }
  }
  private onDisk(): LifecycleState | undefined {
    let bytes: Buffer
    try {
      bytes = readFileSync(this.path)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
    return decodeStateFile(bytes)
  }
  private readOrMigrate(): void {
    const guard = join(this.root, 'lifecycle-guard'),
      reservations = join(this.root, 'resolution-reservations'),
      marker = join(reservations, MOVED_MARKER)
    const current = this.onDisk()
    if (current) this.#state = current
    else {
      // The marker means the migration finished, so the journal is stale: never rebuild from it.
      if (existsSync(marker)) refuseState('missing-guard')
      // A crash before the state file is in place leaves the journal untouched and current, so
      // the next start migrates again.
      this.write(readJournal(guard))
    }
    // Written after the state file, so a crash between the two leaves a journal that is still
    // current, and the next start finishes here.
    if (existsSync(guard) && !existsSync(marker)) {
      mkdirSync(reservations, { recursive: true, mode: 0o700 })
      writeAtomicallySync(
        marker,
        'The plugin state moved to ../plugin-state.json. Older apps stop here.\n',
      )
    }
  }
  /** Under the writer fence. A copy that changed the file since this one read it wins. */
  private write(next: LifecycleState): void {
    const bytes = encodeStateFile(next)
    if (this.#state && this.onDisk()?.sequence !== this.#state.sequence) refuseState('conflict')
    const stage = stageAtomicWriteSync(this.path, bytes)
    try {
      this.fault?.('staged')
      stage.commit()
    } catch (error) {
      // The rename can land before a later step fails: hold whatever is on disk now.
      try {
        this.#state = this.onDisk()
      } catch {
        this.#state = undefined
      }
      throw error
    } finally {
      stage.discard()
    }
    this.#state = next
    this.fault?.('published')
  }
  private held(): LifecycleState {
    if (!this.#state) return refuseState('unsafe-path')
    return this.#state
  }
  private exclusive<T>(run: () => T): T {
    try {
      if (!this.fence) refuseState('unsafe-path')
      const fence = this.fence
      return fence.sync(this, () => {
        fence.check(this.lock)
        return run()
      })
    } catch (error) {
      throw error instanceof PluginStateError ? error : new PluginStateError('corrupt')
    }
  }
  async withExclusive<T>(run: () => Promise<T>): Promise<T> {
    try {
      if (!this.fence) refuseState('unsafe-path')
      const fence = this.fence
      return await fence.async(this, async () => {
        fence.check(this.lock)
        return run()
      })
    } catch (error) {
      throw error instanceof PluginStateError ? error : new PluginStateError('corrupt')
    }
  }
  load(): LifecycleState {
    return this.exclusive(() => structuredClone(this.held()))
  }
  /** Admission reads between the owner's awaits, without taking its writer lock. */
  loadForAdmission(): LifecycleState {
    return structuredClone(this.held())
  }
  /** Replaces the state the caller read with the next one, one sequence later. */
  update(previous: LifecycleState, next: LifecycleState): void {
    this.exclusive(() => {
      if (previous.sequence !== this.held().sequence) refuseState('conflict')
      this.write({ ...next, sequence: previous.sequence + 1 })
    })
  }
  close(): void {
    this.#state = undefined
    this.fence?.release()
    this.fence = undefined
  }
}
