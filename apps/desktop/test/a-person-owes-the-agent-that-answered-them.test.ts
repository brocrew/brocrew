import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { giverStallNotices, RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { AgentState } from '../src/shared/agent-state'
import type { PieceRow } from '../src/shared/tasks'
import {
  DEFAULT_PROFILE_ID,
  type RuntimeEventMessage,
  type RuntimeStatesMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * F097 · a person owes the agent that answered them — the host half.
 *
 * A giver’s brief turn ending with work open stalls and notifies the giver. After a person
 * writes directly to the helper, a turn ending with that piece still open instead reads
 * `waiting-on-the-person-who-wrote`. The helper says “needs you”; the giver keeps waiting
 * without another notice. `waitingOnWhoWroteForAPerson` and the workspace count include the
 * piece, the person’s next message drives it, and the giver may assign more work.
 *
 * A real `RuntimeHost` over a real SQLite ledger, real migrations and the real tools; the only double
 * is the provider, which can hold a turn's end so *mid-turn* is a place the test can stand.
 *
 * ⚑ The names are literals, never computed by the code under test: the first new agent BroBot makes
 * is minted Ada, and she owns W1.1 (`an-agent-that-owes-another-an-answer-says-so.test.ts`'s family).
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** BroBot's child, as every door names her by the piece she owns. */
const ADA = 'Ada (the owner of W1.1 · Build the pages)'
/** A delay no other timer in the host uses, and no test waits out: nothing is stopped for idling. */
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

/** ⚑ The end of a turn, held at the provider while `held` stands. */
interface TurnEnds {
  held: Promise<void> | null
  release: () => void
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
  /**
   * ⚑ Every event passes as it came, but a `turn` waits for the hold to be let go — and a turn sent
   * while ends are held says, until its end passes, what a provider whose turn still runs says.
   * ⚠️ The plain double finishes a turn the moment it is sent, so without this its status would
   * read idle under a held end.
   */
  private kept(handle: FakeSessionHandle): FakeSessionHandle {
    this.handles.push(handle)
    const theirSend = handle.send.bind(handle)
    const theirs = handle.events.bind(handle)
    const theirStatus = handle.status.bind(handle)
    const ends = this.turnEnds
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
          yield event
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

describe('F097 · a person owes the agent that answered them', () => {
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
  /** Every message the host pushed on `runtime:states`, in order. */
  let pushed: RuntimeStatesMessage[]
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f097-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-f097-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    pushed = []
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
      // ⚑ The dep that makes the host derive and push at all — what main hands every window.
      statesMoved: (message) => {
        pushed.push(message)
      },
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
  const userTurnsIn = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'user_turn').length

  /** What was said to a conversation as a notice that its work is not being worked on. */
  const stallNoticesIn = (sessionId: string): string[] => giverStallNotices(store, sessionId)

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** The one state, derived fresh, as the app itself reads it. */
  const stateOf = (id: string): AgentState | undefined =>
    host.agentCard(id, THE_APP_ITSELF, id)?.state
  /** The last state the host pushed for a conversation. */
  const lastSaid = (id: string): AgentState | undefined =>
    pushed
      .flatMap((message) => message.moved)
      .filter((one) => one.conversation === id)
      .map((one) => one.state)
      .at(-1)
  /** What `get_agent_status` says of a conversation, as another agent reads it. */
  const wordsOf = async (asking: string, about: string): Promise<string> => {
    const said = await callOn(agentToolsFor(host, asking), 'get_agent_status', { agent: about })
    expect(said.outcome, JSON.stringify(said)).toBe('ok')
    return (said.agent as { state: string }).state
  }
  /** What `list_agents` says of a conversation, as another agent reads it. */
  const listedBy = async (asking: string, about: string): Promise<string | undefined> => {
    const listed = await callOn(agentToolsFor(host, asking), 'list_agents', {})
    const rows = listed.agents as { agent: string; state: string }[]
    return rows.find((one) => one.agent === about)?.state
  }
  /** Who owes the conversation the next move, in the reading the window's plates draw. */
  const needsYouOnItsPlate = (id: string): boolean | undefined =>
    host.whatEachConversationIsWaitingOn().conversations.find((one) => one.conversation === id)
      ?.needsYou
  const pieceOf = (owner: string, piece: string): PieceRow | undefined =>
    store.piecesOwnedBy(owner).find((one) => one.piece === piece)

  /** ⚑ BroBot gives W1.1 to a new worker, minted Ada; the brief's turn ends with it open. */
  const aGiverAndItsHelper = async (): Promise<{
    brobot: string
    brobotTools: AgentToolset
    ada: string
    piece: string
  }> => {
    const { sessionId: brobot } = await host.createSession(
      { provider: 'claude', profileId: DEFAULT_PROFILE_ID, approvalMode: 'auto', cwd: root },
      window,
    )
    await settle()
    const brobotTools = agentToolsFor(host, brobot)
    const given = await callOn(brobotTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      new: true,
      title: 'Build the pages',
      brief: 'build the pages',
    })
    expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label: 'W1.1' })
    const ada = given.agent as string
    await waitFor(() => stallNoticesIn(brobot).length === 1, 'the giver to be told of the stall')
    await waitFor(() => turnsIn(brobot) >= 1, 'the turn the notice opened')
    await settle()
    return { brobot, brobotTools, ada, piece: given.piece as string }
  }

  /** ⚑ A person writes to Ada through the window, and her turn runs to its end. */
  const aPersonWritesTo = async (ada: string, text: string): Promise<void> => {
    const turns = turnsIn(ada)
    await host.send(ada, text, window)
    await waitFor(() => turnsIn(ada) > turns, 'the turn the person opened to end')
    await settle()
  }

  it('🔴 the agent a person wrote to waits on that person: needs you everywhere, listed and counted, and its giver told nothing', async () => {
    const { brobot, ada, piece } = await aGiverAndItsHelper()

    // ⛔ THE CONTROL — the brief's turn was the giver's: the piece stalled and the giver was told.
    expect(pieceOf(ada, piece)).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
    expect(stallNoticesIn(brobot)).toHaveLength(1)
    expect(stateOf(ada)?.is).not.toBe('needs-you')
    expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
    expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 0 })

    // The person writes, and Ada's turn ends with the piece still open.
    host.claimSession(ada, window)
    await aPersonWritesTo(ada, 'is it done?')

    // The piece waits on the person who wrote: open, no stall, and since when.
    const waiting = pieceOf(ada, piece)
    expect(waiting).toMatchObject({
      state: 'waiting-on-the-person-who-wrote',
      stalledBecause: null,
      stalledAt: null,
      stalledBy: null,
      giver: brobot,
    })
    expect(typeof waiting?.answeredAPersonAt).toBe('number')

    // 🔴 Ada's one state is needs you, wherever it is read: the card, what was pushed to the
    // windows, get_agent_status and list_agents through the giver's own tools, and the plates.
    expect(stateOf(ada)).toEqual({ is: 'needs-you' })
    expect(lastSaid(ada)).toEqual({ is: 'needs-you' })
    expect(await wordsOf(brobot, ada)).toBe('needs you')
    expect(await listedBy(brobot, ada)).toBe('needs you')
    expect(needsYouOnItsPlate(ada)).toBe(true)

    // ⛔ The giver keeps reading waiting on Ada, and is told nothing more.
    expect(stateOf(brobot)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })
    expect(lastSaid(brobot)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })
    expect(stallNoticesIn(brobot)).toHaveLength(1)

    // 🔴 The person's list holds it, through the host and through the window's own door, and the
    // workspace reading counts it.
    const listed = host.waitingOnWhoWroteForAPerson()
    expect(listed).toMatchObject({ walk: 'every-conversation-that-was-given-work', rowsUnread: 0 })
    expect(listed.rows).toEqual([
      {
        piece,
        label: 'W1.1',
        title: 'Build the pages',
        owner: ada,
        ownerName: 'Ada',
        answeredAt: waiting?.answeredAPersonAt,
      },
    ])
    const throughTheDoor = await executeRuntimeCommand(host, window, {
      kind: 'waitingOnWhoWroteForAPerson',
    })
    expect(throughTheDoor).toEqual(listed)
    expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 1 })
  })

  it('keeps the holder waiting on the person through two notes and the giver waiting on the holder', async () => {
    const { brobot, brobotTools, ada, piece } = await aGiverAndItsHelper()
    host.claimSession(ada, window)
    await aPersonWritesTo(ada, 'which answer should it use?')
    const first = pieceOf(ada, piece)?.answeredAPersonAt

    for (const text of [
      'Use the standing workflow rules.',
      'Keep waiting for the person’s answer.',
    ]) {
      const turns = turnsIn(ada)
      const sent = await callOn(brobotTools, 'message_agent', {
        agent: 'W1.1',
        kind: 'note',
        piece: 'W1.1',
        text,
      })
      expect(sent, JSON.stringify(sent)).toMatchObject({ outcome: 'ok' })
      await waitFor(() => turnsIn(ada) > turns, 'the note-opened turn to end')
      await settle()
      expect(pieceOf(ada, piece)).toMatchObject({
        state: 'waiting-on-the-person-who-wrote',
        answeredAPersonAt: first,
        stalledBecause: null,
        stalledAt: null,
        stalledBy: null,
      })
      expect(stateOf(ada)).toEqual({ is: 'needs-you' })
      expect(lastSaid(ada)).toEqual({ is: 'needs-you' })
      expect(await wordsOf(brobot, ada)).toBe('needs you')
      expect(await listedBy(brobot, ada)).toBe('needs you')
      expect(needsYouOnItsPlate(ada)).toBe(true)
      expect(stateOf(brobot)).toEqual({
        is: 'waiting-on-a-worker',
        on: [ADA],
        since: expect.any(Number),
      })
      expect(host.waitingOnWhoWroteForAPerson().rows).toMatchObject([{ piece, answeredAt: first }])
      expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 1 })
      expect(stallNoticesIn(brobot)).toHaveLength(1)
    }
  })

  it('⚑ the person’s next message drives it — mid-turn the agent is no longer needs you — and its end waits on them again', async () => {
    const { ada, piece } = await aGiverAndItsHelper()
    host.claimSession(ada, window)
    await aPersonWritesTo(ada, 'is it done?')
    const first = pieceOf(ada, piece)?.answeredAPersonAt
    expect(stateOf(ada)).toEqual({ is: 'needs-you' })

    // The next message opens a turn whose end the provider holds.
    turnEnds.held = new Promise((resolve) => {
      turnEnds.release = resolve
    })
    const said = userTurnsIn(ada)
    const sending = host.send(ada, 'and the rest?', window)
    await waitFor(
      () => userTurnsIn(ada) > said && stateOf(ada)?.is === 'active',
      'the person’s words to open the turn',
    )
    await waitFor(() => lastSaid(ada)?.is === 'active', 'the window to be told it is active')

    // 🔴 Mid-turn: the piece is driven, so nothing waits on the person — not the state, not the
    // list, not the count.
    expect(pieceOf(ada, piece)).toMatchObject({ state: 'working', stalledBecause: null })
    expect(stateOf(ada)).toEqual({ is: 'active' })
    expect(needsYouOnItsPlate(ada)).toBe(false)
    expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
    expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 0 })

    // The turn ends: the person's words opened it, so the piece waits on them again — from now.
    const turns = turnsIn(ada)
    turnEnds.held = null
    turnEnds.release()
    await sending
    await waitFor(() => turnsIn(ada) > turns, 'the held turn to end')
    await settle()
    const again = pieceOf(ada, piece)
    expect(again?.state).toBe('waiting-on-the-person-who-wrote')
    expect(again?.answeredAPersonAt).toBeGreaterThan(first ?? Number.POSITIVE_INFINITY)
    expect(stateOf(ada)).toEqual({ is: 'needs-you' })
    expect(lastSaid(ada)).toEqual({ is: 'needs-you' })
    expect(host.waitingOnWhoWroteForAPerson().rows.map((row) => row.answeredAt)).toEqual([
      again?.answeredAPersonAt,
    ])
  })

  it('⚑ a new give to the agent while it waits names no stall — where a stall is named — and its own brief’s end still stalls', async () => {
    const { brobot, brobotTools, ada, piece } = await aGiverAndItsHelper()
    const giveMore = (title: string): Promise<Record<string, unknown>> =>
      callOn(brobotTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title,
        brief: title.toLowerCase(),
      })

    // The person writes, and Ada waits on them: a give is taken, and its answer names no stall.
    host.claimSession(ada, window)
    await aPersonWritesTo(ada, 'is it done?')
    expect(pieceOf(ada, piece)?.state).toBe('waiting-on-the-person-who-wrote')
    const turns = turnsIn(ada)
    const taken = await giveMore('Write the tests')
    expect(taken, JSON.stringify(taken)).toMatchObject({ outcome: 'ok', label: 'W1.2', agent: ada })
    expect(taken).not.toHaveProperty('stalled')

    // The new brief is the giver's words, and names only its own piece: its end stalls that piece,
    // and the giver is told of it — while the piece the person is owed still waits on them.
    await waitFor(() => turnsIn(ada) > turns, 'the new brief’s turn to end')
    await waitFor(() => stallNoticesIn(brobot).length === 2, 'the giver to be told of W1.2')
    await settle()
    expect(pieceOf(ada, taken.piece as string)).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
    })
    expect(pieceOf(ada, piece)?.state).toBe('waiting-on-the-person-who-wrote')
    expect(host.waitingOnWhoWroteForAPerson().rows.map((row) => row.label)).toEqual(['W1.1'])
    expect(stateOf(ada)).toEqual({ is: 'needs-you' })

    // ⛔ THE CONTROL — the next give names the piece that stalled, and not the one that
    // waits on the person.
    const named = await giveMore('Write the docs')
    expect(named, JSON.stringify(named)).toMatchObject({
      outcome: 'ok',
      label: 'W1.3',
      stalled: ['W1.2'],
    })
  })

  it('⛔ a more specific wait is said instead: an agent that asked its giver about the piece waits on that answer, and is neither needs you nor listed', async () => {
    const { brobot, ada, piece } = await aGiverAndItsHelper()
    host.claimSession(ada, window)
    await aPersonWritesTo(ada, 'which database should it use?')
    // The premise: the fold left the piece waiting on the person, and Ada reads needs you.
    expect(pieceOf(ada, piece)?.state).toBe('waiting-on-the-person-who-wrote')
    expect(stateOf(ada)).toEqual({ is: 'needs-you' })

    // Ada asks her giver about the piece — the answer it waits on is the giver's, not the person's.
    const asked = await callOn(agentToolsFor(host, ada), 'ask_question', {
      question: 'Which database should the pages use?',
      who_answers: 'the-parent',
      piece: 'W1.1',
    })
    expect(asked, JSON.stringify(asked)).toMatchObject({ outcome: 'ok' })
    await settle()

    // ⛔ The fold's own row still says the person wrote; every reading of it says the answer instead.
    expect(pieceOf(ada, piece)?.state).toBe('waiting-on-the-person-who-wrote')
    expect(stateOf(ada)?.is).toBe('waiting-on-an-answer')
    expect(lastSaid(ada)?.is).toBe('waiting-on-an-answer')
    expect(needsYouOnItsPlate(ada)).toBe(false)
    expect(await wordsOf(brobot, ada)).not.toBe('needs you')
    expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
    expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 0 })
  })
})
