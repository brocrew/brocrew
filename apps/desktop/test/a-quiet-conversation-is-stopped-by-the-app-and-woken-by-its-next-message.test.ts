import { agentCallerId } from '../src/main/runtime/agent-tools'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { AgentState } from '../src/shared/agent-state'
import type { PieceRow } from '../src/shared/tasks'
import type {
  ResumableSessionInfo,
  RuntimeEventMessage,
  RuntimeStatesMessage,
  TranscriptEvent,
  UnresumableSessionInfo,
} from '../src/shared/runtime-ipc'

/**
 * # D-018 · a quiet conversation is stopped by the app, and woken by its next message
 *
 * ## What this file pins, and why it is its own file
 *
 * D-018 gave the host one countdown per running conversation. A flush that derives the conversation
 * idle enough to stop arms it (`idleEnoughToStop`, `countTheIdleMinutes`), every mark drops it, and
 * when it runs out the host asks again and, if nothing moved, closes the conversation as the app
 * itself. No existing test wires `statesMoved` AND reads the countdown, so the stop itself had no
 * test at all. Everything here is read off the REAL host (real SQLite, a provider double):
 *
 *  - **which conversations are counted**: each idle one on a countdown of its own; none while a turn
 *    is parked on its card, background work or a schedule is held, it is planning, or a person's
 *    interrupt-and-send holds the queue; one waiting on an answer counts, because its question
 *    outlives a stop; ⚑ and (W4.210) so does one whose *needs you* the ledger holds — a question to
 *    a person, an ask against an agent's rules, a piece waiting on the person who wrote to it;
 *  - **what a mark does**: it drops the countdown it finds and the flush it asks for arms a fresh
 *    one, so a countdown a mark replaced says nothing when it runs out;
 *  - **what a run-out does**: it asks again before it stops anything, keeps a conversation it cannot
 *    read, and stops through the conversation's own close, which the next message undoes;
 *  - **how long it waits**: one minute by default, on a timer that never keeps the process alive.
 *
 * ## How no test waits out the quiet
 *
 * The host arms `setTimeout`, so this file reads the timers it armed through a call-through spy and
 * runs a countdown out BY HAND (the callback is the host's own `() => void this.stopItIfStillIdle(
 * conversation, countdown)`). The delay under test is `IDLE`, a number no other timer uses and no
 * test waits out. `clearTimeout` is spied the same way, so "a mark dropped this countdown" is read
 * off the timer itself and not inferred from a word.
 *
 * ## Every negative has its positive on the same conversation
 *
 * "Nothing is counted" is only worth something beside "the same conversation, one fact over, IS
 * counted and IS stopped", so every test below ends by running the countdown that is then live out
 * and watching the provider end. A countdown that cannot be armed, or a stop that cannot happen, is
 * therefore not what passed.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** A delay no other timer in the host uses, and no test waits out. */
const IDLE = 7_654_321
/** The host's own default: one minute. */
const ONE_MINUTE = 60_000

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * A stretch of the event loop long enough for everything a provider row starts to have run: five
 * turns of `setImmediate` (each pump, and the flush a mark arms, run there) and a short timer.
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** The provider double: collects every handle it issues and the toolset each launch was handed. */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

/** One countdown the host armed: the timer it got back and the callback it armed it with. */
interface Countdown {
  readonly timer: ReturnType<typeof setTimeout>
  readonly fn: () => void
}

