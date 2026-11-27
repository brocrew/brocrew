import { observeDatabaseMemory } from '../database-memory'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { SnapshotFoldAnswers } from './ledger-fold-state'
import { windowFoldCache } from './window-fold-cache'
import { checkpointRowsOf, foldHeads, seedFromCheckpoint } from './window-fold-checkpoint'
import { readWindowWork, projectWindowPieces, type WindowPieces } from './window-work-reading'
import { recentActivity } from '../runtime/recent-activity'
import { createSessionStore, type SessionStore, type ThreadLeadRow } from './session-store'
import { rowsUnreadOnce, type RowsUnread } from './rows-unread'
import { readTheForestFirst } from './forest-first-read'
import { TASK_IS_OPEN } from '../../shared/tasks'
import type { StatusLine } from '../../shared/task-contracts'
import {
  WINDOW_READ_BOUNDS,
  windowReadQuery,
  WindowReadUnavailable,
  recordedReadKey,
  type RecordedRead,
  type RoutingReading,
  type IncidentReading,
  type IncidentFact,
  type SkippedRow,
  type WindowReadQuery,
  type WindowReadResult,
  type WindowRoutes,
  type WindowListingStates,
} from './window-read-protocol'

/** How many of its capabilities an engine still honours. */
const TOKENS_KEPT = 256

/** Incident reads carry no brief text: no incident composition reads it. */
function withoutBrief<T extends { brief: unknown }>({ brief: _brief, ...row }: T) {
  void _brief
  return row
}

function noteOwnerSkips(sessionId: string, skipped: Set<SkippedRow>): RowsUnread {
  const unread = rowsUnreadOnce()
  return {
    in: (id) => (ordinal) => {
      if (id !== sessionId) throw new WindowReadUnavailable()
      skipped.add(ordinal)
      unread.in(id)(ordinal)
    },
    get count() {
      return unread.count
    },
    get ledgersSkipped() {
      return unread.ledgersSkipped
    },
  }
}

function reconciliationWorkFromOpenPieces(
  store: SessionStore,
  sessionId: string,
  pieces: ReturnType<SessionStore['openPiecesOf']>,
  skipped: ReadonlySet<SkippedRow>,
  unread: RowsUnread,
) {
  // Reuse the open-piece fold already read for this owner.
  const foldedStore: typeof store = {
    ...store,
    openPiecesOf(owner, notes) {
      if (owner !== sessionId) throw new WindowReadUnavailable()
      for (const ordinal of skipped) notes?.in(owner)(ordinal)
      return pieces
    },
  }
  return foldedStore.reconciliationWork(new Set([sessionId]), unread)
}

/**
 * The store reads the host makes for one reconciliation group beyond its piece folds — each
 * holder's provider-failure episode, receipts and notice progress, and what its waits name — made
 * in the same snapshot. A read that fails here is left out, so the host makes it itself.
 */
