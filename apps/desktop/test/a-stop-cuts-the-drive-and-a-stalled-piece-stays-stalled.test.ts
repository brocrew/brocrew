import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/conversation-events'
import type { PieceRow } from '../src/shared/task-contracts'
import { performance } from 'node:perf_hooks'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, SessionMachine } from '@brobot2/runtime'
import type {
  AgentToolset,
  RuntimeEvent,
  SessionHandle,
  SessionRef,
  ResumeOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { derivePieces } from '../src/shared/tasks'
import {
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
} from './lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const REF: SessionRef = { provider: 'claude', sessionId: 'sess_1', cwd: '/tmp/x', rotation: 0 }

const anActiveMachine = () => {
  const events: RuntimeEvent[] = []
  const m = new SessionMachine((event) => events.push(event))
  m.markStarting()
  m.sessionStarted(REF, 'started')
  return { m, events }
}
const statuses = (events: RuntimeEvent[]): string[] =>
  events.filter((e) => e.type === 'status').map((e) => (e.type === 'status' ? e.state : ''))

describe('§1 · the session machine, closing over a burst and over a turn', () => {
  const words = (events: RuntimeEvent[]): string[] =>
    events.flatMap((e) =>
      e.type === 'status'
        ? [`status ${e.state}`]
        : e.type === 'turn'
          ? [`turn ${e.state}${e.startedBy === 'the-provider' ? ' (the provider’s own)' : ''}`]
          : [],
    )

  it('🔴 a burst the close cut ends on its own turn row, before the idle and the close’s ended (F080)', () => {
    const forced = anActiveMachine()
    forced.m.noteProviderWork()
    expect(statuses(forced.events)).toEqual(['idle', 'working'])
    expect(forced.events.filter((e) => e.type === 'provider_turn')).toHaveLength(1)
    expect(forced.m.beginClose()).toBe(true)
    forced.m.forceEnd()
    forced.m.closeSession(REF)
    expect(words(forced.events)).toEqual([
      'status idle',
      'status working',
      'turn interrupted (the provider’s own)',
      'status idle',
      'status ended',
    ])

    const terminal = anActiveMachine()
    terminal.m.noteProviderWork()
    expect(terminal.m.beginClose()).toBe(true)
    terminal.m.completeTurn('completed')
    terminal.m.closeSession(REF)
    expect(words(terminal.events)).toEqual([
      'status idle',
      'status working',
      'turn completed (the provider’s own)',
      'status idle',
      'status ended',
    ])

    const byItself = anActiveMachine()
    byItself.m.noteProviderWork()
    byItself.m.forceEnd()
    expect(words(byItself.events)).toEqual([
      'status idle',
      'status working',
      'turn interrupted (the provider’s own)',
      'status idle',
    ])

    const aTurn = anActiveMachine()
    aTurn.m.beginTurn()
    expect(aTurn.m.beginClose()).toBe(true)
    aTurn.m.completeTurn('interrupted')
    aTurn.m.closeSession(REF)
    expect(words(aTurn.events)).toEqual([
      'status idle',
      'status working',
      'turn interrupted',
      'status idle',
      'status ended',
    ])
  })
})

let ordinal = 0
let clock = 7_000_000

const row = (event: TranscriptEvent): PersistedEventInfo => ({
  ordinal: ordinal++,
  at: (clock += 1_000),
  event,
})

const assigned: TranscriptEvent = {
  type: 'work_given',
  piece: 'work_7',
  label: 'W1.7',
  parent: 'work_root_ayo',
  givenBy: 'sess_ayo',
  title: 'Build the index',
  brief: 'build the index',
}
const working: TranscriptEvent = { type: 'status', state: 'working' }
const idle: TranscriptEvent = { type: 'status', state: 'idle' }
const stopped: TranscriptEvent = { type: 'status', state: 'ended' }
const turnEnds: TranscriptEvent = { type: 'turn', state: 'completed' }
const aTurnOpens: TranscriptEvent = {
  type: 'user_turn',
  text: 'build the index',
  attribution: 'app_authored',
  relayedFrom: 'sess_ayo',
  says: 'note',
}
const running = (...items: { id: string; description?: string }[]): TranscriptEvent =>
  ({ type: 'background_work', running: items, source: 'test' }) as TranscriptEvent
const ended = (id: string): TranscriptEvent =>
  ({
    type: 'background_work',
    ended: { id, outcome: 'completed' },
    source: 'test',
  }) as TranscriptEvent
const jobs = (...items: { id: string; schedule?: string }[]): TranscriptEvent =>
  ({ type: 'scheduled_work', jobs: items, source: 'test' }) as TranscriptEvent

const theTask = (entries: TranscriptEvent[], backgroundWakesIt = true): PieceRow => {
  ordinal = 0
  clock = 7_000_000
  const found = derivePieces('sess_camille', entries.map(row), { backgroundWakesIt })[0]
  if (found === undefined) throw new Error('no piece was folded')
  return found
}

describe('§2 · the fold — a stop ends the drive it cut, and nothing else', () => {
  const untilTheWake: TranscriptEvent[] = [
    assigned,
    aTurnOpens,
    working,
    running({ id: 'bg_1', description: 'sleep 40' }),
    turnEnds,
    idle,
    ended('bg_1'),
    working,
  ]

  it('🔴 a ledger recorded before F080 — a wake with no turn row — still ends where it ended: a stop, or by itself', () => {
    expect(theTask(untilTheWake)).toMatchObject({ state: 'working', stalledBecause: null })

    const cut = theTask([...untilTheWake, stopped])
    expect(cut.state).toBe('stalled')
    expect(cut.stalledBecause).toBe('turn_interrupted')

    const byItself = theTask([...untilTheWake, idle])
    expect(byItself.state).toBe('stalled')
    expect(byItself.stalledBecause).toBe('turn_ended')
  })

  it('🔴 F080 · a wake that writes its own turn row is judged by that row — a stop, a limit, or its own end', () => {
    const theWake: TranscriptEvent[] = [
      assigned,
      aTurnOpens,
      working,
      running({ id: 'bg_1', description: 'sleep 40' }),
      turnEnds,
      idle,
      ended('bg_1'),
      { type: 'provider_turn' },
      working,
    ]
    const itsEnd = (end: TranscriptEvent): TranscriptEvent[] => [...theWake, end, idle]
    expect(theTask(theWake)).toMatchObject({ state: 'working', stalledBecause: null })

    const cut = theTask(
      itsEnd({ type: 'turn', state: 'interrupted', wordOf: 'this-app', startedBy: 'the-provider' }),
    )
    expect(cut).toMatchObject({ state: 'stalled', stalledBecause: 'turn_interrupted' })

    const byItself = theTask(
      itsEnd({ type: 'turn', state: 'completed', startedBy: 'the-provider' }),
    )
    expect(byItself).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })

    const limited = theTask(
      itsEnd({
        type: 'turn',
        state: 'failed',
        startedBy: 'the-provider',
        limit: { provider: 'claude', window: 'five_hour' },
      }),
    )
    expect(limited).toMatchObject({ state: 'stalled', stalledBecause: 'provider_limited' })

    const refused = theTask([
      ...theWake,
      {
        type: 'turn',
        state: 'failed',
        wordOf: 'this-app',
        startedBy: 'the-provider',
        loginRefused: true,
      },
      { type: 'status', state: 'errored', loginRefused: true },
    ])
    expect(refused).toMatchObject({ state: 'stalled', stalledBecause: 'login_refused' })

    const closed = theTask([
      ...theWake,
      { type: 'turn', state: 'interrupted', wordOf: 'this-app', startedBy: 'the-provider' },
      idle,
      stopped,
    ])
    expect(closed).toMatchObject({ state: 'stalled', stalledBecause: 'turn_interrupted' })
  })

  it('🔴 F080 · a wake a message joined ends as that message’s turn, and the turn is over after it', () => {
    const aWake: TranscriptEvent[] = [
      { type: 'provider_turn' },
      working,
      { type: 'turn', state: 'completed', startedBy: 'the-provider' },
      idle,
    ]
    const joined: TranscriptEvent[] = [
      assigned,
      aTurnOpens,
      working,
      turnEnds,
      idle,
      { type: 'provider_turn' },
      working,
      {
        type: 'user_turn',
        text: 'and also this',
        attribution: 'app_authored',
        relayedFrom: 'sess_ayo',
        says: 'note',
      },
      { type: 'turn', state: 'completed', startedBy: 'the-provider' },
      idle,
    ]
    const once = theTask(joined)
    expect(once).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
    const twice = theTask([...joined, ...aWake])
    expect(twice).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
    expect(twice.stalledAt).toBeGreaterThan(once.stalledAt ?? Number.POSITIVE_INFINITY)
  })

  it('🔴 F080 · a person’s stop names the wake it cut, and never the next wake that ends by itself (484)', () => {
    const aWake: TranscriptEvent[] = [{ type: 'provider_turn' }, working]
    const stoppedByAPerson: TranscriptEvent[] = [
      assigned,
      aTurnOpens,
      working,
      turnEnds,
      idle,
      ...aWake,
      { type: 'work_interrupted', by: 'a-person' },
      { type: 'turn', state: 'interrupted', wordOf: 'this-app', startedBy: 'the-provider' },
      idle,
    ]
    expect(theTask(stoppedByAPerson)).toMatchObject({
      stalledBecause: 'turn_interrupted',
      stalledBy: { by: 'a-person' },
    })
    const next = theTask([
      ...stoppedByAPerson,
      ...aWake,
      { type: 'turn', state: 'completed', startedBy: 'the-provider' },
      idle,
    ])
    expect(next).toMatchObject({ stalledBecause: 'turn_ended', stalledBy: null })
  })

  it('🔴 a command that died with the process is never said to be in the background', () => {
    const untilItsTurnEnds: TranscriptEvent[] = [
      assigned,
      aTurnOpens,
      working,
      running({ id: 'bg_1', description: 'sleep 40' }),
      turnEnds,
      idle,
    ]
    const held = theTask(untilItsTurnEnds)
    expect(held.state).toBe('working')
    expect(held.inTheBackground).toEqual(['sleep 40'])

    const afterTheStop = theTask([...untilItsTurnEnds, stopped])
    expect(afterTheStop.state).toBe('stalled')
    expect(afterTheStop.stalledBecause).toBe('background_stopped')
    expect(afterTheStop.stoppedInTheBackground).toEqual(['sleep 40'])
    expect(afterTheStop.inTheBackground).toBeUndefined()
  })

  it('🔴 a schedule survives a stop and still holds the piece it was waking', () => {
    const scheduledTurn: TranscriptEvent[] = [
      assigned,
      aTurnOpens,
      working,
      jobs({ id: 'c1', schedule: '*/5 * * * *' }),
      turnEnds,
      idle,
    ]
    const survives = theTask([...scheduledTurn, stopped])
    expect(survives.state).toBe('working')
    expect(survives.inTheBackground).toEqual(['a scheduled wake-up (*/5 * * * *)'])

    const command = theTask([
      assigned,
      aTurnOpens,
      working,
      running({ id: 'bg_1', description: 'sleep 40' }),
      turnEnds,
      idle,
      stopped,
    ])
    expect(command.state).toBe('stalled')
    expect(command.inTheBackground).toBeUndefined()
  })

  it('🔴 a stop that cuts an open turn nobody had marked working still ends it as an interrupted turn', () => {
    const premise = theTask([assigned, aTurnOpens])
    expect(premise).toMatchObject({ state: 'working', stalledBecause: null })
    const cut = theTask([assigned, aTurnOpens, stopped])
    expect(cut.state).toBe('stalled')
    expect(cut.stalledBecause).toBe('turn_interrupted')

    const nothingToCut = theTask([assigned, stopped])
    expect(nothingToCut.state).toBe('working')
    expect(nothingToCut.stalledBecause).toBeNull()
  })
})

