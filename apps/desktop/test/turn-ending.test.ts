import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TURN_ENDINGS, type TurnEnding } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  ENDING_SENTENCE,
  ENDING_WORD,
  endedUnfinished,
  endingLabel,
} from '../src/renderer/src/lib/ending'

/**
 * # ⛔ A word that cannot tell two endings apart (Slice 2 · 222, from `220` finding 2)
 *
 * > *"Quit the whole app while a shell command is running. Reopen it. Look at the rail and Sessions
 * > BEFORE resuming anything."* — **three closed threads, and every Sessions row said `ended`, the
 * > same word a clean finish gets.** Only Resume revealed *"did not finish"* and *"turn
 * > interrupted"*.
 *
 * The fact was in the ledger the whole time. 045 gave `turn.end_reason` five members precisely so
 * an unobserved ending would be recorded rather than back-filled; nothing read it. These tests are
 * about the read, the word, and the one place the ending was being over-claimed (222 §3).
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe('222 · the vocabulary is one list', () => {
  /**
   * ⛔ **Read out of a MIGRATED DATABASE, not out of the source text.**
   *
   * `TURN_ENDINGS` now governs a wire field, a renderer's two word tables and the store's
   * narrowing; the column is governed by a CHECK written in migration `0009`. A source census would
   * compare two strings in the repository — this compares the list against the constraint SQLite is
   * actually enforcing, which is the only copy that can reject a write.
   */
  it('the shared enum is exactly what the database CHECK allows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brobot2-ending-check-'))
    const db = openDatabase(join(dir, 'db.sqlite'))
    try {
      applyMigrations(db, migrationsFolder)
      const ddl = (
        db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'turn'`).get() as
          { sql: string } | undefined
      )?.sql
      expect(ddl, 'the turn table must exist for this to be measuring anything').toBeTruthy()
      // The CHECK reads `end_reason is null or end_reason in ('completed', …)`. Take the members of
      // that `in (…)` list, in the order the constraint states them.
      const members = /end_reason.{0,40}?\bin\s*\(([^)]*)\)/i.exec(ddl ?? '')?.[1]
      expect(members, `no end_reason IN (…) constraint found in: ${ddl}`).toBeTruthy()
      const allowed = (members ?? '').split(',').map((piece) => piece.trim().replace(/^'|'$/g, ''))
      expect(allowed).toEqual([...TURN_ENDINGS])
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  /** Every member has both words, and neither table has a member the enum does not. */
  it('every ending has a word and a sentence, and no table has a sixth', () => {
    expect(Object.keys(ENDING_WORD).sort()).toEqual([...TURN_ENDINGS].sort())
    expect(Object.keys(ENDING_SENTENCE).sort()).toEqual([...TURN_ENDINGS].sort())
    for (const ending of TURN_ENDINGS) {
      expect(ENDING_WORD[ending], `${ending} has no word`).not.toBe('')
      expect(ENDING_SENTENCE[ending], `${ending} has no sentence`).not.toBe('')
    }
    // ⛔ **Distinct words, which is the entire complaint.** `220` met five endings wearing one; a
    // vocabulary that mapped two of them to the same string would reproduce it one layer up.
    expect(new Set(Object.values(ENDING_WORD)).size).toBe(TURN_ENDINGS.length)
    expect(new Set(Object.values(ENDING_SENTENCE)).size).toBe(TURN_ENDINGS.length)
  })

  /**
   * ⚠️ **`unknown` must not claim the turn did not finish** (208 H3). We stopped watching; that is
   * not the same as it having stopped, and the sentence is the only place that distinction is said
   * to a person.
   */
  it('the unknown sentence says what we did not see, never what did not happen', () => {
    expect(ENDING_SENTENCE.unknown).toContain('never saw')
    expect(ENDING_SENTENCE.unknown).not.toMatch(/never finished|did not finish|was killed/)
  })
})

describe('222 §2 · the store derives the ending, on every shape that leaves it', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let at = 1_700_000_000_000
  let ordinal = 0

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-ending-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    at = 1_700_000_000_000
    ordinal = 0
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const REF = (id: string): TranscriptEvent => ({
    type: 'session',
    state: 'started',
    ref: { provider: 'claude', sessionId: id, cwd: dir, rotation: 0 },
  })

  /** One conversation that took a turn and ended it the given way. */
  function conversation(id: string, ending: 'completed' | 'failed' | 'interrupted'): void {
    store.create({ id, provider: 'claude', cwd: dir, approvalMode: 'ask', profileId: 'default' })
    const feed = (event: TranscriptEvent): void => store.append(id, ordinal++, event, ++at)
    feed(REF(id))
    feed({ type: 'user_turn', text: 'do the thing' })
    feed({ type: 'turn', state: ending })
  }

  const endingOf = (id: string): TurnEnding | null =>
    store.recorded().find((row) => row.sessionId === id)?.lastEnding ?? null

  it("reports the provider's own three endings, unchanged", () => {
    conversation('sess_ok', 'completed')
    conversation('sess_bad', 'failed')
    conversation('sess_stopped', 'interrupted')

    expect(endingOf('sess_ok')).toBe('completed')
    expect(endingOf('sess_bad')).toBe('failed')
    expect(endingOf('sess_stopped')).toBe('interrupted')
  })

  /**
   * ⛔ **`220`'s gesture, at the layer that records it.** A session going terminal underneath an
   * open turn is a different ending from a turn that finished — and both leave `status = 'ended'`,
   * which is exactly why one word could not tell them apart.
   */
  it('a session that ended UNDERNEATH an open turn reads `ended`, beside an identical status', () => {
    conversation('sess_clean', 'completed')
    store.create({
      id: 'sess_cut',
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
    store.append('sess_cut', ordinal++, REF('sess_cut'), ++at)
    store.append('sess_cut', ordinal++, { type: 'user_turn', text: 'run the build' }, ++at)
    store.append('sess_cut', ordinal++, { type: 'status', state: 'ended' }, ++at)
    // The clean one has to reach `ended` too, or the pair proves nothing about the word.
    store.append('sess_clean', ordinal++, { type: 'status', state: 'ended' }, ++at)

    const rows = store.recorded()
    const clean = rows.find((row) => row.sessionId === 'sess_clean')
    const cut = rows.find((row) => row.sessionId === 'sess_cut')
    // ⚑ The whole finding, in two lines: the same status, two different endings.
    expect(clean?.status).toBe('ended')
    expect(cut?.status).toBe('ended')
    expect(clean?.lastEnding).toBe('completed')
    expect(cut?.lastEnding).toBe('ended')
  })

  /** The crash half: the row is repaired on the next launch, and says so. */
  it('a turn stranded by a crash reads `unknown` after the startup sweep', () => {
    store.create({
      id: 'sess_crashed',
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
    store.append('sess_crashed', ordinal++, REF('sess_crashed'), ++at)
    store.append('sess_crashed', ordinal++, { type: 'user_turn', text: 'npm test' }, ++at)
    store.append('sess_crashed', ordinal++, { type: 'status', state: 'working' }, ++at)
    // Nothing else — the process died here. Then the next launch sweeps.
    expect(store.recorded()[0]?.lastEnding).toBeNull()
    expect(store.settleOrphanRuns(++at, new Set())).toBe(1)

    const row = store.recorded()[0]
    expect(row?.lastEnding).toBe('unknown')
    // ⚠️ **And the status says `idle`, not `ended`.** A crash reaches no finalizer, so the repair
    // settles the row rather than terminalizing it — which means the SECOND surface word for this
    // case was `idle`, about a conversation whose turn was killed mid-flight.
    expect(row?.status).toBe('idle')
  })

  /**
   * ⛔ **The newest CLOSED turn, not the newest turn.** A conversation that is running again has an
   * open turn with no ending; taking its null would make it indistinguishable from one we hold no
   * turns for at all.
   */
  it('an open turn does not erase the ending of the one before it', () => {
    conversation('sess_again', 'interrupted')
    store.append('sess_again', ordinal++, { type: 'user_turn', text: 'try again' }, ++at)

    expect(store.recorded()[0]?.lastEnding).toBe('interrupted')
  })

  /**
   * ⛔ **The LAST ending, not the first.** A conversation that was cut off and then finished on a
   * later attempt is finished; reading its history the other way round would keep telling a person
   * to go back to work they have already done.
   */
  it('the NEWEST closed turn wins over an older one that ended differently', () => {
    conversation('sess_two', 'interrupted')
    store.append('sess_two', ordinal++, { type: 'user_turn', text: 'try again' }, ++at)
    store.append('sess_two', ordinal++, { type: 'turn', state: 'completed' }, ++at)
    expect(store.turns('sess_two').map((turn) => turn.endReason)).toEqual([
      'interrupted',
      'completed',
    ])

    expect(store.recorded()[0]?.lastEnding).toBe('completed')
  })

  /** A session that never took a turn has no ending, and says nothing rather than `completed`. */
  it('a conversation with no closed turn reports null', () => {
    store.create({
      id: 'sess_empty',
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
    store.append('sess_empty', ordinal++, REF('sess_empty'), ++at)

    expect(store.recorded()[0]?.lastEnding).toBeNull()
  })

  /**
   * ⛑ **The three lists cannot disagree.** `resumable()`, `unresumable()` and `recorded()` are three
   * reads of one query through three mappers, and the rail folds two of them into one row shape —
   * so an ending on one and not the others is a surface describing one conversation two ways.
   */
  it('resumable, unresumable and recorded report the same ending for one row', () => {
    conversation('sess_shared', 'interrupted')
    const recorded = store.recorded().find((row) => row.sessionId === 'sess_shared')
    const resumable = store.resumable().find((row) => row.sessionId === 'sess_shared')
    expect(recorded?.lastEnding).toBe('interrupted')
    // A positive on the offerable half, so this is not satisfied by both being empty.
    expect(resumable, 'the fixture must be offerable for the pair to mean anything').toBeTruthy()
    expect(resumable?.lastEnding).toBe('interrupted')

    // …and the other half, on a row that genuinely has no ref to resume from.
    store.create({
      id: 'sess_noref',
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
    store.append('sess_noref', ordinal++, { type: 'user_turn', text: 'hello' }, ++at)
    store.append('sess_noref', ordinal++, { type: 'turn', state: 'failed' }, ++at)
    const unresumable = store.unresumable().find((row) => row.sessionId === 'sess_noref')
    expect(unresumable, 'the refless row must reach the unresumable list').toBeTruthy()
    expect(unresumable?.lastEnding).toBe('failed')
  })

  /** An unrecognised value on disk reads as `unknown` — never as itself, and never as `completed`. */
  it('a reason the enum does not know reads as unknown', () => {
    conversation('sess_weird', 'completed')
    // Straight into the table, past the store: an older build, or a hand-edited row. The CHECK
    // permits only the five, so the write is done with the constraint suspended.
    db.exec('PRAGMA ignore_check_constraints = ON')
    db.prepare(`UPDATE turn SET end_reason = 'abandoned' WHERE session_id = 'sess_weird'`).run()
    db.exec('PRAGMA ignore_check_constraints = OFF')

    expect(store.recorded()[0]?.lastEnding).toBe('unknown')
  })
})

describe('222 §4 · the word, and which surface says it', () => {
  /**
   * ⚠️ **The Sessions page draws every ending, a finish included** — see the note on `completed` in
   * `ending.ts`: absence there means only that we hold no closed turn for the row.
   */
  it('the Sessions page says "finished"', () => {
    expect(endingLabel('completed')?.word).toBe('finished')
    expect(endingLabel(null)).toBeNull()
  })

  it('only a finish counts as finished', () => {
    expect(endedUnfinished('completed')).toBe(false)
    expect(endedUnfinished(null)).toBe(false)
    for (const ending of TURN_ENDINGS.filter((value) => value !== 'completed')) {
      expect(endedUnfinished(ending), `${ending} is not a finish`).toBe(true)
    }
  })

  /**
   * ⛑ **The parity invariant, in `219`'s shape, was asked of the rail's CLOSED list** — wherever
   * both surfaces said something about one conversation's ending, they said the same word.
   * ⚑ **D-017b · the rail has no closed list** (`closed-threads.ts` went with the open/closed split):
   * its ONE list (`conversation-list.ts`) says the one state and never an ending, so the rail has no
   * word left to disagree with the Sessions row. The Sessions page's half is `endingLabel` above.
   */
})