function recordReconciliationReads(store: SessionStore, checkCancelled: () => void) {
  const all: RecordedRead[] = []
  const values = new Map<string, unknown>()
  const record = <T>(parts: readonly unknown[], read: (unread: RowsUnread) => T): T | undefined => {
    const key = recordedReadKey(parts)
    if (values.has(key)) return values.get(key) as T
    checkCancelled()
    const skipped: [string, SkippedRow][] = []
    const counts = rowsUnreadOnce()
    const unread: RowsUnread = {
      in: (session) => (ordinal) => {
        skipped.push([session, ordinal])
        counts.in(session)(ordinal)
      },
      get count() {
        return counts.count
      },
      get ledgersSkipped() {
        return counts.ledgersSkipped
      },
    }
    try {
      const value = read(unread)
      values.set(key, value)
      all.push({ key, value, skipped })
      return value
    } catch {
      checkCancelled()
      return undefined
    }
  }
  return {
    all,
    forHolder(
      sessionId: string,
      pieces: ReturnType<SessionStore['openPiecesOf']>,
      work: ReturnType<SessionStore['reconciliationWork']>,
    ): void {
      const episode = record(['providerFailureEpisode', sessionId], () =>
        store.providerFailureEpisode(sessionId),
      )
      if (typeof episode === 'object')
        for (const asker of new Set(episode.asks.map((one) => one.asker)))
          record(['routedRequestsOf', asker], (unread) => store.routedRequestsOf(asker, unread))
      const receipts = record(['reconciliationReceiptsForOwner', sessionId], () =>
        store.reconciliationReceiptsForOwner(sessionId),
      )
      for (const receipt of receipts ?? [])
        if (receipt.kind === 'provider-turn-failed' && receipt.outcome === 'planned')
          record(['providerFailureNoticeProgress', receipt.target, receipt.messageId], () =>
            store.providerFailureNoticeProgress(receipt.target, receipt.messageId),
          )
      for (const row of work) {
        let line: StatusLine | null | undefined
        try {
          line =
            (row.parent === null ? store.rootLines(row.piece).statusLine : undefined) ??
            pieces.find((one) => one.piece === row.piece)?.statusLine
        } catch {
          checkCancelled()
          continue
        }
        const on = line?.waiting === true ? line.on : undefined
        if (on === undefined) continue
        if (on.kind === 'agent' && 'piece' in on) {
          const target = record(['workById', on.piece], () => store.workById(on.piece))
          if (target != null && target.parent !== null)
            record(['piecesOwnedBy', target.owner], (unread) =>
              store.piecesOwnedBy(target.owner, unread),
            )
        } else if (on.kind === 'person' || (on.kind === 'agent' && 'request' in on))
          for (const id of new Set([sessionId, row.givenBy, line?.by]))
            if (typeof id === 'string')
              record(['routedRequestsOf', id], (unread) => store.routedRequestsOf(id, unread))
      }
    },
  }
}

/** Canonical folds over one read-only WAL snapshot, consuming SQLite iterators incrementally. */
export class WindowReadEngine {
  private readonly db: Database.Database
  private readonly answers: SnapshotFoldAnswers = windowFoldCache()
  private cacheToken: string | undefined
  /**
   * Every capability this engine gave, newest last. Each was given after a snapshot older than every
   * answer kept since, so the owners changed since its read cover those answers too: a read queued
   * behind a newer lineage keeps them.
   */
  private readonly tokensGiven = new Set<string>()
  /** The kept folds already in the checkpoint, so each is written once. */
  private readonly written = new WeakSet<object>()

