import type { AgentState, ScheduleLevel } from '../../src/shared/agent-state-contracts'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, vi, type MockInstance } from 'vitest'
import { FakeProviderSessions, FakeRuntime, FakeSessionHandle } from '@brobot2/runtime'
import type { ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import {
  createSessionStore,
  MAX_SCHEDULE_HISTORY_WALKED,
  type SessionStore,
} from '../../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from '../../src/main/runtime/runtime-host'
import { resourcesRoot } from '../../src/main/resources/resources'
import { resolveSessionCwd } from '../../src/main/runtime/scratch-cwd'
import { scheduleAttemptsIn, type KeptAttempts } from '../../src/main/schedule-attempts-file'
import { clockTime } from '../../src/shared/clock'
import type { RuntimeStatesMessage } from '../../src/shared/runtime-ipc'
import { RecordingSink, syntheticProviderHome, neutralHostDeps } from '../lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
export const migrationsFolder = join(here, '../../src/main/db/migrations')

/** A moment on the Mac's wall clock in 2026, whatever the zone. */
export const local = (
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): number => new Date(2026, month - 1, day, hour, minute, second).getTime()

/** The host's lead before a job's minute: thirty seconds. */
export const LEAD = 30_000
/** When the one-shot below was made, and when its minute is. */
const LISTED = local(9, 28, 11, 50)
export const DUE = local(9, 28, 14, 45)
/** Twenty-five seconds before {@link DUE}: inside the lead, so a wake-up is owed at once. */
export const LATE = local(9, 28, 14, 44, 35)

/** A one-shot at 14:45. */
export const ONE_SHOT_A = {
  id: 'job-a',
  schedule: '45 14 28 9 *',
  recurring: false,
  prompt: 'check the deploy',
} as const

/** A delay no other timer in the host uses, and no test waits out. */
const IDLE = 7_654_321

export async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** A stretch of the event loop long enough for everything a provider row starts to have run. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

/** What a test can switch on the provider double, and what it reads off it. */
interface ProviderControl {
  /** While set, a resume fails the way a machine that cannot spawn a process does. */
  failResume: boolean
  /** When each resume was asked for, on a clock that is never set. */
  resumedAt: number[]
  /** While set, what the host does about scheduled jobs cannot be written. */
  attemptsCannotBeKept?: boolean
  /** While set, a resume waits for it before the provider is up. */
  holdResume?: Promise<void>
  /** While set, the disk fills as a resume is asked for: nothing can be written after it. */
  diskFillsOnResume?: boolean
  /** While set, the host has a saved key, read as a launch begins, before anything starts. */
  keys?: FakeKeys
}

type KeyDeps = NonNullable<ConstructorParameters<typeof RuntimeHost>[0]['apiKeys']>
const UNREADABLE_KEY = 'BroCrew can’t read the API key saved for Claude on this computer.'

/** A saved key that cannot be read until it is saved again, and how often it was read. */
interface FakeKeys {
  broken: boolean
  knownUnreadable: boolean
  reads: number
  readonly deps: KeyDeps
}
export function fakeKeys(): FakeKeys {
  const keys = { broken: true, knownUnreadable: false, reads: 0 } as FakeKeys
  const deps: KeyDeps = {
    status: (provider) =>
      ({
        provider,
        set: true,
        setAt: 1,
        inUse: !keys.broken && !keys.knownUnreadable,
        ...(keys.knownUnreadable
          ? { readState: 'unreadable', unreadableReason: UNREADABLE_KEY }
          : {}),
      }) as ReturnType<KeyDeps['status']>,
    remove: () => {
      keys.broken = false
      keys.knownUnreadable = false
      return true
    },
    set: () => {
      keys.broken = false
      keys.knownUnreadable = false
      return null
    },
    read: () => {
      keys.reads += 1
      if (keys.broken) {
        keys.knownUnreadable = true
        throw new Error(UNREADABLE_KEY)
      }
      return null
    },
  }
  return Object.assign(keys, { deps })
}

/** The provider double: every handle it issues, a start and a resume alike. */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    private readonly control: ProviderControl,
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
    if (this.control.diskFillsOnResume === true) this.control.attemptsCannotBeKept = true
    if (this.control.failResume) throw new Error('the machine refused to spawn')
    // The key is read as a launch begins, before anything is started.
    if (this.control.keys !== undefined) await this.control.keys.deps.read('claude')
    this.control.resumedAt.push(performance.now())
    if (this.control.holdResume !== undefined) await this.control.holdResume
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

/** A wake-up as the host holds it — read off the private map, as `reopen-while-closing` reads `slots`. */
interface WakeUpRead {
  level: ScheduleLevel
  startAt: number
  failed: number
  timer: ReturnType<typeof setTimeout> | null
  waitingForItsKey: Provider | null
}

/** What the host keeps about scheduled jobs, as a test reads it. */
export type KeptAttemptsRead = KeptAttempts

/** A timer the host armed: the callback it armed it with and the delay it asked for. */
export interface TimerCall {
  readonly fn: () => void
  readonly delay: number
}

export type WordsInARow = TranscriptEvent & {
  type: 'user_turn' | 'message_queued'
  text: string
  appNotice?: string
}

export interface Job {
  readonly id: string
  readonly schedule: string
  readonly recurring: boolean
  readonly prompt: string
}

export const NIGHTLY: Job = {
  id: 'nightly',
  schedule: '0 3 * * *',
  recurring: true,
  prompt: 'run the nightly check',
}

/** The pause between two starts the host makes by itself, in these tests. */
export const GAP = 120

/**
 * The world of the host cases, set up afresh for each case and closed after it: a real store and
 * the attempts file over one database, a provider double, a window and timer spies. Called once
 * in a `describe`; each case reads its own values through what this returns.
 */
export function aWakeUpApp() {
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
  /** Every message the host pushed on `runtime:states`, in order. */
  let pushed: RuntimeStatesMessage[]
  let setTimeoutSpy: MockInstance<typeof setTimeout>
  let clearTimeoutSpy: MockInstance<typeof clearTimeout>
  let infoSpy: MockInstance<typeof console.info>
  let warnSpy: MockInstance<typeof console.warn>
  const tick = (): number => clock++

  /**
   * A host over the shared database and the shared file of attempts. `listening` is what main
   * hands every window: without it the host has nobody to tell, and arms nothing on its own.
   */
  const buildHost = (idleStopAfterMs: number, listening = true): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, control, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
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
        ? {
            statesMoved: (message: RuntimeStatesMessage): void => {
              pushed.push(message)
            },
          }
        : {}),
      scheduleAttempts: {
        read: () => scheduleAttemptsIn(db).read(),
        write: (kept) => {
          if (control.attemptsCannotBeKept === true) throw new Error('the disk is full')
          scheduleAttemptsIn(db).write(kept)
        },
      },
      startGapMs: GAP,
      ...(control.keys === undefined ? {} : { apiKeys: control.keys.deps }),
      idleStopAfterMs,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-wakeup-host-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-wakeup-host-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = LISTED
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    pushed = []
    control = { failResume: false, resumedAt: [] }
    issued = new FakeProviderSessions()
    // Call-through: the host still gets real timers, the test reads what it armed.
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    host = buildHost(IDLE)
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    // Every countdown and wake-up the hosts armed is unref'd and far off; drop them anyway.
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

  /** The `setTimeout` call that returned this very timer. */
  const timerCall = (timer: ReturnType<typeof setTimeout> | null): TimerCall => {
    if (timer === null) throw new Error('that wake-up holds no timer')
    const index = setTimeoutSpy.mock.results.findIndex((result) => result.value === timer)
    const call = setTimeoutSpy.mock.calls[index]
    if (index < 0 || call === undefined) throw new Error('no setTimeout call returned that timer')
    return { fn: call[0] as () => void, delay: Number(call[1]) }
  }

  const stateOf = (h: RuntimeHost, id: string): AgentState | undefined =>
    h.agentCard(id, THE_APP_ITSELF, id)?.state

  const ledger = (id: string): TranscriptEvent[] => store.events(id).map((entry) => entry.event)

  const wordsIn = (id: string): WordsInARow[] =>
    ledger(id).filter(
      (event): event is WordsInARow =>
        event.type === 'user_turn' || event.type === 'message_queued',
    )
  const noticesIn = (id: string): WordsInARow[] =>
    wordsIn(id).filter((one) => one.appNotice === 'a-scheduled-job-that-will-not-run')
  const heldNotices = (id: string): WordsInARow[] =>
    noticesIn(id).filter((one) => one.type === 'message_queued')
  /** The provider's own id for a conversation — what its handles carry. */
  const providerIdOf = (id: string): string => {
    const found = store.find(id)
    if (found === null) throw new Error(`${id} has no provider ref`)
    return found.ref.sessionId
  }
  /** Every handle the provider double issued for one conversation: its start, then each resume. */
  const handlesOf = (id: string): FakeSessionHandle[] =>
    handles.filter((handle) => handle.ref.sessionId === providerIdOf(id))
  /** The newest — a resumed conversation has two. */
  const doubleOf = (id: string): FakeSessionHandle => {
    const found = handlesOf(id).at(-1)
    if (found === undefined) throw new Error(`no provider double carries ${id}'s ref`)
    return found
  }
  const runningOf = (id: string): string | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find((row) => row.sessionId === id)
      ?.running
  const liveCountdowns = (): number => {
    const cleared = new Set(clearTimeoutSpy.mock.calls.map(([timer]) => timer))
    return setTimeoutSpy.mock.calls.filter(
      (call, index) => call[1] === IDLE && !cleared.has(setTimeoutSpy.mock.results[index]?.value),
    ).length
  }
  const levelRows = (id: string): number =>
    ledger(id).filter((event) => event.type === 'scheduled_work').length

  // ─── A life that schedules, and the restart ──────────────────────────────────────────────────

  /** One conversation, in ask mode, opened as a person would in this window. */
  const opens = async (profileId: string, on: RuntimeHost = host): Promise<string> => {
    const { sessionId } = await on.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  /**
   * Its provider makes these jobs, as its tool hooks report each call, and lists them as its turn
   * ends. ⚑ So each has a receipt: this app knows the minute it was made in.
   */
  const makes = async (id: string, ...jobs: Job[]): Promise<void> => {
    const before = levelRows(id)
    for (const job of jobs) {
      doubleOf(id).simulateScheduledWork({
        jobs: undefined,
        receipt: {
          tool: 'CronCreate',
          toolUseId: `toolu_${job.id}`,
          calledAt: clock,
          answeredAt: clock + 2,
          input: { cron: job.schedule, recurring: job.recurring },
          result: { id: job.id, recurring: job.recurring },
        },
      })
    }
    doubleOf(id).simulateScheduledWork({ jobs: [...jobs] })
    await waitFor(() => levelRows(id) > before + jobs.length, `${id} to list its jobs`)
    await settle()
  }
  /** Its provider lists these jobs with no call seen: jobs this app has no receipt for. */
  const lists = async (id: string, ...jobs: Job[]): Promise<void> => {
    const before = levelRows(id)
    doubleOf(id).simulateScheduledWork({ jobs: [...jobs] })
    await waitFor(() => levelRows(id) > before, `${id} to list its jobs`)
    await settle()
  }

  /**
   * The first life: these conversations opened at ten to noon, each given the chance to schedule,
   * then the quit. ⚑ A quit arms nothing, so whatever wake-up the next host holds is the LAUNCH's.
   */
  const aFirstLife = async (
    schedule: (ids: string[]) => Promise<void>,
    ...profiles: string[]
  ): Promise<string[]> => {
    const made: string[] = []
    for (const profile of profiles) made.push(await opens(profile))
    await schedule(made)
    await host.closeAll()
    return made
  }
  /** The app starts again at this moment: a new host over the same database. */
  const restartsAt = (moment: number, listening = true): RuntimeHost => {
    clock = moment
    host = buildHost(IDLE, listening)
    return host
  }
  const DUE_WHILE_STOPPED =
    'was due while this conversation was stopped. This app cannot tell whether it ran: check whether its work is still needed.'
  const theHeldNotice = (dueAt: number, prompt = 'check the deploy'): string =>
    `Your scheduled job for ${clockTime(dueAt)} (“${prompt}”) ${DUE_WHILE_STOPPED}`
  const TIME_NOT_KNOWN =
    'runs at a time this app cannot tell, so once this conversation stops this app will not start it for that job. If you still need it then, cancel it and schedule it again.'
  const NOT_LISTED_SINCE_A_RESET =
    'has not shown on your schedule since this conversation was cleared or reset, so this app is not starting the conversation for that job. It will again once the job shows on your schedule. If the job is gone and you still need it, schedule it again.'
  const NOT_READ_IN_FULL =
    'is one this app is not starting this conversation for: it could not read enough of this conversation’s history to plan it. It will again once the job shows on your schedule.'
  /** Rows of this conversation's that hold nothing to plan from, as many as the read looks at. */
  const aLongStretchOfWork = (id: string, from: number): void => {
    db.exec(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<${String(MAX_SCHEDULE_HISTORY_WALKED + 1)})
      INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
      SELECT 'stretch-'||n, '${id}', 0, 10000000+n, 'status', '{"type":"status","state":"working"}', ${String(from)}+n FROM seq`)
  }
  const NO_LONGER_STARTED =
    'has not shown on your schedule since this app last started, or tried to start, this conversation for it, so this app has stopped starting the conversation for that job. If you still need it, list your scheduled jobs, cancel it if it is still there, and schedule it again.'
  /** The newest level in a conversation's ledger, whoever wrote it. */
  const newestLevel = (id: string): TranscriptEvent | undefined =>
    ledger(id)
      .filter((event) => event.type === 'scheduled_work' && 'jobs' in event)
      .at(-1)

  return {
    /** The host of this life: {@link restartsAt} puts a new one in its place. */
    get host(): RuntimeHost {
      return host
    },
    /** The clock the store and the hosts read: each of their reads moves it on a millisecond. */
    get clock(): number {
      return clock
    },
    set clock(moment: number) {
      clock = moment
    },
    get db() {
      return db
    },
    get store() {
      return store
    },
    get handles() {
      return handles
    },
    get issued() {
      return issued
    },
    get control() {
      return control
    },
    get window() {
      return window
    },
    get setTimeoutSpy() {
      return setTimeoutSpy
    },
    get infoSpy() {
      return infoSpy
    },
    get warnSpy() {
      return warnSpy
    },
    wakeUpsOf,
    timerCall,
    stateOf,
    ledger,
    wordsIn,
    noticesIn,
    heldNotices,
    providerIdOf,
    handlesOf,
    doubleOf,
    runningOf,
    liveCountdowns,
    opens,
    makes,
    lists,
    aFirstLife,
    restartsAt,
    theHeldNotice,
    TIME_NOT_KNOWN,
    NOT_LISTED_SINCE_A_RESET,
    NOT_READ_IN_FULL,
    aLongStretchOfWork,
    NO_LONGER_STARTED,
    newestLevel,
  }
}
