import Database from 'better-sqlite3'
import { AsyncLocalStorage } from 'node:async_hooks'
import { statSync } from 'node:fs'
import { PluginStateError, refuseState } from './format'

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
/** Ordinary SQLite write serialization, shared by callers opening the same file. */
export class PluginFence {
  private refs = 1
  private readonly context = new AsyncLocalStorage<symbol>()
  private active: Lease | null = null
  private readonly waiting: Waiting[] = []
  private closed = false
  private constructor(
    private readonly identity: string,
    private readonly db: Database.Database,
  ) {}

  static acquire(path: string, existingOnly = false): PluginFence {
    let identity: string | undefined
    try {
      const stat = statSync(path, { bigint: true })
      identity = `${stat.dev}:${stat.ino}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
    }
    const existing = identity ? holders.get(identity) : undefined
    if (existing) {
      existing.refs++
      return existing
    }
    const db = new Database(path, { timeout: 0, fileMustExist: existingOnly })
    try {
      const stat = statSync(path, { bigint: true })
      identity = `${stat.dev}:${stat.ino}`
      const holder = new PluginFence(identity, db)
      holders.set(identity, holder)
      return holder
    } catch (error) {
      db.close()
      throw error
    }
  }
  check(_path: string): void {
    void _path
    if (this.closed) refuseState('conflict')
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
    holders.delete(this.identity)
    this.db.close()
    this.closed = true
    this.context.disable()
  }
}
