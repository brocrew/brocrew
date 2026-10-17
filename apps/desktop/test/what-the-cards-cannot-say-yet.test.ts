import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type FakeSessionHandle } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type {
  HandedPath,
  MessageSentEvent,
  QueuedMessageDisclosure,
  QueuedMessageEvent,
  RuntimeEventMessage,
  SessionLivenessMessage,
  TranscriptEvent,
  UnqueuedMessageEvent,
  UserTurnEvent,
} from '../src/shared/runtime-ipc'
import { GO_AHEAD_MESSAGE } from '../src/renderer/src/lib/plan-mode'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

/**
 * # 687 — what the cards cannot say yet
 *
 * ⚑ **The renderer draws a conversation's cards from three events, and each was missing one fact
 * only main knows.** Every section is measured through the host's own doors, over real SQLite and
 * real migrations, with the shape that must NOT carry the fact as its control.
 *
 * | § | gap | what this file pins |
 * |---|---|---|
 * | 1 | **R22** (`670` F-a) | a held go-ahead's queued row, and its ending, say `app_authored` with no subject; a person's own held message says nothing |
 * | 2 | **`678` H1** | `says` on the turn and on the held row an AGENT's `message_agent` produced — `note` or `follow-up` — and on no row the app, a person or a give's brief wrote |
 * | 3 | **`678` H2** | the sender's `message_sent` carries the LABEL of the piece it names, on both branches, and a note naming none carries none (D-016) |
 * | 4 | **`678` H6** | the turn a held brief FLUSHES into carries its label; since D-016 · R4 the idle brief's turn does too |
 *
 * ⛔ **What this file does NOT claim**: that any renderer DRAWS these facts. The drawing is the
 * frontend's (`687` §4); this is what main hands it.
 *
 * ⚠️ **Every label asserted here is made to differ from `W<n>.1`** — numbers are burned under the
 * giver's root first — so a writer that put a constant on the row could not pass
 * (`a-positive-assertion-must-differ-from-the-default`).
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

/** A latch a test opens by hand. */
const latch = (): { promise: Promise<void>; open: () => void } => {
  let open = (): void => {}
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  /** ⚑ 687 · the liveness channel is recorded too — the composer's queued disclosure rides it. */
  readonly liveness: SessionLivenessMessage[] = []
  sendLiveness(message: SessionLivenessMessage): void {
    this.liveness.push(message)
  }
}

/**
 * ⚑ **The keys a turn's authorship can carry, and the ones that make a subject** — the go-ahead is
 * the app-authored row with NONE of the subject keys, which is how every reader tells it apart.
 */
const SUBJECT_KEYS = ['work', 'relayedFrom', 'relayedFromProfile', 'appNotice'] as const