describe('D-018 · a quiet conversation is stopped by the app, and woken by its next message', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let claimed: Set<string>
  /** Every message the host pushed on `runtime:states`, in order. */
  let pushed: RuntimeStatesMessage[]
  /** A fault the wrapped store raises on a call, when a test arms one. */
  let fault: ((name: string) => void) | null
  /** Countdowns a test ran out by hand: spent, whatever the clearTimeout spy says. */
  let fired: Set<ReturnType<typeof setTimeout>>
  let setTimeoutSpy: MockInstance<typeof setTimeout>
  let clearTimeoutSpy: MockInstance<typeof clearTimeout>
  let infoSpy: MockInstance<typeof console.info>
  let warnSpy: MockInstance<typeof console.warn>
  const tick = (): number => clock++

  /**
   * The store the host is handed: the real one, with one hook: `fault` throws from a named call.
   */
  const wrappedStore = (real: SessionStore): SessionStore => {
    const wrapped: Record<string, unknown> = {}
    for (const [name, member] of Object.entries(real)) {
      if (typeof member !== 'function') {
        wrapped[name] = member
        continue
      }
      wrapped[name] = (...args: unknown[]): unknown => {
        fault?.(name)
        return Reflect.apply(member as (...given: unknown[]) => unknown, real, args)
      }
    }
    return wrapped as unknown as SessionStore
  }

  /** A host over the shared database. The idle delay is the dep when given, the default when not. */
  const buildHost = (idleStopAfterMs?: number): RuntimeHost => {
    const built = new RuntimeHost({
      store: wrappedStore(store),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, handed, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: 40,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      // The dep that arms the countdown at all: what main hands every window on `runtime:states`.
      statesMoved: (message) => {
        pushed.push(message)
      },
      ...(idleStopAfterMs === undefined ? {} : { idleStopAfterMs }),
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-idle-stop-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-idle-stop-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    handed = []
    pushed = []
    fault = null
    fired = new Set()
    claimed = new Set()
    issued = new FakeProviderSessions()
    // Call-through: the host still gets real timers, the test gets to read what it armed.
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    host = buildHost(IDLE)
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    // The hosts' own countdowns are unref'd and a week and more away; drop them anyway.
    for (const { timer } of armedAt(IDLE)) clearTimeout(timer)
    for (const { timer } of armedAt(ONE_MINUTE)) clearTimeout(timer)
    vi.restoreAllMocks()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  // ─── Reading the timers the host armed ───────────────────────────────────────────────────────

  /** Every `setTimeout` the host (or anything else) armed with exactly this delay, in order. */
  const armedAt = (ms: number): Countdown[] =>
    setTimeoutSpy.mock.calls.flatMap((call, index) =>
      call[1] === ms
        ? [
            {
              timer: setTimeoutSpy.mock.results[index]?.value as ReturnType<typeof setTimeout>,
              fn: call[0] as () => void,
            },
          ]
        : [],
    )
  /** Every timer anything cleared. */
  const cleared = (): Set<unknown> => new Set(clearTimeoutSpy.mock.calls.map(([timer]) => timer))
  /** The countdowns of this delay the host really holds: neither cleared by a mark nor run out. */
  const liveAt = (ms: number): Countdown[] =>
    armedAt(ms).filter(({ timer }) => !cleared().has(timer) && !fired.has(timer))
  /** A conversation holds at most one. */
  const live = (): Countdown[] => liveAt(IDLE)

  /**
   * Run a countdown out by hand, as the timer would after its delay, and let what it started
   * finish. A refused run-out has decided synchronously, so a negative may be read straight after;
   * a stop is waited for.
   */
  const fire = async (countdown: Countdown): Promise<void> => {
    fired.add(countdown.timer)
    countdown.fn()
    await settle()
  }
  /** Run out every countdown the host holds, at one instant. */
  const fireAll = async (): Promise<void> => {
    const all = live()
    for (const countdown of all) fired.add(countdown.timer)
    for (const countdown of all) countdown.fn()
    await settle()
  }
  /** The one countdown a test expects to be live. */
  const theOneLive = (): Countdown => {
    const now = live()
    expect(now, 'exactly one countdown is live').toHaveLength(1)
    const [only] = now
    if (only === undefined) throw new Error('unreachable')
    return only
  }

  // ─── Opening conversations and reading them ──────────────────────────────────────────────────

  /** One conversation, in ask mode, opened as a person would in this window. */
  const opens = async (profileId: string, on: RuntimeHost = host): Promise<string> => {
    const { sessionId } = await on.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const handleOf = (nth: number): FakeSessionHandle => {
    const handle = handles[nth]
    if (handle === undefined) throw new Error(`no provider handle ${String(nth)} has been issued`)
    return handle
  }
  const stopped = (nth: number): boolean => handleOf(nth).status() === 'ended'

  /** Every entry pushed for one conversation, in order. */
  const saidOf = (id: string): { conversation: string; state: AgentState }[] =>
    pushed.flatMap((message) => message.moved).filter((one) => one.conversation === id)
  const lastSaid = (id: string): AgentState | undefined => saidOf(id).at(-1)?.state

  /** A list read, as the window makes it. */
  const listed = (id: string): ResumableSessionInfo | UnresumableSessionInfo | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find((row) => row.sessionId === id)
  const runningOf = (id: string): string | undefined => listed(id)?.running

  /** The idle-stop line the host logs when a countdown runs out into a stop. */
  const stopLines = (): string[] =>
    infoSpy.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('was idle for'))

  /** Park a conversation's turn on its permission card, as a person's message does in ask mode. */
  const parksItsTurn = async (id: string): Promise<void> => {
    await host.send(id, 'go', window)
    await waitFor(() => lastSaid(id)?.is === 'needs-you', 'the parked turn to be pushed')
    await settle()
  }
  /** Answer that card from the PROVIDER's side, so the only rows that follow are the provider's. */
  const answersItsCard = async (id: string, nth: number): Promise<void> => {
    const card = window.messages.find(
      (message) => message.sessionId === id && message.event.type === 'permission_request',
    )?.event
    if (card?.type !== 'permission_request') throw new Error('the turn raised no permission card')
    await handleOf(nth).respondPermission(card.id, { outcome: 'allow' })
    await waitFor(() => lastSaid(id)?.is === 'idle', 'the ended turn to be pushed as idle')
    await settle()
  }

  /**
   * Hold a person's interrupt-and-send at the handover: the provider's `send` is entered, says so,
   * and then waits for a gate before it refuses. The returned `release` lets it go.
   */
  const holdsASendAtTheHandover = (
    nth: number,
  ): { entered: () => boolean; release: () => void } => {
    let entered = false
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(handleOf(nth), 'send').mockImplementation(async () => {
      entered = true
      await gate
      throw new Error('the provider refused it')
    })
    return { entered: () => entered, release }
  }

  // ─── A PM and two workers, from 603 ──────────────────────────────────────────────────────────

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await opens(profileId)
    await host.close(id, window)
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const cardOn = async (sessionId: string): Promise<string> => {
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card the turn parks on',
    )
    const asked = ledger(sessionId)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (asked === undefined || asked.type !== 'permission_request') {
      throw new Error('no permission request on the ledger')
    }
    return asked.id
  }

  /** Answer the open card so the turn runs to its own terminal. */
  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const before = ledger(sessionId).filter((event) => event.type === 'turn').length
    const id = await cardOn(sessionId)
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    await waitFor(
      () => ledger(sessionId).filter((event) => event.type === 'turn').length > before,
      'the turn to reach its own terminal',
    )
  }

  const pieceGivenTo = (worker: string): PieceRow => {
    const row = store.piecesOwnedBy(worker).at(-1)
    if (row === undefined) throw new Error(`no piece in ${worker}`)
    return row
  }

  /** A PM with two children, each holding one piece of work, each started by a give. */
  const aPmAndTwoWorkers = async (): Promise<{
    pm: string
    asks: string
    quiet: string
    asksLabel: string
  }> => {
    for (const slug of ['worker-a', 'worker-b']) await bringIdentityIntoBeing(slug)
    const pm = await opens('pm')
    const pmTools = theToolsetJustHandedOut()
    const give = async (slug: string, brief: string): Promise<string> => {
      const made = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: slug,
        title: brief,
        brief,
      })
      expect(made.outcome, JSON.stringify(made)).toBe('ok')
      return made.agent as string
    }
    const asks = await give('worker-a', 'the work a question will be raised about')
    const quiet = await give('worker-b', 'the work nobody asks about')
    await waitFor(
      () => store.piecesOwnedBy(asks).length === 1 && store.piecesOwnedBy(quiet).length === 1,
      'both pieces of work to reach their workers',
    )
    return { pm, asks, quiet, asksLabel: pieceGivenTo(asks).label }
  }

  /** One worker asks its parent, BOTH turns end, and neither question is answered. */
  const oneAsksAndBothTurnsEnd = async (): Promise<{
    pm: string
    asks: string
    quiet: string
  }> => {
    const made = await aPmAndTwoWorkers()
    const said = await callOn(agentToolsFor(host, made.asks), 'ask_question', {
      who_answers: 'the-parent',
      piece: made.asksLabel,
      question: 'which of the two?',
    })
    expect(said.outcome, JSON.stringify(said)).toBe('ok')
    for (const worker of [made.asks, made.quiet]) await letTheTurnFinish(worker)
    return { pm: made.pm, asks: made.asks, quiet: made.quiet }
  }

  /** The provider double of a conversation, found by the ref its row carries. */
  const doubleOf = (id: string): FakeSessionHandle => {
    const row = listed(id)
    if (row === undefined || !('ref' in row)) throw new Error(`${id} is not a listed resumable row`)
    const found = handles.find((handle) => handle.ref.sessionId === row.ref.sessionId)
    if (found === undefined) throw new Error(`no provider double carries ${id}'s ref`)
    return found
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────

  it('each idle conversation counts its quiet on a countdown of its own, and the one that runs out is stopped alone', async () => {
    const a = await opens('agent-a')
    await settle()
    const afterA = live()
    const b = await opens('agent-b')
    await settle()

    // One countdown per conversation, each armed with the delay the dep set.
    expect(afterA).toHaveLength(1)
    const both = live()
    expect(both).toHaveLength(2)
    expect(both.every(({ timer }) => armedAt(IDLE).some((one) => one.timer === timer))).toBe(true)
    const forA = afterA[0]
    const forB = both.find(({ timer }) => timer !== forA?.timer)
    if (forA === undefined || forB === undefined) throw new Error('two countdowns were expected')
    expect(forA.timer).not.toBe(forB.timer)

    // A quiet that has not run out stops nothing.
    expect(handleOf(0).status()).toBe('idle')
    expect(handleOf(1).status()).toBe('idle')
    expect(runningOf(a)).toBe('in-a-window')
    expect(runningOf(b)).toBe('in-a-window')
    expect(stopLines()).toEqual([])

    // B's runs out: B is stopped, and says why in one line.
    await fire(forB)
    await waitFor(() => stopped(1), 'B to be stopped')
    expect(runningOf(b)).toBe('not-running')
    expect(stopLines()).toHaveLength(1)
    expect(stopLines()[0]).toContain(`was idle for ${IDLE}ms`)

    // A is left alone: the same countdown, the same timer, the same running conversation.
    expect(live().map(({ timer }) => timer)).toContain(forA.timer)
    expect(handleOf(0).status()).toBe('idle')
    expect(runningOf(a)).toBe('in-a-window')

    // The paired positive, on the very conversation the negative was read on.
    await fire(forA)
    await waitFor(() => stopped(0), 'A to be stopped')
    expect(runningOf(a)).toBe('not-running')
  })

  it('a mark clears the countdown, a stale one says nothing, and a flush that finds the same word still counts', async () => {
    const a = await opens('agent-a')
    await settle()
    const first = theOneLive()
    const before = saidOf(a).length

    // A level frame that states nothing new: a mark whose derived word is the same one.
    handleOf(0).simulateBackgroundWork({ running: [] })
    await settle()

    expect(cleared().has(first.timer)).toBe(true)
    const fresh = theOneLive()
    expect(fresh.timer).not.toBe(first.timer)
    // The fresh count was armed by a flush that derived an equal word: nothing was pushed.
    expect(saidOf(a).length).toBe(before)

    // The stale callback, by hand: it is no longer this conversation's, and says nothing.
    await fire(first)
    expect(handleOf(0).status()).toBe('idle')
    expect(runningOf(a)).toBe('in-a-window')
    expect(live().map(({ timer }) => timer)).toEqual([fresh.timer])

    // The fresh countdown is the one that stops it.
    await fire(fresh)
    await waitFor(() => stopped(0), 'A to be stopped by the fresh countdown')
  })

  it('one minute is the quiet it waits, and its timer never keeps the process alive', async () => {
    const x = await opens('agent-x')
    await settle()
    const forX = theOneLive()
    // The dep set the delay, so a countdown of one minute is the host's own default and not this
    // harness's: nothing has armed one yet.
    expect(liveAt(ONE_MINUTE)).toEqual([])

    const second = buildHost()
    const y = await opens('agent-y', second)
    await settle()

    const byDefault = liveAt(ONE_MINUTE)
    expect(byDefault).toHaveLength(1)
    const [forY] = byDefault
    if (forY === undefined) throw new Error('unreachable')
    expect((forY.timer as unknown as { hasRef: () => boolean }).hasRef()).toBe(false)
    // X's countdown is the dep's, and the default host armed none with it.
    expect(live().map(({ timer }) => timer)).toEqual([forX.timer])
    expect((forX.timer as unknown as { hasRef: () => boolean }).hasRef()).toBe(false)

    // The one-minute countdown is Y's: running it out stops Y, and only Y.
    await fire(forY)
    await waitFor(() => handleOf(1).status() === 'ended', 'Y to be stopped')
    expect(handleOf(0).status()).toBe('idle')
    expect(stopLines().some((line) => line.includes(`${y} was idle for ${ONE_MINUTE}ms`))).toBe(
      true,
    )
    expect(stopLines().some((line) => line.includes(x))).toBe(false)
  })

  it('at the one-minute default, background work still keeps a conversation uncounted', async () => {
    const byDefault = buildHost()
    const b = await opens('agent-b', byDefault)
    await settle()
    expect(liveAt(ONE_MINUTE)).toHaveLength(1)

    handleOf(0).simulateBackgroundWork()
    await waitFor(() => lastSaid(b)?.is === 'in-the-background', 'the level to be pushed')
    await settle()
    expect(handleOf(0).status()).toBe('idle')
    expect(liveAt(ONE_MINUTE)).toEqual([])

    // One fact over, the same conversation is counted on the one-minute clock and stopped.
    handleOf(0).simulateBackgroundWork({ running: [] })
    await waitFor(() => lastSaid(b)?.is === 'idle', 'the emptied level to be pushed')
    await settle()
    const [countdown] = liveAt(ONE_MINUTE)
    if (countdown === undefined) throw new Error('the emptied level armed no one-minute countdown')
    await fire(countdown)
    await waitFor(() => stopped(0), 'B to be stopped without its background work')
  })

  it('a turn parked on its card has no countdown, and ending the turn counts it again', async () => {
    const a = await opens('agent-a')
    await settle()
    const first = theOneLive()

    await parksItsTurn(a)
    // The status row's mark dropped the countdown, and nothing counts it while the turn is parked.
    expect(cleared().has(first.timer)).toBe(true)
    expect(live()).toEqual([])

    await answersItsCard(a, 0)
    expect(live()).toHaveLength(1)
    expect(theOneLive().timer).not.toBe(first.timer)

    // The conversation that was uncounted while parked is stopped once its turn is over.
    await fire(theOneLive())
    await waitFor(() => stopped(0), 'A to be stopped once its turn was over')
  })

  it('background work keeps a conversation uncounted until it is gone', async () => {
    const a = await opens('agent-a')
    await settle()
    const first = theOneLive()

    handleOf(0).simulateBackgroundWork()
    await waitFor(() => lastSaid(a)?.is === 'in-the-background', 'the level to be pushed')
    await settle()

    // The provider is idle and the word is neither needs-you nor active: only the level stands in
    // the way.
    expect(handleOf(0).status()).toBe('idle')
    expect(cleared().has(first.timer)).toBe(true)
    expect(live()).toEqual([])

    handleOf(0).simulateBackgroundWork({ running: [] })
    await waitFor(() => lastSaid(a)?.is === 'idle', 'the emptied level to be pushed')
    await settle()
    expect(live()).toHaveLength(1)

    // One fact over, the same conversation is counted and stopped.
    await fire(theOneLive())
    await waitFor(() => stopped(0), 'A to be stopped without its background work')
  })

  it('a held schedule keeps a conversation uncounted until it is gone', async () => {
    const a = await opens('agent-a')
    await settle()
    const first = theOneLive()

    handleOf(0).simulateScheduledWork()
    await waitFor(() => lastSaid(a)?.is === 'scheduled', 'the schedule to be pushed')
    await settle()

    expect(handleOf(0).status()).toBe('idle')
    expect(cleared().has(first.timer)).toBe(true)
    expect(live()).toEqual([])

    handleOf(0).simulateScheduledWork({ jobs: [] })
    await waitFor(() => lastSaid(a)?.is === 'idle', 'the emptied schedule to be pushed')
    await settle()
    expect(live()).toHaveLength(1)

    // Without the schedule it is stopped; with it, the cron jobs inside the process would have gone.
    await fire(theOneLive())
    await waitFor(() => stopped(0), 'A to be stopped without its schedule')
  })

  /** ⚑ W4.210 · the countdown the host holds for this one conversation. */
  const countdownOf = (id: string): Countdown => {
    const timer = (host as unknown as { idleCountdowns: Map<string, unknown> }).idleCountdowns.get(
      id,
    )
    const found = live().find((one) => one.timer === timer)
    if (found === undefined) throw new Error(`${id} holds no live countdown`)
    return found
  }
  /** ⚑ What another agent's `get_agent_status` and `list_agents` say of a conversation. */
  const theWordsOf = async (asking: string, about: string): Promise<[string, string]> => {
    const status = await callOn(agentToolsFor(host, asking), 'get_agent_status', { agent: about })
    const listedNow = await callOn(agentToolsFor(host, asking), 'list_agents', {})
    const row = (listedNow.agents as { agent: string; state: string }[]).find(
      (one) => one.agent === about,
    )
    return [(status.agent as { state: string }).state, row?.state ?? '']
  }

  it('⚑ W4.210 · an agent whose ask against another’s rules waits on a person is stopped, the ask stays in front of them, and their decision starts nothing and clears it', async () => {
    await bringIdentityIntoBeing('worker-b')
    await bringIdentityIntoBeing('agent-a')
    expect(store.setCapabilities('agent-a', { canWriteRules: 'propose' })).toBe(true)
    const a = await opens('agent-a')
    await settle()
    const asked = host.proposeAgentRules(
      a,
      {
        about: 'worker-b',
        text: 'A rule for worker-b.',
        why: 'it keeps coming up',
        relaying: false,
        expectedVersion: 0,
      },
      { ownerId: agentCallerId(a) },
    )
    expect(asked.ok && asked.wrote).toBe('a-request')
    const askId = asked.ok && asked.wrote === 'a-request' ? asked.askId : ''
    await waitFor(() => lastSaid(a)?.is === 'needs-you', 'the ask to be pushed as needing you')
    await settle()

    // 🔴 It is counted, as an idle one is: the provider is idle and only the ledger holds the ask.
    expect(handleOf(handles.length - 1).status()).toBe('idle')
    const started = handles.length
    await fire(countdownOf(a))
    await waitFor(() => runningOf(a) === 'not-running', 'the asker to be stopped')

    // ⚑ The ask stays in front of the person, and the asker still reads needs you.
    expect(store.instructionAsksWaiting().map((one) => one.asked.askId)).toEqual([askId])
    expect(listed(a)?.state.is).toBe('needs-you')

    // ⚑ The person decides: it is recorded in the asker's ledger, nothing is started for it — the
    // ask parks nobody, so nothing is owed back — and the asker no longer needs them.
    expect(host.decideInstruction(askId, false, window)).toEqual({ outcome: 'taken' })
    expect(store.instructionAsksWaiting()).toEqual([])
    // ⚑ …and the windows are told: the decision moves its state, though nothing runs.
    await waitFor(() => lastSaid(a)?.is === 'idle', 'the asker to be pushed as idle')
    expect(
      ledger(a).some((event) => event.type === 'instruction_settled' && event.askId === askId),
    ).toBe(true)
    await settle()
    expect(handles).toHaveLength(started)
    expect(runningOf(a)).toBe('not-running')
    expect(listed(a)?.state.is).toBe('idle')
  })

  it('⚑ W4.210 · an agent a person wrote to, with work it was given open, is stopped, still needs you everywhere, and starts again on their next message', async () => {
    const { pm, quiet } = await aPmAndTwoWorkers()
    // The brief's turn ends (the giver's), then a person writes and that turn ends with the piece open.
    await letTheTurnFinish(quiet)
    const turns = ledger(quiet).filter((event) => event.type === 'turn').length
    const cards = ledger(quiet).filter((event) => event.type === 'permission_request').length
    await host.send(quiet, 'is it done?', window)
    await waitFor(
      () => ledger(quiet).filter((event) => event.type === 'permission_request').length > cards,
      'the turn the person opened to park on its own card',
    )
    await letTheTurnFinish(quiet)
    await waitFor(
      () => ledger(quiet).filter((event) => event.type === 'turn').length > turns,
      'the turn the person opened to end',
    )
    await waitFor(() => lastSaid(quiet)?.is === 'needs-you', 'the helper to need the person')
    await settle()
    expect(pieceGivenTo(quiet).state).toBe('waiting-on-the-person-who-wrote')

    // 🔴 Counted and stopped, with nothing else in the way.
    const started = handles.length
    const giversRows = ledger(pm).length
    await fire(countdownOf(quiet))
    await waitFor(() => runningOf(quiet) === 'not-running', 'the helper to be stopped')
    // ⛔ A stop changes nothing about a piece (D-016c): its giver is told nothing.
    expect(
      ledger(pm)
        .slice(giversRows)
        .filter((event) => event.type === 'user_turn' || event.type === 'message_queued'),
    ).toEqual([])

    // ⚑ Still needs you, wherever it is read: the window's list, another agent's tools, and the
    // person's own list — the piece still waits on them.
    expect(listed(quiet)?.state.is).toBe('needs-you')
    expect(await theWordsOf(pm, quiet)).toEqual(['needs you', 'needs you'])
    expect(host.waitingOnWhoWroteForAPerson().rows.map((row) => row.owner)).toEqual([quiet])
    expect(pieceGivenTo(quiet).state).toBe('waiting-on-the-person-who-wrote')

    // ⚑ The person's next message starts it again, through the window's door.
    const answer = await host.startAndSend(quiet, 'and the rest?', window)
    expect('notSent' in answer).toBe(false)
    expect(handles.length).toBeGreaterThan(started)
    await waitFor(
      () =>
        ledger(quiet).some((event) => event.type === 'user_turn' && event.text === 'and the rest?'),
      'the person’s words to reach it',
    )
    expect(runningOf(quiet)).toBe('in-a-window')
  })

  it('⚑ W4.210 · an agent that asked a person is stopped, still needs you, and the person’s answer in the window starts it again and reaches it', async () => {
    const { pm, quiet } = await aPmAndTwoWorkers()
    await letTheTurnFinish(quiet)
    const asked = await callOn(agentToolsFor(host, quiet), 'ask_question', {
      who_answers: 'a-person',
      question: 'which colour?',
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    await waitFor(() => lastSaid(quiet)?.is === 'needs-you', 'the asker to need the person')
    await settle()

    const started = handles.length
    await fire(countdownOf(quiet))
    await waitFor(() => runningOf(quiet) === 'not-running', 'the asker to be stopped')
    expect(listed(quiet)?.state.is).toBe('needs-you')
    expect(await theWordsOf(pm, quiet)).toEqual(['needs you', 'needs you'])
    // ⚑ …and the question is still in front of the person.
    const requestId =
      store.routedRequestsOf(quiet).filter((one) => one.went.is === 'the-person-the-asker-named')[0]
        ?.requestId ?? ''
    expect(requestId).not.toBe('')
    expect(host.questionsForAPerson().rows.map((row) => row.request.requestId)).toContain(requestId)

    // ⚑ The person answers where the question is shown: the window's own door.
    const before = ledger(quiet).length
    const ack = await host.respondUserInput(
      quiet,
      requestId,
      { kind: 'answer', answers: { answer: ['blue'] } },
      window,
    )
    expect(ack.outcome, JSON.stringify(ack)).toBe('taken')
    await waitFor(() => handles.length > started, 'the asker to be started again')
    await waitFor(
      () =>
        ledger(quiet)
          .slice(before)
          .some((event) => event.type === 'user_turn' && event.text.includes('blue')),
      'the answer to reach it',
    )
    // ⚑ D-017 · R5 — started in the window of the person who answered.
    expect(runningOf(quiet)).toBe('in-a-window')
  })

  /**
   * ⚑ The answer path through an agent's tools, checked for W4.210: waiting on an answer was
   * already stoppable (D-017 · R4), so this pins the restart, not the change.
   */
  it('an agent that asked its giver is stopped, and the giver’s answer through its tools starts it again and reaches it', async () => {
    const { pm, asks } = await oneAsksAndBothTurnsEnd()
    await waitFor(() => lastSaid(asks)?.is === 'waiting-on-an-answer', 'the asker to say it waits')
    await settle()
    const started = handles.length
    await fire(countdownOf(asks))
    await waitFor(() => runningOf(asks) === 'not-running', 'the asker to be stopped')

    const requestId = store.routedRequestsOf(asks).at(-1)?.requestId ?? ''
    expect(requestId).not.toBe('')
    const before = ledger(asks).length
    const answered = await callOn(agentToolsFor(host, pm), 'answer_question', {
      question: requestId,
      answers: [{ part: 'answer', answer: ['the first'] }],
    })
    expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
    await waitFor(() => handles.length > started, 'the asker to be started again')
    await waitFor(
      () =>
        ledger(asks)
          .slice(before)
          .some((event) => event.type === 'user_turn' && event.text.includes('the first')),
      'the answer to reach it',
    )
  })

  it('planning keeps a conversation uncounted, and leaving planning counts it again', async () => {
    const a = await opens('agent-a')
    await settle()
    const first = theOneLive()

    await host.setSessionSetting(a, { kind: 'planMode', on: true }, window)
    await settle()

    // Planning marks, and nothing counts a conversation that was asked to plan.
    expect(cleared().has(first.timer)).toBe(true)
    expect(live()).toEqual([])
    await fire(first)
    expect(handleOf(0).status()).toBe('idle')
    expect(runningOf(a)).toBe('in-a-window')

    // Leaving with no message starts no turn, so only the leave can count it again.
    await host.endPlanMode(a, window)
    await settle()
    expect(live()).toHaveLength(1)
    expect(theOneLive().timer).not.toBe(first.timer)

    await fire(theOneLive())
    await waitFor(() => stopped(0), 'A to be stopped once it left planning')
  })

  it('a countdown that runs out while a person’s interrupt-and-send holds the queue stops nothing', async () => {
    const a = await opens('agent-a')
    await settle()
    const first = theOneLive()

    const hold = holdsASendAtTheHandover(0)
    const pending = host.sendInterrupting(a, 'do this instead', window)
    pending.catch(() => {})
    await waitFor(hold.entered, 'the send to reach the provider')

    // The conversation is idle, so no interrupt happened and the hold stands at the handover. No
    // mark announced the hold, so the countdown armed while it was quiet is still the live one.
    expect(cleared().has(first.timer)).toBe(false)
    expect(live().map(({ timer }) => timer)).toEqual([first.timer])

    // It runs out under the person's send: the fire asked again and found the hold.
    await fire(first)
    expect(handleOf(0).status()).toBe('idle')
    expect(runningOf(a)).toBe('in-a-window')
    expect(stopLines()).toEqual([])

    // The hold is let go and the refused send leaves the conversation idle, and counted again.
    hold.release()
    await expect(pending).rejects.toThrow('the provider refused it')
    await settle()
    expect(live()).toHaveLength(1)
    expect(theOneLive().timer).not.toBe(first.timer)

    // With the hold gone, the same conversation is stopped.
    await fire(theOneLive())
    await waitFor(() => stopped(0), 'A to be stopped once the hold was let go')
  })

  it('a hold let go counts a conversation whose send was refused', async () => {
    const a = await opens('agent-a')
    await settle()
    await parksItsTurn(a)
    expect(live()).toEqual([])

    // The interrupt ends the parked turn and its idle row marks while the hold stands, which counts
    // nothing; the send it then makes is held at the handover and refused.
    const hold = holdsASendAtTheHandover(0)
    const pending = host.sendInterrupting(a, 'do this instead', window)
    pending.catch(() => {})
    await waitFor(() => handleOf(0).status() === 'idle', 'the interrupt to end the parked turn')
    await waitFor(hold.entered, 'the send to reach the provider')
    await settle()
    expect(live()).toEqual([])

    // Nothing but the hold being let go can count it now: no row and no event is behind it.
    hold.release()
    await expect(pending).rejects.toThrow('the provider refused it')
    await settle()
    expect(live()).toHaveLength(1)

    // Left idle by the refused send, the conversation is stopped.
    await fire(theOneLive())
    await waitFor(() => stopped(0), 'A to be stopped once its refused send was over')
  })

  it('a conversation waiting on an answer is stopped like an idle one, and its question and its piece stand', async () => {
    const { pm, asks, quiet } = await oneAsksAndBothTurnsEnd()
    await waitFor(() => lastSaid(asks)?.is === 'waiting-on-an-answer', 'the asker to say it waits')
    await waitFor(() => lastSaid(quiet)?.is === 'idle', 'the quiet worker to say it is idle')
    await settle()

    // The ledger as it stands, read non-empty so the equality below is not two empty lists.
    const piecesOf = (): [string, string][] =>
      store.piecesOwnedBy(asks).map((one) => [one.piece, one.state])
    const requestsOf = (): [string, string][] =>
      store.routedRequestsOf(asks).map((one) => [one.requestId, one.state])
    const piecesBefore = piecesOf()
    const requestsBefore = requestsOf()
    expect(piecesBefore.length).toBeGreaterThan(0)
    expect(requestsBefore.length).toBeGreaterThan(0)
    // The asker and the quiet worker are counted. The PM's turn, opened by the question delivered
    // to it, is parked on its card, so it is not (the control for the two below, not one of them).
    expect(lastSaid(pm)?.is).toBe('needs-you')
    expect(live()).toHaveLength(2)

    await fireAll()
    await waitFor(() => runningOf(asks) === 'not-running', 'the asker to be stopped')

    // The idle one was stopped by the same run-out, so it reached the others; the PM it never counted stays.
    expect(runningOf(quiet)).toBe('not-running')
    expect(runningOf(pm)).toBe('in-a-window')

    // A stop changes nothing about a piece, and the question still stands.
    expect(piecesOf()).toEqual(piecesBefore)
    expect(requestsOf()).toEqual(requestsBefore)
    expect(listed(asks)?.state.is).toBe('waiting-on-an-answer')
  })

  it('waiting on an answer does not hide what the provider is running', async () => {
    const { pm, asks, quiet } = await oneAsksAndBothTurnsEnd()
    await waitFor(() => lastSaid(asks)?.is === 'waiting-on-an-answer', 'the asker to say it waits')
    await settle()
    // Finding its double reads the list, which makes the next word derived be pushed whatever it
    // is: a level frame that states nothing new puts that behind us before the frame under test.
    const asksDouble = doubleOf(asks)
    asksDouble.simulateBackgroundWork({ running: [] })
    await settle()

    // The word stays "waiting on an answer", because waiting outranks the level: nothing is pushed
    // for it, and only the level itself can hold the stop back.
    const saidBefore = saidOf(asks).length
    expect(saidBefore).toBeGreaterThan(0)
    asksDouble.simulateBackgroundWork()
    await settle()
    expect(saidOf(asks)).toHaveLength(saidBefore)
    expect(lastSaid(asks)?.is).toBe('waiting-on-an-answer')

    // The quiet worker is stopped, so the run-out reached the others; the asker, which holds a
    // level the word does not say, was not counted and is not stopped.
    await fireAll()
    await waitFor(() => runningOf(quiet) === 'not-running', 'the quiet worker to be stopped')
    expect(asksDouble.status()).toBe('idle')
    expect(runningOf(asks)).toBe('in-a-window')
    expect(runningOf(pm)).toBe('in-a-window')

    // One fact over, it is the one countdown the host holds, and it stops it.
    asksDouble.simulateBackgroundWork({ running: [] })
    await settle()
    await fire(theOneLive())
    await waitFor(
      () => runningOf(asks) === 'not-running',
      'the asker to be stopped without its level',
    )
  })

  it('a stopped conversation starts again on its next message', async () => {
    const a = await opens('agent-a')
    await settle()
    expect(handles).toHaveLength(1)

    await fire(theOneLive())
    await waitFor(() => stopped(0), 'A to be stopped')
    await waitFor(() => runningOf(a) === 'not-running', 'A to be listed as not running')

    // The door the window uses for a person's message.
    const answer = await host.startAndSend(a, 'are you there', window)
    expect('notSent' in answer).toBe(false)
    expect(handles).toHaveLength(2)
    await waitFor(
      () =>
        ledger(a).some(
          (event) =>
            event.type === 'assistant_message' &&
            event.text.startsWith('echo: ') &&
            event.text.includes('are you there'),
        ),
      'the provider to answer the message',
    )
    expect(runningOf(a)).toBe('in-a-window')
  })

  it('a conversation the host cannot read when its countdown runs out is kept running until its next fact', async () => {
    const a = await opens('agent-a')
    await settle()
    const first = theOneLive()

    // The card reads ask the roster; with it unreadable the run-out cannot tell whether it is idle.
    fault = (name) => {
      if (name === 'agentIdentities') throw new Error('planted')
    }
    await fire(first)

    // Read off the double: a list read would throw with the roster.
    expect(handleOf(0).status()).toBe('idle')
    expect(
      warnSpy.mock.calls.some(([line]) =>
        String(line).includes(`could not tell whether ${a} is still idle`),
      ),
    ).toBe(true)
    expect(stopLines()).toEqual([])
    // The countdown was spent and nothing re-arms it.
    expect(live()).toEqual([])

    // Once it can be read, the next fact counts it and the same conversation is stopped.
    fault = null
    handleOf(0).simulateBackgroundWork({ running: [] })
    await settle()
    expect(live()).toHaveLength(1)
    await fire(theOneLive())
    await waitFor(() => stopped(0), 'A to be stopped once it could be read')
  })
})
