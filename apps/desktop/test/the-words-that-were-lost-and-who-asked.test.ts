import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, SessionMachine } from '@brobot2/runtime'
import type { FakeSessionHandle, RuntimeEvent, StartOptions } from '@brobot2/runtime'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import * as tasks from '../src/shared/tasks'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 729 · the words that were lost, and who asked
 *
 *  - **§1 · PM ruling R89** (`724` F-1, extends R84) — *"Lost is lost, whatever lost it. An answer is
 *    not delivered when it never reached the giver, by any road: refused (`reply_undelivered`), or
 *    held for a busy giver and then abandoned by a Close, a quit, a crash or a sign-in latch. Its
 *    `list_tasks` row carries the summary in every one of those cases."* ⛔ On `main` an answer
 *    `held` for its giver was recorded as landed and nothing followed it further: each road below
 *    left the replier's ledger silent and the row wordless (R84's letter). ⚑ Every road is its own
 *    test and each is RED on `main`; the control (§1.8) is the held answer that WAS sent. ⚑ **D-030**
 *    — an answer whose delivery fails is held for its giver now (`724` §1.3), so a row whose words
 *    reached nobody is pinned here, by the roads that still lose one.
 *    ⚑ **D-017 · R3 took three roads off that list**: a Close, a provider stream that ends and a
 *    quit are STOPS, and a stop ends nothing it held — the answer is handed on and sent at the
 *    giver's next start, so it is not lost and nothing is recorded (§1.1, §1.3, §1.4, measured
 *    against §1.8's shape) — and the app's own stop is one too (§1.2, which was its parent's
 *    `end_agent` until D-017 removed that tool). ⚠️ The roads that still lose it: a crash, a
 *    sign-in latch, a Cancel, and a handover a stop cut.
 *  - **§2 · the answer a held message carries** — the predicate both writers ask, over the shapes it
 *    must tell apart (an app notice carrying the same report is not the answer — R48's line was one,
 *    until D-030 retired it).
 *  - **PM ruling R90** (`724` F-2) — the reader's own ask, said as its own act. The push and
 *    `list_tasks`' line, for both provider shapes and with the other asker still named, are measured
 *    on the product path in `state-a-supervisor-can-trust.test.ts` (`729` · R90). No correction
 *    carries a stall any more (D-016c), so no other composer says that clause.
 *
 * ⚑ **One provider shape** for §1: nothing here resumes a conversation except §1.9, whose subject is
 * the ORDINAL a reopen takes before its provider answers — the same on both shapes.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

/** ⚑ `ProviderDouble`, with one start's handle decorated — §1.2's giver has a turn that WORKS. */
class DecoratingDouble extends ProviderDouble {
  constructor(
    provider: Provider,
    handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    gate: ResumeGate,
    private readonly takeDecoration: () =>
      ((handle: FakeSessionHandle) => FakeSessionHandle) | null,
  ) {
    super(provider, handles, sessions, gate)
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    const decorate = this.takeDecoration()
    return decorate === null ? handle : decorate(handle)
  }
}

/**
 * ⚑ **A turn that stays `working` until something ends it** — `state-a-supervisor-can-trust`'s
 * instrument, cut to what §1.2 needs. ⛔ The Fake's own turn parks on a permission card, and §1.2's
 * giver is stopped mid-turn with nobody being asked anything (it was `end_agent`'s road until
 * D-017, which refused a conversation a person is being asked in); the lifecycle still comes from
 * the production {@link SessionMachine}.
 */
