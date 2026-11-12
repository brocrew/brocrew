import type { AppDatabase, AppStatement } from './connection'
import type { Provider } from '@brobot2/shared'
import type { LedgerWalk } from '../../shared/question-contracts'
import {
  PHRASES,
  PROVIDER_WALL_LOOKBACK_MS,
  foldProviderLimits,
  providerLimitAccounts,
  readProviderLimit,
  type ProviderLimitAccountLife,
  type ProviderLimitSeen,
  type ProviderTakingWork,
} from '../../shared/provider-limit'
import { FOLD_TERM } from './fold-index'
import { providerWallsWatched, watchProviderWalls } from './provider-wall-watch'

/** Times named read phases without receiving their SQL arguments or row contents. */
export interface SessionReadPhases {
  timed<T>(phase: string, read: () => T): T
}

/** A conversation's launch: where in its ledger and when. */
interface Launch {
  readonly ordinal: number
  readonly created_at: number
}
/** An error row that may say a provider wall, read once. */
interface WallRead {
  readonly session_id: string
  readonly ordinal: number
  readonly created_at: number
  /** The wall it says, `null` for none, or `unread` for a row this app could not read. */
  readonly said: ProviderLimitSeen | null | 'unread'
  /** When the life that wrote it began, once asked. */
  life?: number | null
}
/** A clear whose payload was not JSON: counted where it is met, never read as a clear. */
interface TornClear {
  readonly session_id: string
  readonly ordinal: number
  readonly generation: number
  readonly created_at: number
}
/** What the watch had counted when a walls read was made — see {@link watchProviderWalls}. */
interface WallWatchStamp {
  readonly revision: bigint
  readonly dataVersion: bigint
}
interface WallWatchStatements {
  readonly sample: AppStatement
  readonly added: AppStatement
  readonly emptied: AppStatement
  readonly empty: AppStatement
  readonly turnsFilled: AppStatement
  readonly turnsBegun: AppStatement
  readonly turnsReadTo: AppStatement
  readonly emptyTurns: AppStatement
  readonly keepTurn: AppStatement
  readonly turnsSince: AppStatement
}
/** A row of the walls read's types added since it was kept, as the watch's queue names it. */
interface AddedWallRow {
  /** Its place in the watch's queue. */
  readonly added: number
  readonly row: number
  readonly type: string
  readonly session_id: string
  readonly ordinal: number
  readonly generation: number
  readonly created_at: number
  /** An error row's payload where it may say a wall, otherwise `null`. */
  readonly payload: string | null
  readonly readable: number
  readonly window: string | null
  readonly provider: string
}
type SessionTakingWork = ProviderTakingWork & { readonly session_id: string }
interface WallsRead {
  /** What the watch had counted when it was read whole; `null` for a read that is not kept. */
  readonly stamp: WallWatchStamp | null
  /** The newest row of the watch's queue taken in. */
  added: number
  /** The oldest instant it holds the rows from. */
  since: number
  /** Where its next slice begins, in the error index's order; `null` once it is read whole. */
  next: { readonly at: number; readonly row: number } | null
  /** By rowid. */
  readonly rows: Map<number, WallRead>
  readonly launches: Map<string, Launch[]>
  /** The conversations launched too often for their launches to be kept. */
  readonly launchesNotKept: Set<string>
  /** The newest clear of each provider, conversation and window; torn clears are held by rowid. */
  readonly clears: Map<string, SessionTakingWork>
  readonly torn: Map<number, TornClear>
  /** Where its clears' next slice begins; `null` once they are read whole. */
  clearsNext: { readonly at: number; readonly row: number } | null
}
const wallsReadOn = new WeakMap<object, WallsRead>()
/** How many error rows one slice of the walls read reads. */
const WALLS_READ_AT_ONCE = 256
/** How many turn rows one slice of the completed-turns fill reads. */
const TURNS_READ_AT_ONCE = 10_000
/** How much further back than its lookback a kept walls read holds. */
const WALLS_KEPT_BEFORE_MS = 60 * 60 * 1000
const WALL_QUEUE_EMPTIED_FROM = 1024
/** How many launches of one conversation a kept walls read keeps. */
const LAUNCHES_KEPT_AT_MOST = 1024

