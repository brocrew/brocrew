import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionMachine, type RuntimeEvent, type SessionRef } from '@brobot2/runtime'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { ENDING_WORD } from '../src/renderer/src/lib/ending'

/**
 * ⛔ **`cut off` — the word `222` shipped that no gesture produces** (246 §2, from `244`).
 *
 * `244` tried to reach it and could not: *"Close first terminates an open turn as `interrupted`. The
 * `ended` turn reason that renders as `cut off` is reachable in synthetic store evidence, but there
 * is no safe natural person-level adapter gesture for it."*
 *
 * ## Why, and it is not an oversight
 *
 * ⛔ **`end_reason = 'ended'` has exactly ONE writer** — `session-store.ts`'s `appendTx`, when a
 * `status: ended | errored` lands while a turn is still open. So the word is produced only by a
 * session going terminal UNDER a turn whose own ending was never announced.
 *
 * ⚑ **And this project forbade that ordering in `010`, on every adapter.** `023 P1-A` is *"never
 * zero terminal turns"*, and `conformance.test.ts` asserts it against Fake, the Claude seam and the
 * Codex seam in one suite:
 *
 * > `close() mid-turn emits exactly one terminal turn (interrupted) → idle → ended → status:ended`
 *
 * The terminal `turn` arrives BEFORE `status:'ended'`, so `appendTx` has already closed the row as
 * `interrupted` by the time the only line that can write `ended` runs. Every fatal path is the same
 * shape: `SessionMachine.fatalError` and `fatalAfterReportedError` both go through
 * `terminalizeErrored`, which emits a terminal `turn` before `status:'errored'`.
 *
 * ⚠️ **So `222` shipped a fifth word whose producer had been closed off two hundred dispatches
 * earlier, and nothing connected the two facts.** This file is that connection: it drives the real
 * {@link SessionMachine} through the teardown both adapters perform, feeds what it emits to a real
 * {@link SessionStore}, and reads the word off the same table the Sessions page reads.
 *
 * ## What is NOT concluded here
 *
 * ⛔ **The word is not dead code and is not removed.** It is the honest name for a state the ledger
 * can still be handed — an imported ledger, a future adapter, or the day someone deletes the
 * `forceEnd` below — and the alternatives are worse: `unknown` claims we never saw the ending when
 * we did, and leaving the row open holds the session at `working` for good (`appendTx` says so).
 * ⚑ Removing it is a CHECK-constraint migration and a decision about what the ledger may record;
 * `246`'s response names it for a dispatch of its own.
 *
 * A measured corpus contains 55 closed turns (42 `completed`, 7 `interrupted`, 6 `unknown`)
 * across 21 conversations, with zero `ended` events. The fixtures distinguish turn endings
 * from conversation endings.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

const REF: SessionRef = {
  provider: 'codex',
  sessionId: 'thread_cut_off',
  cwd: '/tmp/scratch',
  rotation: 0,
}

/**
 * The teardown both shipped adapters perform, against the REAL machine.
 *
 * Transcribed from `CodexRuntime.doClose` and `ClaudeRuntime.doClose`, which are identical in the
 * four lines that matter and are pinned as such at the bottom of this file:
 *
 * ```
 * this.machine.beginClose()
 * if (this.machine.hasProviderWork) { this.machine.requestInterrupt(); …; this.machine.forceEnd() }
 * this.machine.closeSession(this._ref)
 * ```
 *
 * @param stopWork whether the adapter tears the open turn down first — `false` is the negative
 * control, and the ONLY shape that reaches `cut off`.
 */
function closeMidTurn(stopWork: boolean): RuntimeEvent[] {
  const events: RuntimeEvent[] = []
  const machine = new SessionMachine((event) => events.push(event))
  machine.markStarting()
  machine.sessionStarted(REF, 'started')
  machine.beginTurn()
  machine.beginClose()
  if (stopWork && machine.hasProviderWork) {
    machine.requestInterrupt()
    machine.forceEnd()
  }
  machine.closeSession(REF)
  return events
}

