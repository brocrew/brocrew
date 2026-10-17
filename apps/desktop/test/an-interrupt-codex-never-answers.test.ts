import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDatabase } from '../src/main/db/connection'
import type { SessionStore } from '../src/main/db/session-store'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  aHostOverScriptedCodex,
  waitFor,
  Window,
  type ScriptedAppServer,
} from './lib/scripted-codex-host'

/**
 * # 🔴 709 · an interrupt Codex never answers still gives interrupt-and-send back (`704` H-8)
 *
 * ⛔ **The finding, as `704` measured it:** `sendInterrupting` awaited the adapter's `interrupt()`,
 * and Codex's awaits its `turn/interrupt` request with no bound of its own — so an app-server that
 * never answers that request held the verb for good, kept `holdingQueue` up, and held every queued
 * message behind it. `waitForIdle`'s five seconds never started.
 *
 * ⚑ **The fix is `interruptAgent`'s, one door over**: the ask is raced against
 * `DEFAULT_INTERRUPT_WAIT_MS` with `settledWithin`, which releases the WAITER and not the work — the
 * request stays in flight, and whatever Codex does with it later still ends the turn.
 *
 * ⚠️ **The REAL `CodexRuntime`, over a transport scripted like an app-server** — not a handle whose
 * `interrupt` is made to hang. The finding is about where the adapter's await sits, so a double that
 * replaced the adapter would be measuring the double.
 *
 * | arm | what the app-server does with `turn/interrupt` | what the verb must do |
 * |---|---|---|
 * | **§1** | ends the turn `interrupted` and never ANSWERS the request | send the replacement with the queued message, as one turn |
 * | **§2** | never answers and never ends the turn | refuse after its bounded waits, and let the queue go when the turn does end |
 * | **§3** control | answers, and ends the turn `interrupted` | exactly what it always did |
 *
 * ⚑ **D-027 · R2 moved what "the replacement goes" means**: with a message queued, a person's Stop
 * and send JOINS it — its words are held last, and the flush the verb lets go of in its `finally`
 * sends everything as ONE turn, oldest first. So §1, §3 and 720 F-7 read that one turn: on the
 * wire (`turnsAsked()` keeps a turn's last paragraph, which is its last message) and in the ledger,
 * one `user_turn` whose `parts` are the messages ({@link theMessagesOfTheLastTurn}).
 */

/** ⚑ Short: the host's own wait is the thing under test, and two seconds would measure the clock. */
const INTERRUPT_WAIT_MS = 40

/**
 * ⚑ **Where a promise stands after `ms`** — `'pending'` is the hang, and it is a value the
 * assertion can name rather than a test that times out saying nothing.
 */
