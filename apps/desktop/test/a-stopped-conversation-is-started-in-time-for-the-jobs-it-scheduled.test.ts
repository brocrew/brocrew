import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { FakeProviderSessions, FakeRuntime, FakeSessionHandle } from '@brobot2/runtime'
import type { ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  createSessionStore,
  MAX_SCHEDULE_HISTORY_WALKED,
  type SessionStore,
} from '../src/main/db/session-store'
import {
  RuntimeHost,
  scheduleNoticesText,
  THE_APP_ITSELF,
  type NoticeAboutAJob,
} from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  MAX_ATTEMPT_CONVERSATIONS,
  readKeptAttempts,
  scheduleAttemptsFile,
  writeKeptAttempts,
  type ConversationAttempts,
} from '../src/main/schedule-attempts-file'
import type { AgentState, ScheduleLevel } from '../src/shared/agent-state'
import { clockTime, clockTimeFrom } from '../src/shared/clock'
import type {
  RuntimeEventMessage,
  RuntimeStatesMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

/**
 * # D-029 · a stopped conversation is started in time for the jobs it scheduled
 *
 * The app starts a stopped conversation for its scheduled jobs. At launch, for each conversation
 * whose newest level in the ledger holds a job, and at every stop, it plans from the conversation's
 * own evidence — the receipts of its scheduling calls and the levels its provider stated — and arms
 * ONE wake-up: the level the plan lists, the moment to start, and one timer. A job made with a
 * receipt has a known minute, and its conversation is started half a minute before it; a job known
 * only from a level has none, and costs one start, once. What passed or went while the conversation
 * was stopped is told to it instead, once.
 *
 * ## Three setups in one file
 *
 *  - **The words are PURE** — `scheduleNoticesText`, every moment built by `local(...)` so no test
 *    names a zone.
 *  - **The ledger read is the REAL STORE** (real SQLite, the migrations): the newest level of each
 *    conversation.
 *  - **The rest runs the REAL HOST** over that store with a provider double. A first life really
 *    schedules its jobs — the double reports the call as the provider's tool hooks do, then the
 *    level — and quits; a "restart" is `closeAll()`, then a new host over the same database and the
 *    same file of attempts. A quit arms nothing, so a wake-up in the second life is the LAUNCH's own.
 *
 * ## How no test waits for a minute
 *
 * A wake-up's timer is a `setTimeout` the host armed; the file reads each one through a call-through
 * spy (the timer it got back, the delay and the callback) and runs it BY HAND where the test is
 * about when it fires. The host's clock is `tick`, a counter the test sets, so "now" is exactly the
 * moment the test names and moves one millisecond per read.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** A moment on the Mac's wall clock in 2026, whatever the zone. */
const local = (month: number, day: number, hour: number, minute: number, second = 0): number =>
  new Date(2026, month - 1, day, hour, minute, second).getTime()

/** The host's lead before a job's minute: thirty seconds. */
const LEAD = 30_000
/** When the one-shot below was made, and when its minute is. */
const LISTED = local(9, 28, 11, 50)
const DUE = local(9, 28, 14, 45)
/** Twenty-five seconds before {@link DUE}: inside the lead, so a wake-up is owed at once. */
const LATE = local(9, 28, 14, 44, 35)

/** A one-shot at 14:45. */
const ONE_SHOT_A = {
  id: 'job-a',
  schedule: '45 14 28 9 *',
  recurring: false,
  prompt: 'check the deploy',
} as const

/* ══════════════════ what a conversation is told of its jobs ══════════════════ */

describe('D-029 · what a conversation is told of its scheduled jobs', () => {
  const now = local(9, 28, 15, 0)
  const passed = (prompt: string | undefined, dueAt: number | null = DUE): NoticeAboutAJob => ({
    reason: 'offline-time-passed',
    dueAt,
    ...(prompt === undefined ? {} : { prompt }),
  })
  const gone = (prompt: string | undefined, dueAt: number | null = DUE): NoticeAboutAJob => ({
    ...passed(prompt, dueAt),
    reason: 'not-present',
  })
  const PASSED_ONE =
    'was due while this conversation was stopped. This app cannot tell whether it ran: check whether its work is still needed.'
  const PASSED_MANY =
    'were due while this conversation was stopped. This app cannot tell whether they ran: check whether their work is still needed.'
  const GONE_ONE =
    'is no longer on your schedule. This app cannot tell whether it ran or was cancelled.'

  it('each kind in a plain sentence, each job by its minute and the first line it asked', () => {
    const t1 = clockTime(DUE)
    const t2 = clockTime(local(9, 28, 14, 50))
    const t3 = clockTime(local(9, 28, 14, 55))
    expect(t1).not.toBe('')
    expect(t1).not.toBe(t2)

    // One, two and three whose time passed.
    expect(scheduleNoticesText([passed('check the deploy')], now)).toBe(
      `Your scheduled job for ${t1} (“check the deploy”) ${PASSED_ONE}`,
    )
    expect(scheduleNoticesText([passed('a'), passed('b', local(9, 28, 14, 50))], now)).toBe(
      `Your scheduled jobs for ${t1} (“a”) and for ${t2} (“b”) ${PASSED_MANY}`,
    )
    expect(
      scheduleNoticesText(
        [passed('a'), passed('b', local(9, 28, 14, 50)), passed('c', local(9, 28, 14, 55))],
        now,
      ),
    ).toBe(
      `Your scheduled jobs for ${t1} (“a”), for ${t2} (“b”) and for ${t3} (“c”) ${PASSED_MANY}`,
    )
    // Two kinds: a sentence each, one space between, whatever order they came in.
    expect(scheduleNoticesText([gone('b', local(9, 28, 14, 50)), passed('a')], now)).toBe(
      `Your scheduled job for ${t1} (“a”) ${PASSED_ONE} Your scheduled job for ${t2} (“b”) ${GONE_ONE}`,
    )
    // ⛔ It never says a job did not run: nothing public says which turn a job began.
    for (const reason of [
      'offline-time-passed',
      'recurring-offline-interval',
      'not-present',
      'expired-on-resume',
      'compaction-confirmed',
    ] as const) {
      const said = scheduleNoticesText([{ reason, dueAt: DUE, prompt: 'p' }], now)
      expect(said, reason).toContain(`Your scheduled job for ${t1} (“p”) `)
      expect(said, reason).not.toMatch(/did not run|will not run|never ran/)
    }
    // Nothing to tell, nothing said.
    expect(scheduleNoticesText([], now)).toBe('')

    // A job due yesterday says its day; one due today does not.
    const yesterday = local(9, 27, 14, 45)
    expect(clockTimeFrom(yesterday, now)).not.toBe(clockTime(yesterday))
    expect(scheduleNoticesText([passed('a', yesterday)], now)).toContain(
      `for ${clockTimeFrom(yesterday, now)} (“a”)`,
    )
    expect(clockTimeFrom(DUE, now)).toBe(clockTime(DUE))

    // Only the first line of what it asked is told, whatever its line breaks.
    const manyLines = scheduleNoticesText([passed('first line\r\nsecond line')], now)
    expect(manyLines).toContain('(“first line”)')
    expect(manyLines).not.toContain('second line')
    // Eighty code points are told whole; the eighty-first is the cut, marked with an ellipsis.
    expect(scheduleNoticesText([passed('😀'.repeat(80))], now)).toContain(`(“${'😀'.repeat(80)}”)`)
    const cut = scheduleNoticesText([passed('😀'.repeat(81))], now)
    expect(cut).toContain(`(“${'😀'.repeat(80)}…”)`)
    expect(cut).not.toContain('😀'.repeat(81))

    // A clause is left out when the fact behind it is absent, and present when it is not.
    expect(scheduleNoticesText([passed('p', null)], now)).toBe(
      `Your scheduled job (“p”) ${PASSED_ONE}`,
    )
    expect(scheduleNoticesText([passed(undefined)], now)).toBe(
      `Your scheduled job for ${t1} ${PASSED_ONE}`,
    )
    expect(scheduleNoticesText([passed(undefined, null)], now)).toBe(
      `Your scheduled job ${PASSED_ONE}`,
    )
  })
})

/* ══════════════════ what the ledger says, read off the real store ══════════════════ */

describe('D-029 · what the ledger says a conversation scheduled', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let warn: MockInstance<typeof console.warn>
  let clock: number
  const tick = (): number => clock++
  const ordinals = new Map<string, number>()

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-wakeup-ledger-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 1_000
    store = createSessionStore(db, tick)
    ordinals.clear()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const conversation = (id: string): string => {
    store.create({ id, provider: 'claude', cwd: userData, approvalMode: 'ask', profileId: 'agent' })
    return id
  }
  const append = (id: string, event: Record<string, unknown>, at: number): void => {
    const next = ordinals.get(id) ?? 0
    ordinals.set(id, next + 1)
    store.append(id, next, event as unknown as TranscriptEvent, at)
  }
  const lists = (id: string, jobs: Record<string, unknown>[], at: number): void =>
    append(id, { type: 'scheduled_work', jobs, source: 'test' }, at)
  /** A row whose payload is written raw, as a torn or short one is: ordinals past any real one. */
  const rawLevel = (id: string, ordinal: number, payload: string, at: number): void => {
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, 0, ?, 'scheduled_work', ?, ?)`,
    ).run(`evt_${id}_${String(ordinal)}`, id, ordinal, payload, at)
  }

  it("a wake-up is built from each conversation's newest level: an emptied level hides an older one, and a torn one costs only its own conversation", () => {
    // The control: a store that holds no conversation reads nothing.
    expect(store.newestScheduleLevels()).toEqual([])

    const nightly = { id: 'j1', schedule: '0 3 * * *', recurring: true, prompt: 'nightly' }
    const once = { id: 'j2', schedule: '30 4 28 9 *', recurring: false }
    // keeps: a level, a compaction, a newer level that adds a job, a newer compaction.
    conversation('sess_keeps')
    lists('sess_keeps', [nightly], 100)
    append('sess_keeps', { type: 'compaction', source: 'test' }, 150)
    lists('sess_keeps', [nightly, once], 200)
    append('sess_keeps', { type: 'compaction', source: 'test' }, 250)
    // cleared: a job, then the model clears the schedule.
    conversation('sess_cleared')
    lists('sess_cleared', [{ id: 'jobA', schedule: '0 3 * * *', recurring: true }], 100)
    lists('sess_cleared', [], 200)
    // torn: a valid level, then a row that is not JSON.
    conversation('sess_torn')
    lists('sess_torn', [{ id: 'jobB', schedule: '0 3 * * *', recurring: true }], 100)
    rawLevel('sess_torn', 900, 'not json', 200)
    // short: one readable row, one with no id, one whose id is no string, and a stated count of one.
    conversation('sess_short')
    rawLevel(
      'sess_short',
      900,
      '{"jobs":[{"id":"ok","schedule":"0 3 * * *","recurring":true},{"schedule":"no id"},{"id":7}],"dropped":1}',
      300,
    )
    // understated: no row to list, and a count that says two were not.
    conversation('sess_understated')
    rawLevel('sess_understated', 900, '{"jobs":[],"dropped":2}', 300)
    // quiet: says nothing about a schedule at all.
    conversation('sess_quiet')
    append('sess_quiet', { type: 'status', state: 'idle' }, 100)

    const read = [...store.newestScheduleLevels()].sort((a, b) =>
      a.conversation.localeCompare(b.conversation),
    )

    // The conversations it does read, beside the omissions that follow.
    expect(read.map((row) => row.conversation)).toEqual([
      'sess_keeps',
      'sess_short',
      'sess_understated',
    ])
    const [keeps, short, understated] = read
    // Newest level wins; j1's first listing is its EARLIEST level; the newest compaction is kept.
    expect(keeps?.level).toEqual({
      jobs: [
        { id: 'j1', schedule: '0 3 * * *', recurring: true, prompt: 'nightly', listedSince: 100 },
        { id: 'j2', schedule: '30 4 28 9 *', recurring: false, listedSince: 200 },
      ],
      dropped: 0,
    })
    expect(keeps?.compactedAt).toBe(250)
    // The count adds the stated one to the two rows that could not be read.
    expect(short?.level).toEqual({
      jobs: [{ id: 'ok', schedule: '0 3 * * *', recurring: true, listedSince: 300 }],
      dropped: 3,
    })
    expect(short?.compactedAt).toBeNull()
    expect(understated?.level).toEqual({ jobs: [], dropped: 2 })
    expect(understated?.compactedAt).toBeNull()

    // An emptied newest level hides the older one, and a torn newest does NOT fall back to it: its
    // own conversation is skipped, once, said.
    const absent = read.map((row) => row.conversation)
    expect(absent).not.toContain('sess_cleared')
    expect(absent).not.toContain('sess_torn')
    expect(absent).not.toContain('sess_quiet')
    const lines = warn.mock.calls.map(([line]) => String(line))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('session store skipped an unreadable schedule in sess_torn')
  })
})

/* ══════════════════ the host, over a real store and a provider double ══════════════════ */

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
function fakeKeys(): FakeKeys {
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
type KeptAttemptsRead = ReturnType<typeof readKeptAttempts>

/** A timer the host armed: the callback it armed it with and the delay it asked for. */
interface TimerCall {
  readonly fn: () => void
  readonly delay: number
}

type WordsInARow = TranscriptEvent & {
  type: 'user_turn' | 'message_queued'
  text: string
  appNotice?: string
}

interface Job {
  readonly id: string
  readonly schedule: string
  readonly recurring: boolean
  readonly prompt: string
}

const NIGHTLY: Job = {
  id: 'nightly',
  schedule: '0 3 * * *',
  recurring: true,
  prompt: 'run the nightly check',
}

/** The pause between two starts the host makes by itself, in these tests. */
const GAP = 120

describe('what was done about scheduled jobs is kept for the conversations recorded most recently', () => {
  it('⛔ of one more than the cap, the one recorded longest ago goes, and a read gives back what was written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brobot2-attempts-'))
    try {
      const file = scheduleAttemptsFile(dir)
      const done = (at: number): ConversationAttempts => ({
        attempts: [{ key: 'a job', revision: 'as it was', attempted: true }],
        admittedAt: at,
        told: [{ id: 'a notice', of: 'a making', said: true }],
        runs: { 'a making': { runAt: at, startedAt: at, unanswered: 2 } },
        notStartedSaid: { 'job-a': 'no-word-from-its-provider' },
        at,
      })
      writeKeptAttempts(file, {
        conversations: Object.fromEntries(
          Array.from({ length: MAX_ATTEMPT_CONVERSATIONS + 1 }, (_, n) => [
            `sess_${String(n)}`,
            done(1_000 + n),
          ]),
        ),
      })
      const back = readKeptAttempts(file).conversations
      expect(Object.keys(back)).toHaveLength(MAX_ATTEMPT_CONVERSATIONS)
      // ⚠️ The one dropped is read as nothing done: it costs one more start, and no more.
      expect(back['sess_0']).toBeUndefined()
      expect(back[`sess_${String(MAX_ATTEMPT_CONVERSATIONS)}`]).toEqual(
        done(1_000 + MAX_ATTEMPT_CONVERSATIONS),
      )

      // A file that is not this app's own shape is nothing done, never an error.
      writeFileSync(file, '{ torn')
      expect(readKeptAttempts(file)).toEqual({ conversations: {} })
      writeFileSync(file, JSON.stringify({ conversations: { sess_x: { at: 'yesterday' } } }))
      expect(readKeptAttempts(file)).toEqual({ conversations: {} })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('D-029 · the host starts a stopped conversation in time for the jobs it scheduled', () => {
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
        ? {
            statesMoved: (message: RuntimeStatesMessage): void => {
              pushed.push(message)
            },
          }
        : {}),
      scheduleAttempts: {
        read: () => readKeptAttempts(scheduleAttemptsFile(userData)),
        write: (kept) => {
          if (control.attemptsCannotBeKept === true) throw new Error('the disk is full')
          writeKeptAttempts(scheduleAttemptsFile(userData), kept)
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

  // ─────────────────────────────────────────────────────────────────────────────────────────────

  it('a restart arms one wake-up for each stopped conversation whose newest level holds a job, on a timer of a minute at most, and starts it the lead before its job', async () => {
    const [a, b] = await aFirstLife(
      async ([first, second]) => {
        await makes(first!, ONE_SHOT_A)
        // B made a daily job, and then its provider said nothing is scheduled: nothing to wake it for.
        await makes(second!, NIGHTLY)
        doubleOf(second!).simulateScheduledWork({ jobs: [] })
        await settle()
      },
      'agent-a',
      'agent-b',
    )
    if (a === undefined || b === undefined) throw new Error('two conversations were opened')
    const before = handles.length

    // The control: the same ledger, a host nobody listens to — it arms nothing.
    const quiet = restartsAt(local(9, 28, 12, 0), false)
    expect(wakeUpsOf(quiet).size).toBe(0)
    expect(stateOf(quiet, a)).toEqual({ is: 'idle' })
    expect(handles.length).toBe(before)
    await quiet.closeAll()

    // The same ledger, a host that is listened to.
    const listening = restartsAt(local(9, 28, 12, 0))
    expect([...wakeUpsOf(listening).keys()]).toEqual([a])
    const wake = wakeUpsOf(listening).get(a)
    if (wake === undefined) throw new Error('A holds no wake-up')
    expect(wake.startAt).toBe(DUE - LEAD)
    // Its minute is 2 h 45 min away, and the timer is a minute at most.
    expect(timerCall(wake.timer).delay).toBe(60_000)
    expect(stateOf(listening, a)).toEqual({ is: 'scheduled', dueAt: DUE })
    expect(stateOf(listening, b)).toEqual({ is: 'idle' })
    expect(handles.length).toBe(before)

    // The timer runs thirty seconds before its start: nothing starts, and the clock is read again.
    const first = wake.timer
    clock = local(9, 28, 14, 44, 0)
    timerCall(first).fn()
    await settle()
    expect(handles.length).toBe(before)
    expect(wakeUpsOf(listening).get(a)).toBe(wake)
    expect(wake.timer).not.toBe(first)
    const again = timerCall(wake.timer).delay
    expect(again).toBeGreaterThan(0)
    expect(again).toBeLessThanOrEqual(60_000)
    clearTimeout(first ?? undefined)

    // Twenty seconds past its start, the same timer starts it — with no message.
    const second = wake.timer
    clock = local(9, 28, 14, 44, 50)
    timerCall(second).fn()
    await waitFor(() => handles.length === before + 1, 'A to be started for its job')
    expect(doubleOf(a).origins).toEqual([])
    expect(handlesOf(a)).toHaveLength(2)
    clearTimeout(second ?? undefined)
    await settle()
    expect(wakeUpsOf(listening).has(a)).toBe(false)
  })

  it('a one-shot that came due while the app was down is told once and its conversation started at once; one still ahead is neither', async () => {
    const jobE: Job = { id: 'job-e', schedule: '15 16 28 9 *', recurring: false, prompt: 'ship it' }
    const [a, e] = await aFirstLife(
      async ([first, second]) => {
        await makes(first!, ONE_SHOT_A)
        await makes(second!, jobE)
      },
      'agent-a',
      'agent-e',
    )
    if (a === undefined || e === undefined) throw new Error('two conversations were opened')
    const before = handlesOf(a).length

    // A's 14:45 has passed; E's 16:15 has not.
    restartsAt(local(9, 28, 15, 0))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started')

    // A was told once, held in its ledger, in words that claim only what is known.
    expect(heldNotices(a)).toHaveLength(1)
    expect(heldNotices(a)[0]?.text).toBe(theHeldNotice(DUE))
    // …and the held words went in as its start's first turn.
    await waitFor(
      () =>
        ledger(a).some(
          (event) =>
            event.type === 'assistant_message' &&
            event.text.includes('was due while this conversation was stopped'),
        ),
      'the held words to reach A',
    )
    await settle()
    expect(heldNotices(a)).toHaveLength(1)
    expect(wakeUpsOf(host).has(a)).toBe(false)

    // E, on the same restart: the same shape of job with its time still ahead is neither told nor
    // started — it is waited for.
    expect(noticesIn(e)).toEqual([])
    expect(handlesOf(e)).toHaveLength(1)
    expect(wakeUpsOf(host).get(e)?.startAt).toBe(local(9, 28, 16, 15) - LEAD)
    expect(stateOf(host, e)).toEqual({ is: 'scheduled', dueAt: local(9, 28, 16, 15) })
  })

  it('🔴 a crash leaves no row for a life’s end: a one-shot whose minute passed since its provider last spoke is still told', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    // ⚑ The app died: the quit's own rows for the life's end were never written.
    const ended = db
      .prepare(
        `DELETE FROM events WHERE session_id = ?
           AND ((type = 'status' AND json_extract(payload, '$.state') = 'ended')
             OR (type = 'session' AND json_extract(payload, '$.state') = 'ended'))`,
      )
      .run(a)
    expect(ended.changes).toBeGreaterThan(0)
    const before = handlesOf(a).length

    restartsAt(local(9, 28, 15, 0))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started')
    expect(heldNotices(a)).toHaveLength(1)
    expect(heldNotices(a)[0]?.text).toBe(theHeldNotice(DUE))
  })

  it('🔴 what a start was made for is kept across restarts: told once, started once', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    restartsAt(local(9, 28, 15, 0))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started')
    await waitFor(
      () => ledger(a).some((event) => event.type === 'user_turn'),
      'the held words to go in',
    )
    await settle()
    await host.closeAll()
    const kept = readKeptAttempts(scheduleAttemptsFile(userData)).conversations[a]
    expect(kept?.attempts.some((one) => one.attempted)).toBe(true)
    expect(kept?.told).toHaveLength(1)

    // The app starts again ten minutes on: the same job, the same passed minute — nothing is told
    // again, and nothing is started again.
    restartsAt(local(9, 28, 15, 10))
    await settle()
    expect(wakeUpsOf(host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before + 1)
    expect(heldNotices(a)).toHaveLength(1)
    await host.closeAll()

    // ⚑ The control: without what was kept, the same launch starts it again — so the file is what
    // held it back.
    rmSync(scheduleAttemptsFile(userData))
    restartsAt(local(9, 28, 15, 20))
    await waitFor(() => handlesOf(a).length === before + 2, 'A to be started without the file')
  })

  /** A one-shot two months ahead: its minute never comes in the cases below. */
  const FAR_AHEAD: Job = {
    id: 'job-far',
    schedule: '45 14 28 11 *',
    recurring: false,
    prompt: 'look at the nightly run',
  }
  /** A person starts it, its provider lists no job, and the app is quit with it still up. */
  const aLifeThatListsNothingAt = async (id: string, moment: number): Promise<void> => {
    restartsAt(moment)
    await settle()
    await host.startAndSend(id, 'hello', window)
    await settle()
    await lists(id)
    await host.closeAll()
  }
  /** The same, but the conversation stops with the app still up: its jobs are planned then. */
  const aLifeThatStopsAt = async (id: string, moment: number): Promise<void> => {
    restartsAt(moment)
    await settle()
    await host.startAndSend(id, 'hello', window)
    await settle()
    await lists(id)
    await host.close(id, THE_APP_ITSELF)
    await settle()
  }
  const keptAsDealtWith = (id: string) =>
    (readKeptAttempts(scheduleAttemptsFile(userData)).conversations[id]?.told ?? []).map(
      (one) => one.said,
    )

  it('⚑ a job a start did not bring back over a day ago, with the conversation started twice since, gets no word and no start, now or two launches later', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, FAR_AHEAD), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    // The start that did not bring it back, at noon; then one more life that day.
    await aLifeThatListsNothingAt(a, local(9, 28, 12, 0))
    await aLifeThatListsNothingAt(a, local(9, 28, 13, 0))
    expect(keptAsDealtWith(a)).toEqual([])

    // Three days on it runs and stops: nothing is held for it, and nothing will start it.
    await aLifeThatStopsAt(a, local(10, 1, 12, 0))
    const lives = handlesOf(a).length
    expect(noticesIn(a)).toEqual([])
    expect(wakeUpsOf(host).has(a)).toBe(false)
    // ⚑ Kept as dealt with, with no word said: no later plan raises it.
    expect(keptAsDealtWith(a)).toEqual([false])
    await host.closeAll()

    for (const moment of [local(10, 1, 12, 30), local(10, 2, 9, 0)]) {
      await aLifeThatStopsAt(a, moment)
      expect(noticesIn(a)).toEqual([])
      expect(wakeUpsOf(host).has(a)).toBe(false)
      await host.closeAll()
    }
    // ⛔ Every life since was a person's own.
    expect(handlesOf(a)).toHaveLength(lives + 2)
    expect(keptAsDealtWith(a)).toEqual([false])
  })

  it('🔴 …and the same job is told where that stop is the first since it left, however long the app was closed: the app starts the conversation to say it, once', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, FAR_AHEAD), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    // The start that did not bring it back; the app is quit with it up, so nothing plans for it.
    await aLifeThatListsNothingAt(a, local(9, 28, 12, 0))

    // ⚑ A launch plans only for a conversation whose newest level holds a job: nothing yet.
    restartsAt(local(10, 1, 12, 0))
    await settle()
    expect(wakeUpsOf(host).has(a)).toBe(false)
    expect(noticesIn(a)).toEqual([])
    await host.closeAll()

    restartsAt(local(10, 1, 12, 5))
    await settle()
    await host.startAndSend(a, 'hello', window)
    await settle()
    await lists(a)
    const lives = handlesOf(a).length
    await host.close(a, THE_APP_ITSELF)
    await waitFor(() => handlesOf(a).length === lives + 1, 'the app to start it to say so')
    expect(heldNotices(a)).toHaveLength(1)
    expect(heldNotices(a)[0]?.text).toContain('look at the nightly run')
    await waitFor(
      () => noticesIn(a).some((one) => one.type === 'user_turn'),
      'the held words to go in',
    )
    await settle()
    expect(keptAsDealtWith(a)).toEqual([true])
    await host.closeAll()

    // Told once: a later life is told nothing more, and nothing starts it.
    await aLifeThatStopsAt(a, local(10, 3, 9, 0))
    expect(noticesIn(a).filter((one) => one.type === 'user_turn')).toHaveLength(1)
    expect(heldNotices(a)).toHaveLength(1)
    expect(wakeUpsOf(host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(lives + 2)
  })

  it('⛔ a start of this app’s own is made only on a plan made as it begins: with none, it is put off, and a person’s start still goes on', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    restartsAt(LATE)
    // The wake-up's own look at the plan passes; the look made as the start begins finds none.
    const planning = host as unknown as { planItsWake: (id: string, now: number) => unknown }
    const really = planning.planItsWake.bind(host)
    let looks = 0
    vi.spyOn(planning, 'planItsWake').mockImplementation((id, now) =>
      looks++ === 0 ? really(id, now) : null,
    )
    await waitFor(() => wakeUpsOf(host).get(a)?.failed === 1, 'the start to be put off')
    expect(handlesOf(a)).toHaveLength(before)

    // ⚑ A person writes to it: that start is theirs, and goes on with no plan.
    const sent = await host.startAndSend(a, 'hello', window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started by the person')
  })

  it('⚑ seven stopped conversations at a launch: each one’s history is read once, and the launch’s list once', async () => {
    const profiles = Array.from({ length: 7 }, (_, n) => `agent-${String(n)}`)
    const made = await aFirstLife(
      async (ids) => {
        for (const [n, id] of ids.entries())
          await makes(id, { ...NIGHTLY, id: `nightly-${String(n)}` })
      },
      ...profiles,
    )
    const histories = vi.spyOn(store, 'scheduleEvidenceRows')
    const lists_ = vi.spyOn(store, 'newestScheduleLevels')
    const lastStatus = vi.spyOn(store, 'lastStatusAt')
    const began = performance.now()
    restartsAt(local(9, 28, 12, 0))
    const tookMs = performance.now() - began
    await settle()
    expect(lists_).toHaveBeenCalledTimes(1)
    expect(histories).toHaveBeenCalledTimes(made.length)
    expect(new Set(histories.mock.calls.map(([id]) => id)).size).toBe(made.length)
    expect(lastStatus.mock.calls.length).toBeLessThanOrEqual(made.length)
    // Every one armed for its run, none started now.
    for (const id of made) expect(wakeUpsOf(host).get(id)?.startAt).toBe(local(9, 29, 3, 0) - LEAD)
    // ⚑ An observation, not a bound: what the launch's own work took here.
    infoSpy.mockRestore()
    console.info(`seven-launch: the host's start took ${tookMs.toFixed(1)} ms`)
  })

  it('⚑ a job of unknown time made again by its agent is planned afresh: in time for its next run, and not at once again', async () => {
    const [a] = await aFirstLife(async ([first]) => lists(first!, NIGHTLY), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    restartsAt(local(9, 28, 12, 0))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started, once')
    await settle()
    // Told it cannot be timed, its agent makes it again: a call this app sees, so its time is known.
    await makes(a, NIGHTLY)
    expect(newestLevel(a)).not.toHaveProperty('jobs.0.notStarted')
    await host.close(a, THE_APP_ITSELF)
    await settle()
    expect(wakeUpsOf(host).get(a)?.startAt).toBe(local(9, 29, 3, 0) - LEAD)
    expect(handlesOf(a)).toHaveLength(before + 1)
  })

  it('⚑ a start for a job’s time that comes due while starts due at once wait goes before them', async () => {
    const [a, b, c] = await aFirstLife(
      async ([first, second, third]) => {
        await lists(first!, NIGHTLY)
        await lists(second!, { ...NIGHTLY, id: 'nightly-b' })
        await makes(third!, ONE_SHOT_A)
      },
      'agent-a',
      'agent-b',
      'agent-c',
    )
    if (a === undefined || b === undefined || c === undefined) throw new Error('three were opened')
    const handlesBefore = handles.length
    restartsAt(local(9, 28, 14, 40))
    // A and B are due at once; C, at its job's lead.
    await waitFor(() => handles.length === handlesBefore + 1, 'the first start at once')
    clock = DUE - LEAD
    timerCall(wakeUpsOf(host).get(c)?.timer ?? null).fn()
    await waitFor(() => handles.length === handlesBefore + 3, 'all three to be started')
    const order = handles.slice(handlesBefore).map((one) => one.ref.sessionId)
    // ⚑ C came due during the wider pause before the second start due at once, and went first.
    expect(order[1]).toBe(providerIdOf(c))
  })

  it('⚑ words handed to a start whose first send fails are not lost: they wait, and the next start says them', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    const send = vi
      .spyOn(FakeSessionHandle.prototype, 'send')
      .mockRejectedValueOnce(new Error('the provider went away'))
    restartsAt(local(9, 28, 15, 0))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started')
    await settle()
    const told = (): boolean =>
      ledger(a).some(
        (event) => event.type === 'user_turn' && (event as WordsInARow).appNotice !== undefined,
      )
    // ⚑ Kept as told when the start was made; not yet said.
    expect(told()).toBe(false)
    expect(heldNotices(a)).toHaveLength(1)
    send.mockRestore()
    await host.close(a, THE_APP_ITSELF)
    await settle()
    // The next start, whoever makes it, says them.
    const sent = await host.startAndSend(a, 'hello', window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(told, 'the held words to be said')
  })

  it('🔴 a start of its own is kept as made before the provider is asked: a restart meanwhile makes no second one, and a start that fails is put back and tried again', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    const attemptedIn = (): boolean =>
      readKeptAttempts(scheduleAttemptsFile(userData)).conversations[a]?.attempts.some(
        (one) => one.attempted,
      ) === true

    // A start that fails: what was kept is put back, so the start is asked for again.
    control.failResume = true
    restartsAt(LATE)
    await waitFor(() => wakeUpsOf(host).get(a)?.failed === 1, 'the start to fail')
    expect(attemptedIn()).toBe(false)

    // Held while the provider comes up: the start is already kept as made…
    control.failResume = false
    let release = (): void => {}
    control.holdResume = new Promise<void>((resolve) => {
      release = resolve
    })
    clock += 60_000
    timerCall(wakeUpsOf(host).get(a)?.timer ?? null).fn()
    await waitFor(() => control.resumedAt.length > 0, 'the provider to be asked')
    expect(attemptedIn()).toBe(true)
    // …so a host that starts meanwhile, from the file, makes no second start.
    const first = host
    restartsAt(clock + 1_000)
    await settle()
    expect(wakeUpsOf(host).has(a)).toBe(false)
    control.holdResume = undefined
    release()
    await waitFor(() => handlesOf(a).length === before + 1, 'the held start to come up')
    expect(first).not.toBe(host)
  })

  it('🔴 a start of its own is kept as made from the plan made as it begins: a job that came due since it was reserved is kept as started for too', async () => {
    const LATER: Job = {
      id: 'job-later',
      schedule: '46 14 28 9 *',
      recurring: false,
      prompt: 'then this',
    }
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A, LATER), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    const consumed = (): Set<string> =>
      new Set(
        (readKeptAttempts(scheduleAttemptsFile(userData)).conversations[a]?.attempts ?? [])
          .filter((one) => one.attempted)
          .map((one) => one.key),
      )
    // The provider is held as it comes up, so the file can be read before it is.
    let release = (): void => {}
    control.holdResume = new Promise<void>((resolve) => {
      release = resolve
    })
    restartsAt(LATE)
    // The last look before the start is made a minute on: LATER's start has come due meanwhile.
    const looking = host as unknown as { judgeItsWakeUpAgain(id: string): boolean }
    const look = looking.judgeItsWakeUpAgain.bind(host)
    vi.spyOn(looking, 'judgeItsWakeUpAgain').mockImplementation((id) => {
      clock = local(9, 28, 14, 45, 31)
      return look(id)
    })
    await waitFor(() => control.resumedAt.length > 0, 'the provider to be asked')
    // ⚑ Both are kept as started for before the provider is up.
    expect(consumed()).toContain(JSON.stringify(['job', ONE_SHOT_A.id]))
    expect(consumed()).toContain(JSON.stringify(['job', LATER.id]))
    control.holdResume = undefined
    release()
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started')
    await settle()
    // …and a host rebuilt from the file, with no listing since and LATER's minute still ahead,
    // starts nothing for either.
    await host.close(a, THE_APP_ITSELF)
    await host.closeAll()
    restartsAt(local(9, 28, 14, 45, 40))
    await settle()
    expect(wakeUpsOf(host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before + 1)
  })

  it('⛔ the last look’s plan asks more than was reserved, and that cannot be kept: no start is made', async () => {
    const LATER: Job = {
      id: 'job-later',
      schedule: '46 14 28 9 *',
      recurring: false,
      prompt: 'then this',
    }
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A, LATER), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    restartsAt(LATE)
    const looking = host as unknown as { judgeItsWakeUpAgain(id: string): boolean }
    const look = looking.judgeItsWakeUpAgain.bind(host)
    vi.spyOn(looking, 'judgeItsWakeUpAgain').mockImplementation((id) => {
      clock = local(9, 28, 14, 45, 31)
      control.attemptsCannotBeKept = true
      return look(id)
    })
    await waitFor(() => wakeUpsOf(host).get(a)?.failed === 1, 'the start to be put off')
    expect(handlesOf(a)).toHaveLength(before)
    expect(control.resumedAt).toEqual([])
  })

  it('⛔ a start that fails, whose put-back cannot be written, stays kept as made — here and after a restart: no second start for it', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    control.failResume = true
    control.diskFillsOnResume = true
    restartsAt(LATE)
    await waitFor(() => wakeUpsOf(host).get(a)?.failed === 1, 'the start to fail')
    expect(warnSpy.mock.calls.some(([line]) => String(line).includes('stays kept as made'))).toBe(
      true,
    )
    const job = JSON.stringify(['job', ONE_SHOT_A.id])
    const attemptedIn = (kept: KeptAttemptsRead): boolean =>
      kept.conversations[a]?.attempts.some((one) => one.key === job && one.attempted) === true
    // Kept as made in this host's memory…
    expect(attemptedIn((host as unknown as { attemptsKept: KeptAttemptsRead }).attemptsKept)).toBe(
      true,
    )
    // …and on disk…
    expect(attemptedIn(readKeptAttempts(scheduleAttemptsFile(userData)))).toBe(true)
    // …so a host rebuilt from the file, the job's minute still ahead, starts nothing for it.
    control.failResume = false
    control.diskFillsOnResume = false
    control.attemptsCannotBeKept = false
    await host.closeAll()
    restartsAt(LATE + 5_000)
    await settle()
    expect(wakeUpsOf(host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before)
  })

  it('⛔ a start refused because the saved key cannot be read waits for the key to change: no read on a timer, a relaunch reads it once, and one start once it is saved again', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    const keys = fakeKeys()
    control.keys = keys
    restartsAt(LATE)
    await waitFor(
      () => wakeUpsOf(host).get(a)?.waitingForItsKey === 'claude',
      'A to wait for its key',
    )
    expect(keys.reads).toBe(1)
    // ⛔ No timer at all: nothing will read the key again on its own.
    expect(wakeUpsOf(host).get(a)?.timer).toBeNull()
    // The Providers card's own fact is untouched.
    expect(host.apiKeyStatus('claude')).toMatchObject({ readState: 'unreadable' })

    // A relaunch, the key still unreadable: read once, then it waits again; the back-off is not
    // started over.
    await host.closeAll()
    // A new process knows nothing of the read before it.
    keys.knownUnreadable = false
    restartsAt(LATE + 1_000)
    await waitFor(() => wakeUpsOf(host).get(a)?.waitingForItsKey === 'claude', 'A to wait again')
    expect(keys.reads).toBe(2)
    expect(wakeUpsOf(host).get(a)?.timer).toBeNull()
    // Across what the old back-off would have tried (1, 2, 4 and 8 minutes on), no read.
    clock += 16 * 60_000
    await settle()
    expect(keys.reads).toBe(2)
    expect(handlesOf(a)).toHaveLength(before)

    // Saved again: the start it is owed is made, once.
    await host.setApiKey('claude', 'sk-ant-api03-saved-again')
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started once its key is saved')
    await settle()
    expect(handlesOf(a)).toHaveLength(before + 1)
  })

  it('⚑ a person’s own start is not held back while a wake-up waits for the saved key', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const keys = fakeKeys()
    control.keys = keys
    restartsAt(LATE)
    await waitFor(
      () => wakeUpsOf(host).get(a)?.waitingForItsKey === 'claude',
      'A to wait for its key',
    )
    const reads = keys.reads
    // The person writes to it: that start is made, and reads the key as any launch does.
    await host.startAndSend(a, 'hello', window).catch(() => undefined)
    await settle()
    expect(keys.reads).toBeGreaterThan(reads)
  })

  it('🔴 a window that has a stopped conversation open is shown the level and the words this app writes for it, as they are written; one that does not have it open is shown nothing, and nothing starts', async () => {
    const [f] = await aFirstLife(async ([first]) => makes(first!, NIGHTLY), 'agent-f')
    if (f === undefined) throw new Error('a conversation was opened')
    // Started for its run…
    restartsAt(local(9, 29, 2, 59, 30))
    await waitFor(() => handlesOf(f).length === 2, 'F to be started for its run')
    await settle()
    // A second window has it open, read only; a third has something else open.
    const looking = new RecordingSink('webContents:2')
    const elsewhere = new RecordingSink('webContents:3')
    await host.look(f, looking, false)
    const g = await opens('agent-g')
    await host.look(g, elsewhere, false)
    const shownBefore = looking.messages.length
    const handlesBefore = handlesOf(f).length

    // …and stopped after the run's whole window, its provider having said nothing of the job:
    // this app writes its level, with the job's reason, and holds a word for it.
    clock = local(9, 29, 3, 31)
    await host.close(f, THE_APP_ITSELF)
    await settle()
    const shown = looking.messages.slice(shownBefore).filter((one) => one.sessionId === f)
    const level = shown.find((one) => one.event.type === 'scheduled_work' && 'jobs' in one.event)
    expect(level?.event).toMatchObject({
      source: 'app/receipts',
      jobs: [{ id: 'nightly', notStarted: 'no-word-from-its-provider' }],
    })
    // ⚑ The row as its ledger holds it: the same ordinal, moment and row, so a window that reads
    // the ledger again draws it once.
    const stored = store.events(f).find((one) => one.ordinal === level?.ordinal)
    expect(level).toEqual({ sessionId: f, ...stored })
    // ⚑ …and the word held for its next start, which that window draws as a reopen would.
    expect(
      shown.some(
        (one) =>
          one.event.type === 'message_queued' &&
          (one.event as WordsInARow).appNotice === 'a-scheduled-job-that-will-not-run',
      ),
    ).toBe(true)
    // ⛔ Nothing for a window without it open, and nothing started.
    expect(elsewhere.messages.filter((one) => one.sessionId === f)).toEqual([])
    expect(handlesOf(f)).toHaveLength(handlesBefore)
    expect(wakeUpsOf(host).has(f)).toBe(false)
  })

  it('🔴 a window that moved from a stopped conversation to another is shown none of its later rows, while a window still on it is shown each, as its ledger holds it', async () => {
    const [f] = await aFirstLife(async ([first]) => makes(first!, NIGHTLY), 'agent-f')
    if (f === undefined) throw new Error('a conversation was opened')
    restartsAt(local(9, 29, 2, 59, 30))
    await waitFor(() => handlesOf(f).length === 2, 'F to be started for its run')
    await settle()
    // Two windows have it open, read only. Then one moves to another conversation, and its store
    // lets F go, as it does for a conversation that leaves the screen.
    const moved = new RecordingSink('webContents:2')
    const stays = new RecordingSink('webContents:3')
    await host.look(f, moved, false)
    await host.look(f, stays, false)
    const g = await opens('agent-g')
    await host.look(g, moved, false)
    host.stopLooking(f, moved.ownerId)

    // F is stopped after its run's window with no word: its level and a held word are written.
    clock = local(9, 29, 3, 31)
    const before = store.events(f).at(-1)?.ordinal ?? 0
    await host.close(f, THE_APP_ITSELF)
    await settle()
    const written = store
      .events(f)
      .filter(
        (one) =>
          one.ordinal > before &&
          ((one.event.type === 'scheduled_work' && 'jobs' in one.event) ||
            (one.event.type === 'message_queued' &&
              (one.event as WordsInARow).appNotice === 'a-scheduled-job-that-will-not-run')),
      )
    expect(written).toHaveLength(2)
    // ⚑ The window still on it is shown each, exactly as stored.
    for (const row of written) {
      expect(stays.messages).toContainEqual({ sessionId: f, ...row })
    }
    // ⛔ The one that moved is shown nothing of F.
    expect(moved.messages.filter((one) => one.sessionId === f)).toEqual([])
  })

  /** A row this app writes into the ledger of a conversation nothing runs, as each of its writers does. */
  const writesWhileStopped = (id: string): void => {
    const writer = host as unknown as {
      writeWhileNothingRunsIt(id: string, row: TranscriptEvent): boolean
    }
    const row = { type: 'scheduled_work', jobs: [], source: 'app/receipts' } as TranscriptEvent
    if (!writer.writeWhileNothingRunsIt(id, row)) throw new Error(`${id}'s row was not written`)
  }
  const shownOf = (sink: RecordingSink, id: string): RuntimeEventMessage[] =>
    sink.messages.filter((one) => one.sessionId === id)

  it('🔴 a window that reloads is shown nothing it looked at before, until it looks again; one it looks at after is shown its rows', async () => {
    const g = await opens('agent-g')
    const h = await opens('agent-h')
    await host.close(g, THE_APP_ITSELF)
    await host.close(h, THE_APP_ITSELF)
    const reloads = new RecordingSink('webContents:2')
    await host.look(g, reloads, false)
    writesWhileStopped(g)
    expect(shownOf(reloads, g)).toHaveLength(1)

    // It reloads, and the same window is still there to be sent to.
    await host.closeSessionsForOwner(reloads.ownerId)
    expect(reloads.alive).toBe(true)
    writesWhileStopped(g)
    expect(shownOf(reloads, g)).toHaveLength(1)

    // ⚑ What it looks at now is shown to it; what it looked at before is not brought back.
    await host.look(h, reloads, false)
    writesWhileStopped(h)
    writesWhileStopped(g)
    expect(shownOf(reloads, h)).toHaveLength(1)
    expect(shownOf(reloads, g)).toHaveLength(1)
    // …until it looks at it again.
    await host.look(g, reloads, false)
    writesWhileStopped(g)
    expect(shownOf(reloads, g)).toHaveLength(2)
  })

  /** A look at a conversation whose life just ended, held in its wait until `letItEnd`. */
  const lookThatWaits = async (id: string, sink: RecordingSink) => {
    const teardown = host as unknown as { settleTeardown(id: string): Promise<void> }
    let letItEnd!: () => void
    const held = new Promise<void>((resolve) => (letItEnd = resolve))
    vi.spyOn(teardown, 'settleTeardown').mockImplementationOnce(() => held)
    doubleOf(id).simulateError('its provider went away', true)
    const looked = host.look(id, sink, false)
    await settle()
    return { letItEnd, looked }
  }
  /** The next read of a conversation's record for a look fails. */
  const theNextRecordReadFails = (): void => {
    const reader = host as unknown as {
      recordedHandover(id: string, sink: RuntimeEventSink): unknown
    }
    vi.spyOn(reader, 'recordedHandover').mockImplementationOnce(() => {
      throw new Error('the database is busy')
    })
  }

  it('⛔ a look that waits for a life to end is not counted once its window has reloaded, and a look made after the reload is', async () => {
    // The window reloads while its look waits; the look then ends: it is not counted.
    const a = await opens('agent-a')
    const reloads = new RecordingSink('webContents:2')
    const first = await lookThatWaits(a, reloads)
    await host.closeSessionsForOwner(reloads.ownerId)
    first.letItEnd()
    await first.looked
    writesWhileStopped(a)
    expect(shownOf(reloads, a)).toEqual([])

    // The window stops looking while its look waits: the same.
    const b = await opens('agent-b')
    const second = await lookThatWaits(b, reloads)
    host.stopLooking(b, reloads.ownerId)
    second.letItEnd()
    await second.looked
    writesWhileStopped(b)
    expect(shownOf(reloads, b)).toEqual([])

    // ⚑ The reloaded window looks at the same conversation while the old look still waits: the
    // new look counts, and the old one ending changes nothing — each row is shown once.
    const c = await opens('agent-c')
    const third = await lookThatWaits(c, reloads)
    await host.closeSessionsForOwner(reloads.ownerId)
    await host.look(c, reloads, false)
    third.letItEnd()
    await third.looked
    writesWhileStopped(c)
    expect(shownOf(reloads, c)).toHaveLength(1)
  })

  it('⛔ a look that fails takes back only its own count: a newer look by the same window is still shown each row, and a failed look that is the newest leaves nothing', async () => {
    // ⛔ An older look still waits; the window reloads and looks again, and that look is drawn. The
    // older one then fails to read the record: the newer look is still counted.
    const a = await opens('agent-a')
    const reloads = new RecordingSink('webContents:2')
    const older = await lookThatWaits(a, reloads)
    await host.closeSessionsForOwner(reloads.ownerId)
    await host.look(a, reloads, false)
    theNextRecordReadFails()
    older.letItEnd()
    await expect(older.looked).rejects.toThrow('the database is busy')
    writesWhileStopped(a)
    expect(shownOf(reloads, a)).toHaveLength(1)

    // ⚑ A look that is the newest and fails to read the record leaves its window uncounted.
    const b = await opens('agent-b')
    const only = await lookThatWaits(b, reloads)
    theNextRecordReadFails()
    only.letItEnd()
    await expect(only.looked).rejects.toThrow('the database is busy')
    writesWhileStopped(b)
    expect(shownOf(reloads, b)).toEqual([])
  })

  it('⛔ a reset seen while its evidence is not held, and the first read of it fails: no start is made on what came before', async () => {
    clock = local(9, 28, 12, 0)
    const f = await opens('agent-f')
    await makes(f, NIGHTLY)
    // Its evidence is no longer held, and the next read of it fails.
    ;(host as unknown as { scheduleEvidence: Map<string, unknown> }).scheduleEvidence.delete(f)
    vi.spyOn(store, 'scheduleEvidenceRows').mockImplementationOnce(() => {
      throw new Error('the database is busy')
    })
    doubleOf(f).simulateConversationReset()
    await settle()
    // ⚑ The reset was taken: its mark is in the ledger.
    expect(
      ledger(f).some(
        (event) => event.type === 'scheduled_work' && (event as { reset?: boolean }).reset === true,
      ),
    ).toBe(true)
    await host.close(f, THE_APP_ITSELF)
    await settle()
    expect(wakeUpsOf(host).has(f)).toBe(false)
    // Evicted and read again: still nothing.
    ;(host as unknown as { scheduleEvidence: Map<string, unknown> }).scheduleEvidence.delete(f)
    host.placeTheWakeUpsAgain()
    await settle()
    expect(wakeUpsOf(host).has(f)).toBe(false)
    await host.closeAll()
    restartsAt(local(9, 28, 13, 0))
    await settle()
    expect(wakeUpsOf(host).has(f)).toBe(false)
    expect(handlesOf(f)).toHaveLength(1)
    // A later listing by its provider gives the job back its time.
    const sent = await host.startAndSend(f, 'hello', window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(() => handlesOf(f).length === 2, 'F to be started by the message')
    await settle()
    await lists(f, NIGHTLY)
    expect(newestLevel(f)).toMatchObject({
      jobs: [{ id: 'nightly', nominalAt: local(9, 29, 3, 0) }],
    })
  })

  it('⛔ its provider’s conversation reset and the mark could not be written: no start is made on what came before, and a restart reads the same', async () => {
    clock = local(9, 28, 12, 0)
    const f = await opens('agent-f')
    await makes(f, NIGHTLY)
    const append = store.append.bind(store)
    const failing = vi.spyOn(store, 'append').mockImplementation((id, ordinal, event, at) => {
      if (event.type === 'scheduled_work' && (event as { reset?: boolean }).reset === true) {
        throw new Error('the disk is full')
      }
      return append(id, ordinal, event, at)
    })
    doubleOf(f).simulateConversationReset()
    await settle()
    expect(
      readKeptAttempts(scheduleAttemptsFile(userData)).conversations[f]?.resetUnmarkedAt,
    ).toBeDefined()
    await host.close(f, THE_APP_ITSELF)
    await settle()
    expect(wakeUpsOf(host).has(f)).toBe(false)

    failing.mockRestore()
    await host.closeAll()
    restartsAt(local(9, 28, 13, 0))
    await settle()
    expect(wakeUpsOf(host).has(f)).toBe(false)
    expect(handlesOf(f)).toHaveLength(1)
  })

  it('⛔ a history read only in part, with no level of its provider’s in it: nothing is started or cut, and each job it last held says why', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, NIGHTLY), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    aLongStretchOfWork(a, local(9, 28, 11, 55))
    const before = handlesOf(a).length

    restartsAt(local(9, 28, 12, 0))
    await settle()
    expect(wakeUpsOf(host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before)
    const said = newestLevel(a) as {
      jobs?: { id: string; notStarted?: string; nominalAt?: number }[]
    }
    expect(said).toMatchObject({
      source: 'app/receipts',
      jobs: [{ id: 'nightly', notStarted: 'history-not-read-in-full' }],
    })
    expect(said.jobs?.[0]?.nominalAt).toBeUndefined()
    expect(heldNotices(a).at(-1)?.text).toBe(
      `Your scheduled job (“run the nightly check”) ${NOT_READ_IN_FULL}`,
    )

    // A person writes to it and its provider lists the job: a level is read again, and the job is
    // planned from it — known only from where it is listed, as its making is past the rows read.
    const sent = await host.startAndSend(a, 'hello', window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started by the message')
    await settle()
    await lists(a, NIGHTLY)
    expect(newestLevel(a)).not.toMatchObject({
      jobs: [{ notStarted: 'history-not-read-in-full' }],
    })
  })

  it('⛔ a one-shot already started for, whose making is no longer among the rows read: it looks new, and is not started for again', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    restartsAt(LATE)
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started once')
    await settle()
    // A long stretch of work, then its provider lists the job: the level is read, the making not.
    aLongStretchOfWork(a, clock)
    await lists(a, ONE_SHOT_A)
    await host.closeAll()

    restartsAt(clock + 5_000)
    await settle()
    expect(wakeUpsOf(host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before + 1)
    expect(newestLevel(a)).toMatchObject({
      jobs: [{ id: ONE_SHOT_A.id, notStarted: 'history-not-read-in-full' }],
    })
  })

  it('⛔ while what it does cannot be kept, it makes no start of its own — a restart would make it again — and it tries later', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    control.attemptsCannotBeKept = true
    restartsAt(LATE)
    await waitFor(() => wakeUpsOf(host).get(a)?.failed === 1, 'the start to be put off')
    expect(handlesOf(a)).toHaveLength(before)
    expect(warnSpy.mock.calls.some(([line]) => String(line).includes('cannot be kept'))).toBe(true)

    // It can be kept again: the next try makes the start.
    control.attemptsCannotBeKept = false
    clock += 60_000
    timerCall(wakeUpsOf(host).get(a)?.timer ?? null).fn()
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started once it can be kept')
  })

  it('🔴 a job this app has no receipt for has no known time: one start, at once, and its state names no time', async () => {
    const [a] = await aFirstLife(async ([first]) => lists(first!, NIGHTLY), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    restartsAt(local(9, 28, 12, 0))
    // ⛔ No time is shown that is not known.
    expect(stateOf(host, a)).toEqual({ is: 'scheduled', dueAt: null })
    expect(wakeUpsOf(host).get(a)?.startAt).toBeLessThanOrEqual(clock)
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started once')
    await settle()
    // ⚑ With that one start it is told that this app will make no other for the job.
    expect(heldNotices(a).map((one) => one.text)).toEqual([
      `Your scheduled job (“run the nightly check”) ${TIME_NOT_KNOWN}`,
    ])
    await host.closeAll()

    // The next launch finds the same job, unchanged, and a start already made for it: none again.
    restartsAt(local(9, 28, 12, 30))
    await settle()
    expect(wakeUpsOf(host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before + 1)
    // ⚑ …told once, and its ledger says on the job's own row that it is not started for.
    expect(heldNotices(a)).toHaveLength(1)
    expect(newestLevel(a)).toMatchObject({
      source: 'app/receipts',
      jobs: [{ id: 'nightly', notStarted: 'time-not-known' }],
    })
  })

  it('⛔ a job of unknown time is started for once, however often its provider lists it again unchanged', async () => {
    const [a] = await aFirstLife(async ([first]) => lists(first!, NIGHTLY), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    restartsAt(local(9, 28, 12, 0))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started, once')
    await settle()
    // Its provider lists the same job in the new life: still no call seen, still no known time.
    await lists(a, NIGHTLY)
    expect(newestLevel(a)).toMatchObject({
      source: 'app/receipts',
      jobs: [{ id: 'nightly', notStarted: 'time-not-known' }],
    })
    await host.close(a, THE_APP_ITSELF)
    await settle()
    expect(wakeUpsOf(host).has(a)).toBe(false)

    // …and a restart finds the same: nothing about the job changed, so nothing is started.
    await host.closeAll()
    restartsAt(local(9, 28, 13, 0))
    await settle()
    expect(wakeUpsOf(host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before + 1)
  })

  it('🔴 conversations due together are started one at a time, a pause apart', async () => {
    const jobs = ['a', 'b', 'c'].map((name): Job => ({
      ...ONE_SHOT_A,
      id: `job-${name}`,
      prompt: `check ${name}`,
    }))
    const made = await aFirstLife(
      async (ids) => {
        for (const [index, id] of ids.entries()) await makes(id, jobs[index]!)
      },
      'agent-a',
      'agent-b',
      'agent-c',
    )
    control.resumedAt = []
    restartsAt(LATE)
    await waitFor(() => control.resumedAt.length === made.length, 'all three to be started')
    const [first, second, third] = control.resumedAt as [number, number, number]
    // ⚑ Each was due at once, so each waits out four pauses after the one before it ended — the
    // wider spacing, which one pause alone would not pass.
    expect(second - first).toBeGreaterThanOrEqual(4 * GAP - 20)
    expect(third - second).toBeGreaterThanOrEqual(4 * GAP - 20)
  })

  it('a stop arms the wake-up of what its ledger holds, so the conversation reads scheduled until it is started', async () => {
    clock = local(9, 28, 12, 0)
    const f = await opens('agent-f')
    const g = await opens('agent-g')
    await makes(f, NIGHTLY)
    doubleOf(g).simulateScheduledWork({ jobs: [] })
    await settle()

    await host.close(f, THE_APP_ITSELF)
    await host.close(g, THE_APP_ITSELF)
    await settle()

    // F took its jobs with it, and the stop armed their wake-up: scheduled · 03:00, started the
    // lead before.
    expect(runningOf(f)).toBe('not-running')
    expect(wakeUpsOf(host).get(f)?.startAt).toBe(local(9, 29, 3, 0) - LEAD)
    expect(stateOf(host, f)).toEqual({ is: 'scheduled', dueAt: local(9, 29, 3, 0) })
    expect(noticesIn(f)).toEqual([])
    // G, the same stop with the provider having said nothing is scheduled: idle, and unarmed.
    expect(runningOf(g)).toBe('not-running')
    expect(wakeUpsOf(host).has(g)).toBe(false)
    expect(stateOf(host, g)).toEqual({ is: 'idle' })
  })

  it('a life started for its jobs holds them from its first moment, so the idle stop leaves it alone, until they could no longer run and its provider has said nothing', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    // Inside the lead: the start is owed at once.
    restartsAt(LATE)
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started for its job')
    // The provider says nothing; the life reads what its wake-up held.
    expect(stateOf(host, a)).toEqual({ is: 'scheduled', dueAt: DUE })

    // A plain conversation in the same host IS counted at once; A, scheduled from its seed, is not.
    const h = await opens('agent-h')
    await settle()
    expect(h).not.toBe(a)
    expect(liveCountdowns()).toBe(1)

    const letGo = (): TimerCall[] =>
      setTimeoutSpy.mock.calls
        .filter(([fn]) => String(fn).includes('has said nothing of the jobs'))
        .map(([fn, delay]) => ({ fn: fn as () => void, delay: Number(delay) }))
    expect(letGo()).toHaveLength(1)

    // Before the job's minute plus the lead, the let-go looks again and holds on.
    // ⚑ Its minute is behind us, so the word is plain *scheduled*: no time is promised, and it is
    // not idle.
    clock = local(9, 28, 14, 45, 20)
    letGo()[0]?.fn()
    expect(letGo()).toHaveLength(2)
    expect(stateOf(host, a)).toEqual({ is: 'scheduled', dueAt: null })
    // ⚑ The zone moving reads its jobs again, and the watch holds on.
    host.placeTheWakeUpsAgain()
    await settle()
    expect(stateOf(host, a)).toEqual({ is: 'scheduled', dueAt: null })

    // Past it, with nothing said, the life holds none of them, and D-018 may count it again.
    clock = local(9, 28, 14, 45, 40)
    letGo().at(-1)?.fn()
    await settle()
    expect(stateOf(host, a)).toEqual({ is: 'idle' })
    expect(
      infoSpy.mock.calls.some(([line]) => String(line).includes('holds none of them now')),
    ).toBe(true)
    expect(liveCountdowns()).toBe(2)
  })

  it('⛔ a conversation woken for its job that stops before its provider says anything is not woken again; one whose provider listed the job again is', async () => {
    const jobB: Job = { ...ONE_SHOT_A, id: 'job-b' }
    const [a, b] = await aFirstLife(
      async ([first, second]) => {
        await makes(first!, ONE_SHOT_A)
        await makes(second!, jobB)
      },
      'agent-a',
      'agent-b',
    )
    if (a === undefined || b === undefined) throw new Error('two conversations were opened')
    const before = { a: handlesOf(a).length, b: handlesOf(b).length }

    restartsAt(LATE)
    await waitFor(
      () => handlesOf(a).length === before.a + 1 && handlesOf(b).length === before.b + 1,
      'both to be started for their jobs',
    )
    await settle()

    // B's provider lists its job again: it brought the job back, and runs it from here.
    await lists(b, jobB)

    await host.close(a, THE_APP_ITSELF)
    await host.close(b, THE_APP_ITSELF)

    // B's provider brought the job back, so its stop is woken for it afresh.
    await waitFor(() => handlesOf(b).length === before.b + 2, 'B to be started again for its job')
    await settle()
    // A's provider never spoke: the start made for its job is not made a second time.
    expect(wakeUpsOf(host).has(a)).toBe(false)
    expect(stateOf(host, a)).toEqual({ is: 'idle' })
    expect(runningOf(a)).toBe('not-running')
    expect(handlesOf(a)).toHaveLength(before.a + 1)
  })

  it('🔴 a repeating job is started in time for each run, not at once because a run passed; and not run after run once a start did not bring it back', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, NIGHTLY), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    // A run passed while it was stopped: that is told, at once.
    restartsAt(local(9, 29, 12, 0))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started to be told')
    await settle()
    // ⚑ That start was made long before the next run, so it is not that run's: stopped now, it is
    // woken just before that run.
    await host.close(a, THE_APP_ITSELF)
    await settle()
    const wakeUp = wakeUpsOf(host).get(a)
    expect(wakeUp?.startAt).toBe(local(9, 30, 3, 0) - LEAD)
    expect(stateOf(host, a)).toEqual({ is: 'scheduled', dueAt: local(9, 30, 3, 0) })

    // Its time comes: it is started for that run.
    clock = local(9, 30, 3, 0) - LEAD
    timerCall(wakeUp?.timer ?? null).fn()
    await waitFor(() => handlesOf(a).length === before + 2, 'A to be started for its run')
    await settle()

    // All the time the run could take goes by, and its provider says nothing of the job: it did not
    // bring it back.
    clock = local(9, 30, 3, 31)
    await host.close(a, THE_APP_ITSELF)
    await settle()
    // ⛔ So no start is made for the run after.
    expect(wakeUpsOf(host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before + 2)
    // ⚑ Never silently: the job's own row says so, and the words wait for its next start.
    expect(newestLevel(a)).toMatchObject({
      source: 'app/receipts',
      jobs: [{ id: 'nightly', notStarted: 'no-word-from-its-provider' }],
    })
    expect(heldNotices(a).at(-1)?.text).toBe(
      `Your scheduled job (“run the nightly check”) ${NO_LONGER_STARTED}`,
    )
  })

  it('⛔ a run whose minute has come, though it may yet run late, is told of once and never started for at once, life after life', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, NIGHTLY), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    // Ten minutes after its minute, inside the half hour it may still run in: one start, to tell
    // it that a run may have been missed.
    restartsAt(local(9, 29, 3, 10))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started to be told')
    await settle()
    // Its provider lists the job in that life, and the life stops: the start owed is the next
    // run's, a day on, and none at once.
    await lists(a, NIGHTLY)
    await host.close(a, THE_APP_ITSELF)
    await settle()
    expect(wakeUpsOf(host).get(a)?.startAt).toBe(local(9, 30, 3, 0) - LEAD)

    // …and the same at a restart, still inside that half hour.
    await host.closeAll()
    restartsAt(local(9, 29, 3, 20))
    await settle()
    expect(wakeUpsOf(host).get(a)?.startAt).toBe(local(9, 30, 3, 0) - LEAD)
    expect(handlesOf(a)).toHaveLength(before + 1)
    expect(heldNotices(a)).toHaveLength(1)
  })

  it('⚑ a life started for a run that stops before the run leaves the next run owed, and is not started again for that one', async () => {
    clock = local(9, 28, 12, 0)
    const f = await opens('agent-f')
    await makes(f, NIGHTLY)
    await host.close(f, THE_APP_ITSELF)
    await settle()
    const wakeUp = wakeUpsOf(host).get(f)
    expect(wakeUp?.startAt).toBe(local(9, 29, 3, 0) - LEAD)

    clock = local(9, 29, 3, 0) - LEAD
    timerCall(wakeUp?.timer ?? null).fn()
    await waitFor(() => handlesOf(f).length === 2, 'F to be started for its run')
    await settle()

    // Stopped ten seconds before the run: the start for that run was made, so the next is owed.
    clock = local(9, 29, 2, 59, 50)
    await host.close(f, THE_APP_ITSELF)
    await settle()
    expect(wakeUpsOf(host).get(f)?.startAt).toBe(local(9, 30, 3, 0) - LEAD)
    expect(handlesOf(f)).toHaveLength(2)
    // ⚑ Its time is the run it will be started for, not the one ten seconds off that it will miss.
    expect(stateOf(host, f)).toEqual({ is: 'scheduled', dueAt: local(9, 30, 3, 0) })
  })

  it('⛔ its provider’s conversation is reset and it stops with no level since: no start is made on what was recorded before the reset — until its provider lists the job again', async () => {
    clock = local(9, 28, 12, 0)
    const f = await opens('agent-f')
    await makes(f, NIGHTLY)
    // The control: stopped now, it would be started for the job's next run.
    doubleOf(f).simulateConversationReset()
    await waitFor(
      () => ledger(f).some((event) => event.type === 'scheduled_work' && 'reset' in event),
      'the reset to be marked',
    )
    await settle()
    // ⚑ Said at once on the job's own row, while the conversation is still open.
    expect(newestLevel(f)).toMatchObject({
      source: 'app/receipts',
      jobs: [{ id: 'nightly', notStarted: 'no-word-since-a-reset' }],
    })

    await host.close(f, THE_APP_ITSELF)
    await settle()
    // ⛔ No wake-up: nothing says the job outlived the reset.
    expect(wakeUpsOf(host).has(f)).toBe(false)
    expect(stateOf(host, f)).toEqual({ is: 'idle' })
    expect(heldNotices(f).at(-1)?.text).toBe(
      `Your scheduled job (“run the nightly check”) ${NOT_LISTED_SINCE_A_RESET}`,
    )
    // …and a restart finds the same.
    await host.closeAll()
    restartsAt(local(9, 28, 13, 0))
    await settle()
    expect(wakeUpsOf(host).has(f)).toBe(false)
    expect(handlesOf(f)).toHaveLength(1)

    // A person writes to it, and its provider lists the job: it outlived the reset, its time is
    // as known as before, and a stop is woken in time for its next run.
    const sent = await host.startAndSend(f, 'hello', window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(() => handlesOf(f).length === 2, 'F to be started by the message')
    await settle()
    await lists(f, NIGHTLY)
    expect(newestLevel(f)).not.toHaveProperty('jobs.0.notStarted')
    // ⚑ Its time is known again: what it says of the job, open or stopped, is its next run.
    expect(newestLevel(f)).toMatchObject({
      jobs: [{ id: 'nightly', nominalAt: local(9, 29, 3, 0) }],
    })
    await host.close(f, THE_APP_ITSELF)
    await settle()
    expect(newestLevel(f)).not.toHaveProperty('jobs.0.notStarted')
  })

  it('⛔ three starts of this app’s own in a row with no word of the job from its provider: no more are made for it, and it says so', async () => {
    clock = local(9, 28, 12, 0)
    const f = await opens('agent-f')
    await makes(f, NIGHTLY)
    await host.close(f, THE_APP_ITSELF)
    await settle()

    for (const day of [29, 30, 31]) {
      const wakeUp = wakeUpsOf(host).get(f)
      expect(wakeUp?.startAt, `the run of the ${String(day)}th`).toBe(local(9, day, 3, 0) - LEAD)
      const before = handlesOf(f).length
      clock = local(9, day, 3, 0) - LEAD
      timerCall(wakeUp?.timer ?? null).fn()
      await waitFor(() => handlesOf(f).length === before + 1, 'F to be started for its run')
      await settle()
      // Stopped before the run, its provider having said nothing of the job.
      clock = local(9, day, 2, 59, 50)
      await host.close(f, THE_APP_ITSELF)
      await settle()
    }
    expect(wakeUpsOf(host).has(f)).toBe(false)
    expect(handlesOf(f)).toHaveLength(4)
    expect(newestLevel(f)).toMatchObject({
      source: 'app/receipts',
      jobs: [{ id: 'nightly', notStarted: 'no-word-from-its-provider' }],
    })
    expect(heldNotices(f).at(-1)?.text).toContain(
      `Your scheduled job (“run the nightly check”) ${NO_LONGER_STARTED}`,
    )
    // ⚑ Its provider lists the job again, in a life a person began: it is started for once more.
    const sent = await host.startAndSend(f, 'hello', window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(() => handlesOf(f).length === 5, 'F to be started by the message')
    await settle()
    await lists(f, NIGHTLY)
    expect(newestLevel(f)).not.toHaveProperty('jobs.0.notStarted')
    expect(newestLevel(f)).toMatchObject({
      jobs: [{ id: 'nightly', nominalAt: local(10, 1, 3, 0) }],
    })
    await host.close(f, THE_APP_ITSELF)
    await settle()
    expect(newestLevel(f)).not.toHaveProperty('jobs.0.notStarted')
  })

  it('a wake-up never replaces a conversation that can never be reopened: its told words end with it, and a message still replaces it', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    // The provider no longer has any session: a resume says so.
    issued.forgetAll()
    const idsBefore = store.recorded().map((row) => row.sessionId)
    const handlesBefore = handles.length

    // The job has passed, so a notice is held and the wake-up is due at once.
    restartsAt(local(9, 28, 15, 0))
    await waitFor(
      () => ledger(a).some((event) => event.type === 'message_unqueued'),
      "A's held words to be ended",
    )
    const ended = ledger(a).find((event) => event.type === 'message_unqueued')
    if (ended?.type !== 'message_unqueued') throw new Error('no message was unqueued')
    expect(ended.reason).toBe('abandoned')
    expect(ended.detail).toContain('went with its history')
    expect(ended.text).toBe(theHeldNotice(DUE))
    await settle()

    // The wake-up never replaced it.
    expect(store.replacements()).toEqual([])
    expect(store.recorded().map((row) => row.sessionId)).toEqual(idsBefore)
    expect(wakeUpsOf(host).has(a)).toBe(false)
    expect(stateOf(host, a)).toEqual({ is: 'idle' })
    expect(handles.length).toBe(handlesBefore)

    // A person's message still replaces it, and the words are not handed on.
    await host.startAndSend(a, 'are you there', window)
    const replacement = store.replacements()
    expect(replacement).toHaveLength(1)
    expect(replacement[0]?.replaced).toBe(a)
    const by = replacement[0]?.by
    if (by === undefined) throw new Error('no replacement was recorded')
    expect(noticesIn(by)).toEqual([])
    expect(wordsIn(by).some((one) => one.text.includes('are you there'))).toBe(true)
  })

  it('a message that starts a stopped conversation plans its jobs again first, so a one-shot that passed since the wake-up was armed is told', async () => {
    const jobB: Job = { id: 'job-b', schedule: '15 16 28 9 *', recurring: false, prompt: 'ship it' }
    const [a, b] = await aFirstLife(
      async ([first, second]) => {
        await makes(first!, ONE_SHOT_A)
        await makes(second!, jobB)
      },
      'agent-a',
      'agent-b',
    )
    if (a === undefined || b === undefined) throw new Error('two conversations were opened')

    // Both armed at noon, neither started.
    restartsAt(local(9, 28, 12, 0))
    expect([...wakeUpsOf(host).keys()].sort()).toEqual([a, b].sort())
    expect(noticesIn(a)).toEqual([])

    // The Mac slept: no timer ran, and a person writes to both at ten to three.
    clock = local(9, 28, 14, 50)
    const toA = await host.startAndSend(a, 'hello', window)
    const toB = await host.startAndSend(b, 'hello', window)
    expect('notSent' in toA, JSON.stringify(toA)).toBe(false)
    expect('notSent' in toB, JSON.stringify(toB)).toBe(false)

    // A's one-shot passed since the wake-up was armed: told once…
    expect(heldNotices(a)).toHaveLength(1)
    expect(heldNotices(a)[0]?.text).toBe(theHeldNotice(DUE))
    // …its words are the start's first turn, sent once, and the person's own wait behind them.
    await waitFor(
      () =>
        ledger(a).some(
          (event) =>
            event.type === 'assistant_message' &&
            withoutWhatThisAppAdds(event.text) === `echo: ${theHeldNotice(DUE)}`,
        ),
      'A to be told as its start first turn',
    )
    const rowsOfA = ledger(a)
    const noticeTurn = rowsOfA.findIndex(
      (event) => event.type === 'user_turn' && event.text === theHeldNotice(DUE),
    )
    const helloHeld = rowsOfA.findIndex(
      (event) => event.type === 'message_queued' && event.text === 'hello',
    )
    expect(noticeTurn).toBeGreaterThan(-1)
    expect(helloHeld).toBeGreaterThan(noticeTurn)
    expect(rowsOfA.filter((event) => event.type === 'user_turn')).toHaveLength(1)
    expect(wakeUpsOf(host).has(a)).toBe(false)

    // B, the same start and the same message with its one-shot still ahead: nothing told, and the
    // person's words are its first turn.
    expect(noticesIn(b)).toEqual([])
    await waitFor(
      () =>
        ledger(b).some(
          (event) =>
            event.type === 'assistant_message' &&
            withoutWhatThisAppAdds(event.text).endsWith('\n\nhello'),
        ),
      'B to answer the person',
    )
    const rowsOfB = ledger(b)
    expect(rowsOfB.some((event) => event.type === 'user_turn' && event.text === 'hello')).toBe(true)
    expect(
      rowsOfB.some((event) => 'text' in event && String(event.text).includes('was due while')),
    ).toBe(false)
    expect(wakeUpsOf(host).has(b)).toBe(false)
  })

  it('a failed wake-up start is tried again after a minute, twice as long after each failure, up to half an hour', async () => {
    // First life at two in the morning: its provider makes a nightly job, then the quit.
    clock = local(9, 28, 2, 0)
    const [a] = await aFirstLife(async ([first]) => makes(first!, NIGHTLY), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    // The machine cannot spawn a process; this morning's 03:00 has passed, so a start is owed.
    control.failResume = true
    restartsAt(local(9, 28, 12, 0))
    const wake = wakeUpsOf(host).get(a)
    if (wake === undefined) throw new Error('A holds no wake-up')
    expect(wake.startAt).toBeLessThanOrEqual(clock)
    await waitFor(() => wake.failed === 1, 'the first start to fail')
    // Tried again a minute on, on the same wake-up.
    expect(wake.startAt - clock).toBeGreaterThan(59_000)
    expect(wake.startAt - clock).toBeLessThanOrEqual(60_000)
    expect(wakeUpsOf(host).get(a)).toBe(wake)
    expect(handlesOf(a)).toHaveLength(before)
    // It is told, once, that a run may have been missed: nothing says whether it was.
    expect(heldNotices(a)).toHaveLength(1)
    expect(heldNotices(a)[0]?.text).toContain(
      'may have missed one or more runs while this conversation was stopped',
    )

    // Each failure doubles the wait: 2, 4, 8 and 16 minutes, then the half hour, and the half hour.
    const waits = [120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000]
    for (const [index, expected] of waits.entries()) {
      clock = wake.startAt + 1_000
      timerCall(wake.timer).fn()
      await waitFor(() => wake.failed === index + 2, `start ${String(index + 2)} to fail`)
      expect(wake.startAt - clock, `after failure ${String(index + 2)}`).toBeGreaterThan(
        expected - 1_000,
      )
      expect(wake.startAt - clock, `after failure ${String(index + 2)}`).toBeLessThanOrEqual(
        expected,
      )
      expect(
        warnSpy.mock.calls.some(([line]) =>
          String(line).includes(`tries again in ${String(expected)}ms`),
        ),
      ).toBe(true)
    }
    expect(heldNotices(a)).toHaveLength(1)

    // The paired positive: the same wake-up, once the machine can spawn, starts and is taken.
    control.failResume = false
    clock = wake.startAt + 1_000
    timerCall(wake.timer).fn()
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started at last')
    await settle()
    expect(wakeUpsOf(host).has(a)).toBe(false)
  })
})
