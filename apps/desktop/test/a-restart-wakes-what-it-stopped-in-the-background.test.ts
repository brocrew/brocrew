import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { FakeLaunchGate, FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { FakeSessionHandle, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type {
  RuntimeEventMessage,
  RuntimeStatesMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * # ⚑ A restart wakes the conversations whose background work it stopped
 *
 * Landing coverage for the host's half of "a restart says what it stopped". At launch — and only when
 * a window is listening — each conversation the newest quit closed, with background work its ledger
 * still listed running, is held a notice (what stopped, and when, in its own words) and then STARTED,
 * so that its turn drives the work again. ⚑ **One at a time, each five seconds after the last ended**,
 * so a night's worth of agents is not restarted in one breath. ⛔ Never for a quit older than a day, a
 * conversation with nothing running, or a host nobody listens to. A start that fails ends the words
 * it waited with, and says so.
 */

const THE_NOTICE = 'background-work-a-restart-stopped'
const SPACING = 5_000

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** A moment on the Mac's wall clock in 2026, whatever the zone. */
const local = (month: number, day: number, hour: number, minute: number, second = 0): number =>
  new Date(2026, month - 1, day, hour, minute, second).getTime()

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

/** What a test can switch on the provider double. */
interface ProviderControl {
  /** While set, a resume fails the way a machine that cannot spawn a process does. */
  failResume: boolean
  /** Where a host built while it is set holds its launches. */
  gate?: FakeLaunchGate
}

/** The provider double: every handle it issues, a start and a resume alike. */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    private readonly control: ProviderControl,
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions, ...(control.gate === undefined ? {} : { gate: control.gate }) })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    if (this.control.failResume) throw new Error('the machine refused to spawn')
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

type WordsInARow = TranscriptEvent & {
  type: 'user_turn' | 'message_queued'
  text: string
  appNotice?: string
}

describe('a restart wakes what it stopped in the background', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let control: ProviderControl
  let counter: number
  let clock: number
  let window: RecordingSink
  let pushed: RuntimeStatesMessage[]
  let setTimeoutSpy: MockInstance<typeof setTimeout>
  let warnSpy: MockInstance<typeof console.warn>
  const tick = (): number => clock++

  const buildHost = (listening = true): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, control, issued),
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
      ...(listening
        ? { statesMoved: (message: RuntimeStatesMessage): void => void pushed.push(message) }
        : {}),
      idleStopAfterMs: 86_400_000,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-restart-wake-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-restart-wake-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = local(9, 28, 11, 0)
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    pushed = []
    control = { failResume: false }
    issued = new FakeProviderSessions()
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    vi.restoreAllMocks()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (id: string): TranscriptEvent[] => store.events(id).map((entry) => entry.event)
  const wordsIn = (id: string): WordsInARow[] =>
    ledger(id).filter(
      (event): event is WordsInARow =>
        event.type === 'user_turn' || event.type === 'message_queued',
    )
  const noticesIn = (id: string): WordsInARow[] =>
    wordsIn(id).filter((one) => one.appNotice === THE_NOTICE)
  const providerIdOf = (id: string): string => {
    const found = store.find(id)
    if (found === null) throw new Error(`${id} has no provider ref`)
    return found.ref.sessionId
  }
  const handlesOf = (id: string): FakeSessionHandle[] =>
    handles.filter((handle) => handle.ref.sessionId === providerIdOf(id))

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  }

  /** The five-second spacing timers the host has armed, newest last, as callbacks to run by hand. */
  const spacings = (): (() => void)[] =>
    setTimeoutSpy.mock.calls
      // The spacing's callback is a promise's own `resolve`, which no other five-second timer is.
      .filter(([fn, delay]) => delay === SPACING && String(fn).includes('[native code]'))
      .map(([fn]) => fn as () => void)

  const opens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }
  /** The first life: opened at 11:00, then the quit that stamps them. */
  const aFirstLife = async (...profiles: string[]): Promise<string[]> => {
    clock = local(9, 28, 11, 0)
    const made: string[] = []
    for (const profile of profiles) made.push(await opens(profile))
    await host.closeAll()
    return made
  }
  const runsInTheBackground = (id: string, ...names: string[]): void => {
    store.append(
      id,
      store.nextOrdinal(id),
      {
        type: 'background_work',
        running: names.map((description, i) => ({ id: `t${String(i)}`, description })),
        source: 'test',
      } as unknown as TranscriptEvent,
      local(9, 28, 11, 30),
    )
  }
  const restartsAt = (moment: number, listening = true): RuntimeHost => {
    clock = moment
    host = buildHost(listening)
    return host
  }

  it('🔴 a conversation whose background work the quit stopped is held a notice at once and started five seconds on, and the notice goes in as its turn', async () => {
    const [a, b] = await aFirstLife('agent-a', 'agent-b')
    if (a === undefined || b === undefined) throw new Error('two conversations were opened')
    runsInTheBackground(a, 'Run the full live test')
    const before = { a: handlesOf(a).length, b: handlesOf(b).length }

    restartsAt(local(9, 28, 12, 0))
    // Held, at once, in its own words, as the app's own notice; the conversation is not started yet.
    const held = noticesIn(a)
    expect(held).toHaveLength(1)
    expect(held[0]?.text).toContain('stopped your background work: “Run the full live test”')
    expect(held[0]?.text).toContain('Start it again if it’s still needed.')
    expect(handlesOf(a)).toHaveLength(before.a)
    await waitFor(() => spacings().length === 1, 'the first spacing to be armed')

    // The spacing runs: it is started, and what was held goes in first.
    spacings()[0]?.()
    await waitFor(() => handlesOf(a).length === before.a + 1, 'the conversation to be started')
    await waitFor(
      () =>
        ledger(a).some(
          (event) =>
            event.type === 'user_turn' && event.text.includes('stopped your background work'),
        ),
      'the notice to go in as its turn',
    )
    // The conversation with nothing running was neither told nor started.
    expect(noticesIn(b)).toEqual([])
    expect(handlesOf(b)).toHaveLength(before.b)
  })

  it('⚑ …and the control: a host nobody listens to starts nothing and holds no notice', async () => {
    const [a] = await aFirstLife('agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    runsInTheBackground(a, 'Run the full live test')
    restartsAt(local(9, 28, 12, 0), false)
    await settle()
    expect(noticesIn(a)).toEqual([])
    expect(spacings()).toHaveLength(0)
  })

  it('⛔ a quit older than a day wakes nobody', async () => {
    const [a] = await aFirstLife('agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    runsInTheBackground(a, 'Run the full live test')
    restartsAt(local(9, 30, 12, 0))
    await settle()
    expect(noticesIn(a)).toEqual([])
    expect(spacings()).toHaveLength(0)
  })

  it('🔴 the starts are one at a time: the second waits for the first to end, and then for its own five seconds', async () => {
    const [a, b] = await aFirstLife('agent-a', 'agent-b')
    if (a === undefined || b === undefined) throw new Error('two conversations were opened')
    runsInTheBackground(a, 'first job')
    runsInTheBackground(b, 'second job')
    const before = { a: handlesOf(a).length, b: handlesOf(b).length }

    restartsAt(local(9, 28, 12, 0))
    // Both are told, but only one spacing is armed: the line is serial.
    expect(noticesIn(a)).toHaveLength(1)
    expect(noticesIn(b)).toHaveLength(1)
    await waitFor(() => spacings().length === 1, 'the first spacing to be armed')
    await settle()
    expect(spacings(), 'a second spacing was armed before the first start ended').toHaveLength(1)
    spacings()[0]?.()
    await waitFor(() => handlesOf(a).length === before.a + 1, 'the first to be started')
    // …and only after it ended is the second one's spacing armed.
    await waitFor(() => spacings().length === 2, 'the second spacing to be armed')
    expect(handlesOf(b)).toHaveLength(before.b)
    spacings()[1]?.()
    await waitFor(() => handlesOf(b).length === before.b + 1, 'the second to be started')
  })

  it('⛔ a start that fails ends the words it waited with — they are not sent later by chance — and says so in the log', async () => {
    const [a] = await aFirstLife('agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    runsInTheBackground(a, 'Run the full live test')
    restartsAt(local(9, 28, 12, 0))
    expect(noticesIn(a)).toHaveLength(1)

    control.failResume = true
    await waitFor(() => spacings().length === 1, 'the spacing to be armed')
    spacings()[0]?.()
    await waitFor(
      () => ledger(a).some((event) => event.type === 'message_unqueued'),
      'the held words to be ended',
    )
    expect(
      ledger(a).filter(
        (event) =>
          event.type === 'user_turn' && event.text.includes('stopped your background work'),
      ),
    ).toEqual([])
    expect(
      warnSpy.mock.calls.some(
        ([line]) =>
          String(line).includes('could not start') && String(line).includes('background work'),
      ),
    ).toBe(true)
  })

  it('⛔ a conversation archived while its start waits its turn stays stopped, and keeps the notice held for it', async () => {
    const [a] = await aFirstLife('agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    runsInTheBackground(a, 'Run the full live test')
    const before = handlesOf(a).length
    restartsAt(local(9, 28, 12, 0))
    await waitFor(() => spacings().length === 1, 'the spacing to be armed')

    expect(await host.archiveConversation(a)).toMatchObject({ done: true })
    spacings()[0]?.()
    await settle()

    expect(handlesOf(a)).toHaveLength(before)
    expect(host.resumableSessions().map(({ sessionId }) => sessionId)).not.toContain(a)
    // The notice waits for whatever brings it back: it was neither sent nor ended.
    expect(noticesIn(a)).toHaveLength(1)
    expect(ledger(a).filter((event) => event.type === 'message_unqueued')).toEqual([])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('⛔ a conversation archived while its start is under way stays stopped, and keeps the notice held for it', async () => {
    const [a] = await aFirstLife('agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    runsInTheBackground(a, 'Run the full live test')
    const before = handlesOf(a).length
    const gate = new FakeLaunchGate()
    control.gate = gate
    restartsAt(local(9, 28, 12, 0))
    await waitFor(() => spacings().length === 1, 'the spacing to be armed')
    spacings()[0]?.()
    await waitFor(() => gate.held === 1, 'its start to be under way')

    expect(await host.archiveConversation(a)).toMatchObject({ done: true })
    await settle()

    expect(gate.held).toBe(0)
    expect(handlesOf(a)).toHaveLength(before)
    expect(host.resumableSessions().map(({ sessionId }) => sessionId)).not.toContain(a)
    // The start was refused for the archive: the notice waits for whatever brings it back, and
    // the refusal is no failure of the wake's.
    expect(noticesIn(a)).toHaveLength(1)
    expect(ledger(a).filter((event) => event.type === 'message_unqueued')).toEqual([])
    expect(
      warnSpy.mock.calls.filter(([line]) => String(line).includes('after the restart stopped')),
    ).toEqual([])
  })

  it('⛔ a conversation deleted while its start waits its turn is not started, and nothing is said of it', async () => {
    const [a, b] = await aFirstLife('agent-a', 'agent-b')
    if (a === undefined || b === undefined) throw new Error('two conversations were opened')
    runsInTheBackground(a, 'Run the full live test')
    runsInTheBackground(b, 'Build the report')
    const issued = handles.length
    restartsAt(local(9, 28, 12, 0))
    await waitFor(() => spacings().length === 1, 'the first spacing to be armed')

    expect(await host.deleteConversation(a, ['records'])).toMatchObject({
      done: true,
      removed: ['records'],
    })
    spacings()[0]?.()
    // The line moves on: the one behind it is started in its own turn.
    await waitFor(() => spacings().length === 2, 'the second spacing to be armed')
    expect(handles).toHaveLength(issued)
    spacings()[1]?.()
    await waitFor(() => handlesOf(b).length === 2, 'the conversation behind it to be started')

    expect(handles).toHaveLength(issued + 1)
    expect(store.recordedOne(a)).toBeNull()
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