describe('the ending a close records (246 §2)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let conversations = 0

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-cutoff-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    conversations = 0
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * Record a prompt and then everything the machine said, into a conversation of its OWN.
   *
   * ⚠️ **A fresh session per call rather than a wiped one.** Deleting rows out from under a store
   * whose `provider_session` row is already terminal would make the second reading depend on how
   * `appendTx` treats a session it thinks has ended — which is a different question from the one
   * this file asks.
   */
  function record(events: readonly RuntimeEvent[]): string | null {
    const id = `sess_cut_off_${(conversations += 1)}`
    store.create({ id, provider: 'codex', cwd: dir, approvalMode: 'ask', profileId: 'default' })
    let at = 1_700_000_000_000
    let ordinal = 0
    store.append(id, ordinal++, { type: 'user_turn', text: 'do the thing' }, ++at)
    for (const event of events) {
      store.append(id, ordinal++, event as TranscriptEvent, ++at)
    }
    return store.turns(id).at(-1)?.endReason ?? null
  }

  it('⛔ closing mid-turn records `interrupted`, and the transcript reads it as such', () => {
    const events = closeMidTurn(true)
    // The ordering `010` fixed and `conformance.test.ts` asserts on all three adapters: the turn's
    // own terminal comes FIRST, so the terminal status finds nothing open to name.
    const terminalTurn = events.findIndex((event) => event.type === 'turn')
    const terminalStatus = events.findIndex(
      (event) => event.type === 'status' && event.state === 'ended',
    )
    expect(
      terminalTurn,
      'a close with a turn open emits exactly one terminal turn',
    ).toBeGreaterThan(-1)
    expect(events.filter((event) => event.type === 'turn')).toHaveLength(1)
    expect(terminalStatus).toBeGreaterThan(terminalTurn)

    expect(record(events)).toBe('interrupted')
    expect(ENDING_WORD.interrupted).toBe('interrupted')
  })

  it('⛔ …so `cut off` needs that ordering BROKEN — which is the whole of 244’s answer', () => {
    // The negative control, and the only shape that reaches the word: a terminal status landing on
    // a turn whose ending was never announced. No shipped adapter produces it, because both call
    // `forceEnd` first — see the pin below.
    const events = closeMidTurn(false)
    expect(events.filter((event) => event.type === 'turn')).toHaveLength(0)

    expect(record(events)).toBe('ended')
    expect(ENDING_WORD.ended).toBe('cut off')
  })

  it('⛔ every fatal path names the turn too, so `errored` cannot reach the word either', () => {
    // `fatalError` (the provider process died) and `fatalAfterReportedError` (a credential the
    // normalizer already reported) both terminalize through `terminalizeErrored`, which owes the
    // open turn exactly one terminal before `status:'errored'`.
    for (const kill of [
      (machine: SessionMachine) => machine.fatalError('the app-server stream ended'),
      (machine: SessionMachine) => machine.fatalAfterReportedError(),
    ]) {
      const events: RuntimeEvent[] = []
      const machine = new SessionMachine((event) => events.push(event))
      machine.markStarting()
      machine.sessionStarted(REF, 'started')
      machine.beginTurn()
      kill(machine)

      const turnAt = events.findIndex((event) => event.type === 'turn')
      const erroredAt = events.findIndex(
        (event) => event.type === 'status' && event.state === 'errored',
      )
      expect(turnAt).toBeGreaterThan(-1)
      expect(erroredAt).toBeGreaterThan(turnAt)
      expect(record(events)).toBe('failed')
    }
  })

  it('⚑ and both shipped adapters really do call forceEnd before closeSession', () => {
    // ⛔ **The line the two tests above stand on, read out of the adapters themselves.** `246` §4
    // puts `packages/runtime` out of bounds for this dispatch, so it is pinned rather than edited:
    // if a future teardown drops `forceEnd`, `cut off` becomes reachable and this fails, which is
    // the right way round — the word would then need covering, not deleting.
    for (const rel of [
      '../../../packages/runtime/src/codex/codex-runtime.ts',
      '../../../packages/runtime/src/claude/claude-runtime.ts',
      '../../../packages/runtime/src/fake-runtime.ts',
    ]) {
      const source = readFileSync(new URL(rel, import.meta.url), 'utf8')
      const doClose = source.slice(source.indexOf('private async doClose('))
      const work = doClose.indexOf('this.machine.hasProviderWork')
      const force = doClose.indexOf('this.machine.forceEnd(')
      const close = doClose.indexOf('this.machine.closeSession(')
      expect(work, `${rel} no longer asks whether the provider is working`).toBeGreaterThan(-1)
      expect(force, `${rel} no longer ends the open turn before closing`).toBeGreaterThan(work)
      expect(close, `${rel} closes the session before ending the turn`).toBeGreaterThan(force)
    }
  })

  it('⚑ and the cross-adapter proof of the ordering is still where this file says it is', () => {
    // A citation nobody can check is a comment. This one is checkable: the suite that asserts the
    // ordering on Fake, Claude and Codex has to still contain the case named above.
    const conformance = readFileSync(
      new URL('../../../packages/runtime/test/conformance.test.ts', import.meta.url),
      'utf8',
    )
    expect(conformance).toContain(
      'close() mid-turn emits exactly one terminal turn (interrupted) → idle → ended → status:ended',
    )
  })
})
