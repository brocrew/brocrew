import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { CallerIdentity, RuntimeEventSink } from './helpers/giver-notice-host'
import { agentCallerId, type AgentToolHost, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN, TASK_STATES, derivePieces, type TaskState } from '../src/shared/tasks'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **379 · a task you can see** — Slice 4 S1, HO-006 §4.1, HO-007 S1 + criterion 2.
 *
 * ## ⛔ The ticket, and the three dispatches that said the id did not exist
 *
 * `362` §4.2: a task id is *"absent from `SpawnRequest`, `AdmittedSpawn`, `CreateSessionInput` and
 * `NewSessionRecord`… `354`'s msg id is still not a task id."* `353` §6.4: *"the parent's neutral
 * `tool_call` has no structured arguments suitable for a cross-ledger join… runtime-only
 * `commandedBy` proves entitlement, not a durable act."* ⚑ So the brief's own permission is the one
 * this dispatch took: *"adding an event is legitimate; deriving from an event that does not carry
 * what you need is not."*
 *
 * ## ⚑ D-016 · the task is a PIECE now, and this file measures the piece
 *
 * ⛔ **The 379 task is gone** — the `task_assigned` event, `message_agent`'s `work` kind, the number
 * per project and `deriveTasks`. ⚑ **What it named survives as a piece of work**: a giver hands an
 * agent a piece with `give_work`, and that is ONE `work_given` row in the ledger of the conversation
 * that was given it (written with its `work` row), labelled under the giver's own piece (`W1.2`) —
 * and `derivePieces` folds the ledger into the rows every surface reads. So every section below is
 * re-aimed at the piece where its property still holds, and what lost its subject went: *no table
 * was created* (§0 — a piece has a `work` row), the number per project (§4), the mint read off the
 * CALLER of `queueMessage` (§6) and the document join (§8).
 *
 * ## ⚑ What a piece IS, in one sentence
 *
 * **The work one conversation gives another**, named `work_<uuid>`, numbered under the giver's piece
 * before the brief is sent (D-016 · R4), and recorded — its row and its `work_given` together — once
 * the brief is sent or held, in the conversation it reached. ⛔ **Its STATE is derived**:
 * `derivePieces` folds the ledger, and it can read nothing else.
 *
 * ## ⚠️ Where the readings diverge, which is where every section is written
 *
 *  - **§2** derived vs stored — the ledger rows ALONE, in a database whose `work` table is EMPTY.
 *    ⛔ A test that never drops anything passes under both readings.
 *  - **§3** a crash mid-piece — the state `354` measured, and the one place *"derive it"* is
 *    provably impossible.
 *  - **§4** the number — a counter under the parent, allocated before the send and never reused.
 *  - **§5** a restart mid-piece — `373` made the parent survive one; the piece must too.
 *  - **§6** a PERSON — a message, minting nothing.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools** — `375`'s harness, because the subject
 * is the same door one field over.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')
const sharedRoot = join(here, '../src/shared')

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

/** `373`'s double; its registry is shared so a restart can find refs the first launch issued. */
class ToolWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
    /** ⚑ **496 · the handles, kept** — see `busyWithNoCard`. */
    private readonly handles: FakeSessionHandle[] = [],
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    this.handles.push(handle)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    this.handles.push(handle)
    return handle
  }
}

