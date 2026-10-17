import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  readKeptAttempts,
  scheduleAttemptsFile,
  writeKeptAttempts,
} from '../src/main/schedule-attempts-file'
import type { AgentState } from '../src/shared/agent-state'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # Scheduled jobs across a crash
 *
 * The app starts a stopped conversation for its scheduled jobs, and keeps what it did about them
 * in two places: the conversation's ledger (the words it holds for the next start, the words it
 * said, the level that says which jobs it is not started for) and `schedule-attempts.json` (the
 * starts it made). The two are written one after the other, so a crash can fall between any two
 * writes. Each case here stops a life of the app at one such point and starts the app again.
 *
 * ## What a crash is here
 *
 * A life of the app is a host with its OWN connection to the real SQLite file and its own store,
 * over one data folder. A crashed life is never closed: it is left where it stopped, waiting on
 * a provider that never answers, or unable to write its file. The next life opens the same
 * database file through a new connection and reads the same attempts file, with nothing held in
 * memory. SQLite's writes here are synchronous, so the files hold exactly what was written before
 * the point the life stopped at.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** A moment on the Mac's wall clock in 2026, whatever the zone. */
const local = (month: number, day: number, hour: number, minute: number, second = 0): number =>
  new Date(2026, month - 1, day, hour, minute, second).getTime()

/** When the jobs below were made. */
const LISTED = local(9, 28, 11, 50)
/** A quarter of an hour after the one-shot's minute: it passed while its conversation was stopped. */
const AFTER_DUE = local(9, 28, 15, 0)

/** A delay no other timer in the host uses, and no test waits out. */
const IDLE = 7_654_321
/** The pause between two starts the host makes by itself, in these tests. */
const GAP = 60

const JOB_NOTICE = 'a-scheduled-job-that-will-not-run'

