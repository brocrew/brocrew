import type { AppDatabase } from './connection'
import type { SkipNote } from './rows-unread'
import type { TranscriptEvent } from '../../shared/conversation-events'
import { FOLD_EVENT_TYPES, FOLD_TERM } from './fold-index'
import { foldWatchTriggers, watchFoldWrites } from './fold-write-watch'

/** One ledger's kept fold: the generation and newest fold row it was read at, and its answer. */
interface KeptFold<T> {
  readonly generation: number
  readonly newest: number | null
  readonly answer: T
}
type CarriedForward<T> = (
  sessionId: string,
  generation: number,
  after: number,
  held: T,
) => T | null

export function createLedgerFoldState(
  db: AppDatabase,
  connection: AppDatabase,
  activeGeneration: (sessionId: string) => number,
  oneSnapshot: boolean,
  theFoldIndexHolds: (statement: { readonly source: string }) => void,
  invalidateWorkReads: (sessionId: string) => void,
  invalidateAllWorkReads: () => void,
) {
  let ownFoldWrite: { session: string; generation: number; ordinal: number } | null = null
  let foldsWatched: 'not-yet' | 'yes' | 'never' = 'not-yet'
  let foldsSeenAt: unknown = null
  const selectDataVersion = db.prepare(`SELECT data_version AS version FROM pragma_data_version`)
  // Another connection's commits, and how many of this store's fold triggers are still on `events`.
  const selectWhatTheFoldsKnow = db.prepare(
    `SELECT data_version AS version,
            (SELECT count(*) FROM sqlite_temp_master
              WHERE type = 'trigger' AND tbl_name = 'events' AND name IN (?, ?, ?)) AS watching
       FROM pragma_data_version`,
  )
  function aFoldRowWasWritten(
    session: unknown,
    generation: unknown,
    ordinal: unknown,
    inserted: boolean,
  ): void {
    try {
      const own = ownFoldWrite
      ownFoldWrite = null
      if (
        inserted &&
        own !== null &&
        own.session === session &&
        own.generation === generation &&
        own.ordinal === ordinal
      )
        return
      if (typeof session !== 'string') return
      forgetTheKeptFoldsOf(session)
      invalidateWorkReads(session)
    } catch {
      // A store whose making failed keeps nothing.
    }
  }
  function theFoldsMayBeKept(): boolean {
    if (oneSnapshot) return true
    if (db.inTransaction) return false
    if (!watchTheFolds()) return false
    const known = selectWhatTheFoldsKnow.get(...foldWatchTriggers(aFoldRowWasWritten)) as {
      version: number
      watching: number
    }
    if (known.watching !== 3) {
      // Something took the watch away: nothing kept by it is trusted, and it is put back.
      forgetEveryFold()
      foldsWatched = 'not-yet'
      return watchTheFolds()
    }
    if (known.version !== foldsSeenAt) {
      forgetEveryFold()
      foldsSeenAt = known.version
    }
    return true
  }
  function forgetEveryFold(): void {
    for (const kept of keptFolds) kept.clear()
    invalidateAllWorkReads()
  }
  function watchTheFolds(): boolean {
    if (foldsWatched !== 'not-yet' || db.inTransaction) return foldsWatched === 'yes'
    if (db.readonly || db.pragma('query_only', { simple: true }) === 1) {
      foldsWatched = 'never'
      return false
    }
    if (!watchFoldWrites(connection, aFoldRowWasWritten)) return false
    foldsWatched = 'yes'
    foldsSeenAt = (selectDataVersion.get() as { version: number }).version
    return true
  }
  watchTheFolds()

  // The newest row a fold can read: the folds below read only the fold types, through their index.
  const selectNewestFoldRow = db.prepare(
    `SELECT max(ordinal) AS through FROM events
        INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ?`,
  )
  theFoldIndexHolds(selectNewestFoldRow)

  function keptUntilItsLedgerGrows<T>(
    fold: (sessionId: string, noteSkip?: SkipNote) => T,
    carriedForward?: CarriedForward<T>,
  ): (sessionId: string, noteSkip?: SkipNote) => T {
    const folded = new Map<string, KeptFold<T>>()
    keptFolds.push(folded)
    const keep = (sessionId: string, kept: KeptFold<T>): void => {
      // Most recently used last, so the cap drops the conversation unread longest.
      folded.delete(sessionId)
      folded.set(sessionId, kept)
      if (folded.size > KEPT_FOLDS_AT_MOST) {
        const oldest = folded.keys().next().value
        if (oldest !== undefined) folded.delete(oldest)
      }
    }
    // The same answer, only where it is kept and still current: this read never makes the fold.
    onlyIfKept.set(fold, (sessionId) => {
      if (!theFoldsMayBeKept()) return null
      const generation = activeGeneration(sessionId)
      const newest =
        (selectNewestFoldRow.get(sessionId, generation) as { through: number | null } | undefined)
          ?.through ?? null
      const held = folded.get(sessionId)
      return held?.generation === generation && held.newest === newest
        ? { answer: held.answer }
        : null
    })
    return (sessionId, noteSkip) => {
      if (!theFoldsMayBeKept()) return fold(sessionId, noteSkip)
      const generation = activeGeneration(sessionId)
      const newest =
        (selectNewestFoldRow.get(sessionId, generation) as { through: number | null } | undefined)
          ?.through ?? null
      const held = folded.get(sessionId)
      if (held?.generation === generation) {
        if (held.newest === newest) {
          keep(sessionId, held)
          return held.answer
        }
        if (carriedForward !== undefined && newest !== null && newest > (held.newest ?? -1)) {
          const answer = carriedForward(sessionId, generation, held.newest ?? -1, held.answer)
          if (answer !== null) {
            keep(sessionId, { generation, newest, answer })
            return answer
          }
          folded.delete(sessionId)
        }
      }
      if (noteSkip === undefined) return fold(sessionId)
      let readEveryRow = true
      const answer = fold(sessionId, (ordinal, cause) => {
        readEveryRow = false
        noteSkip(ordinal, cause)
      })
      if (readEveryRow && (oneSnapshot || !db.inTransaction))
        keep(sessionId, { generation, newest, answer })
      return answer
    }
  }

  const keptFolds: Map<string, KeptFold<unknown>>[] = []
  // Each kept fold's read that answers only from what is kept ({@link theKeptOnly}).
  const onlyIfKept = new Map<unknown, (sessionId: string) => { readonly answer: unknown } | null>()
  function theKeptOnly<T>(
    fold: (sessionId: string, noteSkip?: SkipNote) => T,
  ): (sessionId: string) => T | null {
    return (sessionId) => {
      const kept = onlyIfKept.get(fold)?.(sessionId) ?? null
      return kept === null ? null : (kept.answer as T)
    }
  }
  // The event types a ledger fold reads: a write of one forgets that conversation's kept folds.
  const A_FOLD_READS_IT: ReadonlySet<string> = new Set(FOLD_EVENT_TYPES)
  const KEPT_FOLDS_AT_MOST = 2000
  /** Forgets one conversation's kept folds: all of them, or those a row written at `ordinal` is below. */
  function forgetTheKeptFoldsOf(sessionId: string, ordinal?: number): void {
    for (const kept of keptFolds) {
      const newest = kept.get(sessionId)?.newest
      if (newest === undefined) continue
      if (ordinal === undefined || (newest !== null && ordinal <= newest)) kept.delete(sessionId)
    }
  }

  function invalidateForAppend(sessionId: string, ordinal: number, event: TranscriptEvent): void {
    if (A_FOLD_READS_IT.has(event.type)) forgetTheKeptFoldsOf(sessionId, ordinal)
  }

  function markOwnAppend(
    sessionId: string,
    generation: number,
    ordinal: number,
    event: TranscriptEvent,
  ): void {
    ownFoldWrite = A_FOLD_READS_IT.has(event.type)
      ? { session: sessionId, generation, ordinal }
      : null
  }

  return {
    invalidateForAppend,
    markOwnAppend,
    forgetTheKeptFoldsOf,
    theFoldsMayBeKept,
    keptUntilItsLedgerGrows,
    theKeptOnly,
  }
}
