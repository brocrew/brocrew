import type { AppDatabase } from './connection'
import type { TranscriptEvent } from '../../shared/runtime-ipc'

/**
 * What a committed row says to the readers that keep something of it: its place, its type and the
 * few fields that move another conversation's state. Taken from the event as it is written, never
 * read back.
 */
export interface CommittedRow {
  readonly session: string
  readonly generation: number
  readonly ordinal: number
  readonly type: TranscriptEvent['type']
  /** A status row's state. */
  readonly state?: string
  /** A routed question's parent and where it went. */
  readonly parent?: string
  readonly to?: string
  /** The piece a work row is about. */
  readonly piece?: string
  /** The conversation a replacement row names. */
  readonly replacedBy?: string
}

/** The facts of `event` a committed row carries. */
export function committedRowOf(
  session: string,
  generation: number,
  ordinal: number,
  event: TranscriptEvent,
): CommittedRow {
  const piece = (event as { readonly piece?: unknown }).piece
  return {
    session,
    generation,
    ordinal,
    type: event.type,
    ...(event.type === 'status' ? { state: event.state } : {}),
    ...(event.type === 'request_routed'
      ? { ...(event.parent === undefined ? {} : { parent: event.parent }), to: event.to }
      : {}),
    ...(typeof piece === 'string' ? { piece } : {}),
    ...(event.type === 'replaced_by' ? { replacedBy: event.sessionId } : {}),
  }
}

/** Why a session changed as a whole, without a row each. */
export type WholeChange = 'imported' | 'promoted' | 'deleted' | 'listing'

/** One outermost commit that wrote something persistent. */
export interface CommittedChange {
  readonly commit: number
  readonly resync: false
  readonly rows: readonly CommittedRow[]
  readonly whole: ReadonlyMap<string, WholeChange>
  /** Sessions a rebuild wrote into a generation nobody reads yet. */
  readonly staged: ReadonlySet<string>
  /** Files kept on a piece. */
  readonly kept: readonly { readonly piece: string; readonly resource: string }[]
}

/** What was committed can't be told: every reader starts again. */
export interface CommittedResync {
  readonly commit: number
  readonly resync: true
}

export type Committed = CommittedChange | CommittedResync

export interface CommittedChanges {
  /** Calls `listener` once per outermost commit, in commit order, after the commit. */
  listen(listener: (change: Committed) => void): () => void
  /** The rows a store door appends, recorded into the change of the commit that holds them. */
  appended(row: CommittedRow): void
  whole(session: string, why: WholeChange): void
  staged(session: string): void
  kept(piece: string, resource: string): void
  /** Runs `write` with its appends recorded as part of a whole change, not row by row. */
  asAWhole<T>(write: () => T): T
  /**
   * Compares the file's `data_version` with the last one seen: a move means another connection
   * committed, and one resync is published. Asked at the points a reader is about to answer.
   */
  check(): void
}

interface Frame {
  rows: CommittedRow[]
  whole: Map<string, WholeChange>
  staged: Set<string>
  kept: { piece: string; resource: string }[]
  poisoned: boolean
}

const frame = (): Frame => ({
  rows: [],
  whole: new Map(),
  staged: new Set(),
  kept: [],
  poisoned: false,
})

/**
 * Kept on the connection itself, so it reads the same through any proxy that forwards to it, and a
 * second store or module on the same connection finds the same recorder.
 */
const RECORDER = Symbol('committed changes')

/**
 * The record of what each commit on this connection wrote. One per raw connection, whichever
 * store or module asks for it. Every transaction made on the connection after this is installed
 * is framed: a nested one merges into its parent when it returns and is dropped when it throws,
 * and the outermost publishes once the connection has left its transaction.
 */
