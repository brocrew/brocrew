import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { giverStallNotices, RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { PIECE_TITLE_CHARS } from '../src/shared/piece-called'
import {
  TASK_IS_OPEN,
  aStallItsGiverCanBeToldOf,
  derivePieces,
  givenByAConversation,
} from '../src/shared/tasks'
import type { PieceRow, TaskState } from '../src/shared/tasks'
import type {
  PersistedEventInfo,
  QuestionAskedEvent,
  RequestRoutedEvent,
  RuntimeEventMessage,
  TranscriptEvent,
  WorkGivenEvent,
} from '../src/shared/runtime-ipc'

/**
 * D-016 · commit 6 · a request the person makes is a piece that waits on them.
 *
 * `take_on_work(title, brief)` opens a piece under the caller's own root, given by a PERSON
 * (`givenBy` null), numbered from the same counter a give takes from. Nobody is told and nothing is
 * sent. A person's piece left open by a turn that person's own words opened, ended on its own,
 * reads `waiting-on-the-person-who-asked` instead of `stalled`: it raises no notice, is never a
 * conversation's wait, and the next turn that drives it puts it back to `working`. Left open by any
 * other drive — a giver's note, an interruption — it stalls with its cause: the person owes nothing
 * they were not asked. Its reply is delivered nowhere and says so. It sits at depth
 * 0 wherever it hangs. A give with no piece named hangs under the one open piece the caller took on.
 *
 * Three rigs, one file:
 *
 *  - the FOLD (F1-F3): `derivePieces` over hand-built ledgers, reading ALL its rows and not the
 *    first — the wait is a fact about the person's piece BESIDE a conversation's, and a reading of
 *    one piece cannot tell "this piece waits on the person" from "nothing here ever stalls";
 *  - the HOST (T1-T8): a real `RuntimeHost` over a real SQLite ledger, real migrations and the real
 *    tools; the only double is the provider;
 *  - the STORE (T9, T10): the launch sweep and the store's cached fold floor, over rows written
 *    the way the host writes them.
 *
 * Every negative here (no stall, no notice, no delivery, no second piece) is measured beside a
 * positive from the same reader: a piece a CONVERSATION gave, ended the same way, does stall, is
 * told, is delivered and is named by the sweep.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The fold rig — the row/theTask helpers of a-turn-on-its-owner-drives-its-work.test.ts, but
// reading every row of the fold.
// ─────────────────────────────────────────────────────────────────────────────────────────────

let ordinal = 0
let clock = 5_000_000

const row = (event: TranscriptEvent): PersistedEventInfo => ({
  ordinal: ordinal++,
  at: (clock += 1_000),
  event,
})

const givenTo = (
  piece: string,
  label: string,
  givenBy: string | null,
  extra: Partial<WorkGivenEvent> = {},
): TranscriptEvent => ({
  type: 'work_given',
  piece,
  label,
  parent: 'work_root',
  givenBy,
  title: `the work ${label}`,
  brief: `do ${label}`,
  ...extra,
})

const working: TranscriptEvent = { type: 'status', state: 'working' }
const idle: TranscriptEvent = { type: 'status', state: 'idle' }
const turnEnds: TranscriptEvent = { type: 'turn', state: 'completed' }
const aTurnOpens = (text: string, drives?: string): TranscriptEvent =>
  drives === undefined ? { type: 'user_turn', text } : { type: 'user_turn', text, drives }
const queued = (messageId: string, drives?: string): TranscriptEvent =>
  ({
    type: 'message_queued',
    messageId,
    kind: 'notice',
    text: 'the notes',
    ...(drives === undefined ? {} : { drives }),
  }) as TranscriptEvent
const unqueued = (messageId: string, reason: 'sent' | 'abandoned'): TranscriptEvent =>
  ({ type: 'message_unqueued', messageId, reason, text: 'the notes' }) as TranscriptEvent

/** Every piece the ledger folds into, by its id. */
const theFold = (entries: TranscriptEvent[], backgroundWakesIt = false): Map<string, PieceRow> => {
  ordinal = 0
  clock = 5_000_000
  const folded = derivePieces('sess_owner', entries.map(row), { backgroundWakesIt })
  return new Map(folded.map((one) => [one.piece, one]))
}

const pieceIn = (fold: Map<string, PieceRow>, piece: string): PieceRow => {
  const found = fold.get(piece)
  if (found === undefined) throw new Error(`the fold has no piece ${piece}`)
  return found
}

const noStall = { stalledBecause: null, stalledAt: null, stalledBy: null }

describe('D-016 · commit 6 · the fold — a piece a person gave waits on them', () => {
  // A is a person's (taken on); B was given by a conversation. Same ledger, same drive.
  const A = givenTo('work_a', 'W1.1', null)
  const B = givenTo('work_b', 'W1.2', 'sess_giver')
  // ⚑ **F097 · the giver's note opens the drive**: a turn a person's own words opened would leave B
  // waiting on them (`a-turn-a-person-opened-waits-on-them.test.ts`), and this pair is about who
  // GAVE the piece.
  const theGiversNote: TranscriptEvent = {
    type: 'user_turn',
    text: 'go',
    attribution: 'app_authored',
    relayedFrom: 'sess_giver',
    says: 'note',
  }
  const endedOverBoth: TranscriptEvent[] = [A, B, working, theGiversNote, turnEnds, idle]

  it('F1 · a piece a person gave waits on them after a turn their own words opened; any other drive’s end stalls it; the next turn puts it back to working', () => {
    // The person's own words opened the turn, and it ended on its own: their piece waits on them —
    // no cause, no time, nobody who asked — and it is still open.
    const asked = pieceIn(theFold([A, B, working, aTurnOpens('go'), turnEnds, idle]), 'work_a')
    expect(asked.state).toBe<TaskState>('waiting-on-the-person-who-asked')
    expect(asked).toMatchObject(noStall)
    expect(TASK_IS_OPEN[asked.state]).toBe(true)

    // The same turn, interrupted: the person was asked nothing, so their piece stalls with the cause.
    const cut = pieceIn(
      theFold([A, B, working, aTurnOpens('go'), { type: 'turn', state: 'interrupted' }, idle]),
      'work_a',
    )
    expect(cut).toMatchObject({ state: 'stalled', stalledBecause: 'turn_interrupted' })

    // A stop asked, and the turn completing on its own all the same: whoever asked is owed the stall.
    const stopAsked = pieceIn(
      theFold([
        A,
        B,
        working,
        aTurnOpens('go'),
        { type: 'work_interrupted', by: 'a-person' },
        turnEnds,
        idle,
      ]),
      'work_a',
    )
    expect(stopAsked).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })

    // A turn the giver's note opened asked the person nothing either: their piece stalls with the
    // turn's cause, as the conversation's piece does — and nobody is told (no giver).
    const ended = theFold(endedOverBoth)
    const a = pieceIn(ended, 'work_a')
    const b = pieceIn(ended, 'work_b')
    expect(a).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended', giver: null })
    expect(a.stalledAt).not.toBeNull()
    expect(b).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
    expect(aStallItsGiverCanBeToldOf(a)).toBe(false)

    // The next turn, in either provider's order, puts both back to working.
    for (const [order, next] of [
      ['status first (Claude)', [working]],
      ['user_turn first (Codex)', [aTurnOpens('and another thing')]],
    ] as const) {
      const again = theFold([...endedOverBoth, ...next])
      expect(pieceIn(again, 'work_a'), order).toMatchObject({ state: 'working', ...noStall })
      expect(pieceIn(again, 'work_b'), order).toMatchObject({ state: 'working', ...noStall })
    }

    // A turn that names a piece drives it and no other: this one drives B, so A stays stalled.
    const naming = theFold([...endedOverBoth, aTurnOpens('for the giver', 'work_b')])
    expect(pieceIn(naming, 'work_b')).toMatchObject({ state: 'working', ...noStall })
    expect(pieceIn(naming, 'work_a')).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
    })
  })

  it('F1b · a wake that goes on with the person’s own turn keeps the piece waiting on them; a wake after a giver’s note does not', () => {
    // The person's own turn leaves a background task running; it ends, and its provider wakes the
    // conversation, which reports and ends on its own. ⚑ A wake has no words of its own: it goes on
    // from the turn the person's words opened, so it answers them.
    const running = {
      type: 'background_work',
      running: [{ id: 'bg_1', description: 'npm run build' }],
      source: 'test',
    } as TranscriptEvent
    const finished = {
      type: 'background_work',
      ended: { id: 'bg_1', outcome: 'completed' },
      source: 'test',
    } as TranscriptEvent
    const theWake: TranscriptEvent[] = [
      working,
      { type: 'turn', state: 'completed', startedBy: 'the-provider' },
      idle,
    ]
    const afterThePersons = theFold(
      [A, working, aTurnOpens('build it'), running, turnEnds, idle, finished, ...theWake],
      true,
    )
    expect(pieceIn(afterThePersons, 'work_a')).toMatchObject({
      state: 'waiting-on-the-person-who-asked',
      ...noStall,
    })
    // ⛔ The control: the same wake after a turn the giver's note opened asked the person nothing,
    // so the piece stalls with the turn's cause.
    const afterTheGivers = theFold(
      [A, working, theGiversNote, running, turnEnds, idle, finished, ...theWake],
      true,
    )
    expect(pieceIn(afterTheGivers, 'work_a')).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
    })
  })

  it('F2 · a message waiting in the queue holds only the piece it drives', () => {
    const A2 = givenTo('work_a', 'W1.1', null)
    const B2 = givenTo('work_b', 'W1.2', null)
    const midTurn: TranscriptEvent[] = [A2, B2, working, aTurnOpens('go')]
    const endedWith = (held: TranscriptEvent): TranscriptEvent[] => [
      ...midTurn,
      held,
      turnEnds,
      idle,
    ]

    // m1 drives A: A is held for the message that will drive it, B is not held for anything.
    const holding = theFold(endedWith(queued('m1', 'work_a')))
    expect(pieceIn(holding, 'work_a')).toMatchObject({ state: 'working', ...noStall })
    expect(pieceIn(holding, 'work_b').state).toBe<TaskState>('waiting-on-the-person-who-asked')

    // m1 goes out and its turn drives A: A works, B still waits on the person.
    const sent = theFold([
      ...endedWith(queued('m1', 'work_a')),
      unqueued('m1', 'sent'),
      aTurnOpens('the notes', 'work_a'),
    ])
    expect(pieceIn(sent, 'work_a')).toMatchObject({ state: 'working', ...noStall })
    expect(pieceIn(sent, 'work_b').state).toBe<TaskState>('waiting-on-the-person-who-asked')

    // m1 is abandoned: nothing will drive A now, so A waits on the person AT that row, and not before.
    const beforeIt = endedWith(queued('m1', 'work_a'))
    expect(pieceIn(theFold(beforeIt), 'work_a').state).toBe<TaskState>('working')
    const abandoned = theFold([...beforeIt, unqueued('m1', 'abandoned')])
    expect(pieceIn(abandoned, 'work_a').state).toBe<TaskState>('waiting-on-the-person-who-asked')
    expect(pieceIn(abandoned, 'work_a')).toMatchObject(noStall)
    expect(pieceIn(abandoned, 'work_b').state).toBe<TaskState>('waiting-on-the-person-who-asked')

    // The paired positive: a message that names no piece drives EVERY open piece, so while it waits
    // both read working, and when it is abandoned both wait on the person.
    const unnamed = theFold(endedWith(queued('m1')))
    expect(pieceIn(unnamed, 'work_a').state).toBe<TaskState>('working')
    expect(pieceIn(unnamed, 'work_b').state).toBe<TaskState>('working')
    const unnamedAbandoned = theFold([...endedWith(queued('m1')), unqueued('m1', 'abandoned')])
    for (const piece of ['work_a', 'work_b']) {
      expect(pieceIn(unnamedAbandoned, piece).state, piece).toBe<TaskState>(
        'waiting-on-the-person-who-asked',
      )
    }
  })

  it("F3 · a restart stalls a person's working piece with nobody to tell, and leaves one already waiting on the person alone", () => {
    const restart = (...pieces: string[]): TranscriptEvent =>
      ({ type: 'work_restarted', pieces }) as TranscriptEvent

    // Ledger 1: both were working when the app went away.
    const both = theFold([A, B, restart('work_a', 'work_b')])
    const a = pieceIn(both, 'work_a')
    const b = pieceIn(both, 'work_b')
    expect(a).toMatchObject({ state: 'stalled', stalledBecause: 'app_restarted' })
    expect(b).toMatchObject({ state: 'stalled', stalledBecause: 'app_restarted' })
    // A person gave A, so there is nobody to tell; a conversation gave B, so its giver is told.
    expect(givenByAConversation(a)).toBe(false)
    expect(aStallItsGiverCanBeToldOf(a)).toBe(false)
    expect(givenByAConversation(b)).toBe(true)
    expect(aStallItsGiverCanBeToldOf(b)).toBe(true)

    // Ledger 2: A already waits on the person when a restart names it — the row leaves it alone.
    const waiting = theFold([A, working, aTurnOpens('go'), turnEnds, idle])
    expect(pieceIn(waiting, 'work_a').state).toBe<TaskState>('waiting-on-the-person-who-asked')
    const restarted = theFold([A, working, aTurnOpens('go'), turnEnds, idle, restart('work_a')])
    expect(pieceIn(restarted, 'work_a').state).toBe<TaskState>('waiting-on-the-person-who-asked')
    expect(pieceIn(restarted, 'work_a')).toMatchObject(noStall)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The host rig — the-push-that-does-not-survive-a-launch.test.ts's real host over a real ledger.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
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

/** The provider double, with the handles kept: a test has to BE the provider to park a turn. */
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

describe('D-016 · commit 6 · take_on_work — the host', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clockNow: number
  let window: RecordingSink
  let claimed: Set<string>
  const toolOwners = new WeakMap<AgentToolset, string>()
  const tick = (): number => clockNow++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-takeon-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-takeon-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clockNow = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    claimed = new Set()
    issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
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
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const givenIn = (sessionId: string): WorkGivenEvent[] =>
    events(sessionId).filter((event): event is WorkGivenEvent => event.type === 'work_given')

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  /** An identity exists only once a person has run a conversation as it. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** The words a model reads, and the payload beside them. */
  const callWithWords = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const result = await tool.call(args)
    return { structured: result.structured as Record<string, unknown>, text: result.text }
  }

  const rootOf = (conversation: string): { piece: string; label: string } => {
    const found = store.rootOf(conversation)
    if (found === null) throw new Error(`${conversation} owns no root`)
    return found
  }

  const taskOf = (sessionId: string, piece: string): PieceRow | undefined =>
    store.piecesOwnedBy(sessionId).find((one) => one.piece === piece)

  const stateOf = (sessionId: string, piece: string): TaskState | undefined =>
    taskOf(sessionId, piece)?.state

  /** A person's conversation, and the tools it is offered. */
  const aPerson = async (
    profileId: string,
  ): Promise<{ id: string; tools: AgentToolset; root: { piece: string; label: string } }> => {
    const id = await personOpens(profileId)
    const tools = agentToolsFor(host, id)
    toolOwners.set(tools, id)
    return { id, tools, root: rootOf(id) }
  }

  const takeOn = async (
    tools: AgentToolset,
    title: string,
    brief = `${title}, as asked`,
  ): Promise<{ piece: string; label: string }> => {
    const owner = toolOwners.get(tools)
    if (owner === undefined) throw new Error('no fictional tool owner')
    if (!events(owner).some((event) => event.type === 'user_turn')) {
      await host.send(owner, 'Please take on this fictional request.', window)
      await cardOn(owner)
    }
    const taken = await callOn(tools, 'take_on_work', {
      title,
      brief,
      definition_of_done: 'The requested result and its checks are recorded.',
    })
    expect(taken.outcome, JSON.stringify(taken)).toBe('ok')
    return { piece: taken.piece as string, label: taken.label as string }
  }

  /** A person's conversation that gave `worker` a piece, so the worker owns no root. */
  const aPmAndItsWorker = async (
    pmProfile: string,
    workerProfile: string,
    brief = 'the work',
  ): Promise<{
    pm: string
    pmTools: AgentToolset
    worker: string
    workerTools: AgentToolset
    piece: string
    label: string
  }> => {
    await bringIdentityIntoBeing(workerProfile)
    const { id: pm, tools: pmTools } = await aPerson(pmProfile)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: brief,
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    return {
      pm,
      pmTools,
      worker,
      workerTools: agentToolsFor(host, worker),
      piece: given.piece as string,
      label: given.label as string,
    }
  }

  const cardsOn = (sessionId: string): number =>
    events(sessionId).filter((event) => event.type === 'permission_request').length

  const cardOn = async (sessionId: string, after = 0): Promise<string> => {
    await waitFor(() => cardsOn(sessionId) > after, 'the card the turn parks on')
    const asked = events(sessionId)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (asked === undefined || asked.type !== 'permission_request') {
      throw new Error('no permission request on the ledger')
    }
    return asked.id
  }

  /** Answer the card the turn is parked on, and wait for the turn to reach its own terminal. */
  const letTheTurnFinish = async (
    sessionId: string,
    { after = 0, spawned = false }: { after?: number; spawned?: boolean } = {},
  ): Promise<void> => {
    const turnsBefore = events(sessionId).filter((event) => event.type === 'turn').length
    const id = await cardOn(sessionId, after)
    // A conversation another one started is nobody's until somebody claims it; a person's own is
    // already held for their window.
    if (spawned && !claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    await waitFor(
      () => events(sessionId).filter((event) => event.type === 'turn').length > turnsBefore,
      'the turn to reach its own terminal',
    )
  }

  /** What was said to a conversation as a notice that its work is not being worked on. */
  const stallNoticesIn = (sessionId: string): string[] => giverStallNotices(store, sessionId)

  const kinds = (sessionId: string): string[] => events(sessionId).map((event) => event.type)

  it("T1 · take_on_work opens a piece under the caller's own root, given by a person, and sends nothing", async () => {
    const { id: pm, tools: pmTools, root: pmRoot } = await aPerson('pm')
    const handlesBefore = handles.length
    const brief = `Plan the whole trip.\n\n- flights\n- a hotel near the station\n\n${'detail '.repeat(120)}\n`

    await host.send(pm, 'Please plan the trip.', window)
    await cardOn(pm)
    const beforeTaking = kinds(pm).length
    const first = await callOn(pmTools, 'take_on_work', {
      title: 'Plan the trip',
      brief,
      definition_of_done: 'The trip plan and its checks are recorded.',
    })
    expect(first).toEqual({
      outcome: 'ok',
      piece: expect.any(String) as string,
      label: `${pmRoot.label}.1`,
      title: 'Plan the trip',
      under: pmRoot.label,
      notice: null,
      queued: false,
    })
    // Nothing was sent to anybody: no agent, no delivery, no launch.
    for (const key of ['agent', 'delivered', 'delivery', 'started']) {
      expect(Object.hasOwn(first, key), key).toBe(false)
    }
    const piece = first.piece as string

    // The row: owned by the caller, under its root, given by a person, the brief whole.
    const written = store.workById(piece)
    expect(written).toMatchObject({
      owner: pm,
      parent: pmRoot.piece,
      givenBy: null,
      label: `${pmRoot.label}.1`,
      title: 'Plan the trip',
    })
    expect(written?.brief).toBe(brief)

    // The ledger: exactly one work_given for it, given by nobody's conversation, with no held message.
    const opened = givenIn(pm)
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ piece, parent: pmRoot.piece, givenBy: null, brief })
    expect(Object.hasOwn(opened[0] ?? {}, 'messageId')).toBe(false)
    // And nothing was said in that conversation: no turn, no queued or sent message.
    for (const kind of ['message_queued', 'message_sent', 'user_turn']) {
      expect(kinds(pm).slice(beforeTaking), kind).not.toContain(kind)
    }

    // The second take is numbered next; and the give that follows takes the counter on from it.
    const second = await callOn(pmTools, 'take_on_work', {
      title: 'Book it',
      brief: 'book it',
      definition_of_done: 'The booking is confirmed and recorded.',
    })
    expect(second.label).toBe(`${pmRoot.label}.2`)
    expect(handles.length, 'a take-on starts nothing').toBe(handlesBefore)

    // The paired positive: a give from the same conversation has a giver, starts a conversation,
    // and shares the counter — so `givenBy` null above is measured against a reader that sees one.
    await bringIdentityIntoBeing('worker')
    const handlesBeforeTheGive = handles.length
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the errand',
      brief: 'the errand',
      piece: pmRoot.label,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.label).toBe(`${pmRoot.label}.3`)
    expect(store.workById(given.piece as string)?.givenBy).toBe(pm)
    expect(typeof given.agent).toBe('string')
    expect(handles.length).toBeGreaterThan(handlesBeforeTheGive)
    // The takes wrote no more than the two rows of their own in the caller's ledger.
    expect(givenIn(pm).map((one) => one.givenBy)).toEqual([null, null])
  })

  it('T2 · an agent brief cannot authorize personal work, and a malformed call names its key', async () => {
    const made = await aPmAndItsWorker('pm', 'worker')
    const { pm, pmTools, worker, workerTools, piece } = made
    expect(store.rootOf(worker)).toBeNull()

    const refused = await callOn(workerTools, 'take_on_work', {
      title: 'mine',
      brief: 'mine',
      definition_of_done: 'The result and its checks are recorded.',
    })
    expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
    expect(refused.rail).toBe('no-work-of-your-own')
    expect(refused.permanence).toBe('permanent')
    expect(refused.remedy).toBeNull()
    // It wrote nothing: the worker still holds only the piece it was given.
    expect(store.piecesOwnedBy(worker).map((one) => one.piece)).toEqual([piece])

    // A caller that speaks as nobody — the window, or the app — has no work of its own either.
    for (const [who, by] of [
      ['a window', window],
      ['the app itself', THE_APP_ITSELF],
    ] as const) {
      expect(
        await host.takeOnWork(
          {
            title: 'mine',
            brief: 'mine',
            definition_of_done: 'The result and its checks are recorded.',
          },
          by,
        ),
        who,
      ).toEqual({
        ok: false,
        rail: 'no-work-of-your-own',
        detail: {},
      })
    }

    // A key the door does not know is refused by name, and so is a title over the bound.
    const before = givenIn(pm).length
    const extra = await callOn(pmTools, 'take_on_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      title: 'x',
      brief: 'x',
      profile: 'x',
    })
    expect(extra.outcome, JSON.stringify(extra)).toBe('refused')
    expect(extra.rail).toBe('malformed-request')
    expect(JSON.stringify(extra.detail)).toContain('profile')
    const tooLong = await callOn(pmTools, 'take_on_work', {
      title: 'x'.repeat(PIECE_TITLE_CHARS + 1),
      brief: 'x',
      definition_of_done: 'The result is checked.',
    })
    expect(tooLong.outcome, JSON.stringify(tooLong)).toBe('refused')
    expect(tooLong.rail).toBe('malformed-request')
    expect(JSON.stringify(tooLong.detail)).toContain('title')
    expect(givenIn(pm)).toHaveLength(before)

    // The paired positive: the same well-formed call from the person's conversation lands.
    await host.send(pm, 'Please take on this fictional request.', window)
    await cardOn(pm)
    const admitted = await callOn(pmTools, 'take_on_work', {
      title: 'mine',
      brief: 'mine',
      definition_of_done: 'The result and its checks are recorded.',
    })
    expect(admitted.outcome, JSON.stringify(admitted)).toBe('ok')
    expect(givenIn(pm)).toHaveLength(before + 1)
    // And a title of exactly the bound is not over it.
    const atTheBound = await callOn(pmTools, 'take_on_work', {
      title: 'y'.repeat(PIECE_TITLE_CHARS),
      brief: 'y',
      definition_of_done: 'The result is checked.',
    })
    expect(atTheBound.outcome, JSON.stringify(atTheBound)).toBe('ok')
  })

  it('T3 · a turn that ends over a taken-on piece leaves it waiting on the person, with no notice; the next turn drives it', async () => {
    // The positive control comes first: a piece a CONVERSATION gave, whose owner's turn ends with it
    // open, is stalled and its giver is told — so a missing notice below is not a push that never fires.
    const control = await aPmAndItsWorker('pm-control', 'worker-control')
    await cardOn(control.worker)
    expect(stateOf(control.worker, control.piece)).toBe('working')
    await letTheTurnFinish(control.worker, { spawned: true })
    expect(taskOf(control.worker, control.piece)).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
    })
    await waitFor(() => stallNoticesIn(control.pm).length === 1, 'the giver to be told')

    // The subject: a person's request, taken on, and a turn of the person's own that ends over it.
    const { id: pm, tools: pmTools } = await aPerson('pm')
    const first = await takeOn(pmTools, 'the first ask')
    const second = await takeOn(pmTools, 'the second ask')
    expect(stateOf(pm, first.piece)).toBe('working')
    await cardOn(pm)
    expect(stateOf(pm, first.piece)).toBe('working')
    await letTheTurnFinish(pm)

    for (const one of [first, second]) {
      const waiting = taskOf(pm, one.piece)
      expect(waiting?.state, one.label).toBe<TaskState>('waiting-on-the-person-who-asked')
      expect(waiting, one.label).toMatchObject(noStall)
      expect(TASK_IS_OPEN[waiting?.state ?? 'closed'], one.label).toBe(true)
    }
    // Nobody was told: the control's notice is the only one in the app (after the same settling
    // the control needed), and none of the words in the person's conversation say it.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(stallNoticesIn(pm)).toEqual([])
    expect(stallNoticesIn(control.pm)).toHaveLength(1)

    // It is still open: its reply is accepted while it waits, and the reply ends it.
    const replied = await callOn(pmTools, 'reply_to_parent', {
      piece: second.label,
      outcome: 'done',
      summary: 'that one is done',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    expect(stateOf(pm, second.piece)).toBe('answered')

    // The person's next turn drives the piece that is still open back to working.
    const cards = cardsOn(pm)
    await host.send(pm, 'and now the second thing', window)
    await cardOn(pm, cards)
    expect(stateOf(pm, first.piece)).toBe('working')
    expect(taskOf(pm, first.piece)).toMatchObject(noStall)
    // The one that was answered stays answered.
    expect(stateOf(pm, second.piece)).toBe('answered')
  })

  it('T3b · a taken-on piece the person stops is listed for them as stopped work; one they were asked about is not', async () => {
    const { id: pm, tools: pmTools } = await aPerson('pm')
    const asked = await takeOn(pmTools, 'the ask')
    // The positive first: the person's own turn, ended on its own, leaves it waiting on them, and
    // nothing is listed.
    await letTheTurnFinish(pm)
    expect(stateOf(pm, asked.piece)).toBe<TaskState>('waiting-on-the-person-who-asked')
    expect(host.workIncidentsForAPerson().rows).toEqual([])

    // The person's next turn, stopped: the piece stalls on the stop, and is listed as stopped work,
    // with nobody but the person to hear of it.
    const cards = cardsOn(pm)
    await host.send(pm, 'and now this', window)
    await cardOn(pm, cards)
    await host.interrupt(pm, window)
    await waitFor(() => stateOf(pm, asked.piece) === 'stalled', 'the stop to end the turn')
    expect(taskOf(pm, asked.piece)).toMatchObject({ stalledBecause: 'turn_interrupted' })
    await waitFor(
      () => host.workIncidentsForAPerson().rows.some((one) => one.piece === asked.piece),
      'the refused reminder to be recorded',
    )
    expect(host.workIncidentsForAPerson().rows).toEqual([
      expect.objectContaining({
        piece: asked.piece,
        label: asked.label,
        holder: pm,
        giver: null,
        giverName: null,
        kind: 'stopped',
        cause: 'turn_interrupted',
      }),
    ])

    // Asked about it with the tool, it waits on that question, and is no longer listed.
    const question = await callOn(pmTools, 'ask_question', {
      piece: asked.label,
      question: 'which part first?',
      who_answers: 'a-person',
    })
    expect(question.outcome, JSON.stringify(question)).toBe('ok')
    expect(host.workIncidentsForAPerson().rows).toEqual([])
  })

  it('T4 · a give with no piece named hangs under the piece the caller took on, and several taken-on pieces must be named', async () => {
    for (const profile of ['worker-a', 'worker-b', 'worker-c', 'worker-d']) {
      await bringIdentityIntoBeing(profile)
    }
    const give = (tools: AgentToolset, profile: string, extra: Record<string, unknown> = {}) =>
      callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile,
        title: 'errand',
        brief: 'errand',
        ...extra,
      })

    // (a) The positive: a caller holding only its root gives under the root.
    const a = await aPerson('pm-a')
    const underRoot = await give(a.tools, 'worker-a')
    expect(underRoot.outcome, JSON.stringify(underRoot)).toBe('ok')
    expect(underRoot.label).toBe(`${a.root.label}.1`)
    expect(store.workById(underRoot.piece as string)?.parent).toBe(a.root.piece)

    // (b) It took a request on: the unnamed give hangs under that piece, never under the root.
    const b = await aPerson('pm-b')
    const taken = await takeOn(b.tools, 'the request')
    const underIt = await give(b.tools, 'worker-b')
    expect(underIt.outcome, JSON.stringify(underIt)).toBe('ok')
    expect(store.workById(underIt.piece as string)?.parent).toBe(taken.piece)
    expect(underIt.label).toBe(`${taken.label}.1`)
    expect(store.workById(underIt.piece as string)?.parent).not.toBe(b.root.piece)

    // (c) It took two on: which one is meant must be said, and the root is not one of the candidates.
    const c = await aPerson('pm-c')
    const one = await takeOn(c.tools, 'the first request')
    const two = await takeOn(c.tools, 'the second request')
    const handlesBefore = handles.length
    const unnamed = await give(c.tools, 'worker-c')
    expect(unnamed.outcome, JSON.stringify(unnamed)).toBe('refused')
    expect(unnamed.rail).toBe('name-the-piece-you-give-from')
    const held = (unnamed.detail as { held?: unknown }).held
    expect(held, JSON.stringify(unnamed.detail)).toEqual(
      expect.arrayContaining([one.label, two.label]),
    )
    expect(JSON.stringify(held)).not.toContain(`"${c.root.label}"`)
    expect(handles.length, 'a refused give starts nothing').toBe(handlesBefore)
    expect(store.childrenOf(one.piece)).toEqual([])
    expect(store.childrenOf(two.piece)).toEqual([])

    // Naming the second resolves it, and the piece hangs under that one.
    const named = await give(c.tools, 'worker-c', { piece: two.label })
    expect(named.outcome, JSON.stringify(named)).toBe('ok')
    expect(store.workById(named.piece as string)?.parent).toBe(two.piece)
    expect(named.label).toBe(`${two.label}.1`)
  })

  it('T5 · a piece taken on sits at depth 0: a give under it is admitted at maxDepth 1 and too-deep at maxDepth 0', async () => {
    await bringIdentityIntoBeing('worker')
    const { id: pm, tools: pmTools, root: pmRoot } = await aPerson('pm')
    const grant = (edit: Parameters<SessionStore['setCapabilities']>[1]): void => {
      expect(store.setCapabilities('pm', edit)).toBe(true)
    }
    const taken = await takeOn(pmTools, 'the request')
    const giveUnder = (): Promise<Record<string, unknown>> =>
      callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the errand',
        brief: 'the errand',
        piece: taken.label,
      })

    // The positive: one level of depth is enough for a give under the piece the person asked for.
    grant({ maxDepth: 1 })
    const admitted = await giveUnder()
    expect(admitted.outcome, JSON.stringify(admitted)).toBe('ok')
    const underIt = admitted.piece as string
    expect(store.workById(underIt)?.parent).toBe(taken.piece)

    // The same call one fact over: no depth at all, and the give is refused with its arithmetic.
    grant({ maxDepth: 0 })
    const refused = await giveUnder()
    expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
    expect(refused.rail).toBe('too-deep')
    expect(refused.detail).toMatchObject({ label: taken.label, depth: 1, maxDepth: 0 })
    expect(store.childrenOf(taken.piece).map((one) => one.piece)).toEqual([underIt])

    // What the store says of the three: a root and a piece a person gave are 0, a give under it 1.
    expect(store.depthOf(pmRoot.piece)).toBe(0)
    expect(store.depthOf(taken.piece)).toBe(0)
    expect(store.depthOf(underIt)).toBe(1)
    expect(store.workById(taken.piece)?.owner).toBe(pm)
  })

  it('T6 · a taken-on piece is answered by reply_to_parent and delivered nowhere', async () => {
    const { id: pm, tools: pmTools } = await aPerson('pm')
    const plain = await takeOn(pmTools, 'a plain ask')
    const withFile = await takeOn(pmTools, 'an ask with a file')
    const body = join(root, 'answer.md')
    writeFileSync(body, `# The answer\n\n${'detail '.repeat(50)}\n`)
    const handlesBefore = handles.length
    const ledgerBefore = kinds(pm).length

    const answered = await callWithWords(pmTools, 'reply_to_parent', {
      piece: plain.label,
      outcome: 'done',
      summary: 'done, and told here',
    })
    expect(answered.structured, JSON.stringify(answered.structured)).toMatchObject({
      outcome: 'ok',
      piece: plain.piece,
      label: plain.label,
      state: 'answered',
      resources: [],
    })
    // Delivered nowhere: the key is not there, and the words tell the model to say it here.
    expect(Object.hasOwn(answered.structured, 'delivered')).toBe(false)
    expect(answered.text).toContain('tell them here')
    expect(taskOf(pm, plain.piece)).toMatchObject({ state: 'answered', outcome: 'done' })
    expect(TASK_IS_OPEN[stateOf(pm, plain.piece) ?? 'stalled']).toBe(false)

    // With a file kept: the resource id comes back and is the piece's own.
    const kept = await callWithWords(pmTools, 'reply_to_parent', {
      piece: withFile.label,
      outcome: 'done',
      summary: 'done, with the file',
      resource_paths: [body],
    })
    expect(kept.structured, JSON.stringify(kept.structured)).toMatchObject({
      outcome: 'ok',
      state: 'answered',
    })
    const resources = kept.structured.resources as string[]
    expect(resources).toHaveLength(1)
    expect(resources[0]).toMatch(/^res_/)
    expect(store.resource(resources[0] ?? '')?.piece).toBe(withFile.piece)
    expect(Object.hasOwn(kept.structured, 'delivered')).toBe(false)

    // Nothing was queued, told or woken: the two replies wrote only their own rows.
    expect(handles.length).toBe(handlesBefore)
    expect(kinds(pm).slice(ledgerBefore)).not.toContain('message_queued')
    expect(kinds(pm).slice(ledgerBefore)).not.toContain('user_turn')
    expect(kinds(pm).filter((kind) => kind === 'work_replied')).toHaveLength(2)

    // A second reply is refused as any second reply is: the piece has ended.
    const again = await callOn(pmTools, 'reply_to_parent', {
      piece: plain.label,
      outcome: 'done',
      summary: 'again',
    })
    expect(again.outcome, JSON.stringify(again)).toBe('refused')
    expect(kinds(pm).filter((kind) => kind === 'work_replied')).toHaveLength(2)

    // The paired positive: a worker's reply to a piece a conversation gave DOES say where it went,
    // and is refused a second time the same way.
    const pair = await aPmAndItsWorker('pm-other', 'worker-other')
    const workerReply = await callOn(pair.workerTools, 'reply_to_parent', {
      piece: pair.label,
      outcome: 'done',
      summary: 'the errand is done',
    })
    expect(workerReply.outcome, JSON.stringify(workerReply)).toBe('ok')
    expect(Object.hasOwn(workerReply, 'delivered')).toBe(true)
    expect(['sent', 'held', 'kept', 'not-delivered']).toContain(workerReply.delivered)
    const workerAgain = await callOn(pair.workerTools, 'reply_to_parent', {
      piece: pair.label,
      outcome: 'done',
      summary: 'again',
    })
    expect(workerAgain.outcome).toBe('refused')
    expect(workerAgain.rail).toBe(again.rail)
  })

  it('T7 · its owner retitles and rebriefs personal work, while only a giver closes agent work', async () => {
    const { id: pm, tools: pmTools } = await aPerson('pm')
    const taken = await takeOn(pmTools, 'the request')
    await bringIdentityIntoBeing('worker')
    const errand = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the errand',
      brief: 'the errand',
      piece: taken.label,
    })
    expect(errand.outcome, JSON.stringify(errand)).toBe('ok')
    const workerTools = agentToolsFor(host, errand.agent as string)
    const stranger = await aPerson('pm-stranger')

    // The owner names it.
    const retitled = await callOn(pmTools, 'update_work', {
      piece: taken.label,
      title: 'Renamed by its owner',
    })
    expect(retitled, JSON.stringify(retitled)).toMatchObject({
      outcome: 'ok',
      piece: taken.piece,
      title: 'Renamed by its owner',
    })
    expect(taskOf(pm, taken.piece)?.title).toBe('Renamed by its owner')
    expect(store.workById(taken.piece)?.givenBy).toBeNull()

    const rebriefed = await callOn(pmTools, 'update_work', {
      piece: taken.label,
      brief: 'a new brief',
    })
    expect(rebriefed.outcome, JSON.stringify(rebriefed)).toBe('ok')
    expect(taskOf(pm, taken.piece)).toMatchObject({ brief: 'a new brief', state: 'working' })
    expect(
      events(pm).filter((event) => event.type === 'work_rebriefed' && event.piece === taken.piece),
    ).toHaveLength(1)
    const closed = await callOn(pmTools, 'update_work', { piece: taken.label, close: true })
    expect(closed.outcome, JSON.stringify(closed)).toBe('refused')
    expect(closed.rail).toBe('the-giver-briefs-and-closes-a-piece')
    expect(taskOf(pm, taken.piece)?.state).toBe('working')

    // A conversation that is not its owner is told there is no such piece.
    const meddled = await callOn(stranger.tools, 'update_work', {
      piece: taken.label,
      title: 'mine now',
    })
    expect(meddled.outcome, JSON.stringify(meddled)).toBe('refused')
    expect(meddled.rail).toBe('no-piece-by-that-name')
    expect(taskOf(pm, taken.piece)?.title).toBe('Renamed by its owner')

    // Where the two readings differ: the worker owns a piece a conversation gave and may not name
    // it, while the giver may — and the taken-on piece's owner names its own.
    const byTheWorker = await callOn(workerTools, 'update_work', {
      piece: errand.label,
      title: 'mine',
    })
    expect(byTheWorker.outcome, JSON.stringify(byTheWorker)).toBe('refused')
    expect(byTheWorker.rail).toBe('the-giver-names-a-piece')
    const byTheGiver = await callOn(pmTools, 'update_work', {
      piece: errand.label,
      title: 'Renamed by its giver',
    })
    expect(byTheGiver, JSON.stringify(byTheGiver)).toMatchObject({ outcome: 'ok' })
    expect(taskOf(errand.agent as string, errand.piece as string)?.title).toBe(
      'Renamed by its giver',
    )
  })

  it('T8 · a question for the giver of a taken-on piece goes to a person, and the answer names reply_to_parent', async () => {
    const asked = (sessionId: string): QuestionAskedEvent[] =>
      events(sessionId).filter(
        (event): event is QuestionAskedEvent => event.type === 'question_asked',
      )
    const routed = (sessionId: string): RequestRoutedEvent[] =>
      events(sessionId).filter(
        (event): event is RequestRoutedEvent => event.type === 'request_routed',
      )

    // A piece it took on, named: the giver is a person.
    const { id: pm, tools: pmTools } = await aPerson('pm')
    const taken = await takeOn(pmTools, 'the request')
    const forPiece = await callWithWords(pmTools, 'ask_question', {
      question: 'which city?',
      who_answers: 'the-parent',
      piece: taken.label,
    })
    expect(forPiece.structured.outcome, JSON.stringify(forPiece.structured)).toBe('ok')
    expect(forPiece.structured.went_to).toBe('a-person')
    expect(forPiece.text).toContain('reply_to_parent is what does that')
    expect(forPiece.text).not.toContain('is a person’s')
    const askedAbout = asked(pm).find((one) => one.prompt === 'which city?')
    expect(askedAbout?.piece).toBe(taken.piece)
    expect(askedAbout?.label).toBe(taken.label)
    const routedAbout = routed(pm).find((one) => one.requestId === askedAbout?.requestId)
    expect(routedAbout?.to).toBe('a-person')
    expect(routedAbout !== undefined && Object.hasOwn(routedAbout, 'parent')).toBe(false)

    // The paired positive: a conversation that took nothing on and asks about its own root reaches
    // a person too — and its words are the other arm's, so the two texts really do differ.
    const alone = await aPerson('pm-alone')
    const forRoot = await callWithWords(alone.tools, 'ask_question', {
      question: 'which city?',
      who_answers: 'the-parent',
    })
    expect(forRoot.structured.outcome, JSON.stringify(forRoot.structured)).toBe('ok')
    expect(forRoot.structured.went_to).toBe('a-person')
    expect(forRoot.text).toContain('this conversation’s own work is a person’s')
    expect(forRoot.text).not.toContain('reply_to_parent is what does that')
    const askedRoot = asked(alone.id).find((one) => one.prompt === 'which city?')
    expect(askedRoot?.piece).toBe(alone.root.piece)
    expect(routed(alone.id).find((one) => one.requestId === askedRoot?.requestId)?.to).toBe(
      'a-person',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The store rig — the conversation/append/given helpers of one-task-one-reading.test.ts, with a
// piece written the way take_on_work writes one (recordGive, givenBy null).
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('D-016 · commit 6 · a piece that waits on the person — the store', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let now: number
  const ordinals = new Map<string, number>()
  const tick = (): number => now++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-takeon-store-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    now = 7_000_000
    ordinals.clear()
    store = createSessionStore(db, tick)
  })

  afterEach(() => {
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /** A person's conversation (it owns a root), or one another conversation started. */
  const conversation = (id: string, profileId: string, parentSessionId?: string): string => {
    store.create({
      id,
      provider: 'claude',
      cwd: userData,
      approvalMode: 'ask',
      profileId,
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
    })
    return id
  }
  const nextOrdinal = (id: string): number => {
    const next = ordinals.get(id) ?? 0
    ordinals.set(id, next + 1)
    return next
  }
  const append = (id: string, event: TranscriptEvent): void => {
    store.append(id, nextOrdinal(id), event, tick())
  }

  /**
   * A piece written the way the host writes one: its number under `under`'s root, then its `work`
   * row and its `work_given` row in the OWNER's ledger together. `givenBy` null is a request the
   * person made, taken on by its owner.
   */
  const writeAPiece = (
    owner: string,
    under: string,
    piece: string,
    givenBy: string | null,
  ): void => {
    const rootRow = store.rootOf(under)
    if (rootRow === null) throw new Error(`${under} owns no root`)
    const number = store.numberUnder(rootRow.piece)
    const label = `${rootRow.label}.${String(number)}`
    const title = `the work labelled ${label}`
    store.recordGive(
      {
        piece,
        parent: rootRow.piece,
        number,
        owner,
        givenBy,
        title,
        brief: title,
        folder: null,
        inputs: [],
      },
      nextOrdinal(owner),
      { type: 'work_given', piece, label, parent: rootRow.piece, givenBy, title, brief: title },
      tick(),
    )
  }

  const aTurn = (): TranscriptEvent[] => [
    { type: 'status', state: 'working' },
    { type: 'user_turn', text: 'go' },
    { type: 'turn', state: 'completed' },
    { type: 'status', state: 'idle' },
  ]

  const stateOf = (owner: string, piece: string): PieceRow | undefined =>
    store.piecesOwnedBy(owner).find((one) => one.piece === piece)

  const restartRows = (id: string): TranscriptEvent[] =>
    store
      .events(id)
      .map((entry) => entry.event)
      .filter((event) => event.type === 'work_restarted')

  it("T9 · a relaunch names a person's working piece but not one waiting on them", () => {
    const waitingOwner = conversation('sess_a', 'pm-a')
    const workingOwner = conversation('sess_b', 'pm-b')
    writeAPiece(waitingOwner, waitingOwner, 'work_a', null)
    writeAPiece(workingOwner, workingOwner, 'work_b', null)
    // sess_a's turn ended over its piece; sess_b's piece was written and nothing followed.
    for (const event of aTurn()) append(waitingOwner, event)
    expect(stateOf(waitingOwner, 'work_a')?.state).toBe<TaskState>(
      'waiting-on-the-person-who-asked',
    )
    expect(stateOf(workingOwner, 'work_b')?.state).toBe<TaskState>('working')

    // The sweep names only the one that was still working — and that is the positive: it did find
    // something, so the zero for sess_a is not a sweep that finds nothing.
    expect(store.settleRestartedWork(now, new Set())).toBe(1)
    expect(restartRows(workingOwner)).toEqual([{ type: 'work_restarted', pieces: ['work_b'] }])
    expect(stateOf(workingOwner, 'work_b')).toMatchObject({
      state: 'stalled',
      stalledBecause: 'app_restarted',
    })
    expect(restartRows(waitingOwner)).toEqual([])
    expect(stateOf(waitingOwner, 'work_a')?.state).toBe<TaskState>(
      'waiting-on-the-person-who-asked',
    )
    expect(stateOf(waitingOwner, 'work_a')).toMatchObject(noStall)

    // Nothing is left to name: a second launch writes nothing anywhere.
    expect(store.settleRestartedWork(now, new Set())).toBe(0)
    expect(restartRows(workingOwner)).toHaveLength(1)
    expect(restartRows(waitingOwner)).toEqual([])
  })

  it('T10 · a piece taken on mid-turn reads from the store as waiting on the person once that turn ends', () => {
    // Three completed turns, then a fourth in which the piece is taken on.
    const midTurn = (owner: string, givenBy: string | null): void => {
      for (let turn = 0; turn < 3; turn++) for (const event of aTurn()) append(owner, event)
      append(owner, { type: 'user_turn', text: 'please do this' })
      append(owner, { type: 'status', state: 'working' })
      writeAPiece(owner, givenBy ?? owner, `work_${owner}`, givenBy)
      append(owner, { type: 'turn', state: 'completed' })
      append(owner, { type: 'status', state: 'idle' })
    }
    const owner = conversation('sess_p', 'pm-p')
    midTurn(owner, null)

    const first = stateOf(owner, `work_${owner}`)
    expect(first?.state).toBe<TaskState>('waiting-on-the-person-who-asked')
    expect(first).toMatchObject(noStall)
    // Read twice: the remembered floor gives the same answer.
    expect(stateOf(owner, `work_${owner}`)).toEqual(first)

    // The person's next turn drives it back to working.
    append(owner, { type: 'user_turn', text: 'and another thing' })
    expect(stateOf(owner, `work_${owner}`)).toMatchObject({ state: 'working', ...noStall })

    // The paired positive: the same ledger with the piece given by a conversation stalls with the
    // turn's cause — so the floor does not lose the drive for either giver. ⚑ F097: the person's
    // words opened that turn before the piece was given, so no words drove it.
    const giver = conversation('sess_giver', 'pm-giver')
    const holder = conversation('sess_q', 'pm-q')
    midTurn(holder, giver)
    const given = stateOf(holder, `work_${holder}`)
    expect(given).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended', giver })
    expect(stateOf(holder, `work_${holder}`)).toEqual(given)
  })
})
