import Database from 'better-sqlite3'
import { AsyncLocalStorage } from 'node:async_hooks'
import { isMainThread } from 'node:worker_threads'
import { closeSync, constants, fstatSync, lstatSync, openSync, type BigIntStats } from 'node:fs'
import { PluginStateError, refuseState, STATE_LIMITS } from './format'
import { isPrivateEntry } from '../private-files'

interface Lease {
  owner: object
  token: symbol
}
interface Waiting {
  owner: object
  run: () => Promise<void>
}

// Shared even if another bundle loads a second copy of this module in the same isolate.
declare global {
  var __brobotPluginStateFencesV1: Map<string, PluginFence> | undefined
}
const holders = (globalThis.__brobotPluginStateFencesV1 ??= new Map<string, PluginFence>())
const identity = (stat: BigIntStats) => `${stat.dev}:${stat.ino}`
function file(stat: BigIntStats): void {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1n ||
    !isPrivateEntry(stat) ||
    stat.size > BigInt(STATE_LIMITS.recordBytes)
  )
    refuseState('unsafe-path')
}

/** Exactly one raw descriptor and one SQLite connection for this inode in this process. */
export class PluginFence {
  private refs = 1
  private readonly context = new AsyncLocalStorage<symbol>()
  private active: Lease | null = null
  private readonly waiting: Waiting[] = []
  private closed = false
  private constructor(
    private readonly fd: number,
    private readonly stat: BigIntStats,
    private readonly db: Database.Database,
  ) {}

  static acquire(path: string, existingOnly = false): PluginFence {
    if (!isMainThread) refuseState('unsupported')
    let before: BigIntStats | undefined
    try {
      before = lstatSync(path, { bigint: true })
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    if (before) {
      file(before)
      const existing = holders.get(identity(before))
      if (existing) {
        existing.check(path)
        existing.refs++
        return existing
      }
    }
    if (existingOnly && !before) refuseState('unsafe-path')
    // No other holder exists here. Main-thread acquisition has no await/re-entrant callback.
    // Without O_NOFOLLOW (Windows) the open follows a link; the lstat after it refuses one.
    const fd = openSync(
      path,
      constants.O_RDWR | (existingOnly ? 0 : constants.O_CREAT) | constants.O_NOFOLLOW,
      0o600,
    )
    let db: Database.Database | undefined
    try {
      const stat = fstatSync(fd, { bigint: true })
      file(stat)
      if (
        (before && identity(before) !== identity(stat)) ||
        identity(lstatSync(path, { bigint: true })) !== identity(stat)
      )
        refuseState('unsafe-path')
      db = new Database(path, { timeout: 0, fileMustExist: true })
      const holder = new PluginFence(fd, stat, db)
      holder.check(path)
      holders.set(identity(stat), holder)
      return holder
    } catch (error) {
      db?.close()
      closeSync(fd)
      throw error
    }
  }
  check(path: string): void {
    if (this.closed) refuseState('unsafe-path')
    const now = lstatSync(path, { bigint: true }),
      held = fstatSync(this.fd, { bigint: true })
    file(now)
    file(held)
    if (identity(now) !== identity(this.stat) || identity(held) !== identity(this.stat))
      refuseState('unsafe-path')
  }
  private nested(owner: object): boolean {
    return this.active?.owner === owner && this.context.getStore() === this.active.token
  }
  private begin(owner: object): Lease {
    if (this.closed) refuseState('unsafe-path')
    try {
      this.db.exec('BEGIN EXCLUSIVE')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'SQLITE_BUSY')
        refuseState('busy')
      throw new PluginStateError('corrupt')
    }
    const lease = { owner, token: Symbol() }
    this.active = lease
    return lease
  }
  private end(): void {
    try {
      this.db.exec('ROLLBACK')
    } catch {
      throw new PluginStateError('corrupt')
    } finally {
      this.active = null
      this.drain()
      this.disposeIfUnused()
    }
  }
  sync<T>(owner: object, run: () => T): T {
    if (this.nested(owner)) return run()
    if (this.active || this.waiting.length > 0) refuseState('busy')
    const lease = this.begin(owner)
    try {
      return this.context.run(lease.token, run)
    } finally {
      this.end()
    }
  }
  async async<T>(owner: object, run: () => Promise<T>): Promise<T> {
    if (this.nested(owner)) return run()
    // Waiting for a different owner from inside this lease would deadlock its own release.
    if (this.active && this.context.getStore() === this.active.token) refuseState('busy')
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({
        owner,
        run: async () => {
          try {
            const lease = this.begin(owner)
            let result: T
            try {
              result = await this.context.run(lease.token, run)
            } finally {
              this.end()
            }
            resolve(result)
          } catch (error) {
            reject(error)
          }
        },
      })
      this.drain()
    })
  }
  private drain(): void {
    if (this.active) return
    const next = this.waiting.shift()
    if (next) {
      void next.run().finally(() => {
        this.drain()
        this.disposeIfUnused()
      })
    }
  }
  release(): void {
    this.refs--
    this.disposeIfUnused()
  }
  private disposeIfUnused(): void {
    if (this.refs !== 0 || this.active || this.waiting.length > 0 || this.closed) return
    holders.delete(identity(this.stat))
    // SQLite must close before our raw descriptor; no other SQLite/raw holder remains.
    this.db.close()
    closeSync(this.fd)
    this.closed = true
    this.context.disable()
  }
}
