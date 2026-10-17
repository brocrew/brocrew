import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'

/**
 * # A provider limit's life · when the life that recorded a limit began
 *
 * `providerLimitsSeen(now, signInChangedAt)` drops a limit recorded after its provider's sign-in
 * changed when the life that recorded it began before the change. That life's start is the latest
 * `created_at` among the conversation's `launched` rows whose ordinal is below the limit's, read
 * across every generation.
 *
 * | § | what it pins | why the existing tests do not reach it |
 * |---|---|---|
 * | 1 | of two launches below the limit, the later one counts: a relaunch after the change keeps the limit | every existing conversation has one launch, at ordinal 0 |
 * | 2 | a launch above the limit's ordinal is not its life | same: nothing is launched after a limit |
 * | 3 | a limit in a rebuilt generation takes its life from the launches of the generation before | every existing row is in generation 0 |
 * | 4 | a launch at the limit's own ordinal (in another generation) is not below it | same |
 *
 * Rows are written straight into `events` so each one's generation, ordinal and stamp is exact.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** A Claude limit as the Claude adapter words a `rejected`. */
const claudeWall = (window: string, resetsAt: number): string =>
  `claude is rate-limited (${window}) — the turn may stall until it resets; resets ${new Date(resetsAt).toISOString()}`

/** The instant the sign-in changed. Fixed, so every boundary is exact. */
const CHANGED = Date.UTC(2026, 9, 5, 9, 0)
const NOW = CHANGED + 60_000
const RESETS = CHANGED + 2 * 86_400_000
const BEFORE = CHANGED - 60_000
const AFTER = CHANGED + 500
const RECORDED = CHANGED + 1_000

describe('a provider limit’s life begins at the latest launch below it', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let rows = 0

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-limit-life-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function aConversation(id: string): string {
    store.create({ id, cwd: dir, approvalMode: 'ask', provider: 'claude', profileId: 'default' })
    return id
  }

  function insert(
    sessionId: string,
    generation: number,
    ordinal: number,
    type: string,
    payload: string,
    at: number,
  ): void {
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(`evt_life_${String(++rows)}`, sessionId, generation, ordinal, type, payload, at)
  }

  const launch = (sessionId: string, generation: number, ordinal: number, at: number): void =>
    insert(sessionId, generation, ordinal, 'launched', JSON.stringify({ type: 'launched' }), at)

  const limit = (sessionId: string, generation: number, ordinal: number, window: string): void =>
    insert(
      sessionId,
      generation,
      ordinal,
      'error',
      JSON.stringify({ type: 'error', message: claudeWall(window, RESETS), fatal: false }),
      RECORDED,
    )

  /** What stands, as `provider:window`, sorted. */
  const standing = (signInChangedAt?: ReadonlyMap<Provider, number>): string[] =>
    store
      .providerLimitsSeen(NOW, signInChangedAt)
      .rows.map((one) => `${one.provider}:${one.window}`)
      .sort()

  const changed = (): ReadonlyMap<Provider, number> =>
    new Map<Provider, number>([['claude', CHANGED]])

  it('⚑ relaunched after the change, below the limit → the limit stands; ⛔ one launch before the change → dropped', () => {
    const relaunched = aConversation('sess_relaunched')
    launch(relaunched, 0, 0, BEFORE)
    launch(relaunched, 0, 1, AFTER)
    limit(relaunched, 0, 2, 'five_hour')
    const oneLife = aConversation('sess_one_life')
    launch(oneLife, 0, 0, BEFORE)
    limit(oneLife, 0, 1, 'seven_day')

    expect(standing()).toEqual(['claude:five_hour', 'claude:seven_day'])
    expect(standing(changed())).toEqual(['claude:five_hour'])
  })

  it('⛔ a launch above the limit is not its life → dropped; ⚑ a life begun after the change → stands', () => {
    const later = aConversation('sess_launched_after_the_limit')
    launch(later, 0, 0, BEFORE)
    limit(later, 0, 1, 'five_hour')
    launch(later, 0, 2, CHANGED + 2_000)
    const fresh = aConversation('sess_fresh_life')
    launch(fresh, 0, 0, AFTER)
    limit(fresh, 0, 1, 'seven_day')

    expect(standing()).toEqual(['claude:five_hour', 'claude:seven_day'])
    expect(standing(changed())).toEqual(['claude:seven_day'])
  })

  it('⛔ a limit in generation 1 whose life began in generation 0 before the change → dropped; ⚑ one with no launch anywhere is judged by its own time → stands', () => {
    const rebuilt = aConversation('sess_rebuilt')
    launch(rebuilt, 0, 0, BEFORE)
    limit(rebuilt, 1, 1, 'five_hour')
    const neverLaunched = aConversation('sess_never_launched')
    limit(neverLaunched, 1, 0, 'seven_day')

    expect(standing()).toEqual(['claude:five_hour', 'claude:seven_day'])
    expect(standing(changed())).toEqual(['claude:seven_day'])
  })

  it('⛔ a launch at the limit’s own ordinal is not below it → dropped; ⚑ a limit one ordinal higher counts that launch → stands', () => {
    const both = aConversation('sess_two_generations')
    launch(both, 0, 0, BEFORE)
    launch(both, 0, 3, AFTER)
    limit(both, 1, 3, 'five_hour')
    limit(both, 1, 4, 'seven_day')

    expect(standing()).toEqual(['claude:five_hour', 'claude:seven_day'])
    expect(standing(changed())).toEqual(['claude:seven_day'])
  })
})