export function createProviderLimitReader(
  db: AppDatabase,
  connection: AppDatabase,
  activeGeneration: (sessionId: string) => number,
  readPhases: SessionReadPhases | undefined,
  noteUnreadRow: (sessionId: string, ordinal: number, noteSkip: undefined) => void,
  theFoldIndexHolds: (statement: { readonly source: string }) => void,
): {
  providerLimitsSeen(
    now: number,
    signInChangedAt?: ReadonlyMap<Provider, number>,
    accountLives?: readonly ProviderLimitAccountLife[],
  ): LedgerWalk<ProviderLimitSeen>
  readAheadProviderWalls(now: number, budgetMs: number): boolean
} {
  const phase = <T>(name: string, read: () => T): T =>
    readPhases === undefined ? read() : readPhases.timed(`store.providerLimitsSeen.${name}`, read)
  const wallLike = (payload: string) => PHRASES.map(() => `${payload} LIKE ?`).join(' OR ')
  const wallTerms = PHRASES.map((one) => `%${one.phrase}%`)
  const selectProviderWalls = phase('prepare-walls', () =>
    db.prepare(
      `SELECT rowid AS row, session_id, ordinal, created_at,
              CASE WHEN ${wallLike('payload')} THEN payload END AS payload
         FROM events
        WHERE type = 'error' AND created_at >= @since
          AND likelihood((created_at, rowid) > (@at, @row), 0.00001)
        ORDER BY created_at, rowid LIMIT ${WALLS_READ_AT_ONCE}`,
    ),
  )
  const selectProviderWallsAtOnce = db.prepare(
    `SELECT rowid AS row, session_id, ordinal, payload, created_at FROM events
      WHERE type = 'error' AND likelihood(created_at >= ?, 0.00001) AND (${wallLike('payload')})`,
  )
  const selectLaunchesOf = db.prepare(
    `SELECT ordinal, created_at FROM events
        INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND type = 'launched' AND session_id = ?`,
  )
  theFoldIndexHolds(selectLaunchesOf)
  function keepTheLaunchesOf(read: WallsRead, session: string, launches: Launch[]): void {
    if (launches.length <= LAUNCHES_KEPT_AT_MOST) {
      read.launches.set(session, launches)
      return
    }
    read.launches.delete(session)
    read.launchesNotKept.add(session)
  }
  function lifeSinceOf(read: WallsRead, row: WallRead): number | null {
    let launches = read.launches.get(row.session_id)
    if (launches === undefined) {
      launches = phase('read-launches', () => selectLaunchesOf.all(row.session_id)) as Launch[]
      keepTheLaunchesOf(read, row.session_id, launches)
    }
    let since: number | null = null
    for (const launch of launches) {
      if (launch.ordinal < row.ordinal && (since === null || launch.created_at > since))
        since = launch.created_at
    }
    return since
  }
  const selectTurnsCompletedSince = db.prepare(
    `SELECT t.session_id, ps.provider AS provider, MAX(t.closed_at) AS at
       FROM turn t JOIN provider_session ps ON ps.id = t.session_id
      WHERE t.end_reason = 'completed' AND t.closed_at > ?
      GROUP BY ps.provider, t.session_id`,
  )
  const selectTurnsCompletedIn = db.prepare(
    `SELECT t.session_id, ps.provider AS provider, MAX(t.closed_at) AS at
       FROM turn t JOIN provider_session ps ON ps.id = t.session_id
      WHERE t.rowid > @after AND t.rowid <= @after + ${TURNS_READ_AT_ONCE}
        AND t.end_reason = 'completed'
      GROUP BY ps.provider, t.session_id`,
  )
  const selectNewestTurnRow = db.prepare(`SELECT coalesce(max(rowid), 0) AS last FROM turn`)
  const selectLimitsClearedSince = db.prepare(
    `SELECT e.session_id, ps.provider AS provider,
            CASE WHEN json_valid(e.payload) THEN json_extract(e.payload, '$.window') END AS window,
            MAX(e.created_at) AS at
       FROM events e JOIN provider_session ps ON ps.id = e.session_id
      WHERE e.type = 'provider_limit_clear' AND likelihood(e.created_at > ?, 0.00001) AND json_valid(e.payload)
      GROUP BY ps.provider, e.session_id, window`,
  )
  const accountLifeAt = (at: string) =>
    `(SELECT MAX(json_extract(value, '$.since')) FROM json_each(@sessionLives)
       WHERE json_extract(value, '$.since') <= ${at})`
  const accountTurnsSql = `SELECT t.session_id, ps.provider, MAX(t.closed_at) AS at,
            ${accountLifeAt('t.closed_at')} AS life
       FROM turn t JOIN provider_session ps ON ps.id = t.session_id
      WHERE t.end_reason = 'completed' AND t.closed_at > @oldest
        AND t.session_id = @sessionId
      GROUP BY ps.provider, t.session_id, life`
  const accountClearsSql = `SELECT e.session_id, ps.provider,
            CASE WHEN json_valid(e.payload) THEN json_extract(e.payload, '$.window') END AS window,
            MAX(e.created_at) AS at,
            ${accountLifeAt('e.created_at')} AS life
       FROM events e JOIN provider_session ps ON ps.id = e.session_id
      WHERE e.type = 'provider_limit_clear' AND likelihood(e.created_at > @oldest, 0.00001)
        AND json_valid(e.payload)
        AND e.session_id = @sessionId
      GROUP BY ps.provider, e.session_id, window, life`
  const selectAccountTurnsCompletedOf = db.prepare(accountTurnsSql)
  const selectAccountLimitsClearedOf = db.prepare(accountClearsSql)
  const selectTornLimitClearsSince = db.prepare(
    `SELECT e.session_id AS session_id, e.ordinal AS ordinal, e.rowid AS row,
            e.generation AS generation, e.created_at AS created_at
       FROM events e
      WHERE e.type = 'provider_limit_clear' AND likelihood(e.created_at > ?, 0.00001) AND NOT json_valid(e.payload)`,
  )
  // A kept clear is the newest of its provider, conversation and window.
  const keepTheNewestClear = (
    clears: Map<string, SessionTakingWork>,
    row: {
      readonly session_id: string
      readonly provider: string
      readonly window: string | null
      readonly at: number
    },
  ) => {
    const clear: SessionTakingWork = {
      session_id: row.session_id,
      provider: row.provider as Provider,
      window: row.window ?? '',
      at: row.at,
    }
    const key = `${clear.provider}\u0000${clear.session_id}\u0000${clear.window}`
    const held = clears.get(key)
    if (held === undefined || clear.at > held.at) clears.set(key, clear)
  }
  const selectLimitClearsFrom = db.prepare(
    `SELECT e.rowid AS row, e.session_id AS session_id, e.ordinal AS ordinal,
            e.generation AS generation, e.created_at AS created_at, ps.provider AS provider,
            json_valid(e.payload) AS readable,
            CASE WHEN json_valid(e.payload) THEN json_extract(e.payload, '$.window') END AS window
       FROM events e JOIN provider_session ps ON ps.id = e.session_id
      WHERE e.type = 'provider_limit_clear' AND e.created_at > @since
        AND likelihood((e.created_at, e.rowid) > (@at, @row), 0.00001)
      ORDER BY e.created_at, e.rowid LIMIT ${WALLS_READ_AT_ONCE}`,
  )
  // A clear row taken in: the newest of its provider and window, or a torn one, counted later.
  function takeInAClear(
    read: WallsRead,
    row: TornClear & { row: number; provider: string; readable: number; window: string | null },
  ): void {
    if (row.readable === 1) keepTheNewestClear(read.clears, { ...row, at: row.created_at })
    else read.torn.set(row.row, row)
  }
  function readTheClearsOn(read: WallsRead, until: number): boolean {
    if (read.clearsNext === null) return true
    if (read.stamp === null) {
      for (const row of selectLimitsClearedSince.all(read.since) as {
        session_id: string
        provider: string
        window: string | null
        at: number
      }[])
        keepTheNewestClear(read.clears, row)
      for (const row of selectTornLimitClearsSince.all(read.since) as (TornClear & {
        row: number
      })[])
        read.torn.set(row.row, row)
      read.clearsNext = null
      return true
    }
    while (read.clearsNext !== null) {
      const from = read.clearsNext
      const rows = selectLimitClearsFrom.all({
        since: read.since,
        at: from.at,
        row: from.row,
      }) as Parameters<typeof takeInAClear>[1][]
      for (const row of rows) takeInAClear(read, row)
      const last = rows.at(-1)
      read.clearsNext =
        rows.length < WALLS_READ_AT_ONCE || last === undefined
          ? null
          : { at: last.created_at, row: last.row }
      if (read.clearsNext !== null && performance.now() >= until) return false
    }
    return true
  }
  // The newest completed turn of each provider after `oldest`.
  function completedTurnsSince(read: WallsRead, oldest: number): SessionTakingWork[] {
    const watch = read.stamp === null ? null : wallWatch()
    let rows: { session_id: string; provider: string; at: number }[]
    if (watch === null) {
      rows = selectTurnsCompletedSince.all(oldest) as typeof rows
    } else {
      if (read.stamp !== null) fillTheTurns(read.stamp, watch, Number.POSITIVE_INFINITY)
      rows = watch.turnsSince.all(oldest) as typeof rows
    }
    return rows.map((row) => ({
      session_id: row.session_id,
      provider: row.provider as Provider,
      window: '',
      at: row.at,
    }))
  }
  function fillTheTurns(stamp: WallWatchStamp, watch: WallWatchStatements, until: number): boolean {
    const filledFor = `${String(stamp.revision)}:${String(stamp.dataVersion)}`
    let filled = watch.turnsFilled.get() as {
      filledFor: string | null
      after: number
      last: number
    }
    if (filled.filledFor !== filledFor) {
      watch.emptyTurns.run()
      const last = (selectNewestTurnRow.get() as { last: number }).last
      watch.turnsBegun.run({ for: filledFor, last })
      filled = { filledFor, after: 0, last }
    }
    let after = filled.after
    while (after < filled.last) {
      const from = after
      const rows = phase('fill-turns', () => selectTurnsCompletedIn.all({ after: from })) as {
        session_id: string
        provider: string
        at: number
      }[]
      for (const row of rows) watch.keepTurn.run(row)
      after += TURNS_READ_AT_ONCE
      watch.turnsReadTo.run(after)
      if (after < filled.last && performance.now() >= until) return false
    }
    return true
  }
  const takingWorkSince = (
    walls: readonly ProviderLimitSeen[],
    read: WallsRead,
    noteTorn: (sessionId: string, ordinal: number) => void,
    accountLives: readonly ProviderLimitAccountLife[] | undefined,
    evaluatedAt: number,
  ): ProviderTakingWork[] => {
    const relevant = walls.filter((wall) => wall.resetsAt === null || wall.resetsAt > evaluatedAt)
    if (relevant.length === 0) return []
    const oldest = Math.min(...relevant.map((one) => one.at))
    phase('read-clears', () => readTheClearsOn(read, Number.POSITIVE_INFINITY))
    // The torn clears were read with the clears above; this counts them.
    phase('read-torn-clears', () => {
      for (const torn of read.torn.values()) {
        if (torn.created_at > oldest && torn.generation === activeGeneration(torn.session_id))
          noteTorn(torn.session_id, torn.ordinal)
      }
    })
    const turnRows = (rows: unknown): SessionTakingWork[] =>
      (rows as { session_id: string; provider: Provider; at: number }[]).map((row) => ({
        ...row,
        window: '',
      }))
    const clearRows = (rows: unknown): SessionTakingWork[] =>
      (rows as { session_id: string; provider: Provider; window: string | null; at: number }[]).map(
        (row) => ({ ...row, window: row.window ?? '' }),
      )
    // Read-only connections use one grouped scan; writable ones use the incremental summary.
    let turns = phase('read-completed-turns', () => completedTurnsSince(read, oldest))
    let cleared = [...read.clears.values()].filter((one) => one.at > oldest)
    const accountOf = accountLives === undefined ? undefined : providerLimitAccounts(accountLives)
    if (accountLives !== undefined && accountOf !== undefined) {
      const sessions = new Map<string, ProviderLimitAccountLife[]>()
      for (const life of accountLives) {
        const lives = sessions.get(life.sessionId) ?? []
        lives.push(life)
        sessions.set(life.sessionId, lives)
      }
      for (const [sessionId, lives] of sessions) {
        lives.sort((a, b) => a.since - b.since)
        let previous = accountOf(sessionId, oldest)
        let split = false
        for (const life of lives) {
          if (life.since <= oldest || life.since > evaluatedAt) continue
          if (life.account !== previous) split = true
          previous = life.account
        }
        if (!split) continue
        const input = { oldest, sessionId, sessionLives: JSON.stringify(lives) }
        if (turns.some((row) => row.session_id === sessionId)) {
          const rows = turnRows(selectAccountTurnsCompletedOf.all(input))
          turns = [...turns.filter((row) => row.session_id !== sessionId), ...rows]
        }
        if (cleared.some((row) => row.session_id === sessionId)) {
          const rows = clearRows(selectAccountLimitsClearedOf.all(input))
          cleared = [...cleared.filter((row) => row.session_id !== sessionId), ...rows]
        }
      }
    }
    return [...turns, ...cleared].map(({ session_id, provider, window, at }) => {
      const account = accountOf?.(session_id, at) ?? null
      return { provider, window, at, ...(account === null ? {} : { account }) }
    })
  }

  let wallWatchStatements: WallWatchStatements | undefined
  function wallWatch(): WallWatchStatements | null {
    if (wallWatchStatements !== undefined) {
      if (providerWallsWatched(connection)) return wallWatchStatements
      wallWatchStatements = undefined
      wallsReadOn.delete(connection)
    }
    if (!watchProviderWalls(connection)) return null
    wallWatchStatements = {
      sample: db
        .prepare(
          `SELECT revision, (SELECT data_version FROM pragma_data_version) AS version,
                max(emptied_through,
                    (SELECT coalesce(max(id), 0) FROM temp.provider_wall_added)) AS added,
                emptied_through AS emptiedThrough
           FROM temp.provider_wall_watch WHERE id = 0`,
        )
        .safeIntegers(true),
      added: db.prepare(
        `SELECT a.id AS added, e.rowid AS row, e.type AS type, e.session_id AS session_id,
                e.ordinal AS ordinal, e.generation AS generation, e.created_at AS created_at,
                ps.provider AS provider, json_valid(e.payload) AS readable,
                CASE WHEN e.type = 'error' AND (${wallLike('e.payload')}) THEN e.payload END AS payload,
                CASE WHEN json_valid(e.payload) THEN json_extract(e.payload, '$.window') END AS window
           FROM temp.provider_wall_added a
           JOIN main.events e ON e.rowid = a.event_row
           JOIN main.provider_session ps ON ps.id = e.session_id
          WHERE a.id > ? ORDER BY a.id LIMIT ${WALLS_READ_AT_ONCE}`,
      ),
      emptied: db.prepare(`UPDATE temp.provider_wall_watch SET emptied_through = ? WHERE id = 0`),
      empty: db.prepare(`DELETE FROM temp.provider_wall_added WHERE id <= ?`),
      turnsFilled: db.prepare(
        `SELECT turns_for AS filledFor, turns_after AS after, turns_last AS last
           FROM temp.provider_wall_watch WHERE id = 0`,
      ),
      turnsBegun: db.prepare(
        `UPDATE temp.provider_wall_watch SET turns_for = @for, turns_after = 0, turns_last = @last
          WHERE id = 0`,
      ),
      turnsReadTo: db.prepare(`UPDATE temp.provider_wall_watch SET turns_after = ? WHERE id = 0`),
      emptyTurns: db.prepare(`DELETE FROM temp.provider_wall_turns`),
      keepTurn: db.prepare(
        `INSERT OR REPLACE INTO temp.provider_wall_turns (provider, session_id, at)
         VALUES (@provider, @session_id, max(@at, coalesce(
           (SELECT at FROM temp.provider_wall_turns
             WHERE provider = @provider AND session_id = @session_id), @at)))`,
      ),
      turnsSince: db.prepare(
        `SELECT provider, session_id, at FROM temp.provider_wall_turns WHERE at > ?`,
      ),
    }
    return wallWatchStatements
  }
  // Put in place as the store is made, for the fold watch's reason.
  if (!connection.inTransaction && !db.readonly && db.pragma('query_only', { simple: true }) !== 1)
    wallWatch()
  function sampleTheWatch(watch: WallWatchStatements): {
    stamp: WallWatchStamp
    added: number
    emptiedThrough: number
  } {
    const sampled = watch.sample.get() as {
      revision: bigint
      version: bigint
      added: bigint
      emptiedThrough: bigint
    }
    return {
      stamp: { revision: sampled.revision, dataVersion: sampled.version },
      added: Number(sampled.added),
      emptiedThrough: Number(sampled.emptiedThrough),
    }
  }

  // One error row read as a wall, or as none, or as a row this app could not read.
  function wallReadFrom(row: {
    session_id: string
    ordinal: number
    payload: string
    created_at: number
  }): WallRead {
    const { session_id, ordinal, created_at } = row
    try {
      const event = JSON.parse(row.payload) as { message?: unknown }
      if (typeof event.message !== 'string') throw new Error('an error row with no message')
      return { session_id, ordinal, created_at, said: readProviderLimit(event.message, created_at) }
    } catch (error) {
      console.warn(
        `provider walls: ${session_id} ordinal ${ordinal} could not be read and was ` +
          `skipped (${error instanceof Error ? error.message : String(error)})`,
      )
      return { session_id, ordinal, created_at, said: 'unread' }
    }
  }

  // A walls read from `since` on, not yet read.
  function aWallsRead(since: number, stamp: WallWatchStamp | null, added: number): WallsRead {
    return {
      stamp,
      added,
      since,
      next: { at: since, row: -1 },
      rows: new Map(),
      launches: new Map(),
      launchesNotKept: new Set(),
      clears: new Map(),
      torn: new Map(),
      clearsNext: { at: since, row: -1 },
    }
  }

  // Reads a walls read's next slices until it is whole or `until` passes; true once whole.
  function readOnFrom(read: WallsRead, until: number): boolean {
    while (read.next !== null) {
      const from = read.next
      const rows = selectProviderWalls.all(...wallTerms, {
        since: read.since,
        at: from.at,
        row: from.row,
      }) as {
        row: number
        session_id: string
        ordinal: number
        created_at: number
        payload: string | null
      }[]
      phase('decode-walls', () => {
        for (const row of rows)
          if (row.payload !== null)
            read.rows.set(row.row, wallReadFrom({ ...row, payload: row.payload }))
      })
      const last = rows.at(-1)
      read.next =
        rows.length < WALLS_READ_AT_ONCE || last === undefined
          ? null
          : { at: last.created_at, row: last.row }
      if (read.next !== null && performance.now() >= until) return false
    }
    return true
  }

  function theKeptWallsRead(watch: WallWatchStatements, since: number): WallsRead {
    const sampled = sampleTheWatch(watch)
    const kept = wallsReadOn.get(connection)
    if (
      kept !== undefined &&
      kept.stamp !== null &&
      kept.stamp.revision === sampled.stamp.revision &&
      kept.stamp.dataVersion === sampled.stamp.dataVersion &&
      kept.added >= sampled.emptiedThrough &&
      since >= kept.since
    )
      return kept
    // The rows the watch added so far are read with the rest.
    const read = aWallsRead(since - WALLS_KEPT_BEFORE_MS, sampled.stamp, sampled.added)
    wallsReadOn.set(connection, read)
    return read
  }

  function theWallsRead(since: number): WallsRead {
    const watch = connection.inTransaction ? null : wallWatch()
    if (watch === null) {
      const read = aWallsRead(since, null, 0)
      read.next = null
      const rows = selectProviderWallsAtOnce.all(since, ...wallTerms) as {
        row: number
        session_id: string
        ordinal: number
        payload: string
        created_at: number
      }[]
      phase('decode-walls', () => {
        for (const row of rows) read.rows.set(row.row, wallReadFrom(row))
      })
      return read
    }
    const read = theKeptWallsRead(watch, since)
    readOnFrom(read, Number.POSITIVE_INFINITY)
    readTheQueueOn(read, watch, Number.POSITIVE_INFINITY)
    letTheOldGo(read, since)
    return read
  }

  // Lets go of what a kept read holds from before `since`, less its slack.
  function letTheOldGo(read: WallsRead, since: number): void {
    const floor = since - WALLS_KEPT_BEFORE_MS
    if (floor - read.since <= WALLS_KEPT_BEFORE_MS) return
    for (const [row, wall] of read.rows) if (wall.created_at < floor) read.rows.delete(row)
    for (const [row, torn] of read.torn) if (torn.created_at < floor) read.torn.delete(row)
    read.since = floor
    // A conversation's launches are kept only while a wall of it is.
    const walled = new Set([...read.rows.values()].map((wall) => wall.session_id))
    for (const session of read.launches.keys())
      if (!walled.has(session)) read.launches.delete(session)
    for (const session of read.launchesNotKept)
      if (!walled.has(session)) read.launchesNotKept.delete(session)
  }

  function readTheQueueOn(read: WallsRead, watch: WallWatchStatements, until: number): boolean {
    const sampled = sampleTheWatch(watch)
    while (read.added < sampled.added) {
      const after = read.added
      const rows = phase('read-added', () => watch.added.all(...wallTerms, after)) as AddedWallRow[]
      phase('decode-walls', () => takeInWhatWasAdded(read, rows))
      const last = rows.at(-1)
      read.added =
        rows.length < WALLS_READ_AT_ONCE || last === undefined ? sampled.added : last.added
      if (read.added < sampled.added && performance.now() >= until) return false
    }
    if (sampled.added - sampled.emptiedThrough >= WALL_QUEUE_EMPTIED_FROM) {
      watch.emptied.run(sampled.added)
      watch.empty.run(sampled.added)
    }
    return true
  }

  function readTheWallsAhead(now: number, until: number): boolean {
    if (connection.inTransaction) return false
    const watch = wallWatch()
    if (watch === null) return true
    const read = theKeptWallsRead(watch, now - PROVIDER_WALL_LOOKBACK_MS)
    if (!readOnFrom(read, until)) return false
    if (!readTheQueueOn(read, watch, until)) return false
    letTheOldGo(read, now - PROVIDER_WALL_LOOKBACK_MS)
    for (const wall of read.rows.values()) {
      if (read.launches.has(wall.session_id) || read.launchesNotKept.has(wall.session_id)) continue
      keepTheLaunchesOf(
        read,
        wall.session_id,
        phase('read-launches', () => selectLaunchesOf.all(wall.session_id)) as Launch[],
      )
      if (performance.now() >= until) return false
    }
    if (read.clearsNext !== null && !phase('read-clears', () => readTheClearsOn(read, until)))
      return false
    return read.stamp === null || fillTheTurns(read.stamp, watch, until)
  }

  function takeInWhatWasAdded(read: WallsRead, rows: readonly AddedWallRow[]): void {
    for (const row of rows) {
      if (row.type === 'error') {
        if (row.payload !== null && row.created_at >= read.since)
          read.rows.set(row.row, wallReadFrom({ ...row, payload: row.payload }))
      } else if (row.type === 'launched') {
        // A wall above this launch may have begun in its life.
        for (const wall of read.rows.values())
          if (wall.session_id === row.session_id && wall.ordinal > row.ordinal) delete wall.life
        const launches = read.launches.get(row.session_id)
        if (launches === undefined) continue
        // A launch read with its conversation's may be queued too.
        if (
          !launches.some((one) => one.ordinal === row.ordinal && one.created_at === row.created_at)
        )
          keepTheLaunchesOf(read, row.session_id, [
            ...launches,
            { ordinal: row.ordinal, created_at: row.created_at },
          ])
      } else {
        takeInAClear(read, row)
      }
    }
  }

  return {
    providerLimitsSeen(now, signInChangedAt, accountLives) {
      const accountOf = accountLives === undefined ? undefined : providerLimitAccounts(accountLives)
      const since = now - PROVIDER_WALL_LOOKBACK_MS
      const read = phase('read-walls', () => theWallsRead(since))
      const candidates = [...read.rows.values()].filter((row) => row.created_at >= since)
      // Count candidate ledgers, including rows that are unread or rejected.
      const ledgers = phase(
        'count-ledgers',
        () => new Set(candidates.map((row) => row.session_id)).size,
      )
      let rowsUnread = 0
      const seen = phase('select-walls', () =>
        candidates.flatMap((row) => {
          if (row.said === 'unread') {
            rowsUnread += 1
            return []
          }
          if (row.said === null) return []
          const account = accountOf?.(row.session_id, row.created_at) ?? null
          const wall = account === null ? row.said : { ...row.said, account }
          const changed = signInChangedAt?.get(wall.provider)
          if (changed === undefined) return [wall]
          if (wall.at < changed) return []
          if (row.life === undefined) row.life = lifeSinceOf(read, row)
          return row.life !== null && row.life < changed ? [] : [wall]
        }),
      )
      const retractions = phase('retractions', () =>
        takingWorkSince(
          seen,
          read,
          (sessionId, ordinal) => {
            noteUnreadRow(sessionId, ordinal, undefined)
            rowsUnread += 1
          },
          accountLives,
          now,
        ),
      )
      return {
        rows: phase('fold-walls', () => foldProviderLimits(seen, retractions, now)),
        walk: 'every-provider-wall-recently-recorded',
        ledgers,
        rowsUnread,
      }
    },
    readAheadProviderWalls(now, budgetMs) {
      return readTheWallsAhead(now, performance.now() + budgetMs)
    },
  }
}
