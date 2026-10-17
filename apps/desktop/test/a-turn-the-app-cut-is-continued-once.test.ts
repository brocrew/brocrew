import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  profileExecutionFile,
  readProfileExecution,
  writeProfileExecution,
} from '../src/main/profile-execution-file'
import { RuntimeHost, THE_APP_ITSELF, aTurnTheAppCutText } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import {
  readKeptCuts,
  turnsTheAppCutFile,
  writeKeptCuts,
  type CutState,
  type NotContinuedBecause,
} from '../src/main/turns-the-app-cut-file'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * **A turn this app's quit, or a crash, cut is continued once, on the account it ran on, at the
 * next launch** — and never twice, never on another account, never after newer work, never for a
 * turn a person stopped or that waited on a person.
 *
 * ⚑ Each life of the app is a host with its own connection over one data folder, as
 * `scheduled-jobs-across-a-crash.test.ts` makes them: a crashed life is never closed, and the next
 * one reads the same database and the same `turns-the-app-cut.json`. Accounts are fictional.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const local = (hour: number, minute: number, second = 0): number =>
  new Date(2026, 9, 10, hour, minute, second).getTime()
const CUT = local(2, 53)
const SOON = CUT + 5 * 60_000
const TOO_LATE = CUT + 61 * 60_000

const GAP = 60
const ACCOUNT_WAIT = 300
const PROGRAM_WAIT = 900
const LIMIT_GAP = 700
const LIMIT_LOOK = 50
const NOTICE = 'a-turn-the-app-cut'

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

