import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { LimitsReadEngine } from '../src/main/db/limits-read-engine'
import { LimitsReaderLifetime, type LimitsReader } from '../src/main/db/limits-reader-lifetime'
import type { LimitsReadInput, LimitsReadResult } from '../src/main/db/limits-read-protocol'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import { CurrentProviderLimitFacts } from '../src/main/runtime/current-provider-limit-facts'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import type {
  RuntimeEventMessage,
  RuntimeStatesMessage,
  SessionLivenessMessage,
} from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

const AT = Date.UTC(2026, 9, 8, 21)
const RESET = AT + 3 * 60 * 60_000
const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const drain = async () => {
  for (let n = 0; n < 12; n++) await new Promise<void>((done) => setImmediate(done))
}

class ControlledReader implements LimitsReader {
  pending: { input: LimitsReadInput; finish: (result: LimitsReadResult) => void } | null = null
  readonly calls: LimitsReadInput[] = []
  readonly whenExited: Promise<void>
  private exit!: () => void
  private stopped = false
  constructor(private readonly engine: LimitsReadEngine) {
    this.whenExited = new Promise<void>((done) => {
      this.exit = done
    })
  }
  execute(input: LimitsReadInput): Promise<LimitsReadResult> {
    if (this.pending !== null) throw new Error('fictional reader overlapped native demand')
    this.calls.push(input)
    return new Promise((finish) => {
      this.pending = { input, finish }
    })
  }
  snapshot(): LimitsReadResult {
    if (this.pending === null) throw new Error('fictional reader was not selected')
    return this.engine.read(this.pending.input)
  }
  finish(
    afterSnapshot: () => void = () => {},
    coverage?: 'partial',
    captured?: LimitsReadResult,
  ): LimitsReadResult {
    const pending = this.pending
    if (pending === null) throw new Error('fictional reader was not selected')
    this.pending = null
    const result = captured ?? this.engine.read(pending.input)
    if (result.operation !== pending.input.operation)
      throw new Error('the captured snapshot belongs to another operation')
    afterSnapshot()
    pending.finish(
      coverage === 'partial'
        ? { ...result, canonical: { ...result.canonical, rowsUnread: 1 } }
        : result,
    )
    return result
  }
  stop(): Promise<void> {
    if (!this.stopped) {
      this.stopped = true
      this.engine.close()
      this.exit()
    }
    return this.whenExited
  }
}

