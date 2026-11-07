import type { AppDatabase } from './connection'
import type { TranscriptEvent } from '../../shared/runtime-ipc'
import { CASCADE_DELETE_WRITES, DERIVED_TABLES, TRIGGER_WRITES } from './question-copies'

/**
 * What a committed row says to the readers that keep something of it: its place, its type and the
 * few fields that move another conversation's state. Taken from the event as it is written, never
 * read back.
 */
export interface CommittedRow {
  readonly session: string
  readonly generation: number
  readonly ordinal: number
  readonly rowType: TranscriptEvent['type']
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
    rowType: event.type,
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
interface CommittedChange {
  readonly commit: number
  readonly resync: false
  readonly rows: readonly CommittedRow[]
  readonly whole: ReadonlyMap<string, WholeChange>
  /** Sessions a rebuild wrote into a generation nobody reads yet. */
  readonly staged: ReadonlySet<string>
  /**
   * The sessions a staged write took rows out of that a read over every generation still sees, so
   * a reader of those rows reads them again although nothing shown moved.
   */
  readonly stagedRemovedSeen: ReadonlySet<string>
  /** Files kept on a piece. */
  readonly kept: readonly { readonly piece: string; readonly resource: string }[]
  /** The persistent tables the commit wrote, whatever else it says: a setter's, a note's. */
  readonly tables: ReadonlySet<string>
  /** Those of {@link tables} written outside a staged scope, which a reader of what is shown sees. */
  readonly visibleTables: ReadonlySet<string>
}

/** What was committed can't be told: every reader starts again. */
interface CommittedResync {
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
  /** A staged write removed rows of `session` that a read over every generation sees. */
  stagedRemovedSeen(session: string): void
  kept(piece: string, resource: string): void
  /** Runs `write` with its appends recorded as part of a whole change, not row by row. */
  asAWhole<T>(write: () => T): T
  /** Runs `write` with its appends recorded as staged: a generation nobody reads yet. */
  asStaged<T>(write: () => T): T
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
  stagedRemovedSeen: Set<string>
  kept: { piece: string; resource: string }[]
  tables: Set<string>
  visibleTables: Set<string>
  poisoned: boolean
}

const frame = (): Frame => ({
  rows: [],
  whole: new Map(),
  staged: new Set(),
  stagedRemovedSeen: new Set(),
  kept: [],
  tables: new Set(),
  visibleTables: new Set(),
  poisoned: false,
})

/**
 * Kept on the connection itself, so it reads the same through any proxy that forwards to it, and a
 * second store or module on the same connection finds the same recorder.
 */
const RECORDER = Symbol('committed changes')

const WRITES = /^(?:INSERT|REPLACE|UPDATE|DELETE|WITH)\b/i
const TARGET =
  /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["`[]?([A-Za-z_][\w.]*)/i

/** A statement that deletes, once leading space and comments are passed. */
const DELETES = /^(?:\s+|--[^\n]*\n|\/\*[\s\S]*?\*\/)*DELETE\b/i

/** The persistent table a statement writes, or `null` for a read, DDL or a temp table. */
function tableWrittenBy(sql: string): string | null {
  const text = sql.replace(/^(?:\s+|--[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '')
  if (!WRITES.test(text)) return null
  const name = TARGET.exec(text)?.[1]?.toLowerCase()
  if (name === undefined || name.startsWith('temp.')) return null
  return name
}

/**
 * The record of what each commit on this connection wrote. One per raw connection, whichever
 * store or module asks for it. Every transaction made on the connection after this is installed
 * is framed: a nested one merges into its parent when it returns and is dropped when it throws,
 * and the outermost publishes once the connection has left its transaction. A persistent write
 * outside any transaction publishes on its own.
 */
export function committedChangesOf(db: AppDatabase): CommittedChanges {
  const known = (db as unknown as Record<symbol, CommittedChanges | undefined>)[RECORDER]
  if (known !== undefined) return known
  // What the connection itself answers for each method, called on whichever connection a proxy
  // hands it: an own replacement installed before this one, or the prototype's.
  type Methods = {
    prepare(this: AppDatabase, sql: string): ReturnType<AppDatabase['prepare']>
    transaction(this: AppDatabase, fn: unknown): unknown
  }
  const prototype = Object.getPrototypeOf(db) as Methods
  const before = <K extends keyof Methods>(key: K): Methods[K] =>
    (Object.getOwnPropertyDescriptor(db, key)?.value as Methods[K] | undefined) ?? prototype[key]
  const nativeTransaction = before('transaction')
  const nativePrepare = before('prepare')

  if (db.readonly) {
    // A read-only connection never commits: nothing is patched, and nothing is published.
    const reader: CommittedChanges = {
      listen: () => () => undefined,
      appended: () => undefined,
      whole: () => undefined,
      staged: () => undefined,
      stagedRemovedSeen: () => undefined,
      kept: () => undefined,
      asAWhole: (write) => write(),
      asStaged: (write) => write(),
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
  let stagedDepth = 0
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
      done.kept.length > 0 ||
      done.tables.size > 0
    ) {
      queue.push({
        commit: ++commit,
        resync: false,
        rows: done.rows,
        whole: done.whole,
        staged: done.staged,
        stagedRemovedSeen: done.stagedRemovedSeen,
        kept: done.kept,
        tables: done.tables,
        visibleTables: done.visibleTables,
      })
    } else return
    drain()
  }

  const merge = (into: Frame, done: Frame): void => {
    into.rows.push(...done.rows)
    for (const [session, why] of done.whole)
      if (!into.whole.has(session)) into.whole.set(session, why)
    for (const session of done.staged) into.staged.add(session)
    for (const session of done.stagedRemovedSeen) into.stagedRemovedSeen.add(session)
    into.kept.push(...done.kept)
    for (const table of done.tables) into.tables.add(table)
    for (const table of done.visibleTables) into.visibleTables.add(table)
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

  /** Whether a name a write statement targets is one of this connection's temp tables. */
  const isATempTable = (name: string): boolean =>
    nativePrepare
      .call(db, "SELECT 1 FROM temp.sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  Object.defineProperty(db, 'prepare', {
    configurable: true,
    writable: true,
    value: function prepare(this: AppDatabase | undefined, sql: string) {
      const statement = nativePrepare.call(this ?? db, sql)
      const table = tableWrittenBy(sql)
      if (table === null || isATempTable(table)) return statement
      // What the table's triggers write, and on a delete what its cascades remove, is written too.
      const alsoWritten = [
        ...(TRIGGER_WRITES.get(table) ?? []),
        ...(DELETES.test(sql) ? (CASCADE_DELETE_WRITES.get(table) ?? []) : []),
      ]
      const run = statement.run.bind(statement) as (...args: unknown[]) => { changes: number }
      Object.defineProperty(statement, 'run', {
        configurable: true,
        writable: true,
        value: (...args: unknown[]) => {
          const result = run(...args)
          if (result.changes === 0) return result
          const current = frames.at(-1)
          // A derived table is never one a reader of what is shown sees.
          const visible = stagedDepth === 0 && !DERIVED_TABLES.has(table)
          const written = [table, ...alsoWritten]
          if (current !== undefined) {
            for (const one of written) current.tables.add(one)
            if (visible) current.visibleTables.add(table)
          } else if (!db.inTransaction) {
            const alone = frame()
            for (const one of written) alone.tables.add(one)
            if (visible) alone.visibleTables.add(table)
            publish(alone)
          }
          return result
        },
      })
      return statement
    },
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
      if (stagedDepth > 0) current.staged.add(row.session)
      else current.rows.push(Object.freeze(row))
    },
    whole(session, why) {
      const current = frames.at(-1)
      if (current !== undefined && !current.whole.has(session)) current.whole.set(session, why)
    },
    staged(session) {
      frames.at(-1)?.staged.add(session)
    },
    stagedRemovedSeen(session) {
      frames.at(-1)?.stagedRemovedSeen.add(session)
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
    asStaged(write) {
      stagedDepth += 1
      try {
        return write()
      } finally {
        stagedDepth -= 1
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
