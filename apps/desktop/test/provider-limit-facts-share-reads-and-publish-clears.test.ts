import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle } from '@brobot2/runtime'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { LimitsReadEngine } from '../src/main/db/limits-read-engine'
import { LimitsReaderLifetime, type LimitsReader } from '../src/main/db/limits-reader-lifetime'
import type { LimitsReadInput, LimitsReadResult } from '../src/main/db/limits-read-protocol'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { resourcesRoot } from '../src/main/resources/resources'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import type {
  RuntimeEventMessage,
  RuntimeStatesMessage,
  SessionLivenessMessage,
} from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

const AT = Date.UTC(2026, 9, 8, 10)
const UNKNOWN = 'claude is rate-limited (five_hour)'
const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class DeferredLimitsReader implements LimitsReader {
  readonly calls: LimitsReadInput[] = []
  readonly whenExited: Promise<void>
  private exit!: () => void
  private pending: { input: LimitsReadInput; resolve: (result: LimitsReadResult) => void } | null =
    null
  constructor(private readonly engine: LimitsReadEngine) {
    this.whenExited = new Promise<void>((done) => {
      this.exit = done
    })
  }
  execute(input: LimitsReadInput): Promise<LimitsReadResult> {
    if (this.pending !== null) throw new Error('The fictional reader overlapped a read')
    this.calls.push(input)
    return new Promise((resolve) => {
      this.pending = { input, resolve }
    })
  }
  finish(): LimitsReadResult {
    if (this.pending === null) throw new Error('No fictional native read was selected')
    const { input, resolve } = this.pending
    this.pending = null
    const result = this.engine.read(input)
    resolve(result)
    return result
  }
  stop(): Promise<void> {
    this.engine.close()
    this.exit()
    return this.whenExited
  }
}

class Watching implements RuntimeEventSink {
  readonly ownerId = sinkOwnerId({ id: 991 })
  readonly aPersonIsBehindIt = true
  readonly alive = true
  readonly events: RuntimeEventMessage[] = []
  readonly lives: SessionLivenessMessage[] = []
  send(message: RuntimeEventMessage): void {
    this.events.push(message)
  }
  sendLiveness(message: SessionLivenessMessage): void {
    this.lives.push(message)
  }
}

async function eventually(ready: () => boolean): Promise<void> {
  for (let n = 0; n < 200; n++) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('fictional host did not publish the expected provider fact')
}

