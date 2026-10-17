import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { exchangePreviewLines } from '../src/shared/last-exchange'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 F080 — a turn its provider started, in the store: what it followed, where it stands, and
 * what the last exchange says after it
 *
 * `a-turn-its-provider-started-reads-as-its-own.test.ts` pins the wake's own transcript entry, the
 * `turn` bound and the joined row. These pin the rest of what the store does with `provider_turn`:
 *
 *  - §1 · *what ended before it* is bounded by the newest of the previous turn's ending, ITS
 *    OPENING (a `user_turn` or a `provider_turn` that never ended), or a reopen — each bound alone;
 *    and only a provider's own words (a text summary) are quoted;
 *  - §2 · a wake opens a turn row of its own even while another wake's row is open (it never
 *    "joins" one — only a message does), and it counts as one of `turns_back`;
 *  - §3 · the status column reads `working` through a wake, and a card raised in one has a row to
 *    say `waiting_permission` on;
 *  - §4 · the last exchange says when its provider started a turn after the last message, and only
 *    then — the stall notice's preview reads it.
 *
 * ⚑ Planted straight into the store, in the order the machine and the host write them.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')
const ID = 'sess_woken'
const X = 'Background command "sleep 20" completed (exit code 0)'

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
const wakeEnds: TranscriptEvent = { type: 'turn', state: 'completed', startedBy: 'the-provider' }

/** What each wake in the transcript followed, oldest first. */
const whatWokeEach = (): (readonly string[])[] =>
  store
    .transcript(ID, { back: 10, search: null })
    .turns.flatMap((turn) =>
      'startedByItsProvider' in turn ? [turn.startedByItsProvider.after] : [],
    )

/** The status column, read where `updateStatus` writes it. */
const column = (): string =>
  (db.prepare(`SELECT status FROM provider_session WHERE id = ?`).get(ID) as { status: string })
    .status

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'brobot2-wake-followed-'))
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

describe('§1 · what a wake followed is bounded by the turn before it — each bound alone', () => {
  it('🔴 a message’s turn that never ended bounds it at its OPENING', () => {
    put(
      { type: 'user_turn', text: 'first' },
      { type: 'turn', state: 'completed' },
      background(X),
      // ⚑ A message sent after the work ended, whose turn wrote no ending.
      { type: 'user_turn', text: 'second' },
      says('on it'),
      { type: 'provider_turn' },
      says('woke'),
      wakeEnds,
    )
    expect(
      whatWokeEach(),
      'work that ended before a message was quoted as waking the wake',
    ).toEqual([[]])
  })

  it('⚑ the control — with no message between, the same work is what woke it', () => {
    put(
      { type: 'user_turn', text: 'first' },
      { type: 'turn', state: 'completed' },
      background(X),
      { type: 'provider_turn' },
      says('woke'),
      wakeEnds,
    )
    expect(whatWokeEach()).toEqual([[X]])
  })

  it('🔴 a wake that never ended bounds the next one at its opening', () => {
    put(
      background(X),
      { type: 'provider_turn' },
      says('first wake, cut off'),
      { type: 'provider_turn' },
      says('second wake'),
      wakeEnds,
    )
    expect(whatWokeEach()).toEqual([[X], []])
  })

  it('🔴 a reopen bounds it: work that ended in the life before woke nothing in this one', () => {
    put(
      { type: 'user_turn', text: 'go' },
      { type: 'turn', state: 'completed' },
      background(X),
      { type: 'reopened' } as TranscriptEvent,
      { type: 'provider_turn' },
      says('woke after the reopen'),
      wakeEnds,
    )
    expect(whatWokeEach()).toEqual([[]])
  })

  it('⛔ only the provider’s own words are quoted — an ending with no summary, a level, a number, are not', () => {
    put(
      { type: 'user_turn', text: 'go' },
      { type: 'turn', state: 'completed' },
      {
        type: 'background_work',
        running: [{ id: 'b2', toolCallId: 'c2', kind: 'local_bash' }],
        source: 'test',
      } as TranscriptEvent,
      {
        type: 'background_work',
        ended: { id: 'b3', outcome: 'completed' },
        source: 'test',
      } as TranscriptEvent,
      {
        type: 'background_work',
        ended: { id: 'b4', outcome: 'completed', summary: 42 },
        source: 'test',
      } as unknown as TranscriptEvent,
      background(X),
      { type: 'provider_turn' },
      says('woke'),
      wakeEnds,
    )
    expect(whatWokeEach()).toEqual([[X]])
  })
})