describe('379 · a task you can see', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let secondWindow: RecordingSink
  /**
   * ⛔ **Reset per test, and the reason is a real trap rather than hygiene.** `newSessionId` restarts
   * at `sess_1` in every `beforeEach`, so a set that outlived one test would say *"already claimed"*
   * about a DIFFERENT conversation with the same id — and the card would then be answered by a
   * window that does not own it, which fails with a sentence about the wrong thing entirely.
   */
  let claimed: Set<string>
  const tick = (): number => clock++

  const buildHost = (over: SessionStore = store): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new ToolWatchingRuntime(provider, handed, issued, handles),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-task-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-task-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    handles = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    secondWindow = new RecordingSink('webContents:2')
    claimed = new Set<string>()
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  // ⚑ **D-016** — a launch names no project any more, so the helper takes none.
  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      {
        provider: 'claude',
        profileId,
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
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

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  /**
   * ⚑ **What the counter holds, WITHOUT taking it** (383). `numberUnder` consumes, so a test that
   * wants to say *"and nothing moved"* cannot ask through the store. ⚠️ An absent row is `1` for
   * the upsert's reason: the first number taken under a piece creates it.
   */
  const nextNumberWithoutTakingIt = (parent: string): number =>
    ((
      db.prepare('SELECT last FROM work_sequence WHERE scope = ?').get(parent) as
        { last: number } | undefined
    )?.last ?? 0) + 1

  /**
   * ⚠️ **Prose quotes code, so a census that COUNTS has to read the code only** —
   * `a-source-census-must-strip-prose-before-it-asserts`. ⛔ Both spellings, because a docblock's
   * `{@link}` is the one that bit here.
   */
  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const typesIn = (sessionId: string): string[] => ledger(sessionId).map((event) => event.type)

  /** The app-internal handle on the newest held row; model-facing tool answers do not expose it. */
  const lastQueuedMessageId = (sessionId: string): string => {
    const queued = [...ledger(sessionId)].reverse().find((event) => event.type === 'message_queued')
    if (queued?.type !== 'message_queued' || queued.messageId === undefined) {
      throw new Error(`${sessionId} has no named queued message`)
    }
    return queued.messageId
  }

  /** ⚑ **D-016 · a PM in a window, and the agent it gives work to brought into being.** */
  const aPm = async (): Promise<{ pm: string; pmTools: AgentToolset }> => {
    await bringIdentityIntoBeing('worker')
    const pm = await personOpens('pm')
    return { pm, pmTools: theToolsetJustHandedOut() }
  }

  /** ⚑ **D-016 · a give to the worker, through the real tool** — the one door that gives work. */
  const give = (pmTools: AgentToolset, brief: string): Promise<Record<string, unknown>> =>
    callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: brief,
      brief,
    })

  /**
   * `373`'s helper: a PM in a window with one child of its own, through the real door.
   *
   * ⚑ **D-016 · a give STARTS the child, and its brief is the child's first turn** — so the child is
   * made by the first piece of work, whose words each test names, and the answer to that give is
   * returned beside it. ⚑ **415 · the child's own toolset** is the one its launch was handed, which is
   * the last one out.
   */
  const aPmAndItsWorker = async (
    brief: string,
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerTools: AgentToolset
    first: Record<string, unknown>
  }> => {
    const { pm, pmTools } = await aPm()
    const first = await give(pmTools, brief)
    expect(first.outcome, JSON.stringify(first)).toBe('ok')
    return {
      pm,
      worker: first.agent as string,
      pmTools,
      workerTools: theToolsetJustHandedOut(),
      first,
    }
  }

  /**
   * 🔴 **415 · the receiver finishes what it holds before the next piece is given.**
   *
   * ⚑ **D-016 · the rail that required it is gone** — `agent-already-has-work-open` went, and a busy
   * helper takes a second piece — so this is no longer what makes a second give ADMITTED. ⛔ It is
   * kept because every row below was written over a ledger in which the first piece is answered
   * before the next one arrives, and that is still a state the product reaches.
   *
   * ⛔ **It is called MID-TURN, and that is the whole reason a `waiting` piece is still reachable.**
   * `reply_to_parent` is a tool call inside a turn that is still parked on its card, so the child
   * stays BUSY: the piece closes, the conversation does not, and the next piece of work is held
   * exactly as it always was. ⚠️ A test that let the turn end first would find the child idle and
   * measure the other branch.
   *
   * ⚑ **The open one is FOUND rather than named**, through {@link TASK_IS_OPEN} — so a test cannot
   * quietly reply to a piece that was already closed and believe it had cleared the way.
   */
  const theWorkIsFinished = async (
    worker: string,
    workerTools: AgentToolset,
    summary = 'the first thing is done',
  ): Promise<string> => {
    const open = store.piecesOwnedBy(worker).filter((piece) => TASK_IS_OPEN[piece.state])
    expect(open.map((piece) => piece.piece)).toHaveLength(1)
    const replied = await callOn(workerTools, 'reply_to_parent', {
      piece: open[0]?.piece,
      outcome: 'done',
      summary,
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    return open[0]?.piece ?? ''
  }

  /**
   * ⚑ **496 · a busy child with NO person's card.**
   *
   * ⛔ **`end_agent` could not end a conversation somebody was being asked something in**
   * (HO-034 §1; ⚑ D-017 removed the verb), and the Fake parks every `ask`-mode turn on a permission
   * card — so *"the child is busy"* built out of a send was the one state that verb refused. ⚠️ `simulateThinking` latches
   * `working` through the provider's own work counter, which is the same `status() !== 'idle'` the
   * host's queue reads when it decides to HOLD a message.
   */
  const busyWithNoCard = async (): Promise<void> => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    handle.simulateThinking({ text: 'deciding what to do', redacted: false })
    await waitFor(() => handle.status() === 'working', 'the conversation to be working')
  }

  /** The card the FakeRuntime parks every turn on, once it has actually been asked for. */
  const cardOn = async (sessionId: string): Promise<string> => {
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card the turn parks on',
    )
    const asked = ledger(sessionId)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (asked === undefined || asked.type !== 'permission_request') {
      throw new Error('no permission request on the ledger')
    }
    return asked.id
  }

  /**
   * Answer the open card so the turn runs to its own terminal.
   *
   * ⚠️ **A person has to take the conversation over first, and that is the app's rule rather than
   * the test's convenience** (HO-005 Q2, 340 §2): a child a give started has no owner, and a
   * permission is always a person's — the parent that commands it may not answer for one.
   * `claimSession` is how a window takes an unowned conversation over, and it leaves `commandedBy`
   * alone, so the parent is still the parent afterwards.
   */
  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const id = await cardOn(sessionId)
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'turn'),
      'the turn to reach its own terminal',
    )
  }

  const stateOf = (sessionId: string, piece: string): TaskState | undefined =>
    store.piecesOwnedBy(sessionId).find((one) => one.piece === piece)?.state

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §0 · what a piece IS — the id, where it is minted, and what makes it durable
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§0 · the id, where it is minted, and what makes it durable', () => {
    it('🔴 a parent gives work and a row appears — with an id, a label and a parent', async () => {
      const { pm, pmTools } = await aPm()
      expect(store.piecesGivenBy(pm)).toEqual([])

      const said = await give(pmTools, 'read the brief and report')
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      const worker = said.agent as string

      // ⚑ **D-016 · labelled under the giver's own piece** — its root, `W<n>`, since it holds nothing
      // else — and numbered 1 there. ⛔ No project: D-016 took the number's project away.
      const rootOfPm = store.rootOf(pm)
      expect(rootOfPm).not.toBeNull()
      const [piece] = store.piecesOwnedBy(worker)
      expect(piece).toBeDefined()
      expect(piece?.piece).toMatch(/^work_[0-9a-f-]{36}$/)
      expect(piece?.piece).toBe(said.piece)
      expect(piece?.label).toBe(`${rootOfPm?.label ?? '?'}.1`)
      expect(piece?.label).toBe(said.label)
      expect(piece?.parent).toBe(rootOfPm?.piece)
      expect(piece?.giver).toBe(pm)
      expect(piece?.owner).toBe(worker)
      expect(piece?.title).toBe('read the brief and report')
      expect(piece?.brief).toBe('read the brief and report')
    })

    it('⛔ …and it is minted ABOVE the held/sent branch, so both branches produce one', async () => {
      // 🔴 **`354` deliberately left the straight-out branch nameless** — *"no id on this branch, and
      // it is a compile error to look for one"* — because nothing was being HELD, so there was
      // nothing to cancel. ⚠️ That reasoning is about a message and does not carry to a piece: the
      // work was given either way. This is the divergence between *"reuse `354`'s id"* and *"mint
      // above the branch"*, and it is the whole reason a piece needed an event of its own. ⚑ **D-016 ·
      // R4 — the number is taken before the send**, so both branches carry one.
      //
      // ⚑ The child was STARTED for the first give and took its brief at once, so that one went
      // straight out and the answer carries no id at all.
      const { worker, pmTools, workerTools, first: straightOut } = await aPmAndItsWorker('first')
      expect(straightOut.delivery).toBe('sent')
      expect(straightOut.message).toBeUndefined()

      await cardOn(worker)
      await theWorkIsFinished(worker, workerTools)

      // The child is BUSY still — the reply was a tool call inside its turn — so this one is held
      // and DOES have a message id. ⚑ **D-016 · and it reaches the SAME conversation** — one
      // conversation per helper per giver.
      const held = await give(pmTools, 'second')
      // ⚑ **D-022 · R3** — a held give answers `held`, the word the verbs that tell a piece's
      // holder share, where it answered `queued`.
      expect(held.delivery, JSON.stringify(held)).toBe('held')
      expect(held.agent).toBe(worker)
      expect(held).not.toHaveProperty('message')
      const heldMessageId = lastQueuedMessageId(worker)
      expect(heldMessageId).toMatch(/^msg_/)

      const pieces = store.piecesOwnedBy(worker)
      expect(pieces).toHaveLength(2)
      // ⛔ **Two pieces, and the difference between them is `messageId` and the state it implies** —
      // never whether one exists.
      expect(pieces.map((piece) => piece.messageId)).toEqual([null, heldMessageId])
      expect(pieces.map((piece) => piece.state)).toEqual(['answered', 'waiting'])
      expect(pieces.map((piece) => piece.label.split('.').at(-1))).toEqual(['1', '2'])
    })

    it('⛔ …and it is recorded AFTER the message it names, on both branches', async () => {
      // 🔴 **The order is the durability argument, and it is not cosmetic.** They are two appends: a
      // crash between them leaves a brief with no piece, which reads as nothing at all. ⚠️ The
      // reverse would leave a piece naming work that was never handed over — a row on somebody's
      // board for a message that does not exist. `publishOurs`'s own rule is *"only after the
      // provider has accepted it, never before"*.
      const { worker, pmTools, workerTools } = await aPmAndItsWorker('first')
      const straightOut = typesIn(worker)
      // ⚠️ **AFTER, not adjacent.** `send` awaits the provider before it publishes the turn, so the
      // provider's own first frames can land between the two rows — an adjacency assertion would be
      // pinning the double's scheduling rather than this dispatch's ordering rule.
      expect(straightOut.filter((type) => type === 'user_turn')).toHaveLength(1)
      expect(straightOut.filter((type) => type === 'work_given')).toHaveLength(1)
      expect(straightOut.indexOf('work_given')).toBeGreaterThan(straightOut.indexOf('user_turn'))

      await cardOn(worker)
      await theWorkIsFinished(worker, workerTools)
      await give(pmTools, 'second')
      const held = typesIn(worker)
      expect(held.indexOf('message_queued')).toBeGreaterThan(0)
      expect(held.lastIndexOf('work_given')).toBeGreaterThan(held.indexOf('message_queued'))
    })

    it('⚑ durability is the LEDGER: the row is one event and the slot holds nothing', async () => {
      const { pm, worker } = await aPmAndItsWorker('do the thing')

      // ⛔ **One row, in the ledger of the conversation that was GIVEN the work.**
      const given = ledger(worker).filter((event) => event.type === 'work_given')
      expect(given).toHaveLength(1)
      // ⚠️ **And not a second copy in the giver's**, which would be two halves of one fact, free to
      // disagree. `353` §4.3's cross-ledger gap is closed by the owner's row NAMING the giver.
      expect(store.piecesOwnedBy(worker)[0]?.giver).toBe(pm)
      expect(typesIn(pm)).not.toContain('work_given')
    })

    // ⚑ **D-016 · *…and no `task` table was created for it* is gone.** Its subject was the absence
    // of a table, and D-016 built one: a piece has a `work` row, written with its `work_given` in one
    // transaction. ⛔ What that case protected still holds and §2 measures it — every field of a
    // piece's ROW is derived from the ledger, with the `work` table empty.
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · criterion 1 — the row's state changes only because an event landed
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the state moves, and only an event moves it', () => {
    it('🔴 waiting → working, and then a turn ending leaves it stalled — one ledger row each', async () => {
      // ⛔ **415 · the title lost a state and the test lost one assertion, deliberately.** ⚠️ It read
      // *waiting → working → silent* over TWO tasks at once: the first `working` while the second
      // waited behind it, then the first `stalled` by the turn ending. ⚑ **Every transition it
      // measured is still measured**: `waiting → working` by the flush below, and `working → stalled`
      // by a turn ending, which the next test performs over a piece that is genuinely open when its
      // turn ends.
      const { worker, pmTools, workerTools } = await aPmAndItsWorker('the first thing')
      await cardOn(worker)
      const first = await theWorkIsFinished(worker, workerTools)
      const held = await give(pmTools, 'the second')
      expect(held.delivery, JSON.stringify(held)).toBe('held')
      const heldMessageId = lastQueuedMessageId(worker)
      const second = store.piecesOwnedBy(worker)[1]?.piece ?? ''

      expect(stateOf(worker, second)).toBe('waiting')
      // ⚑ **The CLOSED one must not move either**, which is the same guard pointed at the state that
      // replaced it: a fold that acted on *"whichever piece is there"* would reopen this one.
      expect(stateOf(worker, first)).toBe('answered')

      await letTheTurnFinish(worker)
      // ⚑ And the flush that follows the turn ending moves the SECOND one, by its own event.
      await waitFor(() => stateOf(worker, second) === 'working', 'the held piece to be handed over')
      expect(stateOf(worker, first)).toBe('answered')
      expect(
        ledger(worker)
          .filter((event) => event.type === 'message_unqueued')
          .map((event) => (event.type === 'message_unqueued' ? event.reason : '')),
      ).toEqual(['sent'])
      expect(store.piecesOwnedBy(worker)[1]?.messageId).toBe(heldMessageId)

      // ⛔ **`stalled`, not `done` and not `failed`.** The child stopped working and said nothing
      // structured; naming an outcome here would be this slice inventing one.
      await letTheTurnFinish(worker)
      await waitFor(() => stateOf(worker, second) === 'stalled', 'the second piece to stall')
      expect(store.piecesOwnedBy(worker)[1]?.stalledBecause).toBe('turn_ended')
    })

    it('⛔ a message taken back WITHDRAWS its task; the conversation ending only STALLS one', async () => {
      // ⚑ The pairing this test is about: the cancel names one message, and the two pieces it does
      // NOT name — one closed by a reply, one still open — are both untouched by it.
      const { pm, worker, pmTools, workerTools } = await aPmAndItsWorker('the first thing')
      await cardOn(worker)
      const first = await theWorkIsFinished(worker, workerTools)
      const held = await give(pmTools, 'the second')
      expect(held.delivery, JSON.stringify(held)).toBe('held')
      const heldMessageId = lastQueuedMessageId(worker)
      const second = store.piecesOwnedBy(worker)[1]?.piece ?? ''

      await host.cancelQueuedMessage(worker, heldMessageId, speakingAs(pm))
      expect(stateOf(worker, second)).toBe('withdrawn')

      // ⚑ **The paired positive one fact over**: the FIRST piece is untouched by a cancel that names
      // the second one's message — the pairing is by id and never by position (`354`).
      expect(stateOf(worker, first)).toBe('answered')

      // ⚑ **A third piece**, and it is the one the ending below acts on. ⚠️ It is held, then flushed
      // by the turn ending, so it is genuinely being driven when the conversation is ended under it.
      const third = await give(pmTools, 'the third')
      expect(third.delivery, JSON.stringify(third)).toBe('held')
      const running = store.piecesOwnedBy(worker)[2]?.piece ?? ''
      await letTheTurnFinish(worker)
      await waitFor(() => stateOf(worker, running) === 'working', 'the third to be handed over')

      // ⛔ **496 · the PERSON's verb, and the swap is the ruling rather than a convenience.**
      // ⚠️ A piece that is *being driven* is a turn in flight, and every turn the Fake drives parks on
      // a person's card. ⚑ **It is the same teardown** the app's own stop makes, so what the three
      // rows below measure — an ending STALLS what is open and moves neither the answered one nor
      // the withdrawn one — is unchanged.
      if (!claimed.has(worker)) {
        host.claimSession(worker, window)
        claimed.add(worker)
      }
      await host.close(worker, window)
      // 🔴 **`379` read `abandoned` here and HO-018 §2.3 struck it out** (400). ⛔ *"Nothing about a
      // quit tells us the work failed"*, and the same is true of a conversation ending: it is
      // resumable, a reply can still land through it, and the parent is the one who decides. ⚠️ The
      // WITHDRAWN one is untouched, and that is the pair that matters — taking work back is a
      // decision somebody made about the WORK, and ending a conversation is not. ⚑ **D-016c · it
      // stalls by the turn it interrupted**, which was driving the third piece — a stop is never
      // the cause.
      expect(stateOf(worker, running)).toBe('stalled')
      expect(store.piecesOwnedBy(worker)[2]?.stalledBecause).toBe('turn_interrupted')
      expect(store.piecesOwnedBy(worker)[2]?.endedAt).toBeNull()
      expect(stateOf(worker, second)).toBe('withdrawn')
      expect(store.piecesOwnedBy(worker)[1]?.endedAt).not.toBeNull()
      // ⚑ **And the ANSWERED one is untouched by the ending too**: an ending moves only what is
      // still open.
      expect(stateOf(worker, first)).toBe('answered')
    })

    it('⚠️ a turn ending leaves the task OPEN and unstamped; the CONVERSATION stopping does not close it either', async () => {
      // 🔴 **`393` ruled the second half the other way and `400` overturned it, deliberately.**
      // ⛔ It read *"a conversation that ends AFTER its turn ended leaves the task `silent`, not
      // abandoned"* — the argument being that the work WAS delivered and its turn DID end. ⚠️ **That
      // ruling belonged to a word that no longer exists**: `silent` and `398`'s `stalled` were merged
      // by HO-018 §2, and the two had OPPOSITE answers to this one question. ⛔ One had to win, and
      // it is `398`'s: a piece left open on a conversation that has ended tells a parent to keep
      // waiting on something that can never answer, which is the *"unenumerated state counting as
      // success"* shape pointed the other way.
      const { worker } = await aPmAndItsWorker('the only thing')
      const only = store.piecesOwnedBy(worker)[0]?.piece ?? ''
      await letTheTurnFinish(worker)
      await waitFor(() => stateOf(worker, only) === 'stalled', 'the piece to stop being driven')

      // ⛔ **And a stalled piece carries NO ending**, which is the half `TASK_IS_OPEN` exists to
      // enforce: the turn ending is not the piece ending, and stamping one would be this app claiming
      // a verdict HO-018 §2 explicitly refuses.
      expect(store.piecesOwnedBy(worker)[0]?.endedAt).toBeNull()
      expect(store.piecesOwnedBy(worker)[0]?.stalledBecause).toBe('turn_ended')

      // ⚑ **D-017 — nothing ends a conversation** (`end_agent` is gone): the app's own stop, which
      // is what the parent's `end_agent` was.
      await host.close(worker, THE_APP_ITSELF)
      // ⛔ **And the conversation ending does NOT close it either** (HO-018 §2.3). ⚑ **D-016c · nor
      // does it move the CAUSE**: a stop moves no piece, so *its turn ended* stands, and the parent
      // reads the one fact it would act on.
      expect(stateOf(worker, only)).toBe('stalled')
      expect(store.piecesOwnedBy(worker)[0]?.endedAt).toBeNull()
      expect(store.piecesOwnedBy(worker)[0]?.stalledBecause).toBe('turn_ended')
    })

    it('⛔ an ending closes the task it NAMES, with two named messages in play at once', async () => {
      // 🔴 **The divergence needs TWO messages that have been held**, and the singleton means they
      // cannot be held at the same time — so they are held one after the other: the first is flushed
      // when its turn ends, and the second is queued behind the turn that flush started. ⚠️ A fold
      // that closed *"whichever piece is open"* rather than the one the ending names would then take
      // back the wrong one, and with only ONE named message in play nothing could tell the two
      // readings apart (`341`'s three survivors).
      const { pm, worker, pmTools, workerTools } = await aPmAndItsWorker('the running one')
      await cardOn(worker)
      await theWorkIsFinished(worker, workerTools)
      const first = await give(pmTools, 'held first')
      expect(first.delivery, JSON.stringify(first)).toBe('held')
      const firstMessageId = lastQueuedMessageId(worker)
      await letTheTurnFinish(worker)
      await waitFor(
        () => store.piecesOwnedBy(worker)[1]?.state === 'working',
        'the first held message to be flushed',
      )
      await cardOn(worker)
      await theWorkIsFinished(worker, workerTools, 'the held one is done')
      const second = await give(pmTools, 'held second')
      expect(second.delivery, JSON.stringify(second)).toBe('held')
      const secondMessageId = lastQueuedMessageId(worker)
      expect(secondMessageId).not.toBe(firstMessageId)

      await host.cancelQueuedMessage(worker, secondMessageId, speakingAs(pm))
      // ⛔ **The named one, and only the named one.** ⚠️ **415 · the first two read `answered`**,
      // because each was replied to before the next was given — the cancel still lands on the third
      // and on nothing else, which is what this measures.
      expect(store.piecesOwnedBy(worker).map((piece) => piece.state)).toEqual([
        'answered',
        'answered',
        'withdrawn',
      ])
    })

    it('🔴 a turn that ends while a task is WAITING leaves it waiting — the guard, over a ledger', () => {
      // ⛔ **Built by hand, because the live shape is a race and the fold is pure.** A piece queued
      // behind a running turn sees THAT turn's ending arrive before its own brief is ever sent — and
      // live, the flush follows the turn's ending within milliseconds, so a state between the two is
      // not something a test can stand still in. ⚑ `derivePieces` takes entries and nothing else, so
      // the exact ledger can simply be written down.
      const at = (ordinal: number, event: TranscriptEvent) => ({
        ordinal,
        at: 100 + ordinal,
        event,
      })
      const given: TranscriptEvent = {
        type: 'work_given',
        piece: 'work_held',
        label: 'W1.1',
        parent: 'work_root',
        givenBy: 'sess_parent',
        title: 'wait your turn',
        brief: 'wait your turn',
        messageId: 'msg_held',
      }
      const heldThroughATurn = derivePieces('sess_child', [
        at(0, { type: 'message_queued', messageId: 'msg_held', text: 'wait your turn' }),
        at(1, given),
        // ⚠️ **The turn the child was ALREADY running**, which is the one the brief is queued
        // behind. Nothing about it is this piece's.
        at(2, { type: 'turn', state: 'completed' }),
      ])
      expect(heldThroughATurn.map((piece) => piece.state)).toEqual(['waiting'])

      // ⚑ **The paired positive one event over**: once the brief has actually been handed over, the
      // NEXT turn ending does stall the work.
      const handedOver = derivePieces('sess_child', [
        at(0, { type: 'message_queued', messageId: 'msg_held', text: 'wait your turn' }),
        at(1, given),
        at(2, { type: 'turn', state: 'completed' }),
        at(3, {
          type: 'message_unqueued',
          messageId: 'msg_held',
          reason: 'sent',
          text: 'wait your turn',
        }),
        // ⚑ **F097 · the brief's own turn, as the host writes it** — the giver's words, carried. ⛔ A
        // turn with no authorship is a person's, and one a person opened leaves the work waiting on
        // them rather than stalled.
        at(4, {
          type: 'user_turn',
          text: 'wait your turn',
          attribution: 'app_authored',
          relayedFrom: 'sess_parent',
          piece: 'work_held',
          label: 'W1.1',
        }),
        at(5, { type: 'turn', state: 'completed' }),
      ])
      expect(handedOver.map((piece) => piece.state)).toEqual(['stalled'])
    })

    it('⚑ every state in the vocabulary is OPEN or CLOSED, and the answer is a table', () => {
      // ⛔ **A `Record` over the union rather than a `!==` list** — so a new state cannot be added
      // without deciding whether somebody still has to finish it.
      expect(Object.keys(TASK_IS_OPEN).sort()).toEqual([...TASK_STATES].sort())
      expect(TASK_STATES.filter((state) => TASK_IS_OPEN[state])).toEqual([
        'waiting',
        'working',
        // ⚑ **603/609 · the FOURTH, FIFTH and SIXTH open states, and each is open for `stalled`'s
        // reason and not a new one**: the work is still somebody's to finish, and the thing it is
        // waiting on is what would put it back in motion. ⛔ `HO-018` §2.1's *"a condition on an
        // open task, never a terminal state"* is the sentence they were built on — see
        // `waiting-on-an-answer-is-not-stalled.test.ts` and `three-waits-one-family.test.ts`.
        'waiting-on-an-answer',
        'waiting-on-a-person',
        'waiting-on-a-worker',
        // ⚑ **D-016 · commit 6 · open for the same reason**: a piece a person gave whose owner's
        // turn ended with it open is still its owner's to finish, and a delivery that drives it —
        // the person who asked writing again among them — puts it back in motion. A wait, never
        // `stalled`.
        'waiting-on-the-person-who-asked',
        // ⚑ **F097 · open for the same reason**: a piece a conversation gave, whose owner's turn a
        // person's words opened and ended with it open, is still its owner's to finish, and the
        // person writing again puts it back in motion.
        'waiting-on-the-person-who-wrote',
        // ⚑ **Open for the same reason**: a piece marked as waiting on purpose is still its
        // holder's to finish, once what it waits for has come.
        'waiting-on-purpose',
        // 🔴 **`400` retired `silent` into this one**, and HO-018 §2.1 took the entry explicitly:
        // *"take `TASK_IS_OPEN.stalled`."* ⛔ A piece closed on a turn ending, a Stop or a restart
        // could never be answered — `393`'s rule is that a second reply is a permanent refusal — so
        // a child that was merely between turns would lose the reply it was about to write.
        'stalled',
      ])
      // ⚠️ **Open on purpose.** A piece nobody will ever look at again because the app decided a turn
      // ending was an ending of the WORK is the *"unenumerated state counting as success"* shape
      // with a name on it.
      expect(TASK_IS_OPEN.stalled).toBe(true)
    })

    it('⛔ a closed task carries the moment it closed; an open one carries null', async () => {
      // ⚑ The assertion is about a CLOSED row carrying a stamp and an OPEN one carrying none. ⚠️ It
      // also covers both closed states — `answered` and `withdrawn` are both stamped, and `393`'s
      // reply and `354`'s cancel are two different events doing it.
      const { pm, worker, pmTools, workerTools } = await aPmAndItsWorker('the first thing')
      await cardOn(worker)
      await theWorkIsFinished(worker, workerTools)
      const held = await give(pmTools, 'the second')
      expect(held.delivery, JSON.stringify(held)).toBe('held')
      const heldMessageId = lastQueuedMessageId(worker)
      expect(store.piecesOwnedBy(worker).map((piece) => piece.endedAt === null)).toEqual([
        false,
        true,
      ])
      await host.cancelQueuedMessage(worker, heldMessageId, speakingAs(pm))
      const [first, second] = store.piecesOwnedBy(worker)
      expect(first?.endedAt).not.toBeNull()
      expect(second?.endedAt).not.toBeNull()
      // ⚑ The stamp is the ENDING's own recorded time, not the moment the fold ran.
      const ending = ledger(worker).findIndex((event) => event.type === 'message_unqueued')
      expect(second?.endedAt).toBe(store.events(worker)[ending]?.at)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · CRITERION 2 — drop the index, rebuild, identical rows
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · criterion 2 · the rows are a function of the ledger and of nothing else', () => {
    /**
     * A ledger with three pieces in three different states, so the comparison is over more than
     * one row: **both closed states and one open one** — a reply, a cancel and a turn that ended
     * with the work still open.
     */
    const aLedgerWithHistory = async (): Promise<{ worker: string }> => {
      const { pm, worker, pmTools, workerTools } = await aPmAndItsWorker('one')
      await cardOn(worker)
      await theWorkIsFinished(worker, workerTools)
      const cancelled = await give(pmTools, 'two')
      expect(cancelled.delivery, JSON.stringify(cancelled)).toBe('held')
      await host.cancelQueuedMessage(worker, lastQueuedMessageId(worker), speakingAs(pm))
      const carried = await give(pmTools, 'three')
      expect(carried.delivery, JSON.stringify(carried)).toBe('held')
      await letTheTurnFinish(worker)
      await waitFor(() => store.piecesOwnedBy(worker).length === 3, 'all three pieces')
      await waitFor(
        () => store.piecesOwnedBy(worker)[2]?.state === 'working',
        'the third piece to be handed over',
      )
      await letTheTurnFinish(worker)
      await waitFor(
        () => store.piecesOwnedBy(worker)[2]?.state === 'stalled',
        'the third piece to stop being driven',
      )
      return { worker }
    }

    it('🔴 the LEDGER ROWS ALONE reproduce every row, in a database where nothing else exists', async () => {
      // ⛔ **This is the only shape of this test that diverges.** *"Drop the index and rebuild"*
      // passes trivially when the answer is kept somewhere else — so the demonstration is the
      // stronger claim the criterion is really making: **copy the ledger and nothing else, and the
      // rows come back.** ⚑ **D-016 · and the `work` table is the somewhere else it now has**: a
      // piece's row is written beside its `work_given`, so a reader that consulted it would produce
      // nothing here.
      const { worker } = await aLedgerWithHistory()
      const expected = store.piecesOwnedBy(worker)
      expect(expected).toHaveLength(3)
      expect(expected.map((piece) => piece.state)).toEqual(['answered', 'withdrawn', 'stalled'])

      const fresh = openDatabase(join(userData, 'ledger-only.sqlite'))
      try {
        applyMigrations(fresh, migrationsFolder)
        // ⚠️ **The session row is the FOREIGN KEY and not a source**: `events.session_id` references
        // it, so a ledger cannot exist without one. It carries no profile and no identity —
        // `agent_identity`, `work` and every other table stay empty.
        fresh
          .prepare(
            `INSERT INTO provider_session (id, provider, cwd, status, created_at, updated_at)
             VALUES (?, 'claude', '/tmp/anywhere', 'idle', 1, 1)`,
          )
          .run(worker)
        const insert = fresh.prepare(
          `INSERT INTO events (id, session_id, ordinal, type, payload, created_at, generation)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        const rows = db
          .prepare(
            'SELECT id, ordinal, type, payload, created_at, generation FROM events WHERE session_id = ? ORDER BY ordinal',
          )
          .all(worker) as {
          id: string
          ordinal: number
          type: string
          payload: string
          created_at: number
          generation: number
        }[]
        for (const row of rows) {
          insert.run(
            row.id,
            worker,
            row.ordinal,
            row.type,
            row.payload,
            row.created_at,
            row.generation,
          )
        }
        // ⚑ **The control that this copy is not vacuous**: the other tables really are empty, so a
        // reader that consulted one would have nothing to consult.
        expect(fresh.prepare('SELECT count(*) AS n FROM work').get()).toEqual({ n: 0 })
        expect(fresh.prepare('SELECT count(*) AS n FROM turn').get()).toEqual({ n: 0 })

        const rebuilt = createSessionStore(fresh, tick)
        expect(rebuilt.piecesOwnedBy(worker)).toEqual(expected)
      } finally {
        fresh.close()
      }
    })

    it('⛔ …and dropping the SQL index changes nothing, which is what makes it an index', async () => {
      const { worker } = await aLedgerWithHistory()
      const expected = store.piecesOwnedBy(worker)
      db.prepare('DROP INDEX events_work_idx').run()
      // ⚠️ **The literal reading of criterion 2**, and it passes because the index is an accelerator
      // for a question the ledger answers, never the place the answer is kept.
      const withoutIt = createSessionStore(db, tick)
      expect(withoutIt.piecesOwnedBy(worker)).toEqual(expected)
    })

    it('⛔ …and so does deleting every derived row in the database', async () => {
      const { worker } = await aLedgerWithHistory()
      const expected = store.piecesOwnedBy(worker)
      // ⚑ `turn` is the app's other index over the ledger, and `derived_generation` is what a read
      // is scoped by. Both are rebuilt from the ledger by design; neither contributes a piece row.
      db.prepare('DELETE FROM turn').run()
      db.prepare('DELETE FROM derived_generation').run()
      expect(createSessionStore(db, tick).piecesOwnedBy(worker)).toEqual(expected)
    })

    it('⚠️ the fold itself is pure — the same entries in, the same rows out, twice', async () => {
      const { worker } = await aLedgerWithHistory()
      const entries = store.events(worker)
      expect(derivePieces(worker, entries)).toEqual(derivePieces(worker, entries))
      // ⛔ **And it agrees with the store's own narrow read**, which is the thing that could drift:
      // `selectPieceEvents` filters by type, so a type the fold acts on and the statement does not
      // select would read as *"that event never happened"* — silently, and only on this path.
      expect(derivePieces(worker, entries)).toEqual(store.piecesOwnedBy(worker))
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · a crash mid-piece — the one place a derivation provably cannot answer
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · a crash mid-task, and why the repair has to WRITE the ending', () => {
    /** A held piece, and the ledger exactly as a killed process leaves it. */
    const aPieceLeftWaiting = async (): Promise<{ worker: string; piece: string }> => {
      // ⚑ A ledger holding a `message_queued` with no ending, and the conversation busy for the
      // reason it always was: its turn is still parked on a card.
      const { worker, pmTools, workerTools } = await aPmAndItsWorker('the running one')
      await cardOn(worker)
      await theWorkIsFinished(worker, workerTools)
      const held = await give(pmTools, 'the held one')
      expect(held.delivery, JSON.stringify(held)).toBe('held')
      const piece = store.piecesOwnedBy(worker)[1]?.piece ?? ''
      expect(stateOf(worker, piece)).toBe('waiting')
      return { worker, piece }
    }

    it('🔴 the two ledgers are BYTE-IDENTICAL, which is why the fold must not guess', async () => {
      // ⛔ **This is the argument, measured rather than asserted.** A ledger holding
      // `message_queued` with no ending looks the same whether the app is alive and holding the
      // message or died holding it — so no function over the ledger alone can tell them apart, and
      // *"still running"* is one of the wrong answers §1 of the brief names.
      const { worker } = await aPieceLeftWaiting()
      const bytes = db
        .prepare('SELECT payload FROM events WHERE session_id = ? ORDER BY ordinal')
        .all(worker)
      expect(JSON.stringify(bytes)).toContain('message_queued')
      expect(JSON.stringify(bytes)).not.toContain('message_unqueued')
      // ⚑ The fold says `waiting`, truthfully, in BOTH worlds — and that is the correct answer for
      // exactly as long as nobody has told it which world it is in.
      expect(store.piecesOwnedBy(worker)[1]?.state).toBe('waiting')
    })

    it('⛔ the NEXT LAUNCH writes the message’s ending, and the TASK stays open', async () => {
      const { worker, piece } = await aPieceLeftWaiting()

      // 🔴 **Over a SECOND store object, and that is what makes the repair see this session.**
      // `live-hosts.ts` identifies a ledger by OBJECT — *"two `SessionStore`s opened over ONE
      // database file are two ledgers as far as this directory is concerned"* — so a host built on
      // the same store would find this session in `workRunningElsewhere` and skip it. That is an
      // exclusion, not a crash: after a real one nothing is alive.
      const next = buildHost(createSessionStore(db, tick))
      try {
        const ending = ledger(worker).filter((event) => event.type === 'message_unqueued')
        expect(ending).toHaveLength(1)
        expect(ending[0]).toMatchObject({
          reason: 'abandoned',
          detail: 'the app stopped while this message was still waiting to be sent',
        })
        // ⚠️ **Scoped to the field that carries it**: `text` is in this payload too, and an
        // assertion over the whole event could be satisfied by a neighbouring string.
        expect(ending[0]?.type === 'message_unqueued' ? ending[0].messageId : null).toBe(
          store.piecesOwnedBy(worker)[1]?.messageId,
        )
        // 🔴 **`379` asserted `abandoned` here and HO-018 §2.3 struck it out**: *"nothing about a
        // quit tells us the work failed."* ⛔ The MESSAGE really was abandoned — the assertion above
        // is unchanged and names the same row — and the PIECE is a different subject: the app went
        // away before this work was ever handed over, the parent can send it again, and closing it
        // would refuse a reply nobody has yet had the chance to write.
        expect(stateOf(worker, piece)).toBe('stalled')
        // ⚑ **Its own cause, not the launch sweep's.** The message never went, so *send it again* is
        // the move — which is a different decision from *the app restarted while it was running*.
        expect(store.piecesOwnedBy(worker)[1]?.stalledBecause).toBe('message_never_sent')
        expect(store.piecesOwnedBy(worker)[1]?.endedAt).toBeNull()
      } finally {
        await next.closeAll()
      }
    })

    it('⚑ …and a launch that finds the message STILL HELD by a live host leaves it alone', async () => {
      // ⛔ **The paired negative, one fact over.** The repair is only correct because nothing is
      // running; a second host over the SAME store finds the session held elsewhere and must not
      // write an ending for a message that is about to be sent.
      const { worker, piece } = await aPieceLeftWaiting()
      const alongside = buildHost()
      try {
        expect(ledger(worker).filter((event) => event.type === 'message_unqueued')).toEqual([])
        expect(stateOf(worker, piece)).toBe('waiting')
      } finally {
        await alongside.closeAll()
      }
    })

    it('⚠️ a message queued before ids existed is left exactly as it is', async () => {
      // ⛔ **`354`'s rule, in the repair.** A `message_queued` with no `messageId` cannot be paired
      // with an ending, and writing one would join two messages that are not the same message.
      const { worker } = await aPmAndItsWorker('the work')
      const ordinal = store.nextOrdinal(worker)
      store.append(worker, ordinal, { type: 'message_queued', text: 'from an older build' }, tick())
      const next = buildHost(createSessionStore(db, tick))
      try {
        expect(ledger(worker).filter((event) => event.type === 'message_unqueued')).toEqual([])
      } finally {
        await next.closeAll()
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the number a person quotes — one counter under the parent, and never renumbered
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · numbering is one counter under the parent, since D-016', () => {
    // ⚑ **D-016 commit 3 · the number is per PARENT now** (`work_sequence(parent)`, R4): the label
    // is the parent's and this number, `W1.2`. ⛔ So *a project nobody has given work to starts at
    // 1, and one that does not exist THROWS* and *a task is numbered in `default`* went with the
    // project the number was scoped by; what the counter IS survives, and is measured below.

    it('⛔ the number is ALLOCATED, so a withdrawn task leaves a gap nothing reuses', async () => {
      // ⚑ **The roadmap's rule** — *"gaps are never renumbered"* — and the reason the number is
      // minted rather than derived from position. A number computed by COUNTING rows would give this
      // third piece the number 2, and the label would stop naming the same work.
      const { pm, worker, pmTools, workerTools } = await aPmAndItsWorker('one')
      await cardOn(worker)
      await theWorkIsFinished(worker, workerTools)
      const held = await give(pmTools, 'two')
      expect(held.delivery, JSON.stringify(held)).toBe('held')
      await host.cancelQueuedMessage(worker, lastQueuedMessageId(worker), speakingAs(pm))
      await give(pmTools, 'three')

      const under = store.rootOf(pm)
      if (under === null) throw new Error('the PM has no root')
      expect(store.piecesOwnedBy(worker).map((piece) => [piece.label, piece.state])).toEqual([
        [`${under.label}.1`, 'answered'],
        [`${under.label}.2`, 'withdrawn'],
        [`${under.label}.3`, 'waiting'],
      ])
      // ⚠️ **This CONSUMES 4** (383): the allocator is not a peek, so the assertion is the last
      // thing this test does with the counter.
      expect(store.numberUnder(under.piece)).toBe(4)
    })

    it('🔴 a COUNTER, not the ledger’s maximum — so a rebuilt generation cannot move the number', async () => {
      // ⛔ **`379` read `max(json_extract(payload, '$.number'))` here and `383` replaced it**, and
      // the replacement is not a tidying: a give that took a number and then failed to send leaves
      // NO row for a maximum to see (D-016 · R4 — the number is burned).
      //
      // ⚑ **A REBUILD** (`065`) builds a generation beside the live one, replaying every event
      // verbatim, so the same give exists twice. A number derived from the ledger has to decide
      // what to do about that; a counter never looks.
      //
      // ⚠️ **And the counter is not scoped to a generation either.** A number handed out under a
      // projection that was later superseded was still handed out and still quoted — the same
      // argument `derived_generation.highest` makes one table over.
      const { pm, worker } = await aPmAndItsWorker('one')
      const under = store.rootOf(pm)
      if (under === null) throw new Error('the PM has no root')
      expect(nextNumberWithoutTakingIt(under.piece)).toBe(2)

      const row = db
        .prepare(
          "SELECT ordinal, payload, created_at FROM events WHERE session_id = ? AND type = 'work_given'",
        )
        .get(worker) as { ordinal: number; payload: string; created_at: number }
      db.prepare(
        `INSERT INTO events (id, session_id, ordinal, type, payload, created_at, generation)
         VALUES ('evt_rebuilt', ?, ?, 'work_given', ?, ?, 1)`,
      ).run(worker, row.ordinal, row.payload, row.created_at)

      // ⛔ **Two rows for one piece now**, which is exactly what a half-built projection leaves on
      // disk — and the next number is unchanged.
      expect(
        db.prepare("SELECT count(*) AS n FROM events WHERE type = 'work_given'").get(),
      ).toEqual({ n: 2 })
      expect(store.numberUnder(under.piece)).toBe(2)
    })

    it('🔴 the allocator CONSUMES, so two callers never get one number', async () => {
      // ⛔ **The property that replaced `379`'s.** `nextTaskNumber` reserved nothing, so the host had
      // to be written so that no `await` sat between the read and the append — a guarantee held by a
      // comment. ⚑ The counter holds it instead: the number is gone the moment it is handed over,
      // whether or not the caller ever writes a row with it.
      const under = store.rootOf(await personOpens('pm'))
      if (under === null) throw new Error('the conversation has no root')
      expect(store.numberUnder(under.piece)).toBe(1)
      expect(store.numberUnder(under.piece)).toBe(2)
      expect(store.numberUnder(under.piece)).toBe(3)
      // ⚠️ **And the three numbers are gone even though nothing was ever given** — no ledger holds
      // a piece, and no piece hangs under the root.
      expect(
        db.prepare("SELECT count(*) AS n FROM events WHERE type = 'work_given'").get(),
      ).toEqual({ n: 0 })
      expect(store.childrenOf(under.piece)).toEqual([])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · a restart mid-piece — 373 made the parent survive one; the piece must too
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · a restart mid-task', () => {
    it('🔴 a task whose turn had ended survives a restart identically, field for field', async () => {
      const { worker } = await aPmAndItsWorker('the work')
      await letTheTurnFinish(worker)
      await waitFor(
        () => store.piecesOwnedBy(worker)[0]?.state === 'stalled',
        'the piece to reach a state a shutdown does not move',
      )
      const before = store.piecesOwnedBy(worker)

      await host.closeAll()

      // ⛔ **Identical, field for field** — `373`'s restart, and the reason the id and the label are
      // in the ledger rather than on the slot. ⚠️ **The STATE does not move** (400): a conversation
      // ending is a condition on open work, not an ending of it. ⚑ **D-016c · and neither does the
      // CAUSE or its moment**: a stop moves no piece, so between the quit and the resume the row is
      // the one the turn left.
      const whileEnded = store.piecesOwnedBy(worker)
      expect(whileEnded).toEqual(before)
      expect(before[0]?.stalledBecause).toBe('turn_ended')

      host = buildHost()
      await host.resumeSession(worker, secondWindow)

      // 🔴 **And the resume moves nothing either.** ⛔ `646` F1 measured a parent reading *the
      // conversation it was given to has ended* about a conversation it could message. ⚑ **The
      // strongest form this row admits**: every durable field what it was before the quit.
      const after = store.piecesOwnedBy(worker)
      expect(after).toEqual(before)
    })

    it('🔴 a task that was RUNNING when the app quit comes back OPEN — the finding, repaired', async () => {
      // 🔴 **`379` filed this as a FINDING against criterion 14 and `400` is the repair.** ⛔ It read
      // *"a task that was RUNNING when the app quit comes back `abandoned`"*, and said so as an
      // observation rather than as a defect: `closeAll` ends the conversation, the ledger records
      // `status: ended`, and the fold closed the task. ⚠️ **HO-018 §2.3 ruled that wrong** — *"I
      // meant the app being killed while work is in progress… nothing about a quit tells us the work
      // failed"* — so the state moves to a CONDITION on an open piece and the parent decides.
      //
      // ⚑ **Nothing evaporates and nothing is invented**: the state still moved because an event
      // landed, which is criterion 1's own rule. Only what that event MEANS changed.
      const { worker } = await aPmAndItsWorker('the work')
      const before = store.piecesOwnedBy(worker)
      expect(before[0]?.state).toBe('working')

      await host.closeAll()
      // ⚑ **Every durable field is unchanged** — the row is the same row, and only the derived state
      // differs.
      const after = store.piecesOwnedBy(worker)
      expect(after[0]).toMatchObject({
        piece: before[0]?.piece,
        label: before[0]?.label,
        parent: before[0]?.parent,
        giver: before[0]?.giver,
        title: before[0]?.title,
        brief: before[0]?.brief,
        messageId: null,
        state: 'stalled',
        // ⚑ **D-016c · the TURN's cause**: the piece was RUNNING when the app quit, so the turn
        // `closeAll` force-ended stalled it `turn_interrupted`, and the stop itself is never a cause.
        stalledBecause: 'turn_interrupted',
        endedAt: null,
      })

      host = buildHost()
      await host.resumeSession(worker, secondWindow)
      // ⚠️ **The STATE does not move, and since D-016c neither does the CAUSE**: a start moves no
      // piece. 🔴 **Nothing re-arms and nothing re-opens** — which is what this test is about, and it
      // is asserted field by field.
      const back = store.piecesOwnedBy(worker)
      expect(back).toEqual(after)
    })

    it('⛔ …and a stop HANDS ON the held message — its next start sends it once, and mints no second task', async () => {
      // ⚑ **077's ruling, said about the PIECE** (the brief's §4): a piece surviving a stop and a
      // message being sent again are different things. ⚑ **D-017 · R3 turned the MESSAGE half
      // round** — a stop now ends nothing, and what the stopped conversation held is handed, in order
      // and with its authorship, to its next start — which a stop other than a quit makes at once.
      // ⛔ **What is unchanged is the PIECE**: the one row the brief opened is the one it is sent
      // with, and no second one is minted.
      const { worker, pmTools, workerTools } = await aPmAndItsWorker('the running one')
      await cardOn(worker)
      await theWorkIsFinished(worker, workerTools)
      // ⛔ **496 · the card is answered and the child is made busy another way**, so the brief this
      // test is about is HELD: the hold reads `status() !== 'idle'`, which `working` satisfies.
      await letTheTurnFinish(worker)
      await busyWithNoCard()
      const held = await give(pmTools, 'the held one')
      expect(held.delivery, JSON.stringify(held)).toBe('held')
      const heldMessageId = lastQueuedMessageId(worker)
      const queuedRows = (): number =>
        ledger(worker).filter((event) => event.type === 'message_queued').length
      const queuedBefore = queuedRows()
      // ⚑ **D-017 — nothing ends a conversation** (`end_agent` is gone): the app's own stop.
      await host.close(worker, THE_APP_ITSELF)

      // ⚑ **R3 — handed on, never abandoned**: the stop started it again, and the held brief is the
      // one its start sends, under the piece it opened.
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'user_turn' && event.text.includes('the held one'),
          ),
        'the held brief to be sent at the next start',
      )
      expect(host.sessionIds).toContain(worker)
      expect(
        ledger(worker).some(
          (event) =>
            event.type === 'message_unqueued' &&
            event.messageId === heldMessageId &&
            event.reason === 'abandoned',
        ),
      ).toBe(false)
      const piece = store.piecesOwnedBy(worker)[1]
      expect(piece?.messageId).toBe(heldMessageId)
      // ⛔ **No new `message_queued` and no new piece.** The row is the same instruction, sent once.
      expect(queuedRows()).toBe(queuedBefore)
      expect(store.piecesOwnedBy(worker)).toHaveLength(2)
      expect(
        ledger(worker).filter(
          (event) => event.type === 'user_turn' && event.text.includes('the held one'),
        ),
      ).toHaveLength(1)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · a PERSON — a message, minting nothing
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · a person’s message is not a task', () => {
    it('🔴 an agent’s give mints one, and a person’s message mints nothing', async () => {
      // ⚑ **The give mints one** — the positive half, so the negative below is about what a MESSAGE
      // is rather than about nothing minting at all.
      const { worker } = await aPmAndItsWorker('from the agent')
      expect(store.piecesOwnedBy(worker)).toHaveLength(1)

      // ⛔ **A person's own conversation.** `queueMessage` is the door a person's composer reaches.
      const mine = await personOpens('somebody')
      await host.queueMessage(mine, 'a person typing in the composer', window)
      expect(store.piecesOwnedBy(mine)).toEqual([])
      expect(typesIn(mine)).not.toContain('work_given')
    })

    // ⚑ **D-016 · *…decided by the ABSENCE of an agent identity, not by a flag on the sink* is
    // gone.** It measured `queueMessage` minting a task for an AGENT caller that declared `work`;
    // `message_agent`'s `work` kind went, and `queueMessage` mints for nobody — `giving` is
    // unspellable at that door (§7 says so from the source), so a message never mints: a give does,
    // and since D-016 · commit 6 so does work a conversation takes on (`take_on_work`).
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · the censuses — what the shape claims, held to the source
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · censuses', () => {
    const sourceOf = (root_: string, file: string): string =>
      readFileSync(join(root_, file), 'utf8')

    it('🔴 the derivation can reach nothing but the ledger — criterion 2 as an import list', () => {
      // ⛔ **This is criterion 2 stated as a property of the file rather than of a test.** A fold
      // that could open a database, read a clock or touch a disk would be free to put something in a
      // row that a rebuild could not reproduce.
      const source = sourceOf(sharedRoot, 'tasks.ts')
      const imports = [...source.matchAll(/^import\s[\s\S]*?from\s+'([^']+)'/gm)].map(
        (match) => match[1],
      )
      // 🔴 **467 · a SECOND edge, and the claim is corrected rather than retired.** `openWorkOf`
      // lives here because {@link TASK_IS_OPEN} does, and it names its answer in `WorkInHand` — a
      // shape declared one module over. ⛔ What criterion 2 asks is not *how many* imports this file
      // has: it is that none of them can hand the fold a database, a clock or a disk.
      // 🔴 **484 · a THIRD edge** — `how-work-stopped.ts` owns the actor vocabulary a stall names.
      // ⚑ **F033 · a FOURTH edge, types only** — `piece-called.ts`'s `WorkThatNamesIt`, the name
      // `theWorkThatNamesItAmong` answers, beside the ended-last choice it shares with
      // `whereTheWorkItHoldsStands`. ⛔ `import type`, and that module imports nothing.
      // ⚑ **F097 · a FIFTH edge, and the second that takes a VALUE** — `aPersonsOwnWords`, the one
      // reading of whose words a turn carries, which the host shares. ⛔ Its module reaches a ledger
      // TYPE and nothing else (below).
      // ⚑ **W4.189 · a SIXTH edge, types only** — `work-folders.ts`'s `GivenFolder`, the folder a
      // give recorded, copied onto its row. ⛔ `import type`, and that module imports nothing.
      // ⚑ **A SEVENTH edge, types only** — `model-choice.ts`'s `ModelAndEffort`, the pair a give
      // asked for, copied onto its row. ⛔ `import type`.
      expect(imports).toEqual([
        './how-work-stopped',
        './runtime-ipc',
        './a-persons-own-words',
        './questions',
        './piece-called',
        './work-folders',
        './model-choice',
      ])
      // 🔴 **494 · the first edge that takes a VALUE** — `whoCancelledIt`, the derivation that reads
      // a cancel's actor once for the three readers that fold one. ⚠️ Which is why the property
      // below is asserted TRANSITIVELY rather than by *every line is `import type`*.
      const lines = [...source.matchAll(/^import\s[\s\S]*?from\s+'[^']+'/gm)].map(
        (match) => match[0],
      )
      expect(lines).toHaveLength(7)
      const values = lines.filter((line) => !line.startsWith('import type '))
      expect(values).toHaveLength(2)
      expect(values[0]).toContain('./how-work-stopped')
      expect(values[0]).toContain('whoCancelledIt')
      expect(values[1]).toContain('./a-persons-own-words')
      expect(values[1]).toContain('aPersonsOwnWords')
      // ⛔ **F097 · and the second reaches a ledger type and nothing else**.
      expect(
        [
          ...sourceOf(sharedRoot, 'a-persons-own-words.ts').matchAll(
            /^import\s[\s\S]*?from\s+'[^']+'/gm,
          ),
        ].map((m) => m[0]),
      ).toEqual(["import type { UserTurnEvent } from './runtime-ipc'"])
      // ⛔ **And the one module it can hold a value from reaches a ledger type and a vocabulary and
      // nothing else.**
      const reached = sourceOf(sharedRoot, 'how-work-stopped.ts')
      expect([...reached.matchAll(/^import\s[\s\S]*?from\s+'([^']+)'/gm)].map((m) => m[1])).toEqual(
        ['./runtime-ipc', './who-did-it'],
      )
      expect([...sourceOf(sharedRoot, 'who-did-it.ts').matchAll(/^import\s/gm)]).toHaveLength(0)
      // ⚑ **The control that plants one of each** (standing rule 12): the same matcher over a value
      // import and a type import, so a pattern that could not see the difference fails here.
      expect(
        "import { TASK_IS_OPEN } from './tasks'".startsWith('import type '),
        'the matcher cannot tell a value import from a type import',
      ).toBe(false)
      expect(source).toMatch(
        /^import \{ whoCancelledIt, type AskToStop \} from '\.\/how-work-stopped'$/m,
      )
      // ⚑ **D-016 · a second TYPE on the same edge** — `TranscriptEvent`, which `PIECE_EVENT_TYPES`
      // is checked against. (`661`'s `LastToldAboutWork` went with `aNoticeIsOwed`, D-016c.)
      // ⛔ Still `import type`, so the property above is untouched: it can hand the fold nothing.
      expect(source).toMatch(
        /^import type \{ PersistedEventInfo, TranscriptEvent \} from '\.\/runtime-ipc'$/m,
      )
      expect(source).toMatch(/^import type \{ WorkInHand \} from '\.\/questions'$/m)
      expect(source).toMatch(
        /^import type \{ HowAPieceEnded, WorkThatNamesIt \} from '\.\/piece-called'$/m,
      )
      expect([...sourceOf(sharedRoot, 'piece-called.ts').matchAll(/^import\s/gm)]).toHaveLength(0)
    })

    it('⚠️ the comment strip these censuses run on actually removes both spellings', () => {
      // ⛔ **A control that plants TWO** (standing rule 12), on the instrument rather than on the
      // subject: a strip that handled only `//` would let a docblock's `{@link …}` be counted as a
      // call site, which is exactly how the census below once read three where there is one.
      const planted = [
        '/** numberUnder(planted) in a block comment */',
        'const real = numberUnder(kept)',
        '// numberUnder(planted) in a line comment',
      ].join('\n')
      expect(codeOnly(planted).split('numberUnder')).toHaveLength(2)
      expect(codeOnly(planted)).toContain('const real =')
    })

    it('⛔ the store’s narrow read selects every type the fold acts on', () => {
      // ⚠️ **The pair that can drift, censused against each other.** `derivePieces` passes over every
      // type it does not name; `selectPieceEvents` never fetches one it does not list. A type added
      // to the fold and not to the statement reads as *"that event never happened"* — silently, and
      // only on the replayed path, which is the path every restart takes.
      const fold = sourceOf(sharedRoot, 'tasks.ts')
      const acted = new Set(
        [...fold.matchAll(/event\.type === '([a-z_]+)'/g)].map((match) => match[1]),
      )
      expect([...acted].sort()).toEqual([
        // 🔴 **D-013's additions — the background levels.** ⛔ Neither changes a state by itself: a
        // drive that ends over waking background work holds its work `working`, and the level
        // emptying lets that stall go. Folded but not selected, a replayed row would stall.
        'background_work',
        // 🔴 **D-005a's addition (F019's fix check) — a message waiting in the holder's own queue.**
        // ⛔ It changes no state by itself: it holds a turn's stall while it waits.
        'message_queued',
        'message_unqueued',
        // 🔴 **`673`'s addition — the host's own reopen.** ⚑ Since D-016c it moves no piece: it only
        // resets the drive, since a killed app writes no terminal status.
        'reopened',
        // 🔴 **D-017 · R10's addition — the row that says a new conversation took this one's place.**
        'replaced_by',
        // 🔴 **`724`'s addition (R84) — the holder's own record that an answer reached nobody.**
        'reply_undelivered',
        // 🔴 **`400`'s harder additions**: neither of these changes a state. ⚠️ **Leaving out
        // `request_routed` specifically would make `questionLostAtRestart` permanently FALSE on the
        // replayed path**, which is every path a restart takes and the only path the flag exists on.
        'request_routed',
        'request_stranded',
        'scheduled_work',
        'status',
        'turn',
        // 🔴 **`494`'s addition, and it is the SECOND producer of an actor** — a permission
        // answered `cancel`. ⛔ Folded but not selected, a piece a person cancelled would derive
        // `stalledBy: null` after a restart while a live host named them.
        'user_decision',
        // 🔴 **491's boundary, which changes no piece state.**
        'user_turn',
        // 🔴 **D-016 · a close by the piece's giver** (commit 5). ⛔ Folded but not selected, a piece
        // its giver closed would derive OPEN after a restart.
        'work_closed',
        // 🔴 **D-016 · the opener** — `task_assigned`'s place. ⛔ Folded but not selected, no piece
        // would exist on the replayed path at all.
        'work_given',
        // 🔴 **`484`'s addition, and it is the first that changes no state at all.**
        'work_interrupted',
        // 🔴 **D-016 · a new brief from the piece's giver** (commit 5) — it changes no state. ⚠️
        // Folded but not selected, a replayed row would read the give's brief and not the newest.
        'work_rebriefed',
        // 🔴 **D-016 · `task_replied`'s place** (`393`). A `work_replied` folded but not selected
        // would derive every answered piece as open on the replayed path.
        'work_replied',
        // 🔴 **`400`'s other addition.** ⛔ A `work_restarted` folded but not selected would leave
        // every piece a restart stranded reading `working` on the replayed path.
        'work_restarted',
        // 🔴 **D-016 · a piece's title and status line** — neither changes a state. ⚠️ Folded but not
        // selected, a replayed row would read the give's title and no status line.
        'work_retitled',
        'work_status_set',
        // 🔴 **D-016 · `task_withdrawn`'s place** (`429`). ⛔ Folded but not selected, a piece its
        // giver took back would derive OPEN after a restart.
        'work_taken_back',
      ])
      // ⛔ **Scoped to the statement BY NAME, and `394` is why** (found by the dispatch that added
      // a second one). ⚑ *A file-level match cannot tell sibling declarations apart*.
      const statement = sourceOf(join(mainRoot, 'db'), 'session-store.ts')
      const opens = statement.indexOf('const selectPieceEvents = db.prepare(')
      expect(opens, 'selectPieceEvents was renamed or removed').toBeGreaterThan(0)
      const listed =
        statement
          .slice(opens, statement.indexOf('  )', opens))
          .match(/AND type IN \(([^)]+)\)/)?.[1] ?? ''
      for (const type of acted) {
        expect(listed, `\`${type}\` is folded but not selected`).toContain(`'${type}'`)
      }
    })

    it('⛔ every verb an agent can reach is enumerated, and only the give and work taken on mint', () => {
      // ⚑ **The search shape for *"every piece an agent can give is minted"*** (`364`'s rule). It is
      // not a grep for `send`: the claim is about the whole published surface, so the enumeration is
      // `AgentToolHost` itself — the methods `agentToolsFor` is given and the only host it has.
      //
      // ⚑ **D-016 · the GIVE is the one door that hands a piece to another conversation.**
      // `spawnSession` and `message_agent`'s `work` kind went, and `giveWork` both starts a
      // conversation and gives it a piece. ⚑ **D-016 · commit 6 — and `takeOnWork`**, which opens
      // a piece under the caller's own root and hands it to nobody: it sends nothing, so no
      // `giving` reaches the queue from it. ⛔ Every other member mints nothing, and the assertions
      // below say so from the source rather than from this list.
      const surface: Record<keyof AgentToolHost, true> = {
        themes: true,
        // 🔴 **D-016 · the mint that hands a piece over** — the one door that gives work: its rails
        // decide what a piece is and whose, and it alone hands `queueAs` a `giving`.
        giveWork: true,
        // 🔴 **D-016 · commit 6 · the other mint** — a piece the caller takes on for a person, under
        // its own root and in its own ledger. ⛔ It hands the queue nothing: the piece is the
        // caller's own, and nobody is sent a word of it.
        takeOnWork: true,
        // ⚑ **D-016 · a WRITER of a piece's title, status line, brief and files** — and, for its
        // giver, a new brief or a close told to the piece's owner. ⛔ It mints nothing: the piece it
        // names already exists, and its new brief is a `rebriefing`, never a `giving`.
        updateWork: true,
        // ⚑ **D-016 · a READER** — what one piece is to the caller.
        whatAPieceIsTo: true,
        // ⚑ **D-016 · `readDocument`'s place, a READER** — a resource's bytes OUT to the caller.
        readResource: true,
        // ⚑ It puts words into another conversation, and mints nothing: `giving` is unspellable here.
        queueMessage: true,
        // ⚑ The same words, held and then asking the turn in the way to stop; its facts are
        // `queueMessage`'s own, so it mints nothing either.
        messageAgentNow: true,
        agentsVisibleTo: true,
        // ⚑ **READERS**: the archived conversations within reach, and when one was archived.
        archivedVisibleTo: true,
        whenItWasArchived: true,
        // ⚑ `restore_agent`'s door: it brings a conversation back to the lists and mints no task.
        restoreAsAnAgent: true,
        // `request_mcp_server`'s door: a request in the caller's own ledger; it mints no task.
        requestMcpServer: true,
        agentCard: true,
        // ⚑ **A READER**: what opened a conversation's last turn that ended.
        whatOpenedItsLastTurn: true,
        // ⚑ **D-017 · R12 — a READER**: why this caller may not reach a conversation.
        whyItIsOutOfReach: true,
        // ⚑ **D-016 · commit 7 · R1 — a READER**: the conversation an agent address names, a label
        // or an id; it writes nothing and mints nothing.
        theConversationAddressed: true,
        // ⚑ **D-017 · R10 — a READER**: the conversation that took an id's place, or none.
        tookItsPlace: true,
        // ⚑ **A READER**: why what is held for a conversation waits for its reopen on the current
        // Claude sign-in — words for a held delivery's answer; it writes nothing and mints nothing.
        whyWhatIsHeldWaits: true,
        // ⚑ **A READER**: the pieces whose answer is held for the caller, not yet in a turn of its;
        // it writes nothing and mints nothing.
        answersHeldFor: true,
        // 🔴 **488 · a READER** — every identity this app holds.
        profilesVisibleTo: true,
        // ⚑ **F009 · a READER** — what one agent has done; it writes nothing and mints nothing.
        agentRecord: true,
        // 🔴 **393 · a reply carries text into the conversation that gave the work** — and reaches
        // it as `THE_APP_ITSELF`, which mints nothing.
        replyToParent: true,
        maySaveMemory: true,
        // ⚑ **D-016 · `tasksVisibleTo`'s place, two READERS** — the caller's own pieces.
        pieceBoard: true,
        pieceRecord: true,
        // ⚑ **D-024 · R3 · a READER** — `list_tasks` with `made`: the files the caller's profile
        // made, by id. ⛔ It mints nothing and hands nothing over; it takes the caller's own id.
        madeByItsProfile: true,
        // ⚑ **D-037 · a READER** — `find_files`: kept files on the caller's tree or everywhere, by
        // id. ⛔ It mints nothing and hands nothing over; it takes the caller's own id and its words.
        findKeptFiles: true,
        searchWork: true,
        searchPastWork: true,
        // ⚑ **724 · a reader** — a NAME for a conversation.
        whatToCallTheConversation: true,
        // ⚑ **D-016 · commit 7 · R3 — two readers** — a conversation named by the piece it owns, and
        // the label (or id) a reader passes back for it.
        nameByItsWork: true,
        // ⚑ **F033 · two readers** — a conversation named by its own piece on one piece's chain,
        // and the label a reader passes back for it there.
        nameByItsWorkUnder: true,
        addressOf: true,
        addressOfUnder: true,
        // 🔴 **D-016 · `withdrawTask`'s place** (429) — it CLOSES a piece and tells its owner; it
        // mints nothing.
        takeBackPiece: true,
        // 🔴 **703 · it takes back notices the app still holds for the caller itself.**
        takeBackWhatItsQuestionMadeFalse: true,
        // 🔴 **394 · an answer into a conversation blocked on one** — to the provider, not the queue.
        answerQuestion: true,
        // 🔴 **395 · it takes work AWAY**; the only words it can put anywhere are its own refusal.
        interruptAgent: true,
        // ⚑ **396 · a READER** (676 · the counted read).
        questionsListedFor: true,
        // 🔴 **405 · a WRITER into the caller's own ledger** — a refusal it already answered.
        noteRefusal: true,
        // 🔴 **419 · it mints an IDENTITY and never a piece.**
        createAgentFor: true,
        // ⚑ **D-042 · R4 · a QUESTION, not an act** — is the default `create_agent` names one the
        // seam admits (`model-rails.ts`). ⛔ It mints nothing and reaches no conversation: it reads
        // the provider's list and answers, and `createAgentFor` writes the default it answered, on
        // the call that minted the identity.
        judgeTheDefaultItNames: true,
        // 🔴 **486 · two QUESTIONS rather than acts** — may this caller do this kind of thing at all.
        mayCreateAgents: true,
        mayReachAtAll: true,
        // 🔴 **437 · a question into the conversation that gave this caller work** — as
        // `THE_APP_ITSELF`, which mints nothing.
        raiseAQuestion: true,
        // A to-do for a person, as a question routed to them: it mints nothing and gives no piece.
        requestAnAction: true,
        // ⚑ **611 · it puts WORDS into another conversation and mints NOTHING** (HO-088 §3.2).
        passQuestionUp: true,
        // ⚑ **D-009 · the asker's own withdrawal**, into its own ledger.
        withdrawQuestion: true,
        // ⚑ **D-012 · a READER** — a conversation's words OUT to the caller.
        readTranscript: true,
        // 🔴 **582 · it reaches no conversation and mints no piece** (`HO-009` §2.2).
        proposeAgentRules: true,
        readAgentRules: true,
        // ⚑ Readers that turn an id into the link a tool result carries; they mint nothing.
        navigationIdentity: true,
        navigationProfileForConversation: true,
      }
      expect(Object.keys(surface).sort()).toEqual([
        'addressOf',
        'addressOfUnder',
        'agentCard',
        'agentRecord',
        'agentsVisibleTo',
        'answerQuestion',
        'answersHeldFor',
        'archivedVisibleTo',
        'createAgentFor',
        'findKeptFiles',
        'giveWork',
        'interruptAgent',
        'judgeTheDefaultItNames',
        'madeByItsProfile',
        'mayCreateAgents',
        'mayReachAtAll',
        'maySaveMemory',
        'messageAgentNow',
        'nameByItsWork',
        'nameByItsWorkUnder',
        'navigationIdentity',
        'navigationProfileForConversation',
        'noteRefusal',
        'passQuestionUp',
        'pieceBoard',
        'pieceRecord',
        'profilesVisibleTo',
        'proposeAgentRules',
        'questionsListedFor',
        'queueMessage',
        'raiseAQuestion',
        'readAgentRules',
        'readResource',
        'readTranscript',
        'replyToParent',
        'requestAnAction',
        'requestMcpServer',
        'restoreAsAnAgent',
        'searchPastWork',
        'searchWork',
        'takeBackPiece',
        'takeBackWhatItsQuestionMadeFalse',
        'takeOnWork',
        'theConversationAddressed',
        'themes',
        'tookItsPlace',
        'updateWork',
        'whatAPieceIsTo',
        'whatOpenedItsLastTurn',
        'whatToCallTheConversation',
        'whenItWasArchived',
        'whyItIsOutOfReach',
        'whyWhatIsHeldWaits',
        'withdrawQuestion',
      ])
      const tools = sourceOf(join(mainRoot, 'runtime'), 'agent-tools.ts')
      const flat = tools.replace(/\s+/g, ' ')
      // ⛔ **415 · the CALLER is still the third argument.** ⚑ What it is for is that the agent door
      // passes the AGENT and never the app, and that is the prefix — whitespace-flattened, because
      // `prettier` owns where the call wraps.
      expect(flat).toMatch(/host\.queueMessage\(\s*agent, text, by,/)
      // ⚑ **D-016 · the give hands its arguments to the host VERBATIM**, with the caller.
      expect(tools).toMatch(/host\.giveWork\(args, by\)/)
      // ⚑ **D-017 · R12 — the message door asks the reach through `whyItIsOutOfReach`.**
      expect(tools).toMatch(/host\.whyItIsOutOfReach\(agent, by, me\)/)
      expect(tools).not.toMatch(/host\.send\(/)
      expect(tools).not.toMatch(/host\.sendInterrupting\(/)
      // ⚑ **The readers read and do not write**, said as positive controls rather than as more
      // absences: one takes a resource id and no text, the others take nothing but the caller's own
      // id.
      expect(tools).toMatch(/host\.readResource\(/)
      expect(tools).toMatch(/host\.pieceBoard\(me\)/)
      expect(tools).toMatch(/host\.questionsListedFor\(me\)/)
      // ⚑ **D-024 · R3** — and the made list, which takes the caller's own id and nothing else.
      expect(tools).toMatch(/host\.madeByItsProfile\(me\)/)
      // ⚑ **D-037** — and the finder, which takes the caller's own id first and asks nothing else of it.
      expect(tools).toMatch(/host\.findKeptFiles\(me, \{/)
      const host_ = sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts')
      // 🔴 **D-016 · the mint, from the source**: `queueMessage`'s facts make `giving` unspellable,
      // and the ONE place a `giving` is handed to the queue is the give's own delivery. ⚑ **D-016,
      // commit 5** — the rail is spelled once, as `FactsAQueueCarries`, and it takes a new brief
      // (`rebriefing`, `update_work`'s alone) out beside the give.
      expect(codeOnly(host_).split('{ giving }')).toHaveLength(2)
      expect(host_).toContain(
        [
          "type FactsAQueueCarries = Omit<TurnFacts, 'giving' | 'rebriefing'> & {",
          '  readonly giving?: never',
          '  readonly rebriefing?: never',
          '}',
        ].join('\n'),
      )
      // ⛔ **`queueMessage`'s own parameter, scoped BY NAME** — `send` takes the same type, and a
      // file-wide match would be satisfied by that neighbour.
      expect(
        /\n {2}queueMessage\(([\s\S]*?)\n {2}\): Promise<QueueOutcome>/.exec(host_)?.[1] ?? '',
      ).toContain('facts: FactsAQueueCarries = {},')
      // 🔴 **The reply's delivery is the app's, not the agent's**, pinned by its bytes. ⛔ If it ever
      // passed the CALLER through instead, the app's words would arrive as the child's — its declared
      // kind, its receipt, its reach asked (`a-reply-and-its-absence.test.ts` §5 measures all three).
      // ⚑ **D-016 · commit 7 · R3** — the reply names its holder, so the call hands it the name.
      // ⚑ **D-022 · R2** — and whether a new brief of the piece was still held for its holder as it
      // answered; whitespace-flattened, because `prettier` owns where the longer call wraps.
      // ⚑ **D-030** — the words are composed first, so a delivery that fails can keep them for the
      // giver's next start; the queue call hands those words over as the app.
      const flatHost = host_.replace(/\s+/g, ' ')
      expect(flatHost).toContain(
        'text: replyText( piece, this.whatToCallTheConversation(piece.owner), input, resources, aNewBriefWaited, ),',
      )
      expect(flatHost).toContain(
        "this.queueMessage( piece.giver, words.text, THE_APP_ITSELF, [], 'work', words.facts, )",
      )
      // 🔴 **394 · the routed question's delivery is the app's too, and for the same reason.**
      // ⚑ **D-016 · commit 7 · R3** — the asker by the piece it owns, and the address it quotes —
      // ⚑ F033 · the one it asked under, both from one reading. Whitespace-flattened, as the
      // reply's above.
      expect(flatHost).toContain(
        'questionText(this.calledUnder(asked, piece), verdict), THE_APP_ITSELF,',
      )
      // ⚠️ **And the ANSWER goes to the provider rather than through the queue** — an answer is not
      // a turn somebody was handed, it is the release of one the conversation was already in.
      expect(tools).toMatch(/host\.answerQuestion\(/)
      // 🔴 **395 · and the interrupt takes work AWAY, so it mints nothing either.**
      expect(tools).toMatch(/host\.interruptAgent\(/)
      expect(tools).not.toMatch(/host\.interrupt\(/)
      expect(host_).toContain('await session.handle.respondUserInput(request.requestId, {')
    })

    it('⚠️ the mint asks ONE allocator, and that allocator is a transaction', () => {
      // 🔴 **`379`'s census here asserted something else, and `383` retired it deliberately.** It
      // pinned *"no `await` sits between the number and the row"*, because `nextTaskNumber` reserved
      // nothing. ⛔ **The counter took that job.** ⚑ **D-016 · the number is `numberUnder`'s**,
      // taken in the give's synchronous stretch before the send (R4), and the row is `recordGive`'s.
      const host_ = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      const opens = host_.indexOf('async giveWork(')
      expect(opens, 'giveWork was renamed or removed').toBeGreaterThan(0)
      // ⛔ **The BODY, from the opening brace to its end** — not a fixed-width slice, which would
      // borrow the next method's text or stop short of its own.
      const body = host_.slice(opens, host_.indexOf('\n  }', opens))
      // ⚑ **Exactly one number per give**, so a piece cannot quietly consume two.
      expect(body.split('numberUnder')).toHaveLength(2)
      // ⚑ **D-016 · commit 6 · and exactly one per piece taken on** — `takeOnWork` numbers its piece
      // from the same allocator, its root's counter, so a `W1.n` a give took is never taken again.
      const takes = host_.indexOf('\n  async takeOnWork(')
      expect(takes, 'takeOnWork was renamed or removed').toBeGreaterThan(0)
      const taken = host_.slice(takes, host_.indexOf('\n  }', takes))
      expect(taken.split('numberUnder')).toHaveLength(2)
      // ⚠️ **And the host does not reach the counter any other way** — two doors, each numbering
      // only the piece it mints, so *"a number is consumed"* and *"a piece was minted"* cannot come
      // apart.
      expect(host_.split('numberUnder')).toHaveLength(3)
      // ⚑ **And one writer of the piece**, which publishes the row it wrote.
      const records = host_.indexOf('private recordTheGive(')
      expect(records, 'recordTheGive was renamed or removed').toBeGreaterThan(0)
      const recorded = host_.slice(records, host_.indexOf('\n  }', records))
      expect(recorded).toContain('this.deps.store.recordGive(')
      expect(recorded).toContain('this.emitOurs(')
      // ⚑ …and one for a piece queued at a service in a ledger nothing runs, which shows the row it
      // wrote to the windows looking at it; a running service's goes through the one above.
      const accepts = host_.indexOf('private acceptAtTheService(')
      expect(accepts, 'acceptAtTheService was renamed or removed').toBeGreaterThan(0)
      const accepted = host_.slice(accepts, host_.indexOf('\n  }', accepts))
      expect(accepted).toContain('this.recordTheGive(session,')
      expect(accepted).toContain('this.deps.store.recordGive(')
      expect(accepted).toContain('this.showTheWindowsLookingAt(')
      // Personal work records its row inside the root-and-piece transaction, then publishes it.
      expect(taken).toContain('this.deps.store.atomically(')
      expect(taken.split('this.deps.store.recordGive(')).toHaveLength(2)
      expect(taken).toContain('this.emitOurs(session, entry)')
      expect(host_.split('.recordGive(')).toHaveLength(4)

      // ⛔ **The atomicity is in the store, and it is a `db.transaction`** — the thing `379` held
      // with a comment. ⚑ Read from the source, because two callers racing inside one process is
      // not a state a test can stand in.
      const storeSource = codeOnly(sourceOf(join(mainRoot, 'db'), 'session-store.ts'))
      expect(storeSource).toContain('const numberUnderTx = db.transaction(')
      expect(storeSource).toContain('const recordGiveTx = db.transaction(')
      // ⚠️ **And a root is numbered through the SAME helper**, which is what makes every number one
      // counter's rather than two that happen to agree today.
      expect(storeSource.split('bumpSequence(')).toHaveLength(3)
      expect(storeSource).toContain('bumpSequence(ROOTS_SCOPE)')
      expect(storeSource).toContain('bumpSequence(parent)')
    })
  })

  // ⚑ **D-016 commit 3 · §8 is gone** — *what a document row would have to carry to point at a
  // task*. The document registry went, and a reply's files are RESOURCES in `work_resource`, whose
  // `work_id` IS a foreign key: D-016 built the `work` table §8 said did not exist.
})