const drain = async (): Promise<void> => {
  for (let n = 0; n < 4; n++) await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('provider facts use existing reads and existing live carriers', () => {
  let directory: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let handles: FakeSessionHandle[]
  let window: Watching
  let states: RuntimeStatesMessage[]
  let serial: number
  let native: DeferredLimitsReader | undefined

  function anotherHost(withReader = false): RuntimeHost {
    const issued = new FakeProviderSessions()
    const file = join(directory, 'ledger.sqlite')
    if (withReader) native = new DeferredLimitsReader(new LimitsReadEngine(file, () => ++clock))
    const selected = native
    return new RuntimeHost({
      store,
      ...(withReader && selected !== undefined
        ? {
            limitsReader: new LimitsReaderLifetime(file, () => selected),
            limitsWriterStamp: limitsWriterSampler(
              db,
              () => {
                const canRead = store.canReadFreshSnapshot
                if (canRead === undefined)
                  throw new Error('The fictional store must expose cursor ownership')
                return canRead.call(store)
              },
              () => ++clock,
            ),
          }
        : {}),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(directory, 'exports'),
      resourcesRoot: () => resourcesRoot(directory),
      createRuntime: (provider) => new ProviderDouble(provider, handles, issued, anOpenGate()),
      prepareProviderHome: (provider, profileId) => {
        const home = join(directory, 'homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider) => join(directory, 'homes', provider),
      resolveCwd: (id, requested) => resolveSessionCwd(directory, id, requested),
      newSessionId: () => `sess_fact_${++serial}`,
      now: () => clock,
      statesMoved: (message) => states.push(message),
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'brobot-limit-facts-'))
    db = openDatabase(join(directory, 'ledger.sqlite'))
    applyMigrations(db, migrations)
    clock = AT
    serial = 0
    native = undefined
    handles = []
    states = []
    window = new Watching()
    store = createSessionStore(db, () => clock)
    host = anotherHost()
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })

  async function live(approvalMode: 'ask' | 'auto' = 'ask') {
    const created = await host.createSession(
      { provider: 'claude', approvalMode, cwd: directory },
      window,
    )
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('provider handle was not registered')
    await eventually(() =>
      window.events.some(
        (row) =>
          row.sessionId === created.sessionId &&
          row.event.type === 'status' &&
          row.event.state === 'idle',
      ),
    )
    await drain()
    return { id: created.sessionId, handle, created }
  }

  const latest = (id: string) => window.lives.filter((row) => row.sessionId === id).at(-1)?.liveness
  const phase = (id: string) =>
    states
      .flatMap((row) => row.moved)
      .filter((row) => row.conversation === id)
      .at(-1)

  it('keeps ordinary idle state after a normal completion and after a restart without a life', async () => {
    const a = await live('auto')
    await host.send(a.id, 'fictional normal turn', window)
    await eventually(() =>
      window.events.some(
        (row) =>
          row.sessionId === a.id && row.event.type === 'turn' && row.event.state === 'completed',
      ),
    )
    await drain()
    expect(latest(a.id)).toMatchObject({ providerBlockStatus: 'current', providerBlock: null })
    expect(phase(a.id)).toMatchObject({
      state: { is: 'idle' },
      providerBlockStatus: 'current',
      providerBlock: null,
    })
    expect(host.resumableSessions().find((row) => row.sessionId === a.id)).toMatchObject({
      state: { is: 'idle' },
      lastEnding: 'completed',
      providerBlockStatus: 'current',
      providerBlock: null,
    })
    await host.closeAll()
    host = anotherHost(true)
    const reads = vi.spyOn(store, 'providerLimitsSeen')
    const recorded = host.resumableSessions().find((row) => row.sessionId === a.id)
    expect(recorded).toMatchObject({
      state: { is: 'idle' },
      providerBlockStatus: 'current',
      providerBlock: null,
    })
    expect(reads).not.toHaveBeenCalled()
    await eventually(() => native?.calls.length === 1)
    native!.finish()
    await drain()
    expect(host.resumableSessions().find((row) => row.sessionId === a.id)).toMatchObject({
      providerBlockStatus: 'current',
      providerBlock: null,
    })
    expect(reads).not.toHaveBeenCalled()
  })

  it('keeps a never-run recorded agent and an unknown provider on their ordinary state', () => {
    store.create({
      id: 'sess_never_ran',
      provider: 'claude',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'default',
    })
    const recorded = host.unresumableSessions().find((row) => row.sessionId === 'sess_never_ran')
    expect(recorded).toMatchObject({
      state: { is: 'idle' },
      running: 'not-running',
      providerBlockStatus: 'current',
      providerBlock: null,
    })
    const boundary = host as unknown as {
      providerBlockDisclosure(id: string): { providerBlockStatus: string; providerBlock: unknown }
    }
    expect(boundary.providerBlockDisclosure('unknown-conversation')).toMatchObject({
      providerBlockStatus: 'current',
      providerBlock: null,
    })
  })

  it('does not label an unrelated recording failure as a provider-limit problem', async () => {
    const a = await live()
    const boundary = host as unknown as {
      slots: Map<string, { session: { recordingFailure: string | null } }>
      providerBlockDisclosure(id: string, provider: 'claude'): unknown
    }
    const session = boundary.slots.get(a.id)?.session
    if (session === undefined) throw new Error('fictional session was not registered')
    session.recordingFailure = 'fictional recording failure'
    expect(boundary.providerBlockDisclosure(a.id, 'claude')).toMatchObject({
      providerBlockStatus: 'current',
      providerBlock: null,
    })
    session.recordingFailure = null
    clock++
    a.handle.simulateError(UNKNOWN, false)
    await eventually(() => window.events.some((row) => row.event.type === 'error'))
    await drain()
    session.recordingFailure = 'fictional recording failure'
    expect(boundary.providerBlockDisclosure(a.id, 'claude')).toMatchObject({
      providerBlockStatus: 'unavailable',
    })
    session.recordingFailure = null
  })

  it('publishes an own unknown stop after an existing poll, and never borrows it for another idle conversation', async () => {
    const a = await live(),
      b = await live()
    const reads = vi.spyOn(store, 'providerLimitsSeen')
    clock++
    a.handle.simulateError(UNKNOWN, false)
    await eventually(() =>
      window.events.some((row) => row.sessionId === a.id && row.event.type === 'error'),
    )
    await drain()
    expect(reads).not.toHaveBeenCalled()
    expect(latest(a.id)).toMatchObject({ providerBlockStatus: 'unavailable' })
    host.limitsForAPerson()
    await drain()
    expect(reads).toHaveBeenCalledTimes(1)
    expect(latest(a.id)).toMatchObject({
      providerBlockStatus: 'current',
      providerBlock: { provider: 'claude', resetsAt: null },
    })
    expect(phase(a.id)).toMatchObject({
      providerBlockStatus: 'current',
      providerBlock: { resetsAt: null },
    })
    expect(latest(b.id)).toMatchObject({ providerBlockStatus: 'current', providerBlock: null })
    const unchangedState = phase(a.id)?.state
    clock++
    a.handle.simulateProviderLimitClear()
    await eventually(() =>
      window.events.some(
        (row) => row.sessionId === a.id && row.event.type === 'provider_limit_clear',
      ),
    )
    await drain()
    expect(latest(a.id)).toMatchObject({ providerBlockStatus: 'current', providerBlock: null })
    expect(phase(a.id)?.state).toEqual(unchangedState)
    expect(phase(a.id)?.providerBlock).toBeNull()
    expect(reads).toHaveBeenCalledTimes(1)
  })

  it('does not rebuild an unaffected idle conversation state on a global limit invalidation', async () => {
    const a = await live(),
      b = await live()
    await drain()
    expect(phase(b.id)).toMatchObject({ providerBlockStatus: 'current', providerBlock: null })
    const boundary = host as unknown as { stateMayHaveMoved(id: string): void }
    const moved = vi.spyOn(boundary, 'stateMayHaveMoved')
    clock++
    a.handle.simulateError(UNKNOWN, false)
    await eventually(() => window.events.some((row) => row.event.type === 'error'))
    await drain()
    expect(moved.mock.calls.some(([id]) => id === a.id)).toBe(true)
    expect(moved.mock.calls.filter(([id]) => id === b.id)).toHaveLength(0)
    expect(latest(a.id)?.providerBlockStatus).toBe('unavailable')
    expect(latest(b.id)).toMatchObject({ providerBlockStatus: 'current', providerBlock: null })
  })

  it('reports the actual finite policy hold, preserves message IDs, and clears availability without a queue change', async () => {
    const a = await live()
    clock++
    a.handle.simulateError(`${UNKNOWN}; resets ${new Date(clock + 60_000).toISOString()}`, false)
    await eventually(() => window.events.some((row) => row.event.type === 'error'))
    const queued = await host.queueMessage(a.id, 'fictional automatic news', THE_APP_ITSELF)
    expect(queued.outcome).toBe('queued')
    await drain()
    const before = latest(a.id)?.queued
    expect(before).toHaveLength(1)
    expect(before?.[0]).toMatchObject({
      holdReasonStatus: 'current',
      holdReason: { is: 'provider-limit', provider: 'claude', resetsAt: clock + 60_000 },
    })
    const id = before?.[0]?.id
    const reads = vi.spyOn(store, 'providerLimitsSeen').mockImplementationOnce(() => {
      throw new Error('fictional unread ledger')
    })
    expect(() => host.limitsForAPerson()).toThrow('fictional unread ledger')
    await drain()
    expect(latest(a.id)?.queued?.[0]).toMatchObject({ id, holdReasonStatus: 'unavailable' })
    expect(latest(a.id)?.queued?.[0]).not.toHaveProperty('holdReason')
    expect(reads).toHaveBeenCalledTimes(1)
    reads.mockRestore()
    expect(host.whyWhatIsHeldWaits(a.id)).toContain('limit')
    await drain()
    expect(latest(a.id)?.queued?.[0]).toMatchObject({
      id,
      holdReasonStatus: 'current',
      holdReason: { resetsAt: clock + 60_000 },
    })
    const handed = await host.look(a.id, window, false)
    expect(handed.queued?.[0]).toMatchObject({ id, holdReasonStatus: 'current' })
    expect(handed.liveness.queued?.[0]).toEqual(handed.queued?.[0])
  })

  it('keeps incomplete own-stop coverage unavailable while disclosing the real finite automatic gate', async () => {
    const a = await live()
    clock++
    a.handle.simulateError(`${UNKNOWN}; resets ${new Date(clock + 60_000).toISOString()}`, false)
    await eventually(() => window.events.some((row) => row.event.type === 'error'))
    const read = store.providerLimitsSeen.bind(store)
    vi.spyOn(store, 'providerLimitsSeen').mockImplementation((at, changes) => ({
      ...read(at, changes),
      rowsUnread: 1,
    }))
    const polled = host.limitsForAPerson()
    expect(polled.rows.some((row) => row.standing === 'stopped')).toBe(true)
    expect(polled.rowsUnread).toBe(1)
    await drain()
    expect(latest(a.id)?.providerBlockStatus).toBe('unavailable')
    expect(
      (await host.queueMessage(a.id, 'automatic words under the existing gate', THE_APP_ITSELF))
        .outcome,
    ).toBe('queued')
    await drain()
    expect(latest(a.id)?.queued?.[0]).toMatchObject({
      holdReasonStatus: 'current',
      holdReason: { is: 'provider-limit', provider: 'claude', resetsAt: clock + 60_000 },
    })
  })

  it('does not publish a preparation from before the existing sign-in epoch changed', async () => {
    const a = await live()
    clock++
    a.handle.simulateError(UNKNOWN, false)
    await eventually(() => window.events.some((row) => row.event.type === 'error'))
    host.limitsForAPerson()
    await drain()
    expect(latest(a.id)?.providerBlock).toEqual({ provider: 'claude', resetsAt: null })
    const read = store.providerLimitsSeen.bind(store)
    const boundary = host as unknown as {
      noteASignInChange(provider: 'claude', lifeSince: number): boolean
    }
    vi.spyOn(store, 'providerLimitsSeen').mockImplementationOnce((at, changes) => {
      const result = read(at, changes)
      clock++
      expect(boundary.noteASignInChange('claude', AT)).toBe(true)
      return result
    })
    expect(host.limitsForAPerson().rows.some((row) => row.standing === 'stopped')).toBe(true)
    await drain()
    expect(latest(a.id)).toMatchObject({ providerBlockStatus: 'current', providerBlock: null })
  })

  it('does not warm or renew admission from the window poll', async () => {
    const a = await live()
    const reads = vi.spyOn(store, 'providerLimitsSeen')
    host.limitsForAPerson()
    expect(reads).toHaveBeenCalledTimes(1)
    expect((await host.queueMessage(a.id, 'first automatic news', THE_APP_ITSELF)).outcome).toBe(
      'sent',
    )
    expect(reads).toHaveBeenCalledTimes(2)
  })

  it.each([7, 20])(
    'prepares asynchronously once for %i rows, with zero writer reads on list/state/liveness projections',
    async (count) => {
      await host.closeAll()
      host = anotherHost(true)
      const ids = []
      for (let n = 0; n < count; n++) ids.push((await live()).id)
      const reads = vi.spyOn(store, 'providerLimitsSeen')
      expect(host.resumableSessions()).toHaveLength(count)
      expect(reads).not.toHaveBeenCalled()
      await eventually(() => native?.calls.length === 1)
      expect(host.resumableSessions()).toHaveLength(count)
      host.unresumableSessions()
      await drain()
      expect(native!.calls).toHaveLength(1)
      const canonical = native!.finish().canonical
      expect(canonical).toMatchObject({
        walk: 'every-provider-wall-recently-recorded',
        rowsUnread: 0,
        rows: [],
      })
      await drain()
      const first = host.resumableSessions()
      expect(first.map((row) => row.providerBlockStatus)).toEqual(ids.map(() => 'current'))
      host.unresumableSessions()
      for (const id of ids)
        expect((await host.look(id, window, false)).liveness.providerBlockStatus).toBe('current')
      await drain()
      expect(reads).not.toHaveBeenCalled()
      expect(native!.calls).toHaveLength(1)
    },
  )

  it('marks an expired folded winner unavailable without another query until an existing refresh', async () => {
    const a = await live()
    clock++
    a.handle.simulateError(`${UNKNOWN}; resets ${new Date(clock + 1_000).toISOString()}`, false)
    await eventually(() => window.events.some((row) => row.event.type === 'error'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    host.limitsForAPerson()
    await drain()
    expect(latest(a.id)?.providerBlock?.resetsAt).toBe(clock + 1_000)
    const reads = vi.spyOn(store, 'providerLimitsSeen')
    clock += 1_000
    await vi.advanceTimersByTimeAsync(1_000)
    await drain()
    expect(reads).not.toHaveBeenCalled()
    expect(latest(a.id)?.providerBlockStatus).toBe('unavailable')
    host.limitsForAPerson()
    await drain()
    expect(latest(a.id)).toMatchObject({ providerBlockStatus: 'current', providerBlock: null })
    expect(reads).toHaveBeenCalledTimes(1)
  })

  it('does not let an old disclosure callback borrow the next life under the same conversation id', async () => {
    const a = await live()
    clock++
    a.handle.simulateError(UNKNOWN, false)
    await eventually(() => window.events.some((row) => row.event.type === 'error'))
    host.limitsForAPerson()
    await drain()
    const boundary = host as unknown as {
      slots: Map<
        string,
        {
          session: {
            currentProviderLimits: () => Pick<
              SessionLivenessMessage['liveness'],
              'providerBlock' | 'providerBlockStatus'
            >
          } | null
        }
      >
    }
    const stale = boundary.slots.get(a.id)?.session?.currentProviderLimits
    if (stale === undefined) throw new Error('live disclosure callback was not registered')
    expect(stale()).toMatchObject({
      providerBlockStatus: 'current',
      providerBlock: { resetsAt: null },
    })
    await host.close(a.id, window)
    await host.resumeSession(a.id, window)
    const next = handles.at(-1)
    if (next === undefined || next === a.handle)
      throw new Error('next provider life was not registered')
    const clears = window.events.filter((row) => row.event.type === 'provider_limit_clear').length
    next.simulateProviderLimitClear()
    await eventually(
      () =>
        window.events.filter((row) => row.event.type === 'provider_limit_clear').length > clears,
    )
    await drain()
    expect(latest(a.id)).toMatchObject({ providerBlockStatus: 'current', providerBlock: null })
    expect(stale()).toMatchObject({ providerBlockStatus: 'current', providerBlock: null })
  })

  it('does not infer an own stopped episode from provider-wide rows after a host restart', async () => {
    const a = await live()
    clock++
    a.handle.simulateError(UNKNOWN, false)
    await eventually(() => window.events.some((row) => row.event.type === 'error'))
    host.limitsForAPerson()
    await host.closeAll()
    host = anotherHost(true)
    const reads = vi.spyOn(store, 'providerLimitsSeen')
    const [recorded] = host.resumableSessions()
    expect(recorded).toMatchObject({
      sessionId: a.id,
      providerBlockStatus: 'current',
      providerBlock: null,
    })
    expect(reads).not.toHaveBeenCalled()
    await eventually(() => native?.calls.length === 1)
    const canonical = native!.finish().canonical
    expect(canonical.rows).toHaveLength(1)
    await drain()
    const after = host.resumableSessions()[0]
    expect(after).toMatchObject({
      sessionId: a.id,
      providerBlockStatus: 'current',
      providerBlock: null,
    })
    expect(reads).not.toHaveBeenCalled()
    expect(native!.calls).toHaveLength(1)
  })
  it('keeps a real person command exempt beside automatic mail during an active person turn', async () => {
    const a = await live()
    await host.send(a.id, 'fictional first request', window)
    await eventually(() => window.events.some((row) => row.event.type === 'permission_request'))
    clock++
    a.handle.simulateError(`${UNKNOWN}; resets ${new Date(clock + 60_000).toISOString()}`, false)
    await eventually(() => window.events.some((row) => row.event.type === 'error'))
    expect((await host.queueMessage(a.id, 'automatic follow-up', THE_APP_ITSELF)).outcome).toBe(
      'queued',
    )
    expect((await host.queueMessage(a.id, '/compact', window)).outcome).toBe('queued')
    expect(host.whyWhatIsHeldWaits(a.id)).toContain('limit')
    await drain()
    const queued = latest(a.id)?.queued
    expect(queued).toHaveLength(2)
    expect(queued?.find((row) => row.text.includes('automatic follow-up'))).toMatchObject({
      holdReasonStatus: 'current',
      holdReason: { is: 'provider-limit', resetsAt: clock + 60_000 },
    })
    expect(queued?.find((row) => row.text === '/compact')).toMatchObject({
      holdReasonStatus: 'current',
      holdReason: null,
    })
    expect(latest(a.id)).toMatchObject({ providerBlockStatus: 'current', providerBlock: null })
  })

  it('invalidates the own episode on the existing sign-in observation and ignores old-login output', async () => {
    const a = await live()
    clock++
    a.handle.simulateError(UNKNOWN, false)
    await eventually(() => window.events.some((row) => row.event.type === 'error'))
    host.limitsForAPerson()
    await drain()
    expect(latest(a.id)?.providerBlock?.resetsAt).toBeNull()
    const before = phase(a.id)?.state
    const boundary = host as unknown as {
      noteASignInChange(provider: 'claude', lifeSince: number): boolean
    }
    clock++
    expect(boundary.noteASignInChange('claude', AT)).toBe(true)
    await drain()
    expect(latest(a.id)).toMatchObject({ providerBlockStatus: 'current', providerBlock: null })
    expect(phase(a.id)?.state).toEqual(before)
    clock++
    const errors = window.events.filter((row) => row.event.type === 'error').length
    a.handle.simulateError(UNKNOWN, false)
    await eventually(
      () => window.events.filter((row) => row.event.type === 'error').length > errors,
    )
    host.limitsForAPerson()
    await drain()
    expect(latest(a.id)).toMatchObject({ providerBlockStatus: 'current', providerBlock: null })
  })
})