function aTurnThatWorks(handle: FakeSessionHandle): FakeSessionHandle {
  const queue = new AsyncQueue<RuntimeEvent>()
  let status = handle.status()
  const machine = new SessionMachine((event) => {
    if (event.type === 'status') status = event.state
    queue.push(event)
  })
  machine.markStarting()
  machine.sessionStarted(handle.ref, 'started')
  let closing: Promise<void> | null = null
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'events') return (): AsyncIterable<RuntimeEvent> => queue
      if (property === 'status') return () => status
      if (property === 'send') {
        return async (): Promise<void> => {
          if (machine.beginTurn() === null) {
            throw new Error('cannot send: session is not active or a turn is in progress')
          }
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
}

describe('729 · the words that were lost, and who asked', () => {
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
  let gate: ResumeGate
  let decorateNext: ((handle: FakeSessionHandle) => FakeSessionHandle) | null
  const tick = (): number => clock++

  const buildHost = (over: SessionStore = store): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new DecoratingDouble(provider, handles, issued, gate, () => {
          const decorate = decorateNext
          decorateNext = null
          return decorate
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
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-729-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-729-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_290_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    decorateNext = null
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    gate.held = null
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** ⚑ A real macrotask pause, so a negative is measured after whatever was queued has run. */
  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
    on: RuntimeHost = host,
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(on, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const cardsOn = (id: string): number =>
    events(id).filter((event) => event.type === 'permission_request').length

  const lastCardOn = (id: string): string => {
    const card = events(id)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (card?.type !== 'permission_request') throw new Error(`no card on ${id}`)
    return card.id
  }

  /** ⚑ The rows `list_tasks` hands the conversation that gave the work out (D-016: `you_gave`). */
  const youGaveOut = async (
    pm: string,
    on: RuntimeHost = host,
  ): Promise<Record<string, unknown>[]> =>
    (
      (await callOn(pm, 'list_tasks', { state: 'all' }, on)) as {
        you_gave: Record<string, unknown>[]
      }
    ).you_gave

  const theWords = 'the migration is finished; the indexes are rebuilt'

  /** ⚑ The replier's own record that its answer reached nobody — `reply_undelivered`. */
  const lostRecords = (worker: string, piece: string): TranscriptEvent[] =>
    events(worker).filter((event) => event.type === 'reply_undelivered' && event.piece === piece)

  /** ⚑ The held answer's ending in the GIVER's ledger — the road the words were lost on. */
  const endingsOfTheAnswer = (pm: string): TranscriptEvent[] =>
    events(pm).filter(
      (event) => event.type === 'message_unqueued' && event.work?.state === 'answered',
    )

  /**
   * ⚑ **A worker parked mid-turn on the work its giver gave it** — `719`'s and `724`'s rig — and the
   * giver's own handle, for the roads that act on its provider.
   * ⚑ **D-016** — `give_work` starts the worker, and the brief is its first turn, which parks on its
   * card (the giver's `ask`).
   */
  const aPmAndItsParkedWorker = async (): Promise<{
    pm: string
    pmHandle: FakeSessionHandle
    worker: string
    piece: string
  }> => {
    await host.close(await personOpens('worker'), window)
    const before = handles.length
    const pm = await personOpens('pm')
    const pmHandle = handles[before]
    if (pmHandle === undefined) throw new Error('the giver has no handle')
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The migration',
      brief: 'migrate',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    host.claimSession(worker, window)
    await waitFor(() => cardsOn(worker) > 0, 'the worker to park mid-turn')
    const piece = store.piecesOwnedBy(worker)[0]?.piece
    if (piece === undefined) throw new Error('no piece')
    return { pm, pmHandle, worker, piece }
  }

  /**
   * ⚑ **The premise every road stands on**: the giver is BUSY and holds nothing else, so the answer
   * is `held` for it — landed, as `REPLY_LANDED` says, and the words are in its mailbox. ⚠️ And the
   * row carries no words yet: nothing is lost.
   */
  const theAnswerIsHeldFor = async (pm: string, worker: string, piece: string): Promise<void> => {
    expect(
      await callOn(worker, 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: theWords,
      }),
    ).toMatchObject({ outcome: 'ok', delivered: 'held' })
    await letItSettle()
    expect(
      events(pm).some((event) => event.type === 'message_queued' && event.text.includes(theWords)),
    ).toBe(true)
    expect(lostRecords(worker, piece)).toEqual([])
    const [row] = await youGaveOut(pm)
    expect(row).toMatchObject({ piece, state: 'answered' })
    expect(row).not.toHaveProperty('summary')
  }

  const aBusyGiverHoldingTheAnswer = async (): Promise<{
    pm: string
    pmHandle: FakeSessionHandle
    worker: string
    piece: string
  }> => {
    const pair = await aPmAndItsParkedWorker()
    await host.send(pair.pm, 'keep an eye on the migration', window)
    await waitFor(() => cardsOn(pair.pm) > 0, 'the giver to park mid-turn')
    await theAnswerIsHeldFor(pair.pm, pair.worker, pair.piece)
    return pair
  }

  /**
   * 🔴 **What R89 owes on every road**, read the way a model reads it: the replier's ledger says the
   * answer reached nobody — once, naming the giver and the road's word — and the giver's `list_tasks`
   * row carries the words, whole.
   */
  const theWordsRideOnTheRow = async (
    pm: string,
    worker: string,
    piece: string,
    on: RuntimeHost = host,
  ): Promise<void> => {
    expect(lostRecords(worker, piece)).toEqual([
      { type: 'reply_undelivered', piece, parent: pm, because: 'held-then-lost' },
    ])
    const [row] = await youGaveOut(pm, on)
    expect(row).toMatchObject({ piece, state: 'answered', summary: theWords })
  }

  /**
   * ⚑ **D-017 · R3 — a stop loses nothing**: the held answer was handed on, the giver was started
   * again for it, and it went as a turn — so, as §1.8's control reads it, nothing records a loss
   * and the row carries no words.
   */
  const theAnswerWentAtTheNextStart = async (
    pm: string,
    worker: string,
    piece: string,
    on: RuntimeHost = host,
  ): Promise<void> => {
    await waitFor(
      () => events(pm).some((event) => event.type === 'user_turn' && event.text.includes(theWords)),
      'the held answer to go at the giver’s next start',
    )
    await letItSettle()
    expect(endingsOfTheAnswer(pm)).toEqual([])
    expect(lostRecords(worker, piece)).toEqual([])
    const [row] = await youGaveOut(pm, on)
    expect(row).toMatchObject({ piece, state: 'answered' })
    expect(row).not.toHaveProperty('summary')
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // §1 · R89 — every road an answer held for its giver can be lost on
  // ─────────────────────────────────────────────────────────────────────────────

  describe('§1 · R89 — an answer held for its giver and then lost carries its words', () => {
    /**
     * ⚑ **D-017 · R3 — a person's Close of the giver is a STOP**, and a stop ends nothing it held.
     * This was *"RED on `main`: a person closes the giver while it holds the answer"* and the answer
     * was lost. ⛔ Now it is handed on, the giver is started again for it, and it is SENT — so there
     * is nothing to record and no words to put on the row. ⚑ The replier stays live on its own card
     * throughout, and goes on recording.
     */
    it('§1.1 the giver’s Close is a stop: the answer goes at its next start, and nothing is lost', async () => {
      const { pm, worker, piece } = await aBusyGiverHoldingTheAnswer()
      await host.close(pm, window)
      await theAnswerWentAtTheNextStart(pm, worker, piece)
      expect(
        window.messages.filter(
          (message) => message.sessionId === worker && message.event.type === 'reply_undelivered',
        ),
      ).toEqual([])
      const turns = events(worker).filter((event) => event.type === 'turn').length
      await host.respondPermission(worker, lastCardOn(worker), { outcome: 'allow' }, window)
      await waitFor(
        () => events(worker).filter((event) => event.type === 'turn').length > turns,
        'the replier to record its turn’s end',
      )
    })

    /**
     * ⚑ **D-017 — the road that was *its parent's `end_agent`* is gone** (nothing ends a
     * conversation): the one stop left beside a person's Close is the app's own, of a giver whose
     * turn WORKS. ⚑ **R3 — a stop ends nothing it held**: the answer is handed on and sent at the
     * giver's next start, so nothing is lost.
     */
    it('§1.2 the app’s own stop of a working giver: the answer goes at its next start, and nothing is lost', async () => {
      await host.close(await personOpens('pm'), window)
      await host.close(await personOpens('worker'), window)
      const boss = await personOpens('boss')
      decorateNext = aTurnThatWorks
      // ⚑ **D-016 · the boss's brief is the giver's first turn**, and on this handle that turn WORKS
      // until something ends it — the busy giver the answer is held for.
      const givenPm = await callOn(boss, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'The plan',
        brief: 'the plan',
      })
      expect(givenPm.outcome, JSON.stringify(givenPm)).toBe('ok')
      expect(decorateNext).toBeNull()
      const pm = givenPm.agent as string
      const given = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The migration',
        brief: 'migrate',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const worker = given.agent as string
      host.claimSession(worker, window)
      await waitFor(() => cardsOn(worker) > 0, 'the worker to park mid-turn')
      const piece = store.piecesOwnedBy(worker)[0]?.piece
      if (piece === undefined) throw new Error('no piece')
      host.claimSession(pm, window)
      await waitFor(
        () => host.agentCard(pm, window, null)?.state.is === 'active',
        'the giver’s turn to be working',
      )
      await theAnswerIsHeldFor(pm, worker, piece)

      await host.close(pm, THE_APP_ITSELF)
      await theAnswerWentAtTheNextStart(pm, worker, piece)
    })

    /**
     * ⚑ **D-017 · R3 — a provider failure is a STOP too.** This was *"RED on `main`: the giver's
     * provider stream ends underneath it"*, and the answer was lost. ⛔ Now it is handed on and sent
     * at the giver's next start.
     */
    it('§1.3 its stream ending is a stop: the answer goes at its next start, and nothing is lost', async () => {
      const { pm, pmHandle, worker, piece } = await aBusyGiverHoldingTheAnswer()
      pmHandle.simulateError('the provider went away', true)
      await theAnswerWentAtTheNextStart(pm, worker, piece)
    })

    /**
     * ⚑ **D-017 · R3 — a quit is a STOP.** This was *"RED on `main`: the app quits while the giver
     * holds the answer; read at the next launch"*, and the quit abandoned it. ⛔ Now its
     * `message_queued` row stays open: the next launch reads the answer as still on its way (no
     * record, no words on the row), and the giver's next start sends it.
     */
    it('§1.4 a quit leaves it waiting: read at the next launch, and sent at the giver’s next start', async () => {
      const { pm, worker, piece } = await aBusyGiverHoldingTheAnswer()
      await host.closeAll()
      expect(endingsOfTheAnswer(pm)).toEqual([])
      const next = buildHost()
      expect(lostRecords(worker, piece)).toEqual([])
      const [row] = await youGaveOut(pm, next)
      expect(row).toMatchObject({ piece, state: 'answered' })
      expect(row).not.toHaveProperty('summary')
      await next.resumeSession(pm, window)
      await theAnswerWentAtTheNextStart(pm, worker, piece, next)
    })

    /**
     * 🔴 **RED on `main`**: the app dies holding the answer — nothing finalizes — and the NEXT launch's
     * repair ends the message (`379`). ⚑ Over a second store object, `the-message-that-has-no-name`'s
     * reason: a host on the same object would see these conversations as another live host's.
     */
    it('§1.5 a crash, repaired at the next launch', async () => {
      const { pm, worker, piece } = await aBusyGiverHoldingTheAnswer()
      expect(endingsOfTheAnswer(pm)).toEqual([])
      const next = buildHost(createSessionStore(db, tick))
      expect(endingsOfTheAnswer(pm)).toMatchObject([
        {
          reason: 'abandoned',
          detail: 'the app stopped while this message was still waiting to be sent',
        },
      ])
      await theWordsRideOnTheRow(pm, worker, piece, next)
    })

    /**
     * ⚑ **The giver's Claude sign-in moves on while it holds the answer.** This was *"the flush at
     * its turn's end refuses to send it"*, and the answer was lost. ⛔ Now the flush leaves it held,
     * and once the giver is free this app reopens it on the current sign-in, where the answer goes
     * first — so there is nothing to record and no words to put on the row.
     */
    it('§1.6 its sign-in latch: the answer goes at the reopen this app makes, and nothing is lost', async () => {
      const { pm, pmHandle, worker, piece } = await aBusyGiverHoldingTheAnswer()
      Object.defineProperty(pmHandle, 'signInSuperseded', { get: () => true, configurable: true })
      Object.defineProperty(pmHandle, 'checkSignIn', {
        value: async () => true,
        configurable: true,
      })
      await host.respondPermission(pm, lastCardOn(pm), { outcome: 'allow' }, window)
      await theAnswerWentAtTheNextStart(pm, worker, piece)
      expect(events(pm)).toContainEqual({ type: 'reopened', because: 'the-sign-in-moved-on' })
    })

    /**
     * 🔴 **RED on `main`** — R89's *"by any road"*, on the one its list does not name: the held answer
     * CANCELLED out of the giver's mailbox. ⚑ The giver never read the words either way. ⚠️ No control
     * offers this today — `QueuedMessage.vue` draws no *Cancel it* on a row that carries a work report
     * — so the door is called directly, as a window's IPC would (`729`'s review, round two).
     */
    it('§1.7 a Cancel of the held answer, at its door', async () => {
      const { pm, worker, piece } = await aBusyGiverHoldingTheAnswer()
      const queued = events(pm).find(
        (event) => event.type === 'message_queued' && event.text.includes(theWords),
      )
      if (queued?.type !== 'message_queued' || queued.messageId === undefined) {
        throw new Error('the answer was not held by name')
      }
      await host.cancelQueuedMessage(pm, queued.messageId, window)
      await letItSettle()
      expect(endingsOfTheAnswer(pm)).toMatchObject([{ reason: 'cancelled' }])
      await theWordsRideOnTheRow(pm, worker, piece)
    })

    /**
     * ⚑ **The control — green on `main` and here**: the giver's turn ends, the held answer is SENT,
     * and it reached the giver. ⛔ No record, and the row carries no words (R84).
     */
    it('§1.8 an answer held and then SENT: no record, and no words on the row', async () => {
      const { pm, worker, piece } = await aBusyGiverHoldingTheAnswer()
      await host.respondPermission(pm, lastCardOn(pm), { outcome: 'allow' }, window)
      await waitFor(
        () =>
          events(pm).some((event) => event.type === 'user_turn' && event.text.includes(theWords)),
        'the held answer to be sent',
      )
      await letItSettle()
      expect(endingsOfTheAnswer(pm)).toEqual([])
      expect(lostRecords(worker, piece)).toEqual([])
      const [row] = await youGaveOut(pm)
      expect(row).toMatchObject({ piece, state: 'answered' })
      expect(row).not.toHaveProperty('summary')
    })

    /**
     * 🔴 **The replier is being REOPENED when the answer is lost** — RED on `main` (nothing is
     * recorded at all), and the hazard the record's own write could plant: the reopen took its
     * first ordinal off the store before its provider answered, so a row appended under it would
     * take that ordinal and the conversation would stop recording. ⚑ The record waits for the
     * reopen, lands once, and the conversation keeps recording (its next message is in the ledger).
     *
     * ⚑ **D-017 · R3 — lost by a Cancel at its door (§1.7's road), no longer by the giver's Close**:
     * a Close is a stop now and loses nothing, so it cannot put a record in front of the reopen.
     */
    it('§1.9 a replier mid-reopen: the record waits for it, and it goes on recording', async () => {
      const { pm, worker, piece } = await aBusyGiverHoldingTheAnswer()
      const queued = events(pm).find(
        (event) => event.type === 'message_queued' && event.text.includes(theWords),
      )
      if (queued?.type !== 'message_queued' || queued.messageId === undefined) {
        throw new Error('the answer was not held by name')
      }
      await host.close(worker, window)
      const entered = gate.entered
      let release!: () => void
      gate.held = new Promise<void>((resolve) => {
        release = resolve
      })
      const reopening = host.resumeSession(worker, window)
      try {
        await waitFor(() => gate.entered > entered, 'the reopen to reach its provider')
        await host.cancelQueuedMessage(pm, queued.messageId, window)
        await letItSettle()
        expect(endingsOfTheAnswer(pm)).toMatchObject([{ reason: 'cancelled' }])
      } finally {
        gate.held = null
        release()
      }
      await reopening
      await waitFor(() => lostRecords(worker, piece).length > 0, 'the record to land')
      await theWordsRideOnTheRow(pm, worker, piece)
      const marker = 'after the reopen, still recorded'
      await host.send(worker, marker, window)
      await waitFor(
        () => events(worker).some((event) => event.type === 'user_turn' && event.text === marker),
        'the reopened conversation to record its next message',
      )
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // §1b · R89's edges — `729`'s review, rounds one and two
  // ─────────────────────────────────────────────────────────────────────────────

  describe('§1b · R89 — its edges: a handover the close refused, a replier this database never held, once per answer', () => {
    /**
     * ⚑ **The answer being HANDED OVER as the giver closes** — `abandonQueued` ends it saying *"it may
     * have reached the agent"*. ⚑ R89's letter records it lost all the same (*"held … and then
     * abandoned by a Close"*), and in this world it WAS lost: the Close stopped the provider before
     * the held send went on, and the send was refused. ⚠️ `729` exempted this ending in its review's
     * round one and removed the exemption in round two, for exactly that reason — the row went
     * wordless over words that never arrived.
     */
    it('§1.10 an answer handed over as the giver closes, whose send the close refused: recorded lost', async () => {
      const { pm, pmHandle, worker, piece } = await aBusyGiverHoldingTheAnswer()
      let entered = false
      let release!: () => void
      const handedOver = new Promise<void>((resolve) => {
        release = resolve
      })
      const send = pmHandle.send.bind(pmHandle)
      Object.defineProperty(pmHandle, 'send', {
        value: async (...args: Parameters<FakeSessionHandle['send']>): Promise<void> => {
          entered = true
          await handedOver
          return send(...args)
        },
        configurable: true,
      })
      let closing: Promise<void> | undefined
      try {
        await host.respondPermission(pm, lastCardOn(pm), { outcome: 'allow' }, window)
        await waitFor(() => entered, 'the held answer to be handed to the provider')
        closing = host.close(pm, window)
        await waitFor(() => endingsOfTheAnswer(pm).length > 0, 'the giver’s teardown')
      } finally {
        release()
      }
      await closing
      await letItSettle()
      // ⚑ The premise: the ending itself says the words may have arrived.
      expect(endingsOfTheAnswer(pm)).toMatchObject([
        { reason: 'abandoned', detail: expect.stringContaining('may have reached the agent') },
      ])
      // ⛔ **And the ending names the message it ended** (`354 M5`, landing D-017): an unnamed
      // `abandoned` ending cannot be paired with the queuing it ends.
      const queued = events(pm).flatMap((event) =>
        event.type === 'message_queued' ? [event.messageId] : [],
      )
      const [ended] = endingsOfTheAnswer(pm)
      expect(ended?.type === 'message_unqueued' ? ended.messageId : undefined).toBeDefined()
      expect(queued).toContain(ended?.type === 'message_unqueued' ? ended.messageId : undefined)
      await theWordsRideOnTheRow(pm, worker, piece)
    })

    /** ⚑ A held message planted in a giver's ledger, as a bundle's import would leave one. */
    const plantAHeldMessage = (
      giver: string,
      messageId: string,
      extra: Record<string, unknown>,
    ): void => {
      store.append(
        giver,
        store.nextOrdinal(giver),
        {
          type: 'message_queued',
          messageId,
          kind: 'work',
          text: `planted ${messageId}`,
          attribution: 'app_authored',
          ...extra,
        } as unknown as TranscriptEvent,
        tick(),
      )
    }

    /**
     * 🔴 **The launch it must never cost** (`729`'s review, round one). ⚠️ A ledger imported from a
     * bundle keeps its conversation ids as they were written, so a stranded answer can name a replier
     * THIS database never held — and its append fails the events table's foreign key. ⛔ That threw
     * out of the next host's constructor, on every launch. ⚑ The launch starts, the message gets its
     * ending, and nothing is written to — or even tried on — a conversation that is not here.
     * ⚠️ (A `work` that is not a report never reaches the repair: the store's door drops it on the way
     * in, import included — `boundWorkReport` — so that shape is pinned at the predicate, §2.5.)
     */
    it('§1.11 a stranded answer naming a conversation this database never held: the next launch still starts', async () => {
      const pm = await personOpens('pm')
      plantAHeldMessage(pm, 'msg_foreign', {
        work: {
          piece: 'work_from_a_bundle',
          label: 'W9.1',
          owner: 'sess_from_another_install',
          state: 'answered',
          outcome: 'done',
        },
        relayedFrom: 'sess_from_another_install',
      })
      // ⚑ Every warning the launch prints, so a write attempted and caught is told from none tried.
      const warned: string[] = []
      const warn = vi.spyOn(console, 'warn').mockImplementation((...said: unknown[]) => {
        warned.push(said.map(String).join(' '))
      })
      try {
        const next = buildHost(createSessionStore(db, tick))
        expect(next).toBeDefined()
      } finally {
        warn.mockRestore()
      }
      expect(
        events(pm).flatMap((event) =>
          event.type === 'message_unqueued' ? [[event.messageId, event.reason]] : [],
        ),
      ).toEqual([['msg_foreign', 'abandoned']])
      expect(events('sess_from_another_install')).toEqual([])
      // ⚑ Not written and caught — never TRIED: a conversation this database does not hold is asked
      // about before anything is appended to it.
      expect(warned.filter((line) => line.includes('sess_from_another_install'))).toEqual([])
    })

    /**
     * ⚑ **Once per answer** — the host recorded the loss, and the giver's own ending never reached
     * its ledger (a conversation that stopped recording), so the next launch finds the message
     * stranded. ⚠️ The world is PLANTED: the record is appended as the host would have written it.
     * ⛔ One record, not two — a second would draw a second *"did not reach"* on the child's
     * transcript.
     */
    it('§1.12 a crash after the loss was already recorded: still one record', async () => {
      const { pm, worker, piece } = await aBusyGiverHoldingTheAnswer()
      store.append(
        worker,
        store.nextOrdinal(worker),
        { type: 'reply_undelivered', piece, parent: pm, because: 'held-then-lost' },
        tick(),
      )
      const next = buildHost(createSessionStore(db, tick))
      expect(endingsOfTheAnswer(pm)).toMatchObject([{ reason: 'abandoned' }])
      await theWordsRideOnTheRow(pm, worker, piece, next)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // §2 · the answer a held message carries
  // ─────────────────────────────────────────────────────────────────────────────

  describe('§2 · R89 — which held message IS an answer', () => {
    const answered = {
      piece: 'work_1',
      label: 'W1.1',
      owner: 'sess_worker',
      state: 'answered' as const,
      outcome: 'done' as const,
    }
    const carries = (authorship: Record<string, unknown>): unknown => {
      const exported = tasks as unknown as Record<string, unknown>
      expect(typeof exported.theAnswerItCarries, 'no way to ask').toBe('function')
      return (exported.theAnswerItCarries as (one: Record<string, unknown>) => unknown)(authorship)
    }

    /** 🔴 **The subject**: the reply `deliverReply` queues — the answer's report, relayed from its replier. */
    it('§2.1 the reply itself is the answer', () => {
      expect(carries({ work: answered, relayedFrom: 'sess_worker' })).toMatchObject({
        piece: 'work_1',
        owner: 'sess_worker',
      })
    })

    /**
     * ⛔ **An app's notice is NOT** — the same `answered` report, relayed from nobody. ⚑ R48's line,
     * the notice that the answer could not be delivered, was that shape until D-030 retired it; the
     * predicate still tells the two apart.
     */
    it('§2.2 an app notice carrying the answered report, relayed from nobody, is not the answer', () => {
      expect(carries({ work: answered, attribution: 'app_authored' })).toBeNull()
    })

    /** ⛔ A notice about work that STALLED carries no answer, whoever it names. */
    it('§2.3 a stall notice is not an answer', () => {
      expect(
        carries({
          work: { ...answered, state: 'stalled', stalledBecause: 'turn_ended' },
          relayedFrom: 'sess_worker',
        }),
      ).toBeNull()
    })

    /**
     * ⛔ **A value that is not a report is no answer, and asking does not throw** — `729`'s review.
     * ⚠️ The store's door already drops such a `work` (`boundWorkReport`), so no stored row reaches the
     * repair with one; the predicate is also handed live authorship, and it answers for itself.
     */
    it('§2.5 a stored value that is not a report carries none', () => {
      expect(carries({ work: null, relayedFrom: 'sess_worker' })).toBeNull()
      expect(carries({ work: 'hello', relayedFrom: 'sess_worker' })).toBeNull()
    })

    /** ⛔ Two absent keys are not a match: a report from before `506` names no replier. */
    it('§2.4 a report that names no conversation carries none', () => {
      const unnamed = Object.fromEntries(
        Object.entries(answered).filter(([key]) => key !== 'owner'),
      )
      expect(carries({ work: unnamed })).toBeNull()
      expect(carries({ work: unnamed, relayedFrom: 'sess_worker' })).toBeNull()
    })
  })
})
