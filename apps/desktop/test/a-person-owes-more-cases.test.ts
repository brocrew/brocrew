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
 * # a032e58f · feat(work): a piece waits on the person who wrote to its holder
 *
 * More cases for F097, over the harness of `a-person-owes-the-agent-that-answered-them.test.ts`: a
 * real `RuntimeHost` over a real SQLite ledger, and a provider double that can hold a turn's end.
 *
 * | § | what it pins | why the devs' own tests do not reach it |
 * |---|---|---|
 * | 1 | a holder that gives part of the piece out reads *waiting on* that worker: not *needs you*, not on the person's list, not counted — while its own fold still says the person wrote | their one *more specific wait* case is a question asked of the giver; the worker arm of `composeWhatEachPieceIsWaitingOn` is never met by either reader (`RuntimeHost.aPieceItHoldsWaitsOnWhoWrote`, `SessionStore.piecesWaitingOnWhoWrote`) |
 * | 2 | the take-back of a person's held reply, and the holder's own reply, each move what the windows were told, with no other row | `MOVES_A_PIECE_THAT_WAITS_ON_WHO_WROTE` is read only by the push; the fold tests are pure and never look at what was pushed |
 * | 3 | the person's list is oldest first; a rebuilt ledger is folded again even when it ends at the same ordinal; a ledger with a torn row is never kept, so every read counts the row | the list and its kept fold are only ever read with one row, once |
 *
 * ⚑ The names are literals: BroBot's first new agent is Ada, and she owns W1.1.
 * ⚠️ The rail badge's one-row-per-piece count (a helper holding two such pieces counts 2) is an open
 * product decision, and nothing here pins it either way.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** A delay no other timer in the host uses, and no test waits out: nothing is stopped for idling. */
const IDLE = 7_654_321
const WROTE = 'waiting-on-the-person-who-wrote'

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
  /** ⚑ Every event passes as it came, but a `turn` waits for the hold to be let go. */
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

/** A tool call left running while the test goes on, settled either way so nothing is unhandled. */
type Settled = { readonly answer: Record<string, unknown> } | { readonly error: unknown }

