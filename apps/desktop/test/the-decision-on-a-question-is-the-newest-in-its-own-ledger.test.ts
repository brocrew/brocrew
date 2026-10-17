import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import type { ActedBy } from '../src/shared/who-did-it'

/**
 * # F026 · `SessionStore.theDecisionOn` — how one question was decided, and by whom
 *
 * Landing coverage for the store read `8ba2c8df` added, which the host asks when an agent answers a
 * question it had passed up: was the passed-up question answered, and by a person? ⚑ The newest
 * `user_decision` for that id in that conversation's active ledger — its outcome and its actor
 * (`null` on a row that names none) — or `null` while nothing decided it.
 *
 * ⚑ Real SQLite over the real migrations, rows written through the store's own `append`; no host.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const A_PERSON: ActedBy = { who: 'a-person' }
const THE_TOP: ActedBy = { who: 'an-agent', agent: 'sess_top' }

describe('F026 · theDecisionOn reads the newest decision on one question, in one ledger', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let clock: number
  let ordinals: Map<string, number>
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f026-store-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    ordinals = new Map()
    store = createSessionStore(db, tick)
  })

  afterEach(() => {
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const aConversation = (id: string): string => {
    store.create({ id, provider: 'claude', cwd: userData, approvalMode: 'ask', profileId: 'p' })
    return id
  }

  const row = (id: string, event: TranscriptEvent): void => {
    const ordinal = ordinals.get(id) ?? 0
    ordinals.set(id, ordinal + 1)
    store.append(id, ordinal, event, tick())
  }

  /** ⚑ A decision row; `by` left out is a row written before this app recorded who. */
  const decided = (
    id: string,
    requestId: string,
    outcome: 'answered' | 'rejected',
    by?: ActedBy,
  ): void =>
    row(
      id,
      by === undefined
        ? { type: 'user_decision', requestId, outcome }
        : { type: 'user_decision', requestId, outcome, by },
    )

  it('⛔ nothing decided it: null — for a conversation with no rows, and for one whose rows decide other questions', () => {
    const pm = aConversation('sess_pm')
    expect(store.theDecisionOn(pm, 'req_up')).toBeNull()
    decided(pm, 'req_other', 'answered', A_PERSON)
    expect(store.theDecisionOn(pm, 'req_up')).toBeNull()
    // ⚑ THE PAIR: the other question's decision is read under its own id.
    expect(store.theDecisionOn(pm, 'req_other')).toEqual({ outcome: 'answered', by: A_PERSON })
  })

  it('🔴 the NEWEST decision wins, with its actor — whichever way round they came', () => {
    const pm = aConversation('sess_pm')
    decided(pm, 'req_up', 'rejected', THE_TOP)
    decided(pm, 'req_up', 'answered', A_PERSON)
    expect(store.theDecisionOn(pm, 'req_up')).toEqual({ outcome: 'answered', by: A_PERSON })

    // ⚑ The other order, in another ledger: the agent's later row is the one read.
    const lead = aConversation('sess_lead')
    decided(lead, 'req_up', 'answered', A_PERSON)
    decided(lead, 'req_up', 'answered', THE_TOP)
    expect(store.theDecisionOn(lead, 'req_up')).toEqual({ outcome: 'answered', by: THE_TOP })
  })

  it('⛔ a row that names nobody reads `by: null` — never a person', () => {
    const pm = aConversation('sess_pm')
    decided(pm, 'req_old', 'answered')
    expect(store.theDecisionOn(pm, 'req_old')).toEqual({ outcome: 'answered', by: null })
  })

  it('⛔ only that conversation’s ledger: the same id decided in another conversation is not read', () => {
    const pm = aConversation('sess_pm')
    const other = aConversation('sess_other')
    decided(other, 'req_up', 'answered', A_PERSON)
    expect(store.theDecisionOn(pm, 'req_up')).toBeNull()
    expect(store.theDecisionOn(other, 'req_up')).toEqual({ outcome: 'answered', by: A_PERSON })
  })

  it('⛔ only a decision: a later row of another type about the same id does not stand in for one', () => {
    const pm = aConversation('sess_pm')
    decided(pm, 'req_up', 'answered', A_PERSON)
    row(pm, { type: 'question_withdrawn', requestId: 'req_up' })
    expect(store.theDecisionOn(pm, 'req_up')).toEqual({ outcome: 'answered', by: A_PERSON })
  })

  it('⛔ only the ACTIVE generation: a rebuild’s rows are read once it is promoted, and not before', () => {
    const pm = aConversation('sess_pm')
    decided(pm, 'req_up', 'answered', A_PERSON)
    const next = store.beginGeneration(pm)
    store.appendGeneration(pm, next, [
      {
        ordinal: 0,
        event: { type: 'user_decision', requestId: 'req_up', outcome: 'rejected', by: THE_TOP },
        at: tick(),
      },
    ])
    // ⛔ Being built is not being read.
    expect(store.theDecisionOn(pm, 'req_up')).toEqual({ outcome: 'answered', by: A_PERSON })
    expect(store.promoteGeneration(pm, next, { normalizerVersion: 1, derivedThrough: 0 })).toBe(
      true,
    )
    // ⚑ THE PAIR: once it is the generation every read sees, its decision is the one read.
    expect(store.theDecisionOn(pm, 'req_up')).toEqual({ outcome: 'rejected', by: THE_TOP })
  })
})
