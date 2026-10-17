import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { FakeSessionHandle, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { scheduleHead } from '../src/renderer/src/lib/scheduled-work'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import type { AgentState, ScheduledRow, ScheduleLevel } from '../src/shared/agent-state'
import { clockTime } from '../src/shared/clock'
import type {
  RuntimeEventMessage,
  RuntimeStatesMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * # A scheduled job is listed, and leaves the listing, as it happens
 *
 * The app reads each scheduling call its provider runs as the call happens (a receipt), and says
 * what is scheduled from those and from the levels the provider states at a turn's end. So a job
 * is listed when it is made, and leaves when its cancellation is confirmed, in the turn that did
 * it — nothing waits for the turn to end.
 *
 * A job whose minute has come stays listed, with no time said, until its provider's own level
 * leaves it out: nothing public says which turn a job began, so this app does not guess.
 *
 * Every case runs the REAL HOST over a real store (temp SQLite, the migrations) with a provider
 * double that reports each call as the provider's tool hooks do. What a window would draw is read
 * by folding the ledger the way the window does.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** A moment on the Mac's wall clock in 2026, whatever the zone. */
const local = (month: number, day: number, hour: number, minute: number, second = 0): number =>
  new Date(2026, month - 1, day, hour, minute, second).getTime()

const DUE = local(9, 28, 14, 45)

interface Job {
  readonly id: string
  readonly schedule: string
  readonly recurring: boolean
  readonly prompt: string
}

const ONE_SHOT_A: Job = {
  id: 'job-a',
  schedule: '45 14 28 9 *',
  recurring: false,
  prompt: 'check the deploy',
}
const LATER_B: Job = {
  id: 'job-b',
  schedule: '15 16 28 9 *',
  recurring: false,
  prompt: 'ship it',
}
const NIGHTLY: Job = {
  id: 'nightly',
  schedule: '0 3 * * *',
  recurring: true,
  prompt: 'run the nightly check',
}

/** A delay no other timer in the host uses, and no test waits out. */
const IDLE = 7_654_321

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** A stretch of the event loop long enough for everything a provider row starts to have run. */
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

/** The provider double: every handle it issues, a start and a resume alike. */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

/** A wake-up as the host holds it — read off the private map. */
interface WakeUpRead {
  level: ScheduleLevel
  startAt: number
}

type WordsInARow = TranscriptEvent & {
  type: 'user_turn' | 'message_queued'
  text: string
  appNotice?: string
}

describe('what is scheduled is said as it changes', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  /** Every message the host pushed on `runtime:states`, in order. */
  let pushed: RuntimeStatesMessage[]
  let setTimeoutSpy: MockInstance<typeof setTimeout>
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
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
      // ⚑ Main hands every window this; without it the host arms neither countdown nor wake-up.
      statesMoved: (message: RuntimeStatesMessage): void => {
        pushed.push(message)
      },
      idleStopAfterMs: IDLE,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f035-host-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-f035-host-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = local(9, 28, 12, 0)
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    pushed = []
    issued = new FakeProviderSessions()
    // Call-through: the host still gets real timers, the test reads what it armed.
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    // Every countdown the host armed is unref'd and far off; drop them anyway.
    for (const [index, call] of setTimeoutSpy.mock.calls.entries()) {
      const timer = setTimeoutSpy.mock.results[index]?.value as ReturnType<typeof setTimeout>
      if (call[1] === IDLE) clearTimeout(timer)
    }
    vi.restoreAllMocks()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  // ─── Reading what the host holds ─────────────────────────────────────────────────────────────

  const wakeUpsOf = (h: RuntimeHost): Map<string, WakeUpRead> =>
    (h as unknown as { wakeUps: Map<string, WakeUpRead> }).wakeUps

  const stateOf = (id: string): AgentState | undefined =>
    host.agentCard(id, THE_APP_ITSELF, id)?.state

  const lastSaid = (id: string): AgentState | undefined =>
    pushed
      .flatMap((message) => message.moved)
      .filter((one) => one.conversation === id)
      .at(-1)?.state

  const ledger = (id: string): TranscriptEvent[] => store.events(id).map((entry) => entry.event)

  const noticesIn = (id: string): WordsInARow[] =>
    ledger(id).filter(
      (event): event is WordsInARow =>
        (event.type === 'user_turn' || event.type === 'message_queued') &&
        (event as WordsInARow).appNotice === 'a-scheduled-job-that-will-not-run',
    )

  /** The level this life holds — read off the private slot, as `reopen-while-closing` reads it. */
  const heldRows = (id: string): readonly ScheduledRow[] => {
    const slot = (
      host as unknown as {
        slots: Map<string, { session: { scheduled: ScheduleLevel } | null }>
      }
    ).slots.get(id)
    const session = slot?.session
    if (session === undefined || session === null) throw new Error(`${id} has no live session`)
    return session.scheduled.jobs
  }
  const held = (id: string): string[] => heldRows(id).map((job) => job.id)

  const providerIdOf = (id: string): string => {
    const found = store.find(id)
    if (found === null) throw new Error(`${id} has no provider ref`)
    return found.ref.sessionId
  }
  const handlesOf = (id: string): FakeSessionHandle[] =>
    handles.filter((handle) => handle.ref.sessionId === providerIdOf(id))
  const doubleOf = (id: string): FakeSessionHandle => {
    const found = handlesOf(id).at(-1)
    if (found === undefined) throw new Error(`no provider double carries ${id}'s ref`)
    return found
  }
  /** One conversation, in ask mode, opened as a person would in this window. */
  const opens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  /** The provider begins a turn by itself: its model writes with no turn of ours open. */
  const burstBegins = (id: string, text = 'checking the deploy'): void => {
    ;(doubleOf(id) as unknown as { push(event: unknown): void }).push({
      type: 'assistant_message',
      text,
    })
  }
  /** That turn's own `result`. */
  const burstEnds = (id: string): void => {
    ;(
      doubleOf(id) as unknown as { machine: { completeTurn(outcome: string): void } }
    ).machine.completeTurn('completed')
  }

  /** What a window folding this conversation's ledger draws for its schedule. */
  const drawn = (id: string): { head: string; jobs: string[]; times: (number | undefined)[] } => {
    const state = createTranscript()
    for (const entry of store.events(id)) applyEvent(state, entry.event, entry.at)
    return {
      head: scheduleHead(state.schedule),
      jobs: state.schedule.jobs.map((job) => job.id),
      times: state.schedule.jobs.map((job) => job.nominalAt),
    }
  }
  /** The level rows this app wrote into a conversation's ledger. */
  const appLevels = (id: string): string[][] =>
    ledger(id).flatMap((event) =>
      event.type === 'scheduled_work' && event.jobs !== undefined && event.source === 'app/receipts'
        ? [event.jobs.map((job) => job.id)]
        : [],
    )
  const sentLevels = (): number =>
    window.messages.filter(
      (message) => message.event.type === 'scheduled_work' && message.event.jobs !== undefined,
    ).length

  let call = 0
  /** Its provider runs `CronCreate`, as its tool hooks report it. */
  const creates = (id: string, job: Job): void => {
    doubleOf(id).simulateScheduledWork({
      jobs: undefined,
      receipt: {
        tool: 'CronCreate',
        toolUseId: `toolu_create_${String(++call)}`,
        calledAt: clock,
        answeredAt: clock + 2,
        input: { cron: job.schedule, recurring: job.recurring },
        result: { id: job.id, recurring: job.recurring },
      },
    })
  }
  /** Its provider runs `CronDelete`; `answered` is the id its result names, or none. */
  const cancels = (id: string, asked: string, answered: string | null = asked): void => {
    doubleOf(id).simulateScheduledWork({
      jobs: undefined,
      receipt: {
        tool: 'CronDelete',
        toolUseId: `toolu_delete_${String(++call)}`,
        calledAt: clock,
        answeredAt: clock + 2,
        input: { id: asked },
        ...(answered === null ? {} : { result: { id: answered } }),
      },
    })
  }
  /** Its provider states its level, as it does when a turn ends. */
  const states = (id: string, ...jobs: Job[]): void => {
    doubleOf(id).simulateScheduledWork({ jobs: [...jobs] })
  }

  it('🔴 a job is listed the moment it is made, with its time, before any turn ends', async () => {
    const a = await opens('agent-a')
    await settle()
    const sent = sentLevels()

    creates(a, ONE_SHOT_A)
    await waitFor(() => held(a).length === 1, 'the job to be listed')

    // ⚑ No level from its provider yet: the listing is this app's, from the receipt.
    expect(appLevels(a)).toEqual([['job-a']])
    expect(drawn(a)).toEqual({ head: '1 job is scheduled', jobs: ['job-a'], times: [DUE] })
    expect(sentLevels()).toBe(sent + 1)
    await waitFor(() => lastSaid(a)?.is === 'scheduled', 'its state to say scheduled')
    expect(stateOf(a)).toEqual({ is: 'scheduled', dueAt: DUE })

    // Its provider's own level at the turn's end names the same job, and what it asks.
    states(a, ONE_SHOT_A)
    await waitFor(() => heldRows(a)[0]?.prompt === 'check the deploy', 'what it asks to be known')
    expect(drawn(a).times).toEqual([DUE])
    expect(stateOf(a)).toEqual({ is: 'scheduled', dueAt: DUE })
  })

  it('🔴 a confirmed cancellation takes the job out in the same open turn; the other stays, then the count is none', async () => {
    const a = await opens('agent-a')
    creates(a, ONE_SHOT_A)
    creates(a, LATER_B)
    states(a, ONE_SHOT_A, LATER_B)
    await waitFor(() => held(a).length === 2 && heldRows(a)[1]?.prompt !== undefined, 'two jobs')
    await settle()
    expect(drawn(a).head).toBe('2 jobs are scheduled')
    const levelsBefore = ledger(a).filter((event) => event.type === 'scheduled_work').length

    cancels(a, 'job-a')
    await waitFor(() => held(a).length === 1, 'the cancelled job to leave')
    // ⚑ The turn is still open: no level from its provider, no list, no timer — one row of this
    // app's, written after the receipt.
    expect(held(a)).toEqual(['job-b'])
    expect(drawn(a)).toMatchObject({ head: '1 job is scheduled', jobs: ['job-b'] })
    expect(ledger(a).filter((event) => event.type === 'scheduled_work')).toHaveLength(
      levelsBefore + 2,
    )
    expect(appLevels(a).at(-1)).toEqual(['job-b'])
    expect(stateOf(a)).toEqual({ is: 'scheduled', dueAt: local(9, 28, 16, 15) })

    // The last one cancelled: nothing is scheduled, and nothing says a job is.
    cancels(a, 'job-b')
    await waitFor(() => held(a).length === 0, 'the last job to leave')
    expect(drawn(a).jobs).toEqual([])
    await waitFor(() => lastSaid(a)?.is === 'idle', 'its state to say idle')
    expect(stateOf(a)).toEqual({ is: 'idle' })
  })

  it('⛔ a cancellation nothing confirmed leaves the job listed; a later one that is confirmed takes it out', async () => {
    const a = await opens('agent-a')
    creates(a, ONE_SHOT_A)
    creates(a, LATER_B)
    states(a, ONE_SHOT_A, LATER_B)
    await waitFor(() => held(a).length === 2 && heldRows(a)[1]?.prompt !== undefined, 'two jobs')
    await settle()
    const levelsBefore = appLevels(a).length

    // No result came back.
    cancels(a, 'job-a', null)
    // Its result names another job, one that is listed: neither leaves.
    cancels(a, 'job-a', 'job-b')
    // A cancellation of a job that was never listed here.
    cancels(a, 'job-never', 'job-never')
    await settle()
    expect(held(a)).toEqual(['job-a', 'job-b'])
    expect(drawn(a).head).toBe('2 jobs are scheduled')
    expect(appLevels(a)).toHaveLength(levelsBefore)

    cancels(a, 'job-a')
    await waitFor(() => held(a).length === 1, 'the confirmed cancellation to take it out')
    expect(drawn(a).jobs).toEqual(['job-b'])
  })

  it('⛔ a cancellation is one conversation’s: the same job id in another stays listed', async () => {
    const a = await opens('agent-a')
    const b = await opens('agent-b')
    for (const id of [a, b]) {
      creates(id, ONE_SHOT_A)
      states(id, ONE_SHOT_A)
    }
    await waitFor(() => held(a).length === 1 && held(b).length === 1, 'both to list the job')
    await settle()

    cancels(a, 'job-a')
    await waitFor(() => held(a).length === 0, 'A to lose its job')
    await settle()
    expect(held(b)).toEqual(['job-a'])
    expect(drawn(b).head).toBe('1 job is scheduled')
  })

  it('🔴 a cancelled job wakes nobody: a stop is woken for the job that is left, and a restart reads the same', async () => {
    clock = local(9, 28, 12, 0)
    const a = await opens('agent-a')
    creates(a, ONE_SHOT_A)
    creates(a, LATER_B)
    states(a, ONE_SHOT_A, LATER_B)
    await waitFor(() => held(a).length === 2, 'two jobs')
    cancels(a, 'job-a')
    await waitFor(() => held(a).length === 1, 'the cancelled job to leave')
    await settle()

    await host.close(a, THE_APP_ITSELF)
    await settle()
    // ⚑ Not half a minute before 14:45, the cancelled job's time: before 16:15.
    expect(wakeUpsOf(host).get(a)?.startAt).toBe(local(9, 28, 16, 15) - 30_000)
    expect(stateOf(a)).toEqual({ is: 'scheduled', dueAt: local(9, 28, 16, 15) })

    // The app starts again: the ledger is read afresh, and the cancelled job is not back.
    await host.closeAll()
    clock = local(9, 28, 12, 30)
    host = buildHost()
    expect(
      wakeUpsOf(host)
        .get(a)
        ?.level.jobs.map((job) => job.id),
    ).toEqual(['job-b'])
    expect(wakeUpsOf(host).get(a)?.startAt).toBe(local(9, 28, 16, 15) - 30_000)
  })

  it('🔴 a one-shot whose minute came stays listed, with no time said, until its provider’s level leaves it out — and no start is made later to tell of it', async () => {
    clock = local(9, 28, 12, 0)
    const a = await opens('agent-a')
    creates(a, ONE_SHOT_A)
    creates(a, NIGHTLY)
    states(a, ONE_SHOT_A, NIGHTLY)
    await waitFor(() => held(a).length === 2, 'its jobs')
    await settle()
    const handlesBefore = handlesOf(a).length

    // Its minute comes, and its provider begins a turn by itself.
    clock = local(9, 28, 14, 45, 3)
    burstBegins(a)
    await waitFor(
      () => ledger(a).some((event) => event.type === 'provider_turn'),
      'the turn its provider began',
    )
    await settle()
    // ⛔ Nothing says this turn is that job's: the turn names no job, and the job is still listed.
    const begun = ledger(a).find((event) => event.type === 'provider_turn')
    expect(begun).not.toHaveProperty('oneShotCameDue')
    expect(held(a)).toEqual(['job-a', 'nightly'])

    // The turn ends. ⛔ No time is said for a minute that has passed: the time said is the nightly
    // job's, the next one ahead.
    burstEnds(a)
    await waitFor(() => stateOf(a)?.is === 'scheduled', 'the turn to end')
    expect(stateOf(a)).toEqual({ is: 'scheduled', dueAt: local(9, 29, 3, 0) })
    expect(heldRows(a).find((job) => job.id === 'job-a')?.nominalAt ?? 0).toBeLessThan(clock)
    // Its provider's level leaves the one-shot out: it is gone from the listing.
    states(a, NIGHTLY)
    await waitFor(() => held(a).length === 1, 'the one-shot to leave the listing')
    expect(held(a)).toEqual(['nightly'])
    await settle()

    // A stop: the conversation saw the job come due and leave, so nothing is held to tell it, and
    // the only start planned is for the job that is left.
    await host.close(a, THE_APP_ITSELF)
    await settle()
    expect(noticesIn(a)).toEqual([])
    expect(
      wakeUpsOf(host)
        .get(a)
        ?.level.jobs.map((job) => job.id),
    ).toEqual(['nightly'])
    expect(handlesOf(a)).toHaveLength(handlesBefore)
  })

  it('🔴 a job a start did not bring back is told at its next stop, once, in words that claim nothing', async () => {
    clock = local(9, 28, 12, 0)
    const a = await opens('agent-a')
    creates(a, LATER_B)
    states(a, LATER_B)
    await waitFor(() => held(a).length === 1, 'its job')
    await settle()
    await host.closeAll()

    // The app starts again, and a person writes to it before the job's time.
    clock = local(9, 28, 12, 30)
    host = buildHost()
    const sent = await host.startAndSend(a, 'hello', window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(() => handlesOf(a).length === 2, 'A to be started by the message')
    await settle()
    // Its provider's level after that start does not list the job: the start did not bring it back.
    states(a)
    await waitFor(() => held(a).length === 0, 'the level with no job')
    await settle()
    expect(noticesIn(a)).toEqual([])

    // At its next stop the word is owed, so it is held, and the conversation started to read it.
    await host.close(a, THE_APP_ITSELF)
    await waitFor(() => noticesIn(a).length > 0, 'the word about the job')
    expect(noticesIn(a)[0]?.text).toBe(
      `Your scheduled job for ${clockTime(local(9, 28, 16, 15))} (“ship it”) is no longer on your schedule. This app cannot tell whether it ran or was cancelled.`,
    )
    await waitFor(() => handlesOf(a).length === 3, 'A to be started to read it')
    await settle()
    // Told once: a later stop holds nothing more, and starts nothing.
    await host.close(a, THE_APP_ITSELF)
    await settle()
    expect(noticesIn(a).filter((one) => one.type === 'message_queued')).toHaveLength(1)
    expect(handlesOf(a)).toHaveLength(3)
  })
})