describe('canonical history withdrawal and current preparation are distinct host effects', () => {
  let directory: string
  let file: string
  let db: AppDatabase
  let store: SessionStore
  let reader: ControlledReader
  let host: RuntimeHost
  let clock: number
  let handles: FakeSessionHandle[]
  let events: RuntimeEventMessage[]
  let states: RuntimeStatesMessage[]
  let lives: SessionLivenessMessage[]
  let window: RuntimeEventSink
  let other: Database.Database | null
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'brobot-fictional-history-host-'))
    file = join(directory, 'fictional.sqlite')
    db = openDatabase(file)
    applyMigrations(db, migrations)
    clock = AT
    store = createSessionStore(db, () => clock)
    store.create({
      id: 'unrelated',
      provider: 'codex',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'fictional',
    })
    store.create({
      id: 'external-clear-owner',
      provider: 'claude',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'fictional',
    })
    reader = new ControlledReader(new LimitsReadEngine(file, () => ++clock))
    handles = []
    events = []
    states = []
    lives = []
    other = null
    const sessions = new FakeProviderSessions()
    window = {
      ownerId: sinkOwnerId({ id: 921 }),
      alive: true,
      aPersonIsBehindIt: true,
      send: (message) => events.push(message),
      sendLiveness: (message) => lives.push(message),
    }
    host = new RuntimeHost({
      store,
      limitsReader: new LimitsReaderLifetime(file, () => reader),
      limitsWriterStamp: limitsWriterSampler(
        db,
        () => store.canReadFreshSnapshot?.() === true,
        () => ++clock,
      ),
      discoverSessions: NO_DISCOVERY,
      now: () => clock,
      idleStopAfterMs: 4 * 60 * 60_000,
      createRuntime: (provider) => new ProviderDouble(provider, handles, sessions, anOpenGate()),
      newSessionId: () => 'fictional-stopped',
      statesMoved: (message) => states.push(message),
      resolveCwd: () => directory,
      nativeTranscriptPath: () => null,
      exportDirectory: () => directory,
      prepareProviderHome: () => {
        const home = join(directory, 'home')
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: () => join(directory, 'home'),
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'fictional',
        authNote: null,
        files: [],
      }),
    })
  })
  afterEach(async () => {
    await host.closeAll()
    other?.close()
    db.close()
    vi.restoreAllMocks()
    vi.useRealTimers()
    rmSync(directory, { recursive: true, force: true })
  })
  async function finishDemands(afterSnapshot: () => void = () => {}) {
    await drain()
    for (let n = 0; n < 4 && reader.pending !== null; n++) {
      reader.finish(afterSnapshot)
      await drain()
    }
    expect(reader.pending).toBeNull()
  }
  async function stopped(reset: number | null = RESET) {
    const created = await host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: directory },
      window,
    )
    await drain()
    const handle = handles[0]
    if (handle === undefined) throw new Error('own provider handle not registered')
    clock++
    handle.simulateError(
      `claude is rate-limited (five_hour)${reset === null ? '' : `; resets ${new Date(reset).toISOString()}`}`,
      false,
    )
    await drain()
    expect(events.some((row) => row.event.type === 'error')).toBe(true)
    const request = host.readLimitsDisplay()
    await finishDemands()
    expect(await request).toMatchObject({ is: 'read' })
    const latest = () => lives.filter((row) => row.sessionId === created.sessionId).at(-1)?.liveness
    expect(latest()).toMatchObject({
      providerBlockStatus: 'current',
      providerBlock: { provider: 'claude', resetsAt: reset },
    })
    const boundary = host as unknown as {
      providerLimitFacts: CurrentProviderLimitFacts
      providerLimitLives: Map<string, { life: object }>
    }
    const life = boundary.providerLimitLives.get(created.sessionId)?.life
    if (life === undefined) throw new Error('own provider life not recorded')
    const history = () =>
      boundary.providerLimitFacts.lastKnown(created.sessionId, life, 'claude', false, clock)
    expect(history()).toMatchObject({ provider: 'claude', resetsAt: reset })
    return { id: created.sessionId, handle, latest, boundary, history }
  }

  it('an external clear plus unrelated writer append withdraws history, but publishes no current clear or gate update', async () => {
    const { id, handle, latest, boundary, history } = await stopped()
    const original = history()
    clock = AT + 60_000
    handle.simulateError('fictional transient diagnostic', false)
    await drain()
    expect(latest()).toMatchObject({ providerBlockStatus: 'unavailable' })
    expect(history()).toEqual(original)
    expect(latest()?.providerBlockLastKnown).toEqual(original)
    const gate = boundary.providerLimitFacts.hold('claude', false, clock)
    clock = AT + 120_000
    other = new Database(file)
    other
      .prepare(
        'INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(
        'fictional-external-clear',
        'external-clear-owner',
        0,
        0,
        'provider_limit_clear',
        JSON.stringify({
          type: 'provider_limit_clear',
          window: 'five_hour',
          source: 'rate_limit_event',
        }),
        clock,
      )
    const prepare = vi.spyOn(boundary.providerLimitFacts, 'prepare')
    const request = host.readLimitsDisplay()
    await finishDemands(() =>
      store.append(
        'unrelated',
        store.nextOrdinal('unrelated'),
        { type: 'assistant_delta', text: 'unrelated fictional append' },
        clock,
      ),
    )
    const answer = await request
    expect(answer).toMatchObject({ is: 'read', reading: { walked: { rows: [], rowsUnread: 0 } } })
    expect(prepare).not.toHaveBeenCalled()
    expect(history()).toBeNull()
    expect(latest()).toMatchObject({ providerBlockStatus: 'unavailable' })
    expect(latest()).not.toHaveProperty('providerBlock')
    expect(latest()?.providerBlockLastKnown).toBeNull()
    expect(boundary.providerLimitFacts.hold('claude', false, clock)).toEqual(gate)
    expect(
      states
        .flatMap((message) => message.moved)
        .filter((row) => row.conversation === id)
        .at(-1),
    ).toMatchObject({ providerBlockStatus: 'unavailable', providerBlockLastKnown: null })
  })

  it('a complete still-supporting read refuses promotion under appends without renewing history', async () => {
    const { handle, latest, boundary, history } = await stopped()
    const original = history()
    clock = AT + 60_000
    handle.simulateError('fictional transient diagnostic', false)
    await drain()
    const prepare = vi.spyOn(boundary.providerLimitFacts, 'prepare')
    const request = host.readLimitsDisplay()
    await finishDemands(() =>
      store.append(
        'unrelated',
        store.nextOrdinal('unrelated'),
        { type: 'assistant_delta', text: 'unrelated fictional append' },
        clock,
      ),
    )
    expect(await request).toMatchObject({ is: 'read' })
    expect(prepare).not.toHaveBeenCalled()
    expect(history()).toEqual(original)
    expect(latest()).toMatchObject({
      providerBlockStatus: 'unavailable',
      providerBlockLastKnown: original,
    })
  })

  it.each([RESET, null])(
    'retained history retires through a timer after a refused read (%s)',
    async (reset) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
      const { id, handle, latest, boundary, history } = await stopped(reset)
      const original = history()
      if (original === null) throw new Error('the own stop was not confirmed')
      const deadline = reset ?? original.asOf + 5 * 60_000
      clock += 10
      handle.simulateError('fictional transient diagnostic', false)
      await drain()
      const request = host.readLimitsDisplay()
      await finishDemands(() =>
        store.append(
          'unrelated',
          store.nextOrdinal('unrelated'),
          { type: 'assistant_delta', text: 'fictional overlapping write' },
          clock,
        ),
      )
      expect(await request).toMatchObject({ is: 'read' })
      expect(latest()).toMatchObject({
        providerBlockStatus: 'unavailable',
        providerBlockLastKnown: original,
      })
      const gate = boundary.providerLimitFacts.hold('claude', false, clock)
      const reads = reader.calls.length
      const before = clock
      clock = deadline - 1
      await vi.advanceTimersByTimeAsync(deadline - before - 1)
      await drain()
      expect(history()).toEqual(original)
      expect(latest()?.providerBlockLastKnown).toEqual(original)
      clock = deadline
      await vi.advanceTimersByTimeAsync(101)
      await drain()
      expect(reader.calls).toHaveLength(reads)
      expect(latest()).toMatchObject({
        providerBlockStatus: 'unavailable',
        providerBlockLastKnown: null,
      })
      expect(latest()).not.toHaveProperty('providerBlock')
      expect(boundary.providerLimitFacts.hold('claude', false, clock)).toEqual(gate)
      expect(
        states
          .flatMap((message) => message.moved)
          .filter((row) => row.conversation === id)
          .at(-1),
      ).toMatchObject({ providerBlockStatus: 'unavailable', providerBlockLastKnown: null })
    },
  )

  it('a provider conversation reset retires the old episode and explicitly publishes null history', async () => {
    const { id, handle, latest, boundary, history } = await stopped()
    const gate = boundary.providerLimitFacts.hold('claude', false, clock)
    const reads = reader.calls.length
    clock++
    handle.simulateConversationReset('fictional-new-provider-conversation')
    await drain()
    expect(history()).toBeNull()
    expect(reader.calls).toHaveLength(reads)
    expect(latest()).toMatchObject({
      providerBlockStatus: 'current',
      providerBlock: null,
      providerBlockLastKnown: null,
    })
    expect(latest()?.providerBlock).toBeNull()
    expect(
      states
        .flatMap((message) => message.moved)
        .filter((row) => row.conversation === id)
        .at(-1),
    ).toMatchObject({
      providerBlockStatus: 'current',
      providerBlock: null,
      providerBlockLastKnown: null,
    })
    expect(boundary.providerLimitFacts.hold('claude', false, clock)).toEqual(gate)
  })

  it('a selected pre-reset snapshot cannot revive the retired episode or its history', async () => {
    const { handle, latest, boundary, history } = await stopped()
    const gate = boundary.providerLimitFacts.hold('claude', false, clock)
    const request = host.readLimitsDisplay()
    await drain()
    const captured = reader.snapshot()
    expect(captured.canonical.rows).toHaveLength(1)
    expect(captured.canonical.rows[0]).toMatchObject({ standing: 'stopped' })
    clock++
    handle.simulateConversationReset('fictional-reset-while-native-result-is-pending')
    await drain()
    expect(history()).toBeNull()
    const prepare = vi.spyOn(boundary.providerLimitFacts, 'prepare')
    reader.finish(() => {}, undefined, captured)
    await drain()
    expect(await request).toMatchObject({ is: 'read' })
    expect(prepare).not.toHaveBeenCalled()
    expect(latest()).toMatchObject({
      providerBlockStatus: 'current',
      providerBlock: null,
      providerBlockLastKnown: null,
    })
    expect(latest()?.providerBlock).toBeNull()
    expect(history()).toBeNull()
    expect(boundary.providerLimitFacts.hold('claude', false, clock)).toEqual(gate)
  })

  it('a worker exit cannot retire otherwise valid dated history or change the gate', async () => {
    const { handle, latest, boundary, history } = await stopped()
    const original = history()
    clock += 10
    handle.simulateError('fictional transient diagnostic', false)
    await drain()
    const gate = boundary.providerLimitFacts.hold('claude', false, clock)
    expect(latest()).toMatchObject({
      providerBlockStatus: 'unavailable',
      providerBlockLastKnown: original,
    })
    await reader.stop()
    await drain()
    expect(history()).toEqual(original)
    expect(latest()).toMatchObject({
      providerBlockStatus: 'unavailable',
      providerBlockLastKnown: original,
    })
    expect(boundary.providerLimitFacts.hold('claude', false, clock)).toEqual(gate)
  })

  it('the scheduled age boundary cannot be extended by an unsampled backwards wall clock', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const { handle, latest, history } = await stopped(null)
    const original = history()
    if (original === null) throw new Error('the own unknown-reset stop was not confirmed')
    clock += 10
    handle.simulateError('fictional transient diagnostic', false)
    await drain()
    const before = clock
    const deadline = original.asOf + 5 * 60_000
    clock = deadline - 60_000
    await vi.advanceTimersByTimeAsync(deadline - before + 100)
    await drain()
    expect(latest()).toMatchObject({
      providerBlockStatus: 'unavailable',
      providerBlockLastKnown: null,
    })
    expect(latest()).not.toHaveProperty('providerBlock')
    expect(history()).toBeNull()
  })

  it('a backward clock followed by invalidation cannot postpone the original elapsed age boundary', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const { handle, latest, history } = await stopped(null)
    const original = history()
    if (original === null) throw new Error('the own unknown-reset stop was not confirmed')
    const before = clock
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    clock += 60_000
    handle.simulateError('fictional diagnostic after an unsampled backwards jump', false)
    await drain()
    expect(history()).toEqual(original)
    const deadline = original.asOf + 5 * 60_000
    await vi.advanceTimersByTimeAsync(deadline - before - 2 * 60_000 + 100)
    await drain()
    expect(latest()).toMatchObject({
      providerBlockStatus: 'unavailable',
      providerBlockLastKnown: null,
    })
    expect(latest()).not.toHaveProperty('providerBlock')
    expect(history()).toBeNull()
  })

  it('an old expiry plan cannot consume a new confirmed historical value', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const { handle, latest, boundary, history } = await stopped(null)
    const original = history()
    if (original === null) throw new Error('the first own stop was not confirmed')
    const oldPlan = boundary.providerLimitFacts
      .historyExpirations()
      .find((plan) => plan.value === original)
    if (oldPlan === undefined) throw new Error('the first history had no expiry plan')
    const oldTimer = (
      host as unknown as { providerLimitExpiry: ReturnType<typeof setTimeout> | null }
    ).providerLimitExpiry
    const index = timers.mock.results.findIndex((result) => result.value === oldTimer)
    const oldCallback = timers.mock.calls[index]?.[0]
    if (typeof oldCallback !== 'function')
      throw new Error('the old timer callback was not captured')
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    clock += 2 * 60_000
    handle.simulateError('claude is rate-limited (five_hour)', false)
    await drain()
    const request = host.readLimitsDisplay()
    await finishDemands()
    expect(await request).toMatchObject({ is: 'read' })
    const replacement = history()
    expect(replacement).not.toBeNull()
    expect(replacement?.asOf).toBeGreaterThan(original.asOf)
    oldPlan.retire()
    oldCallback()
    expect(history()).toEqual(replacement)
    handle.simulateError('fictional unrelated diagnostic', false)
    await drain()
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    clock += 3 * 60_000
    await drain()
    expect(history()).toEqual(replacement)
    expect(latest()).toMatchObject({
      providerBlockStatus: 'unavailable',
      providerBlockLastKnown: replacement,
    })
  })

  it('a capped timer rechecks without retiring history early or extending its elapsed deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let elapsed = 0
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const longReset = AT + 30 * 24 * 60 * 60_000
    const { handle, latest, history } = await stopped(longReset)
    const original = history()
    if (original === null) throw new Error('the long-reset stop was not confirmed')
    const initial = clock
    handle.simulateError('fictional transient diagnostic', false)
    await drain()
    const boundary = host as unknown as {
      providerLimitExpiry: ReturnType<typeof setTimeout> | null
    }
    const runCurrentTimer = async () => {
      const current = boundary.providerLimitExpiry
      if (current === null) throw new Error('the history expiry timer was not armed')
      const index = timers.mock.results.findIndex((result) => result.value === current)
      const call = timers.mock.calls[index]
      if (call === undefined || typeof call[0] !== 'function' || typeof call[1] !== 'number')
        throw new Error('the actual current timer call was not captured')
      clearTimeout(current)
      elapsed += call[1]
      call[0]()
      await drain()
      return call[1]
    }
    expect(await runCurrentTimer()).toBe(2_147_483_647)
    expect(history()).toEqual(original)
    expect(latest()?.providerBlockLastKnown).toEqual(original)
    clock += 60_000
    handle.simulateError('fictional diagnostic while the capped timer is being rearmed', false)
    await drain()
    expect(await runCurrentTimer()).toBeLessThan(2_147_483_647)
    expect(elapsed).toBe(longReset - initial)
    expect(latest()).toMatchObject({
      providerBlockStatus: 'unavailable',
      providerBlockLastKnown: null,
    })
    expect(latest()).not.toHaveProperty('providerBlock')
    expect(history()).toBeNull()
  })
})
