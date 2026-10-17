import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, SessionMachine } from '@brobot2/runtime'
import type {
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  RuntimeEvent,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * # 🔴 D-033 · a turn that moves a piece of work is heard by every window at once
 *
 * ⚑ A piece moves without any verb when a turn ends with it open (stalled, or waiting on the person
 * who asked), when a turn drives it again, when a card its provider raises makes it wait on a
 * person, and when the last background work it waited on ends. `RuntimeHost.sayWhenItsWorkMoved`
 * compares each OPEN piece, as a window draws it, with the holder's last read and says `work`
 * ONCE when one moved.
 *
 * ⛔ **And the negative half is as load-bearing as the positive one**: a row that moves nothing
 * says nothing, an ended piece is the verb's that ended it, a new piece opened `working` is the
 * give's, and a background level that cannot stall held work reads nothing at all.
 *
 * ⚑ Every count is taken through the real host on the fake runtime, with a turn that stays
 * `working` until the test ends it (the production {@link SessionMachine} decides the lifecycle).
 * Each announcement is stamped with the newest row of the watched conversation at that moment, so
 * a count can say WHICH row's read made it.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** ⚑ A few macrotasks — long enough for the pump to drain what a push queued, and no longer. */
async function settle(): Promise<void> {
  for (let n = 0; n < 5; n++) await new Promise((resolve) => setTimeout(resolve, 10))
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

/** ⚑ The fake runtime, with each start's handle passed through a decoration a test chooses. */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    private readonly decorate: (handle: FakeSessionHandle) => FakeSessionHandle,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = this.decorate(await super.start(options))
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

/** The machine and the queue behind each held handle, so a test ends its turns by hand. */
const controls = new Map<
  FakeSessionHandle,
  { machine: SessionMachine; queue: AsyncQueue<RuntimeEvent> }
>()

/**
 * ⚑ **A turn that stays `working` until the test ends it** — `state-a-supervisor-can-trust`'s
 * instrument. ⛔ The fake's own turn parks on a permission card; these pieces must be driven by a
 * turn nobody is asked anything in, so the only move is the one the test makes.
 */
function holdingAWorkingTurn(handle: FakeSessionHandle): FakeSessionHandle {
  const queue = new AsyncQueue<RuntimeEvent>()
  let status = handle.status()
  const machine = new SessionMachine((event) => {
    if (event.type === 'status') status = event.state
    queue.push(event)
  })
  machine.markStarting()
  machine.sessionStarted(handle.ref, 'started')
  let closing: Promise<void> | null = null
  const proxy = new Proxy(handle, {
    get(target, property) {
      if (property === 'events') return (): AsyncIterable<RuntimeEvent> => queue
      if (property === 'status') return () => status
      if (property === 'waitForAPerson') {
        return (): (() => void) => {
          machine.beginWait()
          let held = true
          return () => {
            if (!held) return
            held = false
            machine.endWait()
          }
        }
      }
      if (property === 'send') {
        return async (): Promise<void> => {
          if (machine.beginTurn() === null) {
            throw new Error('cannot send: session is not active or a turn is in progress')
          }
        }
      }
      if (property === 'interrupt') {
        return async (): Promise<void> => {
          machine.requestInterrupt()
          machine.completeTurn('interrupted')
        }
      }
      if (property === 'close') {
        return (): Promise<void> =>
          (closing ??= (async () => {
            if (machine.beginClose()) {
              if (machine.hasProviderWork) machine.forceEnd(false)
              machine.closeSession(handle.ref)
              queue.close()
            }
            await target.close()
          })())
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
  controls.set(proxy, { machine, queue })
  return proxy
}

type Level = Extract<RuntimeEvent, { type: 'background_work' }>

/** ⚑ A background level, as Claude's adapter writes one: what is running now. */
const level = (ids: readonly string[]): Level => ({
  type: 'background_work',
  running: ids.map((id) => ({ id, kind: 'local_bash', description: `sleep ${id}` })),
  source: 'background_tasks_changed',
})

/** ⚑ The host's one composed read of what a conversation holds — private, spied by name. */
interface HoldsARead {
  whatItHolds(holder: string): unknown
}

describe('D-033 · a turn that moves a piece of work is heard by every window at once', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let decorateNextHandle: ((handle: FakeSessionHandle) => FakeSessionHandle) | null
  /** ⚑ Each announcement, with the newest row of the watched conversation at that moment. */
  let announced: { what: string; at: string }[]
  let watched: string | null

  const tick = (): number => clock++

  const newestRowOf = (sessionId: string | null): string => {
    if (sessionId === null) return '-'
    const last = store.events(sessionId).at(-1)?.event as
      { type: string; state?: string } | undefined
    return last === undefined
      ? '-'
      : `${last.type}${last.state === undefined ? '' : `:${last.state}`}`
  }

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, (handle) => {
          const decorate = decorateNextHandle
          decorateNextHandle = null
          return decorate?.(handle) ?? handle
        }),
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
      announce: (message) => announced.push({ what: message.what, at: newestRowOf(watched) }),
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d033-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d033-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    announced = []
    watched = null
    issued = new FakeProviderSessions()
    decorateNextHandle = null
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string, provider: Provider = 'claude'): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider, profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const controlsOf = (handle: FakeSessionHandle) => {
    const held = controls.get(handle)
    if (held === undefined) throw new Error('that handle was not decorated')
    return held
  }

  /** ⚑ Every `work` announcement since the last reset, with the row that was newest then. */
  const work = () => announced.filter((one) => one.what === 'work')

  /** ⚑ A pm, and a worker it gave one piece to, whose turn stays `working` until a test ends it. */
  const aWorkerOnItsPiece = async () => {
    const bring = await personOpens('worker')
    await host.close(bring, window)
    const pm = await personOpens('pm')
    const pmTools = agentToolsFor(host, pm)
    decorateNextHandle = holdingAWorkingTurn
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work',
      brief: 'do the work',
    })
    decorateNextHandle = null
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const handle = handles.at(-1) as FakeSessionHandle
    const label = given.label as string
    watched = worker
    const row = () => store.piecesOwnedBy(worker).find((one) => one.label === label)
    const pieceState = (): string | undefined => row()?.state
    await waitFor(
      () => handle.status() === 'working' && pieceState() === 'working',
      'the worker on its piece',
    )
    await settle()
    const { machine, queue } = controlsOf(handle)
    return { pm, pmTools, worker, handle, label, row, pieceState, machine, queue }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a turn’s end and a turn’s drive, each said once', () => {
    it('🔴 a plain turn end stalls the piece and says so ONCE, from the turn’s own row', async () => {
      const w = await aWorkerOnItsPiece()
      announced = []
      w.machine.completeTurn('completed')
      await waitFor(() => w.pieceState() === 'stalled', 'the piece to stall')
      await settle()
      expect(w.row()?.stalledBecause).toBe('turn_ended')
      // ⚑ ONE, and made by the read after the `turn` row — not by the `idle` after it, which reads
      // the same stall and must say nothing.
      expect(work().filter((one) => one.at === 'turn:completed')).toHaveLength(1)
      expect(work()).toHaveLength(3)
      const givenNotices = store
        .events(w.pm)
        .filter(
          (one) =>
            one.event.type === 'message_queued' &&
            one.event.appNotice === 'a-work-wait-needs-attention',
        )
      expect(givenNotices).toHaveLength(1)
      expect(
        store
          .reconciliationReceiptsForOwner(w.worker)
          .filter((one) => one.step === 'giver' && one.outcome === 'delivered'),
      ).toHaveLength(1)
    })

    it('⛔ …and rows that move nothing say nothing — a repeated status, a message', async () => {
      const w = await aWorkerOnItsPiece()
      w.machine.completeTurn('completed')
      await waitFor(() => w.pieceState() === 'stalled', 'the piece to stall')
      await settle()
      announced = []
      w.queue.push({ type: 'status', state: 'idle' })
      w.queue.push({ type: 'assistant_message', text: 'still here' } as RuntimeEvent)
      await waitFor(
        () => store.events(w.worker).some((entry) => entry.event.type === 'assistant_message'),
        'the message to be recorded',
      )
      await settle()
      expect(w.pieceState()).toBe('stalled')
      expect(work()).toHaveLength(0)
    })

    it('🔴 a follow-up that drives the stalled piece again says so ONCE', async () => {
      const w = await aWorkerOnItsPiece()
      w.machine.completeTurn('completed')
      await waitFor(() => w.pieceState() === 'stalled', 'the piece to stall')
      await settle()
      announced = []
      const followed = await callOn(w.pmTools, 'message_agent', {
        agent: w.worker,
        text: 'go on',
        kind: 'follow-up',
        piece: w.label,
      })
      expect(followed.outcome, JSON.stringify(followed)).toBe('ok')
      await waitFor(() => w.pieceState() === 'working', 'the piece driven again')
      await settle()
      expect(work()).toHaveLength(1)
    })
  })

  describe('§2 · every cause a turn ends on is said, with its cause', () => {
    it('🔴 a turn that ends on a usage limit stalls it as `provider_limited`, said once', async () => {
      const w = await aWorkerOnItsPiece()
      announced = []
      w.machine.completeTurn('failed', 'limit', {
        provider: 'claude',
        window: 'five_hour',
        resetsAt: 9_999_999,
      })
      await waitFor(() => w.pieceState() === 'stalled', 'the piece to stall on the limit')
      await settle()
      expect(w.row()?.stalledBecause).toBe('provider_limited')
      expect(work()).toHaveLength(1)
      expect(work()[0]?.at).toBe('turn:failed')
    })

    it('🔴 a turn that fails on a refused login stalls it as `login_refused`, said at the turn', async () => {
      const w = await aWorkerOnItsPiece()
      announced = []
      w.queue.push({ type: 'turn', state: 'failed', loginRefused: true })
      await waitFor(() => w.pieceState() === 'stalled', 'the piece to stall on the login')
      await settle()
      expect(w.row()?.stalledBecause).toBe('login_refused')
      // ⚑ Said by the turn row's read. ⚠️ An ending's teardown may announce again (accepted), so
      // only the turn's own announcement is counted.
      expect(work().filter((one) => one.at === 'turn:failed')).toHaveLength(1)
    })
  })

  describe('§3 · a piece a person gave waits on them, and their words drive it again', () => {
    it('🔴 its turn ends → waiting on the person, said once; the person’s next words → said once', async () => {
      decorateNextHandle = holdingAWorkingTurn
      const pm = await personOpens('pm')
      decorateNextHandle = null
      const handle = handles.at(-1) as FakeSessionHandle
      const { machine } = controlsOf(handle)
      watched = pm
      await host.send(pm, 'please look into the login page', window)
      await waitFor(() => handle.status() === 'working', 'the pm to work')
      const took = await callOn(agentToolsFor(host, pm), 'take_on_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        title: 'Look into the login page',
        brief: 'Find why it is slow.',
      })
      expect(took.outcome, JSON.stringify(took)).toBe('ok')
      const label = took.label as string
      const state = (): string | undefined =>
        store.piecesOwnedBy(pm).find((one) => one.label === label)?.state
      await settle()

      announced = []
      machine.completeTurn('completed')
      await waitFor(
        () => state() === 'waiting-on-the-person-who-asked',
        'the piece to wait on the person',
      )
      await settle()
      // ⚑ Not a stall — a piece a person gave waits on them — and still a move a window draws.
      expect(work()).toHaveLength(1)

      announced = []
      host.send(pm, 'go on', window)
      await waitFor(() => state() === 'working', 'the piece driven again')
      await settle()
      expect(work()).toHaveLength(1)
    })
  })

  describe('§4 · a card its provider raises makes it wait on a person', () => {
    it('🔴 the permission card the worker parks on is said, at the `waiting_permission` row', async () => {
      const bring = await personOpens('worker')
      await host.close(bring, window)
      const pm = await personOpens('pm')
      // ⚑ The worker this give starts takes the next id, so its rows are watched from its start.
      watched = `sess_${String(counter + 1)}`
      announced = []
      const given = await callOn(agentToolsFor(host, pm), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the work',
        brief: 'do the work',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const worker = given.agent as string
      expect(worker, 'the worker took another id than the one watched').toBe(watched)
      await waitFor(
        () => store.events(worker).some((entry) => entry.event.type === 'permission_request'),
        'the worker to park on its card',
      )
      await settle()
      // ⚑ The give's own announcement, and then the card's — said by the status the card wrote.
      expect(work().some((one) => one.at === 'work_given')).toBe(true)
      expect(work().some((one) => one.at === 'status:waiting_permission')).toBe(true)
    })
  })

  describe('§5 · held for the background: said when the LAST of it ends', () => {
    it('🔴 one of two ending says nothing; the last ending stalls it and says so once', async () => {
      const w = await aWorkerOnItsPiece()
      w.queue.push(level(['b1', 'b2']))
      await settle()
      w.machine.completeTurn('completed')
      await settle()
      // ⚑ The premise: the turn ended over background work, so the piece is held, not stalled.
      expect(w.pieceState()).toBe('working')

      announced = []
      w.queue.push(level(['b2']))
      await settle()
      expect(w.pieceState()).toBe('working')
      expect(work()).toHaveLength(0)

      w.queue.push(level([]))
      await waitFor(() => w.pieceState() === 'stalled', 'the held piece to stall')
      await settle()
      expect(work()).toHaveLength(1)
      expect(work()[0]?.at).toBe('background_work')
    })

    /**
     * ⛔ **The level hook reads only at the row that can stall held work** — on a provider whose
     * background wakes it, and only when the row leaves nothing running. ⚑ Counted by the host's one
     * composed read, so a guard that went would read at every level row of every stream.
     */
    it('⛔ a level that leaves work running reads nothing; the one that leaves none reads (Claude)', async () => {
      decorateNextHandle = holdingAWorkingTurn
      const mine = await personOpens('pm', 'claude')
      decorateNextHandle = null
      const { queue } = controlsOf(handles.at(-1) as FakeSessionHandle)
      await settle()
      const read = vi.spyOn(host as unknown as HoldsARead, 'whatItHolds')
      const readsOf = (): number => read.mock.calls.filter(([holder]) => holder === mine).length

      queue.push(level(['b1', 'b2']))
      queue.push(level(['b2']))
      await settle()
      expect(readsOf(), 'a level that left work running read what it holds').toBe(0)

      queue.push(level([]))
      await settle()
      expect(readsOf(), 'the level that left nothing running read nothing').toBeGreaterThan(0)
    })

    it('⛔ …and on Codex, whose background wakes nothing, no level row reads at all', async () => {
      decorateNextHandle = holdingAWorkingTurn
      const mine = await personOpens('pm', 'codex')
      decorateNextHandle = null
      const { queue } = controlsOf(handles.at(-1) as FakeSessionHandle)
      await settle()
      const read = vi.spyOn(host as unknown as HoldsARead, 'whatItHolds')
      const readsOf = (): number => read.mock.calls.filter(([holder]) => holder === mine).length

      queue.push(level(['b1']))
      queue.push(level([]))
      await settle()
      expect(readsOf(), 'a Codex level row read what its conversation holds').toBe(0)
    })
  })

  describe('§6 · what is not the turn’s to say', () => {
    it('⛔ an ENDED piece is never counted — the reply that ended it said so', async () => {
      const w = await aWorkerOnItsPiece()
      const piece = w.row()?.piece
      if (piece === undefined) throw new Error('the give opened no piece')
      const replied = await callOn(agentToolsFor(host, w.worker), 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: 'finished',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      await waitFor(() => {
        const state = w.pieceState()
        return state !== undefined && !TASK_IS_OPEN[state as keyof typeof TASK_IS_OPEN]
      }, 'the reply to end the piece')
      await settle()

      announced = []
      const rowsBefore = store.events(w.worker).length
      w.machine.completeTurn('completed')
      await waitFor(
        () =>
          store
            .events(w.worker)
            .slice(rowsBefore)
            .some((entry) => entry.event.type === 'turn'),
        'the turn row',
      )
      await settle()
      // ⚑ The premise: the piece really is ended, and the turn's end did not reopen it.
      expect(TASK_IS_OPEN[w.pieceState() as keyof typeof TASK_IS_OPEN]).toBe(false)
      // ⛔ The turn ending over an ended piece moved nothing a window draws.
      expect(work()).toHaveLength(0)
    })

    it('⛔ a NEW piece first seen `working` is the give’s — no read at the worker’s status says it again', async () => {
      const bring = await personOpens('worker')
      await host.close(bring, window)
      const pm = await personOpens('pm')
      watched = `sess_${String(counter + 1)}`
      announced = []
      decorateNextHandle = holdingAWorkingTurn
      const given = await callOn(agentToolsFor(host, pm), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the work',
        brief: 'do the work',
      })
      decorateNextHandle = null
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const worker = given.agent as string
      expect(worker, 'the worker took another id than the one watched').toBe(watched)
      const handle = handles.at(-1) as FakeSessionHandle
      await waitFor(
        () =>
          handle.status() === 'working' &&
          store.piecesOwnedBy(worker).some((one) => one.state === 'working'),
        'the worker on its new piece',
      )
      await settle()
      // ⚑ The give said it (the positive)…
      expect(work().length).toBeGreaterThanOrEqual(1)
      // ⛔ …and no read of the worker's own status rows said it a second time: the piece was first
      // seen there `working`, which is the give's to say.
      expect(
        work().filter((one) => one.at.startsWith('status:')),
        JSON.stringify(work()),
      ).toEqual([])
    })

    /**
     * ⛔ **A piece given to a conversation that is ALREADY running** is first seen by that
     * conversation's own next `status` row: the give writes it into a ledger read long before (at
     * its start, and at every row since) and reads nothing itself (`recordTheGive` announces and
     * reads no holder). ⚑ The case above never reaches that branch — a give that STARTS its worker
     * has the start read the piece first (`takeWhatItHolds`) — so this is where "first seen
     * `working` or `waiting` is the give's" is measured.
     */
    it('⛔ a NEW piece given to a worker already running is the give’s — its first status read says nothing', async () => {
      const w = await aWorkerOnItsPiece()
      // ⚑ The first piece is answered — ended, so the only open piece below is the new one.
      const first = w.row()?.piece
      if (first === undefined) throw new Error('the give opened no piece')
      const replied = await callOn(agentToolsFor(host, w.worker), 'reply_to_parent', {
        piece: first,
        outcome: 'done',
        summary: 'finished',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      w.machine.completeTurn('completed')
      await waitFor(() => w.handle.status() === 'idle', 'the worker to be idle')
      await settle()
      const issuedBefore = handles.length
      const rowsBefore = store.events(w.worker).length

      announced = []
      const given = await callOn(w.pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the second work',
        brief: 'do the second work',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      // ⚑ The premise: the running conversation took it, and nothing was started to read it first.
      expect(given.agent).toBe(w.worker)
      expect(handles.length).toBe(issuedBefore)
      const second = given.label as string
      const state = (): string | undefined =>
        store.piecesOwnedBy(w.worker).find((one) => one.label === second)?.state
      await waitFor(
        () => w.handle.status() === 'working' && state() === 'working',
        'the worker on its new piece',
      )
      await settle()
      // ⚑ The premise of the negative: the worker's own status row was written, and read.
      expect(
        store
          .events(w.worker)
          .slice(rowsBefore)
          .some((entry) => entry.event.type === 'status'),
      ).toBe(true)
      // ⚑ The give said it (the positive)…
      expect(work().length).toBeGreaterThanOrEqual(1)
      // ⛔ …and the worker's first read of the new piece, at its status row, did not say it again.
      expect(
        work().filter((one) => one.at.startsWith('status:')),
        JSON.stringify(work()),
      ).toEqual([])
    })

    it('⛔ a piece a conversation takes on ITSELF is the verb’s — first seen `working` at its own status row, nothing is said', async () => {
      decorateNextHandle = holdingAWorkingTurn
      const pm = await personOpens('pm')
      decorateNextHandle = null
      const handle = handles.at(-1) as FakeSessionHandle
      const { queue } = controlsOf(handle)
      watched = pm
      await host.send(pm, 'please look into the login page', window)
      await waitFor(() => handle.status() === 'working', 'the pm to work')
      await settle()

      announced = []
      const took = await callOn(agentToolsFor(host, pm), 'take_on_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        title: 'Look into the login page',
        brief: 'Find why it is slow.',
      })
      expect(took.outcome, JSON.stringify(took)).toBe('ok')
      const label = took.label as string
      const state = (): string | undefined =>
        store.piecesOwnedBy(pm).find((one) => one.label === label)?.state
      await settle()
      // ⚑ The verb said it (the positive), and the piece is open and `working`, as the verb opened it.
      expect(work().length).toBeGreaterThanOrEqual(1)
      expect(state()).toBe('working')

      // ⚑ The conversation's next status row is the first read that sees the piece.
      announced = []
      const rowsBefore = store.events(pm).length
      queue.push({ type: 'status', state: 'working' })
      await waitFor(
        () =>
          store
            .events(pm)
            .slice(rowsBefore)
            .some((entry) => entry.event.type === 'status'),
        'the status row',
      )
      await settle()
      expect(state()).toBe('working')
      // ⛔ It moved nothing a window draws: the verb already said the piece.
      expect(
        work().filter((one) => one.at.startsWith('status:')),
        JSON.stringify(work()),
      ).toEqual([])
    })
  })

  describe('§7 · a conversation this app run never started', () => {
    /**
     * 🔴 **Its start takes what it holds as windows already drew it** (`takeWhatItHolds`), so the
     * first row of its life compares against that and says nothing unless the work moved. ⚑ A
     * second host on the same database is the next app run: nothing it remembers was read by it.
     */
    it('⛔ a reopen in the next app run whose first rows move nothing says nothing; words that drive it do', async () => {
      const w = await aWorkerOnItsPiece()
      w.machine.completeTurn('completed')
      await waitFor(() => w.pieceState() === 'stalled', 'the piece to stall')
      await settle()
      const first = host
      await first.closeAll()
      hosts = hosts.filter((one) => one !== first)

      host = buildHost()
      announced = []
      await host.resumeSession(w.worker, window)
      const reopened = handles.at(-1) as FakeSessionHandle
      await waitFor(() => reopened.status() === 'idle', 'the reopened worker to be idle')
      await settle()
      // ⚑ The premise: it still holds the piece open, so a read with nothing taken would say it.
      expect(w.pieceState()).toBe('stalled')
      expect(work(), 'a reopen whose first rows moved nothing announced work').toHaveLength(0)

      // ⚑ **The positive on the same life**: a person's words drive what it holds, and that is said.
      host.send(w.worker, 'go on', window)
      await waitFor(() => w.pieceState() === 'working', 'the piece driven by the person’s words')
      await settle()
      expect(work().length).toBeGreaterThanOrEqual(1)
    })
  })
})
