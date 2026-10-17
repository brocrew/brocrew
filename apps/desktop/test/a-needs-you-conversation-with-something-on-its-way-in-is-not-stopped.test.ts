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
import type { ToolName } from '../src/main/runtime/agent-tools'
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
 * # The idle stop · a start or a delivery on its way in keeps a *needs you* conversation running
 *
 * A conversation whose piece waits on the person who wrote to it reads *needs you*, and *needs
 * you* is idle enough to stop: the ledger holds it. *Needs you* ranks above *active*, so its word
 * hides a start or a message arriving at that moment; `idleEnoughToStop` reads both directly
 * (`startsInFlight`, `arrivals`) for that reason.
 *
 * | § | what it pins | why the existing tests do not reach it |
 * |---|---|---|
 * | 1 | a countdown that runs out while a message is arriving stops nothing; the same conversation, nothing arriving, is stopped | the idle-stop tests stop a *needs you* conversation only with nothing on its way |
 * | 2 | the same for a start still in flight | same |
 *
 * The harness is the idle-stop file's: a real host over SQLite, a provider double, and the host's
 * own countdowns read through a call-through `setTimeout` spy and run out by hand. The arrival and
 * the start are planted in the host's two maps directly: a real one finishes in the same turn of
 * the loop, before a countdown could run out beside it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** A delay no other timer in the host uses, and no test waits out. */
const IDLE = 7_654_321

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** Long enough for every pump and every flush a row arms to have run. */
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

/** The host's private parts this file reaches. */
interface HostInsides {
  idleCountdowns: Map<string, unknown>
  arrivals: Map<string, Promise<void>>
  startsInFlight: Map<string, Promise<string>>
  stateMayHaveMoved: (conversation: string) => void
}

describe('the idle stop and what is on its way into a conversation that needs you', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let handed: AgentToolset[]
  let counter: number
  let clock: number
  let window: RecordingSink
  let claimed: Set<string>
  let pushed: RuntimeStatesMessage[]
  let fired: Set<ReturnType<typeof setTimeout>>
  let setTimeoutSpy: MockInstance<typeof setTimeout>
  let clearTimeoutSpy: MockInstance<typeof clearTimeout>
  let infoSpy: MockInstance<typeof console.info>
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-idle-arrival-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-idle-arrival-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    handed = []
    pushed = []
    fired = new Set()
    claimed = new Set()
    const issued = new FakeProviderSessions()
    // Call-through: the host still gets real timers, the test gets to read what it armed.
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    host = new RuntimeHost({
      store,
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
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      // The dep that arms the countdown at all.
      statesMoved: (message) => {
        pushed.push(message)
      },
      idleStopAfterMs: IDLE,
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    insides().arrivals.clear()
    insides().startsInFlight.clear()
    await host.closeAll()
    for (const { timer } of armedAt(IDLE)) clearTimeout(timer)
    vi.restoreAllMocks()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const insides = (): HostInsides => host as unknown as HostInsides

  /** Every `setTimeout` armed with exactly this delay, in order. */
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
  const cleared = (): Set<unknown> => new Set(clearTimeoutSpy.mock.calls.map(([timer]) => timer))
  const live = (): Countdown[] =>
    armedAt(IDLE).filter(({ timer }) => !cleared().has(timer) && !fired.has(timer))

  /** Run a countdown out by hand, as the timer would after its delay, and let what it started finish. */
  const fire = async (countdown: Countdown): Promise<void> => {
    fired.add(countdown.timer)
    countdown.fn()
    await settle()
  }

  /** The countdown the host holds for this one conversation. */
  const countdownOf = (id: string): Countdown => {
    const timer = insides().idleCountdowns.get(id)
    const found = live().find((one) => one.timer === timer)
    if (found === undefined) throw new Error(`${id} holds no live countdown`)
    return found
  }

  /** A mark on the conversation: the flush it asks for arms a fresh countdown if it is idle enough. */
  const markAndSettle = async (id: string): Promise<void> => {
    insides().stateMayHaveMoved(id)
    await settle()
  }

  const opens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const saidOf = (id: string): { conversation: string; state: AgentState }[] =>
    pushed.flatMap((message) => message.moved).filter((one) => one.conversation === id)
  const lastSaid = (id: string): AgentState | undefined => saidOf(id).at(-1)?.state

  const listed = (id: string): ResumableSessionInfo | UnresumableSessionInfo | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find((row) => row.sessionId === id)
  const runningOf = (id: string): string | undefined => listed(id)?.running

  /** The idle-stop line the host logs, synchronously, the moment it decides to stop. */
  const stopLines = (): string[] =>
    infoSpy.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('was idle for'))

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
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

  /** A helper given work by a PM, written to by a person, whose turn ended with the piece open. */
  const aHelperWaitingOnThePersonWhoWrote = async (): Promise<string> => {
    const brought = await opens('worker-b')
    await host.close(brought, window)
    await opens('pm')
    const pmTools = handed.at(-1)
    if (pmTools === undefined) throw new Error('no toolset was handed to the PM')
    const made = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker-b',
      title: 'the work nobody asks about',
      brief: 'the work nobody asks about',
    })
    expect(made.outcome, JSON.stringify(made)).toBe('ok')
    const helper = made.agent as string
    await waitFor(() => store.piecesOwnedBy(helper).length === 1, 'the piece to reach its helper')
    await letTheTurnFinish(helper)
    const turns = ledger(helper).filter((event) => event.type === 'turn').length
    const cards = ledger(helper).filter((event) => event.type === 'permission_request').length
    await host.send(helper, 'is it done?', window)
    await waitFor(
      () => ledger(helper).filter((event) => event.type === 'permission_request').length > cards,
      'the turn the person opened to park on its own card',
    )
    await letTheTurnFinish(helper)
    await waitFor(
      () => ledger(helper).filter((event) => event.type === 'turn').length > turns,
      'the turn the person opened to end',
    )
    await waitFor(() => lastSaid(helper)?.is === 'needs-you', 'the helper to need the person')
    await settle()
    expect(pieceGivenTo(helper).state).toBe('waiting-on-the-person-who-wrote')
    return helper
  }

  it('⛔ a countdown that runs out while a message is arriving stops nothing; ⚑ nothing arriving, the same conversation is stopped', async () => {
    const helper = await aHelperWaitingOnThePersonWhoWrote()

    insides().arrivals.set(helper, Promise.resolve())
    await fire(countdownOf(helper))
    expect(stopLines()).toEqual([])
    expect(runningOf(helper)).not.toBe('not-running')

    insides().arrivals.delete(helper)
    await markAndSettle(helper)
    await fire(countdownOf(helper))
    expect(stopLines()).toHaveLength(1)
    await waitFor(() => runningOf(helper) === 'not-running', 'the helper to be stopped')
  })

  it('⛔ a countdown that runs out while a start is in flight stops nothing; ⚑ the start settled, the same conversation is stopped', async () => {
    const helper = await aHelperWaitingOnThePersonWhoWrote()

    insides().startsInFlight.set(helper, Promise.resolve(helper))
    await fire(countdownOf(helper))
    expect(stopLines()).toEqual([])
    expect(runningOf(helper)).not.toBe('not-running')

    insides().startsInFlight.delete(helper)
    await markAndSettle(helper)
    await fire(countdownOf(helper))
    expect(stopLines()).toHaveLength(1)
    await waitFor(() => runningOf(helper) === 'not-running', 'the helper to be stopped')
  })
})