  /** `madeBy` names this build exactly; without it the checkpoint is neither read nor written. */
  constructor(
    file: string,
    private readonly madeBy?: string,
  ) {
    this.db = new Database(file, { readonly: true, fileMustExist: true, timeout: 1000 })
    try {
      this.db.pragma('query_only = ON')
      this.db.pragma('cache_size = -4096')
      observeDatabaseMemory(this.db, 'window-reader')
      if (this.db.pragma('journal_mode', { simple: true }) !== 'wal')
        throw new WindowReadUnavailable()
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  read(input: WindowReadQuery, abandoned: () => boolean = () => false): WindowReadResult {
    const query = windowReadQuery.parse(input)
    const keepsFolds =
      query.kind === 'routes' ||
      query.kind === 'listing' ||
      query.kind === 'publication' ||
      query.kind === 'incidents' ||
      query.kind === 'checkpoint' ||
      // Work and Files read the same piece folds; they use them only when asked to reuse.
      ((query.kind === 'work-given' || query.kind === 'files') && query.reuse !== undefined)
    let cold = false
    if (keepsFolds) {
      if (query.reuse === undefined || !this.tokensGiven.has(query.reuse.token)) {
        this.answers.clear()
        this.cacheToken = undefined
        cold = true
      } else
        for (const answers of this.answers.values())
          for (const owner of query.reuse.changed) answers.delete(owner)
    }
    let refused: WindowReadUnavailable | undefined
    const checkCancelled = () => {
      if (refused !== undefined) throw refused
      if (!abandoned()) return
      refused = new WindowReadUnavailable('failed', 'cancelled')
      throw refused
    }
    const cancellable = new Proxy(this.db, {
      get: (database, key) => {
        if (key === 'prepare')
          return (sql: string) => {
            const statement = database.prepare(sql)
            return new Proxy(statement, {
              get: (native, method) => {
                if (method === 'all')
                  return (...args: unknown[]) => {
                    const result: unknown[] = []
                    for (const row of native.iterate(...args)) {
                      checkCancelled()
                      result.push(row)
                    }
                    return result
                  }
                if (method === 'get')
                  return (...args: unknown[]) => {
                    checkCancelled()
                    return native.get(...args)
                  }
                if (method === 'iterate')
                  return function* (...args: unknown[]) {
                    for (const row of native.iterate(...args)) {
                      checkCancelled()
                      yield row
                    }
                  }
                const value: unknown = Reflect.get(native, method, native)
                return typeof value === 'function' ? value.bind(native) : value
              },
            })
          }
        const value: unknown = Reflect.get(database, key, database)
        return typeof value === 'function' ? value.bind(database) : value
      },
    })
    this.db.exec('BEGIN')
    try {
      this.db.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'events'").get()
      // A cold read starts from the checkpoint, each kept fold proven current in this snapshot.
      if (cold && query.kind !== 'checkpoint' && this.madeBy !== undefined)
        seedFromCheckpoint(this.db, this.madeBy, foldHeads(this.db), this.answers, this.written)
      // Made for this snapshot alone, so a fold that read every row is not read again.
      const store = createSessionStore(
        cancellable,
        Date.now,
        undefined,
        Math.random,
        checkCancelled,
        true,
        keepsFolds ? this.answers : undefined,
      )
      const database = this.db
      function readRoutes(listingOnly: true): WindowListingStates
      function readRoutes(
        listingOnly?: false,
        projected?: ReadonlyMap<string, WindowPieces>,
      ): WindowRoutes
      function readRoutes(
        listingOnly = false,
        projected?: ReadonlyMap<string, WindowPieces>,
      ): WindowRoutes | WindowListingStates {
        const candidates = database
          .prepare("SELECT DISTINCT session_id AS id FROM events WHERE type = 'request_routed'")
          .iterate() as IterableIterator<{ id: string }>
        const routes: RoutingReading[] = []
        const skipped = new Map<string, Set<SkippedRow>>()
        const counts = rowsUnreadOnce()
        const unread: RowsUnread = {
          in: (sessionId) => (ordinal) => {
            let seen = skipped.get(sessionId)
            if (seen === undefined) skipped.set(sessionId, (seen = new Set()))
            seen.add(ordinal)
            counts.in(sessionId)(ordinal)
          },
          get count() {
            return counts.count
          },
          get ledgersSkipped() {
            return counts.ledgersSkipped
          },
        }
        for (const { id } of candidates) {
          checkCancelled()
          routes.push({
            sessionId: id,
            requests: store.routedRequestsOf(id, unread),
            skipped: [...(skipped.get(id) ?? [])],
          })
        }
        if (listingOnly)
          return {
            kind: 'listing',
            startedHereCounts: store.startedHereCounts(),
            routes,
            work: readWindowWork(cancellable, store, true),
          }
        return {
          kind: 'routes',
          routes,
          questions: store.questionsAPersonMustAnswer(unread),
          decisions: store.decisionsAwaitingAPerson(unread),
          work: readWindowWork(cancellable, store, false, projected),
        }
      }
      let result: WindowReadResult
      if (query.kind === 'checkpoint') {
        // Only folds kept under a reuse token are current in this snapshot; a cold read has none.
        result = {
          kind: 'checkpoint',
          rows:
            cold || this.madeBy === undefined
              ? []
              : checkpointRowsOf(this.answers, foldHeads(this.db), this.written),
        }
      } else if (query.kind === 'listing') {
        result = readRoutes(true)
      } else if (query.kind === 'forest') {
        result = { kind: 'forest', ...readTheForestFirst(store, query.asked) }
      } else if (query.kind === 'forest-nodes') {
        result = {
          kind: 'forest-nodes',
          ...store.forestNodesOf(query.conversations, new Set(query.drawn), query.hidden),
        }
      } else if (query.kind === 'reconciliation-owners') {
        result = { kind: 'reconciliation-owners', owners: store.reconciliationOwners(true) }
      } else if (query.kind === 'reconciliation-folds') {
        const reads = recordReconciliationReads(store, checkCancelled)
        result = {
          kind: 'reconciliation-folds',
          owners: query.holders.map((sessionId) => {
            checkCancelled()
            const piecesSkipped = new Set<SkippedRow>()
            const noted = noteOwnerSkips(sessionId, piecesSkipped)
            const pieces = store.openPiecesOf(sessionId, noted)
            const work = reconciliationWorkFromOpenPieces(
              store,
              sessionId,
              pieces,
              piecesSkipped,
              noted,
            )
            reads.forHolder(sessionId, pieces, work)
            return {
              sessionId,
              pieces: pieces.map(withoutBrief),
              work: work.map(withoutBrief),
              piecesSkipped: [...piecesSkipped],
            }
          }),
          reads: reads.all,
        }
      } else if (query.kind === 'incidents') {
        const owners = store.reconciliationOwners()
        const readings: IncidentReading[] = []
        const projected = new Map<string, WindowPieces>()
        const reported = new Map<string, IncidentFact<readonly string[]>>()
        const read = <T>(answer: () => T): IncidentFact<T> => {
          try {
            return { value: answer() }
          } catch {
            checkCancelled()
            return null
          }
        }
        for (const sessionId of owners) {
          checkCancelled()
          const piecesSkipped = new Set<SkippedRow>()
          const routesSkipped = new Set<SkippedRow>()
          const messagesSkipped = new Set<SkippedRow>()
          const stopSkipped = new Set<SkippedRow>()
          const noted = (skipped: Set<SkippedRow>) => noteOwnerSkips(sessionId, skipped)
          const statesSkipped = new Set<SkippedRow>()
          const reconciled = store.reconciliationPieces(sessionId, noted(statesSkipped))
          checkCancelled()
          const states = reconciled.pieces
          projected.set(
            sessionId,
            projectWindowPieces(store, sessionId, {
              value: states,
              skipped: statesSkipped.size === 0 ? [] : [[sessionId, [...statesSkipped]]],
            }),
          )
          for (const ordinal of statesSkipped) piecesSkipped.add(ordinal)
          const pieces = states.filter((one) => TASK_IS_OPEN[one.state])
          const work = reconciliationWorkFromOpenPieces(
            store,
            sessionId,
            pieces,
            piecesSkipped,
            noted(piecesSkipped),
          )
          const newestTurn = reconciled.newestTurn
          const stop = store.lastAskToStop(sessionId, noted(stopSkipped))
          for (const piece of pieces)
            if (piece.giver !== null && !reported.has(piece.giver))
              reported.set(
                piece.giver,
                read(() => [...store.workReportedTo(piece.giver!)]),
              )
          readings.push({
            sessionId,
            history: {
              roots: work
                .filter((one) => one.parent === null)
                .map((one) => [
                  one.piece,
                  read(() => store.rootLines(one.piece)),
                  read(() => store.turnBlockRootLines(one.piece)),
                ]),
              receipts: work.map((one) => [
                one.piece,
                read(() => store.reconciliationReceipts(sessionId, one.piece)),
              ]),
              recovery: read(() => store.reconciliationRecovery(sessionId)),
              newestTurn,
              driven: reconciled.driven === null ? null : { value: reconciled.driven },
              lastPerson:
                stop?.by === 'a-person'
                  ? read(() => store.whenAPersonLastWrote(sessionId))
                  : { value: null },
              legacy: pieces
                .filter((one) => one.state === 'stalled' && one.giver !== null)
                .map((one) => [
                  one.piece,
                  one.giver!,
                  read(() =>
                    store.legacyOrdinaryStallWasReported(sessionId, one.piece, one.giver!),
                  ),
                ]),
              states: states.map((one) => [one.piece, one.state]),
              statesSkipped: [...statesSkipped],
            },
            pieces: pieces.map(withoutBrief),
            work: work.map(withoutBrief),
            routes: store.routedRequestsOf(sessionId, noted(routesSkipped)),
            messages: store.messagesWaitingIn(sessionId, noted(messagesSkipped)),
            stop,
            piecesSkipped: [...piecesSkipped],
            routesSkipped: [...routesSkipped],
            messagesSkipped: [...messagesSkipped],
            stopSkipped: [...stopSkipped],
          })
        }
        result = {
          kind: 'incidents',
          owners: readings,
          reported: [...reported],
          routing: readRoutes(false, projected),
        }
      } else if (query.kind === 'work-given') {
        result = { kind: 'work-given', work: store.workGivenOutBy(query.sessionId) }
      } else if (query.kind === 'activity') {
        const reading = recentActivity(store, query.from, query.to)
        result = { kind: 'activity', ...reading }
      } else if (query.kind === 'files') {
        if (store.conversationBinding(query.sessionId) === null) throw new WindowReadUnavailable()
        const files = store.filesKeptTogether({
          scope: 'tree',
          holder: query.sessionId,
          givers: query.givers,
        })
        const roster = store.agentIdentities()
        result = { kind: 'files', ...files, roster }
      } else if (query.kind === 'leads') {
        // Bound each native page by ledger rows, including rows the lead selector skips.
        const page = this.db.prepare(`SELECT ordinal FROM events
          WHERE session_id = @session AND generation = coalesce(
            (SELECT active FROM derived_generation WHERE session_id = @session), 0)
            AND ordinal >= @from AND ordinal < @before
          ORDER BY ordinal LIMIT @limit`)
        const rows: ThreadLeadRow[] = []
        let from = Number.NEGATIVE_INFINITY
        for (;;) {
          checkCancelled()
          const ordinals = page.all({
            session: query.sessionId,
            from,
            before: query.before,
            limit: WINDOW_READ_BOUNDS.leadPageRows,
          }) as { ordinal: number }[]
          const last = ordinals.at(-1)
          if (last === undefined) break
          if (
            !Number.isSafeInteger(last.ordinal) ||
            last.ordinal < from ||
            last.ordinal >= query.before
          )
            throw new WindowReadUnavailable()
          const before = last.ordinal + 1
          const found = store.threadLeadRows?.(
            query.sessionId,
            query.opening,
            before,
            query.historicalOpening,
            from,
          )
          if (found === undefined) throw new WindowReadUnavailable()
          rows.push(...found)
          from = before
        }
        result = { kind: 'leads', rows }
      } else {
        if (query.kind === 'routes') result = readRoutes()
        else {
          let states: WindowRoutes | null = null
          try {
            states = readRoutes()
          } catch (error) {
            console.warn('window worker could not read changed states', error)
            this.answers.clear()
            this.cacheToken = undefined
          }
          const files: ReturnType<typeof store.filesKept>[number][] = []
          const failedFiles: string[] = []
          let roster: ReturnType<typeof store.agentIdentities> | null = null
          try {
            roster = store.agentIdentities()
          } catch (error) {
            console.warn('window worker could not read the file roster', error)
          }
          for (const { piece, resources } of query.kept) {
            try {
              if (roster === null) throw new WindowReadUnavailable()
              files.push(
                ...store
                  .filesKept({ scope: 'piece', piece })
                  .filter((row) => resources.includes(row.resource.resource)),
              )
            } catch (error) {
              failedFiles.push(piece)
              console.warn('window worker could not read kept files', error)
            }
          }
          result = { kind: 'publication', states, files, failedFiles, roster }
        }
      }
      if (refused !== undefined) throw refused
      checkCancelled()
      this.db.exec('COMMIT')
      if (result.kind === 'routes' || result.kind === 'listing') {
        this.cacheToken ??= this.aNewToken()
        result = { ...result, cacheToken: this.cacheToken }
      } else if (result.kind === 'incidents') {
        this.cacheToken ??= this.aNewToken()
        result = { ...result, routing: { ...result.routing, cacheToken: this.cacheToken } }
      } else if (result.kind === 'publication' && result.states !== null) {
        this.cacheToken ??= this.aNewToken()
        result = { ...result, states: { ...result.states, cacheToken: this.cacheToken } }
      }
      return result
    } catch (error) {
      if (this.db.inTransaction) this.db.exec('ROLLBACK')
      if (keepsFolds) {
        this.answers.clear()
        this.cacheToken = undefined
      }
      throw error
    }
  }

  close(): void {
    this.answers.clear()
    this.cacheToken = undefined
    this.tokensGiven.clear()
    this.db.close()
  }

  private aNewToken(): string {
    const token = randomUUID()
    this.tokensGiven.add(token)
    if (this.tokensGiven.size > TOKENS_KEPT) {
      const oldest = this.tokensGiven.values().next().value
      if (oldest !== undefined) this.tokensGiven.delete(oldest)
    }
    return token
  }
}