async function within(
  ms: number,
  promise: Promise<unknown>,
): Promise<{ state: 'resolved' } | { state: 'rejected'; message: string } | { state: 'pending' }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<{ state: 'pending' }>((resolve) => {
    timer = setTimeout(() => resolve({ state: 'pending' }), ms)
  })
  try {
    return await Promise.race([
      promise.then(
        () => ({ state: 'resolved' as const }),
        (error: unknown) => ({
          state: 'rejected' as const,
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
      late,
    ])
  } finally {
    clearTimeout(timer)
  }
}

describe('709 · an interrupt Codex never answers still gives interrupt-and-send back (704 H-8)', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let servers: ScriptedAppServer[]
  const window = new Window('webContents:1')

  const ledgerOf = (id: string): TranscriptEvent[] => store.events(id).map((entry) => entry.event)
  /**
   * ⚑ **D-027 · the messages the last turn delivered, oldest first** — its `parts`, which a turn of
   * several carries and a turn of one does not (that one is its own `text`).
   */
  const theMessagesOfTheLastTurn = (id: string): string[] | undefined => {
    const turn = ledgerOf(id)
      .filter((event) => event.type === 'user_turn')
      .at(-1)
    return turn?.type === 'user_turn' ? turn.parts?.map((part) => part.text) : undefined
  }
  /** ⚑ How each turn ended, in Codex's own word, as the ledger recorded it. */
  const turnEndings = (id: string): string[] =>
    ledgerOf(id).flatMap((event) => (event.type === 'turn' ? [event.state] : []))

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-709-interrupt-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-709-interrupt-root-'))
    ;({ host, db, store, servers } = aHostOverScriptedCodex(userData, {
      interruptWaitMs: INTERRUPT_WAIT_MS,
    }))
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** A Codex conversation with a turn Codex is RUNNING, and one message queued behind it. */
  const aRunningTurnWithOneWaiting = async (): Promise<{
    id: string
    server: ScriptedAppServer
  }> => {
    const { sessionId: id } = await host.createSession(
      { provider: 'codex', approvalMode: 'ask', cwd: root },
      window,
    )
    const server = servers.at(-1)
    if (server === undefined) throw new Error('no app-server was opened')
    await host.send(id, 'count to sixty', window)
    await waitFor(() => server.sent('turn/start').length === 1, 'the first turn')
    // ⚑ Codex's `turn/started` has arrived, so the interrupt below is one Codex can act on.
    await new Promise((resolve) => setTimeout(resolve, 20))
    const queued = await host.queueMessage(id, 'the one that was waiting', window)
    expect(queued).toMatchObject({ outcome: 'queued' })
    return { id, server }
  }

  it('🔴 §1 · Codex ENDS the turn and never answers the ask — the replacement goes, with the queued message', async () => {
    const { id, server } = await aRunningTurnWithOneWaiting()
    server.interruptAnswer = 'never-but-ends'
    const verb = host.sendInterrupting(id, 'no, do THIS', window)
    // ⛔ **On `main` this is `pending` for good**: the host awaited an answer that never comes, while
    // the turn it asked about had already ended.
    expect(await within(2_000, verb)).toEqual({ state: 'resolved' })
    // ⚑ **And the queue was held for the verb and no longer** — 🔴 D-027: the replacement was held
    // last, with the queued message, and ONE turn carries both once the verb lets go: the flush in
    // its `finally`, an await after it resolves, so it is waited for. A latch left up holds it.
    await waitFor(() => server.turnsAsked().length === 2, 'the one turn after the stop')
    expect(server.turnsAsked()).toEqual(['count to sixty', 'no, do THIS'])
    expect(theMessagesOfTheLastTurn(id)).toEqual(['the one that was waiting', 'no, do THIS'])
    // ⚑ **The waiter was released, not the work**: one ask, still unanswered, and nothing re-sent.
    expect(server.sent('turn/interrupt')).toHaveLength(1)
    // ⚑ …and nothing is left for the turn after it: the queued message went in the one the person
    // asked for — before D-027 it went alone, as the turn after this one.
    server.end(server.lastTurn, 'completed')
    await waitFor(() => turnEndings(id).includes('completed'), 'that turn to end')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(server.turnsAsked()).toHaveLength(2)
  })

  it('🔴 §2 · Codex never answers and never ends the turn — the verb refuses after its bounded waits, and the queue is released', async () => {
    const { id, server } = await aRunningTurnWithOneWaiting()
    server.interruptAnswer = 'never'
    const verb = host.sendInterrupting(id, 'no, do THIS', window)
    // ⚑ **Bounded**: the host's interrupt wait, then `waitForIdle`'s five seconds — and a turn
    // still running at their end refuses the words, which the composer hands back.
    const said = await within(8_000, verb)
    expect(said).toEqual({
      state: 'rejected',
      message: 'cannot send: the session is still working after interrupting the running turn',
    })
    expect(server.turnsAsked()).toEqual(['count to sixty'])
    // ⛔ **The latch is DOWN**: when Codex does end the turn, the message that was waiting goes —
    // on `main` it stayed held behind a verb that never returned.
    server.end(server.lastTurn, 'completed')
    await waitFor(() => server.turnsAsked().length === 2, 'the queued message')
    expect(server.turnsAsked()).toEqual(['count to sixty', 'the one that was waiting'])
  }, 20_000)

  it('⚑ §3 CONTROL · Codex answers the ask and ends the turn — the verb does exactly what it always did', async () => {
    const { id, server } = await aRunningTurnWithOneWaiting()
    server.interruptAnswer = 'answers'
    expect(await within(2_000, host.sendInterrupting(id, 'no, do THIS', window))).toEqual({
      state: 'resolved',
    })
    expect(server.sent('turn/interrupt')).toHaveLength(1)
    // ⚑ D-027 · what it does since: one turn, the queued message then the replacement — §1's.
    await waitFor(() => server.turnsAsked().length === 2, 'the one turn after the stop')
    expect(server.turnsAsked()).toEqual(['count to sixty', 'no, do THIS'])
    expect(theMessagesOfTheLastTurn(id)).toEqual(['the one that was waiting', 'no, do THIS'])
    server.end(server.lastTurn, 'completed')
    await waitFor(() => turnEndings(id).includes('completed'), 'that turn to end')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(server.turnsAsked()).toHaveLength(2)
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // 720 · 709 F-6 — a PERSON's Stop, the door 709 left unbounded
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **720 · `709` F-6 — a person's Stop on a Codex that never answers comes back.** ⛔ On `main`
   * `RuntimeHost.interrupt` awaited the adapter's `turn/interrupt`, which Codex may never answer,
   * so the IPC never returned and the window's `record.busy` stayed up for the life of the call —
   * the plan's go-ahead and the Reopen buttons dead with nothing saying why (rule 8.4). ⚑ Bounded
   * the way `709` bounded interrupt-and-send: the WAITER is released, not the work — the ask stays
   * in flight, and whatever Codex does with it later still ends the turn in its own word (R43).
   */
  it('🔴 720 · F-6 · a Stop Codex never answers comes back — and the turn still ends in Codex’s own word', async () => {
    const { id, server } = await aRunningTurnWithOneWaiting()
    server.interruptAnswer = 'never'
    const stop = host.interrupt(id, window)
    // ⛔ **On `main` this is `pending` for good.**
    expect(await within(2_000, stop)).toEqual({ state: 'resolved' })
    // ⚑ The waiter was released, not the work: one ask, the turn still Codex's to end, and the
    // message that was waiting still waiting.
    expect(server.sent('turn/interrupt')).toHaveLength(1)
    expect(server.turnsAsked()).toEqual(['count to sixty'])
    // ⚑ When Codex does end it — here, completing it anyway — the ledger says Codex's word, the ask
    // stands beside it, and the queue goes.
    server.end(server.lastTurn, 'completed')
    await waitFor(() => server.turnsAsked().length === 2, 'the queued message')
    const ledger = store.events(id).map((entry) => entry.event)
    expect(ledger.some((event) => event.type === 'work_interrupted')).toBe(true)
    expect(ledger.filter((event) => event.type === 'turn')).toEqual([
      { type: 'turn', state: 'completed' },
    ])
  })

  it('🔴 720 · F-6 · …and one that ENDS the turn but never answers comes back too', async () => {
    const { id, server } = await aRunningTurnWithOneWaiting()
    server.interruptAnswer = 'never-but-ends'
    expect(await within(2_000, host.interrupt(id, window))).toEqual({ state: 'resolved' })
    await waitFor(() => server.turnsAsked().length === 2, 'the queued message')
  })

  it('⚑ 720 · F-6 CONTROL · a Codex that answers — the Stop returns as it always did, with one ask', async () => {
    const { id, server } = await aRunningTurnWithOneWaiting()
    server.interruptAnswer = 'answers'
    expect(await within(2_000, host.interrupt(id, window))).toEqual({ state: 'resolved' })
    expect(server.sent('turn/interrupt')).toHaveLength(1)
    await waitFor(() => server.turnsAsked().length === 2, 'the queued message')
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // 720 · 709 F-7 — two presses of interrupt-and-send, and the latch between them
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **720 · `709` F-7 — interrupt-and-send's latch COUNTS its presses.** ⛔ On `main` it was a
   * boolean: a second press, while the first was still running, raised it again (it was already
   * up), and the FIRST press's `finally` lowered it under the second — so the next `idle` flushed
   * the message that was waiting AHEAD of the second press's words, which then refused with *"still
   * working after interrupting the running turn"*: `670`'s defect again, one press later.
   */
  it('🔴 720 · F-7 · a second press while the first runs — the queue stays held until the LAST press is done', async () => {
    const { id, server } = await aRunningTurnWithOneWaiting()
    server.interruptAnswer = 'never'
    const first = host.sendInterrupting(id, 'do A', window)
    await waitFor(() => server.sent('turn/interrupt').length === 1, 'the first press’s ask')
    const second = host.sendInterrupting(id, 'do B', window)
    // ⚑ Both presses are inside their waits before the turn ends — waited for, never slept on.
    await waitFor(() => server.sent('turn/interrupt').length === 2, 'the second press’s ask')
    // ⚑ Codex ends the running turn. 🔴 **D-027 · R2 — both presses' words JOIN the waiting
    // message**, each held after it, and ONE turn carries all three once the LAST press lets go:
    // the count holds the queue behind both, so no flush can take the waiting message without the
    // other press's words — ⚠️ the order of the two presses is still the pool's race.
    server.end(server.lastTurn, 'interrupted')
    await waitFor(() => server.turnsAsked().length === 2, 'the one turn after the stop')
    const [waiting, ...presses] = theMessagesOfTheLastTurn(id) ?? []
    expect(waiting).toBe('the one that was waiting')
    expect([...presses].sort()).toEqual(['do A', 'do B'])
    expect(await within(2_000, first)).toEqual({ state: 'resolved' })
    expect(await within(2_000, second)).toEqual({ state: 'resolved' })
    // ⚑ CONTROL, the same run: the latch came DOWN after the last press — a count that never came
    // down would have held that one turn for good — and its end has nothing left to send.
    server.end(server.lastTurn, 'completed')
    await waitFor(() => turnEndings(id).includes('completed'), 'that turn to end')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(server.turnsAsked()).toHaveLength(2)
  }, 20_000)
})

/**
 * ⚑ **709 · the ask's bound is PATIENCE, not only a ceiling** — the one arm that tells
 * `settledWithin(asked, interruptWaitMs)` from not waiting on the ask at all.
 *
 * ⚠️ Without it, `waitForIdle`'s five seconds are the whole of the verb's patience, and they start
 * the instant the ask is sent. ⚑ With it, the verb waits up to `DEFAULT_INTERRUPT_WAIT_MS` (two
 * seconds) for the provider to answer the ask, and THEN gives the turn its five — so a Codex that
 * answers, and ends the turn, 5.5 s after the ask still takes the replacement. ⛔ The shipped bound,
 * not a test's: this host is built with the default.
 */
describe('709 · the ask’s own bound is patience too (704 H-8)', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let host: RuntimeHost
  let servers: ScriptedAppServer[]
  const window = new Window('webContents:1')

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-709-patience-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-709-patience-root-'))
    ;({ host, db, servers } = aHostOverScriptedCodex(userData))
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  it('⚑ a Codex that answers the ask and ends the turn 5.5 s later — inside the ask’s 2 s plus `waitForIdle`’s 5 — still takes the replacement', async () => {
    const { sessionId: id } = await host.createSession(
      { provider: 'codex', approvalMode: 'ask', cwd: root },
      window,
    )
    const server = servers.at(-1)
    if (server === undefined) throw new Error('no app-server was opened')
    await host.send(id, 'count to sixty', window)
    await waitFor(() => server.sent('turn/start').length === 1, 'the first turn')
    await new Promise((resolve) => setTimeout(resolve, 20))
    server.interruptAnswer = 'late'
    server.lateMs = 5_500
    expect(await within(9_000, host.sendInterrupting(id, 'no, do THIS', window))).toEqual({
      state: 'resolved',
    })
    expect(server.turnsAsked()).toEqual(['count to sixty', 'no, do THIS'])
  }, 20_000)
})