describe('F097 · a person owes the agent that answered them — more cases', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f097-more-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-f097-more-root-'))
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
      statesMoved: (message) => {
        pushed.push(message)
      },
      idleStopAfterMs: IDLE,
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    turnEnds.held = null
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
  /** ⚑ A call whose answer may wait on a held turn: started now, read at the end. */
  const leftRunning = (call: Promise<Record<string, unknown>>): Promise<Settled> =>
    call.then(
      (answer): Settled => ({ answer }),
      (error: unknown): Settled => ({ error }),
    )

  const stateOf = (id: string): AgentState | undefined =>
    host.agentCard(id, THE_APP_ITSELF, id)?.state
  const lastSaid = (id: string): AgentState | undefined =>
    pushed
      .flatMap((message) => message.moved)
      .filter((one) => one.conversation === id)
      .map((one) => one.state)
      .at(-1)
  const needsYouOnItsPlate = (id: string): boolean | undefined =>
    host.whatEachConversationIsWaitingOn().conversations.find((one) => one.conversation === id)
      ?.needsYou
  const pieceOf = (owner: string, piece: string): PieceRow | undefined =>
    store.piecesOwnedBy(owner).find((one) => one.piece === piece)
  const labelled = (owner: string, label: string): PieceRow | undefined =>
    store.piecesOwnedBy(owner).find((one) => one.label === label)

  const holdTheTurnEnds = (): void => {
    turnEnds.held = new Promise((resolve) => {
      turnEnds.release = resolve
    })
  }
  const letTheTurnEndsGo = (): void => {
    turnEnds.held = null
    turnEnds.release()
  }

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

  /** ⚑ A person writes to a helper through the window, and its turn runs to its end. */
  const aPersonWritesTo = async (helper: string, text: string): Promise<void> => {
    host.claimSession(helper, window)
    const turns = turnsIn(helper)
    await host.send(helper, text, window)
    await waitFor(() => turnsIn(helper) > turns, 'the turn the person opened to end')
    await settle()
  }

  /** ⚑ Ada waits on the person who wrote to her, and every reading says so. */
  const adaWaitsOnThePerson = async (): Promise<{
    brobot: string
    brobotTools: AgentToolset
    ada: string
    piece: string
  }> => {
    const gave = await aGiverAndItsHelper()
    await aPersonWritesTo(gave.ada, 'is it done?')
    expect(pieceOf(gave.ada, gave.piece)?.state).toBe(WROTE)
    expect(stateOf(gave.ada)).toEqual({ is: 'needs-you' })
    expect(lastSaid(gave.ada)).toEqual({ is: 'needs-you' })
    return gave
  }

  describe('§1 · a holder that handed part of the piece out waits on that worker', () => {
    it('🔴 not needs you, not listed, not counted — while the fold’s own row still says the person wrote', async () => {
      const { ada, piece } = await adaWaitsOnThePerson()
      // ⚑ THE CONTROL — before the give, the person's list holds the piece and the badge counts it.
      expect(host.waitingOnWhoWroteForAPerson().rows.map((row) => row.piece)).toEqual([piece])
      expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 1 })
      expect(needsYouOnItsPlate(ada)).toBe(true)

      // Ada gives a part of W1.1 to a new agent. Its brief's turn is held, so W1.1.1 stays open
      // (`working`) and nobody is told anything that would run Ada again.
      holdTheTurnEnds()
      const giving = leftRunning(
        callOn(agentToolsFor(host, ada), 'give_work', {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'tester',
          new: true,
          piece: 'W1.1',
          title: 'Wire the routes',
          brief: 'wire the routes',
        }),
      )
      await waitFor(
        () =>
          store.piecesGivenBy(ada).some((one) => one.label === 'W1.1.1' && one.state === 'working'),
        'the part Ada gave out to be open',
      )
      await settle()

      // ⚑ The premise: the fold of Ada's own ledger is untouched — W1.1 still waits on the person.
      expect(pieceOf(ada, piece)?.state).toBe(WROTE)
      // ⛔ The host's reading composes: Ada waits on the worker holding W1.1.1 — read fresh, on her
      // plate, and as pushed to the windows. (Skipping the composition in
      // `aPieceItHoldsWaitsOnWhoWrote` makes all three say needs you.)
      expect(stateOf(ada)?.is).toBe('waiting-on-a-worker')
      expect(needsYouOnItsPlate(ada)).toBe(false)
      expect(lastSaid(ada)?.is).toBe('waiting-on-a-worker')
      // ⛔ The store's walk composes: the person's list is empty and the badge counts nothing.
      // (Skipping the composition in `piecesWaitingOnWhoWrote` lists W1.1 and counts 1.)
      expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
      expect(store.piecesWaitingOnWhoWrote().rows).toEqual([])
      expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 0 })

      letTheTurnEndsGo()
      expect(await giving).toMatchObject({ answer: { outcome: 'ok', label: 'W1.1.1' } })
    })
  })

  describe('§2 · the rows that move what the windows were told, with no other row behind them', () => {
    it('⛔ a person’s reply held while the agent is busy, then taken back: the windows are told needs you again', async () => {
      const { brobotTools, ada, piece } = await adaWaitsOnThePerson()
      const first = pieceOf(ada, piece)?.answeredAPersonAt
      expect(typeof first).toBe('number')

      // BroBot gives Ada W1.2; its brief names only W1.2, and its turn's end is held — so Ada is busy
      // while W1.1 still waits on the person.
      holdTheTurnEnds()
      const said = userTurnsIn(ada)
      const giving = leftRunning(
        callOn(brobotTools, 'give_work', {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'worker',
          title: 'Write the tests',
          brief: 'write the tests',
        }),
      )
      await waitFor(
        () => userTurnsIn(ada) > said && labelled(ada, 'W1.2')?.state === 'working',
        'W1.2’s brief to open Ada’s turn',
      )
      await settle()
      // ⚑ The premise: busy, and still needs you — W1.1 waits on the person under the running turn.
      expect(pieceOf(ada, piece)?.state).toBe(WROTE)
      expect(stateOf(ada)).toEqual({ is: 'needs-you' })

      // The person replies while Ada is busy: the words are held, and W1.1 is driven by them.
      const queued = await host.queueMessage(ada, 'use postgres', window)
      if (queued.outcome !== 'queued') throw new Error('the premise: the reply was not held')
      await settle()
      expect(pieceOf(ada, piece)?.state).toBe('working')
      // ⚑ THE CONTROL — the hold is pushed: the windows stop saying needs you.
      expect(stateOf(ada)).toEqual({ is: 'active' })
      expect(lastSaid(ada)).toEqual({ is: 'active' })

      // ⛔ The person takes the reply back. The only row written is `message_unqueued`, and the turn
      // is still held, so nothing else can mark Ada.
      await host.cancelQueuedMessage(ada, queued.messageId, window)
      await settle()
      expect(pieceOf(ada, piece)?.state).toBe(WROTE)
      expect(pieceOf(ada, piece)?.answeredAPersonAt).toBe(first)
      expect(stateOf(ada)).toEqual({ is: 'needs-you' })
      // 🔴 Without `message_unqueued` in the set, the windows would go on saying active.
      expect(lastSaid(ada)).toEqual({ is: 'needs-you' })

      letTheTurnEndsGo()
      expect(await giving).toMatchObject({ answer: { outcome: 'ok', label: 'W1.2', agent: ada } })
    })

    it('⛔ the holder’s own reply ends the piece: the windows stop saying needs you, by the reply alone', async () => {
      const { ada, piece } = await adaWaitsOnThePerson()
      const replied = await callOn(agentToolsFor(host, ada), 'reply_to_parent', {
        piece: 'W1.1',
        outcome: 'done',
        summary: 'the pages are built',
      })
      expect(replied, JSON.stringify(replied)).toMatchObject({ outcome: 'ok' })
      await settle()
      expect(pieceOf(ada, piece)?.state).toBe('answered')
      // ⚑ THE CONTROL — read fresh, Ada no longer needs anybody.
      expect(stateOf(ada)?.is).not.toBe('needs-you')
      expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
      // 🔴 …and the windows were told so. Without `work_replied` in the set nothing marks Ada (the
      // reply marks only those waiting on her, and her giver), so this would stay needs you.
      expect(lastSaid(ada)).toEqual(stateOf(ada))
    })
  })

  describe('§3 · the person’s list: its order and its kept fold', () => {
    it('⚑ two holders are listed oldest first — the one written to first, not the one given work first', async () => {
      const { brobot, brobotTools, ada, piece } = await aGiverAndItsHelper()
      const second = await callOn(brobotTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'tester',
        new: true,
        title: 'Review the pages',
        brief: 'review the pages',
      })
      expect(second, JSON.stringify(second)).toMatchObject({ outcome: 'ok', label: 'W1.2' })
      const bob = second.agent as string
      await waitFor(() => stallNoticesIn(brobot).length === 2, 'the giver to be told of W1.2')
      await waitFor(() => turnsIn(brobot) >= 2, 'the turn the second notice opened')
      await settle()

      // The person writes to the SECOND helper first, then to Ada.
      await aPersonWritesTo(bob, 'how is the review?')
      await aPersonWritesTo(ada, 'is it done?')
      const bobs = pieceOf(bob, second.piece as string)?.answeredAPersonAt ?? Number.NaN
      const adas = pieceOf(ada, piece)?.answeredAPersonAt ?? Number.NaN
      expect(bobs).toBeLessThan(adas)

      // ⛔ Oldest first: Bob's, then Ada's — the reverse of the order the pieces were given in, so
      // neither a flipped sign nor a missing sort can pass.
      const rows = store.piecesWaitingOnWhoWrote().rows
      expect(rows.map((row) => row.owner)).toEqual([bob, ada])
      expect(rows.map((row) => row.answeredAPersonAt)).toEqual([bobs, adas])
      // ⚑ The host's list carries the store's order.
      expect(host.waitingOnWhoWroteForAPerson().rows.map((row) => row.owner)).toEqual([bob, ada])
    })

    it('⛔ a rebuilt ledger is folded again, even when it ends at the same ordinal as the one kept', async () => {
      const { brobot, ada, piece } = await adaWaitsOnThePerson()
      // ⚑ THE CONTROL — read twice, the second from what was kept: the piece is listed both times.
      expect(store.piecesWaitingOnWhoWrote().rows.map((row) => row.piece)).toEqual([piece])
      expect(store.piecesWaitingOnWhoWrote().rows.map((row) => row.piece)).toEqual([piece])

      // Ada's ledger is rebuilt as a new generation with the SAME ordinals, so its newest row is the
      // one the kept fold was keyed on — but there the turn was opened by the giver's note, not by
      // the person, so its end stalls W1.1.
      const asTheGiversNote = (event: TranscriptEvent): TranscriptEvent =>
        event.type === 'user_turn' && event.attribution === undefined
          ? {
              type: 'user_turn',
              text: event.text,
              attribution: 'app_authored',
              relayedFrom: brobot,
              says: 'note',
            }
          : event
      const rows = store.events(ada)
      const newest = rows.at(-1)?.ordinal
      const next = store.beginGeneration(ada)
      store.appendGeneration(
        ada,
        next,
        rows.map((row) => ({
          ordinal: row.ordinal,
          event: asTheGiversNote(row.event),
          at: row.at,
        })),
      )
      expect(store.promoteGeneration(ada, next, { normalizerVersion: 1, derivedThrough: 0 })).toBe(
        true,
      )
      expect(store.events(ada).at(-1)?.ordinal).toBe(newest)
      // ⚑ The rebuild took: the fold of the new generation stalls the piece.
      expect(pieceOf(ada, piece)).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })

      // ⛔ The walk folds the new generation too. Keyed on the newest ordinal alone, it would hand
      // back the kept row from the generation that is gone.
      expect(store.piecesWaitingOnWhoWrote().rows).toEqual([])
      expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
    })

    it('⛔ a ledger with a row that cannot be read is never kept: every read counts the row', async () => {
      const { ada, piece } = await adaWaitsOnThePerson()
      // ⚑ THE CONTROL — a clean ledger: nothing unread.
      expect(store.piecesWaitingOnWhoWrote().rowsUnread).toBe(0)

      // A torn `status` row after everything else: the piece fold reads it and skips it (W1.1 is
      // unchanged — the turn before it already ended), and no wait read selects it.
      db.prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, 0, ?, 'status', '{not json', ?)`,
      ).run('evt_torn_status_90000', ada, 90_000, tick())

      const once = store.piecesWaitingOnWhoWrote()
      expect(once.rows.map((row) => row.piece)).toEqual([piece])
      expect(once.rowsUnread).toBe(1)
      // ⛔ The ledger has not grown since, so a kept fold would be handed back — and the row it
      // skipped would go uncounted. It was not kept: the second read counts it again.
      const twice = store.piecesWaitingOnWhoWrote()
      expect(twice.rows.map((row) => row.piece)).toEqual([piece])
      expect(twice.rowsUnread).toBe(1)
      // ⚑ …and so does the host's list, read a third time.
      expect(host.waitingOnWhoWroteForAPerson().rowsUnread).toBe(1)
    })
  })
})
