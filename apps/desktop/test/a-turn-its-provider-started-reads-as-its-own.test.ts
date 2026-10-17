import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **F080's follow-ups — a turn its provider started by itself reads as its own, in the record**
 *
 *  - §1 · `read_transcript`'s turns: a wake is a turn of its own, with what its provider said ended
 *    just before it (*"Background command … completed"*), never words filed under the message
 *    before it.
 *  - §2 · a message that joins a wake joins its turn: ONE row, closed by that loop's own ending —
 *    never a row closed `unknown` and a second one beside it.
 *
 * ⚑ Planted straight into the store, in the order the machine and the host write them: the host
 * writes `user_turn` once the provider has the message.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')
const ID = 'sess_woken'
const ENDED = 'Background command "sleep 20" completed (exit code 0)'

let userData: string
let db: AppDatabase
let store: SessionStore
let clock: number
let ordinal: number

const put = (...events: TranscriptEvent[]): void => {
  for (const event of events) store.append(ID, ordinal++, event, (clock += 1_000))
}
const says = (text: string): TranscriptEvent => ({ type: 'assistant_message', text })
const background = (summary: string): TranscriptEvent =>
  ({
    type: 'background_work',
    ended: { id: 'b1', outcome: 'completed', summary },
    source: 'task_notification',
  }) as TranscriptEvent

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'brobot2-provider-turn-'))
  db = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(db, migrationsDir)
  clock = 5_000_000
  ordinal = 0
  store = createSessionStore(db, () => clock)
  store.create({
    id: ID,
    provider: 'claude',
    cwd: userData,
    approvalMode: 'ask',
    profileId: 'worker',
  })
})

afterEach(() => {
  db.close()
  rmSync(userData, { recursive: true, force: true })
})

describe('§1 · read_transcript — a turn its provider started is its own entry', () => {
  it('🔴 the wake is a turn of its own, after what its provider said ended', () => {
    put(
      { type: 'user_turn', text: 'run sleep 20 in the background, then stop' },
      says('started it'),
      { type: 'turn', state: 'completed' },
      background(ENDED),
      { type: 'provider_turn' },
      says('the sleep finished'),
      { type: 'turn', state: 'completed', startedBy: 'the-provider' },
    )
    const { turns, older } = store.transcript(ID, { back: 5, search: null })
    expect(older).toBe(false)
    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({
      received: { words: { text: 'run sleep 20 in the background, then stop' } },
      said: { text: 'started it' },
    })
    // ⛔ Until this follow-up the wake's words were the message's: `started it\n\nthe sleep finished`.
    expect(turns[1]).toEqual({
      at: expect.any(Number),
      startedByItsProvider: { after: [ENDED] },
      said: { text: 'the sleep finished', clipped: false },
    })
    // ⚑ A search finds the whole wake.
    const found = store.transcript(ID, { back: 3, search: 'SLEEP FINISHED' })
    expect(found.turns).toHaveLength(1)
    expect(found.turns[0]).toMatchObject({ startedByItsProvider: { after: [ENDED] } })
  })

  it('⚑ …and not what woke a wake before a reopen', () => {
    put(
      { type: 'user_turn', text: 'go' },
      { type: 'turn', state: 'completed' },
      background('Background command "first" completed (exit code 0)'),
      { type: 'provider_turn' },
      says('cut off by a quit'),
      { type: 'reopened' } as TranscriptEvent,
      background(ENDED),
      { type: 'provider_turn' },
      says('the sleep finished'),
      { type: 'turn', state: 'completed', startedBy: 'the-provider' },
    )
    const { turns } = store.transcript(ID, { back: 5, search: null })
    expect(
      turns.map((turn) => ('startedByItsProvider' in turn ? turn.startedByItsProvider : null)),
    ).toEqual([
      null,
      { after: ['Background command "first" completed (exit code 0)'] },
      { after: [ENDED] },
    ])
  })

  it('⚑ only what ended after the turn before — background work that ended inside a turn woke nothing', () => {
    put(
      { type: 'user_turn', text: 'go' },
      background('Background command "ls" completed (exit code 0)'),
      says('done'),
      { type: 'turn', state: 'completed' },
      { type: 'provider_turn' },
      says('on my own'),
      { type: 'turn', state: 'completed', startedBy: 'the-provider' },
    )
    expect(store.transcript(ID, { back: 5, search: null }).turns[1]).toMatchObject({
      startedByItsProvider: { after: [] },
    })
  })
})

describe('§2 · a message that joins a wake joins its turn', () => {
  it('🔴 one row, opened by the provider, closed by that loop’s own ending — never `unknown`', () => {
    put(
      { type: 'user_turn', text: 'first' },
      { type: 'turn', state: 'completed' },
      { type: 'provider_turn' },
      says('working on my own'),
      // ⚑ The person's message, which the CLI folds into the loop it is running.
      { type: 'user_turn', text: 'and also this' },
      says('both done'),
      { type: 'turn', state: 'completed', startedBy: 'the-provider' },
    )
    const turns = store.turns(ID)
    expect(turns).toHaveLength(2)
    expect(turns[1]).toMatchObject({ prompt: '', endReason: 'completed' })
    expect(turns.some((turn) => turn.endReason === 'unknown')).toBe(false)
    expect(store.lastEndedTurn(ID)).toMatchObject({ startedByItsProvider: true })
  })

  it('⚑ only a row no message joined yet, and never one a crash left open across a reopen', () => {
    put(
      { type: 'provider_turn' },
      says('on my own'),
      { type: 'user_turn', text: 'joins it' },
      // ⚑ A second message is a turn of its own, whatever is still open.
      { type: 'user_turn', text: 'a turn of its own' },
      { type: 'turn', state: 'completed' },
      // ⚑ A wake the app quit in the middle of: no ending was written, and the reopen ends it.
      { type: 'provider_turn' },
      says('cut off'),
      { type: 'reopened' } as TranscriptEvent,
      { type: 'user_turn', text: 'after the reopen' },
      { type: 'turn', state: 'completed' },
    )
    expect(store.turns(ID).map((turn) => [turn.prompt, turn.endReason])).toEqual([
      ['', 'unknown'],
      ['a turn of its own', 'completed'],
      ['', 'unknown'],
      ['after the reopen', 'completed'],
    ])
  })

  it('⚑ the control — a message after the wake ended opens a turn of its own', () => {
    put(
      { type: 'provider_turn' },
      says('on my own'),
      { type: 'turn', state: 'completed', startedBy: 'the-provider' },
      { type: 'user_turn', text: 'next' },
      { type: 'turn', state: 'completed' },
    )
    const turns = store.turns(ID)
    expect(turns.map((turn) => [turn.prompt, turn.endReason])).toEqual([
      ['', 'completed'],
      ['next', 'completed'],
    ])
    expect(store.lastEndedTurn(ID)).not.toHaveProperty('startedByItsProvider')
  })
})
