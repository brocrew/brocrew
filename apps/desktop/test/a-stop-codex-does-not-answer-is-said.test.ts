import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
 * # 🔴 723 · R83 — a Stop the provider does not answer is SAID (`720` F-F)
 *
 * ⚑ **The ruling:** *"When Codex does not acknowledge a Stop within the bound, the conversation says
 * so in words (Codex has not answered the stop), and a second press does not queue a second ask
 * behind the first."*
 *
 * ⛔ **What `720` left, measured on `main` by this file:** F-6 bounded the person's wait, so the Stop
 * came back — and then nothing. The ledger held the ask and no answer, the turn stayed `working`,
 * and each further press sent Codex another `turn/interrupt` behind the one it had not answered and
 * wrote another ask into the ledger (`720` F-F; rule 8.4: *what does a person see at the limit?*).
 *
 * ⚑ **Main's half** (the words are the frontend's, after `723` lands): the fact on the wire —
 * {@link StopUnansweredEvent}, once per ask — and the second-press rule at the person's Stop door.
 *
 * ⚠️ **The REAL `CodexRuntime`, over an app-server scripted like one** (`709`'s rig): what is
 * measured is what the adapter and the host do between the wire and the ledger.
 *
 * | arm | what the app-server does with `turn/interrupt` | what the conversation must hold |
 * |---|---|---|
 * | **§1** | never answers, never ends the turn | the ask, then `stop_unanswered` — once |
 * | **§2** | the same, and the person presses again | ONE ask, ONE `turn/interrupt` |
 * | **§3** control | answers, and ends the turn | the ask and no `stop_unanswered` |
 * | **§4** control | ends the turn, never answers | no `stop_unanswered` — the turn DID stop |
 * | **§4** control | answers, and runs on | nothing said, and a second press IS a second ask |
 * | **§5** | §1, then the turn ends; a new turn is stopped | a second ask, for the second turn, said again |
 */

/** ⚑ Short: the host's own bound is the thing under test, and two seconds would measure the clock. */
const INTERRUPT_WAIT_MS = 40

describe('723 · R83 — a Stop the provider does not answer is said', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let servers: ScriptedAppServer[]
  const window = new Window('webContents:1')

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-723-stop-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-723-stop-root-'))
    window.messages.length = 0
    ;({ host, db, store, servers } = aHostOverScriptedCodex(userData, {
      interruptWaitMs: INTERRUPT_WAIT_MS,
    }))
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** A Codex conversation with a turn Codex is RUNNING. */
  const aRunningTurn = async (): Promise<{ id: string; server: ScriptedAppServer }> => {
    const { sessionId: id } = await host.createSession(
      { provider: 'codex', approvalMode: 'ask', cwd: root },
      window,
    )
    const server = servers.at(-1)
    if (server === undefined) throw new Error('no app-server was opened')
    await host.send(id, 'count to sixty', window)
    await waitFor(() => server.sent('turn/start').length === 1, 'the first turn')
    // ⚑ Codex's `turn/started` has arrived, so an interrupt is one Codex can act on.
    await new Promise((resolve) => setTimeout(resolve, 20))
    return { id, server }
  }

  const ledger = (id: string): TranscriptEvent[] => store.events(id).map((entry) => entry.event)
  const ofType = (id: string, type: TranscriptEvent['type']): TranscriptEvent[] =>
    ledger(id).filter((event) => event.type === type)
  /** What reached the window, by type — the wire, not only the ledger. */
  const sentOfType = (type: string): unknown[] =>
    window.messages.map((message) => message.event).filter((event) => event.type === type)
  /** Where a promise stands after `ms` — `'pending'` is a value an assertion can name. */
  const within = async (
    ms: number,
    promise: Promise<unknown>,
  ): Promise<{ state: 'settled' } | { state: 'pending' }> =>
    Promise.race([
      promise.then(
        () => ({ state: 'settled' as const }),
        () => ({ state: 'settled' as const }),
      ),
      new Promise<{ state: 'pending' }>((resolve) =>
        setTimeout(() => resolve({ state: 'pending' }), ms),
      ),
    ])
  /** Past the bound, with room for the timer that says so. */
  const pastTheBound = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, INTERRUPT_WAIT_MS * 3))

  it('🔴 §1 · a Stop Codex never answers is SAID on the conversation — once, after the ask, with the bound it waited and whose ask it was', async () => {
    const { id, server } = await aRunningTurn()
    server.interruptAnswer = 'never'
    await host.interrupt(id, window)
    // ⚑ **Read the moment the Stop returns, not after a sleep** (review): the row is on the wire
    // BEFORE the person's IPC comes back, at the bound the row names.
    // ⛔ **On `main` there is no such row**: the ask, and then silence.
    const rows = ledger(id).map((event) => event.type)
    expect(rows.filter((type) => type === 'stop_unanswered')).toHaveLength(1)
    // ⚑ AFTER the ask it is about — and the ask is THERE (a position read on an absent row is -1).
    expect(rows.filter((type) => type === 'work_interrupted')).toHaveLength(1)
    expect(rows.lastIndexOf('work_interrupted')).toBeLessThan(rows.indexOf('stop_unanswered'))
    expect(ofType(id, 'stop_unanswered')).toEqual([
      { type: 'stop_unanswered', waitedMs: INTERRUPT_WAIT_MS, by: 'a-person' },
    ])
    // ⚑ …and it reached the window, not only the ledger.
    expect(sentOfType('stop_unanswered')).toEqual([
      { type: 'stop_unanswered', waitedMs: INTERRUPT_WAIT_MS, by: 'a-person' },
    ])
    await pastTheBound()
    // ⚑ The waiter was released, not the work: the turn is still Codex's to end.
    expect(ofType(id, 'turn')).toEqual([])
  })

  it('🔴 §2 · a second press while the first is unanswered asks NOTHING new — one ask, one `turn/interrupt`', async () => {
    const { id, server } = await aRunningTurn()
    server.interruptAnswer = 'never'
    await host.interrupt(id, window)
    await pastTheBound()
    // ⛔ **On `main` this sent a second `turn/interrupt` behind the first and wrote a second ask.**
    await host.interrupt(id, window)
    await pastTheBound()
    expect(server.sent('turn/interrupt')).toHaveLength(1)
    expect(ofType(id, 'work_interrupted')).toHaveLength(1)
    // ⚑ …and the fact is not said twice about one ask.
    expect(ofType(id, 'stop_unanswered')).toHaveLength(1)
  })

  it('🔴 §2 · …nor does a press that lands INSIDE the first one’s bound — a double press is one ask', async () => {
    const { id, server } = await aRunningTurn()
    server.interruptAnswer = 'never'
    const first = host.interrupt(id, window)
    const second = host.interrupt(id, window)
    await Promise.all([first, second])
    await pastTheBound()
    expect(server.sent('turn/interrupt')).toHaveLength(1)
    expect(ofType(id, 'work_interrupted')).toHaveLength(1)
    expect(ofType(id, 'stop_unanswered')).toHaveLength(1)
  })

  it('⚑ §3 CONTROL · a Codex that answers — the ask, the ending, and nothing said', async () => {
    const { id, server } = await aRunningTurn()
    server.interruptAnswer = 'answers'
    await host.interrupt(id, window)
    await waitFor(() => ofType(id, 'turn').length === 1, 'Codex’s ending')
    await pastTheBound()
    expect(ofType(id, 'work_interrupted')).toHaveLength(1)
    expect(ofType(id, 'stop_unanswered')).toEqual([])
    expect(sentOfType('stop_unanswered')).toEqual([])
  })

  it('⚑ §4 CONTROL · a Codex that ENDS the turn and never answers — the turn stopped, so nothing is said', async () => {
    // ⛔ `stop_unanswered` is about a stop the turn is still waiting on. ⚑ Here Codex ended it in its
    // own word; saying *"Codex has not answered the stop"* over a turn that stopped would be false.
    const { id, server } = await aRunningTurn()
    server.interruptAnswer = 'never-but-ends'
    await host.interrupt(id, window)
    await waitFor(() => ofType(id, 'turn').length === 1, 'Codex’s ending')
    await pastTheBound()
    expect(ofType(id, 'stop_unanswered')).toEqual([])
  })

  it('⚑ §4 CONTROL · a Codex that ANSWERS the ask and runs on — nothing is said, and the NEXT press asks again', async () => {
    // ⚑ The second-press rule joins an UNANSWERED ask, never an answered one: Codex acknowledged the
    // first, so a person pressing again is asking a second time, and Codex hears it.
    const { id, server } = await aRunningTurn()
    server.interruptAnswer = 'answers-but-runs-on'
    await host.interrupt(id, window)
    await pastTheBound()
    expect(ofType(id, 'stop_unanswered')).toEqual([])
    await host.interrupt(id, window)
    await pastTheBound()
    expect(server.sent('turn/interrupt')).toHaveLength(2)
    expect(ofType(id, 'work_interrupted')).toHaveLength(2)
  })

  it('🔴 §5 · once the turn ends, the stop is waiting on nothing — the NEXT turn’s Stop is a new ask', async () => {
    // ⚑ The second-press rule is about the ask a turn is still waiting on, never a latch for the
    // conversation's life: a new turn's Stop asks again, and is said again if it goes unanswered.
    const { id, server } = await aRunningTurn()
    server.interruptAnswer = 'never'
    await host.interrupt(id, window)
    await pastTheBound()
    server.end(server.lastTurn, 'completed')
    await waitFor(() => ofType(id, 'turn').length === 1, 'Codex’s ending')
    await host.send(id, 'and now count to ten', window)
    await waitFor(() => server.sent('turn/start').length === 2, 'the second turn')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await host.interrupt(id, window)
    await pastTheBound()
    expect(server.sent('turn/interrupt')).toHaveLength(2)
    expect(ofType(id, 'work_interrupted')).toHaveLength(2)
    expect(ofType(id, 'stop_unanswered')).toHaveLength(2)
  })

  it('🔴 §2 · a JOINED press waits on the ask it joined, as the first press did', async () => {
    // ⚑ Review: returning at once lowered the window's `busy` under an ask still in flight.
    const { id, server } = await aRunningTurn()
    server.interruptAnswer = 'never'
    const first = host.interrupt(id, window)
    const second = host.interrupt(id, window)
    expect(await within(5, second)).toEqual({ state: 'pending' })
    await Promise.all([first, second])
    expect(server.sent('turn/interrupt')).toHaveLength(1)
  })

  it('⚑ §2 CONTROL · while a CARD is up a press is a new ask — it settles the card, as on `main`', async () => {
    // ⚑ The turn raised a request after the ask, so Codex is answering; the frozen Stop is what
    // settles that card, and a joined press would leave it standing (review).
    const { id, server } = await aRunningTurn()
    server.interruptAnswer = 'never'
    await host.interrupt(id, window)
    server.raise(70, 'item/commandExecution/requestApproval', { itemId: 'i70', command: 'ls' })
    await waitFor(
      () => sentOfType('permission_request').length === 1,
      'the card raised after the ask',
    )
    await host.interrupt(id, window)
    expect(server.sent('turn/interrupt')).toHaveLength(2)
    expect(ofType(id, 'work_interrupted')).toHaveLength(2)
    await waitFor(
      () => server.responses.some((one) => one.id === 70),
      'the card settled by the second press',
    )
  })

  it('🔴 §6 · interrupt-and-send’s own ask is said when it goes unanswered, and a Stop JOINS it', async () => {
    const { id, server } = await aRunningTurn()
    server.interruptAnswer = 'never'
    const replacing = host.sendInterrupting(id, 'no, do THIS', window)
    await waitFor(() => server.sent('turn/interrupt').length === 1, 'the replacement’s ask')
    await pastTheBound()
    expect(ofType(id, 'stop_unanswered')).toEqual([
      { type: 'stop_unanswered', waitedMs: INTERRUPT_WAIT_MS, by: 'a-person' },
    ])
    await host.interrupt(id, window)
    expect(server.sent('turn/interrupt')).toHaveLength(1)
    expect(ofType(id, 'work_interrupted')).toHaveLength(1)
    server.end(server.lastTurn, 'interrupted')
    await replacing.catch(() => undefined)
  })

  it('🔴 §7 · a LATE answer to an old turn’s ask does not let go of the new turn’s', async () => {
    // ⚑ The identity check in the ask's own settlement (review): without it, turn A's late answer
    // cleared turn B's ask, and B's next press asked a second time behind an unanswered one.
    const { id, server } = await aRunningTurn()
    server.interruptAnswer = 'late'
    server.lateMs = 400
    await host.interrupt(id, window)
    await pastTheBound()
    server.end(server.lastTurn, 'completed')
    await waitFor(() => ofType(id, 'turn').length === 1, 'turn A’s ending')
    await host.send(id, 'and now count to ten', window)
    await waitFor(() => server.sent('turn/start').length === 2, 'turn B')
    await new Promise((resolve) => setTimeout(resolve, 20))
    server.interruptAnswer = 'never'
    await host.interrupt(id, window)
    // ⚑ A's ask is answered now, 400 ms after it went out — B's still stands.
    await new Promise((resolve) => setTimeout(resolve, 450))
    await host.interrupt(id, window)
    expect(server.sent('turn/interrupt')).toHaveLength(2)
    expect(ofType(id, 'work_interrupted')).toHaveLength(2)
  })

  it('⚑ “not on Claude” — Claude’s own stop bounds its ack no later than the host says a stop is unanswered', () => {
    // ⚑ Claude's `interrupt()` bounds its ack and then forces the ending itself (074), so its ask is
    // settled before the host's bound passes. ⚠️ That holds while Claude's ack bound is no longer
    // than the host's wait — two constants in two packages, pinned here so neither moves alone
    // (review). ⛔ Equal bounds rely on Claude's timer being made first, inside `handle.interrupt()`.
    const here = dirname(fileURLToPath(import.meta.url))
    const read = (path: string): string => readFileSync(join(here, path), 'utf8')
    const hostWait = /const DEFAULT_INTERRUPT_WAIT_MS = ([\d_]+)/.exec(
      read('../src/main/runtime/runtime-host.ts'),
    )?.[1]
    const claudeAck = /const INTERRUPT_ACK_TIMEOUT_MS = ([\d_]+)/.exec(
      read('../../../packages/runtime/src/claude/claude-runtime.ts'),
    )?.[1]
    expect(hostWait, 'the host’s wait').toBeDefined()
    expect(claudeAck, 'Claude’s ack bound').toBeDefined()
    expect(Number(claudeAck?.replaceAll('_', ''))).toBeLessThanOrEqual(
      Number(hostWait?.replaceAll('_', '')),
    )
  })
})
