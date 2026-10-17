import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  ResumeOptions,
  SessionHandle,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  TASK_IS_OPEN,
  TASK_WAITS,
  composeWhatEachPieceIsWaitingOn,
  theWaitAConversationIsIn,
  whereTheWorkItHoldsStands,
  type PieceRow,
  type WhatAConversationIsWaitingOn,
} from '../src/shared/tasks'
import {
  DEFAULT_PROFILE_ID,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **621 · the conversation that is waiting, with no task to say so** — `EXT-014` §5 and
 * `HO-095` §5.1, the second of which arrived mid-dispatch and widened it from one wait to three.
 *
 * ## ⛔ The two observations, and they are ONE defect
 *
 * The header, avatar, and rail must distinguish waiting for the person’s decision from idle,
 * and distinguish waiting for a helper’s work from idle. The right pane’s knowledge of
 * given-out work must reach those state readings.
 *
 * 🔴 **Both times every fact was already folded.** ⛔ `WhatAConversationIsWaitingOn` has carried
 * `aPerson` and `aWorker` per CONVERSATION since `609`, and its own docblock says why — *"a
 * permission carries no task id and neither does a proposal, so every open task that conversation
 * holds reads it."* ⚠️ **The hole is the last four words.** The only PLACE the app could say it was
 * a task ROW, and {@link composeWhatEachTaskIsWaitingOn} is a `tasks.map`.
 *
 * ⛔ **A conversation a person started holds no task row at all** — `workBeingAssigned` mints one
 * only when `sessionSpeakingAs(by)` names an agent, which is `§3`'s first assertion — so the wait
 * had nothing to attach to and every agent-state surface read `idle`.
 *
 * ⚑ **D-016 · the tree** — work is given with `give_work`, and a conversation a person started owns
 * a ROOT, which is never a row (R1): it still holds no row, so §3's fact stands. ⚑ The waits are
 * keyed by PIECE now — `childrenOpen` holds the pieces with an open child, where `aWorker` was one
 * conversation-wide boolean — and the per-row composer is `composeWhatEachPieceIsWaitingOn`.
 *
 * ## ⚑ What this suite measures, and what it deliberately does not
 *
 * ⛔ **It measures the FACT and its door.** 🔴 **It measures nothing about a WORD on a screen**:
 * `waiting-on-a-worker` asks nobody for anything, so it is not a `Needing` and must not become the
 * `waiting` standing — which word each wait earns is the renderer's decision and is not made here.
 * ⚠️ **`HO-095` §5.1's *all three waits should reach every surface that shows an agent's state*
 * is half runtime and half renderer, and this is the runtime half.**
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const srcRoot = join(here, '../src')

/**
 * ⛔ **CODE only** — `a-source-census-must-strip-prose-before-it-asserts`. ⚠️ This file's own
 * docblocks quote the sentences it is about, and §1's negative would read them as call sites.
 */
const codeOf = (file: string): string =>
  readFileSync(join(srcRoot, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

/** A promise somebody else resolves — `421`'s helper, the shape `575` reuses. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {}
  const promise = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  return { promise, release }
}

/**
 * ⚑ **`421`'s proxy, and it is the ONLY way to stand inside the `closing` window** — `575` says so
 * in as many words, and §5 needs it because `runFinalize` deletes the slot: a conversation that
 * has FINISHED closing is absent from this read whether or not the gate is asked.
 *
 * ⛔ `put-the-hazard-on-the-path-the-code-walks` — without this, the population guard is a guard
 * no test can make fail.
 */
function holdingItsClose(handle: SessionHandle, gate: Promise<void>): SessionHandle {
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'close') {
        return async (): Promise<void> => {
          await target.close()
          await gate
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

describe('621 · the conversation that is waiting', () => {
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

  class ToolWatchingRuntime extends FakeRuntime {
    constructor(
      provider: Provider,
      private readonly handed: AgentToolset[],
      sessions: FakeProviderSessions,
    ) {
      super(provider, { sessions })
    }
    override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
      const handle = await super.start(options)
      if (options.agentTools) this.handed.push(options.agentTools)
      // ⚑ **One launch at a time may have its close held** — see {@link holdingItsClose}.
      const gate = holdNextClose
      holdNextClose = null
      return (gate === null ? handle : holdingItsClose(handle, gate)) as never
    }
    override async resume(
      ref: SessionRef,
      options: ResumeOptions,
    ): ReturnType<FakeRuntime['resume']> {
      const handle = await super.resume(ref, options)
      if (options.agentTools) this.handed.push(options.agentTools)
      return handle
    }
  }

  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let holdNextClose: Promise<void> | null
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-621-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-621-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    holdNextClose = null
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
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

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /**
   * ⛔ **Answer the card the Fake parks every turn on.** ⚠️ Without it every conversation below
   * would read `waiting-on-a-person`, because that arm beats the worker arm — which is exactly
   * `a-comparison-tested-where-both-sides-agree-measures-nothing`.
   */
  const clearTheCard = async (sessionId: string, surface: RecordingSink): Promise<void> => {
    const card = ledger(sessionId)
      .filter(
        (event): event is TranscriptEvent & { type: 'permission_request'; id: string } =>
          event.type === 'permission_request',
      )
      .at(-1)
    if (card === undefined) throw new Error(`${sessionId} is not parked on anything`)
    await host.respondPermission(sessionId, card.id, { outcome: 'allow' }, surface)
  }

  /**
   * ⚑ **D-017 · R19 — a PM a person opened has no parent, so a card its own turn parks on is a
   * PERSON's**, routed as one: while it is open the PM reads `waiting-on-a-person`, which says
   * nothing about the worker. ⚠️ Every turn the double runs parks on a card, and something the PM is
   * told (a stall notice, a reply) opens one — so this answers each new card of the PM's in turn,
   * until it has seen `cards` of them, and waits for the turn that card was holding to end.
   */
  const thePmClearsItsOwnCards = async (pm: string, cards: number): Promise<void> => {
    const cardsIn = (): number =>
      ledger(pm).filter((event) => event.type === 'permission_request').length
    const turnsIn = (): number => ledger(pm).filter((event) => event.type === 'turn').length
    await waitFor(() => cardsIn() >= cards, `the PM's card number ${String(cards)}`)
    const turns = turnsIn()
    await clearTheCard(pm, window)
    await waitFor(() => turnsIn() > turns, 'the PM’s turn to end')
  }

  /** ⚑ A row the composition can be handed, with every field spelled so nothing is inherited. */
  const rowFor = (state: PieceRow['state'], holder = 'sess_w', piece = 'work_1'): PieceRow => ({
    piece,
    label: 'W1.1',
    parent: 'work_root',
    title: 'work',
    brief: 'work',
    giver: 'sess_pm',
    owner: holder,
    givenAt: 10,
    messageId: null,
    state,
    endedAt: TASK_IS_OPEN[state] ? null : 20,
    endedBy: null,
    outcome: state === 'answered' ? 'done' : null,
    stalledBecause: state === 'stalled' ? 'turn_ended' : null,
    stalledAt: state === 'stalled' ? 15 : null,
    stalledBy: null,
    questionLostAtRestart: false,
    resources: [],
    summary: null,
    answerReachedNobody: false,
    needsUserAction: false,
    statusLine: null,
  })

  const outstanding = (
    over: Partial<WhatAConversationIsWaitingOn> = {},
  ): WhatAConversationIsWaitingOn => ({
    answers: new Set<string>(),
    aPerson: false,
    childrenOpen: new Set<string>(),
    ...over,
  })

  /** ⚑ **D-016** — a child given under `work_1` is still open: the worker arm, keyed by piece. */
  const aChildOpen = { childrenOpen: new Set(['work_1']) }

  const waitOf = (conversation: string): string | null | undefined =>
    host
      .whatEachConversationIsWaitingOn()
      .conversations.find((row) => row.conversation === conversation)?.waiting

  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **§1 · one precedence, spelled once — because there are two readers of it now.**
   */
  describe('§1 · the precedence is held in ONE place', () => {
    it('⛔ the ladder appears exactly ONCE in the module that owns it', () => {
      // ⚑ **`099`'s rule, and this project has paid for it three times**: one fact derived in two
      // places is a fact free to disagree the day either moves. ⛔ The census reads CODE — the
      // docblocks below `whichWait` name every member of the family and would each count as a
      // ladder.
      const tasks = codeOf('shared/tasks.ts')
      const ladders = tasks.split("? 'waiting-on-an-answer'").length - 1
      expect(ladders, 'the answer→person→worker ladder is written more than once').toBe(1)
      // ⛔ **THE POSITIVE CONTROL** (standing rule 34.2): the same corpus, read for a string it
      // really contains, so a census that had stopped matching anything is visible here rather
      // than passing as a clean sweep.
      expect(tasks).toContain("'waiting-on-a-worker'")
      // 🔴 **And both readers go through it**, named one by one rather than counted — a count alone
      // goes green on a call site that moved.
      // ⚑ **D-016** — each arm keyed by the row's own piece; a question about no piece holds none.
      expect(tasks).toContain('outstanding.answers.has(piece.piece),')
      expect(tasks).toContain('outstanding.childrenOpen.has(piece.piece),')
      // ⚑ …and the conversation's reading asks the same ladder of its whole sets.
      expect(tasks).toContain('outstanding.answers.size > 0,')
      expect(tasks).toContain('outstanding.childrenOpen.size > 0,')
    })

    it('⚑ the two readers give the SAME answer wherever they ask the same question', () => {
      // ⛔ **Tested where the two DIVERGE as well as where they agree** (standing rule 3). The
      // first arm is the only one that differs, so it is asked both ways over one source.
      const theAnswer = outstanding({ answers: new Set(['work_1']) })
      expect(theWaitAConversationIsIn(theAnswer)).toBe('waiting-on-an-answer')
      expect(composeWhatEachPieceIsWaitingOn([rowFor('working')], () => theAnswer)[0]?.state).toBe(
        'waiting-on-an-answer',
      )
      // 🔴 **THE DIVERGENCE**: the same source, asked about a DIFFERENT row. ⛔ The row is not the
      // one with the question, so its own state is untouched — and the CONVERSATION is still
      // waiting on an answer, which is the fact no row could carry.
      const other = composeWhatEachPieceIsWaitingOn(
        [rowFor('working', 'sess_w', 'work_2')],
        () => theAnswer,
      )[0]
      expect(other?.state).toBe('working')
      expect(theWaitAConversationIsIn(theAnswer)).toBe('waiting-on-an-answer')
    })
  })

  /**
   * 🔴 **§2 · the three waits, about the CONVERSATION, from the facts `609` already folds.**
   */
  describe('§2 · every wait a conversation can be in', () => {
    it('⛔ each of the three, and the precedence between them', () => {
      expect(theWaitAConversationIsIn(outstanding({ answers: new Set(['work_1']) }))).toBe(
        'waiting-on-an-answer',
      )
      expect(theWaitAConversationIsIn(outstanding({ aPerson: true }))).toBe('waiting-on-a-person')
      expect(theWaitAConversationIsIn(outstanding(aChildOpen))).toBe('waiting-on-a-worker')
      // ⚑ **The precedence, measured where the readings DIVERGE** — with two true, the word is the
      // one somebody can act on. ⛔ A source with only one arm set could never tell an ordering
      // from an accident.
      expect(theWaitAConversationIsIn(outstanding({ aPerson: true, ...aChildOpen }))).toBe(
        'waiting-on-a-person',
      )
      expect(
        theWaitAConversationIsIn(
          outstanding({ answers: new Set(['work_1']), aPerson: true, ...aChildOpen }),
        ),
      ).toBe('waiting-on-an-answer')
      // ⛔ **THE CONTROL WHERE THE FACT IS ABSENT** (`621` §4.2, and
      // `a-line-no-mutation-can-kill-is-not-carrying-its-rule`): a word nothing produces passes
      // every exhaustive check while measuring nothing, so the empty source is asserted too.
      expect(theWaitAConversationIsIn(outstanding())).toBeNull()
      // ⚑ **And the answer is always a member of the family** — no fourth word was invented here.
      for (const source of [
        outstanding({ answers: new Set(['work_1']) }),
        outstanding({ aPerson: true }),
        outstanding(aChildOpen),
      ]) {
        expect([...TASK_WAITS]).toContain(theWaitAConversationIsIn(source))
      }
    })
  })

  /**
   * §3 · Drive the conversation started by the person, its given-out work, and the missing
   * task row end to end.
   */
  describe('§3 · a conversation with NO task of its own', () => {
    it('🔴 it gave out work, it holds no task row, and it reports `waiting-on-a-worker`', async () => {
      const seeded = await personOpens('worker')
      await host.close(seeded, window)
      const pm = await personOpens(DEFAULT_PROFILE_ID)
      const tools = theToolsetJustHandedOut()

      // ⛔ **THE BEFORE, measured rather than assumed** — with nothing handed out, this
      // conversation is waiting on nothing at all. ⚑ It is the control that makes the AFTER a
      // measurement (`a-positive-assertion-must-differ-from-the-default`).
      expect(waitOf(pm)).toBeNull()

      // ⚑ **D-016 · the give** — it starts Ada's conversation, and its brief is her first turn.
      const given = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the thing',
        brief: 'do the thing',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')

      // 🔴 **THE PM's SIDE OF `HO-095` §5.1, and the half nothing could say.** ⛔ A conversation a
      // PERSON started holds no task row — ⚑ since D-016 it owns a ROOT, and a root is never a row
      // (R1) — so there is nowhere to write the wait on a row.
      expect(store.rootOf(pm)?.parent).toBeNull()
      expect(store.piecesOwnedBy(pm)).toEqual([])
      expect(composeWhatEachPieceIsWaitingOn(store.piecesOwnedBy(pm), () => outstanding())).toEqual(
        [],
      )
      // ⚑ **…and the fact was there the whole time.** The piece it gave is what says so.
      expect(store.piecesGivenBy(pm).some((one) => TASK_IS_OPEN[one.state])).toBe(true)
      expect(waitOf(pm)).toBe('waiting-on-a-worker')
    })
  })

  /**
   * 🔴 **§4 · `621` §5.2's control — the task-level read is UNTOUCHED.**
   */
  describe('§4 · what a conversation WITH a task reads has not moved', () => {
    it('⛔ every row the fold produces is exactly what it produced before', () => {
      // ⚑ **The fold is the thing `HO-091` §1 ruled on and it must not have moved an inch.** ⛔ The
      // three waits, the null case, the closed-row case and the stall-field clearing, all over one
      // source — which is the whole of what `609` pinned and what `621` may not change.
      const source = outstanding({ answers: new Set(['work_1']), aPerson: true, ...aChildOpen })
      const rows = composeWhatEachPieceIsWaitingOn(
        [rowFor('working', 'sess_w', 'work_1'), rowFor('stalled', 'sess_w', 'work_2')],
        () => source,
      )
      expect(rows.map((one) => one.state)).toEqual(['waiting-on-an-answer', 'waiting-on-a-person'])
      // ⛔ **The stall fields are still CLEARED**, which four readers depend on by construction.
      expect(rows[1]?.stalledBecause).toBeNull()
      expect(rows[1]?.stalledAt).toBeNull()
      // ⚑ **A CLOSED row is still never touched** — a question outlives the work it was about.
      expect(composeWhatEachPieceIsWaitingOn([rowFor('answered')], () => source)[0]?.state).toBe(
        'answered',
      )
      // 🔴 **And a row whose conversation is waiting on NOTHING keeps its own word.**
      expect(
        composeWhatEachPieceIsWaitingOn([rowFor('stalled')], () => outstanding())[0]
          ?.stalledBecause,
      ).toBe('turn_ended')
    })

    it('⚑ END TO END: a conversation that holds work still reads exactly as it did', async () => {
      const seeded = await personOpens('worker')
      await host.close(seeded, window)
      const pm = await personOpens(DEFAULT_PROFILE_ID)
      const tools = theToolsetJustHandedOut()
      const given = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the work',
        brief: 'do it',
      })
      const worker = given.agent as string
      const mine = store.piecesOwnedBy(worker).find((one) => TASK_IS_OPEN[one.state])
      if (mine === undefined) throw new Error('the give never opened a piece')

      const surface = new RecordingSink('webContents:9')
      host.claimSession(worker, surface)
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'permission_request'),
        'the worker to park on its card',
      )
      await clearTheCard(worker, surface)
      await waitFor(
        () =>
          store.piecesOwnedBy(worker).find((one) => one.piece === mine.piece)?.state === 'stalled',
        'the worker’s turn to end',
      )
      // ⚑ **D-017 · R19** — the stall notice opened a turn in the PM, parked on a card that is a
      // person's; cleared, so the PM's wait is about its worker again.
      await thePmClearsItsOwnCards(pm, 1)
      // ⛔ **THE ROW is untouched by this dispatch**: nothing is driving the work and the row says
      // so, with its cause, exactly as it did before `621`.
      const row = host.pieceBoard(pm).gave.find((one) => one.piece === mine.piece)
      expect(row?.state).toBe('stalled')
      expect(row?.stalledBecause).toBe('turn_ended')
      // 🔴 **AND THE TWO QUESTIONS ARE NOT CONFLATED** (`621` §4.4). ⚑ The worker's own row is
      // `stalled` and the worker's CONVERSATION is waiting on nothing; the PM's conversation is
      // waiting on a worker while holding no row at all. ⚠️ **One field would have had to say
      // both, and two fields say one thing each.**
      expect(waitOf(worker)).toBeNull()
      expect(waitOf(pm)).toBe('waiting-on-a-worker')
    })
  })

  /**
   * 🔴 **§5 · the door — the population, the moment, and what it is not.**
   */
  describe('§5 · the read', () => {
    it('⛔ COMPLETE over the running population, and a conversation it is not running is absent', async () => {
      const first = await personOpens(DEFAULT_PROFILE_ID)
      const second = await personOpens(DEFAULT_PROFILE_ID)
      const reading = host.whatEachConversationIsWaitingOn()
      // ⚑ **Every running conversation appears, `waiting: null` included** — an absence has to be
      // readable, which is `WhatIsBeingDone.conversations`' own argument.
      expect(reading.conversations.map((one) => one.conversation).sort()).toEqual(
        [first, second].sort(),
      )
      for (const one of reading.conversations) {
        // ⚑ **D-006 · and where the work it holds stands**, beside the wait. ⚑ **D-036 moved one
        // fact onto the row**: who holds the open work it gave (`waitingOnTheWorkOf`), named by the
        // host as it names the one it waits on for an answer — so the window draws the one state's
        // *waiting on <name>* and works out none of it.
        expect(Object.keys(one).sort()).toEqual([
          'conversation',
          'identity',
          'needsYou',
          'stoppedWork',
          'waiting',
          'waitingOnTheAnswerOf',
          'waitingOnTheAnswerSince',
          'waitingOnTheWorkOf',
          'waitingOnTheWorkSince',
          'work',
        ])
        expect(one.identity).toBe(DEFAULT_PROFILE_ID)
        // ⛔ **Present and EMPTY, never absent**: neither conversation gave any work, and an absent
        // field is *not read* (`ConversationWaiting.waitingOnTheWorkOf`, `.stoppedWork`).
        expect(one.waitingOnTheWorkOf).toEqual([])
        expect(one.stoppedWork).toEqual([])
      }
      // ⛔ **The moment is stamped**, and it is the app's wall clock rather than the injected one —
      // `WhatIsBeingDone.readAt`'s rule, which this read inherits.
      expect(reading.readAt).toBeGreaterThan(1_600_000_000_000)

      // 🔴 **A conversation this app is not running is ABSENT**, which is `runningStateOf`'s
      // decision asked rather than re-derived — so a wait can never appear beside a band drawing
      // *this app is not running it*.
      await host.close(second, window)
      expect(
        host.whatEachConversationIsWaitingOn().conversations.map((one) => one.conversation),
      ).toEqual([first])
    })

    it('⛔ a slot in `closing` is OUT of the reading, while its session and its slot still exist', async () => {
      // 🔴 **THE ARM THAT MAKES THE GUARD LOAD-BEARING**, and `575` names it: `runFinalize` deletes
      // the slot, so a conversation that has FINISHED closing is absent whether or not anything is
      // asked. ⛔ `put-the-hazard-on-the-path-the-code-walks` — this is the only window in which the
      // slot is in the map AND the app is not running it, and without standing inside it the
      // population gate is a guard no test can make fail.
      const staying = await personOpens(DEFAULT_PROFILE_ID)
      const gate = deferred()
      holdNextClose = gate.promise
      const leaving = await personOpens(DEFAULT_PROFILE_ID)
      expect(
        host
          .whatEachConversationIsWaitingOn()
          .conversations.map((one) => one.conversation)
          .sort(),
      ).toEqual([staying, leaving].sort())

      const closing = host.close(leaving, window)
      // ⚑ **D-016 · read off the window's one list**, whose rows carry the same `runningStateOf`
      // the project's list did before projects went.
      await waitFor(
        () =>
          host.resumableSessions().find((row) => row.sessionId === leaving)?.running ===
          'not-running',
        'the slot to enter its teardown',
      )
      // ⛔ **The band already says this app is not running it**, so a wait here would be two
      // surfaces disagreeing about one question inside one window (`304`).
      expect(
        host.whatEachConversationIsWaitingOn().conversations.map((one) => one.conversation),
      ).toEqual([staying])
      gate.release()
      await closing
    })

    it('⚑ it is on the window wire, on no toolset, and refused during a quit', () => {
      const ipc = codeOf('main/runtime/ipc.ts')
      expect(ipc).toContain("z.object({ kind: z.literal('whatEachConversationIsWaitingOn') }),")
      expect(ipc).toContain("whatEachConversationIsWaitingOn: 'refused',")
      expect(ipc).toContain('return host.whatEachConversationIsWaitingOn()')
      // ⛔ **No toolset offers it**, and the search shape is the toolset's own module rather than a
      // path list: this says what every OTHER conversation is waiting on, which is not a fact this
      // app hands to a conversation.
      expect(codeOf('main/runtime/agent-tools.ts')).not.toContain('whatEachConversationIsWaitingOn')
      // ⚑ **THE POSITIVE CONTROL for that negative** (standing rule 34.2) — the same corpus, read
      // for a verb it really does offer.
      expect(codeOf('main/runtime/agent-tools.ts')).toContain('list_agents')
      // ⚠️ **And the renderer can REACH it** — `621` §5.4. ⛔ The store method is the wire's own
      // end and not a surface; which surfaces draw it is the renderer's dispatch.
      expect(codeOf('renderer/src/lib/session-store.ts')).toContain(
        'return await bridge.whatEachConversationIsWaitingOn()',
      )
      expect(codeOf('preload/index.ts')).toContain("kind: 'whatEachConversationIsWaitingOn',")
    })

    it('🔴 it reads the LEDGER, which is why it is not a field on `whatIsBeingDone`', () => {
      // ⛔ **That read's docblock promises *"No store read of any kind"*** and argues it from
      // `421`'s live-versus-durable split. ⚑ This one takes three narrow reads per conversation, so
      // putting it there would have falsified the paragraph that justifies its cost.
      const host_ = codeOf('main/runtime/runtime-host.ts')
      const done = host_.slice(
        host_.indexOf('whatIsBeingDone(): WhatIsBeingDone {'),
        host_.indexOf('whatEachConversationIsWaitingOn(): WhatEachConversationIsWaitingOn {'),
      )
      expect(done.length, 'the slice found no whatIsBeingDone body').toBeGreaterThan(200)
      expect(done, 'whatIsBeingDone started reading the store').not.toContain('this.deps.store')
      // ⚑ **THE POSITIVE CONTROL**: the neighbouring method, sliced the same way, DOES take the
      // read — so the negative above is a measurement rather than a slice that found nothing.
      const waiting = host_.slice(
        host_.indexOf('whatEachConversationIsWaitingOn(): WhatEachConversationIsWaitingOn {'),
      )
      expect(waiting).toContain('this.oneWaitReadPerAnswer()')
    })
  })

  /**
   * 🔴 **§6 · the cost, COUNTED rather than timed** — it runs on a clock, so `621` owes a
   * measurement (standing rule 29, size M).
   *
   * ⛔ **Not a wall-clock bound.** `a-wall-clock-bound-in-a-test-reports-the-machine`, and standing
   * rule 22: a number in milliseconds is a claim about the machine unless the test controls it.
   * ⚑ **What this counts is STORE CALLS**, which is the thing the poll actually spends and the
   * thing a future edit could multiply without anybody noticing.
   */
  describe('§6 · what one reading costs', () => {
    it('⛔ THREE narrow reads per conversation, and the memo is what keeps it three', async () => {
      const counts = new Map<string, number>()
      const counting = new Proxy(store, {
        get(target, key: string | symbol) {
          const value = Reflect.get(target, key) as unknown
          if (typeof value !== 'function' || typeof key !== 'string') return value
          return (...args: unknown[]): unknown => {
            counts.set(key, (counts.get(key) ?? 0) + 1)
            return (value as (...a: unknown[]) => unknown).apply(target, args)
          }
        },
      }) as SessionStore
      const counted = new RuntimeHost({
        store: counting,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
        prepareProviderHome: (provider: Provider, profileId?: string) => {
          const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => `sess_c${++counter}`,
        now: tick,
        readProviderConfig: (provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
      hosts.push(counted)
      const living: string[] = []
      for (let made = 0; made < 3; made++) {
        const { sessionId } = await counted.createSession(
          { provider: 'claude', profileId: DEFAULT_PROFILE_ID, approvalMode: 'ask', cwd: root },
          window,
        )
        living.push(sessionId)
      }
      counts.clear()
      const reading = counted.whatEachConversationIsWaitingOn()
      expect(reading.conversations).toHaveLength(3)
      // ⛔ **The three `oneWaitReadPerAnswer` takes, each exactly ONCE per conversation.** ⚑ Named
      // one by one rather than totalled: a total goes green on a read that moved into another.
      // ⚠️ **D-016 took the fourth, `proposalsOf`, with proposals and the store's statement.**
      // ⚑ **D-016 · the third is `piecesGivenBy`**, the pieces each gave that are still open.
      for (const read of ['routedRequestsOf', 'questionsRaisedIn', 'piecesGivenBy']) {
        expect(counts.get(read), `${read} is no longer one read per conversation`).toBe(3)
      }
      // ⚑ **D-006 · and ONE `piecesOwnedBy` per conversation**, for where the work it holds stands
      // — a fourth read, priced here: its narrow statement matches no row for a conversation never
      // given work, which is every conversation in this test (each owns a root, never a row).
      expect(
        counts.get('piecesOwnedBy'),
        'piecesOwnedBy is no longer one read per conversation',
      ).toBe(3)
      // 🔴 **THE MEMO, measured where it MATTERS**: asked twice inside one answer, a conversation
      // still costs one set of reads — which is what `oneWaitReadPerAnswer` exists for and what a
      // memo built per row would silently lose.
      expect(counts.get('routedRequestsOf')).toBe(living.length)
    })
  })

  /**
   * 🔴 **§7 · D-006 · F018 — where the work a conversation HOLDS stands.**
   *
   * A giver and two helpers can all read `idle` while their task is `answered · done`. The
   * rail’s polled reading carries both each conversation’s wait and the state of the work it
   * was given, distinguishing finished work from being stuck.
   */
  describe('§7 · D-006 · where the work a conversation holds stands', () => {
    const workOf = (conversation: string): unknown =>
      host
        .whatEachConversationIsWaitingOn()
        .conversations.find((row) => row.conversation === conversation)?.work

    it('⚑ the derivation: open work speaks first, then the work that ended LAST', () => {
      expect(whereTheWorkItHoldsStands([])).toBeNull()
      expect(whereTheWorkItHoldsStands([rowFor('stalled')])).toEqual({ state: 'stalled' })
      // ⛔ Open work a turn drives or a wait holds says nothing here: the turn or the wait does.
      for (const state of ['working', 'waiting', ...TASK_WAITS] as const) {
        expect(whereTheWorkItHoldsStands([rowFor(state)]), state).toBeNull()
      }
      // ⚑ A stall among other open work is said, and finished work beside it does not hide it.
      expect(
        whereTheWorkItHoldsStands([
          rowFor('answered', 'sess_w', 'work_1'),
          rowFor('working', 'sess_w', 'work_2'),
          rowFor('stalled', 'sess_w', 'work_3'),
        ]),
      ).toEqual({ state: 'stalled' })
      // ⛔ …and open work nobody calls stalled hides the finished work: *answered* would be false.
      expect(
        whereTheWorkItHoldsStands([rowFor('answered'), rowFor('working', 'sess_w', 'work_2')]),
      ).toBeNull()
      // ⚑ Nothing open: the work that ended last, by its ending and not by its place in the list.
      expect(whereTheWorkItHoldsStands([rowFor('answered')])).toEqual({
        state: 'answered',
        outcome: 'done',
      })
      const blockedLater: PieceRow = {
        ...rowFor('answered', 'sess_w', 'work_2'),
        endedAt: 30,
        outcome: 'blocked',
      }
      expect(whereTheWorkItHoldsStands([blockedLater, rowFor('withdrawn')])).toEqual({
        state: 'answered',
        outcome: 'blocked',
      })
      // ⛔ Taken back last: it holds nothing, which is what *idle* already says.
      const takenBackLater: PieceRow = { ...rowFor('withdrawn', 'sess_w', 'work_2'), endedAt: 30 }
      expect(whereTheWorkItHoldsStands([rowFor('answered'), takenBackLater])).toBeNull()
    })

    it('🔴 END TO END: a worker whose turn ended holding its work reads stalled, and after its reply, answered', async () => {
      const seeded = await personOpens('worker')
      await host.close(seeded, window)
      const pm = await personOpens(DEFAULT_PROFILE_ID)
      const tools = theToolsetJustHandedOut()
      // ⚑ **D-016 · the give starts the worker, and its brief is the worker's first turn** — so
      // there is no *before* in which it holds nothing: from here its turn is on the work.
      const given = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the report',
        brief: 'write it',
      })
      const worker = given.agent as string
      const workersTools = theToolsetJustHandedOut()
      const mine = store.piecesOwnedBy(worker).find((one) => TASK_IS_OPEN[one.state])
      if (mine === undefined) throw new Error('the give never opened a piece')

      const surface = new RecordingSink('webContents:9')
      host.claimSession(worker, surface)
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'permission_request'),
        'the worker to park on its card',
      )
      // ⚑ While its turn is on the work (parked on a card), the wait speaks and the work does not.
      expect(waitOf(worker)).toBe('waiting-on-a-person')
      expect(workOf(worker)).toBeNull()

      await clearTheCard(worker, surface)
      await waitFor(
        () =>
          store.piecesOwnedBy(worker).find((one) => one.piece === mine.piece)?.state === 'stalled',
        'the worker’s turn to end',
      )
      // ⚑ **D-017 · R19** — the stall notice opened a turn in the PM, parked on a card that is a
      // person's; cleared, so the PM's wait is about its worker again.
      await thePmClearsItsOwnCards(pm, 1)
      // 🔴 **The stuck agent of F018**: idle, waiting on nothing, and its work not driven.
      expect(waitOf(worker)).toBeNull()
      expect(workOf(worker)).toEqual({ state: 'stalled' })
      // ⛔ **The PM holds no work of its own** — only its root, which is never a row (D-016 · R1):
      // its wait speaks, and nothing is said about work.
      expect(waitOf(pm)).toBe('waiting-on-a-worker')
      expect(workOf(pm)).toBeNull()

      const replied = await callOn(workersTools, 'reply_to_parent', {
        piece: mine.label,
        outcome: 'done',
        summary: 'the report is written',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      // 🔴 **The finished agent of F018**: idle too, and now it says its work is answered.
      expect(waitOf(worker)).toBeNull()
      expect(workOf(worker)).toEqual({ state: 'answered', outcome: 'done' })
      expect(waitOf(pm)).not.toBe('waiting-on-a-worker')
      // ⚑ **D-017 · R19** — the reply opened a turn in the PM too; once its card is cleared, the PM
      // waits on nothing at all.
      await thePmClearsItsOwnCards(pm, 2)
      expect(waitOf(pm)).toBeNull()
    })
  })
})
