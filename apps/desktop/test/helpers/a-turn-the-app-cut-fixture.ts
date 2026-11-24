import {
  fixtureHostPaths,
  settleFixtureTurns,
  fixtureDatabase,
  fixtureProviderConfig,
  RecordingSink,
} from '../lib/host-fixture'
import type { Held, Gate, Stops } from './cut-account-cases'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, FakeSessionHandle } from '@brobot2/runtime'
import { CodexSessionHandle } from '@brobot2/runtime/codex'
import type { CodexTransport } from '@brobot2/runtime/codex'
import type { ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { AppDatabase } from '../../src/main/db/connection'
import { createSessionStore, type SessionStore } from '../../src/main/db/session-store'
import { readProfileExecution, writeProfileExecution } from '../../src/main/profile-execution-file'
import { RuntimeHost } from './giver-notice-host'
import {
  readKeptAccounts,
  writeKeptAccounts,
  providerAccountsFile,
} from '../../src/main/providers/claude/account-record'
import { usageKeptIn } from '../../src/main/provider-usage-file'
import { turnsTheAppCutIn, type CutState } from '../../src/main/turns-the-app-cut-file'

const local = (hour: number, minute: number, second = 0): number =>
  new Date(2026, 9, 10, hour, minute, second).getTime()
export const CUT = local(2, 53)
export const SOON = CUT + 5 * 60_000
export const TOO_LATE = CUT + 61 * 60_000

export const GAP = 60
export const ACCOUNT_WAIT = 300
export const PROGRAM_WAIT = 900
export const LIMIT_GAP = 700
export const LIMIT_LOOK = 50
const NOTICE = 'a-turn-the-app-cut'

export async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

export const settle = (): Promise<void> => settleFixtureTurns(4, GAP + 30)

export function held(why: string): Held {
  let end = (): void => {}
  const promise = new Promise<void>((_resolve, reject) => {
    end = () => reject(new Error(why))
  })
  promise.catch(() => {})
  return { promise, end }
}

export function aGate(): Gate {
  let open = (): void => {}
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

interface Life {
  readonly db: AppDatabase
  readonly store: SessionStore
  readonly host: RuntimeHost
  readonly stops: Stops
  readonly asked: string[]
  readonly startedAt: number[]
}

const EMAIL = { ada: 'ada@example.test', bea: 'bea@example.test' } as const

// Each test sets these afresh, and the cases read them as they change: `now` is the newest life
// `starts` made.
export let now: Life
export let root: string
export let window: RecordingSink
export let handles: FakeSessionHandle[]

/**
 * ⚑ Each life of the app is a host with its own connection over one data folder, as
 * `scheduled-jobs-across-a-crash.test.ts` makes them: a crashed life is never closed, and the next
 * one reads the same database. Accounts are fictional.
 */
export function aTurnTheAppCutFixture() {
  let userData: string
  let lives: Life[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  const tick = (): number => clock++

  const fitted = (handle: FakeSessionHandle, stops: Stops, home: string): FakeSessionHandle => {
    const account = stops.account ?? 'ada'
    const fake = handle as unknown as {
      account?: () => unknown
      machine: { beginTurn(): number | null; refusedTurn(): Error }
    }
    const answersFrom = performance.now() + (stops.accountAfterMs ?? 0)
    fake.account = () =>
      account === 'never' || performance.now() < answersFrom
        ? undefined
        : account === 'none'
          ? null
          : {
              email: EMAIL[account],
              ...(stops.organization === undefined ? {} : { organization: stops.organization }),
            }
    const gate = stops.signInGate
    if (gate !== undefined) {
      ;(handle as unknown as { checkSignIn: () => Promise<boolean> }).checkSignIn = async () => {
        await gate.promise
        return false
      }
    }
    if (stops.tag !== undefined) {
      const tag = stops.tag
      ;(handle as unknown as { signInTag: () => string }).signInTag = () => tag
    }
    if (stops.savedKeyRevision !== undefined) {
      writeFileSync(
        join(home, 'brobot-api-key-login.json'),
        JSON.stringify({ setAt: stops.savedKeyRevision }),
      )
      const keyHandle = new CodexSessionHandle({} as CodexTransport, root, 0, home)
      keyHandle.noteLaunchAccount('api-key')
      Object.defineProperty(handle, 'signInTag', { value: () => keyHandle.signInTag() })
    }
    if (stops.turnsStayOpen === true) {
      handle.send = async (): Promise<void> => {
        if (fake.machine.beginTurn() === null) throw fake.machine.refusedTurn()
      }
    }
    const closing = stops.closeWaitsFor
    if (closing !== undefined) {
      const close = handle.close.bind(handle)
      handle.close = async (): Promise<void> => {
        await closing.promise
        await close()
      }
    }
    const wait = stops.beforeTheWordsAreTaken
    if (wait !== undefined) {
      handle.send = async (): Promise<void> => {
        await wait.promise
      }
    }
    return handle
  }

  class ProviderOfALife extends FakeRuntime {
    constructor(
      provider: Provider,
      private readonly stops: Stops,
      private readonly asked: string[],
      private readonly startedAt: number[],
    ) {
      super(provider, { sessions: issued })
    }
    override async start(options: StartOptions): Promise<FakeSessionHandle> {
      const handle = fitted(await super.start(options), this.stops, options.providerHome)
      this.asked.push(handle.ref.sessionId)
      this.startedAt.push(performance.now())
      handles.push(handle)
      return handle
    }
    override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
      this.asked.push(ref.sessionId)
      this.startedAt.push(performance.now())
      const failing = this.stops.startsFailFor
      if (failing !== undefined && options.providerHome.includes(`${sep}${failing}${sep}`)) {
        throw new Error('the provider could not start')
      }
      if (this.stops.beforeTheProviderIsUp !== undefined) {
        await this.stops.beforeTheProviderIsUp.promise
      }
      const handle = fitted(await super.resume(ref, options), this.stops, options.providerHome)
      handles.push(handle)
      return handle
    }
  }

  const starts = (moment: number, stops: Stops = {}, deferred = false, paint = deferred): Life => {
    clock = moment
    const folder = userData
    const db = fixtureDatabase(folder)
    const store = createSessionStore(db, tick)
    const asked: string[] = []
    const startedAt: number[] = []
    const life: Life = {
      db,
      store,
      stops,
      asked,
      startedAt,
      host: new RuntimeHost({
        store,
        deferStartupUntilListPaint: deferred,
        ...fixtureHostPaths(() => folder),
        createRuntime: (provider: Provider) =>
          new ProviderOfALife(provider, stops, asked, startedAt),
        newSessionId: () => `sess_${++counter}`,
        now: tick,
        interruptWaitMs: 40,
        readProviderConfig: fixtureProviderConfig,
        ...(stops.nobodyListens === true ? {} : { statesMoved: () => {} }),
        ...(stops.services === true
          ? {
              profileExecution: {
                read: () => readProfileExecution(db),
                write: (kept) => writeProfileExecution(db, kept),
                owned: true,
              },
            }
          : {}),
        turnsTheAppCut: {
          read: () => turnsTheAppCutIn(db).read(),
          write: (kept) => {
            if (stops.cutsCannotBeKept === true) throw new Error('the disk is full')
            turnsTheAppCutIn(db).write(kept)
          },
        },
        usageKept: usageKeptIn(db),
        accountsKept: {
          read: () => readKeptAccounts(providerAccountsFile(folder)),
          write: (kept) => {
            if (stops.accountsCannotBeKept)
              throw new Error(`EACCES: cannot write '${providerAccountsFile(folder)}'`)
            writeKeptAccounts(providerAccountsFile(folder), kept)
          },
        },
        accountWaitMs: ACCOUNT_WAIT,
        startGapMs: GAP,
        aProgramStartsAgainAfterMs: stops.programWaitMs ?? PROGRAM_WAIT,
        limitWakesApartMs: LIMIT_GAP,
        ...(stops.limitLookMs === undefined
          ? {}
          : { lookAtTheLimitAgainMs: stops.limitLookMs, afterALimitResetsMs: 0 }),
        idleStopAfterMs: 7_654_321,
      }),
    }
    lives.push(life)
    if (paint) life.host.firstListPainted()
    now = life
    return life
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-cut-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-cut-root-'))
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

  const ledger = (id: string): TranscriptEvent[] => now.store.events(id).map((entry) => entry.event)
  const continuations = (id: string): string[] =>
    ledger(id)
      .filter(
        (event) =>
          event.type === 'user_turn' && (event as { appNotice?: string }).appNotice === NOTICE,
      )
      .map((event) => (event as { text: string }).text)
  const heldCount = (id: string): number =>
    ledger(id).filter(
      (event) =>
        event.type === 'message_queued' && (event as { appNotice?: string }).appNotice === NOTICE,
    ).length
  const stateOf = (id: string): CutState | undefined =>
    turnsTheAppCutIn(now.db).read().cuts[id]?.state
  const providerIdOf = (id: string): string => {
    const found = now.store.find(id)
    if (found === null) throw new Error(`${id} has no provider ref`)
    return found.ref.sessionId
  }
  const askedFor = (life: Life, id: string): number =>
    life.asked.filter((one) => one === providerIdOf(id)).length
  const running = (life: Life, id: string): boolean =>
    (life.host as unknown as { slots: Map<string, { session: unknown }> }).slots.get(id)?.session !=
    null

  /** Claude's usage limit is reached, as another conversation's provider said it, until an hour on. */
  const theLimitIsReached = (): void => {
    const resets = new Date(clock + 60 * 60_000).toISOString()
    now.store.create({
      id: 'sess_wall',
      provider: 'claude',
      cwd: root,
      approvalMode: 'ask',
      profileId: 'default',
    })
    now.store.append(
      'sess_wall',
      0,
      {
        type: 'error',
        message: `claude is rate-limited (five_hour) — the turn may stall until it resets; resets ${resets}`,
        fatal: false,
      } as TranscriptEvent,
      clock,
    )
    // Past the while the host reads the limits once for.
    clock += 6_000
  }

  /** The ordinal of the conversation's newest `launched` row. */
  const itsNewestLaunch = (id: string): number | undefined =>
    now.store
      .events(id)
      .filter((entry) => entry.event.type === 'launched')
      .map((entry) => (entry as unknown as { ordinal: number }).ordinal)
      .at(-1)

  /** A conversation whose turn is running when the life ends. */
  const aTurnRunsIn = async (stops: Stops = {}): Promise<string> => {
    starts(CUT - 60_000, { turnsStayOpen: true, ...stops })
    const { sessionId } = await now.host.createSession(
      {
        provider: stops.provider ?? 'claude',
        profileId: 'agent-a',
        approvalMode: 'auto',
        cwd: root,
      },
      window,
    )
    await settle()
    clock = CUT - 10_000
    await now.host.send(sessionId, 'build the thing', window)
    await settle()
    clock = CUT
    return sessionId
  }

  const accountCases = {
    life: () => now,
    folder: () => userData,
    root: () => root,
    handles: () => handles,
    window: () => window,
    aTurnRunsIn,
    starts,
    stateOf,
    continuations,
    waitFor,
    settle,
    EMAIL,
    CUT,
    SOON,
  }

  return {
    /** The clock every life's host reads, which the cases set. */
    get clock(): number {
      return clock
    },
    set clock(moment: number) {
      clock = moment
    },
    tick,
    starts,
    aTurnRunsIn,
    theLimitIsReached,
    ledger,
    continuations,
    heldCount,
    stateOf,
    providerIdOf,
    askedFor,
    running,
    itsNewestLaunch,
    accountCases,
  }
}