async function settle(): Promise<void> {
  for (let round = 0; round < 4; round++) {
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

interface Held {
  readonly promise: Promise<void>
  readonly end: () => void
}
function held(why: string): Held {
  let end = (): void => {}
  const promise = new Promise<void>((_resolve, reject) => {
    end = () => reject(new Error(why))
  })
  promise.catch(() => {})
  return { promise, end }
}

interface Gate {
  readonly promise: Promise<void>
  readonly open: () => void
}
function aGate(): Gate {
  let open = (): void => {}
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

/** How a life's provider behaves. */
interface Stops {
  /** Its sign-in check waits for this gate: the last wait before held words are handed over. */
  signInGate?: Gate
  /** The account its provider names: a fictional one, none, or no answer at all. */
  account?: 'ada' | 'bea' | 'none' | 'never'
  /** The tag its runtime makes of the credential it launched on, as a saved key's would be. */
  tag?: string
  /** Its provider names the account only this long after the life starts, ms; at once if unset. */
  accountAfterMs?: number
  /** Its turns stay running: nothing ends them but a stop, a close or a crash. */
  turnsStayOpen?: boolean
  /** The provider never comes up. */
  beforeTheProviderIsUp?: Held
  /** The provider never takes words handed to it. */
  beforeTheWordsAreTaken?: Held
  /** The cut-turns file cannot be written. */
  cutsCannotBeKept?: boolean
  /** No window listens to this life, so its launch continues nothing. */
  nobodyListens?: boolean
  /** Services run in this life, as the services list in its data folder says which agents are. */
  services?: boolean
  /** Every start of this agent's conversations fails. */
  startsFailFor?: string
  /** A usage limit's reset is looked at again this often, ms, and nothing is added after it. */
  limitLookMs?: number
  /** How long after its program stopped a conversation is started again, ms. */
  programWaitMs?: number
  /** Its provider's close waits for this gate: a life's teardown held. */
  closeWaitsFor?: Gate
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

describe('a turn the app cut is continued once, on the account it ran on', () => {
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

  const fitted = (handle: FakeSessionHandle, stops: Stops): FakeSessionHandle => {
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
          : { email: EMAIL[account] }
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
      const handle = fitted(await super.start(options), this.stops)
      this.asked.push(handle.ref.sessionId)
      this.startedAt.push(performance.now())
      handles.push(handle)
      return handle
    }
    override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
      this.asked.push(ref.sessionId)
      this.startedAt.push(performance.now())
      const failing = this.stops.startsFailFor
      if (failing !== undefined && options.providerHome.includes(`/${failing}/`)) {
        throw new Error('the provider could not start')
      }
      if (this.stops.beforeTheProviderIsUp !== undefined) {
        await this.stops.beforeTheProviderIsUp.promise
      }
      const handle = fitted(await super.resume(ref, options), this.stops)
      handles.push(handle)
      return handle
    }
  }

  const starts = (moment: number, stops: Stops = {}): Life => {
    clock = moment
    const folder = userData
    const db = openDatabase(join(folder, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
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
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(folder, 'exports'),
        resourcesRoot: () => resourcesRoot(folder),
        createRuntime: (provider: Provider) =>
          new ProviderOfALife(provider, stops, asked, startedAt),
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
        ...(stops.nobodyListens === true ? {} : { statesMoved: () => {} }),
        ...(stops.services === true
          ? {
              profileExecution: {
                read: () => readProfileExecution(profileExecutionFile(folder)),
                write: (kept) => writeProfileExecution(profileExecutionFile(folder), kept),
                owned: true,
              },
            }
          : {}),
        turnsTheAppCut: {
          read: () => readKeptCuts(turnsTheAppCutFile(folder)),
          write: (kept) => {
            if (stops.cutsCannotBeKept === true) throw new Error('the disk is full')
            writeKeptCuts(turnsTheAppCutFile(folder), kept)
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
    readKeptCuts(turnsTheAppCutFile(userData)).cuts[id]?.state
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
      { provider: 'claude', profileId: 'agent-a', approvalMode: 'auto', cwd: root },
      window,
    )
    await settle()
    clock = CUT - 10_000
    await now.host.send(sessionId, 'build the thing', window)
    await settle()
    clock = CUT
    return sessionId
  }

  describe('a quit that cut a running turn', () => {
    it('the next launch continues it once, on the same account, saying when the app restarted', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      expect(stateOf(a)).toBe('pending')

      starts(SOON)
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(askedFor(now, a)).toBe(1)
      expect(continuations(a)).toEqual([aTurnTheAppCutText('quit', CUT, clock, 'claude')])
      expect(stateOf(a)).toBe('sent')

      // ⛔ …and once: a further launch does nothing more.
      await now.host.closeAll()
      starts(SOON + 60_000)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(continuations(a)).toHaveLength(1)
    })

    it('an idle conversation at the quit has no cut', async () => {
      starts(CUT - 60_000)
      const { sessionId } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-a', approvalMode: 'auto', cwd: root },
        window,
      )
      await now.host.send(sessionId, 'quick one', window)
      await settle()
      await now.host.closeAll()
      expect(stateOf(sessionId)).toBeUndefined()
      starts(SOON)
      await settle()
      expect(askedFor(now, sessionId)).toBe(0)
    })

    it('⛔ more than an hour later, it is not continued', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      starts(TOO_LATE)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'too-old' })
    })

    it('⛔ on another account, it is not continued, and the life started for it is stopped again', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      starts(SOON, { account: 'bea' })
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(askedFor(now, a)).toBe(1)
      expect(continuations(a)).toEqual([])
      expect(heldCount(a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'not-same-account' })
      expect(running(now, a)).toBe(false)
    })

    it('⛔ with an account that does not answer in time, it is not continued and not tried again', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      starts(SOON, { account: 'never' })
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'account-not-known' })
      await now.host.closeAll()
      starts(SOON + 60_000)
      await settle()
      expect(askedFor(now, a)).toBe(0)
    })

    it('⛔ a turn that went in before the next launch that continues anything: no stale continuation', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      // A life that continues nothing, in which a person writes and the turn ends.
      starts(SOON, { nobodyListens: true })
      const sent = await now.host.startAndSend(a, 'where were we?', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await settle()
      await now.host.closeAll()
      expect(stateOf(a)).toBe('pending')
      starts(SOON + 60_000)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'overtaken' })
    })

    it('⛔ a quit while the continuation is being handed over: never sent again, and no start for it', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      const taken = held('the words are never taken')
      starts(SOON, { beforeTheWordsAreTaken: taken })
      await waitFor(() => stateOf(a) === 'queued', 'the words to be held')
      await settle()
      await now.host.closeAll()
      expect(stateOf(a)).toEqual({ ended: 'handover-uncertain' })
      starts(SOON + 60_000)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(continuations(a)).toEqual([])
    })

    it('⛔ a person who writes first takes the conversation: no stale continuation follows', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      starts(SOON, { account: 'never' })
      const sent = await now.host.startAndSend(a, 'where were we?', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'overtaken' })
    })
  })

  describe('a quit cut short', () => {
    it('the turns it was cutting, kept before the first close, are continued with the quit’s words', async () => {
      const a = await aTurnRunsIn()
      const host = now.host as unknown as {
        whatTheQuitCloses(): unknown[]
        keepTheTurnsTheQuitCuts(closing: unknown[]): void
      }
      // The quit keeps what it is about to cut, then dies before any close.
      host.keepTheTurnsTheQuitCuts(host.whatTheQuitCloses())
      expect(stateOf(a)).toBe('pending')
      starts(SOON)
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      expect(continuations(a)).toEqual([aTurnTheAppCutText('quit', CUT, clock, 'claude')])
    })
  })

  describe('the account, frozen to the life', () => {
    it('a life on a key: the same key is the same account; another key is not', async () => {
      const a = await aTurnRunsIn({ account: 'none', tag: 'key-a' })
      await now.host.closeAll()
      starts(SOON, { account: 'none', tag: 'key-b' })
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      expect(stateOf(a)).toEqual({ ended: 'not-same-account' })

      const b = await aTurnRunsIn({ account: 'none', tag: 'key-a' })
      await now.host.closeAll()
      starts(SOON + 120_000, { account: 'none', tag: 'key-a' })
      await waitFor(() => continuations(b).length === 1, 'the continuation')
      expect(stateOf(b)).toBe('sent')
    })

    it('⛔ a crash in a life whose account was never known does not take an earlier life’s', async () => {
      // The first life's account is known, and its turn ends.
      starts(CUT - 120_000)
      const { sessionId: a } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-a', approvalMode: 'auto', cwd: root },
        window,
      )
      await now.host.send(a, 'quick one', window)
      await settle()
      await now.host.closeAll()
      // The next life never learns its account, and crashes in a turn.
      starts(CUT - 60_000, { account: 'never', turnsStayOpen: true })
      const sent = await now.host.startAndSend(a, 'build the thing', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await settle()
      starts(SOON)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'account-not-known' })
    })

    /** A first life on Ada whose turn ends, then a quit: its account is kept for the conversation. */
    const aFirstLifeOnAda = async (): Promise<string> => {
      starts(CUT - 120_000)
      const { sessionId } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-a', approvalMode: 'auto', cwd: root },
        window,
      )
      await now.host.send(sessionId, 'quick one', window)
      await settle()
      await now.host.closeAll()
      return sessionId
    }

    it('⛔ a crash after the earlier life’s account could not be let go does not take it', async () => {
      const a = await aFirstLifeOnAda()
      expect(readKeptCuts(turnsTheAppCutFile(userData)).lives[a]).toBeDefined()
      // Nothing can be written in this life, and its account is never learned; it crashes in a turn.
      starts(CUT - 60_000, { account: 'never', turnsStayOpen: true, cutsCannotBeKept: true })
      const sent = await now.host.startAndSend(a, 'build the thing', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await settle()
      // The next launch can write again, on the first life's account.
      starts(SOON)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'account-not-known' })
    })

    it('⛔ an earlier life’s account kept with the very moment the crashed life began does not bind it', async () => {
      const a = await aFirstLifeOnAda()
      const earlier = readKeptCuts(turnsTheAppCutFile(userData)).lives[a]
      if (earlier === undefined) throw new Error('the first life kept no account')
      starts(CUT - 60_000, { account: 'never', turnsStayOpen: true })
      const sent = await now.host.startAndSend(a, 'build the thing', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await settle()
      const since = (
        now.host as unknown as { slots: Map<string, { session: { lifeSince: number } }> }
      ).slots.get(a)?.session.lifeSince
      if (since === undefined) throw new Error('the second life is not running')
      const kept = readKeptCuts(turnsTheAppCutFile(userData))
      writeKeptCuts(turnsTheAppCutFile(userData), {
        ...kept,
        lives: { ...kept.lives, [a]: { ...earlier, since } },
      })
      starts(SOON)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'account-not-known' })
    })

    it('an account its provider names only after the life’s launch row is kept for that life, and a crash is continued on it', async () => {
      const a = await aTurnRunsIn({ accountAfterMs: 120 })
      await waitFor(
        () => readKeptCuts(turnsTheAppCutFile(userData)).lives[a] !== undefined,
        'the account to be kept',
      )
      expect(readKeptCuts(turnsTheAppCutFile(userData)).lives[a]?.launched).toBe(itsNewestLaunch(a))
      starts(SOON, { accountAfterMs: 120 })
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(stateOf(a)).toBe('sent')
    })

    it('…and so in a reopened life', async () => {
      const a = await aFirstLifeOnAda()
      starts(CUT - 60_000, { turnsStayOpen: true, accountAfterMs: 120 })
      const sent = await now.host.startAndSend(a, 'build the thing', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await waitFor(
        () => readKeptCuts(turnsTheAppCutFile(userData)).lives[a]?.launched === itsNewestLaunch(a),
        'the reopened life’s account to be kept',
      )
      starts(SOON, { accountAfterMs: 120 })
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(stateOf(a)).toBe('sent')
    })

    it('a crash in a reopened life is continued on that life’s own account', async () => {
      const a = await aFirstLifeOnAda()
      starts(CUT - 60_000, { turnsStayOpen: true })
      const sent = await now.host.startAndSend(a, 'build the thing', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await settle()
      expect(readKeptCuts(turnsTheAppCutFile(userData)).lives[a]?.launched).toBe(itsNewestLaunch(a))
      starts(SOON)
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(askedFor(now, a)).toBe(1)
      expect(stateOf(a)).toBe('sent')
    })

    it('⛔ an account named by its email and one named by its launch credential are not compared, and stop no other cut', async () => {
      const a = await aTurnRunsIn()
      const { sessionId: b } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-a', approvalMode: 'auto', cwd: root },
        window,
      )
      await settle()
      await now.host.send(b, 'the other thing', window)
      await settle()
      await now.host.closeAll()
      // The next life's account read names no email: only its launch credential's tag is known.
      starts(SOON, { account: 'none', tag: 'key-a' })
      await waitFor(
        () => typeof stateOf(a) === 'object' && typeof stateOf(b) === 'object',
        'both cuts to end',
      )
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'account-not-known' })
      expect(stateOf(b)).toEqual({ ended: 'account-not-known' })
      expect(now.asked).toHaveLength(2)
      expect(continuations(a)).toEqual([])
      expect(continuations(b)).toEqual([])
    })

    it('⛔ once another account is found, no other cut of that provider and profile is continued', async () => {
      const a = await aTurnRunsIn()
      const { sessionId: b } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-a', approvalMode: 'auto', cwd: root },
        window,
      )
      await settle()
      await now.host.send(b, 'the other thing', window)
      await settle()
      await now.host.closeAll()
      starts(SOON, { account: 'bea' })
      await waitFor(
        () => typeof stateOf(a) === 'object' && typeof stateOf(b) === 'object',
        'both cuts to end',
      )
      await settle()
      expect([stateOf(a), stateOf(b)]).toContainEqual({ ended: 'not-same-account' })
      expect([stateOf(a), stateOf(b)]).toContainEqual({ ended: 'not-same-account-cohort' })
      expect(now.asked).toHaveLength(1)
    })
  })

  describe('a crash that cut a running turn', () => {
    it('the next launch continues it once, naming the last thing the app recorded', async () => {
      const a = await aTurnRunsIn()
      const lastAt = (
        now.db.prepare('SELECT max(created_at) AS at FROM events WHERE session_id = ?').get(a) as {
          at: number
        }
      ).at
      starts(SOON)
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(continuations(a)).toEqual([aTurnTheAppCutText('crash', lastAt, clock, 'claude')])
      expect(stateOf(a)).toBe('sent')
    })

    it('⛔ a turn a person stopped is not a cut', async () => {
      const a = await aTurnRunsIn()
      await now.host.interrupt(a, window)
      await settle()
      starts(SOON)
      await settle()
      expect(continuations(a)).toEqual([])
    })

    it('⛔ a turn a person cancelled from its card is not a cut', async () => {
      const a = await aTurnRunsIn()
      now.store.append(
        a,
        now.store.nextOrdinal(a),
        { type: 'user_decision', requestId: 'req_1', outcome: 'cancel' } as TranscriptEvent,
        CUT,
      )
      starts(SOON)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'not-cut' })
    })

    it('⛔ a turn waiting on a person is not continued, though the repair cleared its block', async () => {
      starts(CUT - 60_000)
      const { sessionId } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-a', approvalMode: 'ask', cwd: root },
        window,
      )
      await now.host.send(sessionId, 'needs a yes', window)
      await settle()
      starts(SOON)
      await settle()
      expect(askedFor(now, sessionId)).toBe(0)
      expect(stateOf(sessionId)).toEqual({ ended: 'blocked' })
    })

    it('a continuation that is cut again is continued once more, and a third cut waits for a person', async () => {
      const a = await aTurnRunsIn()
      starts(SOON, { turnsStayOpen: true })
      await waitFor(() => continuations(a).length === 1, 'the first continuation')
      await settle()
      starts(SOON + 5 * 60_000, { turnsStayOpen: true })
      await waitFor(() => continuations(a).length === 2, 'the second continuation')
      await settle()
      starts(SOON + 10 * 60_000)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(continuations(a)).toHaveLength(2)
      expect(stateOf(a)).toEqual({ ended: 'continued-twice' })
    })

    it('⛔ a start kept as begun, then a crash before its provider is up: never started again', async () => {
      const a = await aTurnRunsIn()
      const up = held('the provider never comes up')
      starts(SOON, { beforeTheProviderIsUp: up })
      await waitFor(() => stateOf(a) === 'starting', 'the start to be kept as begun')
      starts(SOON + 60_000)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'start-uncertain' })
      expect(continuations(a)).toEqual([])
    })

    it('⛔ words held, then a crash before they are taken: never sent again', async () => {
      const a = await aTurnRunsIn()
      const taken = held('the words are never taken')
      starts(SOON, { beforeTheWordsAreTaken: taken })
      await waitFor(() => stateOf(a) === 'queued', 'the words to be held')
      await settle()
      starts(SOON + 60_000)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'handover-uncertain' })
      expect(continuations(a)).toEqual([])
    })

    it('⛔ when the cut cannot be kept, nothing is continued', async () => {
      const a = await aTurnRunsIn()
      starts(SOON, { cutsCannotBeKept: true })
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(continuations(a)).toEqual([])
    })

    it('⛔ an unreadable cut-turns file authorizes nothing', async () => {
      const a = await aTurnRunsIn()
      writeFileSync(turnsTheAppCutFile(userData), 'not json')
      starts(SOON)
      await settle()
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'account-not-known' })
    })
  })

  describe('the last check, after the last wait before the handover', () => {
    /** A cut whose continuation is held, and whose handover waits on its sign-in check. */
    const aContinuationWaitsAtTheGate = async (): Promise<{ a: string; gate: Gate }> => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      const gate = aGate()
      starts(SOON, { signInGate: gate })
      await waitFor(() => stateOf(a) === 'queued', 'the words to be held')
      await settle()
      expect(continuations(a)).toEqual([])
      return { a, gate }
    }

    it('with nothing newer, it goes once the wait ends', async () => {
      const { a, gate } = await aContinuationWaitsAtTheGate()
      gate.open()
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(stateOf(a)).toBe('sent')
    })

    it('⛔ a turn its provider ran by itself during that wait: the continuation ends unsent', async () => {
      const { a, gate } = await aContinuationWaitsAtTheGate()
      const handle = handles.at(-1)
      if (handle === undefined) throw new Error('the woken life has no handle')
      const machine = (
        handle as unknown as {
          machine: { noteProviderWork(): void; completeTurn(state: 'completed'): void }
        }
      ).machine
      machine.noteProviderWork()
      await waitFor(() => ledger(a).some((event) => event.type === 'provider_turn'), 'its turn')
      machine.completeTurn('completed')
      await settle()
      gate.open()
      // Settled either way, sent or ended, so the state below is what is asserted.
      await waitFor(() => stateOf(a) !== 'queued', 'the held words to be settled')
      await settle()
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'overtaken' })
    })

    it('⛔ a usage limit reached during that wait: the continuation ends unsent, and the life started for it is stopped again', async () => {
      const { a, gate } = await aContinuationWaitsAtTheGate()
      theLimitIsReached()
      gate.open()
      // Settled either way, sent or ended, so the state below is what is asserted.
      await waitFor(() => stateOf(a) !== 'queued', 'the held words to be settled')
      await settle()
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'limited' })
      await waitFor(() => !running(now, a), 'its life to stop')
    })

    it('⛔ what else waited in the same batch still goes when the continuation is dropped', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      now.store.append(
        a,
        now.store.nextOrdinal(a),
        {
          type: 'background_work',
          running: [{ id: 't0', description: 'Run the full live test' }],
          source: 'test',
        } as unknown as TranscriptEvent,
        CUT - 5_000,
      )
      const gate = aGate()
      starts(SOON, { signInGate: gate })
      await waitFor(() => stateOf(a) === 'queued', 'the words to be held')
      await settle()
      const handle = handles.at(-1)
      if (handle === undefined) throw new Error('the woken life has no handle')
      const machine = (
        handle as unknown as {
          machine: { noteProviderWork(): void; completeTurn(state: 'completed'): void }
        }
      ).machine
      machine.noteProviderWork()
      await waitFor(() => ledger(a).some((event) => event.type === 'provider_turn'), 'its turn')
      machine.completeTurn('completed')
      await settle()
      gate.open()
      // Settled either way, sent or ended, so the state below is what is asserted.
      await waitFor(() => stateOf(a) !== 'queued', 'the held words to be settled')
      await waitFor(
        () =>
          ledger(a).some(
            (event) =>
              event.type === 'user_turn' &&
              (event as { text: string }).text.includes('stopped your background work'),
          ),
        'the background notice to go',
      )
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'overtaken' })
    })

    it('⛔ a usage limit already standing at the launch: no words are held, and its life is stopped again', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      starts(SOON)
      theLimitIsReached()
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(heldCount(a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'limited' })
      expect(running(now, a)).toBe(false)
    })
  })

  describe('the work it was driving, and who gave it', () => {
    const callOn = async (
      caller: string,
      name: ToolName,
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      const tool = agentToolsFor(now.host, caller).tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return (await tool.call(args)).structured as Record<string, unknown>
    }
    /** A lead gives a worker a piece; the worker's turn on it is running when the app quits or crashes. */
    const aGivenPieceIsCut = async (
      how: 'quit' | 'crash',
    ): Promise<{ lead: string; worker: string }> => {
      starts(CUT - 60_000, { turnsStayOpen: true })
      const { sessionId: lead } = await now.host.createSession(
        { provider: 'claude', profileId: 'lead', approvalMode: 'auto', cwd: root },
        window,
      )
      await settle()
      const given = await callOn(lead, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'agent-w',
        new: true,
        title: 'build the thing',
        brief: 'build the thing',
      })
      expect(given['outcome'], JSON.stringify(given)).toBe('ok')
      const worker = given['agent'] as string
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'user_turn'),
        'the brief to go in',
      )
      await settle()
      clock = CUT
      if (how === 'quit') {
        await now.host.closeAll()
        expect(stateOf(worker)).toBe('pending')
      }
      return { lead, worker }
    }
    const restarted = (id: string): number =>
      ledger(id).filter((event) => event.type === 'work_restarted').length
    const toldItStalled = (lead: string): boolean =>
      ledger(lead).some(
        (event) =>
          event.type === 'work_stall_told' ||
          (event.type === 'message_queued' &&
            ('report' in (event as object) || event.appNotice === 'a-work-wait-needs-attention')),
      )

    it('after a crash, the launch says nothing of the work its continuation drives, and nobody is told it stopped', async () => {
      const { lead, worker } = await aGivenPieceIsCut('crash')
      starts(SOON, { turnsStayOpen: true })
      expect(restarted(worker)).toBe(0)
      await waitFor(() => continuations(worker).length === 1, 'the continuation')
      await settle()
      expect(restarted(worker)).toBe(0)
      expect(toldItStalled(lead)).toBe(false)
    })

    it('after a quit, a giver that starts while the continuation is coming is not told its work stopped', async () => {
      const { lead, worker } = await aGivenPieceIsCut('quit')
      starts(SOON, { turnsStayOpen: true })
      const sent = await now.host.startAndSend(lead, 'how is it going?', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await waitFor(() => continuations(worker).length === 1, 'the continuation')
      await settle()
      expect(toldItStalled(lead)).toBe(false)
    })

    /**
     * A service whose turn on `lead`'s piece One is running when the app crashes, with `other`'s piece
     * Two queued behind it. Every turn after the crash ends at once. With `ask`, that turn waits on a
     * person's approval.
     */
    const aServicesPieceIsCut = async (
      opts: { ask?: boolean } = {},
    ): Promise<{
      lead: string
      other: string
      service: string
      one: string
      two: string
    }> => {
      starts(CUT - 70_000, { services: true })
      const svc = now.store.createAgentIdentity(
        { slug: 'browser-driver', displayName: null, provider: 'claude' },
        { by: 'a-person' },
      )
      if (svc === null) throw new Error('the service already exists')
      writeProfileExecution(profileExecutionFile(userData), {
        profiles: { [svc.id]: { kind: 'service', identityCreatedAt: svc.createdAt } },
      })
      if (opts.ask !== true) now.store.setDefaultApprovalMode('auto')
      starts(CUT - 60_000, { turnsStayOpen: opts.ask !== true, services: true })
      const opened = async (profileId: string): Promise<string> =>
        (
          await now.host.createSession(
            { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
            window,
          )
        ).sessionId
      const lead = await opened('lead')
      const other = await opened('other-lead')
      await settle()
      const one = await callOn(lead, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'browser-driver',
        title: 'One',
        brief: 'book the room',
      })
      expect(one['outcome'], JSON.stringify(one)).toBe('ok')
      const two = await callOn(other, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'browser-driver',
        title: 'Two',
        brief: 'order lunch',
      })
      expect(two['outcome'], JSON.stringify(two)).toBe('ok')
      const service = one['agent'] as string
      await waitFor(
        () => ledger(service).some((event) => event.type === 'user_turn'),
        'the first brief to go in',
      )
      if (opts.ask === true) {
        await waitFor(
          () => ledger(service).some((event) => event.type === 'permission_request'),
          'its approval to be asked',
        )
      }
      await settle()
      clock = CUT
      return {
        lead,
        other,
        service,
        one: one['label'] as string,
        two: two['label'] as string,
      }
    }
    const piecesAt = (service: string): string[][] =>
      now.store.piecesOwnedBy(service).map((piece) => [piece.title ?? '', piece.state])
    const handedOverAt = (service: string): number =>
      ledger(service).filter(
        (event) =>
          event.type === 'message_unqueued' && (event as { reason?: string }).reason === 'sent',
      ).length

    it('a service’s cut is continued once on the piece it was on, and its queue keeps its place', async () => {
      const { lead, other, service } = await aServicesPieceIsCut()
      starts(SOON, { services: true, turnsStayOpen: true })
      await waitFor(() => continuations(service).length === 1, 'the continuation')
      await settle()
      expect(stateOf(service)).toBe('sent')
      expect(restarted(service)).toBe(0)
      expect(piecesAt(service)).toEqual([
        ['One', 'working'],
        ['Two', 'waiting'],
      ])
      expect(toldItStalled(lead)).toBe(false)
      expect(toldItStalled(other)).toBe(false)
      // ⚑ …a crash in the continued turn is continued once more, on the same piece…
      clock = SOON + 30_000
      starts(SOON + 60_000, { services: true, turnsStayOpen: true })
      await waitFor(() => continuations(service).length === 2, 'the second continuation')
      await waitFor(() => stateOf(service) === 'sent', 'the second continuation sent')
      await settle()
      // ⛔ …and a third cut waits for a person, and stalls only One.
      clock = SOON + 90_000
      starts(SOON + 120_000, { services: true })
      await waitFor(() => typeof stateOf(service) === 'object', 'the third cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'continued-twice' })
      expect(continuations(service)).toHaveLength(2)
      expect(piecesAt(service)).toEqual([
        ['One', 'stalled'],
        ['Two', 'waiting'],
      ])
    })

    it('a service’s turn a quit cut is continued once on the piece it was on', async () => {
      const { service } = await aServicesPieceIsCut()
      await now.host.closeAll()
      expect(stateOf(service)).toBe('pending')
      starts(SOON, { services: true })
      await waitFor(() => continuations(service).length === 1, 'the continuation')
      await settle()
      expect(stateOf(service)).toBe('sent')
      expect(piecesAt(service)[1]).toEqual(['Two', 'waiting'])
    })

    it('⛔ a service whose piece had ended before the crash goes on with nothing, stalls nothing, and hands the next over', async () => {
      const { service, one } = await aServicesPieceIsCut()
      const answered = await callOn(service, 'reply_to_parent', {
        piece: one,
        outcome: 'done',
        summary: 'Booked.',
      })
      expect(answered['outcome'], JSON.stringify(answered)).toBe('ok')
      starts(SOON, { services: true })
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'a-service' })
      expect(continuations(service)).toEqual([])
      expect(restarted(service)).toBe(0)
      await waitFor(() => handedOverAt(service) === 2, 'the next piece to be handed over')
      expect(piecesAt(service)[0]).toEqual(['One', 'answered'])
    })

    it('⛔ a service’s continuation whose piece is taken back while its account is asked is dropped, and never attached to the next', async () => {
      const { lead, service, one } = await aServicesPieceIsCut()
      starts(SOON, { services: true, accountAfterMs: 400 })
      await waitFor(() => running(now, service), 'the service to start for its cut')
      const taken = await callOn(lead, 'withdraw_task', { piece: one })
      expect(taken['outcome'], JSON.stringify(taken)).toBe('ok')
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'overtaken' })
      expect(continuations(service)).toEqual([])
      expect(askedFor(now, service)).toBe(1)
    })

    it('⛔ a service’s continuation whose piece is answered while its account is asked is dropped', async () => {
      const { other, service, one, two } = await aServicesPieceIsCut()
      starts(SOON, { services: true, accountAfterMs: 400 })
      await waitFor(() => running(now, service), 'the service to start for its cut')
      // Nothing waits behind it, so no next brief can overtake the continuation first.
      expect((await callOn(other, 'withdraw_task', { piece: two }))['outcome']).toBe('ok')
      const answered = await callOn(service, 'reply_to_parent', {
        piece: one,
        outcome: 'done',
        summary: 'Booked.',
      })
      expect(answered['outcome'], JSON.stringify(answered)).toBe('ok')
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'overtaken' })
      expect(continuations(service)).toEqual([])
      // Dropped before its words were held: nothing was held to be taken back.
      expect(heldCount(service)).toBe(0)
    })

    it('⛔ a service’s continuation whose piece is answered as its words wait to go is never sent', async () => {
      const { other, service, one, two } = await aServicesPieceIsCut()
      const gate = aGate()
      starts(SOON, { services: true, signInGate: gate })
      await waitFor(() => stateOf(service) === 'queued', 'the continuation to be held')
      // Nothing waits behind it, so nothing else needs the life started for the cut.
      expect((await callOn(other, 'withdraw_task', { piece: two }))['outcome']).toBe('ok')
      // The reply's delivery waits on the same gate, so the gate opens once its row is down.
      const answering = callOn(service, 'reply_to_parent', {
        piece: one,
        outcome: 'done',
        summary: 'Booked.',
      })
      await waitFor(() => piecesAt(service)[0]?.[1] === 'answered', 'the piece to be answered')
      gate.open()
      expect((await answering)['outcome']).toBe('ok')
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'overtaken' })
      expect(continuations(service)).toEqual([])
      // The life started only for the cut has nothing left to do, and is stopped again.
      await waitFor(() => !running(now, service), 'the life started for it to be stopped')
    })

    it('⛔ a service’s continuation that does not go stalls only the piece it was on, and tells only that piece’s caller', async () => {
      const { lead, other, service } = await aServicesPieceIsCut()
      starts(SOON, { services: true, account: 'bea' })
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'not-same-account' })
      expect(piecesAt(service)).toEqual([
        ['One', 'stalled'],
        ['Two', 'waiting'],
      ])
      for (const caller of [lead, other]) {
        const sent = await now.host.startAndSend(caller, 'how is it going?', window)
        expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      }
      await waitFor(() => toldItStalled(lead), 'its caller to be told')
      await settle()
      expect(toldItStalled(other)).toBe(false)
    })

    const toldCount = (caller: string): number =>
      ledger(caller).filter(
        (event) =>
          event.type === 'work_stall_told' ||
          (event.type === 'message_queued' &&
            ('report' in (event as object) || event.appNotice === 'a-work-wait-needs-attention')),
      ).length
    /** The service's handle in this life, the last one started. */
    const itsMachine = (): {
      noteProviderWork(): void
      completeTurn(state: 'completed'): void
    } => {
      const handle = handles.at(-1)
      if (handle === undefined) throw new Error('no handle')
      return (
        handle as unknown as {
          machine: { noteProviderWork(): void; completeTurn(state: 'completed'): void }
        }
      ).machine
    }
    /**
     * A service's cut that ends as `why`, at this launch and at the next after a crash: nothing of it
     * is continued or tried again, nothing past One is handed over, and Two waits with its caller
     * untold. With `stalls`, One stalls, and its caller alone is told, once.
     */
    const itGoesNowhere = async (
      cut: { readonly lead: string; readonly other: string; readonly service: string },
      why: NotContinuedBecause,
      stalls: boolean,
    ): Promise<void> => {
      const { lead, other, service } = cut
      // ⚑ What its ledger had handed over by the cut: nothing more is, at either launch.
      const handedOverAtTheCut = handedOverAt(service)
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: why })
      const asItStands = async (): Promise<void> => {
        expect(continuations(service)).toEqual([])
        expect(handedOverAt(service)).toBe(handedOverAtTheCut)
        // ⚑ Two's brief never handed over: its piece still waits.
        expect(piecesAt(service)[1]).toEqual(['Two', 'waiting'])
        if (stalls) expect(piecesAt(service)[0]).toEqual(['One', 'stalled'])
        for (const caller of [lead, other]) {
          if (running(now, caller)) continue
          const sent = await now.host.startAndSend(caller, 'how is it going?', window)
          expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
        }
        if (stalls) await waitFor(() => toldCount(lead) === 1, 'its caller to be told')
        await settle()
        if (stalls) expect(toldCount(lead)).toBe(1)
        expect(toldCount(other)).toBe(0)
      }
      await asItStands()
      starts(SOON + 120_000, { services: true })
      await settle()
      expect(stateOf(service)).toEqual({ ended: why })
      expect(askedFor(now, service)).toBe(0)
      await asItStands()
    }

    it('⛔ a service’s cut whose start fails goes nowhere, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut()
      starts(SOON, { services: true, startsFailFor: 'browser-driver' })
      await itGoesNowhere(cut, 'start-failed', true)
    })

    it('⛔ a service’s cut turn waiting on a person’s approval goes nowhere, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut({ ask: true })
      starts(SOON, { services: true })
      await itGoesNowhere(cut, 'blocked', true)
    })

    it('⛔ a service a person archives before its cut’s start goes nowhere, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut()
      starts(SOON, { services: true })
      expect(running(now, cut.service)).toBe(false)
      await now.host.archiveConversation(cut.service)
      await itGoesNowhere(cut, 'kept-stopped', true)
    })

    it('⛔ a service a person stops while its cut’s account is asked goes nowhere, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut()
      starts(SOON, { services: true, accountAfterMs: 400 })
      await waitFor(() => running(now, cut.service), 'the service to start for its cut')
      now.host.claimSession(cut.service, window)
      await now.host.close(cut.service, window)
      await itGoesNowhere(cut, 'stopped', true)
    })

    it('⛔ a service whose provider runs a turn of its own while its cut’s account is asked goes nowhere', async () => {
      const cut = await aServicesPieceIsCut()
      starts(SOON, { services: true, accountAfterMs: 400 })
      await waitFor(() => running(now, cut.service), 'the service to start for its cut')
      const machine = itsMachine()
      machine.noteProviderWork()
      await waitFor(
        () => ledger(cut.service).some((event) => event.type === 'provider_turn'),
        'its own turn',
      )
      machine.completeTurn('completed')
      // ⚑ Its own turn ended with One unanswered, so One stalls as any piece does then.
      await itGoesNowhere(cut, 'overtaken', true)
    })

    it('⛔ a service’s cut at its provider’s usage limit goes nowhere, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut()
      starts(SOON, { services: true })
      theLimitIsReached()
      await itGoesNowhere(cut, 'limited', true)
    })

    it('⛔ a service whose queue can’t be read goes on with nothing, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut()
      const one = now.store.piecesOwnedBy(cut.service)[0]
      if (one === undefined) throw new Error('no first piece')
      // A row of its work that can't be read, as a crash may leave one.
      const ordinal = now.store.nextOrdinal(cut.service) + 1_000
      now.store.append(
        cut.service,
        ordinal,
        {
          type: 'work_status_set',
          piece: one.piece,
          line: 'torn',
          by: cut.lead,
        } as TranscriptEvent,
        CUT,
      )
      now.db
        .prepare("UPDATE events SET payload = '{not json' WHERE session_id = ? AND ordinal = ?")
        .run(cut.service, ordinal)
      starts(SOON, { services: true })
      await itGoesNowhere(cut, 'a-service', true)
    })

    it('⛔ a service whose cut turn drove other work goes on with nothing, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut()
      // One's turn ends; its caller's note about its own work goes in, and that turn is cut.
      itsMachine().completeTurn('completed')
      await waitFor(() => piecesAt(cut.service)[0]?.[1] === 'stalled', 'One to stall')
      const root = now.store.rootOf(cut.lead)
      if (root === null) throw new Error('the caller holds no work of its own')
      const noted = await callOn(cut.lead, 'message_agent', {
        agent: cut.service,
        kind: 'note',
        piece: root.label,
        text: 'for my own records',
      })
      expect(noted['outcome'], JSON.stringify(noted)).toBe('ok')
      await waitFor(
        () => ledger(cut.service).filter((event) => event.type === 'user_turn').length === 2,
        'the note’s turn',
      )
      await waitFor(() => toldCount(cut.lead) === 1, 'One’s caller to be told it stalled')
      await settle()
      clock = CUT
      starts(SOON, { services: true })
      await itGoesNowhere(cut, 'a-service', true)
    })

    /**
     * One's turn ends with its caller's words held behind it, which go in one turn of their own that
     * the crash cuts: `about` names the piece each one names.
     */
    const aCutOfTheCallersWords = async (
      about: readonly ('its-piece' | 'its-own-work' | 'nothing')[],
    ): Promise<{ lead: string; other: string; service: string; one: string }> => {
      const cut = await aServicesPieceIsCut()
      const root = now.store.rootOf(cut.lead)
      if (root === null) throw new Error('the caller holds no work of its own')
      for (const [at, named] of about.entries()) {
        const sent = await callOn(cut.lead, 'message_agent', {
          agent: cut.service,
          ...(named === 'its-piece'
            ? { kind: 'follow-up', piece: cut.one }
            : named === 'its-own-work'
              ? { kind: 'note', piece: root.label }
              : { kind: 'note' }),
          text: `word ${String(at)}`,
        })
        expect(sent['outcome'], JSON.stringify(sent)).toBe('ok')
      }
      itsMachine().completeTurn('completed')
      await waitFor(
        () => ledger(cut.service).filter((event) => event.type === 'user_turn').length === 2,
        'the words’ turn',
      )
      const batch = ledger(cut.service).filter((event) => event.type === 'user_turn')[1]
      if (about.length > 1) {
        expect((batch as { parts?: unknown[] } | undefined)?.parts).toHaveLength(about.length)
      }
      await settle()
      clock = CUT
      return cut
    }

    it('⛔ a service whose cut turn named other work beside its piece goes on with nothing, at this launch or the next', async () => {
      const cut = await aCutOfTheCallersWords(['its-own-work', 'its-piece'])
      starts(SOON, { services: true })
      await itGoesNowhere(cut, 'a-service', true)
    })

    it('⛔ a service whose cut turn asked to stop one that named other work goes on with nothing, at this launch or the next', async () => {
      const cut = await aCutOfTheCallersWords(['its-own-work'])
      // Its caller's words ask the turn on its own work to stop, and go in the turn after it.
      const sent = await callOn(cut.lead, 'message_agent', {
        agent: cut.service,
        kind: 'follow-up',
        piece: cut.one,
        interrupt: true,
        text: 'stop and read this',
      })
      expect(sent['outcome'], JSON.stringify(sent)).toBe('ok')
      ;(itsMachine() as unknown as { completeTurn(state: 'interrupted'): void }).completeTurn(
        'interrupted',
      )
      await waitFor(
        () => ledger(cut.service).filter((event) => event.type === 'user_turn').length === 3,
        'the turn its words asked for',
      )
      await settle()
      clock = CUT
      starts(SOON, { services: true })
      await itGoesNowhere(cut, 'a-service', true)
    })

    it('⛔ a service whose cut turn’s words can’t be read goes on with nothing, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut()
      now.db
        .prepare(
          "UPDATE events SET payload = '{not json' WHERE session_id = ? AND type = 'user_turn'",
        )
        .run(cut.service)
      starts(SOON, { services: true })
      await itGoesNowhere(cut, 'a-service', true)
    })

    it.each([
      ['its piece twice', ['its-piece', 'its-piece']],
      ['its piece and nothing', ['nothing', 'its-piece']],
    ] as const)(
      'a service’s cut turn whose words name %s is continued on that piece',
      async (_named, about) => {
        const { service } = await aCutOfTheCallersWords(about)
        starts(SOON, { services: true })
        await waitFor(() => continuations(service).length === 1, 'the continuation')
        await settle()
        expect(stateOf(service)).toBe('sent')
      },
    )

    it('⛔ a service whose cut found two pieces handed over goes on with neither, and hands nothing more over', async () => {
      // ⚑ Its dispatcher never hands a second piece over while one is open: a row says so here.
      const { lead, other, service } = await aServicesPieceIsCut()
      const three = await callOn(other, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'browser-driver',
        title: 'Three',
        brief: 'water the plants',
      })
      expect(three['outcome'], JSON.stringify(three)).toBe('ok')
      const two = now.store.piecesOwnedBy(service)[1]
      if (two?.messageId == null) throw new Error('no queued second piece')
      now.store.append(
        service,
        now.store.nextOrdinal(service),
        { type: 'message_unqueued', messageId: two.messageId, reason: 'sent' } as TranscriptEvent,
        CUT,
      )
      starts(SOON, { services: true })
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'a-service' })
      starts(SOON + 120_000, { services: true })
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'a-service' })
      expect(askedFor(now, service)).toBe(0)
      expect(continuations(service)).toEqual([])
      expect(handedOverAt(service)).toBe(2)
      expect(piecesAt(service)).toEqual([
        ['One', 'stalled'],
        ['Two', 'stalled'],
        ['Three', 'waiting'],
      ])
      for (const caller of [lead, other]) {
        const sent = await now.host.startAndSend(caller, 'how is it going?', window)
        expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      }
      await waitFor(() => toldCount(lead) === 1 && toldCount(other) === 1, 'each caller told')
      await settle()
      expect([toldCount(lead), toldCount(other)]).toEqual([1, 1])
    })

    it('⛔ a service’s piece taken back before its cut’s start: the start is made, the cut dropped, and the next piece goes on its own', async () => {
      const { lead, service, one } = await aServicesPieceIsCut()
      starts(SOON, { services: true })
      expect(running(now, service)).toBe(false)
      expect((await callOn(lead, 'withdraw_task', { piece: one }))['outcome']).toBe('ok')
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'overtaken' })
      await waitFor(
        () => piecesAt(service)[1]?.[1] !== undefined && piecesAt(service)[1]?.[1] !== 'waiting',
        'the next piece to be handed over',
      )
      await settle()
      expect(continuations(service)).toEqual([])
      expect(piecesAt(service)[0]).toEqual(['One', 'withdrawn'])
      // ⚑ The start it waited for is still made, once: what it drops is its words.
      expect(askedFor(now, service)).toBe(1)
      // …and the next launch, after a crash, continues nothing.
      starts(SOON + 120_000, { services: true })
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'overtaken' })
      expect(continuations(service)).toEqual([])
    })

    it('⛔ when a crash’s continuation does not go, the work stalls then, and its giver is told as it starts', async () => {
      const { lead, worker } = await aGivenPieceIsCut('crash')
      starts(SOON, { account: 'bea' })
      expect(restarted(worker)).toBe(0)
      await waitFor(() => typeof stateOf(worker) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(worker)).toEqual({ ended: 'not-same-account' })
      expect(restarted(worker)).toBe(1)
      const sent = await now.host.startAndSend(lead, 'how is it going?', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await waitFor(() => toldItStalled(lead), 'its giver to be told')
    })

    it('⛔ …and a piece its giver marked as waiting on purpose stalls once too, keeps its mark, and a second stop sweep writes nothing', async () => {
      const { lead, worker } = await aGivenPieceIsCut('crash')
      const label = now.store.piecesOwnedBy(worker)[0]?.label
      const parked = await callOn(lead, 'update_work', {
        piece: label,
        status: 'until the review lands',
        on: { time: new Date(clock + 3_600_000).toISOString() },
      })
      expect(parked['outcome'], JSON.stringify(parked)).toBe('ok')
      expect(now.store.piecesOwnedBy(worker)[0]).toMatchObject({
        state: 'waiting-on-purpose',
        parkedOver: 'working',
      })
      starts(SOON, { account: 'bea' })
      await waitFor(() => typeof stateOf(worker) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(worker)).toEqual({ ended: 'not-same-account' })
      expect(restarted(worker)).toBe(1)
      // ⚑ The mark outlasts the restart: still waiting on purpose, over the stall the sweep wrote.
      expect(now.store.piecesOwnedBy(worker)[0]).toMatchObject({
        state: 'waiting-on-purpose',
        parkedOver: 'stalled',
        stalledBecause: null,
      })
      // ⛔ The stop sweep once more writes nothing: the piece no longer stands over a drive.
      ;(now.host as unknown as { stallWhatACutLeft(conversation: string): void }).stallWhatACutLeft(
        worker,
      )
      expect(restarted(worker)).toBe(1)
    })
  })

  describe('pacing', () => {
    it('two cut turns are started one at a time, four gaps apart', async () => {
      const a = await aTurnRunsIn()
      const { sessionId: b } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-b', approvalMode: 'auto', cwd: root },
        window,
      )
      await settle()
      await now.host.send(b, 'the other thing', window)
      await settle()
      starts(SOON)
      await waitFor(
        () => continuations(a).length === 1 && continuations(b).length === 1,
        'both continuations',
      )
      const [first, second] = now.startedAt
      expect(now.startedAt).toHaveLength(2)
      expect((second ?? 0) - (first ?? 0)).toBeGreaterThanOrEqual(4 * GAP - 5)
    })

    it('a cut turn whose background work the quit also stopped is started once, and both notices go in as one turn', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      now.store.append(
        a,
        now.store.nextOrdinal(a),
        {
          type: 'background_work',
          running: [{ id: 't0', description: 'Run the full live test' }],
          source: 'test',
        } as unknown as TranscriptEvent,
        CUT - 5_000,
      )
      starts(SOON)
      await waitFor(() => stateOf(a) === 'sent', 'the continuation to be sent')
      await settle()
      expect(askedFor(now, a)).toBe(1)
      const turns = ledger(a)
        .filter((event) => event.type === 'user_turn')
        .map((event) => (event as { text: string }).text)
      expect(turns.at(-1)).toContain('stopped your background work')
      expect(turns.at(-1)).toContain(aTurnTheAppCutText('quit', CUT, clock, 'claude'))
    })
  })

  /** The conversation's latest provider handle. */
  const itsHandle = (id: string): FakeSessionHandle => {
    const ref = providerIdOf(id)
    const found = handles.filter((one) => one.ref.sessionId === ref).at(-1)
    if (found === undefined) throw new Error(`${id} has no provider handle`)
    return found
  }
  /** Its provider's program stops while its turn runs, as a process that exits ends a session. */
  const itsProgramStops = (id: string): void => {
    itsHandle(id).simulateError('the provider process exited', true)
  }
  /** Its running turn ends on Claude's usage limit, which resets this long from now. */
  const itsTurnMeetsTheLimit = (
    id: string,
    resetsInMs: number | null,
    more: { readonly creditsRequired?: true } = {},
  ): number => {
    const resetsAt = clock + (resetsInMs ?? 0)
    const fake = itsHandle(id) as unknown as {
      push(event: unknown): void
      machine: { completeTurn(outcome: string, message?: string, limit?: unknown): void }
    }
    // ⚑ As Claude's adapter says it first: the limit's own line, which the hold reads.
    const resets = resetsInMs === null ? '' : `; resets ${new Date(resetsAt).toISOString()}`
    fake.push({
      type: 'error',
      message: `claude is rate-limited (five_hour) — the turn may stall until it resets${resets}`,
      fatal: false,
    })
    fake.machine.completeTurn('failed', 'You have reached your usage limit.', {
      provider: 'claude',
      window: 'five_hour',
      ...(resetsInMs === null ? {} : { resetsAt }),
      ...more,
    })
    return resetsAt
  }
  /** The person's own Stop, as a window asks it. */
  const aPersonCloses = (id: string): Promise<void> => now.host.close(id, window)

  describe('a program that stopped while its turn ran', () => {
    it('is started once after the wait, and its words go as that life’s first turn', async () => {
      const a = await aTurnRunsIn()
      const stopped = performance.now()
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end')
      expect(stateOf(a)).toBe('pending')
      await new Promise((resolve) => setTimeout(resolve, PROGRAM_WAIT / 3))
      expect(askedFor(now, a)).toBe(1)
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(askedFor(now, a)).toBe(2)
      expect((now.startedAt.at(-1) ?? 0) - stopped).toBeGreaterThanOrEqual(PROGRAM_WAIT - 5)
      expect(continuations(a)).toEqual([aTurnTheAppCutText('program', CUT, clock, 'claude')])
      expect(stateOf(a)).toBe('sent')
      await settle()
      expect(askedFor(now, a)).toBe(2)
    })

    it('⛔ a turn a stop was asked of: no cut, and no start', async () => {
      const a = await aTurnRunsIn()
      await now.host.interrupt(a, window)
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end')
      await new Promise((resolve) => setTimeout(resolve, PROGRAM_WAIT + 200))
      await settle()
      expect(stateOf(a)).toBeUndefined()
      expect(askedFor(now, a)).toBe(1)
      expect(continuations(a)).toEqual([])
    })

    it('⛔ a login its provider refused is not a stopped program', async () => {
      const a = await aTurnRunsIn()
      const fake = itsHandle(a) as unknown as {
        push(event: unknown): void
        machine: { fatalAfterReportedError(said: { loginRefused: boolean }): void }
        queue: { close(): void }
      }
      fake.push({ type: 'error', message: 'token expired', fatal: true, cause: 'auth_stale' })
      fake.machine.fatalAfterReportedError({ loginRefused: true })
      fake.queue.close()
      await waitFor(() => !running(now, a), 'the conversation to end')
      await new Promise((resolve) => setTimeout(resolve, PROGRAM_WAIT + 200))
      await settle()
      expect(stateOf(a)).toBeUndefined()
      expect(continuations(a)).toEqual([])
    })

    it('a continuation whose program stops again is continued once more, and a third stop waits for a person', async () => {
      const a = await aTurnRunsIn()
      itsProgramStops(a)
      await waitFor(() => stateOf(a) === 'sent', 'the first continuation to be sent')
      await settle()
      itsProgramStops(a)
      await waitFor(() => continuations(a).length === 2, 'the second continuation')
      await waitFor(() => stateOf(a) === 'sent', 'the second continuation to be sent')
      await settle()
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end a third time')
      await new Promise((resolve) => setTimeout(resolve, PROGRAM_WAIT + 200))
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'continued-twice' })
      expect(askedFor(now, a)).toBe(3)
      expect(continuations(a)).toHaveLength(2)
    })

    it('any mix counts toward the two: a program’s continuation, then a limit’s, then a third cut waits', async () => {
      const a = await aTurnRunsIn({ limitLookMs: LIMIT_LOOK })
      itsProgramStops(a)
      await waitFor(() => stateOf(a) === 'sent', 'the first continuation to be sent')
      await settle()
      const resetsAt = itsTurnMeetsTheLimit(a, 60 * 60_000)
      await settle()
      expect(stateOf(a)).toBe('pending')
      clock = resetsAt + 1_000
      await waitFor(() => continuations(a).length === 2, 'the second continuation')
      await waitFor(() => stateOf(a) === 'sent', 'the second continuation to be sent')
      await settle()
      itsProgramStops(a)
      await waitFor(() => typeof stateOf(a) === 'object', 'the third cut to end')
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'continued-twice' })
      expect(continuations(a)).toHaveLength(2)
    })

    it('⛔ on another account when it starts again: not continued, and that life is stopped again', async () => {
      const a = await aTurnRunsIn()
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end')
      ;(now.stops as { account?: Stops['account'] }).account = 'bea'
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'not-same-account' })
      expect(continuations(a)).toEqual([])
      expect(running(now, a)).toBe(false)
    })

    it('⛔ a person who writes first: the start their words make carries no stale continuation', async () => {
      const a = await aTurnRunsIn()
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end')
      const sent = await now.host.startAndSend(a, 'are you there?', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'overtaken' })
      expect(continuations(a)).toEqual([])
      expect(askedFor(now, a)).toBe(2)
    })

    it('⛔ a start that fails is not tried again', async () => {
      const a = await aTurnRunsIn({ startsFailFor: 'agent-a' })
      itsProgramStops(a)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await new Promise((resolve) => setTimeout(resolve, PROGRAM_WAIT + 200))
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'start-failed' })
      expect(askedFor(now, a)).toBe(2)
      expect(continuations(a)).toEqual([])
    })

    it('⛔ a newer cut during the wait is not the program’s wake to act on: a limit’s waits for its reset', async () => {
      const a = await aTurnRunsIn({ limitLookMs: LIMIT_LOOK, programWaitMs: 4 * PROGRAM_WAIT })
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end')
      const sent = await now.host.startAndSend(a, 'are you there?', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await waitFor(() => running(now, a), 'the person’s start')
      await settle()
      const resetsAt = itsTurnMeetsTheLimit(a, 60 * 60_000)
      await settle()
      expect(readKeptCuts(turnsTheAppCutFile(userData)).cuts[a]?.kind).toBe('limit')
      await new Promise((resolve) => setTimeout(resolve, 4 * PROGRAM_WAIT + 300))
      await settle()
      expect(stateOf(a)).toBe('pending')
      clock = resetsAt + 1_000
      await waitFor(() => continuations(a).length === 1, 'the limit’s continuation')
      expect(continuations(a)).toEqual([
        aTurnTheAppCutText('limit', resetsAt - 60 * 60_000, clock, 'claude'),
      ])
    })

    it('a teardown that outlasts the wait: its start waits it out, then continues it', async () => {
      const teardown = aGate()
      const a = await aTurnRunsIn({ closeWaitsFor: teardown })
      itsProgramStops(a)
      await new Promise((resolve) => setTimeout(resolve, PROGRAM_WAIT + 4 * GAP + 400))
      expect(stateOf(a)).toBe('starting')
      expect(continuations(a)).toEqual([])
      teardown.open()
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await waitFor(() => stateOf(a) === 'sent', 'the continuation to be sent')
      expect(askedFor(now, a)).toBe(2)
    })

    it('⛔ a person who writes while that teardown is held: their words go, and no stale continuation', async () => {
      const teardown = aGate()
      const a = await aTurnRunsIn({ closeWaitsFor: teardown })
      itsProgramStops(a)
      await new Promise((resolve) => setTimeout(resolve, PROGRAM_WAIT + 4 * GAP + 400))
      expect(stateOf(a)).toBe('starting')
      const sending = now.host.startAndSend(a, 'are you there?', window)
      teardown.open()
      const sent = await sending
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'overtaken' })
      expect(continuations(a)).toEqual([])
    })

    it('a quit during the wait: the next launch continues it once', async () => {
      const a = await aTurnRunsIn()
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end')
      await now.host.closeAll()
      expect(stateOf(a)).toBe('pending')
      starts(SOON)
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(askedFor(now, a)).toBe(1)
      expect(stateOf(a)).toBe('sent')
    })

    it('⛔ …but not more than an hour after it stopped', async () => {
      const a = await aTurnRunsIn()
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end')
      await now.host.closeAll()
      starts(TOO_LATE)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'too-old' })
    })
  })

  describe('a turn its usage limit ended', () => {
    const anHour = 60 * 60_000
    const limited = { limitLookMs: LIMIT_LOOK } as const

    it('is continued once its limit resets, on the life still running', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      expect(stateOf(a)).toBe('pending')
      expect(continuations(a)).toEqual([])
      clock = resetsAt + 1_000
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(continuations(a)).toEqual([aTurnTheAppCutText('limit', CUT, clock, 'claude')])
      expect(stateOf(a)).toBe('sent')
      expect(askedFor(now, a)).toBe(1)
    })

    it('is started once for it after its reset, when the app stopped it meanwhile', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      await now.host.close(a, THE_APP_ITSELF)
      expect(stateOf(a)).toBe('pending')
      clock = resetsAt + 1_000
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(askedFor(now, a)).toBe(2)
      expect(stateOf(a)).toBe('sent')
    })

    it('⛔ a person who closes it ends its wait', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      await aPersonCloses(a)
      expect(stateOf(a)).toEqual({ ended: 'stopped' })
      clock = resetsAt + 1_000
      await settle()
      expect(askedFor(now, a)).toBe(1)
      expect(continuations(a)).toEqual([])
    })

    it.each([
      ['with no reset', null, {}, 'no-reset'],
      [
        'when it needs credits bought',
        anHour,
        { creditsRequired: true as const },
        'credits-required',
      ],
      ['when its reset is more than a day away', 25 * anHour, {}, 'reset-too-far'],
    ] as const)('⛔ %s, it is not continued', async (_what, resetsIn, more, why) => {
      const a = await aTurnRunsIn(limited)
      itsTurnMeetsTheLimit(a, resetsIn, more)
      await settle()
      expect(stateOf(a)).toEqual({ ended: why })
      clock += 26 * anHour
      await settle()
      expect(continuations(a)).toEqual([])
    })

    it('⛔ a continuation held up until a day after its cut is not handed over', async () => {
      const a = await aTurnRunsIn({ ...limited, accountAfterMs: ACCOUNT_WAIT - 50 })
      await new Promise((resolve) => setTimeout(resolve, ACCOUNT_WAIT))
      const day = 24 * anHour
      const cutAt = clock
      const resetsAt = itsTurnMeetsTheLimit(a, day - 60_000)
      await settle()
      await now.host.close(a, THE_APP_ITSELF)
      expect(stateOf(a)).toBe('pending')
      const before = now.startedAt.length
      clock = resetsAt + 1_000
      // Its start is made, and its account is read for a while: the day passes meanwhile.
      await waitFor(() => now.startedAt.length > before, 'its start')
      clock = cutAt + day + 60_000
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'reset-too-far' })
      expect(continuations(a)).toEqual([])
    })

    it('⛔ a limit read that fails at the reset holds it, and it goes once the read answers', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      const read = now.store.providerLimitsSeen.bind(now.store)
      const failing = vi.spyOn(now.store, 'providerLimitsSeen').mockImplementation(() => {
        throw new Error('the disk could not be read')
      })
      clock = resetsAt + 1_000
      await settle()
      expect(stateOf(a)).toBe('pending')
      expect(continuations(a)).toEqual([])
      failing.mockImplementation(read)
      await waitFor(() => continuations(a).length === 1, 'the continuation')
    })

    it('⛔ a limit row that cannot be read holds it at the reset, and it goes once the row reads', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      const wall = now.db
        .prepare(
          `SELECT id, payload FROM events WHERE session_id = ? AND type = 'error' AND payload LIKE '%rate-limited%'`,
        )
        .all(a) as { id: string; payload: string }[]
      expect(wall).toHaveLength(1)
      const [row] = wall
      if (row === undefined) throw new Error('no wall row')
      const torn = row.payload.slice(0, row.payload.indexOf('resets'))
      now.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(torn, row.id)
      clock = resetsAt + 1_000
      await settle()
      expect(stateOf(a)).toBe('pending')
      expect(continuations(a)).toEqual([])
      now.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(row.payload, row.id)
      await waitFor(() => continuations(a).length === 1, 'the continuation')
    })

    it('⛔ held words whose last wait before the handover crosses a day from the cut: not handed over, and the life started for them is stopped again', async () => {
      const a = await aTurnRunsIn(limited)
      const day = 24 * anHour
      const cutAt = clock
      const resetsAt = itsTurnMeetsTheLimit(a, day - 60_000)
      await settle()
      await now.host.close(a, THE_APP_ITSELF)
      const gate = aGate()
      now.stops.signInGate = gate
      clock = resetsAt + 1_000
      await waitFor(() => stateOf(a) === 'queued', 'the words to be held')
      await settle()
      expect(continuations(a)).toEqual([])
      clock = cutAt + day + 60_000
      gate.open()
      await waitFor(() => stateOf(a) !== 'queued', 'the held words to be settled')
      await settle()
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'reset-too-far' })
      await waitFor(() => !running(now, a), 'its life to stop')
    })

    it.each(['a read of the limits that fails', 'a limit row that cannot be read'] as const)(
      '⛔ held words whose last wait before the handover ends on %s: not handed over, and the life started for them is stopped again',
      async (what) => {
        const a = await aTurnRunsIn(limited)
        const resetsAt = itsTurnMeetsTheLimit(a, anHour)
        await settle()
        await now.host.close(a, THE_APP_ITSELF)
        const gate = aGate()
        now.stops.signInGate = gate
        clock = resetsAt + 1_000
        await waitFor(() => stateOf(a) === 'queued', 'the words to be held')
        await settle()
        expect(continuations(a)).toEqual([])
        let restore: () => void
        if (what === 'a read of the limits that fails') {
          const failing = vi.spyOn(now.store, 'providerLimitsSeen').mockImplementation(() => {
            throw new Error('the disk could not be read')
          })
          restore = () => failing.mockRestore()
        } else {
          const [row] = now.db
            .prepare(
              `SELECT id, payload FROM events WHERE session_id = ? AND type = 'error' AND payload LIKE '%rate-limited%'`,
            )
            .all(a) as { id: string; payload: string }[]
          if (row === undefined) throw new Error('no wall row')
          const torn = row.payload.slice(0, row.payload.indexOf('resets'))
          now.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(torn, row.id)
          restore = () => {
            now.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(row.payload, row.id)
          }
        }
        gate.open()
        await waitFor(() => stateOf(a) !== 'queued', 'the held words to be settled')
        await settle()
        expect(continuations(a)).toEqual([])
        expect(stateOf(a)).toEqual({ ended: 'limited' })
        await waitFor(() => !running(now, a), 'its life to stop')
        restore()
      },
    )

    it('⛔ a limit standing with no reset at its reset time holds it, and it goes once that limit is gone', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      // Another conversation's own limit line, which names no reset.
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
          message: 'claude is rate-limited (five_hour) — the turn may stall until it resets',
          fatal: false,
        } as TranscriptEvent,
        clock,
      )
      clock = resetsAt + 1_000
      await settle()
      expect(stateOf(a)).toBe('pending')
      expect(continuations(a)).toEqual([])
      now.db.prepare(`DELETE FROM events WHERE session_id = 'sess_wall'`).run()
      await waitFor(() => continuations(a).length === 1, 'the continuation')
    })

    it('⛔ newer words before the reset: no stale continuation', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      await now.host.send(a, 'try something else', window)
      await settle()
      clock = resetsAt + 1_000
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'overtaken' })
      expect(continuations(a)).toEqual([])
    })

    it('a continuation that meets the limit again waits again once, and a third cut waits for a person', async () => {
      const a = await aTurnRunsIn(limited)
      for (let round = 1; round <= 2; round++) {
        const resetsAt = itsTurnMeetsTheLimit(a, anHour)
        await settle()
        expect(stateOf(a)).toBe('pending')
        clock = resetsAt + 1_000
        await waitFor(() => continuations(a).length === round, `continuation ${String(round)}`)
        await waitFor(() => stateOf(a) === 'sent', `continuation ${String(round)} sent`)
        await settle()
      }
      itsTurnMeetsTheLimit(a, anHour)
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'continued-twice' })
      expect(continuations(a)).toHaveLength(2)
    })

    it('two cut by one limit are started after its reset, apart', async () => {
      const a = await aTurnRunsIn(limited)
      const { sessionId: b } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-b', approvalMode: 'auto', cwd: root },
        window,
      )
      await settle()
      await now.host.send(b, 'the other thing', window)
      await settle()
      itsTurnMeetsTheLimit(a, anHour)
      const resetsAt = itsTurnMeetsTheLimit(b, anHour)
      await settle()
      await now.host.close(a, THE_APP_ITSELF)
      await now.host.close(b, THE_APP_ITSELF)
      const before = now.startedAt.length
      clock = resetsAt + 1_000
      await waitFor(
        () => continuations(a).length === 1 && continuations(b).length === 1,
        'both continuations',
      )
      const [first, second] = now.startedAt.slice(before)
      expect(now.startedAt.slice(before)).toHaveLength(2)
      expect((second ?? 0) - (first ?? 0)).toBeGreaterThanOrEqual(LIMIT_GAP - 5)
    })

    it('a restart before its reset: the next launch waits for it, then continues it', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      await now.host.closeAll()
      starts(clock + 60_000, limited)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toBe('pending')
      clock = resetsAt + 1_000
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(askedFor(now, a)).toBe(1)
      expect(stateOf(a)).toBe('sent')
    })

    it('⛔ a launch more than an hour after its reset does not continue it', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      await now.host.closeAll()
      starts(resetsAt + anHour + 60_000, limited)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'too-old' })
    })
  })
})
