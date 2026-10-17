import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { FakeSessionHandle, RuntimeEvent, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { QueuedMessage } from '../src/main/runtime/queued-message'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { THE_PERSON_AT_A_WINDOW } from '../src/main/runtime/turn-origin'
import { resourcesRoot } from '../src/main/resources/resources'
import { MainThreadWork } from '../src/main/stall-watch'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { aStallItsGiverCanBeToldOf, type PieceRow } from '../src/shared/tasks'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const NOW = Date.UTC(2026, 9, 5, 9)
const RESET = NOW + 60_000
const UNKNOWN_LIMIT = 'claude is rate-limited (five_hour)'
const FINITE_LIMIT = `${UNKNOWN_LIMIT}; resets ${new Date(RESET).toISOString()}`

interface LiveFixture {
  id: string
  provider: Provider
  handle: FakeSessionHandle
  ordinal: number
  mailbox: QueuedMessage[]
  holdingQueue: number
  turnOpened: boolean
  itsSignInMovedOn?: boolean
}

interface DeliveryBoundary {
  slots: Map<string, { session: LiveFixture | null }>
  arrivals: Map<string, Promise<void>>
  askAgainOnceItArrived: Set<string>
  aDeliveryIsAboutToDriveIt(piece: PieceRow): boolean
  itWaitsForItsLimit(session: LiveFixture, aPersonsOwn: boolean): boolean
  deliver(session: LiveFixture, event: RuntimeEvent): void
}

class KeptHandles extends FakeRuntime {
  constructor(
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super('claude', { sessions })
  }

  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
}

async function waitFor(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('the fictional provider event was not recorded')
}

describe('stall deliveries read limits only for automatic mail', () => {
  let directory: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let boundary: DeliveryBoundary
  let work: MainThreadWork
  let handles: FakeSessionHandle[]
  let serial: number
  let clock: number
  let limits: MockInstance<SessionStore['providerLimitsSeen']>

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'brobot-stall-limit-read-'))
    db = openDatabase(join(directory, 'ledger.sqlite'))
    applyMigrations(db, migrations)
    serial = 0
    clock = NOW
    handles = []
    work = new MainThreadWork(() => 0)
    store = createSessionStore(db, () => clock++, work)
    limits = vi.spyOn(store, 'providerLimitsSeen')
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(directory, 'exports'),
      resourcesRoot: () => resourcesRoot(directory),
      createRuntime: () => new KeptHandles(handles, issued),
      prepareProviderHome: (provider, profileId) => {
        const home = join(directory, 'homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider) => join(directory, 'homes', provider),
      resolveCwd: (id, requested) => resolveSessionCwd(directory, id, requested),
      newSessionId: () => `sess_wave_${++serial}`,
      now: () => clock++,
      signInChanges: { read: () => new Map([['claude', NOW - 1]]), write: () => {} },
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    boundary = host as unknown as DeliveryBoundary
  })

  afterEach(async () => {
    boundary.arrivals.clear()
    boundary.askAgainOnceItArrived.clear()
    for (const slot of boundary.slots.values()) {
      if (slot.session === null) continue
      slot.session.mailbox.length = 0
      slot.session.holdingQueue = 0
      slot.session.turnOpened = false
      slot.session.itsSignInMovedOn = false
    }
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function append(session: LiveFixture, event: TranscriptEvent): void {
    store.append(session.id, session.ordinal++, event, clock++)
  }

  async function launched(
    history = 0,
    endState: 'completed' | 'interrupted' = 'completed',
  ): Promise<{ session: LiveFixture; piece: PieceRow }> {
    const { sessionId } = await host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: directory },
      null,
    )
    const session = boundary.slots.get(sessionId)?.session
    if (session === undefined || session === null) throw new Error('no live owner was registered')
    expect(session.handle).toBe(handles.at(-1))
    await waitFor(() =>
      store
        .events(sessionId)
        .some((row) => row.event.type === 'status' && row.event.state === 'idle'),
    )
    expect(session.handle.status()).toBe('idle')
    expect(store.events(sessionId).some((row) => row.event.type === 'launched')).toBe(true)
    store.atomically(() => {
      for (let n = 0; n < history; n++) append(session, { type: 'status', state: 'idle' })
      append(session, {
        type: 'work_given',
        piece: `work_${sessionId}`,
        label: `W1.${serial}`,
        parent: 'work_giver',
        givenBy: 'sess_giver',
        title: 'Fictional work',
        brief: 'Fictional work',
      })
      append(session, {
        type: 'user_turn',
        text: 'Fictional work',
        attribution: 'app_authored',
        relayedFrom: 'sess_giver',
        says: 'note',
      })
      append(session, { type: 'status', state: 'working' })
      append(session, { type: 'turn', state: endState })
      append(session, { type: 'status', state: 'idle' })
    })
    const piece = store.piecesOwnedBy(sessionId).find((one) => one.piece === `work_${sessionId}`)
    if (piece === undefined) throw new Error('no assigned work was folded')
    expect(aStallItsGiverCanBeToldOf(piece)).toBe(true)
    expect(piece.stalledBecause).toBe(endState === 'completed' ? 'turn_ended' : 'turn_interrupted')
    expect(piece.owner).toBe(sessionId)
    return { session, piece }
  }

  async function limitFrom(session: LiveFixture, message = UNKNOWN_LIMIT): Promise<void> {
    const ordinal = session.ordinal
    session.handle.simulateError(message, false)
    await waitFor(() =>
      store
        .events(session.id)
        .some(
          (row) =>
            row.ordinal >= ordinal && row.event.type === 'error' && row.event.message === message,
        ),
    )
  }

  function resetCounts(): void {
    limits.mockClear()
    work.clear()
  }

  function counts(): { limits: number; launches: number } {
    return {
      limits: limits.mock.calls.length,
      launches:
        work.take().find((one) => one.what === 'store.providerLimitsSeen.read-launches')?.count ??
        0,
    }
  }

  function message(extra: Partial<QueuedMessage> = {}): QueuedMessage {
    return {
      id: `msg_${++serial}`,
      kind: 'notice',
      text: 'Fictional held words',
      since: clock,
      attachments: [],
      authorship: { attribution: 'app_authored', relayedFrom: 'sess_giver', says: 'note' },
      ...extra,
    }
  }

  it.each([7, 20])(
    'launches %i conversations without reading limits for their empty mailboxes',
    async (n) => {
      const checks = vi.spyOn(boundary, 'aDeliveryIsAboutToDriveIt')
      const owners: LiveFixture[] = []
      resetCounts()
      for (let i = 0; i < n; i++) {
        const { session, piece } = await launched(512, 'interrupted')
        owners.push(session)
        await limitFrom(session)
        append(session, { type: 'assistant_delta', text: 'Fictional streamed text between checks' })
        expect(session.mailbox).toEqual([])
        boundary.deliver(session, { type: 'status', state: 'idle' })
        const called = checks.mock.calls.filter(([one]) => one.piece === piece.piece)
        expect(called).toHaveLength(1)
        const first = called[0]
        if (first === undefined) throw new Error('the provider delivery skipped its stalled work')
        expect(aStallItsGiverCanBeToldOf(first[0])).toBe(true)
        expect(checks.mock.results.at(-1)).toMatchObject({ type: 'return', value: false })
      }
      const stallChecks = counts()

      // The window poll still pays the complete read, including every qualifying owner's launches.
      resetCounts()
      const polled = host.limitsForAPerson()
      expect(polled.ledgers).toBe(n)
      expect(polled.rows).toHaveLength(1)
      expect(polled.rows[0]?.resetsAt).toBeNull()
      const windowPoll = counts()

      // No wall-changing event intervenes; all automatic gates use the existing five-second result,
      // and its one read reads no launch again: the walls read is kept with them.
      resetCounts()
      for (const session of owners) expect(boundary.itWaitsForItsLimit(session, false)).toBe(false)
      const automaticGates = counts()
      expect([
        { phase: 'stall checks', ...stallChecks },
        { phase: 'window poll', ...windowPoll },
        { phase: 'automatic gates', ...automaticGates },
      ]).toEqual([
        { phase: 'stall checks', limits: 0, launches: 0 },
        { phase: 'window poll', limits: 1, launches: n },
        { phase: 'automatic gates', limits: 1, launches: 0 },
      ])
    },
  )

  it('keeps the finite hold for eligible automatic mail, reading once for several messages', async () => {
    const { session, piece } = await launched()
    await limitFrom(session, FINITE_LIMIT)
    session.mailbox.push(message({ drives: piece.piece }), message({ piece: piece.piece }))
    resetCounts()
    expect(boundary.aDeliveryIsAboutToDriveIt(piece)).toBe(false)
    expect(counts()).toEqual({ limits: 1, launches: 1 })
    expect(session.mailbox).toHaveLength(2)
    expect(boundary.aDeliveryIsAboutToDriveIt(piece)).toBe(false)
    expect(counts()).toEqual({ limits: 1, launches: 0 })
    expect(limits.mock.calls).toHaveLength(1)
  })

  it('does not turn an unknown reset into an automatic hold', async () => {
    const { session, piece } = await launched()
    await limitFrom(session)
    session.mailbox.push(message({ drives: piece.piece }))
    resetCounts()
    expect(boundary.aDeliveryIsAboutToDriveIt(piece)).toBe(true)
    expect(counts()).toEqual({ limits: 1, launches: 1 })
  })

  it.each(['person first', 'automatic first'])(
    'admits eligible person words with %s without a read',
    async (order) => {
      const { session, piece } = await launched()
      await limitFrom(session, FINITE_LIMIT)
      const person = message({ drives: piece.piece, origin: THE_PERSON_AT_A_WINDOW })
      const automatic = message({ drives: piece.piece })
      session.mailbox.push(
        ...(order === 'person first' ? [person, automatic] : [automatic, person]),
      )
      resetCounts()
      expect(boundary.aDeliveryIsAboutToDriveIt(piece)).toBe(true)
      expect(counts()).toEqual({ limits: 0, launches: 0 })
    },
  )

  it('excludes unrelated mail, including a person message and a piece overriding drives', async () => {
    const { session, piece } = await launched()
    await limitFrom(session, FINITE_LIMIT)
    session.mailbox.push(
      message({ drives: 'other', origin: THE_PERSON_AT_A_WINDOW }),
      message({ piece: 'other', drives: piece.piece }),
    )
    resetCounts()
    expect(boundary.aDeliveryIsAboutToDriveIt(piece)).toBe(false)
    expect(counts()).toEqual({ limits: 0, launches: 0 })
  })

  it('still checks the limit for interrupting automatic words about another piece', async () => {
    const { session, piece } = await launched()
    await limitFrom(session, FINITE_LIMIT)
    session.mailbox.push(message({ drives: 'other', interrupting: { askedBy: null } }))
    resetCounts()
    expect(boundary.aDeliveryIsAboutToDriveIt(piece)).toBe(false)
    expect(counts()).toEqual({ limits: 1, launches: 1 })
  })

  it('lets an interrupted piece return to held words until its sign-in moves on', async () => {
    const { session, piece } = await launched()
    await limitFrom(session)
    session.mailbox.push(message({ drives: 'other' }))
    const interrupted = { ...piece, aTurnMayGoBackToIt: true as const }
    resetCounts()
    expect(boundary.aDeliveryIsAboutToDriveIt(interrupted)).toBe(true)
    expect(counts()).toEqual({ limits: 1, launches: 1 })
    session.itsSignInMovedOn = true
    resetCounts()
    expect(boundary.aDeliveryIsAboutToDriveIt(interrupted)).toBe(false)
    expect(counts()).toEqual({ limits: 0, launches: 0 })
  })

  it.each(['arrival', 'held replacement', 'running return'] as const)(
    'defers the notice for %s without a read',
    async (path) => {
      const { session, piece } = await launched()
      await limitFrom(session, FINITE_LIMIT)
      boundary.arrivals.set(session.id, Promise.resolve())
      if (path === 'held replacement') session.holdingQueue = 1
      if (path === 'running return') session.turnOpened = true
      resetCounts()
      expect(boundary.aDeliveryIsAboutToDriveIt({ ...piece, aTurnMayGoBackToIt: true })).toBe(true)
      expect(boundary.askAgainOnceItArrived.has(session.id)).toBe(path === 'arrival')
      expect(counts()).toEqual({ limits: 0, launches: 0 })
    },
  )

  it('keeps upstream giver, stall, drive-cause and live-owner guards', async () => {
    const { session, piece } = await launched()
    await limitFrom(session, FINITE_LIMIT)
    session.mailbox.push(message({ drives: piece.piece }))
    resetCounts()
    expect(boundary.aDeliveryIsAboutToDriveIt({ ...piece, giver: null })).toBe(false)
    expect(
      boundary.aDeliveryIsAboutToDriveIt({ ...piece, state: 'working', stalledBecause: null }),
    ).toBe(false)
    expect(
      boundary.aDeliveryIsAboutToDriveIt({ ...piece, stalledBecause: 'message_never_sent' }),
    ).toBe(false)
    const status = vi.spyOn(session.handle, 'status').mockReturnValue('ended')
    expect(boundary.aDeliveryIsAboutToDriveIt(piece)).toBe(false)
    status.mockRestore()
    expect(counts()).toEqual({ limits: 0, launches: 0 })
  })
})