describe('§2 · a wake is a turn of its own', () => {
  it('🔴 a wake opening while another wake’s row is open closes that row — it never joins it', () => {
    put(
      { type: 'provider_turn' },
      says('first wake'),
      { type: 'provider_turn' },
      says('second wake'),
      wakeEnds,
    )
    expect(store.turns(ID).map((turn) => [turn.prompt, turn.endReason])).toEqual([
      ['', 'unknown'],
      ['', 'completed'],
    ])
  })

  it('⚑ the control — a message opening while a wake’s row is open joins it', () => {
    put(
      { type: 'provider_turn' },
      says('a wake'),
      { type: 'user_turn', text: 'joins it' },
      says('both done'),
      wakeEnds,
    )
    expect(store.turns(ID).map((turn) => [turn.prompt, turn.endReason])).toEqual([
      ['', 'completed'],
    ])
  })

  it('⚑ it is one of `turns_back`: a read of one turn is the wake, and says there are older', () => {
    put(
      { type: 'user_turn', text: 'go' },
      says('started it'),
      { type: 'turn', state: 'completed' },
      { type: 'provider_turn' },
      wakeEnds,
    )
    const one = store.transcript(ID, { back: 1, search: null })
    expect(one.older).toBe(true)
    expect(one.turns).toHaveLength(1)
    // ⚑ A wake that said nothing says so: no words, not the words of the turn before it.
    expect(one.turns[0]).toEqual({
      at: expect.any(Number),
      startedByItsProvider: { after: [] },
      said: null,
    })
    const two = store.transcript(ID, { back: 2, search: null })
    expect(two.older).toBe(false)
    expect(two.turns.map((turn) => 'received' in turn)).toEqual([true, false])
    expect(two.turns[0]).toMatchObject({ said: { text: 'started it' } })
  })
})

describe('§3 · the status column through a wake', () => {
  it('🔴 `working` while it runs, `waiting_permission` under its card, `idle` after its ending', () => {
    put({ type: 'user_turn', text: 'go' }, { type: 'turn', state: 'completed' })
    put({ type: 'status', state: 'idle' })
    expect(column()).toBe('idle')
    put({ type: 'provider_turn' }, { type: 'status', state: 'working' })
    expect(column()).toBe('working')
    // ⚑ A card raised inside the wake: the wake's row carries it.
    put({ type: 'status', state: 'waiting_permission' })
    expect(column()).toBe('waiting_permission')
    put({ type: 'status', state: 'working' }, says('answered'), wakeEnds)
    expect(column()).toBe('idle')
  })

  it('⚑ the control — the same card with no turn and no wake open has no row to say it on', () => {
    put({ type: 'user_turn', text: 'go' }, { type: 'turn', state: 'completed' })
    put({ type: 'status', state: 'working' }, { type: 'status', state: 'waiting_permission' })
    expect(column()).toBe('idle')
  })
})

describe('§4 · the last exchange after a wake', () => {
  it('🔴 a wake after the last message: its words are the latest, and they are no answer', () => {
    put(
      { type: 'user_turn', text: 'run it in the background, then stop' },
      says('started it'),
      { type: 'turn', state: 'completed' },
      background(X),
      { type: 'provider_turn' },
      says('the sleep finished'),
      wakeEnds,
    )
    const exchange = store.lastExchange(ID)
    expect(exchange).toMatchObject({
      received: {
        from: { is: 'a-person' },
        words: { text: 'run it in the background, then stop', clipped: false },
      },
      answer: { text: 'the sleep finished', clipped: false },
      sinceThenItsProviderStartedATurn: true,
    })
    const lines = exchangePreviewLines('the worker', exchange, (who) => who.conversation)
    expect(lines[0]).toBe(
      'Its last turn was one its provider started by itself. The last message it received came from a person, who wrote:',
    )
    expect(lines).toContain("the worker's latest words start:")
    expect(lines).not.toContain("the worker's answer starts:")
  })

  it('⚑ the control — a message that joined the wake is the last turn’s, and its answer is an answer', () => {
    put(
      { type: 'user_turn', text: 'first' },
      { type: 'turn', state: 'completed' },
      { type: 'provider_turn' },
      says('on my own'),
      { type: 'user_turn', text: 'and also this' },
      says('both done'),
      wakeEnds,
    )
    const exchange = store.lastExchange(ID)
    expect(exchange).not.toHaveProperty('sinceThenItsProviderStartedATurn')
    expect(exchange.answer).toEqual({ text: 'both done', clipped: false })
    const lines = exchangePreviewLines('the worker', exchange, (who) => who.conversation)
    expect(lines[0]).toBe('Its last turn answered a person, who wrote:')
    expect(lines).toContain("the worker's answer starts:")
  })

  it('⚑ …and a wake BEFORE the last message is no part of its exchange', () => {
    put(
      { type: 'provider_turn' },
      says('on my own'),
      wakeEnds,
      { type: 'user_turn', text: 'next' },
      says('done'),
      { type: 'turn', state: 'completed' },
    )
    expect(store.lastExchange(ID)).not.toHaveProperty('sinceThenItsProviderStartedATurn')
  })
})