describe('687 · what the cards cannot say yet', () => {
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
  let claimed: Set<string>
  /**
   * Every card a test has answered, as `conversation · id` — so the next wait is for a card this
   * test has NOT seen. ⚠️ **Keyed by the conversation too**: a request id is session-local, and the
   * Fake numbers every conversation's cards from the same start.
   */
  let answered: Set<string>
  /** ⚑ `670` §6's gate: the go-ahead's `setPlanMode(false)` parks here once, when armed. */
  let planGate: { promise: Promise<void>; open: () => void } | null
  let planReached: { promise: Promise<void>; open: () => void }
  let parkedPlans: (() => void)[]
  const tick = (): number => clock++

  /**
   * `373`'s double, with `670` §6's plan gate on the handle: every launch's toolset is kept, and a
   * go-ahead can be made to lose its race to a turn another sender opens.
   */
  class Watching extends FakeRuntime {
    constructor(provider: Provider) {
      super(provider, { sessions: issued })
    }
    override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
      const handle = await super.start(options)
      if (options.agentTools) handed.push(options.agentTools)
      handles.push(handle)
      return new Proxy(handle, {
        get(target, prop) {
          if (prop === 'setPlanMode') {
            return async (on: boolean): Promise<void> => {
              if (!on && planGate !== null) {
                const gate = planGate
                planGate = null
                parkedPlans.push(gate.open)
                planReached.open()
                await gate.promise
              }
              return target.setPlanMode(on)
            }
          }
          const value = Reflect.get(target, prop) as unknown
          return typeof value === 'function'
            ? (value as (...a: unknown[]) => unknown).bind(target)
            : value
        },
      })
    }
    override async resume(
      ref: SessionRef,
      options: ResumeOptions,
    ): ReturnType<FakeRuntime['resume']> {
      const handle = await super.resume(ref, options)
      if (options.agentTools) handed.push(options.agentTools)
      return handle
    }
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-687-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-687-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 8_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    handles = []
    issued = new FakeProviderSessions()
    planGate = null
    planReached = latch()
    parkedPlans = []
    hosts = []
    host = buildHost(store)
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
    answered = new Set<string>()
  })

  /**
   * ⚑ One host over a store. ⛔ **A SECOND store object over the same file** is what the launch
   * sweep needs to see a held message as stranded — `live-hosts.ts` knows a ledger by its object,
   * so a host on the same store finds the session running elsewhere and leaves it alone
   * (`a-task-you-can-see.test.ts` states the same).
   */
  function buildHost(over: SessionStore): RuntimeHost {
    const built = new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new Watching(provider),
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
        homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    hosts.push(built)
    return built
  }

  afterEach(async () => {
    for (const open of parkedPlans) open()
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const call = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answered = await tool.call(args)
    return {
      structured: (answered.structured ?? {}) as Record<string, unknown>,
      text: answered.text,
    }
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** Every row of one type, with the ordinal it was written at. */
  const rowsOf = <Type extends TranscriptEvent['type']>(
    sessionId: string,
    type: Type,
  ): { ordinal: number; event: Extract<TranscriptEvent, { type: Type }> }[] =>
    store
      .events(sessionId)
      .filter((entry) => entry.event.type === type)
      .map((entry) => ({
        ordinal: entry.ordinal,
        event: entry.event as Extract<TranscriptEvent, { type: Type }>,
      }))

  const receipts = (sessionId: string): MessageSentEvent[] =>
    rowsOf(sessionId, 'message_sent').map((row) => row.event)
  /**
   * ⚑ **The receipts a WINDOW was handed live** — before any replay bound has touched them.
   * ⛔ `687`'s own replay bound drops a number no task row could carry, so a receipt read back
   * through the store would hide a live one that says *Task #0* about a question.
   */
  const liveReceipts = (sessionId: string): MessageSentEvent[] =>
    window.messages
      .filter((one) => one.sessionId === sessionId)
      .map((one) => one.event)
      .filter((event): event is MessageSentEvent => event.type === 'message_sent')
  const turnSaying = (sessionId: string, text: string): UserTurnEvent | undefined =>
    rowsOf(sessionId, 'user_turn').find((row) => row.event.text === text)?.event
  const heldSaying = (sessionId: string, text: string): QueuedMessageEvent | undefined =>
    rowsOf(sessionId, 'message_queued').find((row) => row.event.text === text)?.event
  const endingSaying = (sessionId: string, text: string): UnqueuedMessageEvent | undefined =>
    rowsOf(sessionId, 'message_unqueued').find((row) => row.event.text === text)?.event
  /** The newest liveness disclosure of a held message — what the COMPOSER reads (687). */
  const disclosedSaying = (sessionId: string, text: string): QueuedMessageDisclosure | undefined =>
    window.liveness
      .filter((one) => one.sessionId === sessionId)
      .flatMap((one) => one.liveness.queued ?? [])
      .filter((one) => one.text === text)
      .at(-1)

  /**
   * A PM in a window with one child of its own, started through the real door.
   *
   * ⚑ **D-016 · the give IS the work** — `give_work` starts the child, and its brief (`build it`) is
   * the child's first turn, which parks on its card. ⚑ `burn` numbers are taken under the PM's root
   * first ({@link SessionStore.numberUnder}, R4: a number is never handed out twice), so the piece
   * given takes a label no constant would guess — `expected` is that label.
   */
  const aPmAndItsWorker = async (
    burn = 0,
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerTools: AgentToolset
    piece: string
    label: string
    expected: string
  }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const pm = await personOpens('pm')
    // ⚑ The window that opened the PM already holds it, so no claim is asked of it.
    claimed.add(pm)
    const pmTools = theToolsetJustHandedOut()
    const root = store.rootOf(pm)
    if (root === null) throw new Error('the PM owns no root')
    for (let once = 0; once < burn; once++) store.numberUnder(root.piece)
    const given = await call(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work this dispatch is about',
      brief: 'build it',
    })
    expect(given.structured.outcome, JSON.stringify(given.structured)).toBe('ok')
    return {
      pm,
      worker: given.structured.agent as string,
      pmTools,
      workerTools: theToolsetJustHandedOut(),
      piece: given.structured.piece as string,
      label: given.structured.label as string,
      expected: `${root.label}.${String(burn + 1)}`,
    }
  }

  /**
   * The fake provider parks every turn on a card; a person allowing it lets the turn end.
   *
   * ⛔ **It waits for a card this test has NOT answered** (`687`'s review): a wait for *any* card
   * returns at once on one answered earlier, and which card `.at(-1)` then names would depend on
   * whether the pump had delivered the new turn's yet.
   */
  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const before = rowsOf(sessionId, 'turn').length
    const unanswered = (): string | undefined =>
      rowsOf(sessionId, 'permission_request').find(
        (row) => !answered.has(`${sessionId} · ${row.event.id}`),
      )?.event.id
    await waitFor(() => unanswered() !== undefined, 'the card the turn parks on')
    const id = unanswered()
    if (id === undefined) throw new Error('no unanswered permission request on the ledger')
    answered.add(`${sessionId} · ${id}`)
    const asked = { id }
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, asked.id, { outcome: 'allow' }, window)
    await waitFor(() => rowsOf(sessionId, 'turn').length > before, 'the turn to end')
  }

  /** Answer every card the ledger holds — a turn parks on one, and a flush opens another. */
  const answerEveryCard = async (sessionId: string): Promise<void> => {
    for (const row of rowsOf(sessionId, 'permission_request')) {
      answered.add(`${sessionId} · ${row.event.id}`)
      await host
        .respondPermission(sessionId, row.event.id, { outcome: 'allow' }, window)
        .catch(() => {})
    }
  }

  /* ═════════════════ §1 · R22 — the held go-ahead's row says whose words they are ═════════════════ */

  describe('§1 · R22 — a held go-ahead is BroBot’s words, on the row a person reads while it waits', () => {
    /** A Codex conversation that has planned, and is idle with the plan in front of the person. */
    const aPlanWaitingForItsGoAhead = async (): Promise<{
      sessionId: string
      handle: FakeSessionHandle
    }> => {
      const { sessionId } = await host.createSession(
        { provider: 'codex', planMode: true, approvalMode: 'ask', cwd: root },
        window,
      )
      const handle = handles.at(-1)
      if (handle === undefined) throw new Error('no handle was issued')
      await host.send(sessionId, 'plan it', window)
      await waitFor(
        () => ledger(sessionId).some((event) => event.type === 'permission_request'),
        'the planning turn to park on its card',
      )
      await answerEveryCard(sessionId)
      await waitFor(() => handle.status() === 'idle', 'the planning turn to end')
      return { sessionId, handle }
    }

    /**
     * ⚑ **`670` §6's race**: the go-ahead's release parks, BroBot delivers a notice into the gap
     * and takes the turn, and the go-ahead loses the handover and is HELD.
     */
    const theGoAheadLosesItsRace = async (
      sessionId: string,
      handle: FakeSessionHandle,
    ): Promise<string> => {
      planGate = latch()
      const gate = planGate
      const going = host.endPlanMode(sessionId, window, GO_AHEAD_MESSAGE)
      await planReached.promise
      await host.queueMessage(sessionId, 'a child replied', THE_APP_ITSELF, [], 'notice')
      await waitFor(() => handle.status() !== 'idle', 'the notice’s turn to open')
      gate.open()
      await expect(going).resolves.toBeUndefined()
      const held = heldSaying(sessionId, GO_AHEAD_MESSAGE)
      if (held?.messageId === undefined) throw new Error('the go-ahead was not held by name')
      return held.messageId
    }

    it('🔴 the held go-ahead says `app_authored` with no subject — and the person’s own held message, in the SAME ledger, says nothing', async () => {
      const { sessionId, handle } = await aPlanWaitingForItsGoAhead()
      // ⚑ **THE CONTROL, planted first and in the same conversation**: the person's own words,
      // queued behind a running turn. ⛔ Two rows in one ledger, so a reader that said the same
      // thing about every held row could not pass (standing rule 12).
      await host.send(sessionId, 'keep planning', window)
      await waitFor(() => handle.status() !== 'idle', 'the person’s turn to open')
      const mine = await host.queueMessage(sessionId, 'and here is mine', window)
      expect(mine.outcome).toBe('queued')
      // ⚑ **The composer's copy of the same fact** — the person's own held message is disclosed
      // with no authorship (the control for the go-ahead's disclosure below).
      expect(disclosedSaying(sessionId, 'and here is mine')).toBeDefined()
      expect(disclosedSaying(sessionId, 'and here is mine')).not.toHaveProperty('attribution')
      await answerEveryCard(sessionId)
      await waitFor(
        () => turnSaying(sessionId, 'and here is mine') !== undefined,
        'the person’s held message to flush',
      )
      await answerEveryCard(sessionId)
      await waitFor(() => handle.status() === 'idle', 'the person’s flushed turn to end')

      await theGoAheadLosesItsRace(sessionId, handle)

      const theirs = heldSaying(sessionId, 'and here is mine')
      const brobots = heldSaying(sessionId, GO_AHEAD_MESSAGE)
      // 🔴 **R22**: whose words, on the row that is read FIRST.
      expect(brobots?.attribution).toBe('app_authored')
      // ⛔ …**and no subject**, which is what makes it the go-ahead's entry and no other.
      for (const key of [...SUBJECT_KEYS, 'says'] as const) expect(brobots).not.toHaveProperty(key)
      // ⚑ **The control**: the person's own held row carries no authorship at all.
      expect(theirs).toBeDefined()
      expect(theirs).not.toHaveProperty('attribution')
      for (const key of [...SUBJECT_KEYS, 'says'] as const) expect(theirs).not.toHaveProperty(key)
      // 🔴 **…and the COMPOSER is told too**: the disclosure it draws its *"a message is already
      // waiting"* and its Cancel from says whose words are waiting.
      expect(disclosedSaying(sessionId, GO_AHEAD_MESSAGE)?.attribution).toBe('app_authored')
    })

    it('🔴 its ENDING says so too — a cancelled go-ahead, rebuilt from the ending alone, is not the person’s to put back', async () => {
      const { sessionId, handle } = await aPlanWaitingForItsGoAhead()
      // ⚑ **THE CONTROL, in the same ledger**: the person's own held message, taken back first —
      // the same writer, so a writer that stamped every ending could not pass (`687`'s review).
      await host.send(sessionId, 'keep planning', window)
      await waitFor(() => handle.status() !== 'idle', 'the person’s turn to open')
      const mine = await host.queueMessage(sessionId, 'mine, taken back', window)
      if (mine.outcome !== 'queued') throw new Error('the person’s message was not held')
      await host.cancelQueuedMessage(sessionId, mine.messageId, window)
      await answerEveryCard(sessionId)
      await waitFor(() => handle.status() === 'idle', 'the person’s turn to end')

      const id = await theGoAheadLosesItsRace(sessionId, handle)
      await host.cancelQueuedMessage(sessionId, id, window)
      const ending = endingSaying(sessionId, GO_AHEAD_MESSAGE)
      expect(ending?.reason).toBe('cancelled')
      expect(ending?.attribution).toBe('app_authored')
      for (const key of SUBJECT_KEYS) expect(ending).not.toHaveProperty(key)
      const theirs = endingSaying(sessionId, 'mine, taken back')
      expect(theirs?.reason).toBe('cancelled')
      expect(theirs).not.toHaveProperty('attribution')
    })

    /**
     * ⚑ **D-017 · R3 — a Close is a STOP, and a stop ends nothing it held.** This read *"the ending a
     * CLOSE writes over it"* — `abandoned`, drawn as BroBot's. ⛔ A Close writes no ending now: the
     * held words are handed on, the conversation is started again for them, and they go first. ⚑ So
     * the authorship is measured on what the next start makes of them — the turn they become, beside
     * the `sent` ending — and the person's own, closed the same way, is still theirs.
     */
    it('🔴 …and a CLOSE writes no ending over it — the go-ahead goes at the next start as BroBot’s, and a person’s, closed the same way, as theirs', async () => {
      // ⚑ **THE CONTROL, through the same writer**: a second conversation holding the person's own
      // words is closed too. ⚠️ Not the same ledger, because a conversation holds one piece of
      // work at a time (criterion 13) and both of these are work.
      const other = await aPlanWaitingForItsGoAhead()
      await host.send(other.sessionId, 'keep planning', window)
      await waitFor(() => other.handle.status() !== 'idle', 'the person’s turn to open')
      expect((await host.queueMessage(other.sessionId, 'mine, left waiting', window)).outcome).toBe(
        'queued',
      )
      await host.close(other.sessionId, window)

      const { sessionId, handle } = await aPlanWaitingForItsGoAhead()
      await theGoAheadLosesItsRace(sessionId, handle)
      await host.close(sessionId, window)
      await waitFor(
        () =>
          turnSaying(sessionId, GO_AHEAD_MESSAGE) !== undefined &&
          turnSaying(other.sessionId, 'mine, left waiting') !== undefined,
        'both held messages to go at their conversations’ next start',
      )
      // ⛔ **Never `abandoned`** — each has exactly the ending it was sent with. ⚠️ A `sent` ending
      // carries no authorship, by design (the fold splices the waiting item out on it, and the
      // `user_turn` below IS the record), so whose words they were is read on the TURN.
      expect(endingSaying(sessionId, GO_AHEAD_MESSAGE)?.reason).toBe('sent')
      expect(endingSaying(other.sessionId, 'mine, left waiting')?.reason).toBe('sent')
      const brobots = turnSaying(sessionId, GO_AHEAD_MESSAGE)
      expect(brobots?.attribution).toBe('app_authored')
      for (const key of SUBJECT_KEYS) expect(brobots).not.toHaveProperty(key)
      // ⚑ **The control**: the person's own words, closed the same way, go as theirs.
      const theirs = turnSaying(other.sessionId, 'mine, left waiting')
      expect(theirs).toBeDefined()
      expect(theirs).not.toHaveProperty('attribution')
    })

    it('⚑ the flushed go-ahead is still exactly the row the direct go-ahead writes — nothing added to the TURN', async () => {
      const { sessionId, handle } = await aPlanWaitingForItsGoAhead()
      await theGoAheadLosesItsRace(sessionId, handle)
      await answerEveryCard(sessionId)
      await waitFor(
        () => turnSaying(sessionId, GO_AHEAD_MESSAGE) !== undefined,
        'the go-ahead to flush',
      )
      // ⚑ **F093 · R2 — and the whole text it was handed**, as the direct go-ahead's row keeps it.
      // ⚑ …which ends with the block this app adds to every turn, cut here.
      const kept = turnSaying(sessionId, GO_AHEAD_MESSAGE)
      expect(
        kept === undefined ? kept : { ...kept, sent: withoutWhatThisAppAdds(kept.sent ?? '') },
      ).toStrictEqual({
        type: 'user_turn',
        text: GO_AHEAD_MESSAGE,
        attribution: 'app_authored',
        sent: GO_AHEAD_MESSAGE,
      })
    })

    it('⚑ an app-authored ending on the vanished-file path carries its authorship too', async () => {
      // ⚠️ **No product producer holds app-authored words WITH a path** — the go-ahead carries
      // none (`234` §3). ⚑ The door is asked directly, as `THE_APP_ITSELF` with nothing else, which
      // is exactly the authorship the held go-ahead has — so this is that row's shape on the one
      // ending the go-ahead itself cannot reach.
      const { sessionId, handle } = await aPlanWaitingForItsGoAhead()
      /** Hold `text` behind a running turn with a file that is gone before it flushes. */
      const heldWithAFileThatGoes = async (
        text: string,
        by: typeof window | typeof THE_APP_ITSELF,
        name: string,
      ): Promise<void> => {
        await host.send(sessionId, `keep planning before ${name}`, window)
        await waitFor(() => handle.status() !== 'idle', 'a turn to hold behind')
        const path = join(realpathSync(root), name)
        writeFileSync(path, 'x')
        const attached: HandedPath[] = [{ path, kind: 'file', outsideCwd: false }]
        await host.queueMessage(sessionId, text, by, attached)
        unlinkSync(path)
        await answerEveryCard(sessionId)
        await waitFor(() => endingSaying(sessionId, text) !== undefined, 'the flush to end it')
        await answerEveryCard(sessionId)
        await waitFor(() => handle.status() === 'idle', 'the turn to end')
      }
      // ⚑ **THE CONTROL, in the same ledger and through the same writer**: the person's own.
      await heldWithAFileThatGoes('mine, with a file', window, 'mine-goes-away.md')
      await heldWithAFileThatGoes('the app’s own words', THE_APP_ITSELF, 'goes-away.md')
      const ending = endingSaying(sessionId, 'the app’s own words')
      expect(ending?.reason).toBe('abandoned')
      expect(ending?.detail).toBeDefined()
      expect(ending?.attribution).toBe('app_authored')
      const theirs = endingSaying(sessionId, 'mine, with a file')
      expect(theirs?.reason).toBe('abandoned')
      expect(theirs?.detail).toBeDefined()
      expect(theirs).not.toHaveProperty('attribution')
    })
  })

  /* ═════════════════ §2 · H1 — a turn says what its sender said it is ═════════════════════════════ */

  /**
   * ⚑ **D-016 · two kinds, and a brief is neither** — `message_agent` sends a `note` or a
   * `follow-up`; work is given with `give_work`, whose brief is known by its PIECE and carries no
   * `says` (`UserTurnEvent.says` stays absent on a brief).
   */
  describe('§2 · `678` H1 — `says` on the rows an agent’s `message_agent` produced, and on no other', () => {
    it('🔴 IDLE: a follow-up’s turn says `follow-up`, and a brief’s says nothing — it names its piece', async () => {
      const { worker, pmTools, piece, label } = await aPmAndItsWorker()
      const brief = turnSaying(worker, 'build it')
      expect(brief).toMatchObject({ piece, label })
      expect(brief).not.toHaveProperty('says')
      await letTheTurnFinish(worker)
      await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'what is left?',
        kind: 'follow-up',
        piece: label,
      })
      expect(turnSaying(worker, 'what is left?')?.says).toBe('follow-up')
    })

    it('🔴 a note is recorded as a note at both ends — and, since D-010, no kind named is no message', async () => {
      const { pm, worker, pmTools } = await aPmAndItsWorker()
      await letTheTurnFinish(worker)
      // ⛔ **D-010 · there is no default kind**: the call is refused and nothing is written.
      await call(pmTools, 'message_agent', { agent: worker, text: 'no kind named' })
      expect(turnSaying(worker, 'no kind named')).toBeUndefined()
      expect(receipts(pm)).toEqual([])
      await call(pmTools, 'message_agent', { agent: worker, text: 'a note', kind: 'note' })
      const turn = turnSaying(worker, 'a note')
      expect(turn?.says).toBe('note')
      expect(turn).not.toHaveProperty('piece')
      // ⚑ **The receipt says the same word**, from the same one value — the sender and the
      // receiver may not disagree about what a message was.
      const [receipt] = receipts(pm)
      expect(receipt?.kind).toBe('note')
      expect(turn?.says).toBe(receipt?.kind)
    })

    it('🔴 HELD: the queued row says it, and the turn it flushes into says the same', async () => {
      // ⚑ **D-016** — the brief's own turn parks on its card, so the worker is busy.
      const { worker, pmTools, label } = await aPmAndItsWorker()
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'permission_request'),
        'the worker to be busy',
      )
      const asked = await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'and one more thing?',
        kind: 'follow-up',
        piece: label,
      })
      expect(asked.structured.delivery).toBe('queued')
      expect(heldSaying(worker, 'and one more thing?')?.says).toBe('follow-up')
      await letTheTurnFinish(worker)
      await waitFor(
        () => turnSaying(worker, 'and one more thing?') !== undefined,
        'the held question to flush',
      )
      expect(turnSaying(worker, 'and one more thing?')?.says).toBe('follow-up')
    })

    it('⚑ THE CONTROLS: a person’s turn, a reply the app delivered and a question the app ROUTED say nothing', async () => {
      const { pm, worker, workerTools, label } = await aPmAndItsWorker()
      // ⚑ **A person's own turn**, first, while the PM is idle.
      await host.send(pm, 'a person typing', window)
      const typed = turnSaying(pm, 'a person typing')
      expect(typed).toBeDefined()
      expect(typed).not.toHaveProperty('says')
      await letTheTurnFinish(pm)
      // ⚑ **A reply** — `THE_APP_ITSELF`, with a report. ⚑ **D-016** — to the piece its brief
      // opened, handed back while that brief's turn still runs, so no stall notice is owed first.
      const replied = await call(workerTools, 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'built',
      })
      expect(replied.structured.outcome, JSON.stringify(replied.structured)).toBe('ok')
      await waitFor(
        () => rowsOf(pm, 'user_turn').some((row) => row.event.work !== undefined),
        'the reply to reach the PM',
      )
      const reply = rowsOf(pm, 'user_turn').find((row) => row.event.work !== undefined)?.event
      expect(reply?.attribution).toBe('app_authored')
      expect(reply).not.toHaveProperty('says')
      await letTheTurnFinish(pm)
      // 🔴 **A ROUTED question is RELAYED and still says nothing** — the case where the two
      // readings diverge: it names the child it came from, and no agent called `message_agent`.
      await host.queueMessage(pm, 'the child asks', THE_APP_ITSELF, [], 'question', {
        carriedFor: worker,
      })
      const routed = turnSaying(pm, 'the child asks') ?? heldSaying(pm, 'the child asks')
      expect(routed).toBeDefined()
      expect(routed?.relayedFrom).toBe(worker)
      expect(routed).not.toHaveProperty('says')
    })
  })

  /* ═════════════════ §3 · H2 — the sender's card can say which piece ══════════════════════════════ */

  /**
   * ⚑ **D-016 · re-aimed: the receipt carries the piece a message NAMES.** ⛔ This pinned the
   * number a `work` message minted, on its sender's `message_sent`. ⚑ The give is not a message and
   * writes no receipt (its answer names the label); a note or a follow-up that names a piece carries
   * that piece's id and label on the sender's receipt, and one that names none carries neither.
   */
  describe('§3 · `678` H2 — the sender’s receipt carries the LABEL of the piece it names', () => {
    it('🔴 IDLE branch: the receipt’s label is the recipient’s piece row’s', async () => {
      const { pm, worker, pmTools, label, expected } = await aPmAndItsWorker(4)
      const given = rowsOf(worker, 'work_given').at(-1)?.event
      expect(given?.label).toBe(expected)
      expect(label).toBe(expected)
      await letTheTurnFinish(worker)
      await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'how is it going?',
        kind: 'follow-up',
        piece: label,
      })
      const [receipt] = receipts(pm)
      expect(receipt?.delivery).toBe('sent')
      expect(receipt?.piece).toBe(given?.piece)
      expect(receipt?.label).toBe(given?.label)
    })

    it('🔴 HELD branch: the same, on the receipt for a message that waited', async () => {
      const { pm, worker, pmTools, piece, expected } = await aPmAndItsWorker(6)
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'permission_request'),
        'the worker to be busy',
      )
      // ⚑ Named by its id this time: every door that takes a piece takes either spelling.
      await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'and then build it',
        kind: 'follow-up',
        piece,
      })
      const receipt = receipts(pm).find((one) => one.delivery === 'queued')
      expect(receipt?.piece).toBe(piece)
      expect(receipt?.label).toBe(expected)
    })

    it('⚑ THE CONTROL: a note naming no piece carries none — where a guess would name one', async () => {
      // ⛔ **Where the two readings diverge** (standing rule 3, from `687`'s review): the worker
      // holds a labelled piece, so a receipt that fell back to *the recipient's latest piece* would
      // name it here, and one that carries what the sender named says nothing.
      const { pm, worker, pmTools, label, expected } = await aPmAndItsWorker(2)
      expect(label).toBe(expected)
      await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'about the build',
        kind: 'follow-up',
        piece: label,
      })
      await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'is it going well?',
        kind: 'note',
      })
      const [about, noted] = receipts(pm)
      expect(about?.label).toBe(expected)
      expect(noted?.kind).toBe('note')
      expect(noted).not.toHaveProperty('piece')
      expect(noted).not.toHaveProperty('label')
      // ⛔ **And on the LIVE row too** — the replay bound would drop a stray label from the read
      // above, and a window drawing the exchange as it happens never sees that bound.
      const [, heard] = liveReceipts(pm)
      expect(heard?.kind).toBe('note')
      expect(heard).not.toHaveProperty('label')
    })
  })

  /* ═════════════════ §4 · H6 — the flushed brief carries its label ════════════════════════════════ */

  describe('§4 · `678` H6 — a held brief’s flushed turn says its label on its own', () => {
    it('🔴 the turn a held brief flushes into carries the label its piece row was given a turn earlier', async () => {
      const { pm, worker, pmTools } = await aPmAndItsWorker(3)
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'permission_request'),
        'the worker to be busy',
      )
      // ⚑ **D-016** — a second give from the same giver reaches the SAME conversation, and is held
      // behind the first brief's turn.
      const again = await call(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'Now build it',
        brief: 'now build it',
      })
      expect(again.structured.agent).toBe(worker)
      expect(again.structured.delivery).toBe('held')
      const next = `${String(store.rootOf(pm)?.label)}.5`
      const given = rowsOf(worker, 'work_given').at(-1)
      expect(given?.event.label).toBe(next)
      await letTheTurnFinish(worker)
      await waitFor(
        () => turnSaying(worker, 'now build it') !== undefined,
        'the held brief to flush',
      )
      const flushed = rowsOf(worker, 'user_turn').find((row) => row.event.text === 'now build it')
      // ⚠️ **The premise of H6**: the piece row was written a turn BEFORE the words, so a page
      // that starts at this turn does not hold it.
      expect(given!.ordinal).toBeLessThan(flushed!.ordinal)
      expect(flushed?.event.piece).toBe(given?.event.piece)
      expect(flushed?.event.label).toBe(next)
      expect(flushed?.event).not.toHaveProperty('says')
    })

    /**
     * ⚑ **D-016 · R4 — re-aimed: the IDLE turn carries its label too.** ⛔ The number was minted
     * after the idle turn, so it had none; a piece's number is taken BEFORE the send now, and both
     * branches put the label on the turn.
     */
    it('⚑ THE CONTROLS: the IDLE brief carries its label too, and a flushed follow-up has none', async () => {
      const { worker, pmTools, piece, label, expected } = await aPmAndItsWorker(3)
      const idle = turnSaying(worker, 'build it')
      expect(label).toBe(expected)
      expect(idle).toMatchObject({ piece, label: expected })
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'permission_request'),
        'the worker to be busy',
      )
      await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'is it going well?',
        kind: 'follow-up',
        piece: label,
      })
      await letTheTurnFinish(worker)
      await waitFor(
        () => turnSaying(worker, 'is it going well?') !== undefined,
        'the held question to flush',
      )
      const asked = turnSaying(worker, 'is it going well?')
      expect(asked?.says).toBe('follow-up')
      expect(asked).not.toHaveProperty('label')
      expect(asked).not.toHaveProperty('piece')
    })
  })

  /* ═════════════════ §5 · the ending a CRASH could not write ═══════════════════════════════════════ */

  describe('§5 · the launch sweep carries the held row’s authorship onto the ending it writes', () => {
    it('🔴 a held BRIEF comes back with whose words — a person’s held message with nothing', async () => {
      // ⛔ **The sixth writer of a held row's ending**, found by `687`'s review: `406`, `413`,
      // `545`, `624` and this dispatch's first draft all missed it. ⚑ A window that paged past the
      // queueing rebuilds the row from THIS ending alone.
      // ⚑ **D-016** — the held words are a second give's brief, behind the first brief's turn; a
      // brief carries no `says`.
      const { pm, worker, pmTools } = await aPmAndItsWorker()
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'permission_request'),
        'the worker to be busy',
      )
      const again = await call(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'Now build it',
        brief: 'now build it',
      })
      expect(again.structured.delivery).toBe('held')
      await host.send(pm, 'keep the PM busy', window)
      expect((await host.queueMessage(pm, 'mine, held', window)).outcome).toBe('queued')

      // ⚑ **The next launch** — a second host over a SECOND store object (see `buildHost`).
      buildHost(createSessionStore(db, tick))

      const theirs = endingSaying(worker, 'now build it')
      expect(theirs?.reason).toBe('abandoned')
      expect(theirs?.detail).toBe('the app stopped while this message was still waiting to be sent')
      expect(theirs?.attribution).toBe('app_authored')
      expect(theirs?.relayedFrom).toBe(pm)
      expect(theirs?.relayedFromProfile).toBe('pm')
      expect(theirs).not.toHaveProperty('says')
      // ⚑ **THE CONTROL, through the same sweep**: the person's own words carry none of it.
      const mine = endingSaying(pm, 'mine, held')
      expect(mine?.reason).toBe('abandoned')
      for (const key of ['attribution', ...SUBJECT_KEYS, 'says'] as const)
        expect(mine).not.toHaveProperty(key)
    })
  })

  /* ═════════════════ §6 · a stored label is one this app could have written ═════════════════════════ */

  /**
   * ⚑ **D-016 · re-aimed from `taskNumber` to `label`** — the replay bound keeps a label only beside
   * an id this app could have minted, and only when `pieceNumbersOf` reads it; otherwise the label
   * is dropped (and the piece with it, when the piece is not a storable id) and the row survives.
   */
  describe('§6 · replay bounds `label` — kept when this app could have written it, dropped when not', () => {
    it('⛔ a readable label beside a mintable id is kept; anything else is dropped, and the row survives', async () => {
      const worker = await personOpens('worker')
      const plant = (ordinal: number, event: Record<string, unknown>): void => {
        db.prepare(
          `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
           VALUES (?, ?, 0, ?, ?, ?, ?)`,
        ).run(
          `evt_${String(ordinal)}`,
          worker,
          ordinal,
          event.type as string,
          JSON.stringify(event),
          tick(),
        )
      }
      const turn = (piece: unknown, label: unknown): Record<string, unknown> => ({
        type: 'user_turn',
        text: 'relayed',
        attribution: 'app_authored',
        relayedFrom: 'sess_giver',
        piece,
        label,
      })
      // ⛔ **Literals at the edges** — `MAX_STORED_ID_CHARS` is 200.
      plant(90_001, turn('t'.repeat(200), 'W1.7'))
      plant(90_002, turn('t'.repeat(200), 'W0.7'))
      plant(90_003, turn('t'.repeat(200), 'W1.-3'))
      plant(90_004, turn('t'.repeat(200), 'W1.07'))
      plant(90_005, turn('t'.repeat(200), 7))
      plant(90_006, turn('t'.repeat(201), 'W1.7'))
      plant(90_007, {
        type: 'message_sent',
        to: 'sess_to',
        toProfile: null,
        kind: 'follow-up',
        delivery: 'sent',
        piece: 'work_1',
        label: 'W1.9',
        onBehalfOfAPerson: false,
      })
      plant(90_008, {
        type: 'message_sent',
        to: 'sess_to',
        toProfile: null,
        kind: 'follow-up',
        delivery: 'sent',
        label: 'W1.9',
        onBehalfOfAPerson: false,
      })
      const replayed = (ordinal: number): Record<string, unknown> | undefined =>
        store.events(worker).find((entry) => entry.ordinal === ordinal)?.event as
          Record<string, unknown> | undefined
      expect(replayed(90_001)?.label).toBe('W1.7')
      expect(replayed(90_007)?.label).toBe('W1.9')
      for (const ordinal of [90_002, 90_003, 90_004, 90_005, 90_006, 90_008]) {
        expect(replayed(ordinal), String(ordinal)).toBeDefined()
        expect(replayed(ordinal), String(ordinal)).not.toHaveProperty('label')
      }
      // ⚑ **A mintable id stays beside a dropped label**, and an id no row could carry goes too.
      expect(replayed(90_002)?.piece).toBe('t'.repeat(200))
      expect(replayed(90_006)).not.toHaveProperty('piece')
      // ⚑ **The row survives its dropped label** — the relay is still read.
      expect(replayed(90_002)?.relayedFrom).toBe('sess_giver')
    })
  })
})
