import { turnEndingSchema, type TurnEnding } from '@brobot2/shared'
import type { AppDatabase, AppStatement } from './connection'
import { aPersonsOwnWords } from '../../shared/a-persons-own-words'
import { thePiecesTheTurnNames } from '../../shared/tasks'

export interface OpenTurn {
  readonly id: string
  readonly generation: number
  readonly blocked: boolean
  readonly openedAt: number
}

export interface LeftRunning {
  readonly sessionId: string
  readonly status: 'working' | 'waiting_permission'
  readonly turn: OpenTurn | null
  /** Its last recorded moment, epoch ms; `null` for a ledger with no row. */
  readonly lastAt: number | null
}

export interface TurnAsItEnded {
  /** How it ended; `null` while it is open. */
  readonly ending: TurnEnding | null
  readonly generation: number
  /** Whether its ending is this app's word, not its provider's. */
  readonly theAppsWord: boolean
  /** Whether a stop was asked of it, by a person or an agent. */
  readonly stopAsked: boolean
  /** Whether this app's continuation of a cut turn opened it. */
  readonly aContinuation: boolean
  /** Whether a person's own words opened it. */
  readonly aPersonStartedIt: boolean
  /** Whether its ending names its provider's usage limit. */
  readonly endedOnALimit: boolean
  /** Whether its provider refused the login it ran on, or the account's bill. */
  readonly refused: boolean
  readonly piecesItNamed: readonly string[]
}

