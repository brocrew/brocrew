import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  RuntimeEvent,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { ConversationWaiting, PieceRow } from '../src/shared/tasks'
import {
  DEFAULT_PROFILE_ID,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * A helper that stopped with a piece open reads as stopped, not as something its giver waits on.
 *
 * BroBot gives a worker (Ada) a piece, and the brief's turn ends with the piece open: nothing is
 * driving it, Ada asked nothing and nothing is on its way to her. The window's reading of BroBot
 * then says the piece stopped, with when, and no longer that BroBot waits on Ada; the person can
 * hand the piece back. A question about it, a piece parked on purpose, or a turn driving it again
 * reads as before. What agents read of BroBot (`list_agents`) is unchanged.
 *
 * A real `RuntimeHost` over a real SQLite ledger, real migrations and the real tools; the only
 * double is the provider, which can hold a turn's end.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** A delay no other timer in the host uses: nothing is stopped for idling. */
const IDLE = 7_654_321

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

/** The end of a turn, held at the provider while `held` stands. */
interface TurnEnds {
  held: Promise<void> | null
  release: () => void
  nextState?: 'completed' | 'interrupted'
}

/** The provider double: it keeps its handles, and holds each turn's end while the test says so. */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    private readonly turnEnds: TurnEnds,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    return this.kept(await super.start(options))
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    return this.kept(await super.resume(ref, options))
  }
  private kept(handle: FakeSessionHandle): FakeSessionHandle {
    this.handles.push(handle)
    const theirSend = handle.send.bind(handle)
    const theirs = handle.events.bind(handle)
    const theirStatus = handle.status.bind(handle)
    const ends = this.turnEnds
    const endState = ends.nextState ?? 'completed'
    ends.nextState = undefined
    let running = false
    handle.send = (...words: Parameters<FakeSessionHandle['send']>) => {
      running = ends.held !== null
      return theirSend(...words)
    }
    handle.events = () =>
      (async function* heldAtItsEnd(): AsyncGenerator<RuntimeEvent> {
        for await (const event of theirs()) {
          if (event.type === 'turn') {
            if (ends.held !== null) await ends.held
            running = false
          }
          yield event.type === 'turn' ? { ...event, state: endState } : event
        }
      })()
    handle.status = () => (running ? 'working' : theirStatus())
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

describe('a helper that stopped with a piece open reads as stopped', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let turnEnds: TurnEnds
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-stopped-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-stopped-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    turnEnds = { held: null, release: () => undefined }
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, turnEnds),
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
      statesMoved: () => undefined,
      idleStopAfterMs: IDLE,
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    turnEnds.release()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)
  const turnsIn = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'turn').length

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** The window's reading of one conversation's waits. */
  const waitsOf = (id: string): ConversationWaiting | undefined =>
    host.whatEachConversationIsWaitingOn().conversations.find((one) => one.conversation === id)
  const pieceOf = (owner: string, piece: string): PieceRow | undefined =>
    store.piecesOwnedBy(owner).find((one) => one.piece === piece)

  /** The stopped-work band uses an interrupted brief; completed briefs exercise the holder ladder. */
  const aHelperThatStopped = async (
    endState: 'completed' | 'interrupted' = 'interrupted',
  ): Promise<{
    brobot: string
    ada: string
    piece: string
  }> => {
    const { sessionId: brobot } = await host.createSession(
      { provider: 'claude', profileId: DEFAULT_PROFILE_ID, approvalMode: 'auto', cwd: root },
      window,
    )
    await settle()
    turnEnds.nextState = endState
    const given = await callOn(agentToolsFor(host, brobot), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      new: true,
      title: 'Build the pages',
      brief: 'build the pages',
    })
    expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label: 'W1.1' })
    const ada = given.agent as string
    const piece = given.piece as string
    await waitFor(() => pieceOf(ada, piece)?.state === 'stalled', 'the brief’s turn to end')
    await waitFor(() => turnsIn(brobot) >= 1, 'the turn the stall notice opened')
    await settle()
    return { brobot, ada, piece }
  }

  it('says the piece stopped, with when, and that its giver no longer waits on the helper', async () => {
    const { brobot, ada, piece } = await aHelperThatStopped('completed')
    const stalled = pieceOf(ada, piece)
    expect(stalled).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
    expect(waitsOf(brobot)).toMatchObject({
      waitingOnTheWorkOf: [],
      waitingOnTheWorkSince: null,
      stoppedWork: [
        { piece, label: 'W1.1', holder: 'Ada', holderConversation: ada, at: stalled?.stalledAt },
      ],
    })
    // What agents read of the giver is unchanged: it still names the helper it gave work to.
    expect(host.agentCard(brobot, THE_APP_ITSELF, brobot)?.state).toMatchObject({
      is: 'waiting-on-a-worker',
    })
  })

  it('lists a quiet turn only after its failed holder reminder and unresolved giver turn', async () => {
    const { brobot, ada, piece } = await aHelperThatStopped('completed')
    await waitFor(
      () => host.workIncidentsForAPerson().rows.some((one) => one.piece === piece),
      'the giver turn to end unresolved',
    )
    expect(host.stalledWorkForAPerson().rows).toEqual([])
    expect(host.stoppedWorkForAPerson().rows).toEqual([])
    expect(host.workIncidentsForAPerson().rows).toContainEqual(
      expect.objectContaining({
        piece,
        holder: ada,
        holderName: 'Ada',
        giver: brobot,
        giverName: host.whatToCallTheConversation(brobot),
        kind: 'stopped',
        cause: 'turn_ended',
      }),
    )
    const receipts = store.reconciliationReceipts(ada, piece)
    expect(receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'holder', outcome: 'failed' }),
        expect.objectContaining({ step: 'giver', outcome: 'delivered' }),
        expect.objectContaining({ step: 'person', outcome: 'listed' }),
      ]),
    )
    await callOn(agentToolsFor(host, ada), 'ask_question', {
      piece: 'W1.1',
      question: 'which pages first?',
      who_answers: 'the-parent',
    })
    await settle()
    expect(host.workIncidentsForAPerson().rows).toEqual([])
  })

  it('puts the piece under Waiting on you, once, for a person to look at or hand back', async () => {
    const { brobot, ada, piece } = await aHelperThatStopped()
    const stalled = pieceOf(ada, piece)
    // Its giver was told of the stall, so the band of work nobody was told about leaves it out.
    expect(host.stalledWorkForAPerson().rows).toEqual([])
    expect(host.stoppedWorkForAPerson().rows).toEqual([
      {
        piece,
        label: 'W1.1',
        title: 'Build the pages',
        holder: ada,
        holderName: 'Ada',
        giver: brobot,
        giverName: host.whatToCallTheConversation(brobot),
        at: stalled?.stalledAt,
      },
    ])
    // A question about it takes it off: the helper is waiting on an answer, not stopped.
    await callOn(agentToolsFor(host, ada), 'ask_question', {
      piece: 'W1.1',
      question: 'which pages first?',
      who_answers: 'the-parent',
    })
    await settle()
    expect(host.stoppedWorkForAPerson().rows).toEqual([])
  })

  describe('a helper nothing runs, by what its record holds for its next start', () => {
    /** BroBot gives Ada W1.1, the brief's turn ends with it open, and Ada is closed. */
    const aClosedHelper = async (): Promise<{ brobot: string; ada: string; piece: string }> => {
      const made = await aHelperThatStopped()
      await host.close(made.ada, THE_APP_ITSELF)
      await settle()
      return made
    }
    /** A row written into a record nothing runs, whole or torn. */
    const written = (into: string, row: TranscriptEvent, torn = false): void => {
      const ordinal = store.nextOrdinal(into)
      store.append(into, ordinal, row, clock++)
      if (!torn) return
      db.prepare(
        "UPDATE events SET payload = '{not json' WHERE session_id = ? AND ordinal = ?",
      ).run(into, ordinal)
    }
    const heldFor = (messageId: string): TranscriptEvent =>
      ({
        type: 'message_queued',
        messageId,
        kind: 'notice',
        text: 'held for its next start',
        forItsNextStart: true,
      }) as TranscriptEvent
    const endedFor = (messageId: string): TranscriptEvent =>
      ({
        type: 'message_unqueued',
        messageId,
        reason: 'cancelled',
        text: 'held for its next start',
      }) as TranscriptEvent
    /**
     * What the giver's line, Waiting on you and a person's hand-back say of the piece, in order,
     * and what each of the two readings says it could not read: rows, then whole ledgers.
     */
    const whatEachSays = async (
      brobot: string,
    ): Promise<{
      line: string[]
      list: string[]
      handBack: unknown
      unread: { line: number[]; list: number[] }
    }> => {
      const waits = host.whatEachConversationIsWaitingOn()
      const giver = waits.conversations.find((one) => one.conversation === brobot)
      if (giver?.stoppedWork === undefined) throw new Error('the giver’s line says no stopped work')
      const list = host.stoppedWorkForAPerson()
      return {
        line: giver.stoppedWork.map((one) => one.piece),
        list: list.rows.map((row) => row.piece),
        handBack: await host.takeBackForAPerson('W1.1', window),
        unread: {
          line: [waits.rowsUnread, waits.ledgersSkipped ?? 0],
          list: [list.rowsUnread, list.ledgersSkipped ?? 0],
        },
      }
    }
    const readWhole = { line: [0, 0], list: [0, 0] }
    const oneRowUnread = { line: [1, 0], list: [1, 0] }
    const notStopped = { line: [], list: [], handBack: { ok: false, rail: 'not-a-stopped-piece' } }

    it('is stopped when its record holds nothing for its next start, read whole', async () => {
      const { brobot, ada, piece } = await aClosedHelper()
      // A message held and then ended leaves nothing waiting.
      written(ada, heldFor('msg_held_then_ended'))
      written(ada, endedFor('msg_held_then_ended'))
      expect(await whatEachSays(brobot)).toEqual({
        line: [piece],
        list: [piece],
        handBack: { ok: true, piece, label: 'W1.1', askedItsTurnToStop: false },
        unread: readWhole,
      })
    })

    it('is not stopped when words wait for its next start, read whole', async () => {
      const { brobot, ada } = await aClosedHelper()
      written(ada, heldFor('msg_waiting'))
      expect(await whatEachSays(brobot)).toEqual({ ...notStopped, unread: readWhole })
    })

    // The piece's own read meets this row too, and each reading counts it once.
    it('is not stopped when a held row can’t be read', async () => {
      const { brobot, ada } = await aClosedHelper()
      const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
      written(ada, heldFor('msg_torn'), true)
      expect(await whatEachSays(brobot)).toEqual({ ...notStopped, unread: oneRowUnread })
      quiet.mockRestore()
    })

    it('is not stopped when the row that ended held words can’t be read', async () => {
      const { brobot, ada } = await aClosedHelper()
      const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
      written(ada, heldFor('msg_ending_torn'))
      written(ada, endedFor('msg_ending_torn'), true)
      expect(await whatEachSays(brobot)).toEqual({ ...notStopped, unread: oneRowUnread })
      quiet.mockRestore()
    })

    // Older than anything the piece's own read starts from, so only the read of what waits for
    // the helper meets it.
    it('is not stopped, and both readings say a row was unread, when a held row older than the piece can’t be read', async () => {
      const { brobot, ada } = await aClosedHelper()
      const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const ordinal = store.nextOrdinal(ada)
      store.append(ada, ordinal, heldFor('msg_before_the_piece'), clock++)
      db.prepare(
        "UPDATE events SET ordinal = -1, payload = '{not json' WHERE session_id = ? AND ordinal = ?",
      ).run(ada, ordinal)
      expect(await whatEachSays(brobot)).toEqual({ ...notStopped, unread: oneRowUnread })
      quiet.mockRestore()
    })

    it('is not stopped, and both readings say a ledger was skipped, when what waits for it can’t be read at all', async () => {
      const { brobot, ada } = await aClosedHelper()
      const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const theirs = store.messagesWaitingIn.bind(store)
      const failing = vi
        .spyOn(store, 'messagesWaitingIn')
        .mockImplementation((sessionId, ...rest) => {
          if (sessionId === ada) throw new Error('the held messages could not be read')
          return theirs(sessionId, ...rest)
        })
      expect(await whatEachSays(brobot)).toEqual({
        ...notStopped,
        unread: { line: [0, 1], list: [0, 1] },
      })
      failing.mockRestore()
      quiet.mockRestore()
    })

    it('leaves another helper’s piece stopped when one helper’s held row can’t be read', async () => {
      const { brobot, ada, piece } = await aClosedHelper()
      turnEnds.nextState = 'interrupted'
      const given = await callOn(agentToolsFor(host, brobot), 'give_work', {
        definition_of_done: 'The copy is written and checked.',
        profile: 'writer',
        new: true,
        title: 'Write the copy',
        brief: 'write the copy',
      })
      expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label: 'W1.2' })
      const bea = given.agent as string
      const other = given.piece as string
      await waitFor(
        () => host.stoppedWorkForAPerson().rows.some((row) => row.piece === other),
        'the second helper to stop, its giver told',
      )
      await host.close(bea, THE_APP_ITSELF)
      await settle()
      const both = async (): Promise<{ line: string[]; list: string[] }> => {
        const giver = host
          .whatEachConversationIsWaitingOn()
          .conversations.find((one) => one.conversation === brobot)
        if (giver?.stoppedWork === undefined)
          throw new Error('the giver’s line says no stopped work')
        return {
          line: giver.stoppedWork.map((one) => one.piece).sort(),
          list: host
            .stoppedWorkForAPerson()
            .rows.map((row) => row.piece)
            .sort(),
        }
      }
      const all = [piece, other].sort()
      expect(await both()).toEqual({ line: all, list: all })
      const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
      written(ada, heldFor('msg_torn_at_one'), true)
      expect(await whatEachSays(brobot)).toEqual({
        line: [other],
        list: [other],
        handBack: { ok: false, rail: 'not-a-stopped-piece' },
        unread: oneRowUnread,
      })
      expect(await host.takeBackForAPerson('W1.2', window)).toEqual({
        ok: true,
        piece: other,
        label: 'W1.2',
        askedItsTurnToStop: false,
      })
      quiet.mockRestore()
    })
  })

  it('reads as before for a helper that asked about the piece, or parked it on purpose', async () => {
    const { brobot, ada, piece } = await aHelperThatStopped()
    const adaTools = agentToolsFor(host, ada)
    const parked = await callOn(adaTools, 'update_work', {
      piece: 'W1.1',
      status: 'waiting for the designs',
      on: { time: new Date(clock + 3_600_000).toISOString() },
    })
    expect(parked, JSON.stringify(parked)).toMatchObject({ outcome: 'ok' })
    expect(pieceOf(ada, piece)?.state).toBe('waiting-on-purpose')
    expect(waitsOf(brobot)?.stoppedWork).toEqual([])
    expect(waitsOf(brobot)?.waitingOnTheWorkOf).toHaveLength(1)
  })

  it('reads as before while a question the helper asked about it waits', async () => {
    const { brobot, ada } = await aHelperThatStopped()
    const asked = await callOn(agentToolsFor(host, ada), 'ask_question', {
      piece: 'W1.1',
      question: 'which pages first?',
      who_answers: 'the-parent',
    })
    expect(asked, JSON.stringify(asked)).toMatchObject({ outcome: 'ok' })
    await settle()
    expect(waitsOf(brobot)?.stoppedWork).toEqual([])
    expect(waitsOf(brobot)?.waitingOnTheWorkOf).toHaveLength(1)
  })

  it('reads as before while a turn drives the piece again', async () => {
    const { brobot, ada, piece } = await aHelperThatStopped()
    let release = (): void => undefined
    turnEnds.held = new Promise<void>((done) => {
      release = done
    })
    turnEnds.release = release
    const followed = await callOn(agentToolsFor(host, brobot), 'message_agent', {
      agent: ada,
      kind: 'follow-up',
      piece: 'W1.1',
      text: 'start with the home page',
    })
    expect(followed, JSON.stringify(followed)).toMatchObject({ outcome: 'ok' })
    await waitFor(() => pieceOf(ada, piece)?.state === 'working', 'the follow-up to drive it')
    expect(waitsOf(brobot)?.stoppedWork).toEqual([])
    expect(waitsOf(brobot)?.waitingOnTheWorkOf).toHaveLength(1)
  })

  it('lets a person hand a stopped piece back, and its giver is told', async () => {
    const { brobot, ada, piece } = await aHelperThatStopped()
    const taken = await host.takeBackForAPerson('W1.1', window)
    expect(taken).toEqual({ ok: true, piece, label: 'W1.1', askedItsTurnToStop: false })
    expect(pieceOf(ada, piece)?.state).toBe('withdrawn')
    await waitFor(
      () =>
        ledger(brobot).some(
          (event) =>
            (event.type === 'user_turn' || event.type === 'message_queued') &&
            event.text.startsWith('A person took back W1.1'),
        ),
      'the giver to be told',
    )
    expect(waitsOf(brobot)?.stoppedWork).toEqual([])
  })

  it('refuses a person’s hand-back of a piece that is no longer stopped, and of one never given', async () => {
    const { brobot, ada } = await aHelperThatStopped()
    await callOn(agentToolsFor(host, ada), 'ask_question', {
      piece: 'W1.1',
      question: 'which pages first?',
      who_answers: 'the-parent',
    })
    await settle()
    expect(await host.takeBackForAPerson('W1.1', window)).toEqual({
      ok: false,
      rail: 'not-a-stopped-piece',
    })
    // A conversation's own root is no piece anybody gave it: refused as no piece a person may take
    // back, with the rail a service's take-back uses.
    const root = store.rootOf(brobot)
    if (root === null) throw new Error('BroBot holds no root')
    expect(await host.takeBackForAPerson(root.label, window)).toEqual({
      ok: false,
      rail: 'not-a-piece-a-service-is-on',
    })
    expect(waitsOf(brobot)?.waitingOnTheWorkOf).toHaveLength(1)
  })

  /** Whether `conversation` was handed, or holds, this app's words starting with `text`. */
  const told = (conversation: string, text: string): boolean =>
    ledger(conversation).some(
      (event) =>
        (event.type === 'user_turn' || event.type === 'message_queued') &&
        event.text.startsWith(text),
    )

  it('lets a person close a stopped piece for good: its holder and its giver are told', async () => {
    const { brobot, ada, piece } = await aHelperThatStopped()
    const closed = await host.closeForAPerson(piece, window)
    expect(closed).toEqual({ ok: true, piece, label: 'W1.1', askedItsTurnToStop: false })
    // The ledger says a person closed it: `work_closed` with no conversation in `by`.
    expect(ledger(ada)).toContainEqual({ type: 'work_closed', piece, by: null })
    expect(pieceOf(ada, piece)).toMatchObject({ state: 'closed', endedBy: null })
    await waitFor(() => told(ada, 'A person closed W1.1'), 'its holder to be told')
    await waitFor(() => told(brobot, 'A person closed W1.1'), 'its giver to be told')
    // Read again from the database, it stays closed and off every list a person is shown.
    const reread = createSessionStore(db, tick)
    expect(reread.piecesOwnedBy(ada).find((one) => one.piece === piece)?.state).toBe('closed')
    expect(host.stoppedWorkForAPerson().rows).toEqual([])
    expect(host.workIncidentsForAPerson().rows).toEqual([])
    expect(waitsOf(brobot)?.stoppedWork).toEqual([])
    // A second press finds nothing stopped, and writes nothing.
    expect(await host.closeForAPerson(piece, window)).toEqual({
      ok: false,
      rail: 'not-a-stopped-piece',
    })
    expect(ledger(ada).filter((event) => event.type === 'work_closed')).toHaveLength(1)
  })

  it('lets a person close a stopped work incident', async () => {
    const { ada, piece } = await aHelperThatStopped('completed')
    await waitFor(
      () => host.workIncidentsForAPerson().rows.some((one) => one.piece === piece),
      'the incident to be listed',
    )
    // Listed as an incident and not on the stopped band: admitted as an incident.
    expect(host.stoppedWorkForAPerson().rows).toEqual([])
    expect(await host.closeForAPerson(piece, window)).toEqual({
      ok: true,
      piece,
      label: 'W1.1',
      askedItsTurnToStop: false,
    })
    expect(pieceOf(ada, piece)?.state).toBe('closed')
    await settle()
    expect(host.workIncidentsForAPerson().rows).toEqual([])
  })

  it('refuses a close of work that is not stopped, of a root, and from no person', async () => {
    const { brobot, ada, piece } = await aHelperThatStopped()
    // No person behind the caller: refused, and the piece stays stopped.
    expect(await host.closeForAPerson(piece, THE_APP_ITSELF)).toEqual({
      ok: false,
      rail: 'not-a-stopped-piece',
    })
    expect(pieceOf(ada, piece)?.state).toBe('stalled')
    // A conversation's own root: no ledger row closes it.
    const root = store.rootOf(brobot)
    if (root === null) throw new Error('BroBot holds no root')
    expect(await host.closeForAPerson(root.label, window)).toEqual({
      ok: false,
      rail: 'not-a-stopped-piece',
    })
    // A name that names nothing.
    expect(await host.closeForAPerson('W9.9', window)).toEqual({
      ok: false,
      rail: 'not-a-stopped-piece',
    })
    // Once its holder asks about it, it is no longer stopped.
    await callOn(agentToolsFor(host, ada), 'ask_question', {
      piece: 'W1.1',
      question: 'which pages first?',
      who_answers: 'the-parent',
    })
    await settle()
    expect(await host.closeForAPerson('W1.1', window)).toEqual({
      ok: false,
      rail: 'not-a-stopped-piece',
    })
    expect(ledger(ada).some((event) => event.type === 'work_closed')).toBe(false)
  })
})
