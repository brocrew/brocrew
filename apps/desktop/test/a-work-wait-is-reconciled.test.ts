import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { FakeSessionHandle, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { WindowWorkerReader } from '../src/main/db/window-worker-reader'
import {
  WINDOW_READ_BOUNDS,
  WindowReadUnavailable,
  type WindowStoreReader,
} from '../src/main/db/window-read-protocol'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeHostDeps } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import {
  readKeptCuts,
  writeKeptCuts,
  NO_CUTS_KEPT,
  type CutRecord,
} from '../src/main/turns-the-app-cut-file'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type {
  ReconciliationReceipt,
  WorkReconciliationEvent,
} from '../src/shared/work-reconciliation'
import type { ReconciliationPiece } from '../src/main/runtime/work-reconciliation'
import {
  DEFAULT_PROFILE_ID,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** Count executed read statements, including those prepared before a control begins. */
function countSqlReads(database: AppDatabase, read: (sql: string) => void): AppDatabase {
  return new Proxy(database, {
    get(target, property) {
      if (property === 'prepare')
        return (sql: string) => {
          const statement = target.prepare(sql)
          const wrapped: typeof statement = new Proxy(statement, {
            get(prepared, method) {
              const value = Reflect.get(prepared, method, prepared) as unknown
              if (typeof value !== 'function') return value
              return (...args: unknown[]) => {
                if (method === 'get' || method === 'all' || method === 'iterate') read(sql)
                const result = Reflect.apply(value, prepared, args)
                return result === prepared ? wrapped : result
              }
            },
          })
          return wrapped
        }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** Long enough for every pump and every flush a row arms to have run. */
async function settle(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

/** The provider double: it keeps the handles it gives out, so a test can report background work. */
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

describe('a work wait is reconciled without a window', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let clock: number
  let freezeClock: boolean
  let counter: number
  let keepTurnsOpen: boolean
  let failResume: boolean
  let startGap: number
  let intervals: (() => void)[]
  let firstLoad: Promise<void> | undefined
  let build: () => RuntimeHost
  let sqlReads: string[] | null
  let stampsAvailable: boolean
  const tick = () => (freezeClock ? clock : clock++)
  const window = new RecordingSink('webContents:271')
  const record = (owner: string, event: TranscriptEvent) => {
    ;(
      host as unknown as { writeIntoItsLedger(owner: string, event: TranscriptEvent): void }
    ).writeIntoItsLedger(owner, event)
  }
  const receipts = (owner: string, piece: string) => store.reconciliationReceipts(owner, piece)
  const captureLegacyCut = () => {
    db.exec('DROP TABLE work_legacy_stall_cut')
    db.exec(
      readFileSync(join(migrationsFolder, '0010_the_legacy_stall_cut.sql'), 'utf8').replaceAll(
        '--> statement-breakpoint',
        '',
      ),
    )
  }

  const notices = (owner: string) =>
    store
      .events(owner)
      .filter(
        (one) =>
          one.event.type === 'message_queued' &&
          one.event.appNotice === 'a-work-wait-needs-attention',
      )
  const cycle = async () => {
    intervals.at(-1)!()
    await settle()
  }
  const create = async () => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: DEFAULT_PROFILE_ID, approvalMode: 'auto', cwd: root },
      window,
    )
    return { owner: sessionId, work: store.rootOf(sessionId)! }
  }
  const waiting = (owner: string, piece: string, on?: Record<string, unknown>) =>
    record(owner, {
      type: 'work_status_set',
      piece,
      line: 'waiting for the fictional target',
      by: owner,
      waiting: true,
      ...(on === undefined ? {} : { on }),
    } as TranscriptEvent)

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot-reconcile-'))
    root = mkdtempSync(join(tmpdir(), 'brobot-reconcile-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    sqlReads = null
    db = countSqlReads(db, (sql) => sqlReads?.push(sql))
    clock = 1_800_000_000_000
    freezeClock = false
    store = createSessionStore(db, tick)
    stampsAvailable = true
    const contentStamp = limitsWriterSampler(
      db,
      () => store.canReadFreshSnapshot?.() === true,
      () => clock,
    )
    const windowStamp = windowWriterSampler(
      db,
      () => store.canReadFreshSnapshot?.() === true,
      () => clock,
    )
    firstLoad = undefined
    handles = []
    counter = 0
    keepTurnsOpen = false
    failResume = false
    startGap = 1
    intervals = []
    const actualInterval = globalThis.setInterval
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      fn: () => void,
      ms: number,
      ...args: unknown[]
    ) => {
      if (ms === 60_000) intervals.push(fn)
      return Reflect.apply(actualInterval, globalThis, [fn, ms, ...args]) as ReturnType<
        typeof setInterval
      >
    }) as typeof setInterval)
    const issued = new FakeProviderSessions()
    class Runtime extends ProviderDouble {
      private fit(handle: FakeSessionHandle) {
        if (keepTurnsOpen) {
          const machine = (
            handle as unknown as { machine: { beginTurn(): number | null; refusedTurn(): Error } }
          ).machine
          handle.send = async () => {
            if (machine.beginTurn() === null) throw machine.refusedTurn()
          }
        }
        return handle
      }
      override async start(options: StartOptions) {
        return this.fit(await super.start(options))
      }
      override async resume(ref: SessionRef, options: ResumeOptions) {
        if (failResume) throw new Error('fictional provider start failed')
        return this.fit(await super.resume(ref, options))
      }
    }
    build = () =>
      new RuntimeHost({
        afterFirstWindowLoad: firstLoad,
        turnsTheAppCut: {
          read: () => readKeptCuts(join(userData, 'cuts.json')),
          write: (kept) => writeKeptCuts(join(userData, 'cuts.json'), kept),
        },
        store,
        limitsWriterStamp: () => (stampsAvailable ? contentStamp() : null),
        windowWriterStamp: (query) => (stampsAvailable ? windowStamp(query) : null),
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        resourcesRoot: () => resourcesRoot(userData),
        createRuntime: (provider: Provider) => new Runtime(provider, handles, issued),
        prepareProviderHome: (provider, profileId) => {
          const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider) => join(userData, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => `fictional-${++counter}`,
        now: tick,
        startGapMs: startGap,
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
    host = build()
  })
  afterEach(async () => {
    await host.closeAll()
    vi.restoreAllMocks()
    db.close()
    for (const folder of [userData, root]) rmSync(folder, { recursive: true, force: true })
  })

  it('a quiet pass reads no names and several notices share one narrow names read', async () => {
    keepTurnsOpen = true
    const reading = host as unknown as {
      reconcileWork(): void
      reconciliationReading(): { rows: ReconciliationPiece[] }
      reconciliationWords(piece: ReconciliationPiece, receipt: ReconciliationReceipt): string
      workReconciler: { run(): Promise<void> }
      slots: Map<
        string,
        { session: { handle: { machine: { completeTurn(state: 'completed'): void } } } }
      >
    }
    vi.spyOn(reading, 'reconcileWork').mockImplementation(() => {})
    const { owner } = await create()
    const namesRead = vi.spyOn(store, 'reconciliationNames')
    sqlReads = []
    await reading.workReconciler.run()
    const quietReads = sqlReads
    sqlReads = null
    expect(namesRead).not.toHaveBeenCalled()
    expect(quietReads.filter((sql) => sql.includes('s.id AS conversation'))).toEqual([])

    const { sessionId: grace } = await host.createSession(
      { provider: 'claude', profileId: 'fictional-grace', approvalMode: 'auto', cwd: root },
      window,
    )
    expect(host.setAgentDisplayName('fictional-grace', 'Grace')).not.toBeNull()
    await host.close(grace, window)
    const children: { holder: string; piece: string }[] = []
    for (let n = 0; n < 3; n++) {
      const tool = agentToolsFor(host, owner).tools.find((one) => one.name === 'give_work')!
      const result = (
        await tool.call({
          profile: `fictional-worker-${n}`,
          new: true,
          title: `Fictional piece ${n}`,
          brief: 'Produce a checked result.',
          definition_of_done: 'The result is checked.',
        })
      ).structured as { outcome: string; agent: string; piece: string }
      expect(result.outcome).toBe('ok')
      const holder = result.agent
      await waitFor(() => store.theOpenTurn(holder) !== null, 'the worker turn')
      const asker = n === 2 ? owner : grace
      record(holder, { type: 'work_interrupted', by: 'an-agent', agent: asker })
      reading.slots.get(holder)!.session.handle.machine.completeTurn('completed')
      children.push({ holder, piece: result.piece })
    }
    await waitFor(
      () =>
        children.every(({ holder, piece }) =>
          store
            .piecesOwnedBy(holder)
            .some((one) => one.piece === piece && one.stalledBecause === 'turn_ended'),
        ),
      'the completed turns and their existing asker folds',
    )
    const pieceIds = new Set(children.map((one) => one.piece))
    const pass = reading.reconciliationReading().rows.filter((row) => pieceIds.has(row.piece))
    expect(pass).toHaveLength(3)
    expect(namesRead).not.toHaveBeenCalled()
    const lines: string[] = []
    sqlReads = []
    for (const piece of pass) {
      for (const step of ['holder', 'giver'] as const) {
        lines.push(
          reading.reconciliationWords(piece, {
            type: 'work_reconciliation',
            incident: `fictional-${piece.piece}`,
            piece: piece.piece,
            kind: 'stopped',
            cause: 'turn_ended',
            since: tick(),
            at: tick(),
            step,
            outcome: 'planned',
            target: step === 'holder' ? piece.holder : owner,
            messageId: `fictional-${step}-${piece.piece}`,
          }),
        )
      }
    }
    const composedReads = sqlReads
    sqlReads = null
    expect(namesRead).toHaveBeenCalledTimes(1)
    expect(composedReads).toHaveLength(1)
    expect(composedReads[0]).toContain('s.id IN (SELECT value FROM json_each(?))')
    expect(new Set(namesRead.mock.calls[0]![0])).toEqual(
      new Set([owner, grace, ...children.map((one) => one.holder)]),
    )
    expect(lines).toHaveLength(6)
    expect(lines.filter((line) => line.includes('by Grace'))).toHaveLength(4)
    expect(lines.some((line) => line.includes('you asked it to stop'))).toBe(true)
    expect(lines.every((line) => !line.includes('(the owner of'))).toBe(true)

    expect(host.setAgentDisplayName('fictional-grace', 'Gina')).not.toBeNull()
    const fresh = reading
      .reconciliationReading()
      .rows.find((row) => pieceIds.has(row.piece) && row.stalledBy?.asker === grace)!
    sqlReads = []
    const renamed = reading.reconciliationWords(fresh, {
      type: 'work_reconciliation',
      incident: 'fictional-renamed',
      piece: fresh.piece,
      kind: 'stopped',
      cause: 'turn_ended',
      since: tick(),
      at: tick(),
      step: 'giver',
      outcome: 'planned',
      target: owner,
      messageId: 'fictional-renamed-message',
    })
    expect(sqlReads).toHaveLength(1)
    sqlReads = null
    expect(renamed).toContain('by Gina')
    expect(renamed).not.toContain('Grace')
  })

  it('a working piece with a failed holder receipt names its holder in the giver notice', async () => {
    keepTurnsOpen = true
    const reading = host as unknown as {
      reconcileWork(): void
      reconciliationReading(): { rows: ReconciliationPiece[] }
      reconciliationWords(piece: ReconciliationPiece, receipt: ReconciliationReceipt): string
      deliverReconciliation(
        piece: ReconciliationPiece,
        receipt: ReconciliationReceipt,
      ): Promise<boolean>
      workReconciler: { run(holders?: ReadonlySet<string>): Promise<void> }
    }
    vi.spyOn(reading, 'reconcileWork').mockImplementation(() => {})
    const { owner } = await create()
    const tool = agentToolsFor(host, owner).tools.find((one) => one.name === 'give_work')!
    const given = (
      await tool.call({
        profile: 'fictional-known-holder',
        new: true,
        title: 'Fictional resumed work',
        brief: 'Check the result.',
        definition_of_done: 'A checked result.',
      })
    ).structured as { agent: string; piece: string }
    expect(host.setAgentDisplayName('fictional-known-holder', 'Bob')).not.toBeNull()
    await waitFor(() => store.theOpenTurn(given.agent) !== null, 'the resumed holder turn')
    record(given.agent, {
      type: 'work_reconciliation',
      incident: 'fictional-existing-incident',
      piece: given.piece,
      kind: 'stopped',
      cause: 'turn_ended',
      since: tick(),
      step: 'holder',
      outcome: 'failed',
      target: given.agent,
      messageId: 'fictional-failed-reminder',
    })
    const namesRead = vi.spyOn(store, 'reconciliationNames')
    const row = reading.reconciliationReading().rows.find((one) => one.piece === given.piece)!
    expect(row).toMatchObject({ disposition: 'working', issue: null })
    expect(namesRead).not.toHaveBeenCalled()
    const lines: string[] = []
    const deliveries = vi
      .spyOn(reading, 'deliverReconciliation')
      .mockImplementation(async (piece, receipt) => {
        expect(receipt.step).toBe('giver')
        sqlReads = []
        lines.push(reading.reconciliationWords(piece, receipt))
        const compositionReads = sqlReads
        sqlReads = null
        expect(compositionReads).toHaveLength(1)
        expect(compositionReads[0]).toContain('s.id AS conversation')
        return true
      })
    await reading.workReconciler.run(new Set([given.agent]))
    await settle()
    expect(deliveries).toHaveBeenCalledTimes(1)
    expect(receipts(given.agent, given.piece)).toContainEqual(
      expect.objectContaining({
        step: 'giver',
        target: owner,
        outcome: 'delivered',
      }),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("Bob didn't settle it after a reminder")
    expect(lines[0]).not.toContain('an agent this app cannot name')
    expect(namesRead).toHaveBeenCalledTimes(1)
    expect(new Set(namesRead.mock.calls[0]![0])).toEqual(new Set([given.agent, owner]))
  })

  it('ordinary live appends allocate without an additional SQL read', async () => {
    keepTurnsOpen = true
    const { owner } = await create()
    await host.send(owner, 'A fictional held turn.', window)
    await waitFor(() => store.theOpenTurn(owner) !== null, 'the held turn')
    const live = host as unknown as {
      slots: Map<
        string,
        { session: { id: string; ordinal: number; recordingFailure: string | null } }
      >
      deliver(session: unknown, event: { type: 'assistant_delta'; text: string }): void
    }
    const session = live.slots.get(owner)!.session
    const event = { type: 'assistant_delta' as const, text: 'fictional text' }
    const baseline: string[] = []
    for (let n = 0; n < 20; n++) {
      const ordinal = store.nextOrdinal(owner)
      sqlReads = []
      store.append(owner, ordinal, event, tick())
      baseline.push(...sqlReads)
      sqlReads = null
    }
    // Account once for the deliberately competing direct store writes above.
    live.deliver(session, event)
    const floors = vi.spyOn(store, 'nextOrdinal')
    sqlReads = []
    for (let n = 0; n < 20; n++) live.deliver(session, event)
    const actual = sqlReads
    sqlReads = null
    expect(session.recordingFailure).toBeNull()
    expect(floors).not.toHaveBeenCalled()
    expect(actual).toEqual(baseline)
    expect(actual.filter((sql) => /max\(ordinal\)/i.test(sql))).toEqual([])
  })

  it('a rolled-back competing write refreshes once without retaining its ordinal', async () => {
    keepTurnsOpen = true
    const { owner } = await create()
    await host.send(owner, 'A fictional held turn.', window)
    await waitFor(() => store.theOpenTurn(owner) !== null, 'the held turn')
    const live = host as unknown as {
      slots: Map<
        string,
        { session: { id: string; ordinal: number; recordingFailure: string | null } }
      >
      deliver(session: unknown, event: { type: 'assistant_delta'; text: string }): void
    }
    const session = live.slots.get(owner)!.session
    const next = store.nextOrdinal(owner)
    expect(() =>
      store.atomically(() => {
        store.append(owner, next, { type: 'assistant_delta', text: 'rolled back' }, tick())
        throw new Error('the fictional transaction rolled back')
      }),
    ).toThrow('the fictional transaction rolled back')
    const floors = vi.spyOn(store, 'nextOrdinal')
    live.deliver(session, { type: 'assistant_delta', text: 'kept after rollback' })
    live.deliver(session, { type: 'assistant_delta', text: 'next kept event' })
    expect(floors).toHaveBeenCalledTimes(1)
    expect(session.recordingFailure).toBeNull()
    expect(
      store
        .events(owner)
        .filter((one) => one.event.type === 'assistant_delta')
        .map((one) => [one.ordinal, one.event]),
    ).toEqual([
      [next, { type: 'assistant_delta', text: 'kept after rollback' }],
      [next + 1, { type: 'assistant_delta', text: 'next kept event' }],
    ])
  })

  it('a receipt from another store cannot steal the holder next event ordinal', async () => {
    keepTurnsOpen = true
    const { owner, work } = await create()
    await host.send(owner, 'A fictional held turn.', window)
    await waitFor(() => store.theOpenTurn(owner) !== null, 'the held turn')
    const originalStore = store
    const otherDb = openDatabase(join(userData, 'brobot2.sqlite'))
    let other: RuntimeHost | undefined
    const engine = host as unknown as {
      reconcileWork(holders?: ReadonlySet<string>): void
      slots: Map<string, { session: { ordinal: number; recordingFailure: string | null } }>
    }
    const paused = vi.spyOn(engine, 'reconcileWork').mockImplementation(() => {})
    const session = engine.slots.get(owner)!.session
    const reserved = session.ordinal
    try {
      store = createSessionStore(otherDb, tick)
      firstLoad = new Promise(() => {})
      other = build()
      store = originalStore
      const writer = other as unknown as {
        keepReconciliation(owner: string, event: WorkReconciliationEvent): boolean
      }
      const receipt: WorkReconciliationEvent = {
        type: 'work_reconciliation',
        incident: 'fictional-racing-receipt',
        piece: work.piece,
        kind: 'stopped',
        since: tick(),
        step: 'holder',
        outcome: 'planned',
        target: owner,
        messageId: 'fictional-racing-reminder',
      }
      expect(writer.keepReconciliation(owner, receipt)).toBe(true)
      expect(store.nextOrdinal(owner)).toBeGreaterThan(reserved)
      expect(session.ordinal).toBe(reserved)
      ;(
        handles[0] as unknown as { machine: { completeTurn(state: 'completed'): void } }
      ).machine.completeTurn('completed')
      await settle()
      expect(session.recordingFailure).toBeNull()
      const entries = store.events(owner)
      const reminder = entries.find((one) => one.event.type === 'work_reconciliation')!
      const terminal = entries.find(
        (one) =>
          one.ordinal > reminder.ordinal &&
          one.event.type === 'turn' &&
          one.event.state === 'completed',
      )
      expect(terminal).toBeDefined()
      expect(session.ordinal).toBeGreaterThan(terminal!.ordinal)
      expect(new Set(entries.map((one) => one.ordinal)).size).toBe(entries.length)
    } finally {
      store = originalStore
      firstLoad = undefined
      await other?.closeAll()
      otherDb.close()
      paused.mockRestore()
    }
  })

  it('a future time is untouched; the 60 s tick wakes a due root once and turn end lists it', async () => {
    const { owner, work } = await create()
    const at = clock + 3_600_000
    waiting(owner, work.piece, { kind: 'time', at })
    await cycle()
    expect(notices(owner)).toHaveLength(0)
    clock = at
    await cycle()
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'the reminded turn to finish',
    )
    expect(notices(owner)).toHaveLength(1)
    const queued = notices(owner)[0]!.event
    expect(queued).toMatchObject({
      text: `${work.label}: the time it was waiting for has come. Carry on with it, or say what it waits on now with update_work (on).`,
    })
    expect(host.workIncidentsForAPerson()).toMatchObject({
      walk: 'every-conversation-that-holds-work',
      rows: [
        { piece: work.piece, kind: 'wait-target-ended', told: { holder: expect.any(Number) } },
      ],
    })
    await cycle()
    expect(notices(owner)).toHaveLength(1)
  })

  it('a reminded turn still running at the next tick is never escalated', async () => {
    const { owner, work } = await create()
    keepTurnsOpen = true
    // Fit the already running provider life as well.
    const handle = handles.at(-1)!
    const machine = (handle as unknown as { machine: { beginTurn(): number | null } }).machine
    handle.send = async () => {
      machine.beginTurn()
    }
    waiting(owner, work.piece)
    await cycle()
    expect(notices(owner)).toHaveLength(1)
    expect(host.workIncidentsForAPerson().rows).toEqual([])
    clock += 10 * 60_000
    await cycle()
    expect(notices(owner)).toHaveLength(1)
    expect(receipts(owner, work.piece).some((one) => one.step === 'person')).toBe(false)
    expect(store.reconciliationDelivery(owner, receipts(owner, work.piece)[0]!.messageId!)).toBe(
      'running',
    )
  })

  it('a restart processes a root wait and never repeats a persisted ladder step', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece, { kind: 'agent', piece: 'missing-fictional-piece', label: 'W99.1' })
    await host.closeAll()
    host = build()
    await waitFor(() => notices(owner).length === 1, 'startup reminder without a window')
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'startup ladder ending',
    )
    await host.closeAll()
    host = build()
    await settle()
    await cycle()
    expect(notices(owner)).toHaveLength(1)
    expect(host.workIncidentsForAPerson().rows).toMatchObject([{ kind: 'wait-target-missing' }])
  })

  it('a person Stop is listed directly without any reminder', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await host.interrupt(owner, window)
    expect(store.lastAskToStop(owner)?.by).toBe('a-person')
    await cycle()
    expect(notices(owner)).toHaveLength(0)
    expect(receipts(owner, work.piece)).toMatchObject([{ step: 'person', outcome: 'listed' }])
    expect(host.workIncidentsForAPerson().rows).toMatchObject([
      { kind: 'wait-needs-classification' },
    ])
    await cycle()
    expect(notices(owner)).toHaveLength(0)
  })

  it('a malformed incident receipt is uncertainty, never permission to send again', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    record(owner, {
      type: 'work_reconciliation',
      piece: work.piece,
      incident: 'torn',
    } as WorkReconciliationEvent)
    await cycle()
    expect(notices(owner)).toHaveLength(0)
    expect(host.workIncidentsForAPerson().rows).toEqual([])
    expect(host.workIncidentsForAPerson().rowsUnread).toBeGreaterThan(0)
  })

  it('a completed queued reminder closes only its own actual turn, not an unrelated later turn', async () => {
    const { owner, work } = await create()
    record(owner, {
      type: 'message_queued',
      messageId: 'fictional-q',
      text: 'notice',
      appNotice: 'a-work-wait-needs-attention',
    })
    expect(store.reconciliationDelivery(owner, 'fictional-q')).toBe('pending')
    record(owner, {
      type: 'message_unqueued',
      messageId: 'fictional-q',
      reason: 'sent',
      text: 'notice',
    })
    // A ledger torn before the corresponding user_turn does not borrow the next person's turn.
    expect(store.reconciliationDelivery(owner, 'fictional-q')).toBe('not-delivered')
    record(owner, { type: 'user_turn', text: 'unrelated person words' })
    expect(store.reconciliationDelivery(owner, 'fictional-q')).toBe('not-delivered')
    expect(receipts(owner, work.piece)).toEqual([])
  })
  it('an open piece target is left alone; its actual close makes that same wait actionable', async () => {
    const { owner, work } = await create()
    const tools = agentToolsFor(host, owner)
    const call = async (name: string, input: Record<string, unknown>) => {
      const answer = await tools.tools.find((one) => one.name === name)!.call(input)
      const value = answer.structured as Record<string, unknown>
      expect(value).toMatchObject({ outcome: 'ok' })
      return value
    }
    const child = await call('give_work', {
      profile: 'fictional-worker',
      new: true,
      title: 'Fictional child',
      brief: 'Keep this open.',
      definition_of_done: 'A checked result.',
    })
    await settle()
    const before = notices(owner).length
    waiting(owner, work.piece, { kind: 'agent', piece: child.piece, label: child.label })
    await cycle()
    expect(notices(owner)).toHaveLength(before)
    expect(receipts(owner, work.piece)).toEqual([])
    await call('update_work', { piece: child.piece, close: true })
    await cycle()
    expect(notices(owner)).toHaveLength(before + 1)
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'closed target escalation',
    )
    expect(host.workIncidentsForAPerson().rows).toMatchObject([
      { piece: work.piece, kind: 'wait-target-ended' },
    ])
  })

  it.each([
    { kind: 'person', request: 'missing-person-request' },
    { kind: 'agent', request: 'missing-agent-request' },
    { kind: 'event', job: 'missing-job' },
    { kind: 'event', background: 'missing-background' },
  ])('a missing target is found from its recorded wait: %j', async (on) => {
    const { owner, work } = await create()
    waiting(owner, work.piece, on)
    await cycle()
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'missing target reminder ending',
    )
    expect(notices(owner)).toHaveLength(1)
    expect(host.workIncidentsForAPerson().rows).toMatchObject([
      { piece: work.piece, kind: 'wait-target-missing' },
    ])
  })

  it.each([
    ['limit', 'usage-limit', 1_800_000_500_000],
    ['program', 'program', null],
    ['quit', 'app-restart', null],
    ['crash', 'app-restart', null],
  ] as const)(
    'a saved %s cut has a pending recovery with the agreed metadata',
    async (kind, because, resumesAt) => {
      const { owner, work } = await create()
      record(owner, { type: 'user_turn', text: 'Fictional work underway', drives: work.piece })
      const turn = store.theNewestTurn(owner)!
      await host.closeAll()
      const cut: CutRecord = {
        turn,
        generation: store.theActiveGeneration(owner),
        kind,
        cutAt: clock,
        at: clock,
        provider: 'claude',
        profile: DEFAULT_PROFILE_ID,
        expected: null,
        noticeId: 'fictional-cut-notice',
        aPersonStartedIt: false,
        state: 'pending',
        ...(resumesAt === null ? {} : { resetsAt: resumesAt }),
      }
      writeKeptCuts(join(userData, 'cuts.json'), { ...NO_CUTS_KEPT, cuts: { [owner]: cut } })
      host = build()
      expect(host.workIncidentsForAPerson().rows).toEqual([])
      // Recovery metadata is visible only after this incident has reached the person.
      record(owner, {
        type: 'work_reconciliation',
        incident: 'already-listed',
        piece: work.piece,
        kind: 'stopped',
        since: clock,
        step: 'person',
        outcome: 'listed',
      })
      expect(host.workIncidentsForAPerson().rows).toMatchObject([
        { piece: work.piece, kind: 'recovery-pending', recovery: { because, resumesAt } },
      ])
      await cycle()
      expect(notices(owner)).toHaveLength(0)
    },
  )

  it.each([
    ['start-failed', 'recovery-failed'],
    ['account-not-known', 'recovery-declined'],
  ] as const)(
    'a saved recovery ending %s is listed, without a second recovery wake',
    async (ended, kind) => {
      const { owner, work } = await create()
      record(owner, { type: 'user_turn', text: 'Fictional cut work', drives: work.piece })
      const turn = store.theNewestTurn(owner)!
      await host.closeAll()
      const cut: CutRecord = {
        turn,
        generation: store.theActiveGeneration(owner),
        kind: 'program',
        cutAt: clock,
        at: clock,
        provider: 'claude',
        profile: DEFAULT_PROFILE_ID,
        expected: null,
        noticeId: 'fictional-cut-notice',
        aPersonStartedIt: false,
        state: { ended },
      }
      writeKeptCuts(join(userData, 'cuts.json'), { ...NO_CUTS_KEPT, cuts: { [owner]: cut } })
      host = build()
      await cycle()
      expect(host.workIncidentsForAPerson().rows).toMatchObject([
        { piece: work.piece, kind, recovery: { because: 'program', resumesAt: null } },
      ])
      expect(notices(owner)).toHaveLength(0)
      await cycle()
      expect(receipts(owner, work.piece).filter((one) => one.step === 'person')).toHaveLength(1)
    },
  )

  it('a persisted sign-in recovery that lost its reopen at restart reads failed with null resume time', async () => {
    const { owner, work } = await create()
    record(owner, { type: 'user_turn', text: 'Fictional sign-in cut work', drives: work.piece })
    const turn = store.theNewestTurn(owner)!
    record(owner, {
      type: 'work_recovery',
      turn,
      pieces: [work.piece],
      since: clock,
      phase: 'pending',
    })
    await host.closeAll()
    host = build()
    await cycle()
    expect(host.workIncidentsForAPerson().rows).toMatchObject([
      {
        piece: work.piece,
        kind: 'recovery-failed',
        recovery: { because: 'sign-in', resumesAt: null },
      },
    ])
    expect(notices(owner)).toHaveLength(0)
  })

  it.each([
    'holder-waits',
    'giver-closes',
    'person',
    'turn-ended-holder-waits',
    'turn-ended-person',
    'turn-ended-failed',
    'turn-ended-person-with-history',
    'turn-ended-person-with-rollback-history',
    'turn-ended-person-with-tied-history',
  ] as const)('the actual holder → giver → person receipts end at %s', async (outcome) => {
    keepTurnsOpen = true
    const { owner } = await create()
    const call = async (caller: string, name: string, args: Record<string, unknown>) => {
      const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)!
      const result = (await tool.call(args)).structured as Record<string, unknown>
      expect(result).toMatchObject({ outcome: 'ok' })
      return result
    }
    const child = await call(owner, 'give_work', {
      profile: 'fictional-worker',
      new: true,
      title: 'Fictional owned work',
      brief: 'Produce a checked result.',
      definition_of_done: 'The result is checked.',
    })
    const holder = child.agent as string
    const piece = child.piece as string
    const ordinary = outcome.startsWith('turn-ended-')
    const resolution = outcome.replace('turn-ended-', '').replace(/-with.*history$/, '')
    if (resolution === 'failed') {
      const admission = host as unknown as { reconciliationMayWake(target: string): boolean }
      const mayWake = admission.reconciliationMayWake.bind(host)
      vi.spyOn(admission, 'reconciliationMayWake').mockImplementation(
        (target) => target !== holder && mayWake(target),
      )
    }
    const finish = (at: number) =>
      (
        handles[at] as unknown as {
          machine: { completeTurn(state: 'completed' | 'interrupted'): void }
        }
      ).machine.completeTurn('completed')
    await waitFor(() => store.theOpenTurn(holder) !== null, 'the original brief turn')
    const historical = outcome.includes('history')
    let previousReceiptAt: number | null = null
    if (historical) {
      // An already-recorded pre-upgrade notice, before this host's first reconciliation.
      const engine = host as unknown as { reconcileWork(holders?: ReadonlySet<string>): void }
      const paused = vi.spyOn(engine, 'reconcileWork').mockImplementation(() => {})
      try {
        finish(1)
        await waitFor(
          () => store.piecesOwnedBy(holder)[0]?.stalledBecause === 'turn_ended',
          'the old ordinary ending',
        )
        record(owner, { type: 'work_stall_told', piece, cause: 'turn_ended', how: 'pushed' })
      } finally {
        paused.mockRestore()
      }
      captureLegacyCut()
      previousReceiptAt = store
        .events(owner)
        .filter((row) => row.event.type === 'work_stall_told')
        .at(-1)!.at
      expect(store.legacyOrdinaryStallWasReported(holder, piece, owner)).toBe(true)
      await cycle()
      await cycle()
      expect(notices(holder)).toHaveLength(0)
      if (outcome.includes('rollback')) clock -= 1_000_000
      if (outcome.includes('tied')) {
        clock = previousReceiptAt!
        freezeClock = true
      }
      await call(owner, 'message_agent', {
        agent: holder,
        piece,
        kind: 'follow-up',
        text: 'Resume this fictional piece.',
      })
      await waitFor(() => store.theOpenTurn(holder) !== null, 'the resumed piece turn')
      expect(store.piecesOwnedBy(holder)[0]!.state).toBe('working')
    }
    if (!ordinary) waiting(holder, piece)
    else
      record(holder, {
        type: 'assistant_message',
        text: 'Which fictional opening would you like to practise?',
      })
    const engine = host as unknown as {
      reconcileWork(holders?: ReadonlySet<string>): void
      reconciliationReading(piece: string): { rows: { issue: { cause?: string } | null }[] }
    }
    const paused = ordinary ? vi.spyOn(engine, 'reconcileWork').mockImplementation(() => {}) : null
    finish(1)
    if (ordinary) {
      try {
        await waitFor(() => store.theOpenTurn(holder) === null, 'the original ordinary ending')
        expect(
          store.events(owner).filter((row) => row.event.type === 'work_stall_told'),
        ).toHaveLength(historical ? 1 : 0)
        if (outcome.includes('rollback'))
          expect(store.piecesOwnedBy(holder)[0]!.stalledAt).toBeLessThan(previousReceiptAt!)
        if (outcome.includes('tied'))
          expect(store.piecesOwnedBy(holder)[0]!.stalledAt).toBe(previousReceiptAt)
        expect(engine.reconciliationReading(piece).rows[0]?.issue).toMatchObject({
          cause: 'turn_ended',
        })
      } finally {
        paused?.mockRestore()
      }
      await cycle()
      expect(
        store.events(owner).filter((one) => one.event.type === 'work_stall_told'),
      ).toHaveLength(historical ? 1 : 0)
    }
    await waitFor(
      () =>
        receipts(holder, piece).some(
          (one) =>
            one.step === 'holder' &&
            one.outcome === (resolution === 'failed' ? 'failed' : 'delivered'),
        ),
      'holder reminder',
    )
    if (resolution !== 'failed')
      await waitFor(
        () =>
          store.reconciliationDelivery(holder, receipts(holder, piece)[0]!.messageId!) ===
          'running',
        'actual reminded holder turn',
      )
    if (resolution !== 'failed') {
      const label = store.workById(piece)!.label
      expect(notices(holder)[0]!.event).toMatchObject({
        text: ordinary
          ? `${label} needs attention: its turn ended with this work still open. If your last message already gave the finished result, hand it back now with reply_to_parent and don't repeat it. A question asked in chat is not tracked. Use ask_question for a question, request_action for an action the person must take, or update_work with on to record what it waits on. Otherwise carry on with it or finish it.`
          : `${label} needs attention: its wait names nothing that ends it. If your last message already gave the finished result, hand it back now with reply_to_parent and don't repeat it. Carry on with it, finish it, or say what it waits on with update_work (on).`,
      })
    }
    if (ordinary) {
      expect(
        store.events(owner).filter((one) => one.event.type === 'work_stall_told'),
      ).toHaveLength(historical ? 1 : 0)
      expect(host.stalledWorkForAPerson().rows.some((one) => one.piece === piece)).toBe(false)
      if (resolution !== 'failed') {
        expect(notices(holder)[0]!.event).toMatchObject({
          text: expect.not.stringContaining('Which fictional opening'),
        })
        await cycle()
        expect(notices(holder)).toHaveLength(1)
      }
    }
    if (resolution !== 'failed') expect(notices(owner)).toHaveLength(0)
    if (resolution === 'holder-waits') {
      await call(holder, 'update_work', {
        piece,
        status: 'waiting until tomorrow',
        on: { time: new Date(clock + 3_600_000).toISOString() },
      })
      finish(1)
      await cycle()
      expect(receipts(holder, piece).at(-1)?.step).toBe('resolved')
      expect(notices(owner)).toHaveLength(0)
      expect(host.workIncidentsForAPerson().rows).toEqual([])
      if (ordinary) {
        await host.closeAll()
        host = build()
        await settle()
        await cycle()
        expect(notices(owner)).toHaveLength(0)
        expect(notices(holder)).toHaveLength(1)
        expect(host.workIncidentsForAPerson().rows).toEqual([])
      }
      return
    }
    if (resolution !== 'failed') finish(1)
    await waitFor(
      () =>
        receipts(holder, piece).some((one) => one.step === 'giver' && one.outcome === 'delivered'),
      'giver notice',
    )
    const giver = receipts(holder, piece).find((one) => one.step === 'giver')!
    await waitFor(
      () => store.reconciliationDelivery(owner, giver.messageId!) === 'running',
      'actual giver turn',
    )
    expect(host.workIncidentsForAPerson().rows).toEqual([])
    if (resolution === 'giver-closes') await call(owner, 'update_work', { piece, close: true })
    finish(0)
    await cycle()
    if (resolution === 'giver-closes') {
      expect(receipts(holder, piece).at(-1)?.step).toBe('giver')
      expect(host.workIncidentsForAPerson().rows).toEqual([])
    } else {
      expect(receipts(holder, piece).at(-1)?.step).toBe('person')
      expect(host.workIncidentsForAPerson().rows).toMatchObject([
        {
          piece,
          told:
            resolution === 'failed'
              ? { giver: expect.any(Number) }
              : { holder: expect.any(Number), giver: expect.any(Number) },
        },
      ])
    }
    await cycle()
    expect(notices(holder)).toHaveLength(resolution === 'failed' ? 0 : 1)
    expect(notices(owner)).toHaveLength(1)
    if (ordinary) {
      await host.closeAll()
      host = build()
      await settle()
      await cycle()
      await cycle()
      expect(notices(holder)).toHaveLength(resolution === 'failed' ? 0 : 1)
      expect(notices(owner)).toHaveLength(1)
      expect(
        store.events(owner).filter((one) => one.event.type === 'work_stall_told'),
      ).toHaveLength(historical ? 1 : 0)
    }
  })

  it.each([1, 2])(
    'a legacy receipt in replacement giver 1 survives a %s-hop lineage and restart',
    async (hops) => {
      keepTurnsOpen = true
      const { owner } = await create()
      const tool = agentToolsFor(host, owner).tools.find((one) => one.name === 'give_work')!
      const given = (
        await tool.call({
          profile: 'fictional-lineage-worker',
          new: true,
          title: 'Fictional legacy work',
          brief: 'Check the result.',
          definition_of_done: 'A checked result.',
        })
      ).structured as { agent: string; piece: string }
      const { agent: holder, piece } = given
      await waitFor(() => store.theOpenTurn(holder) !== null, 'the old holder turn')
      const engine = host as unknown as { reconcileWork(holders?: ReadonlySet<string>): void }
      const paused = vi.spyOn(engine, 'reconcileWork').mockImplementation(() => {})
      try {
        ;(
          handles[1] as unknown as { machine: { completeTurn(state: 'completed'): void } }
        ).machine.completeTurn('completed')
        await waitFor(() => store.theOpenTurn(holder) === null, 'the old ordinary ending')
        let previous = owner
        for (let hop = 1; hop <= hops; hop++) {
          const { sessionId: next } = await host.createSession(
            {
              provider: 'claude',
              profileId: `fictional-replacement-${hop}`,
              approvalMode: 'auto',
              cwd: root,
            },
            window,
          )
          record(previous, { type: 'replaced_by', sessionId: next })
          record(next, { type: 'replaces', sessionId: previous })
          if (hop === 1)
            record(next, { type: 'work_stall_told', piece, cause: 'turn_ended', how: 'pushed' })
          previous = next
        }
        captureLegacyCut()
      } finally {
        paused.mockRestore()
      }
      expect(store.workById(piece)?.givenBy).toBe(owner)
      expect(store.workReportedTo(owner).has(piece)).toBe(false)
      expect(store.legacyOrdinaryStallWasReported(holder, piece, owner)).toBe(true)
      await cycle()
      await cycle()
      expect(receipts(holder, piece)).toEqual([])
      expect(notices(holder)).toHaveLength(0)
      await host.closeAll()
      host = build()
      await cycle()
      await cycle()
      expect(store.legacyOrdinaryStallWasReported(holder, piece, owner)).toBe(true)
      expect(receipts(holder, piece)).toEqual([])
      expect(notices(holder)).toHaveLength(0)
      expect(store.reconciliationOwners().flatMap((id) => notices(id))).toEqual([])
    },
  )

  it.each(['receipt-giver', 'later-giver'] as const)(
    'an incomplete legacy giver read in the %s still reminds the holder',
    async (where) => {
      keepTurnsOpen = true
      const { owner } = await create()
      const given = (
        await agentToolsFor(host, owner)
          .tools.find((one) => one.name === 'give_work')!
          .call({
            profile: 'fictional-incomplete-proof-worker',
            new: true,
            title: 'Fictional legacy work',
            brief: 'Check the result.',
            definition_of_done: 'A checked result.',
          })
      ).structured as { agent: string; piece: string }
      const { agent: holder, piece } = given
      await waitFor(() => store.theOpenTurn(holder) !== null, 'the old holder turn')
      const engine = host as unknown as {
        reconcileWork(holders?: ReadonlySet<string>): void
        reconciliationReading(piece: string): { rows: { issue: { cause?: string } | null }[] }
      }
      const paused = vi.spyOn(engine, 'reconcileWork').mockImplementation(() => {})
      try {
        ;(
          handles[1] as unknown as { machine: { completeTurn(state: 'completed'): void } }
        ).machine.completeTurn('completed')
        await waitFor(() => store.theOpenTurn(holder) === null, 'the old ordinary ending')
        const receiptGiver = await host.createSession(
          {
            provider: 'claude',
            profileId: 'fictional-receipt-giver',
            approvalMode: 'auto',
            cwd: root,
          },
          window,
        )
        record(owner, { type: 'replaced_by', sessionId: receiptGiver.sessionId })
        record(receiptGiver.sessionId, { type: 'replaces', sessionId: owner })
        const held = (giver: string, messageId: string) => {
          record(giver, {
            type: 'message_queued',
            messageId,
            text: 'Fictional notice.',
            kind: 'notice',
          })
          record(giver, {
            type: 'work_stall_told',
            piece,
            cause: 'turn_ended',
            how: 'pushed',
            messageId,
          })
        }
        held(receiptGiver.sessionId, 'fictional-standing-receipt')
        let unreadGiver = receiptGiver.sessionId
        if (where === 'later-giver') {
          const next = await host.createSession(
            {
              provider: 'claude',
              profileId: 'fictional-unread-giver',
              approvalMode: 'auto',
              cwd: root,
            },
            window,
          )
          record(receiptGiver.sessionId, { type: 'replaced_by', sessionId: next.sessionId })
          record(next.sessionId, { type: 'replaces', sessionId: receiptGiver.sessionId })
          unreadGiver = next.sessionId
          held(unreadGiver, 'fictional-torn-receipt')
        }
        const messageId =
          where === 'later-giver' ? 'fictional-torn-receipt' : 'fictional-standing-receipt'
        const ordinal = store.nextOrdinal(unreadGiver)
        record(unreadGiver, {
          type: 'message_unqueued',
          messageId,
          reason: 'abandoned',
          text: 'Fictional notice.',
        })
        captureLegacyCut()
        expect(store.legacyOrdinaryStallWasReported(holder, piece, owner)).toBe(
          where === 'later-giver',
        )
        db.prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = ?').run(
          '{',
          unreadGiver,
          ordinal,
        )
        record(unreadGiver, {
          type: 'work_stall_told',
          piece: 'fictional-other-piece',
          cause: 'turn_ended',
          how: 'pushed',
        })
        expect(store.workReportedTo(receiptGiver.sessionId).has(piece)).toBe(true)
        expect(store.legacyOrdinaryStallWasReported(holder, piece, owner)).toBe(false)
        expect(engine.reconciliationReading(piece).rows[0]?.issue).toMatchObject({
          cause: 'turn_ended',
        })
      } finally {
        paused.mockRestore()
      }
      await cycle()
      expect([...new Set(receipts(holder, piece).map((one) => one.step))]).toEqual(['holder'])
      expect(notices(holder)).toHaveLength(1)
      expect(store.reconciliationDelivery(holder, receipts(holder, piece)[0]!.messageId!)).toBe(
        'running',
      )
      await cycle()
      expect(notices(holder)).toHaveLength(1)
    },
  )

  it('a generation rebuilt after the legacy cut rejects old proof and reminds its next stalled turn', async () => {
    keepTurnsOpen = true
    const { owner } = await create()
    const given = (
      await agentToolsFor(host, owner)
        .tools.find((one) => one.name === 'give_work')!
        .call({
          profile: 'fictional-rebuilt-worker',
          new: true,
          title: 'Fictional rebuilt work',
          brief: 'Check the result.',
          definition_of_done: 'A checked result.',
        })
    ).structured as { agent: string; piece: string }
    const { agent: holder, piece } = given
    await waitFor(() => store.theOpenTurn(holder) !== null, 'the old holder turn')
    const engine = host as unknown as { reconcileWork(holders?: ReadonlySet<string>): void }
    const paused = vi.spyOn(engine, 'reconcileWork').mockImplementation(() => {})
    try {
      ;(
        handles[1] as unknown as { machine: { completeTurn(state: 'completed'): void } }
      ).machine.completeTurn('completed')
      await waitFor(() => store.theOpenTurn(holder) === null, 'the old ordinary ending')
      record(owner, { type: 'work_stall_told', piece, cause: 'turn_ended', how: 'pushed' })
      captureLegacyCut()
      expect(store.legacyOrdinaryStallWasReported(holder, piece, owner)).toBe(true)
    } finally {
      paused.mockRestore()
    }
    await host.closeAll()
    const oldGeneration = store.theActiveGeneration(holder)
    const source = store
      .events(holder)
      .filter((one) => ['work_given', 'user_turn', 'turn'].includes(one.event.type))
    const generation = store.beginGeneration(holder)
    expect(generation).not.toBe(oldGeneration)
    const entries = source.map((one, ordinal) => ({ ordinal, event: one.event, at: tick() }))
    const cut = db
      .prepare('SELECT generation, through_ordinal FROM work_legacy_stall_cut WHERE session_id = ?')
      .get(holder) as { generation: number; through_ordinal: number }
    expect(cut.generation).toBe(oldGeneration)
    expect(entries.at(-1)!.ordinal).toBeLessThanOrEqual(cut.through_ordinal)
    store.appendGeneration(holder, generation, entries)
    expect(
      store.promoteGeneration(holder, generation, {
        normalizerVersion: 1,
        derivedThrough: entries.length,
      }),
    ).toBe(true)
    expect(store.piecesOwnedBy(holder)).toMatchObject([
      { piece, state: 'stalled', stalledBecause: 'turn_ended' },
    ])
    expect(store.workReportedTo(owner).has(piece)).toBe(true)
    expect(store.legacyOrdinaryStallWasReported(holder, piece, owner)).toBe(false)
    host = build()
    await cycle()
    expect([...new Set(receipts(holder, piece).map((one) => one.step))]).toEqual(['holder'])
    expect(notices(holder)).toHaveLength(1)
    expect(notices(owner)).toHaveLength(0)
    await cycle()
    expect(notices(holder)).toHaveLength(1)
  })

  it('a reminder held at admission is retracted if a valid wait arrives before handover', async () => {
    const { owner, work } = await create()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    ;(handles[0] as unknown as { checkSignIn(): Promise<boolean> }).checkSignIn = async () => {
      await gate
      return false
    }
    try {
      waiting(owner, work.piece)
      await cycle()
      expect(notices(owner)).toHaveLength(1)
      waiting(owner, work.piece, { kind: 'time', at: clock + 3_600_000 })
    } finally {
      release()
    }
    await cycle()
    expect(
      store
        .messagesWaitingIn(owner)
        .filter((one) => one.authorship.appNotice === 'a-work-wait-needs-attention'),
    ).toEqual([])
    expect(
      store
        .events(owner)
        .filter(
          (one) =>
            one.event.type === 'user_turn' && one.event.appNotice === 'a-work-wait-needs-attention',
        ),
    ).toEqual([])
    expect(receipts(owner, work.piece).at(-1)?.step).toBe('resolved')
    expect(host.workIncidentsForAPerson().rows).toEqual([])
  })

  it('a failed provider start removes its exact held reminder instead of leaving it for an unrelated reopen', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await host.closeAll()
    host = build()
    failResume = true
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'failed start ladder',
    )
    expect(notices(owner)).toHaveLength(1)
    expect(
      store
        .messagesWaitingIn(owner)
        .filter((one) => one.authorship.appNotice === 'a-work-wait-needs-attention'),
    ).toEqual([])
    expect(host.workIncidentsForAPerson().rows).toMatchObject([
      { piece: work.piece, kind: 'notice-not-delivered' },
    ])
  })

  it('two already running holders take their reminders without the provider-start pacing gap', async () => {
    await host.closeAll()
    startGap = 5_000
    host = build()
    const a = await create()
    const b = await create()
    waiting(a.owner, a.work.piece)
    waiting(b.owner, b.work.piece)
    await cycle()
    await waitFor(
      () =>
        [a, b].every(({ owner, work }) =>
          receipts(owner, work.piece).some(
            (one) => one.step === 'holder' && one.outcome === 'delivered',
          ),
        ),
      'both live reminders without a new start',
    )
    expect(handles).toHaveLength(2)
    expect(notices(a.owner)).toHaveLength(1)
    expect(notices(b.owner)).toHaveLength(1)
  })

  it('an archived holder stays outside the visible incident list and is never woken', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    expect(await host.archiveConversation(owner)).toMatchObject({ done: true })
    await cycle()
    expect(notices(owner)).toHaveLength(0)
    expect(host.workIncidentsForAPerson().rows).toEqual([])
  })

  it('an unread root line is unavailable, without claiming there are no incidents', async () => {
    const { owner, work } = await create()
    record(owner, {
      type: 'work_status_set',
      piece: work.piece,
      line: 5,
      by: owner,
      waiting: true,
    } as unknown as TranscriptEvent)
    await cycle()
    expect(notices(owner)).toHaveLength(0)
    expect(host.workIncidentsForAPerson().rows).toEqual([])
    expect(host.workIncidentsForAPerson().ledgersSkipped).toBeGreaterThan(0)
  })

  it('a root waiting on an actual person request is not woken by its older expired status line', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece, { kind: 'time', at: clock - 1 })
    const tool = agentToolsFor(host, owner).tools.find((one) => one.name === 'ask_question')!
    const result = (
      await tool.call({
        piece: work.label,
        who_answers: 'a-person',
        question: 'Which fictional file comes first?',
      })
    ).structured as Record<string, unknown>
    expect(result).toMatchObject({ outcome: 'ok' })
    expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toContain(
      result.question,
    )
    await cycle()
    expect(notices(owner)).toHaveLength(0)
    expect(receipts(owner, work.piece)).toEqual([])
    expect(host.workIncidentsForAPerson().rows).toEqual([])
  })

  it('an open to-do is a valid person wait; its answer ends that target exactly once', async () => {
    const { owner, work } = await create()
    const tools = agentToolsFor(host, owner).tools
    const asked = (
      await tools
        .find((one) => one.name === 'request_action')!
        .call({
          piece: work.label,
          action: 'Check the fictional result.',
        })
    ).structured as Record<string, unknown>
    expect(asked).toMatchObject({ outcome: 'ok' })
    const request = asked.question as string
    const status = await tools
      .find((one) => one.name === 'update_work')!
      .call({
        piece: work.label,
        status: 'Waiting for the check',
        on: { person: request },
      })
    expect(status.structured).toMatchObject({ outcome: 'ok' })
    await cycle()
    expect(notices(owner)).toEqual([])
    expect(receipts(owner, work.piece)).toEqual([])
    expect(await host.answerAction(owner, request, true, null, window)).toEqual({
      outcome: 'taken',
    })
    await settle()
    await cycle()
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'the answered to-do wait',
    )
    expect(notices(owner)).toHaveLength(1)
    expect(host.workIncidentsForAPerson().rows).toMatchObject([
      { piece: work.piece, kind: 'wait-target-ended' },
    ])
    await cycle()
    expect(notices(owner)).toHaveLength(1)
  })

  it('a listed incident is hidden while its holder resumes actual work', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await cycle()
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'the incident to reach the person',
    )
    expect(host.workIncidentsForAPerson().rows).toHaveLength(1)
    const machine = (handles.at(-1)! as unknown as { machine: { beginTurn(): number | null } })
      .machine
    handles.at(-1)!.send = async () => {
      machine.beginTurn()
    }
    await host.send(owner, 'Carry on with the fictional work.', window)
    await waitFor(() => store.theOpenTurn(owner) !== null, 'the new working turn')
    await cycle()
    expect(host.workIncidentsForAPerson().rows).toEqual([])
    expect(notices(owner)).toHaveLength(1)
  })

  it('a giver new wait never inherits an old person receipt before the next tick', async () => {
    keepTurnsOpen = true
    const { owner } = await create()
    const tools = agentToolsFor(host, owner).tools
    const given = (
      await tools
        .find((one) => one.name === 'give_work')!
        .call({
          profile: 'fictional-idle-worker',
          new: true,
          title: 'Fictional result',
          brief: 'Check it.',
          definition_of_done: 'Checked.',
        })
    ).structured as Record<string, unknown>
    expect(given).toMatchObject({ outcome: 'ok' })
    const holder = given.agent as string
    const piece = given.piece as string
    waiting(holder, piece)
    const finish = (index: number) =>
      (
        handles[index] as unknown as {
          machine: { completeTurn(state: 'completed'): void }
        }
      ).machine.completeTurn('completed')
    await waitFor(() => store.theOpenTurn(holder) !== null, 'original worker turn')
    finish(1)
    await waitFor(
      () =>
        receipts(holder, piece).some((one) => one.step === 'holder' && one.outcome === 'delivered'),
      'holder reminder',
    )
    await waitFor(() => store.theOpenTurn(holder) !== null, 'reminded worker turn')
    finish(1)
    await waitFor(
      () =>
        receipts(holder, piece).some((one) => one.step === 'giver' && one.outcome === 'delivered'),
      'giver turn',
    )
    await waitFor(() => store.theOpenTurn(owner) !== null, 'giver reminder turn')
    finish(0)
    await cycle()
    await waitFor(
      () => receipts(holder, piece).some((one) => one.step === 'person'),
      'old wait person phase',
    )
    expect(host.workIncidentsForAPerson().rows.some((one) => one.piece === piece)).toBe(true)
    await host.send(owner, 'Set a new short wait on the work.', window)
    await waitFor(() => store.theOpenTurn(owner) !== null, 'giver own running turn')
    expect(store.theOpenTurn(holder)).toBeNull()
    // Hold the scheduled pass so this control reads the ledger before any reconciliation.
    ;(host as unknown as { workReconciler: { close(): void } }).workReconciler.close()
    const previous = receipts(holder, piece).at(-1)!.incident
    const at = clock + 60_000
    expect(
      (
        await tools
          .find((one) => one.name === 'update_work')!
          .call({
            piece,
            status: 'Until the new short time',
            on: { time: new Date(at).toISOString() },
          })
      ).structured,
    ).toMatchObject({ outcome: 'ok' })
    await settle()
    expect(host.workIncidentsForAPerson().rows.some((one) => one.piece === piece)).toBe(false)
    clock = at
    expect(receipts(holder, piece).at(-1)?.incident).toBe(previous)
    expect(store.theOpenTurn(owner)).not.toBeNull()
    expect(store.theOpenTurn(holder)).toBeNull()
    expect(host.workIncidentsForAPerson().rows.some((one) => one.piece === piece)).toBe(false)
  })

  it('startup reconciliation waits for the first window load without holding the launch', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await host.closeAll()
    let loaded!: () => void
    firstLoad = new Promise<void>((resolve) => {
      loaded = resolve
    })
    host = build()
    await settle()
    expect(notices(owner)).toHaveLength(0)
    loaded()
    await waitFor(() => notices(owner).length === 1, 'deferred startup reminder')
  })

  it('a newly recorded valid time wait gets a fresh wake if it expires before the next scan', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await cycle()
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'the first ladder',
    )
    const first = receipts(owner, work.piece)[0]!.incident
    const at = clock + 3_600_000
    const tool = agentToolsFor(host, owner).tools.find((one) => one.name === 'update_work')!
    expect(
      (
        await tool.call({
          piece: work.label,
          status: 'Until the new time',
          on: { time: new Date(at).toISOString() },
        })
      ).structured,
    ).toMatchObject({ outcome: 'ok' })
    clock = at
    await cycle()
    expect(notices(owner)).toHaveLength(2)
    expect(
      receipts(owner, work.piece).some((one) => one.incident === first && one.step === 'resolved'),
    ).toBe(true)
    expect(
      new Set(
        receipts(owner, work.piece)
          .filter((one) => one.step === 'holder')
          .map((one) => one.incident),
      ).size,
    ).toBe(2)
  })

  it('a cross-holder target ending is found in its touched pass without a tick', async () => {
    const a = await create()
    const b = await create()
    const given = await agentToolsFor(host, b.owner)
      .tools.find((one) => one.name === 'give_work')!
      .call({
        profile: 'cross-holder-worker',
        new: true,
        title: 'Target',
        brief: 'A fictional target.',
        definition_of_done: 'A checked result.',
      })
    const target = given.structured as { piece: string; label: string; agent: string }
    await settle()
    waiting(a.owner, a.work.piece, { kind: 'agent', piece: target.piece, label: target.label })
    const engine = (
      host as unknown as { workReconciler: { run(owners?: ReadonlySet<string>): Promise<void> } }
    ).workReconciler
    await engine.run()
    expect(receipts(a.owner, a.work.piece)).toEqual([])
    record(target.agent, {
      type: 'work_replied',
      piece: target.piece,
      outcome: 'done',
      summary: 'Checked.',
      resources: [],
    })
    await settle()
    expect(receipts(a.owner, a.work.piece)[0]).toMatchObject({
      kind: 'wait-target-ended',
      step: 'holder',
    })
  })

  it.each([false, 0, [], {}, '', 'x'.repeat(513)].map((key) => ({ key })))(
    'an invalid receipt piece key $key cannot authorize an empty history',
    async ({ key }) => {
      const { owner, work } = await create()
      waiting(owner, work.piece)
      const ordinal = store.nextOrdinal(owner)
      db.prepare(
        'INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at) VALUES (?,?,?,?,?,?,?)',
      ).run(
        'invalid-key',
        owner,
        0,
        ordinal,
        'work_reconciliation',
        JSON.stringify({
          type: 'work_reconciliation',
          piece: key,
          incident: 'invalid',
          kind: 'wait-target-ended',
          since: clock,
          step: 'person',
          outcome: 'listed',
        }),
        tick(),
      )
      expect(() => receipts(owner, work.piece)).toThrow('could not be read')
      await cycle()
      expect(notices(owner)).toHaveLength(0)
      expect(host.workIncidentsForAPerson().rowsUnread).toBeGreaterThan(0)
    },
  )

  it('async notice freshness reads the carried piece directly and persists its exact reference', async () => {
    const { owner, work } = await create()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    ;(handles[0] as unknown as { checkSignIn(): Promise<boolean> }).checkSignIn = async () => {
      await gate
      return false
    }
    try {
      waiting(owner, work.piece)
      await cycle()
      const receipt = receipts(owner, work.piece).find((one) => one.step === 'holder')!
      expect(receipt).toBeDefined()
      const point = vi.spyOn(store, 'reconciliationReceipts')
      const own = vi.spyOn(store, 'reconciliationReceiptsForOwner')
      const legacy = vi.fn(() => {
        throw new Error('an unbounded notice history read was attempted')
      })
      Object.assign(store, { reconciliationNotice: legacy })
      const check = host as unknown as {
        reconciliationNoticeStillGoes(target: string, message: string, piece?: string): boolean
      }
      expect(check.reconciliationNoticeStillGoes(owner, receipt.messageId!, work.piece)).toBe(true)
      expect(point).toHaveBeenCalledWith(owner, work.piece)
      expect(own).not.toHaveBeenCalled()
      expect(legacy).not.toHaveBeenCalled()
      expect(notices(owner)[0]!.event).toMatchObject({ about: work.piece })
      expect(check.reconciliationNoticeStillGoes(owner, receipt.messageId!, 'not-this-piece')).toBe(
        false,
      )
      expect(check.reconciliationNoticeStillGoes(owner, receipt.messageId!)).toBe(false)
      expect(check.reconciliationNoticeStillGoes(owner, 'not-this-message', work.piece)).toBe(false)
    } finally {
      release()
    }
    await settle()
  })

  it.each(['withdraw', 'answer'] as const)(
    'a giver request %s revisits its waiting holder without a tick',
    async (ending) => {
      const { owner } = await create()
      keepTurnsOpen = true
      const call = async (who: string, name: string, input: Record<string, unknown>) => {
        const answer = (
          await agentToolsFor(host, who)
            .tools.find((one) => one.name === name)!
            .call(input)
        ).structured as Record<string, unknown>
        expect(answer).toMatchObject({ outcome: 'ok' })
        return answer
      }
      const a = await call(owner, 'give_work', {
        profile: 'request-holder',
        new: true,
        title: 'Waiting work',
        brief: 'A fictional piece.',
        definition_of_done: 'Checked.',
      })
      const b = await call(owner, 'give_work', {
        profile: 'request-answerer',
        new: true,
        title: 'Other work',
        brief: 'Another fictional piece.',
        definition_of_done: 'Checked.',
      })
      await settle()
      const asked = await call(owner, 'ask_question', {
        who_answers: 'an-agent',
        agent: b.label,
        question: 'Which fictional result?',
        interrupt: false,
      })
      const question = asked.question as string
      await call(owner, 'update_work', {
        piece: a.piece,
        status: 'Waiting for the requested answer',
        on: { agent: question },
      })
      ;(
        handles[1] as unknown as { machine: { completeTurn(state: 'completed'): void } }
      ).machine.completeTurn('completed')
      await settle()
      expect(receipts(a.agent as string, a.piece as string)).toEqual([])
      if (ending === 'withdraw') await call(owner, 'withdraw_question', { question })
      else
        await call(b.agent as string, 'answer_question', {
          question,
          answers: [{ part: 'answer', answer: ['Checked.'] }],
          interrupt: false,
        })
      await settle()
      expect(receipts(a.agent as string, a.piece as string)[0]).toMatchObject({
        kind: 'wait-target-ended',
        step: 'holder',
      })
    },
  )

  it('writes verify only the changed piece receipts and never reread the owner history', async () => {
    const { owner, work } = await create()
    await settle()
    const history = vi.spyOn(store, 'reconciliationReceiptsForOwner')
    const point = vi.spyOn(store, 'reconciliationReceipts')
    waiting(owner, work.piece)
    await cycle()
    expect(receipts(owner, work.piece).length).toBeGreaterThan(0)
    expect(history).not.toHaveBeenCalled()
    expect(
      point.mock.calls.every(([holder, piece]) => holder === owner && piece === work.piece),
    ).toBe(true)
  })

  it('indexed receipt reads keep generations and reject unread history', async () => {
    const { owner, work } = await create()
    const row: WorkReconciliationEvent = {
      type: 'work_reconciliation',
      incident: 'old',
      piece: work.piece,
      kind: 'wait-target-ended',
      since: clock,
      step: 'person',
      outcome: 'listed',
    }
    record(owner, row)
    record(owner, { ...row, incident: 'other', piece: 'another-piece' })
    expect(receipts(owner, work.piece).map((one) => one.incident)).toEqual(['old'])
    const insert = db.prepare(
      'INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at) VALUES (?,?,?,?,?,?,?)',
    )
    insert.run(
      'next-generation',
      owner,
      1,
      0,
      'work_reconciliation',
      JSON.stringify({ ...row, incident: 'next' }),
      tick(),
    )
    expect(receipts(owner, work.piece).map((one) => one.incident)).toEqual(['old', 'next'])
    insert.run(
      'torn-receipt',
      owner,
      0,
      store.nextOrdinal(owner),
      'work_reconciliation',
      '{',
      tick(),
    )
    expect(() => receipts(owner, work.piece)).toThrow('could not be read')
  })

  it('receipt reads use only the open pieces instead of the owner history', async () => {
    const { owner, work } = await create()
    await settle()
    waiting(owner, work.piece, { kind: 'time', at: clock + 3_600_000 })
    const point = vi.spyOn(store, 'reconciliationReceipts')
    const batch = vi.spyOn(store, 'reconciliationReceiptsForOwner')
    await (
      host as unknown as { workReconciler: { run(owners: ReadonlySet<string>): Promise<void> } }
    ).workReconciler.run(new Set([owner]))
    expect(point).toHaveBeenCalledTimes(1)
    expect(point).toHaveBeenCalledWith(owner, work.piece)
    expect(batch).not.toHaveBeenCalled()
  })

  it('a turn ending reconciles its touched holder without enumerating the whole roster', async () => {
    const { owner } = await create()
    await settle()
    const roster = vi.spyOn(store, 'reconciliationOwners')
    await host.send(owner, 'A fictional ordinary turn.', window)
    await settle()
    expect(roster).not.toHaveBeenCalled()
  })

  it('reuses only incident dependencies until a write, with the same canonical answer', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await host.interrupt(owner, window)
    await cycle()
    const held = vi.spyOn(store, 'messagesWaitingIn')
    const stop = vi.spyOn(store, 'lastAskToStop')
    const slots = (host as unknown as { slots: Map<string, unknown> }).slots
    const adopted = new Map(slots)
    slots.clear()
    try {
      const first = host.workIncidentsForAPerson()
      expect(first.rows).toHaveLength(1)
      const calls = [held.mock.calls.length, stop.mock.calls.length]
      expect(calls.every((n) => n > 0)).toBe(true)
      expect(host.workIncidentsForAPerson()).toEqual(first)
      expect([held.mock.calls.length, stop.mock.calls.length]).toEqual(calls)
      record(owner, {
        type: 'message_queued',
        messageId: 'fictional-drive',
        text: 'Carry on.',
        kind: 'work',
      })
      const changed = host.workIncidentsForAPerson()
      expect(changed.rows).toEqual([])
      expect(held.mock.calls.length).toBeGreaterThan(calls[0]!)
      const after = [held.mock.calls.length, stop.mock.calls.length]
      expect(host.workIncidentsForAPerson()).toEqual(changed)
      expect([held.mock.calls.length, stop.mock.calls.length]).toEqual(after)
      stampsAvailable = false
      expect(host.workIncidentsForAPerson()).toEqual(changed)
      record(owner, {
        type: 'message_unqueued',
        messageId: 'fictional-drive',
        text: 'Carry on.',
        reason: 'sent',
      })
      const canonical = host.workIncidentsForAPerson()
      expect(canonical.rows).toHaveLength(1)
      stampsAvailable = true
      expect(host.workIncidentsForAPerson()).toEqual(canonical)
      const starts = (host as unknown as { startsInFlight: Map<string, Promise<string>> })
        .startsInFlight
      starts.set(owner, Promise.resolve(owner))
      try {
        expect(host.workIncidentsForAPerson().rows).toEqual([])
      } finally {
        starts.delete(owner)
      }
      expect(host.workIncidentsForAPerson()).toEqual(canonical)
      expect(() =>
        db.transaction(() => {
          record(owner, {
            type: 'message_queued',
            messageId: 'fictional-rolled-back',
            kind: 'work',
            text: 'Uncommitted words.',
          })
          expect(host.workIncidentsForAPerson().rows).toEqual([])
          throw new Error('fictional rollback')
        })(),
      ).toThrow('fictional rollback')
      expect(host.workIncidentsForAPerson()).toEqual(canonical)
      const beforeExternal = held.mock.calls.length
      const external = openDatabase(join(userData, 'brobot2.sqlite'))
      try {
        external
          .prepare(
            "UPDATE events SET payload = ? WHERE session_id = ? AND type = 'message_unqueued'",
          )
          .run(
            JSON.stringify({
              type: 'message_unqueued',
              messageId: 'fictional-drive',
              text: 'Changed externally.',
              reason: 'sent',
            }),
            owner,
          )
      } finally {
        external.close()
      }
      expect(host.workIncidentsForAPerson()).toEqual(canonical)
      expect(held.mock.calls.length).toBeGreaterThan(beforeExternal)
    } finally {
      for (const [id, slot] of adopted) slots.set(id, slot)
    }
  })

  it('reads incident facts off the writer and sees a just-written held message or ending', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await host.interrupt(owner, window)
    await cycle()
    ;(host as unknown as { workReconciler: { close(): void } }).workReconciler.close()
    clearInterval(
      (host as unknown as { reconciliationTimer: ReturnType<typeof setInterval> })
        .reconciliationTimer,
    )
    const slots = (host as unknown as { slots: Map<string, unknown> }).slots
    const adopted = new Map(slots)
    slots.clear()
    const engine = new WindowReadEngine(join(userData, 'brobot2.sqlite'))
    const deps = (host as unknown as { deps: RuntimeHostDeps }).deps
    const nativeHeld = vi.spyOn(store, 'messagesWaitingIn').mockImplementation(() => {
      throw new Error('held messages folded on main')
    })
    const nativeStop = vi.spyOn(store, 'lastAskToStop').mockImplementation(() => {
      throw new Error('Stop folded on main')
    })
    const read = vi.fn<WindowStoreReader['read']>(async (query) => engine.read(query))
    deps.windowReader = { read, close: async () => {} }
    const look = () => executeRuntimeCommand(host, window, { kind: 'workIncidentsForAPerson' })
    try {
      expect(await look()).toMatchObject({ rows: [{ piece: work.piece }], rowsUnread: 0 })
      record(owner, {
        type: 'message_queued',
        messageId: 'fresh-held',
        text: 'Carry on.',
        kind: 'work',
      })
      expect(await look()).toMatchObject({ rows: [], rowsUnread: 0 })
      record(owner, {
        type: 'message_unqueued',
        messageId: 'fresh-held',
        text: 'Carry on.',
        reason: 'sent',
      })
      expect(await look()).toMatchObject({ rows: [{ piece: work.piece }], rowsUnread: 0 })
      record(owner, { type: 'status', state: 'working' })
      const stale = engine.read({ kind: 'incidents' })
      let release!: () => void
      read.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(stale)
          }),
      )
      const pending = look()
      await expect(look()).rejects.toThrow(WindowReadUnavailable)
      record(owner, {
        type: 'message_queued',
        messageId: 'during-read',
        text: 'New words.',
        kind: 'work',
      })
      release()
      expect(await pending).toMatchObject({ rows: [], rowsUnread: 0 })
      expect(read).toHaveBeenCalledTimes(5)
      expect(read.mock.calls.every(([query]) => query.kind === 'incidents')).toBe(true)
      expect(await look()).toMatchObject({ rows: [], rowsUnread: 0 })
      expect(read).toHaveBeenCalledTimes(5)
      expect(nativeHeld).not.toHaveBeenCalled()
      expect(nativeStop).not.toHaveBeenCalled()
    } finally {
      delete deps.windowReader
      engine.close()
      for (const [id, slot] of adopted) slots.set(id, slot)
    }
  })

  async function incidentWindow() {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await host.interrupt(owner, window)
    await cycle()
    ;(host as unknown as { workReconciler: { close(): void } }).workReconciler.close()
    clearInterval(
      (host as unknown as { reconciliationTimer: ReturnType<typeof setInterval> })
        .reconciliationTimer,
    )
    const slots = (host as unknown as { slots: Map<string, unknown> }).slots
    const adopted = new Map(slots)
    slots.clear()
    const engine = new WindowReadEngine(join(userData, 'brobot2.sqlite'))
    const deps = (host as unknown as { deps: RuntimeHostDeps }).deps
    const read = vi.fn<WindowStoreReader['read']>(async (query) => engine.read(query))
    deps.windowReader = { read, close: async () => {} }
    const main = vi.spyOn(host, 'workIncidentsForAPerson')
    return {
      owner,
      work,
      engine,
      read,
      main,
      look: () => executeRuntimeCommand(host, window, { kind: 'workIncidentsForAPerson' }),
      close() {
        delete deps.windowReader
        engine.close()
        for (const [id, slot] of adopted) slots.set(id, slot)
      },
    }
  }

  it.each(['failed', 'abandoned', 'unsampled', 'moved'] as const)(
    'incident worker %s gets fresh main answers at most once per thirty seconds',
    async (failure) => {
      const fixture = await incidentWindow()
      let at = 1000
      vi.spyOn(performance, 'now').mockImplementation(() => at)
      if (failure === 'unsampled') stampsAvailable = false
      else if (failure === 'moved')
        fixture.read.mockImplementation(async (query) => {
          const result = fixture.engine.read(query)
          record(fixture.owner, { type: 'status', state: 'working' })
          return result
        })
      else
        fixture.read.mockRejectedValue(
          new WindowReadUnavailable(failure === 'failed' ? 'failed' : 'unavailable'),
        )
      try {
        expect(await fixture.look()).toMatchObject({
          rows: [{ piece: fixture.work.piece }],
          rowsUnread: 0,
        })
        expect(fixture.main).toHaveBeenCalledTimes(1)
        record(fixture.owner, {
          type: 'message_queued',
          messageId: 'fresh-during-outage',
          text: 'Fictional words.',
          kind: 'work',
        })
        for (at of [1001, 16000, 30999])
          await expect(fixture.look()).rejects.toThrow(WindowReadUnavailable)
        expect(fixture.main).toHaveBeenCalledTimes(1)
        at = 31000
        expect(await fixture.look()).toMatchObject({ rows: [], rowsUnread: 0 })
        expect(fixture.main).toHaveBeenCalledTimes(2)
        record(fixture.owner, {
          type: 'message_unqueued',
          messageId: 'fresh-during-outage',
          text: 'Fictional words.',
          reason: 'sent',
        })
        at = 61000
        expect(await fixture.look()).toMatchObject({
          rows: [{ piece: fixture.work.piece }],
          rowsUnread: 0,
        })
        expect(fixture.main).toHaveBeenCalledTimes(3)
      } finally {
        fixture.close()
      }
    },
  )

  it('incident worker busy never runs the main fallback', async () => {
    const fixture = await incidentWindow()
    try {
      fixture.read.mockRejectedValueOnce(new WindowReadUnavailable('busy'))
      await expect(fixture.look()).rejects.toThrow(WindowReadUnavailable)
      expect(fixture.main).not.toHaveBeenCalled()
      let release!: () => void
      fixture.read.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(fixture.engine.read({ kind: 'incidents' }))
          }),
      )
      const first = fixture.look()
      await expect(fixture.look()).rejects.toThrow(WindowReadUnavailable)
      expect(fixture.main).not.toHaveBeenCalled()
      release()
      expect(await first).toMatchObject({ rows: [{ piece: fixture.work.piece }] })
      expect(fixture.main).not.toHaveBeenCalled()
      const admitted = host as unknown as { windowReadCallers: number }
      admitted.windowReadCallers = WINDOW_READ_BOUNDS.callers
      await expect(fixture.look()).rejects.toThrow(WindowReadUnavailable)
      expect(fixture.main).not.toHaveBeenCalled()
      admitted.windowReadCallers = 0
    } finally {
      fixture.close()
    }
  })

  it('incident worker quit refuses a late failure without a main fallback', async () => {
    const fixture = await incidentWindow()
    try {
      let reject!: (error: unknown) => void
      fixture.read.mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail
          }),
      )
      const pending = fixture.look()
      ;(host as unknown as { launches: { closeAdmission(): void } }).launches.closeAdmission()
      reject(new WindowReadUnavailable('failed'))
      await expect(pending).rejects.toThrow(WindowReadUnavailable)
      await expect(fixture.look()).rejects.toThrow(/shutting down/)
      delete (host as unknown as { deps: RuntimeHostDeps }).deps.windowReader
      await expect(host.workIncidentsForWindow()).rejects.toThrow(WindowReadUnavailable)
      expect(fixture.main).not.toHaveBeenCalled()
    } finally {
      fixture.close()
    }
  })

  it.runIf(process.env['W736_INCIDENT_BENCH'] !== undefined)(
    'measures main-thread incident reads by dependency on a large fictional ledger',
    async () => {
      const owners: Awaited<ReturnType<typeof create>>[] = []
      for (let i = 0; i < 8; i++) owners.push(await create())
      await settle()
      ;(host as unknown as { workReconciler: { close(): void } }).workReconciler.close()
      clearInterval(
        (host as unknown as { reconciliationTimer: ReturnType<typeof setInterval> })
          .reconciliationTimer,
      )
      const ordinals = new Map(owners.map(({ owner }) => [owner, store.nextOrdinal(owner)]))
      const append = (owner: string, event: TranscriptEvent) => {
        const n = ordinals.get(owner)!
        ordinals.set(owner, n + 1)
        store.append(owner, n, event, tick())
      }
      db.transaction(() => {
        for (const { owner } of owners) {
          append(owner, {
            type: 'question_asked',
            requestId: 'bench-request',
            prompt: 'Fictional question',
            questions: [{ id: 'part', prompt: 'Which option?', options: [] }],
          })
          append(owner, { type: 'request_routed', requestId: 'bench-request', to: 'a-person' })
          append(owner, { type: 'request_resolved', id: 'bench-request' })
          for (let i = 0; i < 4375; i++) append(owner, { type: 'status', state: 'working' })
        }
        for (let i = 1; i <= 5050; i++) {
          const { owner, work } = owners[i % owners.length]!
          const piece = `incident-bench-${i}`
          const n = ordinals.get(owner)!
          ordinals.set(owner, n + 1)
          store.recordGive(
            {
              piece,
              parent: work.piece,
              number: i,
              owner,
              givenBy: null,
              title: piece,
              brief: 'Fictional work.',
              folder: null,
              inputs: [],
            },
            n,
            {
              type: 'work_given',
              piece,
              label: `${work.label}.${i}`,
              parent: work.piece,
              givenBy: null,
              title: piece,
              brief: 'Fictional work.',
            },
            tick(),
          )
          append(
            owner,
            i <= 5000
              ? { type: 'work_replied', piece, outcome: 'done', summary: 'Checked.', resources: [] }
              : {
                  type: 'work_status_set',
                  piece,
                  line: 'Fictional waiting',
                  by: owner,
                  waiting: true,
                },
          )
          if (i <= 5000)
            for (let j = 0; j < 2; j++)
              append(owner, {
                type: 'work_reconciliation',
                piece,
                incident: piece,
                kind: 'wait-target-ended',
                since: clock,
                step: 'resolved',
                outcome: 'resolved',
              })
        }
        for (const { owner } of owners)
          for (let i = 0; i < 1000; i++) {
            const messageId = `fictional-held-${i}`
            const text = 'Fictional words. ' + 'x'.repeat(1000)
            append(owner, {
              type: 'message_queued',
              messageId,
              kind: 'work',
              text,
            })
            append(owner, { type: 'message_unqueued', messageId, text, reason: 'sent' })
          }
        const count = (db.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n
        for (let i = count; i < 100000; i++)
          append(owners[0]!.owner, {
            type: 'memory_note',
            notes: [{ path: '/fictional/notes/benchmark.md', bytes: 0 }],
          })
      })()
      const histogram = db
        .prepare('SELECT type, count(*) AS n FROM events GROUP BY type ORDER BY type')
        .all()
      expect((db.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n).toBe(100000)
      const classify = (name: string): string => {
        if (name === 'messagesWaitingIn') return 'held messages'
        if (/Receipts|Receipt|reconciliationDelivery/.test(name)) return 'receipts'
        if (/Recovery|DrivenByTurn|theNewestTurn/.test(name)) return 'recovery'
        if (/routedRequests|questionsRaised/.test(name)) return 'routes and questions'
        if (
          /reconciliation|Pieces|pieces|rootLines|RootLines|lastAskToStop|lastEndedTurn|workReportedTo/.test(
            name,
          )
        )
          return 'pieces and waits'
        return 'other'
      }
      let trace: Record<string, { calls: number; ms: number }> | undefined
      const scope = store as unknown as Record<string, (...args: unknown[]) => unknown>
      for (const name of Object.keys(scope)) {
        const original = scope[name]
        if (typeof original !== 'function') continue
        scope[name] = (...args) => {
          if (trace === undefined) return original.apply(store, args)
          const began = performance.now()
          try {
            return original.apply(store, args)
          } finally {
            const entry = trace[name] ?? { calls: 0, ms: 0 }
            entry.calls++
            entry.ms += performance.now() - began
            trace[name] = entry
          }
        }
      }
      const mode = process.env['W896_INCIDENT_MODE'] ?? 'main'
      let reader: WindowWorkerReader | undefined
      if (mode === 'worker') {
        const entry = await bundleAWorker(
          'src/main/window-reader.worker.ts',
          userData,
          'incident-worker.cjs',
        )
        reader = new WindowWorkerReader(
          new Worker(entry, { workerData: { file: join(userData, 'brobot2.sqlite') } }),
        )
        ;(host as unknown as { deps: RuntimeHostDeps }).deps.windowReader = reader
      }
      const measure = async (name: string) => {
        trace = {}
        const began = performance.now()
        const cpu = process.threadCpuUsage()
        const answer =
          mode === 'worker' ? await host.workIncidentsForWindow() : host.workIncidentsForAPerson()
        const used = process.threadCpuUsage(cpu)
        const mainThreadMs = (used.user + used.system) / 1000
        const ms = performance.now() - began
        const methods = trace
        trace = undefined
        const groups: Record<string, { calls: number; ms: number }> = {}
        for (const [method, value] of Object.entries(methods)) {
          const group = groups[classify(method)] ?? { calls: 0, ms: 0 }
          group.calls += value.calls
          group.ms += value.ms
          groups[classify(method)] = group
        }
        expect(answer.rowsUnread).toBe(0)
        return { name, ms, mainThreadMs, rows: answer.rows.length, groups, methods }
      }
      // Unadopted conversations read their held messages from the record, not a live mailbox.
      const slots = (host as unknown as { slots: Map<string, unknown> }).slots
      const adopted = new Map(slots)
      slots.clear()
      try {
        const cold = await measure('cold')
        const steady: Awaited<ReturnType<typeof measure>>[] = []
        for (let i = 0; i < 10; i++) steady.push(await measure('unchanged'))
        const writing: Awaited<ReturnType<typeof measure>>[] = []
        for (let i = 0; i < 10; i++) {
          append(owners[0]!.owner, { type: 'status', state: 'working' })
          writing.push(await measure('after working status'))
        }
        const result = {
          mode,
          source: process.env['W736_INCIDENT_BENCH'],
          adopted: false,
          owners: owners.length,
          ended: 5000,
          open: 50,
          routedStatuses: 35000,
          heldMessagePairs: 8000,
          historicalReceipts: 10000,
          eventsBeforeMeasurement: 100000,
          histogram,
          cold,
          steady,
          writing,
        }
        console.log('Main-thread incidents', JSON.stringify(result))
        if (process.env['W736_INCIDENT_OUTPUT'])
          writeFileSync(process.env['W736_INCIDENT_OUTPUT'], JSON.stringify(result, null, 2))
        if (mode === 'worker') {
          expect(writing.every((one) => one.mainThreadMs < 10)).toBe(true)
          expect(
            writing.every(
              (one) =>
                one.methods['messagesWaitingIn'] === undefined &&
                one.methods['lastAskToStop'] === undefined,
            ),
          ).toBe(true)
        }
      } finally {
        await reader?.close()
        for (const [id, slot] of adopted) slots.set(id, slot)
      }
    },
    120000,
  )

  it.runIf(process.env['W671_RECONCILIATION_BENCH'] !== undefined)(
    'measures the same 5000-ended 50-open 100000-event ledger',
    async () => {
      const { owner, work } = await create()
      clearInterval(
        (host as unknown as { reconciliationTimer: ReturnType<typeof setInterval> })
          .reconciliationTimer,
      )
      let ordinal = store.nextOrdinal(owner)
      db.transaction(() => {
        for (let i = 1; i <= 5050; i++) {
          const piece = `bench-${i}`
          store.recordGive(
            {
              piece,
              parent: work.piece,
              number: i,
              owner,
              givenBy: null,
              title: piece,
              brief: 'Fictional performance work.',
              folder: null,
              inputs: [],
            },
            ordinal++,
            {
              type: 'work_given',
              piece,
              label: `${work.label}.${i}`,
              parent: work.piece,
              givenBy: null,
              title: piece,
              brief: 'Fictional performance work.',
            },
            tick(),
          )
          store.append(
            owner,
            ordinal++,
            i <= 5000
              ? {
                  type: 'work_replied',
                  piece,
                  outcome: 'done',
                  summary: 'Checked.',
                  resources: [],
                }
              : {
                  type: 'work_status_set',
                  piece,
                  line: 'Until tomorrow',
                  by: owner,
                  waiting: true,
                  on: { kind: 'time', at: clock + 86_400_000 },
                },
            tick(),
          )
        }
        const count = (db.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n
        for (let i = count; i < 100000; i++)
          store.append(
            owner,
            ordinal++,
            {
              type: 'memory_note',
              notes: [{ path: '/fictional/notes/benchmark.md', bytes: 0 }],
            },
            tick(),
          )
      })()
      const engine = (
        host as unknown as { workReconciler: { run(owners?: ReadonlySet<string>): Promise<void> } }
      ).workReconciler
      const trace: Record<string, { calls: number; ms: number }> = {}
      if (process.env['W671_PROFILE']) {
        const scope = store as unknown as Record<string, (...args: unknown[]) => unknown>
        for (const name of [
          'reconciliationWork',
          'openPiecesOf',
          'piecesOwnedBy',
          'turnBlockRootLines',
          'rootLines',
          'routedRequestsOf',
          'questionsRaisedIn',
          'piecesGivenBy',
          'messagesWaitingIn',
          'reconciliationRecovery',
          'reconciliationReceiptsForOwner',
        ]) {
          const original = scope[name]
          if (original === undefined) continue
          scope[name] = (...args) => {
            const began = performance.now()
            try {
              return original.apply(store, args)
            } finally {
              const entry = trace[name] ?? { calls: 0, ms: 0 }
              entry.calls++
              entry.ms += performance.now() - began
              trace[name] = entry
            }
          }
        }
      }
      const sample = async (owners?: ReadonlySet<string>) => {
        const began = performance.now()
        await engine.run(owners)
        return performance.now() - began
      }
      const cold = await sample()
      const full = []
      const touched = []
      for (let i = 0; i < (process.env['W671_RECONCILIATION_BENCH'] === 'before' ? 1 : 10); i++) {
        full.push(await sample())
        touched.push(await sample(new Set([owner])))
      }
      expect(store.openPiecesOf(owner)).toHaveLength(50)
      expect((db.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n).toBe(100000)
      const result = {
        source: process.env['W671_RECONCILIATION_BENCH'],
        cold,
        full,
        touched,
        ended: 5000,
        open: 50,
        events: 100000,
        trace,
      }
      console.log(
        'Reconciliation benchmark:',
        JSON.stringify(result),
        'trace',
        JSON.stringify(trace),
      )
      if (process.env['W671_BENCH_OUTPUT'])
        writeFileSync(process.env['W671_BENCH_OUTPUT'], JSON.stringify(result, null, 2))
      if (process.env['W671_RECONCILIATION_BENCH'] === 'after') {
        expect(Math.max(...full)).toBeLessThan(20)
        expect(Math.max(...touched)).toBeLessThan(2)
      }
    },
    360000,
  )

  it.runIf(process.env['W671_RECEIPT_BENCH'] !== undefined)(
    'measures a write-heavy touched pass beside 10000 historical receipts',
    async () => {
      const { owner, work } = await create()
      await settle()
      clearInterval(
        (host as unknown as { reconciliationTimer: ReturnType<typeof setInterval> })
          .reconciliationTimer,
      )
      await host.closeAll()
      let ordinal = store.nextOrdinal(owner)
      db.transaction(() => {
        for (let i = 1; i <= 2000; i++) {
          const piece = `past-${i}`
          store.recordGive(
            {
              piece,
              parent: work.piece,
              number: i,
              owner,
              givenBy: null,
              title: piece,
              brief: 'Fictional past work.',
              folder: null,
              inputs: [],
            },
            ordinal++,
            {
              type: 'work_given',
              piece,
              label: `${work.label}.${i}`,
              parent: work.piece,
              givenBy: null,
              title: piece,
              brief: 'Fictional past work.',
            },
            tick(),
          )
          store.append(
            owner,
            ordinal++,
            { type: 'work_replied', piece, outcome: 'done', summary: 'Checked.', resources: [] },
            tick(),
          )
          for (let j = 0; j < 5; j++)
            store.append(
              owner,
              ordinal++,
              {
                type: 'work_reconciliation',
                piece,
                incident: piece,
                kind: 'wait-target-ended',
                since: clock,
                step: j === 4 ? 'resolved' : 'holder',
                outcome: j === 4 ? 'resolved' : 'delivered',
                target: owner,
                messageId: `past-message-${i}-${j}`,
              },
              tick(),
            )
        }
      })()
      expect(store.reconciliationReceiptsForOwner(owner)).toHaveLength(10000)
      firstLoad = new Promise<void>(() => {})
      host = build()
      const engine = (
        host as unknown as { workReconciler: { run(owners?: ReadonlySet<string>): Promise<void> } }
      ).workReconciler
      const keep = vi.spyOn(
        host as unknown as {
          keepReconciliation(owner: string, event: WorkReconciliationEvent): boolean
        },
        'keepReconciliation',
      )
      // A stopped holder records the person step synchronously; no provider is timed here.
      record(owner, { type: 'work_interrupted', by: 'a-person' })
      const trace: Record<string, { calls: number; ms: number }> = {}
      if (process.env['W671_PROFILE']) {
        const scope = store as unknown as Record<string, (...args: unknown[]) => unknown>
        for (const name of [
          'reconciliationWork',
          'piecesOwnedBy',
          'turnBlockRootLines',
          'rootLines',
          'reconciliationReceipts',
          'reconciliationReceiptsForOwner',
          'append',
          'lastAskToStop',
          'routedRequestsOf',
          'messagesWaitingIn',
          'nextOrdinal',
        ]) {
          const original = scope[name]
          if (original === undefined) continue
          scope[name] = (...args) => {
            const began = performance.now()
            try {
              return original.apply(store, args)
            } finally {
              const entry = trace[name] ?? { calls: 0, ms: 0 }
              entry.calls++
              entry.ms += performance.now() - began
              trace[name] = entry
            }
          }
        }
      }
      const times: number[] = []
      for (let i = 0; i < 10; i++) {
        waiting(owner, work.piece, { kind: 'agent', piece: `missing-${i}`, label: 'W99.1' })
        // Warm the canonical work fold equally before each paired transition measurement.
        ;(host as unknown as { reconciliationReading(): unknown }).reconciliationReading()
        const began = performance.now()
        await engine.run(new Set([owner]))
        times.push(performance.now() - began)
      }
      const result = {
        source: process.env['W671_RECEIPT_BENCH'],
        times,
        max: Math.max(...times),
        history: 10000,
        historicalPieces: 2000,
        transitions: keep.mock.calls.length,
        trace,
      }
      console.log('Receipt benchmark:', JSON.stringify(result))
      if (process.env['W671_BENCH_OUTPUT'])
        writeFileSync(process.env['W671_BENCH_OUTPUT'], JSON.stringify(result, null, 2))
      expect(keep.mock.calls).toHaveLength(19)
      expect(keep.mock.results.every((one) => one.type === 'return' && one.value === true)).toBe(
        true,
      )
      expect(receipts(owner, work.piece)).toHaveLength(19)
      if (process.env['W671_RECEIPT_BENCH'] === 'after') expect(result.max).toBeLessThan(2)
    },
    120000,
  )
})