export function createTurnEvidenceRead(
  db: AppDatabase,
  activeGeneration: (sessionId: string) => number,
) {
  let cutTurnStatements:
    | {
        readonly leftRunning: AppStatement
        readonly lastMoment: AppStatement
        readonly openTurn: AppStatement
        readonly newestTurn: AppStatement
        readonly turnFirstRow: AppStatement
        readonly lastLaunch: AppStatement
        readonly aTurn: AppStatement
        readonly turnBefore: AppStatement
        readonly itsRows: AppStatement
        readonly lastRouting: AppStatement
        readonly itsMessage: AppStatement
      }
    | undefined
  const cutTurnSql = (): NonNullable<typeof cutTurnStatements> =>
    (cutTurnStatements ??= {
      leftRunning: db.prepare(
        `SELECT id, status FROM provider_session WHERE status IN ('working', 'waiting_permission')`,
      ),
      lastMoment: db.prepare(
        `SELECT created_at AS at FROM events WHERE session_id = ? AND generation = ?
          ORDER BY ordinal DESC LIMIT 1`,
      ),
      openTurn: db.prepare(
        `SELECT id, blocked_at, opened_at FROM turn
          WHERE session_id = ? AND generation = ? AND closed_at IS NULL
          ORDER BY ordinal DESC LIMIT 1`,
      ),
      newestTurn: db.prepare(
        `SELECT id FROM turn WHERE session_id = ? ORDER BY generation DESC, ordinal DESC LIMIT 1`,
      ),
      turnFirstRow: db.prepare(
        `SELECT min(ordinal) AS first FROM events INDEXED BY events_turn_idx
          WHERE session_id = ? AND turn_id = ? AND generation = ?`,
      ),
      lastLaunch: db.prepare(
        `SELECT max(ordinal) AS last FROM events
          WHERE session_id = ? AND generation = ? AND ordinal < ?
            AND type IN ('launched', 'reopened')`,
      ),
      aTurn: db.prepare(
        `SELECT end_reason, generation, ordinal FROM turn WHERE id = ? AND session_id = ?`,
      ),
      turnBefore: db.prepare(
        `SELECT id, ordinal FROM turn WHERE session_id = ? AND generation = ? AND ordinal < ?
          ORDER BY ordinal DESC LIMIT 1`,
      ),
      itsRows: db.prepare(
        `SELECT type, payload FROM events INDEXED BY events_turn_idx
          WHERE session_id = ? AND turn_id = ? AND generation = ?
            AND type IN ('turn', 'work_interrupted', 'user_decision', 'user_turn')`,
      ),
      lastRouting: db.prepare(
        `SELECT ordinal FROM events
          WHERE session_id = ? AND generation = ? AND type = 'request_routed'
            AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.requestId') END = ?
          ORDER BY ordinal DESC LIMIT 1`,
      ),
      itsMessage: db.prepare(
        `SELECT type, payload FROM events
          WHERE session_id = ? AND type IN ('message_queued', 'message_unqueued')
            AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.messageId') END = ?`,
      ),
    })
  const theOpenTurnOf = (sessionId: string): OpenTurn | null => {
    const generation = activeGeneration(sessionId)
    const row = cutTurnSql().openTurn.get(sessionId, generation) as
      { id: string; blocked_at: number | null; opened_at: number } | undefined
    if (row === undefined) return null
    return { id: row.id, generation, blocked: row.blocked_at !== null, openedAt: row.opened_at }
  }

  function whatACrashLeftRunning(running: ReadonlySet<string>): readonly LeftRunning[] {
    const sql = cutTurnSql()
    return (sql.leftRunning.all() as { id: string; status: LeftRunning['status'] }[])
      .filter((row) => !running.has(row.id))
      .map((row) => {
        const last = sql.lastMoment.get(row.id, activeGeneration(row.id)) as
          { at: number } | undefined
        return {
          sessionId: row.id,
          status: row.status,
          turn: theOpenTurnOf(row.id),
          lastAt: last?.at ?? null,
        }
      })
  }

  function theOpenTurn(sessionId: string): OpenTurn | null {
    return theOpenTurnOf(sessionId)
  }

  function theNewestTurn(sessionId: string): string | null {
    const row = cutTurnSql().newestTurn.get(sessionId) as { id: string } | undefined
    return row?.id ?? null
  }

  function aLifeOpenedTheTurn(
    sessionId: string,
    turnId: string,
    life: { readonly generation: number; readonly launched: number },
  ): boolean {
    const sql = cutTurnSql()
    const turn = sql.aTurn.get(turnId, sessionId) as { generation: number } | undefined
    if (turn === undefined || turn.generation !== life.generation) return false
    const first = (
      sql.turnFirstRow.get(sessionId, turnId, life.generation) as { first: number | null }
    ).first
    if (first === null) return false
    const last = (sql.lastLaunch.get(sessionId, life.generation, first) as { last: number | null })
      .last
    return last === life.launched
  }

  function howATurnEnded(sessionId: string, turnId: string): TurnAsItEnded | null {
    const sql = cutTurnSql()
    const row = sql.aTurn.get(turnId, sessionId) as
      { end_reason: string | null; generation: number; ordinal: number } | undefined
    if (row === undefined) return null
    let theAppsWord = false
    let stopAsked = false
    let aContinuation = false
    let aPersonStartedIt = false
    let endedOnALimit = false
    let refused = false
    const piecesItNamed = new Set<string>()
    /** The pieces a `user_turn` row's words name, into {@link piecesItNamed}. */
    const theyName = (parts: readonly Record<string, unknown>[]): void => {
      const named = thePiecesTheTurnNames(
        parts.map((part) => ({
          ...(typeof part['piece'] === 'string' ? { piece: part['piece'] } : {}),
          ...(typeof part['drives'] === 'string' ? { drives: part['drives'] } : {}),
        })),
      )
      for (const one of named) piecesItNamed.add(one)
    }
    const partsOf = (said: Record<string, unknown>): readonly Record<string, unknown>[] =>
      Array.isArray(said['parts']) ? (said['parts'] as Record<string, unknown>[]) : [said]
    let itAskedForTheStop = false
    for (const one of sql.itsRows.all(sessionId, turnId, row.generation) as {
      type: string
      payload: string
    }[]) {
      let said: Record<string, unknown>
      try {
        said = JSON.parse(one.payload) as Record<string, unknown>
      } catch {
        continue
      }
      if (one.type === 'turn' && said['wordOf'] === 'this-app') theAppsWord = true
      if (one.type === 'turn') {
        if (said['loginRefused'] === true || said['billingRefused'] === true) refused = true
        if (typeof said['limit'] === 'object' && said['limit'] !== null) endedOnALimit = true
      }
      if (one.type === 'work_interrupted') stopAsked = true
      if (
        one.type === 'user_decision' &&
        said['outcome'] === 'cancel' &&
        said['stopsNothing'] !== true
      ) {
        stopAsked = true
      }
      if (one.type === 'user_turn') {
        const parts = partsOf(said)
        for (const part of parts) {
          if (part['appNotice'] === 'a-turn-the-app-cut') aContinuation = true
          if (aPersonsOwnWords(part as Parameters<typeof aPersonsOwnWords>[0])) {
            aPersonStartedIt = true
          }
        }
        theyName(parts)
        if (said['askedForTheStop'] === true) itAskedForTheStop = true
      }
    }
    let asking = itAskedForTheStop
    let from = row.ordinal
    while (asking) {
      const before = sql.turnBefore.get(sessionId, row.generation, from) as
        { id: string; ordinal: number } | undefined
      if (before === undefined) break
      asking = false
      for (const one of sql.itsRows.all(sessionId, before.id, row.generation) as {
        type: string
        payload: string
      }[]) {
        if (one.type !== 'user_turn') continue
        let said: Record<string, unknown>
        try {
          said = JSON.parse(one.payload) as Record<string, unknown>
        } catch {
          continue
        }
        theyName(partsOf(said))
        if (said['askedForTheStop'] === true) asking = true
      }
      from = before.ordinal
    }
    const ending = row.end_reason === null ? null : turnEndingSchema.safeParse(row.end_reason)
    return {
      ending: ending === null ? null : ending.success ? ending.data : 'unknown',
      generation: row.generation,
      theAppsWord,
      stopAsked,
      aContinuation,
      aPersonStartedIt,
      endedOnALimit,
      refused,
      piecesItNamed: [...piecesItNamed],
    }
  }

  function whereItWasRouted(sessionId: string, requestId: string): number | null {
    try {
      const row = cutTurnSql().lastRouting.get(
        sessionId,
        activeGeneration(sessionId),
        requestId,
      ) as { ordinal: number } | undefined
      return row?.ordinal ?? null
    } catch (error) {
      console.warn(
        `session store could not find where ${requestId} was routed in ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      )
      return null
    }
  }

  function whatBecameOfAMessage(
    sessionId: string,
    messageId: string,
  ): 'sent' | 'ended' | 'waiting' | 'absent' {
    let held = false
    let ended: 'sent' | 'ended' | null = null
    for (const one of cutTurnSql().itsMessage.all(sessionId, messageId) as {
      type: string
      payload: string
    }[]) {
      if (one.type === 'message_queued') held = true
      else {
        let said: Record<string, unknown> = {}
        try {
          said = JSON.parse(one.payload) as Record<string, unknown>
        } catch {
          // An unreadable ending is still an ending.
        }
        ended = said['reason'] === 'sent' ? 'sent' : (ended ?? 'ended')
      }
    }
    if (ended !== null) return ended
    return held ? 'waiting' : 'absent'
  }

  return {
    whatACrashLeftRunning,
    theOpenTurn,
    theNewestTurn,
    aLifeOpenedTheTurn,
    howATurnEnded,
    whereItWasRouted,
    whatBecameOfAMessage,
  }
}