const traceFixturePhase = <T>(phase: string, operation: () => T): T => {
  const began = performance.now()
  const emit = (event: string, outcome?: string): void => {
    console.log(
      JSON.stringify({
        fixture: 'stop-fixture',
        phase,
        event,
        outcome,
        atMs: performance.now(),
        elapsedMs: performance.now() - began,
      }),
    )
  }
  emit('begin')
  try {
    const value = operation()
    if (value instanceof Promise) {
      void value.then(
        () => {
          emit('end', 'fulfilled')
        },
        () => {
          emit('end', 'rejected')
        },
      )
      return value
    }
    emit('end', 'returned')
    return value
  } catch (error) {
    emit('end', 'threw')
    throw error
  }
}

let launchTraceId = 0

interface Launch {
  readonly toolset: AgentToolset | undefined
  readonly handle: SessionHandle
  readonly failTheStream: () => void
  readonly letCloseFinish: () => void
  readonly closeReleased: boolean
  readonly closeStarted: boolean
  readonly closeFinished: boolean
}

interface ResumeHold {
  held: Promise<void> | null
  entered: number
}

function withLevers(
  handle: SessionHandle,
  toolset: AgentToolset | undefined,
  traceId: number,
): Launch {
  let failTheStream!: () => void
  let letCloseFinish!: () => void
  let closeReleased = false
  let closeStarted = false
  let closeFinished = false
  const failed = new Promise<IteratorResult<RuntimeEvent>>((_resolve, reject) => {
    failTheStream = () => reject(new Error('the stream failed under the host'))
  })
  failed.catch(() => undefined)
  const closeMayFinish = new Promise<void>((resolve) => {
    letCloseFinish = () =>
      traceFixturePhase(`fake-release-${traceId}`, () => {
        closeReleased = true
        resolve()
      })
  })
  const proxied = new Proxy(handle, {
    get(target, property) {
      if (property === 'events') {
        return (): AsyncIterable<RuntimeEvent> => ({
          [Symbol.asyncIterator]() {
            const inner = target.events()[Symbol.asyncIterator]()
            return {
              next: () => Promise.race([inner.next(), failed]),
              return: async (): Promise<IteratorResult<RuntimeEvent>> => {
                await inner.return?.()
                return { done: true, value: undefined }
              },
            }
          },
        })
      }
      if (property === 'close') {
        return (): Promise<void> =>
          traceFixturePhase(`fake-close-${traceId}`, async () => {
            closeStarted = true
            await closeMayFinish
            await target.close()
            closeFinished = true
          })
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
  return {
    toolset,
    handle: proxied,
    failTheStream,
    letCloseFinish,
    get closeReleased() {
      return closeReleased
    },
    get closeStarted() {
      return closeStarted
    },
    get closeFinished() {
      return closeFinished
    },
  }
}

class LeveredRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly launches: Launch[],
    sessions: FakeProviderSessions,
    private readonly resumeHold: ResumeHold,
  ) {
    super(provider, { sessions })
  }
  override async start(options: Parameters<FakeRuntime['start']>[0]) {
    const traceId = ++launchTraceId
    const handle = await traceFixturePhase(`fake-start-${traceId}`, () => super.start(options))
    const launch = withLevers(handle, options.agentTools, traceId)
    this.launches.push(launch)
    return launch.handle as Awaited<ReturnType<FakeRuntime['start']>>
  }
  override async resume(ref: SessionRef, options: ResumeOptions) {
    this.resumeHold.entered++
    if (this.resumeHold.held !== null) await this.resumeHold.held
    return super.resume(ref, options)
  }
}

describe('§3 · the host — a stop changes nothing about a piece or about the caller', () => {
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let userData: string
  let root: string
  let counter: number
  let clock: number
  let window: RecordingSink
  let launches: Launch[]
  let resumeHold: ResumeHold
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d016c-stop-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d016c-stop-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    store = createSessionStore(db, tick)
    counter = 0
    launches = []
    launchTraceId = 0
    resumeHold = { held: null, entered: 0 }
    const sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) =>
        new LeveredRuntime(provider, launches, sessions, resumeHold),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    traceFixturePhase('release-owned-fakes', () => {
      for (const launch of launches) launch.letCloseFinish()
    })
    await traceFixturePhase('host-close', () => host.closeAll())
    traceFixturePhase('database-close', () => db.close())
    traceFixturePhase('remove-fixture-directories', () => {
      for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
    })
  })

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }
  const callOn = async (
    toolset: AgentToolset | undefined,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset?.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }
  const listSaysClosing = (id: string): boolean =>
    host.sessionIds.includes(id) &&
    host.resumableSessions().find((one) => one.sessionId === id)?.running === 'not-running'
  const failAndHold = async (id: string, launch: Launch): Promise<void> => {
    launch.failTheStream()
    await waitFor(() => listSaysClosing(id), 'the pump to reach finalize()')
  }
  const turnsIn = (sessionId: string): number =>
    store.events(sessionId).filter((entry) => entry.event.type === 'turn').length

  const stalledOf = (sessionId: string): { label: string; because: string | null }[] =>
    store.openPiecesOf(sessionId).map((one) => ({ label: one.label, because: one.stalledBecause }))

  const aPmAndItsWorker = async (
    approvalMode: 'auto' | 'ask' = 'auto',
  ): Promise<{ pm: string; pmLaunch: Launch; worker: string; workerLaunch: Launch }> => {
    const first = await host.createSession(
      { provider: 'claude', profileId: 'worker', approvalMode: 'auto', cwd: root },
      window,
    )
    launches.at(-1)!.letCloseFinish()
    await host.close(first.sessionId, window)
    const { sessionId: pm } = await host.createSession(
      { provider: 'claude', profileId: 'pm', approvalMode, cwd: root },
      window,
    )
    const pmLaunch = launches.at(-1)!
    const given = await callOn(pmLaunch.toolset, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work',
      brief: 'the work',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerLaunch = launches.at(-1)!
    if (approvalMode === 'auto') {
      await waitFor(() => turnsIn(worker) > 0, 'the brief’s turn to end')
    }
    return { pm, pmLaunch, worker, workerLaunch }
  }

  const aPmWithAGrant = async (): Promise<{ pm: string; pmLaunch: Launch }> => {
    const first = await host.createSession(
      { provider: 'claude', profileId: 'worker', approvalMode: 'auto', cwd: root },
      window,
    )
    launches.at(-1)!.letCloseFinish()
    await host.close(first.sessionId, window)
    return anotherPm()
  }

  it('the identity seed closes and drains while only the subject worker stays held', async () => {
    const warnings = vi.spyOn(console, 'warn')
    const preparing = aPmAndItsWorker('ask')
    let closing: Promise<unknown> | undefined
    try {
      await waitFor(() => launches[0]?.closeStarted === true, 'the identity seed close to start')
      const seed = launches[0]!
      expect(seed.closeReleased).toBe(true)
      const { pm, pmLaunch, worker, workerLaunch } = await preparing
      expect(seed.closeFinished).toBe(true)
      expect(host.sessionIds).not.toContain('sess_1')
      expect(launches).toHaveLength(3)
      expect(pm).not.toBe('sess_1')
      expect(worker).not.toBe('sess_1')
      expect(worker).not.toBe(pm)
      expect(seed).not.toBe(pmLaunch)
      expect(seed).not.toBe(workerLaunch)
      expect(
        warnings.mock.calls
          .flat()
          .map(String)
          .filter((line) => line.includes('sess_1') && /did not (?:confirm stop|drain)/.test(line)),
      ).toEqual([])

      host.claimSession(worker, window)
      let settled = false
      closing = host.close(worker, window)
      void closing.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      await waitFor(() => workerLaunch.closeStarted, 'the subject worker close to start')
      expect(workerLaunch.closeReleased).toBe(false)
      expect(workerLaunch.closeFinished).toBe(false)
      expect(settled).toBe(false)
      expect(listSaysClosing(worker)).toBe(true)
      workerLaunch.letCloseFinish()
      await closing
      expect(workerLaunch.closeFinished).toBe(true)
      expect(settled).toBe(true)
    } finally {
      try {
        for (const launch of launches) launch.letCloseFinish()
        await preparing
        for (const launch of launches) launch.letCloseFinish()
        await closing
      } finally {
        warnings.mockRestore()
      }
    }
  })

  it('phase evidence does not call a held or rejected operation completed', async () => {
    const rows: { phase: string; event: string; outcome?: string }[] = []
    const output = vi.spyOn(console, 'log').mockImplementation((message: unknown) => {
      if (typeof message === 'string' && message.startsWith('{"fixture":"stop-fixture"')) {
        rows.push(JSON.parse(message))
      }
    })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = traceFixturePhase('pending-control', () => held)
    try {
      expect(pending).toBe(held)
      expect(rows.filter((row) => row.phase === 'pending-control').map((row) => row.event)).toEqual(
        ['begin'],
      )
      const failure = new Error('fictional close rejected')
      const rejected = Promise.reject(failure)
      const observed = traceFixturePhase('rejection-control', () => rejected)
      expect(observed).toBe(rejected)
      await expect(observed).rejects.toBe(failure)
      expect(
        rows.filter((row) => row.phase === 'rejection-control').map((row) => row.outcome),
      ).toEqual([undefined, 'rejected'])
      expect(() =>
        traceFixturePhase('throw-control', () => {
          throw failure
        }),
      ).toThrow(failure)
      expect(rows.filter((row) => row.phase === 'throw-control').map((row) => row.outcome)).toEqual(
        [undefined, 'threw'],
      )
      release()
      await pending
      expect(
        rows.filter((row) => row.phase === 'pending-control').map((row) => row.outcome),
      ).toEqual([undefined, 'fulfilled'])
    } finally {
      release()
      await pending
      output.mockRestore()
    }
  })
  it.each(['grant', 'other identity'] as const)(
    'the additional identity seed for %s closes while the subject worker remains held',
    async (kind) => {
      const { worker, workerLaunch } = await aPmAndItsWorker('ask')
      host.claimSession(worker, window)
      let settled = false
      const closing = host.close(worker, window)
      void closing.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      let preparing: Promise<unknown> | undefined
      try {
        await waitFor(() => workerLaunch.closeStarted, 'the unrelated subject close to start')
        const before = launches.length
        const seedSessionId = `sess_${counter + 1}`
        preparing = kind === 'grant' ? aPmWithAGrant() : bringIdentityIntoBeing('other')
        await waitFor(
          () => launches[before]?.closeStarted === true,
          'the additional seed close to start',
        )
        const seed = launches[before]!
        expect(seed).not.toBe(workerLaunch)
        expect(seed.closeReleased).toBe(true)
        await preparing
        expect(seed.closeFinished).toBe(true)
        expect(host.sessionIds).not.toContain(seedSessionId)
        expect(host.sessionIds).toContain(worker)
        expect(launches).toHaveLength(before + (kind === 'grant' ? 2 : 1))
        if (kind === 'grant') expect(launches[before + 1]!.closeReleased).toBe(false)
        expect(workerLaunch.closeReleased).toBe(false)
        expect(workerLaunch.closeFinished).toBe(false)
        expect(settled).toBe(false)
        expect(listSaysClosing(worker)).toBe(true)
        workerLaunch.letCloseFinish()
        await closing
        expect(workerLaunch.closeFinished).toBe(true)
      } finally {
        for (const launch of launches) launch.letCloseFinish()
        await preparing
        for (const launch of launches) launch.letCloseFinish()
        await closing
      }
    },
  )

  const anotherPm = async (): Promise<{ pm: string; pmLaunch: Launch }> => {
    const { sessionId: pm } = await host.createSession(
      { provider: 'claude', profileId: 'pm', approvalMode: 'auto', cwd: root },
      window,
    )
    return { pm, pmLaunch: launches.at(-1)! }
  }

  const namesTheStalledPiece = (answer: Record<string, unknown>, labels: string[]): void => {
    expect(answer.outcome, JSON.stringify(answer)).toBe('ok')
    expect(answer.stalled).toEqual(labels)
  }
  const theGive = (pmLaunch: Launch, profile = 'worker') =>
    callOn(pmLaunch.toolset, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title: 'More',
      brief: 'more',
    })

  describe('a stalled piece is named to a give whatever its holder’s process is doing', () => {
    it('a give to a holder whose Close is under way waits, then names the unchanged stalled piece', async () => {
      const { pmLaunch, worker, workerLaunch } = await aPmAndItsWorker('auto')
      const [piece] = stalledOf(worker)
      expect(piece).toMatchObject({ because: 'turn_ended' })
      const label = piece!.label
      const launched = launches.length

      host.claimSession(worker, window)
      const closing = host.close(worker, window)
      let giving: Promise<Record<string, unknown>> | undefined
      try {
        await waitFor(() => listSaysClosing(worker), 'the worker’s Close to be under way')
        expect(stalledOf(worker)).toEqual([{ label, because: 'turn_ended' }])

        giving = theGive(pmLaunch)
        let settled = false
        void giving.then(
          () => {
            settled = true
          },
          () => {
            settled = true
          },
        )
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(settled).toBe(false)
        expect(launches.length).toBe(launched)
        expect(stalledOf(worker)).toEqual([{ label, because: 'turn_ended' }])

        await bringIdentityIntoBeing('other')
        const launchedBeforeOther = launches.length
        const other = await theGive(pmLaunch, 'other')
        expect(other.outcome, JSON.stringify(other)).toBe('ok')
        expect(launches.length).toBe(launchedBeforeOther + 1)
      } finally {
        workerLaunch.letCloseFinish()
        await closing
      }

      expect(stalledOf(worker)).toEqual([{ label, because: 'turn_ended' }])
      expect(giving).toBeDefined()
      namesTheStalledPiece(await giving!, [label])
    })

    const aGiveDuringAHeldReopen = async (
      during?: (pmLaunch: Launch, label: string) => Promise<void>,
    ): Promise<{
      answer: Record<string, unknown>
      label: string
      worker: string
      pmLaunch: Launch
    }> => {
      const { pmLaunch, worker, workerLaunch } = await aPmAndItsWorker('auto')
      const [piece] = stalledOf(worker)
      expect(piece).toMatchObject({ because: 'turn_ended' })
      const label = piece!.label
      workerLaunch.letCloseFinish()
      host.claimSession(worker, window)
      await host.close(worker, window)
      await waitFor(() => !host.sessionIds.includes(worker), 'the worker to be stopped')

      let release!: () => void
      resumeHold.held = new Promise<void>((resolve) => {
        release = resolve
      })
      const before = resumeHold.entered
      const reopening = host.resumeSession(worker, window)
      let giving: Promise<Record<string, unknown>> | undefined
      try {
        await waitFor(() => resumeHold.entered === before + 1, 'the resume to reach the provider')
        const launched = launches.length
        giving = theGive(pmLaunch)
        let settled = false
        void giving.then(() => {
          settled = true
        })
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(settled).toBe(false)
        expect(launches.length).toBe(launched)
        if (during !== undefined) await during(pmLaunch, label)
      } finally {
        release()
      }
      await reopening
      return { answer: (await giving) ?? {}, label, worker, pmLaunch }
    }

    it('🔴 a give made while its holder is being reopened waits for the reopen, then reaches the same conversation and names its stalled piece', async () => {
      const { answer, label, worker } = await aGiveDuringAHeldReopen()
      namesTheStalledPiece(answer, [label])
      expect(answer.agent).toBe(worker)
      expect(stalledOf(worker)).toContainEqual({ label, because: 'turn_ended' })
    })

    it('⛔ …and a piece its giver parked while the give was on its way is not named: the answer is read when it is formed', async () => {
      const { answer, worker } = await aGiveDuringAHeldReopen(async (pmLaunch, label) => {
        const parked = await callOn(pmLaunch.toolset, 'update_work', {
          piece: label,
          status: 'until the review lands',
          on: { time: new Date(clock + 3_600_000).toISOString() },
        })
        expect(parked.outcome, JSON.stringify(parked)).toBe('ok')
      })
      expect(answer.outcome, JSON.stringify(answer)).toBe('ok')
      expect(answer.agent).toBe(worker)
      expect(answer).not.toHaveProperty('stalled')
    })

    it('⛔ …and a piece its giver takes back is not named once it has ended: during the reopen the take-back waits for the start, and the next give leaves the piece out', async () => {
      let tookBackDuring: Record<string, unknown> = {}
      const { answer, label, pmLaunch } = await aGiveDuringAHeldReopen(async (launch, piece) => {
        tookBackDuring = await callOn(launch.toolset, 'withdraw_task', { piece })
      })
      expect(tookBackDuring.rail, JSON.stringify(tookBackDuring)).toBe(
        'that-conversation-has-not-started',
      )
      expect(tookBackDuring.retryable).toBe(true)
      namesTheStalledPiece(answer, [label])
      const tookBack = await callOn(pmLaunch.toolset, 'withdraw_task', { piece: label })
      expect(tookBack.outcome, JSON.stringify(tookBack)).toBe('ok')
      const after = await theGive(pmLaunch)
      expect(after.outcome, JSON.stringify(after)).toBe('ok')
      expect((after.stalled as string[] | undefined) ?? []).not.toContain(label)
    })

    it('🔴 a holder whose turn a Close cut is named to a give, on the stall its turn was stopped with', async () => {
      const { pmLaunch, worker, workerLaunch } = await aPmAndItsWorker('ask')
      await waitFor(
        () => workerLaunch.handle.status() === 'waiting_permission',
        'the worker to park on a card',
      )
      workerLaunch.letCloseFinish()
      host.claimSession(worker, window)
      await host.close(worker, window)

      const [piece] = stalledOf(worker)
      expect(piece).toMatchObject({ because: 'turn_interrupted' })

      const given = await theGive(pmLaunch)
      namesTheStalledPiece(given, [piece!.label])
      expect(given.agent).toBe(worker)
    })
  })

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    launches.at(-1)!.letCloseFinish()
    await host.close(sessionId, window)
  }

  describe('a conversation whose process is stopping is still the caller', () => {
    const bothCallsFrom = async (
      pmLaunch: Launch,
      slug: string,
    ): Promise<{ created: Record<string, unknown>; proposed: Record<string, unknown> }> => ({
      created: await callOn(pmLaunch.toolset, 'create_agent', { profile_slug: slug }),
      proposed: await callOn(pmLaunch.toolset, 'propose_agent_rules', {
        agent: 'worker',
        current_version: 0,
        rules: 'Keep the changelog current.',
        why: 'The work needs it.',
      }),
    })
    const proposalsBy = (sessionId: string) =>
      store
        .events(sessionId)
        .filter((entry) => entry.event.type === 'instruction_proposed')
        .map((entry) => entry.event)

    it('🔴 a caller whose process is stopping is still the caller: create_agent and propose_agent_rules get their normal answers', async () => {
      const { pm: running, pmLaunch: runningLaunch } = await aPmWithAGrant()
      expect(
        store.setCapabilities('pm', { canWriteRules: 'propose', canCreateAgents: 'any' }),
      ).toBe(true)

      const fromRunning = await bothCallsFrom(runningLaunch, 'helper-running')
      expect(fromRunning.created.outcome, JSON.stringify(fromRunning.created)).toBe('ok')
      expect(fromRunning.proposed).toMatchObject({ outcome: 'ok', wrote: 'a-request' })
      expect(proposalsBy(running)).toHaveLength(1)

      const closingPm = await anotherPm()
      const closing = host.close(closingPm.pm, window)
      try {
        await waitFor(() => listSaysClosing(closingPm.pm), 'the pm’s Close to be under way')
        const answered = await bothCallsFrom(closingPm.pmLaunch, 'helper-closing')
        expect(answered.created.outcome, JSON.stringify(answered.created)).toBe('ok')
        expect(answered.proposed, JSON.stringify(answered.proposed)).toMatchObject({
          outcome: 'ok',
          wrote: 'a-request',
        })
        expect(answered.proposed.request).toBeDefined()
        expect(proposalsBy(closingPm.pm)).toEqual([
          expect.objectContaining({
            type: 'instruction_proposed',
            ask: 'propose',
            about: 'worker',
          }),
        ])
        expect(listSaysClosing(closingPm.pm)).toBe(true)
      } finally {
        closingPm.pmLaunch.letCloseFinish()
        await closing
      }

      const failedPm = await anotherPm()
      await failAndHold(failedPm.pm, failedPm.pmLaunch)
      try {
        const answered = await bothCallsFrom(failedPm.pmLaunch, 'helper-failed')
        expect(answered.created.outcome, JSON.stringify(answered.created)).toBe('ok')
        expect(answered.proposed, JSON.stringify(answered.proposed)).toMatchObject({
          outcome: 'ok',
          wrote: 'a-request',
        })
        expect(proposalsBy(failedPm.pm)).toHaveLength(1)
        expect(listSaysClosing(failedPm.pm)).toBe(true)
      } finally {
        failedPm.pmLaunch.letCloseFinish()
      }

      const nobody = agentToolsFor(host, 'sess_nobody')
      const refused = await callOn(nobody, 'create_agent', { profile_slug: 'helper-nobody' })
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('may-not-create-agents')
      expect((refused.detail as { you: unknown }).you).toBeNull()

      const fromTheApp = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'worker',
          title: 'x',
          brief: 'x',
        },
        THE_APP_ITSELF,
      )
      expect(fromTheApp.ok).toBe(false)
      if (fromTheApp.ok) throw new Error('unreachable')
      expect(fromTheApp.refusal.rail).toBe('no-piece-to-give-from')
    })
  })
})