interface Job {
  readonly id: string
  readonly schedule: string
  readonly recurring: boolean
  readonly prompt: string
}
/** A one-shot at 14:45, made with a receipt: this app knows its minute. */
const ONE_SHOT: Job = {
  id: 'job-a',
  schedule: '45 14 28 9 *',
  recurring: false,
  prompt: 'check the deploy',
}
/** A repeating job its provider only listed: this app has no receipt, so it knows no time. */
const NIGHTLY: Job = {
  id: 'nightly',
  schedule: '0 3 * * *',
  recurring: true,
  prompt: 'run the nightly check',
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** A stretch of the event loop long enough for everything a row starts to have run. */
async function settle(): Promise<void> {
  for (let round = 0; round < 3; round++) {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, GAP + 30))
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

/** Something a life waits on that a test never lets through, until the test ends. */
interface Held {
  readonly promise: Promise<void>
  /** Ends the wait as a failure, so nothing goes on after the test. */
  readonly end: () => void
}
function held(why: string): Held {
  let end = (): void => {}
  const promise = new Promise<void>((_resolve, reject) => {
    end = () => reject(new Error(why))
  })
  // Ended only at the end of a test, when nobody may be waiting on it any more.
  promise.catch(() => {})
  return { promise, end }
}

/** Where a life of the app is made to stop, and what it cannot do. */
interface Stops {
  /** The provider never comes up: a start waits here once it has asked for it. */
  beforeTheProviderIsUp?: Held
  /** The provider is up and never takes the first words handed to it. */
  beforeTheWordsAreTaken?: Held
  /** What the app does about scheduled jobs cannot be written to its file. */
  attemptsCannotBeKept?: boolean
}

type WordsInARow = TranscriptEvent & {
  type: 'user_turn' | 'message_queued'
  text: string
  appNotice?: string
}

/** One life of the app: its own connection, store and host, over the shared data folder. */
interface Life {
  readonly db: AppDatabase
  readonly store: SessionStore
  readonly host: RuntimeHost
  readonly stops: Stops
  /** Every start and resume this life asked its provider for, by the provider's id. */
  readonly asked: string[]
}

describe('scheduled jobs across a crash', () => {
  let userData: string
  let root: string
  let lives: Life[]
  let now: Life
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  /** The provider double of one life: it stops where that life is made to stop. */
  class ProviderOfALife extends FakeRuntime {
    constructor(
      provider: Provider,
      private readonly stops: Stops,
      private readonly asked: string[],
    ) {
      super(provider, { sessions: issued })
    }
    override async start(options: StartOptions): Promise<FakeSessionHandle> {
      const handle = await super.start(options)
      this.asked.push(handle.ref.sessionId)
      handles.push(handle)
      return handle
    }
    override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
      const { stops, asked } = this
      asked.push(ref.sessionId)
      if (stops.beforeTheProviderIsUp !== undefined) await stops.beforeTheProviderIsUp.promise
      const handle = await super.resume(ref, options)
      const wait = stops.beforeTheWordsAreTaken
      if (wait !== undefined) {
        handle.send = async (): Promise<void> => {
          await wait.promise
        }
      }
      handles.push(handle)
      return handle
    }
  }

  /** The app starts at this moment: a new life over the same database file and attempts file. */
  const starts = (moment: number, stops: Stops = {}): Life => {
    clock = moment
    // ⚠️ Its own folder, taken now: a life left behind may still write when a timer of its fires.
    const folder = userData
    const db = openDatabase(join(folder, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    const store = createSessionStore(db, tick)
    const asked: string[] = []
    // ⚠️ A host plans, and may write, as it is built: nothing it is given may read `life`.
    const life: Life = {
      db,
      store,
      stops,
      asked,
      host: new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(folder, 'exports'),
        resourcesRoot: () => resourcesRoot(folder),
        createRuntime: (provider: Provider) => new ProviderOfALife(provider, stops, asked),
        prepareProviderHome: (provider: Provider, profileId?: string) => {
          const home = join(folder, 'provider-homes', profileId ?? 'default', provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider: Provider) => join(folder, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(folder, sessionId, requested),
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
        statesMoved: () => {},
        scheduleAttempts: {
          read: () => readKeptAttempts(scheduleAttemptsFile(folder)),
          write: (kept) => {
            if (stops.attemptsCannotBeKept === true) throw new Error('the disk is full')
            writeKeptAttempts(scheduleAttemptsFile(folder), kept)
          },
        },
        startGapMs: GAP,
        idleStopAfterMs: IDLE,
      }),
    }
    lives.push(life)
    now = life
    return life
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-crash-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-crash-root-'))
    lives = []
    handles = []
    issued = new FakeProviderSessions()
    counter = 0
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const life of lives) {
      life.stops.beforeTheProviderIsUp?.end()
      life.stops.beforeTheWordsAreTaken?.end()
    }
    await settle()
    for (const life of lives) await life.host.closeAll()
    vi.restoreAllMocks()
    for (const life of lives) life.db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  // ─── Reading what the files hold, through the life that is running now ──────────────────────

  const ledger = (id: string): TranscriptEvent[] => now.store.events(id).map((entry) => entry.event)
  const notices = (id: string): WordsInARow[] =>
    ledger(id).filter(
      (event): event is WordsInARow =>
        (event.type === 'user_turn' || event.type === 'message_queued') &&
        (event as WordsInARow).appNotice === JOB_NOTICE,
    )
  /** The words about its jobs each row holds: held for a start, or said to it. */
  const heldWords = (id: string): string[] =>
    notices(id)
      .filter((one) => one.type === 'message_queued')
      .map((one) => one.text)
  const saidWords = (id: string): string[] =>
    notices(id)
      .filter((one) => one.type === 'user_turn')
      .map((one) => one.text)
  const providerIdOf = (id: string): string => {
    const found = now.store.find(id)
    if (found === null) throw new Error(`${id} has no provider ref`)
    return found.ref.sessionId
  }
  /** How often a life asked its provider to bring this conversation up. */
  const askedFor = (life: Life, id: string): number =>
    life.asked.filter((one) => one === providerIdOf(id)).length
  const doubleOf = (id: string): FakeSessionHandle => {
    const found = handles.filter((handle) => handle.ref.sessionId === providerIdOf(id)).at(-1)
    if (found === undefined) throw new Error(`no provider double carries ${id}'s ref`)
    return found
  }
  const levelRows = (id: string): TranscriptEvent[] =>
    ledger(id).filter((event) => event.type === 'scheduled_work')
  /** The levels this app wrote itself, each as the jobs it lists and why each is not started for. */
  const ownLevels = (id: string): (string | null)[][] =>
    levelRows(id)
      .filter((event) => (event as { source?: string }).source === 'app/receipts')
      .flatMap((event) => {
        const jobs = (event as { jobs?: { id: string; notStarted?: string }[] }).jobs
        return jobs === undefined ? [] : [jobs.map((job) => job.notStarted ?? null)]
      })
  const kept = (id: string) => readKeptAttempts(scheduleAttemptsFile(userData)).conversations[id]
  const keptAsMade = (id: string): boolean =>
    kept(id)?.attempts.some((one) => one.attempted) === true
  const stateOf = (id: string): AgentState | undefined =>
    now.host.agentCard(id, THE_APP_ITSELF, id)?.state
  const wakeUpOf = (id: string): unknown =>
    (now.host as unknown as { wakeUps: Map<string, unknown> }).wakeUps.get(id)

  // ─── A first life that schedules, then quits cleanly ────────────────────────────────────────

  /** A conversation is opened, its provider schedules as given, and the app quits. */
  const aConversationWith = async (schedule: (id: string) => Promise<void>): Promise<string> => {
    starts(LISTED)
    const { sessionId } = await now.host.createSession(
      { provider: 'claude', profileId: 'agent-a', approvalMode: 'ask', cwd: root },
      window,
    )
    await schedule(sessionId)
    await now.host.closeAll()
    return sessionId
  }
  /** Its provider makes the job, as its tool hooks report the call, and lists it. */
  const makes = async (id: string, job: Job): Promise<void> => {
    const before = levelRows(id).length
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
    doubleOf(id).simulateScheduledWork({ jobs: [job] })
    await waitFor(() => levelRows(id).length > before + 1, `${id} to list its job`)
    await settle()
  }
  /** Its provider lists the job with no call seen: a job this app has no receipt for. */
  const lists = async (id: string, job: Job): Promise<void> => {
    const before = levelRows(id).length
    doubleOf(id).simulateScheduledWork({ jobs: [job] })
    await waitFor(() => levelRows(id).length > before, `${id} to list its job`)
    await settle()
  }

  /** Rows of this conversation's that hold nothing to plan from, as many as the read looks at. */
  const aLongStretchOfWork = (id: string, from: number): void => {
    now.db
      .exec(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<${String(MAX_SCHEDULE_HISTORY_WALKED + 1)})
      INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
      SELECT 'stretch-'||n, '${id}', 0, 10000000+n, 'status', '{"type":"status","state":"working"}', ${String(from)}+n FROM seq`)
  }

  /** A person starts the conversation in this window, with a word of their own. */
  const aPersonStarts = async (id: string): Promise<void> => {
    const sent = await now.host.startAndSend(id, 'hello', window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await settle()
  }
  const warned = (): string[] => vi.mocked(console.warn).mock.calls.map(([line]) => String(line))

  /** The two kinds of job a stopped conversation is started for at once, with words. */
  const KINDS = [
    {
      kind: 'a one-shot whose minute passed while it was stopped',
      schedule: (id: string) => makes(id, ONE_SHOT),
      at: AFTER_DUE,
      words: 'was due while this conversation was stopped',
      // Its own row lists the job with no reason: nothing more is owed to it but the words.
      notStarted: null,
    },
    {
      kind: 'a job whose time this app cannot know',
      schedule: (id: string) => lists(id, NIGHTLY),
      at: local(9, 28, 12, 0),
      words: 'runs at a time this app cannot tell',
      // Once its one start is kept as made, its own row says it is not started for again.
      notStarted: 'time-not-known',
    },
  ] as const

  for (const { kind, schedule, at, words, notStarted } of KINDS) {
    describe(`a crash while it is started for ${kind}`, () => {
      it('after the words are held and before the start is kept as made: the next launch holds no second copy, makes the one start and says the words once', async () => {
        const a = await aConversationWith(schedule)
        // The file cannot be written, so the start is never kept as made, and never made.
        const crashed = starts(at, { attemptsCannotBeKept: true })
        await waitFor(() => heldWords(a).length === 1, 'the words to be held')
        await settle()
        expect(askedFor(crashed, a)).toBe(0)
        expect(keptAsMade(a)).toBe(false)

        starts(at + 60_000)
        await waitFor(() => saidWords(a).length === 1, 'the words to be said')
        await settle()
        expect(askedFor(now, a)).toBe(1)
        expect(heldWords(a)).toHaveLength(1)
        expect(saidWords(a)).toEqual(heldWords(a))
        expect(saidWords(a)[0]).toContain(words)
        expect(keptAsMade(a)).toBe(true)
        expect(kept(a)?.told).toHaveLength(1)
        await now.host.closeAll()

        starts(at + 3_600_000)
        await settle()
        expect(askedFor(now, a)).toBe(0)
        expect(saidWords(a)).toHaveLength(1)
        expect(heldWords(a)).toHaveLength(1)
      })

      it('🔴 after the start is kept as made and before its provider is up: no second start is ever made, and the words stay held until anyone starts it, said once', async () => {
        const a = await aConversationWith(schedule)
        const crashed = starts(at, {
          beforeTheProviderIsUp: held('the app died before its provider came up'),
        })
        await waitFor(() => askedFor(crashed, a) === 1, 'its provider to be asked')
        expect(keptAsMade(a)).toBe(true)
        expect(saidWords(a)).toEqual([])

        // ⛔ Kept as made, so the start this app owed is never made: once, at most.
        starts(at + 60_000)
        await settle()
        expect(askedFor(now, a)).toBe(0)
        expect(wakeUpOf(a)).toBeUndefined()
        // ⚑ What says so meanwhile: the words are still held in its ledger, it reads idle, and
        // its own row says whether this app starts it for the job.
        expect(heldWords(a)).toHaveLength(1)
        expect(heldWords(a)[0]).toContain(words)
        expect(saidWords(a)).toEqual([])
        expect(stateOf(a)).toEqual({ is: 'idle' })
        expect(ownLevels(a).at(-1)).toEqual([notStarted])
        expect(kept(a)?.notStartedSaid).toEqual(
          notStarted === null ? {} : { [NIGHTLY.id]: notStarted },
        )

        // The next start, a person's here, says them, once.
        await aPersonStarts(a)
        await waitFor(() => saidWords(a).length === 1, 'the held words to be said')
        expect(saidWords(a)).toEqual(heldWords(a))
        await now.host.closeAll()

        starts(at + 3_600_000)
        await settle()
        expect(askedFor(now, a)).toBe(0)
        expect(saidWords(a)).toHaveLength(1)
        expect(heldWords(a)).toHaveLength(1)
      })

      it('after its provider is up and before the words are taken: no second start is made, and its ledger says the words were not sent', async () => {
        const a = await aConversationWith(schedule)
        const launchedBefore = ledger(a).filter((event) => event.type === 'launched').length
        const crashed = starts(at, {
          beforeTheWordsAreTaken: held('the app died before the words were taken'),
        })
        await waitFor(() => askedFor(crashed, a) === 1, 'its provider to be asked')
        // ⚑ Its provider is up, and its first turn waits on words it never takes. (The file no
        // longer says the words were handed over until they are taken.)
        await waitFor(
          () =>
            ledger(a).filter((event) => event.type === 'launched').length === launchedBefore + 1,
          'its provider to be up',
        )
        await settle()
        expect(saidWords(a)).toEqual([])

        starts(at + 60_000)
        await settle()
        expect(askedFor(now, a)).toBe(0)
        expect(wakeUpOf(a)).toBeUndefined()
        expect(stateOf(a)).toEqual({ is: 'idle' })
        // ⚑ The launch ends every message a crash left on its way in, the app's own words too:
        // the row a person can read says they were not sent.
        const endings = ledger(a).filter(
          (event) =>
            event.type === 'message_unqueued' &&
            (event as { appNotice?: string }).appNotice === JOB_NOTICE,
        )
        expect(endings).toHaveLength(1)
        expect(endings[0]).toMatchObject({ reason: 'abandoned' })
        // ⚑ …and the words are held again for its next start: none was ever told them.
        expect(now.store.messagesWaitingIn(a)).toHaveLength(1)
        expect(ownLevels(a).at(-1)).toEqual([notStarted])
      })

      // ⚑ The words are kept as told only once they are taken, so the launch after a crash ends
      // them as not sent and holds them again, and its next start says them.
      it('⛔ after its provider is up and before the words are taken: the words are said at the next start', async () => {
        const a = await aConversationWith(schedule)
        const launchedBefore = ledger(a).filter((event) => event.type === 'launched').length
        const crashed = starts(at, {
          beforeTheWordsAreTaken: held('the app died before the words were taken'),
        })
        await waitFor(() => askedFor(crashed, a) === 1, 'its provider to be asked')
        // ⚑ Its provider is up, and its first turn waits on words it never takes. (The file no
        // longer says the words were handed over until they are taken.)
        await waitFor(
          () =>
            ledger(a).filter((event) => event.type === 'launched').length === launchedBefore + 1,
          'its provider to be up',
        )
        await settle()

        starts(at + 60_000)
        await settle()
        await aPersonStarts(a)
        await settle()
        expect(saidWords(a)).toHaveLength(1)
      })

      it('after the words are said and before the turn ends: nothing is said or started again', async () => {
        const a = await aConversationWith(schedule)
        const crashed = starts(at)
        await waitFor(() => saidWords(a).length === 1, 'the words to be said')
        await settle()
        expect(askedFor(crashed, a)).toBe(1)

        // No quit: its turn was still open when the app died.
        starts(at + 60_000)
        await settle()
        // ⚑ Said, so the launch's crash repair does not end them as not sent.
        expect(
          ledger(a).some(
            (event) =>
              event.type === 'message_unqueued' &&
              (event as { reason?: string }).reason === 'abandoned',
          ),
        ).toBe(false)
        expect(askedFor(now, a)).toBe(0)
        expect(wakeUpOf(a)).toBeUndefined()
        expect(saidWords(a)).toHaveLength(1)
        expect(heldWords(a)).toHaveLength(1)
        expect(ownLevels(a).at(-1)).toEqual([notStarted])
        await now.host.closeAll()

        starts(at + 3_600_000)
        await settle()
        expect(askedFor(now, a)).toBe(0)
        expect(saidWords(a)).toHaveLength(1)
        // One row says it, however many launches find the same.
        expect(ownLevels(a).filter((jobs) => jobs.includes('time-not-known')).length).toBe(
          notStarted === null ? 0 : 1,
        )
      })
    })
  }

  describe('a crash that loses the one start of a one-shot still ahead', () => {
    it('🔴 it is never started for its minute; its own row says at once that it is not started for, the words wait, and once its minute has passed a launch starts it once to say so', async () => {
      const a = await aConversationWith((id) => makes(id, ONE_SHOT))
      // Twenty-five seconds before its minute: inside the lead, so the start is made now.
      const crashed = starts(local(9, 28, 14, 44, 35), {
        beforeTheProviderIsUp: held('the app died before its provider came up'),
      })
      await waitFor(() => askedFor(crashed, a) === 1, 'its provider to be asked')
      expect(keptAsMade(a)).toBe(true)
      expect(heldWords(a)).toEqual([])

      // Back fifteen seconds on, ten before its minute: the start is kept as made, so none is.
      starts(local(9, 28, 14, 44, 50))
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(wakeUpOf(a)).toBeUndefined()
      // ⚑ Not silent: its own row says this app is not starting it for the job, and words to
      // its agent wait for its next start.
      expect(stateOf(a)).toEqual({ is: 'idle' })
      expect(ownLevels(a).at(-1)).toEqual(['no-word-from-its-provider'])
      expect(kept(a)?.notStartedSaid).toEqual({ [ONE_SHOT.id]: 'no-word-from-its-provider' })
      expect(heldWords(a)).toHaveLength(1)
      expect(heldWords(a)[0]).toContain(
        'this app has stopped starting the conversation for that job',
      )
      await now.host.closeAll()

      // Its minute passed with the conversation stopped. The next launch tells it so, with one
      // start.
      starts(AFTER_DUE)
      await waitFor(() => askedFor(now, a) === 1, 'the start that tells it')
      await waitFor(() => saidWords(a).length === 1, 'the words to be said')
      await settle()
      expect(saidWords(a)[0]).toContain('was due while this conversation was stopped')
      await now.host.closeAll()

      starts(local(9, 28, 16, 0))
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(saidWords(a)).toHaveLength(1)
    })
  })

  describe('the row that says a job is not started for, and the file that keeps what it said', () => {
    /** The app made its one start for a job of unknown time; the conversation is still up. */
    const startedOnce = async (): Promise<{ a: string; life: Life }> => {
      const a = await aConversationWith((id) => lists(id, NIGHTLY))
      const life = starts(local(9, 28, 12, 0))
      await waitFor(() => askedFor(life, a) === 1, 'its one start')
      await settle()
      return { a, life }
    }
    const notStartedRows = (id: string): number =>
      ownLevels(id).filter((jobs) => jobs.includes('time-not-known')).length

    it('a crash after the row is written and before the file: no launch writes it again, and the next one brings the file in step', async () => {
      const { a, life } = await startedOnce()
      // It stops; the row goes into its ledger, and the file cannot take what the row said.
      life.stops.attemptsCannotBeKept = true
      await life.host.close(a, THE_APP_ITSELF)
      await settle()
      expect(notStartedRows(a)).toBe(1)
      expect(kept(a)?.notStartedSaid).toEqual({})

      const rows: number[] = []
      for (const at of [local(9, 28, 12, 30), local(9, 28, 13, 0), local(9, 28, 13, 30)]) {
        starts(at)
        await settle()
        rows.push(notStartedRows(a))
        expect(askedFor(now, a)).toBe(0)
        await now.host.closeAll()
      }
      // ⚑ The launch reads what the newest row says, so it writes none (it wrote one more before).
      expect(rows).toEqual([1, 1, 1])
      expect(kept(a)?.notStartedSaid).toEqual({ [NIGHTLY.id]: 'time-not-known' })
    })

    // ⚑ What the newest row says is compared at a launch too, so while the file cannot be written
    // no launch writes the same row again.
    it('⛔ while the file cannot be written, a launch that finds the same writes no row', async () => {
      const { a, life } = await startedOnce()
      await life.host.closeAll()
      const rows: number[] = []
      for (const at of [local(9, 28, 12, 30), local(9, 28, 13, 0), local(9, 28, 13, 30)]) {
        starts(at, { attemptsCannotBeKept: true })
        await settle()
        rows.push(notStartedRows(a))
        await now.host.closeAll()
      }
      expect(rows).toEqual([1, 1, 1])
    })
  })

  describe('a file of attempts that cannot be written', () => {
    for (const { kind, schedule, at } of KINDS) {
      it(`launch after launch, for ${kind}: no start is made, the words are held once, and the first launch that can write makes the one start`, async () => {
        const a = await aConversationWith(schedule)
        const rowsBefore = levelRows(a).length
        for (const offset of [0, 60_000, 120_000]) {
          const life = starts(at + offset, { attemptsCannotBeKept: true })
          await settle()
          expect(askedFor(life, a)).toBe(0)
          expect(heldWords(a)).toHaveLength(1)
          expect(saidWords(a)).toEqual([])
          expect(levelRows(a)).toHaveLength(rowsBefore)
          // It still reads as scheduled: the start is owed, and tried again.
          expect(stateOf(a)).toEqual({ is: 'scheduled', dueAt: null })
        }
        expect(warned().filter((line) => line.includes('cannot be kept'))).toHaveLength(3)

        starts(at + 180_000)
        await waitFor(() => saidWords(a).length === 1, 'the words to be said')
        await settle()
        expect(askedFor(now, a)).toBe(1)
        expect(heldWords(a)).toHaveLength(1)
      })
    }

    it('the real file: its write works and its rename fails, so no start is made and no half-written file is left; once it can be renamed, one start', async () => {
      const a = await aConversationWith((id) => makes(id, ONE_SHOT))
      // A folder where the file belongs: the temporary file is written, and cannot take its place.
      const file = scheduleAttemptsFile(userData)
      mkdirSync(file)
      const refused = starts(AFTER_DUE)
      await waitFor(() => heldWords(a).length === 1, 'the words to be held')
      await settle()
      expect(askedFor(refused, a)).toBe(0)
      expect(warned().some((line) => line.includes('cannot be kept'))).toBe(true)
      expect(readdirSync(userData).filter((name) => name.endsWith('.tmp'))).toEqual([])
      await refused.host.closeAll()

      // The folder is gone, and a temporary file a killed launch left lies beside the file.
      rmSync(file, { recursive: true })
      writeFileSync(`${file}.99999.tmp`, '{"conversations":')
      starts(AFTER_DUE + 60_000)
      await waitFor(() => saidWords(a).length === 1, 'the words to be said')
      await settle()
      expect(askedFor(now, a)).toBe(1)
      expect(keptAsMade(a)).toBe(true)
    })
  })

  /** Its one start was made, its words said, and the app quit. */
  const startedAndTold = async (
    schedule: (id: string) => Promise<void>,
    at: number,
  ): Promise<string> => {
    const a = await aConversationWith(schedule)
    starts(at)
    await waitFor(() => saidWords(a).length === 1, 'the words to be said')
    await settle()
    await now.host.closeAll()
    return a
  }
  /** The newest level this app wrote itself, as the ids of the jobs it lists. */
  const listedNow = (id: string): string[] | undefined =>
    (
      levelRows(id)
        .filter((event) => (event as { source?: string }).source === 'app/receipts')
        .at(-1) as { jobs?: { id: string }[] } | undefined
    )?.jobs?.map((job) => job.id)

  describe('an older copy of the database under the newer file of attempts', () => {
    it('⚑ nothing kept as started or told is done a second time; the older ledger never held the words, and they are not said', async () => {
      const a = await aConversationWith((id) => makes(id, ONE_SHOT))
      // The copy is taken before the launch that tells and starts it.
      await now.db.backup(join(userData, 'older.sqlite'))
      starts(AFTER_DUE)
      await waitFor(() => saidWords(a).length === 1, 'the words to be said')
      await settle()
      await now.host.closeAll()
      expect(keptAsMade(a)).toBe(true)

      // The database file is replaced by its older copy; the file of attempts stays as it is.
      for (const life of lives) if (life.db.open) life.db.close()
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(join(userData, `brobot2.sqlite${suffix}`), { force: true })
      }
      copyFileSync(join(userData, 'older.sqlite'), join(userData, 'brobot2.sqlite'))

      starts(AFTER_DUE + 600_000)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(wakeUpOf(a)).toBeUndefined()
      // ⚠️ The file says the words were handed over; this ledger never held them.
      expect(kept(a)?.told).toHaveLength(1)
      expect(heldWords(a)).toEqual([])
      expect(saidWords(a)).toEqual([])
    })
  })

  describe('the rows a plan is made from, read again', () => {
    it('the same rows again as a new generation, made the active one: each is read once, the plan is the same and no second start is made', async () => {
      const a = await startedAndTold((id) => lists(id, NIGHTLY), local(9, 28, 12, 0))
      const read = now.store.scheduleEvidenceRows(a).rows
      now.db
        .prepare(
          `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at, turn_id)
           SELECT 'g1-' || id, session_id, 1, ordinal, type, payload, created_at, turn_id
             FROM events WHERE session_id = ? AND generation = 0`,
        )
        .run(a)
      now.db
        .prepare(
          `INSERT INTO derived_generation
             (session_id, active, normalizer_version, derived_through, building, highest, failure, updated_at)
           VALUES (?, 1, 1, 0, NULL, 1, NULL, ?)`,
        )
        .run(a, clock)

      starts(local(9, 28, 12, 30))
      await settle()
      expect(now.store.scheduleEvidenceRows(a).rows).toEqual(read)
      expect(askedFor(now, a)).toBe(0)
      expect(wakeUpOf(a)).toBeUndefined()
      expect(heldWords(a)).toHaveLength(1)
      expect(saidWords(a)).toHaveLength(1)
      expect(ownLevels(a).at(-1)).toEqual(['time-not-known'])
    })

    it('⚑ a row the active generation holds again, at the same place, saying something else: the newest generation’s is the one read, never both', async () => {
      const a = await aConversationWith((id) => lists(id, NIGHTLY))
      const level = now.db
        .prepare(
          `SELECT id, ordinal, created_at, payload FROM events
            WHERE session_id = ? AND type = 'scheduled_work' ORDER BY ordinal DESC LIMIT 1`,
        )
        .get(a) as { id: string; ordinal: number; created_at: number; payload: string }
      const another: Job = {
        id: 'other',
        schedule: '0 4 * * *',
        recurring: true,
        prompt: 'another job',
      }
      now.db
        .prepare(
          `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
           VALUES (?, ?, 1, ?, 'scheduled_work', ?, ?)`,
        )
        .run(
          `g1-${level.id}`,
          a,
          level.ordinal,
          JSON.stringify({ ...(JSON.parse(level.payload) as object), jobs: [another] }),
          level.created_at,
        )
      now.db
        .prepare(
          `INSERT INTO derived_generation
             (session_id, active, normalizer_version, derived_through, building, highest, failure, updated_at)
           VALUES (?, 1, 1, 0, NULL, 1, NULL, ?)`,
        )
        .run(a, clock)
      const levelsRead = now.store
        .scheduleEvidenceRows(a)
        .rows.filter((row) => row.rowType === 'scheduled_work')
        .map((row) => (row.payload as { jobs?: { id: string }[] }).jobs?.map((job) => job.id))
      expect(levelsRead).toEqual([['other']])

      // The plan follows it: one start, for the job the newest generation lists.
      starts(local(9, 28, 12, 0))
      await waitFor(() => saidWords(a).length === 1, 'the words to be said')
      expect(saidWords(a)[0]).toContain('another job')
      expect(saidWords(a)[0]).not.toContain(NIGHTLY.prompt)
    })

    it('⛔ a cancellation that is read, of a job whose making is past the rows read: the job leaves the listing, and nothing is started or told for it', async () => {
      const a = await aConversationWith((id) => makes(id, ONE_SHOT))
      aLongStretchOfWork(a, local(9, 28, 11, 55))
      // A person starts it. Its provider lists the job, then cancels it, and the app dies before
      // the turn ends.
      starts(local(9, 28, 12, 0))
      await aPersonStarts(a)
      await lists(a, ONE_SHOT)
      expect(listedNow(a)).toEqual([ONE_SHOT.id])
      const told = heldWords(a).length
      doubleOf(a).simulateScheduledWork({
        jobs: undefined,
        receipt: {
          tool: 'CronDelete',
          toolUseId: 'toolu_cancel',
          calledAt: clock,
          answeredAt: clock + 2,
          input: { id: ONE_SHOT.id },
          result: { id: ONE_SHOT.id },
        },
      })
      await settle()
      expect(now.store.scheduleEvidenceRows(a).cut).toBe(true)
      expect(listedNow(a)).toEqual([])

      // Its minute passes with the conversation stopped: a job that was cancelled is owed nothing.
      starts(AFTER_DUE)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(wakeUpOf(a)).toBeUndefined()
      expect(heldWords(a)).toHaveLength(told)
      expect(listedNow(a)).toEqual([])
    })

    it('⛔ a life whose end is read and whose start is past the rows read: nothing is started on it, and the job it held says why', async () => {
      starts(LISTED)
      const { sessionId: a } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-a', approvalMode: 'ask', cwd: root },
        window,
      )
      await makes(a, ONE_SHOT)
      const lastBeforeItsEnd = (
        now.db.prepare(`SELECT MAX(ordinal) AS last FROM events WHERE session_id = ?`).get(a) as {
          last: number
        }
      ).last
      await now.host.closeAll()
      // A long stretch of work lies between the life's start and its end.
      aLongStretchOfWork(a, local(9, 28, 11, 55))
      now.db
        .prepare(
          `UPDATE events SET ordinal = ordinal + 20000000
            WHERE session_id = ? AND ordinal > ? AND ordinal < 10000000`,
        )
        .run(a, lastBeforeItsEnd)
      const read = now.store.scheduleEvidenceRows(a)
      expect(read.cut).toBe(true)
      expect(read.rows.map((row) => row.rowType)).toEqual(['status'])

      starts(AFTER_DUE)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(wakeUpOf(a)).toBeUndefined()
      expect(ownLevels(a).at(-1)).toEqual(['history-not-read-in-full'])
      expect(heldWords(a).at(-1)).toContain(
        'it could not read enough of this conversation’s history to plan it',
      )
    })
  })
})