export function committedChangesOf(db: AppDatabase): CommittedChanges {
  const known = (db as unknown as Record<symbol, CommittedChanges | undefined>)[RECORDER]
  if (known !== undefined) return known
  // What the connection itself answers for each method, called on whichever connection a proxy
  // hands it: an own replacement installed before this one, or the prototype's.
  type Transaction = (this: AppDatabase, fn: unknown) => unknown
  const nativeTransaction =
    (Object.getOwnPropertyDescriptor(db, 'transaction')?.value as Transaction | undefined) ??
    (Object.getPrototypeOf(db) as { transaction: Transaction }).transaction

  if (db.readonly) {
    // A read-only connection never commits: nothing is patched, and nothing is published.
    const reader: CommittedChanges = {
      listen: () => () => undefined,
      appended: () => undefined,
      whole: () => undefined,
      staged: () => undefined,
      kept: () => undefined,
      asAWhole: (write) => write(),
      check: () => undefined,
    }
    Object.defineProperty(db, RECORDER, { value: reader })
    return reader
  }
  const frames: Frame[] = []
  const listeners = new Set<(change: Committed) => void>()
  const queue: Committed[] = []
  let draining = false
  let commit = 0
  let wholeDepth = 0
  let seen: number | null = null
  const dataVersion = (): number | null => {
    try {
      return db.pragma('data_version', { simple: true }) as number
    } catch {
      return null
    }
  }

  const drain = (): void => {
    if (draining) return
    draining = true
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        for (const listener of [...listeners]) {
          try {
            listener(next)
          } catch (error) {
            console.warn(
              `a listener to committed changes failed: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
      }
    } finally {
      draining = false
    }
  }

  const publish = (done: Frame): void => {
    if (done.poisoned) {
      queue.push({ commit: ++commit, resync: true })
    } else if (
      done.rows.length > 0 ||
      done.whole.size > 0 ||
      done.staged.size > 0 ||
      done.kept.length > 0
    ) {
      queue.push({
        commit: ++commit,
        resync: false,
        rows: done.rows,
        whole: done.whole,
        staged: done.staged,
        kept: done.kept,
      })
    } else return
    drain()
  }

  const merge = (into: Frame, done: Frame): void => {
    into.rows.push(...done.rows)
    for (const [session, why] of done.whole)
      if (!into.whole.has(session)) into.whole.set(session, why)
    for (const session of done.staged) into.staged.add(session)
    into.kept.push(...done.kept)
    into.poisoned ||= done.poisoned
  }

  /** Runs one transaction call inside its frame. */
  const framed = <T>(call: () => T): T => {
    const own = frame()
    frames.push(own)
    let result: T
    try {
      result = call()
    } catch (error) {
      frames.pop()
      // A savepoint SQLite itself ended took the whole transaction with it.
      if (frames.length > 0 && !db.inTransaction) for (const outer of frames) outer.poisoned = true
      // Writes made after SQLite ended it committed on their own: what they were can't be told.
      if (frames.length === 0 && own.poisoned) publish(own)
      throw error
    }
    frames.pop()
    const parent = frames.at(-1)
    if (parent !== undefined) {
      if (!db.inTransaction) {
        own.poisoned = true
        for (const outer of frames) outer.poisoned = true
      }
      merge(parent, own)
      return result
    }
    // Committed: our own commit never moves `data_version`, so the baseline stays as it was.
    if (!db.inTransaction) publish(own)
    return result
  }

  type TransactionFn = ((...args: unknown[]) => unknown) & {
    default: (...args: unknown[]) => unknown
    deferred: (...args: unknown[]) => unknown
    immediate: (...args: unknown[]) => unknown
    exclusive: (...args: unknown[]) => unknown
  }
  function transaction(this: AppDatabase | undefined, fn: (...args: unknown[]) => unknown) {
    const made = nativeTransaction.call(this ?? db, fn) as TransactionFn
    const wrapped = ((...args: unknown[]) => framed(() => made(...args))) as TransactionFn
    wrapped.default = (...args) => framed(() => made.default(...args))
    wrapped.deferred = (...args) => framed(() => made.deferred(...args))
    wrapped.immediate = (...args) => framed(() => made.immediate(...args))
    wrapped.exclusive = (...args) => framed(() => made.exclusive(...args))
    return wrapped
  }
  Object.defineProperty(db, 'transaction', {
    value: transaction,
    configurable: true,
    writable: true,
  })

  const recorder: CommittedChanges = {
    listen(listener) {
      listeners.add(listener)
      if (seen === null) seen = dataVersion()
      return () => listeners.delete(listener)
    },
    appended(row) {
      const current = frames.at(-1)
      if (current === undefined) return
      if (wholeDepth > 0) return
      current.rows.push(Object.freeze(row))
    },
    whole(session, why) {
      const current = frames.at(-1)
      if (current !== undefined && !current.whole.has(session)) current.whole.set(session, why)
    },
    staged(session) {
      frames.at(-1)?.staged.add(session)
    },
    kept(piece, resource) {
      frames.at(-1)?.kept.push({ piece, resource })
    },
    asAWhole(write) {
      wholeDepth += 1
      try {
        return write()
      } finally {
        wholeDepth -= 1
      }
    },
    check() {
      if (db.inTransaction || !db.open) return
      const now = dataVersion()
      if (now === null) return
      const before = seen
      seen = now
      if (before !== null && before !== now) {
        queue.push({ commit: ++commit, resync: true })
        drain()
      }
    },
  }
  Object.defineProperty(db, RECORDER, { value: recorder })
  return recorder
}
