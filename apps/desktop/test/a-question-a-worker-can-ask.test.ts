import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { REPLY_ADDRESSING_KEYS, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { QUESTION_RAILS } from '../src/main/runtime/question-rails'
import { TASK_IS_OPEN, TASK_STATES, derivePieces } from '../src/shared/tasks'
import { REQUEST_IS_OPEN } from '../src/shared/questions'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { stillHeld } from '../src/shared/mailbox'
import type {
  PersistedEventInfo,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **437 · the question a worker can ask its parent** — criterion 29, HO-019 §1.
 *
 * ## ⚑ The property
 *
 * > **A worker that needs a decision from its parent can ask for one, keep its task open, and carry
 * > on when the answer arrives.**
 *
 * ## ⛔ §1 is the LEAD, and it is the only real judgement in this dispatch
 *
 * **What does the ASK move in the fold?** ⚑ **Nothing — whatever the task already was, it still
 * is.** ⛔ **The claim that is load-bearing is that the ASK MOVES NOTHING** — §1's fold test is the
 * one that measures it. The verb HOLDS THE TURN — which is what a provider-raised question has
 * always done — so `deriveTasks` (`derivePieces` since D-016) never reaches its stall branch and
 * the work is honestly being worked on.
 *
 * ⚠️ **Stated that way rather than as *"`working` throughout"***, which was the first draft and is
 * too strong: the door admits any OPEN task, so a worker asking about a `waiting` or `stalled` one
 * leaves it exactly where it was.
 *
 * ## 🔴 603 · this section ALSO argued that no vocabulary should gain a member, and that half is
 * withdrawn
 *
 * ⛔ **It said:** *"No member was added to any vocabulary to say so… A fourth OPEN state would have
 * been the task fold growing a second opinion about a question, which `shared/tasks.ts` forbids in
 * as many words, and it would have duplicated `stalled` in the one respect that matters: both would
 * mean nothing is driving this."*
 *
 * ⚠️ **The middle clause was the error and it is worth naming, because it is standing rule 19's
 * shape exactly** — `a-description-hardens-into-a-ruling-in-the-docblock-it-leaves`. ⛔ *A state
 * would be the FOLD growing a second opinion* conflates the state with WHERE IT IS DERIVED: the
 * fold still grows none, and `603` composes the member ABOVE it, which is `400`'s rule kept rather
 * than relaxed (`HO-091` §1, `474`'s precedent).
 *
 * 🔴 **And the last clause was false rather than merely narrow.** ⛔ `asking` and `stalled` do NOT
 * both mean *nothing is driving this*: something is driving it — an answer — and the parent reading
 * the row is usually the one who owes it. ⚑ `HO-018` §2.1 had already ruled the shape (*"a condition
 * on an open task, never a terminal state"*), `HO-085` measured that nothing had built it, and
 * `HO-091` §1 ruled where the join goes.
 *
 * ⚑ **What this file still owns is the half that did not move**, and the re-aimed test below is it:
 * the ask writes no task state, and the FOLD reaches neither table. **The member and the
 * composition are `waiting-on-an-answer-is-not-stalled.test.ts`'s.**
 *
 * ⚠️ **§1 measures that where the two readings DIVERGE** (standing rule 3): the same worker, the
 * same task, one turn ending with a question outstanding and one ending without.
 *
 * ## ⛔ What did NOT move, and §2 is the negative that says so
 *
 * ⚑ **No capability was widened and no clause was added to any reach.** `withinMessagingReach` and
 * `mayCommand` are untouched: the question travels as {@link THE_APP_ITSELF}, exactly as a reply
 * and a provider-raised question already do. ⛔ So *a worker still cannot address anything that is
 * not its parent* is true BY CONSTRUCTION — there is no argument through which it could name one —
 * and §2 measures both halves of that at one caller.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

describe('437 · a question a worker can ask its parent', () => {
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

  /** ⚑ `415`'s instrument: remember the toolset each launch was handed. */
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
      return handle
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
  /** ⚠️ **Read at construction**, so a section that wants a short bound sets it before `buildHost`. */
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-437-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-437-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    // ⚑ **608 · this suite used to shorten `deps.askBoundMs` so an unanswered question cost
    // seconds rather than minutes** (HO-084 §4). ⛔ **There is no bound**: `ask_parent` returns as
    // soon as its three durable writes are made, so a question nobody answers costs nothing at
    // all and §5 no longer builds a host of its own to provoke one.
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

  /**
   * ⛔ **Started and NOT awaited**, because this verb holds the turn open — awaiting it before the
   * answer is sent is a deadlock, and that is the mechanism rather than a quirk of the double.
   */
  const startAsking = (
    toolset: AgentToolset,
    args: Record<string, unknown>,
    // ⚑ **611 · the recipient is DEFAULTED HERE and never by the app** (HO-088 §2.2). ⛔ The verb
    // refuses a call that does not name one; this helper fills the ordinary case so that the
    // dozens of calls below go on measuring what they were written to measure, and a caller that
    // wants the other end or no end at all passes its own.
  ): Promise<Record<string, unknown>> =>
    callOn(toolset, 'ask_question', { who_answers: 'the-parent', ...args })

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

  const cardsOn = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'permission_request').length

  /**
   * ⚑ **Park a turn on a permission card, which is how a receiver is made busy.**
   *
   * ⛔ **It waits for a card to be ADDED and not for one to EXIST.** A conversation that has already
   * parked and been answered once still `some(...)`s true for ever, so an existence check would
   * return instantly against a stale row and the caller would carry on believing a turn is running.
   */
  const cardOn = async (sessionId: string, before: number): Promise<void> => {
    await waitFor(() => cardsOn(sessionId) > before, 'the card the turn parks on')
  }

  const sourceOf = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8')

  /** ⚠️ **A function BODY, so an absence is about that function and not about the file.** */
  const bodyOf = (source: string, signature: string, closes = '\n  }'): string => {
    const from = source.indexOf(signature)
    if (from === -1) throw new Error(`no such declaration: ${signature}`)
    const to = source.indexOf(closes, from)
    if (to === -1) throw new Error(`unterminated declaration: ${signature}`)
    return source.slice(from, to)
  }

  const heldBy = (sessionId: string): readonly { kind: string }[] =>
    stillHeld(store.events(sessionId))

  /** ⚑ One entry for the pure fold, ordinal and time from one number. */
  const at = (ordinal: number, event: TranscriptEvent): PersistedEventInfo => ({
    ordinal,
    at: 10 + ordinal,
    event,
  })

  /**
   * ⛔ **Whether a promise has settled after a real interval** — and the interval is what makes this
   * a measurement rather than a tautology.
   *
   * 🔴 **The first version of this raced the promise against `Promise.resolve(sentinel)` and could
   * not fail for ANY implementation** (found by this dispatch's own review). A verb that returned
   * immediately still takes several microtask ticks to travel back through `guarded`, the tool's
   * `call` and `callOn` — so the sentinel won that race either way and *"still pending"* was true of
   * a verb that held nothing. ⚑ **A macrotask tick is the difference**: an immediate implementation
   * has certainly settled by the next timer, and a held one certainly has not.
   */
  const settledYet = async (promise: Promise<unknown>): Promise<boolean> => {
    const pending = Symbol('pending')
    let outcome: unknown = pending
    void promise.then(
      (value) => {
        outcome = value
      },
      (error: unknown) => {
        outcome = error
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    return outcome !== pending
  }

  const taskOf = (sessionId: string): { piece: string; state: string } => {
    const open = store.piecesOwnedBy(sessionId).find((one) => TASK_IS_OPEN[one.state])
    if (open === undefined) throw new Error(`no open piece in ${sessionId}`)
    return { piece: open.piece, state: open.state }
  }

  const stateOf = (sessionId: string, piece: string): string => {
    const row = store.piecesOwnedBy(sessionId).find((one) => one.piece === piece)
    if (row === undefined) throw new Error(`no piece ${piece} in ${sessionId}`)
    return row.state
  }

  /** ⚑ **D-016 · what the giver's own list says of a piece it gave** — the board's `gave` row. */
  const onTheGiversBoard = (giver: string, piece: string): string | undefined =>
    host.pieceBoard(giver).gave.find((one) => one.piece === piece)?.state

  /**
   * ⚑ A PM in a window, and a worker it gave one piece of work through the door. ⛔ No grant is set
   * for the give (D-014: any agent may give work to any agent). ⚑ **D-016 · the give starts the
   * worker, and its brief is the worker's first turn** — in the PM's `ask`, parked on a card.
   */
  const aWorkerHoldingWork = async (): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerTools: AgentToolset
    piece: string
  }> => {
    await bringIdentityIntoBeing('worker')
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work this dispatch is about',
      brief: 'migrate the schema',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerTools = theToolsetJustHandedOut()
    return { pm, worker, pmTools, workerTools, piece: taskOf(worker).piece }
  }

  /**
   * ⛔ **`because === null` is the filter, and leaving it out is a real trap.** A given child's
   * first consequential tool call parks on a PERMISSION card, and `394` routes that to the parent
   * too — with `because` set, and refused by name at the answer door. ⚠️ A helper that took the last
   * row would sometimes hand back a permission and the answer would be refused rather than
   * delivered, which is a test failing for a reason that has nothing to do with what it measures.
   */
  /**
   * ⛔ **A caller speaking AS a conversation** — `sessionSpeakingAs` reads `ownerId` and requires the
   * `agent:` prefix, so this is the only shape that reaches an agent-facing door.
   */
  const asAgent = (sessionId: string): { ownerId: string } => ({ ownerId: `agent:${sessionId}` })

  const theQuestionWaitingOn = (parent: string): { requestId: string; part: string } => {
    const one = host
      .questionsWaitingOn(parent)
      .filter((row) => row.request.went.is === 'the-parent')
      .at(-1)
    if (one === undefined) throw new Error(`no answerable question is waiting on ${parent}`)
    return { requestId: one.request.requestId, part: 'answer' }
  }

  /**
   * 🔴 **§1 · THE LEAD — what the task's state is while the worker waits.**
   *
   * ⛔ **`working`, and the pair below is what makes that a measurement rather than a label.** The
   * two readings of *"a turn ended in this conversation"* diverge here and nowhere else: with a
   * question outstanding the task must NOT stall, and without one it must — so a verb that quietly
   * stopped holding the turn would be caught by the first assertion, and a fold that stopped
   * stalling at all would be caught by the second.
   */
  describe('§1 · the task stays `working`, and no vocabulary grew a member for it', () => {
    it('⛔ the call RETURNS at once, and the work is still not reported as having given up', async () => {
      // 🔴 **608 · this test asserted the OPPOSITE and it was `437`'s whole mechanism** (HO-084 §4,
      // standing rule 26 — strip AND re-aim). ⚠️ It read *the call does not RETURN until the answer
      // does*, and the load-bearing line was `expect(await settledYet(asking)).toBe(false)`:
      // **a verb that returned here would have ended the worker's turn, and `deriveTasks` would
      // then stall the task at `turn_ended` — "its turn ended and it replied nothing", which is
      // false of a worker that asked.**
      //
      // 🔴 **`603` built the word the fold was missing** — `TaskState.asking`, composed above both
      // folds — so the sentence is answered by what every surface READS rather than by a blocked
      // call. ⛔ **The subject is unchanged and is measured where it now lives**: a worker that
      // asks is never reported as having given up.
      const { pm, worker, workerTools, piece } = await aWorkerHoldingWork()
      expect(stateOf(worker, piece)).toBe('working')

      const said = await startAsking(workerTools, {
        piece,
        question: 'postgres or sqlite?',
        options: ['postgres', 'sqlite'],
      })
      // ⛔ **It came BACK, and that is the assertion the ruling now rests on.** ⚑ **The positive
      // control for the instrument itself**, without which *"it settled"* means nothing: a promise
      // that really is pending is reported pending by this same helper.
      expect(await settledYet(Promise.resolve('settled'))).toBe(true)
      expect(await settledYet(new Promise(() => {}))).toBe(false)
      expect(said.outcome, JSON.stringify(said)).toBe('ok')

      // ⚑ **The FOLD still says `working` while the turn is open** — nothing about asking moves it,
      // which is `400`'s rule and §1's next test.
      expect(stateOf(worker, piece)).toBe('working')
      // 🔴 **And the composition already says it**, on the parent's own list — the word that
      // replaced the hold, renamed `waiting-on-an-answer` by `609`. ⛔
      // `waiting-on-an-answer-is-not-stalled.test.ts` is where the whole property lives; this is
      // the half `437`'s hold used to carry.
      expect(onTheGiversBoard(pm, piece)).toBe('waiting-on-an-answer')

      const { requestId, part } = theQuestionWaitingOn(pm)
      const answered = await host.answerQuestion(
        { questionId: requestId, answers: [{ part, answer: ['postgres'] }] },
        asAgent(pm),
      )
      expect(answered.ok, JSON.stringify(answered)).toBe(true)
      // ⛔ **The question is CLOSED, by the same row a person's answer writes.** ⚠️ Without it the
      // request would derive `open` for ever: `list_questions` would go on naming a question nobody
      // is waiting for, and the escalation sweep would eventually tell a person about it.
      const settled = store.routedRequestsOf(worker).filter((one) => one.went.is === 'the-parent')
      expect(settled).toHaveLength(1)
      expect(settled[0]?.state).toBe('answered')
      expect(REQUEST_IS_OPEN[settled[0]?.state ?? 'open']).toBe(false)
      // ⚑ **And the word stops being about the ANSWER**, because the composition reads the same
      // derivation the ending was written into.
      //
      // 🔴 **609 · it goes to `waiting-on-a-person` and not back to `working`, and that is this
      // fixture telling the truth for the first time.** ⛔ This worker's ledger holds
      // `turn_1_perm` — `to: 'a-person'`, `because: 'a-permission-decision'`, `state: 'open'` —
      // raised by the scripted turn and never answered. ⚑ **A person really does owe a decision
      // here**, and until `609` the only words available for that were `working` (*a child is
      // busy*) and, once its turn ended, `stalled` (*nothing is driving this*). ⚠️ **Neither was
      // true**, which is `HO-019` §1's sentence arriving through the person's door.
      //
      // ⛔ **The ANSWER arm really did clear**, and this next line is what proves the change of
      // word is the permission and not a composition that never lets go.
      expect(
        store.routedRequestsOf(worker).filter((one) => one.went.is === 'the-parent'),
      ).toHaveLength(1)
      expect(
        store.routedRequestsOf(worker).find((one) => one.went.is === 'the-parent')?.state,
      ).toBe('answered')
      expect(onTheGiversBoard(pm, piece)).toBe('waiting-on-a-person')
      // ⚑ **It carried on and finished the work it kept** — the second half of the property. ⛔ The
      // RAW fold is the one that still says `working`: the composition is above it, and nothing
      // `609` added reaches `derivePieces`.
      expect(stateOf(worker, piece)).toBe('working')
      const done = await callOn(workerTools, 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: 'migrated to postgres',
      })
      expect(done.outcome, JSON.stringify(done)).toBe('ok')
      expect(stateOf(worker, piece)).toBe('answered')
    })

    it('⛔ the fold has NO branch for the question row — asking changes no task state, either way', () => {
      // 🔴 **The pair, where the two readings DIVERGE** (standing rule 3). ⚑ The claim is not that a
      // question stops a turn from stalling work — if a turn really ended, the work really is
      // undriven and `stalled` is the truth. **The claim is that the question row itself moves
      // nothing**, so `working` while the worker waits is a consequence of the turn being HELD and
      // never of a second opinion written into the task vocabulary.
      // ⚑ **D-016 · the piece opens with `work_given`**, where the task opened with `task_assigned`.
      const assigned = at(1, {
        type: 'work_given',
        piece: 'work_1',
        label: 'W1.1',
        parent: 'work_root',
        givenBy: 'sess_pm',
        title: 'do it',
        brief: 'do it',
      })
      const asked = at(2, {
        type: 'question_asked',
        requestId: 'req_1',
        piece: 'work_1',
        label: 'W1.1',
        prompt: 'which?',
        questions: [{ id: 'answer', prompt: 'which?', options: [] }],
      })
      const routed = at(3, {
        type: 'request_routed',
        requestId: 'req_1',
        to: 'the-parent',
        parent: 'sess_pm',
      })
      const ended = at(4, { type: 'turn', state: 'completed' })
      // ⚑ **With the question and without it, the state is the same at every point** — which is what
      // *"the fold must not grow a second opinion about a question"* means as an assertion.
      expect(derivePieces('sess_w', [assigned])[0]?.state).toBe('working')
      expect(derivePieces('sess_w', [assigned, asked, routed])[0]?.state).toBe('working')
      // ⛔ **And a turn that really ended stalls it either way.** A fold that had been taught to
      // suppress the stall while a question is open would fail HERE, and that suppression is exactly
      // the second opinion this dispatch refused to write.
      expect(derivePieces('sess_w', [assigned, ended])[0]?.state).toBe('stalled')
      const both = derivePieces('sess_w', [assigned, asked, routed, ended])[0]
      expect(both?.state).toBe('stalled')
      expect(both?.stalledBecause).toBe('turn_ended')
    })

    it('⛔ 603 · the ASK still reaches neither table — the member exists and this verb does not write it', async () => {
      // ⚑ **The negative §3 of the brief asked for, RE-AIMED rather than deleted** (`603`, standing
      // rule 26). ⛔ It asserted the vocabulary had five members and `HO-018` §2.1 · `HO-085` §6 ·
      // `HO-091` §1 reversed that; what it was PROTECTING is the clause after the comma, which is
      // untouched: no state this verb reaches is written by this verb or by the fold under it.
      //
      // ⚠️ **The search shape is unchanged** — an open state has to appear in these two tables,
      // because `TASK_IS_OPEN` is keyed by `TaskState` and nothing else in the app decides whether
      // work is somebody's to finish.
      expect(Object.keys(TASK_IS_OPEN).sort()).toEqual([...TASK_STATES].sort())
      // 🔴 **The member is COMPOSED above the fold and never folded** — the whole property is
      // `waiting-on-an-answer-is-not-stalled.test.ts`; what is asserted here is that the ask itself
      // is not where it comes from, which is what this test has always been about.
      // ⚠️ **609 · re-aimed, not stripped.** `asking` was RENAMED to `waiting-on-an-answer` and
      // gained two neighbours; asserting the old spelling would have gone red, and deleting the
      // assertion would have passed the gate with the instrument dead
      // (`a-mutation-on-a-census-is-invisible-to-that-census`). ⛔ What it pins is unchanged: the
      // state the ask leads to is in the vocabulary and is OPEN.
      expect([...TASK_STATES]).toContain('waiting-on-an-answer')
      expect(TASK_IS_OPEN['waiting-on-an-answer']).toBe(true)
      const { pm, worker, workerTools, piece } = await aWorkerHoldingWork()
      const asking = startAsking(workerTools, { piece, question: 'which one?' })
      expect(stateOf(worker, piece)).toBe('working')
      const { requestId, part } = theQuestionWaitingOn(pm)
      await host.answerQuestion(
        { questionId: requestId, answers: [{ part, answer: ['this one'] }] },
        asAgent(pm),
      )
      await asking
      expect(stateOf(worker, piece)).toBe('working')
      // ⚠️ **And the ledger grew no piece for the question** — it is not work, in either
      // direction: the worker's own piece count is unchanged and the PM was handed nothing.
      expect(store.piecesOwnedBy(worker).map((one) => one.piece)).toEqual([piece])
      expect(store.piecesOwnedBy(pm)).toEqual([])
    })
  })

  /**
   * 🔴 **§2 · what did NOT move — and the negative is the point of the section.**
   *
   * ⛔ **No capability was widened, no clause was added to any reach, and `mayCommand` did not
   * move.** ⚑ The question travels as {@link THE_APP_ITSELF}, which `assertMayReach` returns for
   * before it reads a grant — the same route a reply and a provider-raised question already take.
   * ⚠️ **So the negative and the positive are the SAME caller one verb apart**, which is what makes
   * it a measurement of the REACH rather than of the worker.
   */
  describe('§2 · the reach did not move', () => {
    it('⛔ a worker still cannot address its parent with message_agent — and CAN ask it', async () => {
      const { pm, worker, workerTools, piece } = await aWorkerHoldingWork()
      // 🔴 **549 · the worker is NARROWED here, and that is a change worth reading** (HO-058 §1).
      // ⛔ **The ruled default is `any` now, so a worker CAN address its parent with
      // `message_agent`** — which is the sentence this test's own title denies, and `437` built
      // `ask_parent` in a world where it could not. ⚑ **What `437` built is untouched and is still
      // the only verb that BLOCKS and comes back with an answer**; what moved is whether plain
      // words can go upward at all. ⚠️ **The rail below is kept measurable by a person's
      // narrowing** — to `none` since D-016 took `same-project` away — and the widening is
      // measured in `two-withdrawals-open-what-was-scoped.test.ts` §4.
      const workerProfile = store.identityOf(worker)?.profileSlug ?? ''
      expect(store.setCapabilities(workerProfile, { canMessage: 'none' })).toBe(true)
      // ⛔ **The negative.** The worker names the exact conversation that gave it the work.
      // ⚑ **D-016 · a `note`**: a follow-up names a piece the SENDER gave, and the worker gave none.
      const refused = await callOn(workerTools, 'message_agent', {
        agent: pm,
        text: 'postgres or sqlite?',
        kind: 'note',
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      // ⚑ **D-017 · R12 — the reach rail, and no longer `no-such-agent`**: the parent exists, and
      // `no-such-agent` is said only about an id no conversation has (`05` rule 6).
      expect(refused.rail).toBe('may-not-message')
      // ⚑ **The positive, one verb over, same caller, same target.** The reach did not admit it;
      // the task edge did.
      const said = await startAsking(workerTools, {
        piece,
        question: 'postgres or sqlite?',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      const { requestId, part } = theQuestionWaitingOn(pm)
      const answered = await host.answerQuestion(
        { questionId: requestId, answers: [{ part, answer: ['postgres'] }] },
        asAgent(pm),
      )
      // ⚑ **608 · the ANSWER is what proves the edge, and it is read off the row** (HO-084 §4).
      // ⛔ It used to be read off the call's own `answered: true`, which only existed while the
      // call was parked on the answer.
      expect(answered.ok, JSON.stringify(answered)).toBe(true)
      expect(store.routedRequestsOf(worker).find((one) => one.requestId === requestId)?.state).toBe(
        'answered',
      )
      // ⚠️ **And SEEING did not widen either** — `433`'s ruling is *a caller may see exactly what it
      // may send to*, so a verb that granted a send without a sight would have broken it and one
      // that granted a sight is what this asserts did not happen.
      // ⛔ **Asked of the AGENT IDS and never of the whole payload.** The worker's own card carries
      // `parent`, which IS the pm's id — so a `toContain` over the JSON would be satisfied by a
      // neighbouring field and would fail for a reason that is not the reach.
      const listed = await callOn(workerTools, 'list_agents', {})
      const named = (listed.agents as { agent: string }[]).map((one) => one.agent)
      expect(named).not.toContain(pm)
      // ⚑ **The non-vacuity control**: it really did list something — itself.
      expect(named).toContain(worker)
    })

    it('⛔ every spelling of an addressee is refused, and the list is the one reply_to_parent refuses', async () => {
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      // ⛔ **The CONSTANT and never a hand-written subset** (found by this dispatch's own review).
      // ⚠️ The title claims *every* spelling and *the list `reply_to_parent` refuses*; six literals
      // made both halves false, and a divergence between the two doors would have been invisible.
      for (const key of REPLY_ADDRESSING_KEYS) {
        const aimed = await callOn(workerTools, 'ask_question', {
          who_answers: 'the-parent',
          piece,
          question: 'which one?',
          [key]: worker,
        })
        expect(aimed.outcome, `${key} · ${JSON.stringify(aimed)}`).toBe('refused')
        expect(aimed.rail, key).toBe('malformed-request')
        expect(JSON.stringify(aimed.detail), key).toContain(key)
      }
      // ⚑ **The non-vacuity control**: the same call with no addressee is admitted, so the six
      // refusals above are about the KEY and not about the call being malformed some other way.
      const asking = startAsking(workerTools, { piece, question: 'which one?' })
      // ⚠️ **`because === null` filters out the spawn's own permission routing**, which is a
      // different question with a different answerer — see `theQuestionWaitingOn`.
      expect(
        store.routedRequestsOf(worker).filter((one) => one.went.is === 'the-parent').length,
      ).toBe(1)
      void asking
    })

    it('⚑ the two gates this dispatch did not touch still read exactly as they did', () => {
      // ⛔ **A source census with its shape stated** (standing rule 4): a widening for this dispatch
      // would have had to add a clause naming a task or a parent inside one of these two functions,
      // so the search is for THIS dispatch's own vocabulary appearing in them. ⚠️ A hit would be a
      // finding; the absence is what says the reach is untouched.
      // ⚑ **D-016 · the vocabulary is the piece's now** — `piecesOwnedBy` for `tasksOf`, `heldBy` for
      // `theTaskYouWereGiven` and `parentOf` for `spawnProvenance` — so the search is for those.
      const source = sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts')
      const reach = bodyOf(source, 'withinMessagingReach(sessionId: string, by: Caller')
      expect(reach).not.toContain('piecesOwnedBy')
      expect(reach).not.toContain('heldBy')
      expect(reach).not.toContain('parentOf')
      const command = bodyOf(source, 'export function mayCommand(', '\n}')
      expect(command).not.toContain('piecesOwnedBy')
      expect(command).not.toContain('heldBy')
      // ⚑ **The positive control for the instrument itself**: the two bodies really were found and
      // really do contain what they have always contained. ⛔ Without this the three absences above
      // would pass just as well against an empty string.
      // ⛔ **Controls taken from the LAST statement of each body, never from its signature** (found
      // by this dispatch's own review). ⚠️ A token that appears in the signature is satisfied by a
      // span that found the declaration and stopped, so the three absences above would have been
      // measured over nothing.
      expect(reach).toContain('reachesWhatItDidNotStart')
      expect(command).toContain('commandedBy')
      // ⚠️ **And the verb really does read the task edge**, which is where the derivation moved to —
      // ⚑ **D-016** — the pieces the asker holds, its root among them.
      expect(bodyOf(source, 'async raiseAQuestion(')).toContain('this.heldBy(speaking)')
    })
  })

  /**
   * 🔴 **§3 · the lane — a question is held BESIDE the work, and answering mints nothing.**
   *
   * ⛔ **`436` named this as the half that would be missed**: a grant alone would have put the
   * question in the receiver's WORK slot, where a busy parent refuses a second one.
   */
  describe('§3 · the question lane, and a busy parent', () => {
    it('⛔ a parent already holding a queued work message still receives the question', async () => {
      const { pm, worker, workerTools, piece } = await aWorkerHoldingWork()
      // ⚠️ **The PM is made busy the way a mailbox is made busy** (`415`'s idiom): a turn is running
      // and parked on a card, so the next thing sent to it is HELD rather than delivered.
      const already = cardsOn(pm)
      await host.send(pm, 'a person types', window)
      await cardOn(pm, already)
      await host.queueMessage(pm, 'something a person typed', window)
      expect(
        heldBy(pm).filter((one) => one.kind === 'work').length,
        JSON.stringify(heldBy(pm)),
      ).toBe(1)
      const asking = startAsking(workerTools, { piece, question: 'postgres or sqlite?' })
      // ⚠️ **Waited for, because the delivery is deliberately not awaited by the verb** — `394`'s
      // ruling: the routing row is written first and the delivery is best-effort behind it, so a
      // test that read the mailbox on the next line would read it before the question arrived.
      await waitFor(
        () => heldBy(pm).some((one) => one.kind === 'question'),
        "the worker's question in the parent's mailbox",
      )
      // ⚑ **It took a slot of its own** — `394`'s exemption, and the reason it exists: a question
      // refused for want of a slot leaves the conversation that asked blocked for ever.
      const held = heldBy(pm)
      expect(held.filter((one) => one.kind === 'question').length).toBe(1)
      expect(held.filter((one) => one.kind === 'work').length).toBe(1)
      void asking
      void worker
    })

    it('⚑ the question reaches the parent as words naming the id to quote, and mints no task', async () => {
      const { pm, workerTools, piece } = await aWorkerHoldingWork()
      const asking = startAsking(workerTools, {
        piece,
        question: 'postgres or sqlite?',
        options: ['postgres', 'sqlite'],
      })
      const { requestId } = theQuestionWaitingOn(pm)
      const words = host.questionsWaitingOn(pm).at(-1)?.words ?? ''
      // ⛔ **The words are rendered by the SAME function a provider-raised question uses**, so the
      // two readings of one question cannot drift — see `questionText`.
      expect(words).toContain('answer_question')
      expect(words).toContain(requestId)
      expect(words).toContain('postgres')
      expect(words).toContain('sqlite')
      // ⚠️ **And it minted nothing**: only a give opens a piece (D-016), and the app gives nothing.
      // ⛔ **Read AFTER the delivery has landed** — the verb does not await it, so a synchronous read
      // here would pass against a verb that DOES mint.
      await waitFor(
        () => store.events(pm).some((one) => one.event.type === 'user_turn'),
        "the question to reach the parent's transcript",
      )
      expect(store.piecesOwnedBy(pm)).toEqual([])
      void asking
    })
  })

  /**
   * 🔴 **§4 · the edge is the TASK's, and since D-014 no other conversation can hold it.**
   *
   * ⛔ A provider-raised question is routed by the conversation's parent; this verb routes by the
   * piece's giver ({@link PieceRow.giver}). ⚑ **D-016 · a give reaches only the giver's OWN
   * conversation with an agent**, so for work given today the two edges name one conversation: a
   * second conversation that gives work to the same agent starts a conversation of its own, and
   * holds no edge a question from this one could follow.
   */
  describe('§4 · the task edge, and the conversation that cannot hold it', () => {
    it('⛔ the question goes to the conversation that GAVE THE WORK, and one that did not start the worker gave none', async () => {
      await bringIdentityIntoBeing('worker')
      const spawner = await personOpens('pm')
      const spawnerTools = theToolsetJustHandedOut()
      const given = await callOn(spawnerTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the work this question is about',
        brief: 'the work this question is about',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const worker = given.agent as string
      const workerTools = theToolsetJustHandedOut()
      const piece = taskOf(worker).piece
      expect(store.parentOf(worker)).toBe(spawner)
      expect(store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.giver).toBe(spawner)

      // 🔴 **A SECOND conversation, on the default grants, did not start the worker** — so its give
      // does not reach it: ⚑ **D-016** — it starts that agent's conversation with IT, and the
      // worker is handed nothing. ⛔ (Until D-016 the same words were refused
      // `assign-work-to-one-you-did-not-start`.)
      const bystander = await personOpens('brobot')
      const bystanderTools = theToolsetJustHandedOut()
      const elsewhere = await callOn(bystanderTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the work this question is about',
        brief: 'the work this question is about',
      })
      expect(elsewhere.outcome, JSON.stringify(elsewhere)).toBe('ok')
      expect(elsewhere.agent).not.toBe(worker)
      expect(
        store.piecesOwnedBy(worker).map((one) => one.piece),
        'a give from another conversation reached the worker',
      ).toEqual([piece])

      const asked = await startAsking(workerTools, { piece, question: 'which one?' })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      // ⚑ **608 · the routing row is already there when the call comes back** — there is no window
      // in which a worker has asked and the ledger does not say so.
      const routed = store.routedRequestsOf(worker).filter((one) => one.went.is === 'the-parent')
      expect(routed).toHaveLength(1)
      // 🔴 **It went to the GIVER**, and the other conversation is waiting on nothing.
      expect(routed[0]?.parent).toBe(spawner)
      expect(
        host.questionsWaitingOn(bystander).filter((one) => one.request.went.is === 'the-parent'),
      ).toEqual([])
      expect(
        host.questionsWaitingOn(spawner).filter((one) => one.request.went.is === 'the-parent'),
      ).toHaveLength(1)

      const { requestId, part } = theQuestionWaitingOn(spawner)
      const answered = await host.answerQuestion(
        { questionId: requestId, answers: [{ part, answer: ['that one'] }] },
        asAgent(spawner),
      )
      // ⚑ **608 · read off the ROW** — the call no longer waits to carry an answer back.
      expect(answered.ok, JSON.stringify(answered)).toBe(true)
      expect(store.routedRequestsOf(worker).find((one) => one.requestId === requestId)?.state).toBe(
        'answered',
      )
    })
  })

  /**
   * 🔴 **§5 · the bound — standing rule 13, and an expiry is NOT a refusal.**
   *
   * ⛔ **Every wait in this app carries a deadline**, and this one reports what it did rather than
   * what it planned to do: the ask was PERFORMED and the answer was not.
   *
   * ## 🔴 591 · this section PINNED A LIMIT, and the limit was the finding (HO-082 §5)
   *
   * An unanswered call, an `open` routed row, and refusal of late answers can leave a “NEEDS
   * YOU” row whose only exit is “End conversation”. The test must account for the person’s
   * ability to answer rather than accept those three conditions as sufficient.
   *
   * > ⚑ **HO-082 §5, now standing rule 8.4:** *when a test pins a mechanism's limit, someone asks
   * > what a person SEES at that limit — and if the answer is a row they can never clear, the
   * > LIMIT is the finding rather than the test.*
   *
   * ⛔ **So the third clause is GONE with the behaviour it pinned, and the first two are kept
   * exactly as they were** — `a-mutation-on-a-census-is-invisible-to-that-census`'s rule for an
   * instrument: never delete an assertion to pass a gate, re-aim it and say what it pins instead.
   * ⚑ **What it pins now is the OPPOSITE of what it pinned**: a late answer is TAKEN, the ending is
   * written, and the words reach the worker. The whole property is
   * `a-question-does-not-expire-on-a-clock.test.ts`; this keeps the half that is about the BOUND.
   */
  describe('§5 · the call does not wait, and an unanswered question is not a failed call', () => {
    it('⛔ an unanswered question returns a SUCCESS, and leaves the question open AND answerable', async () => {
      // ⚑ **608 · no host of its own and no shortened bound** (HO-084 §4). ⚠️ This used to build a
      // second host with `askBoundMs = 150` so the ask would give up inside the test; the ask now
      // gives up nothing and comes back at once.
      const { pm, worker, workerTools, piece } = await aWorkerHoldingWork()
      const said = await startAsking(workerTools, { piece, question: 'anyone there?' })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      // ⛔ **`ok` and not a refusal** — an ask nobody has answered is a successful call, which is
      // standing rule 13's distinction: the ASK was performed and the ANSWER is somebody else's
      // act. ⚠️ **`answered` and `waitedForMs` are GONE rather than constant**: they reported what
      // a five-minute race had met, and there is no race.
      expect(said.answered).toBeUndefined()
      expect(said.answers).toBeUndefined()
      expect(said.waitedForMs).toBeUndefined()

      // ⚑ **The question is still OPEN and still the parent's to answer** — the durable half does
      // not expire with the turn, which is `394`'s ruling and the reason `list_questions` exists.
      const open = store.routedRequestsOf(worker).filter((one) => one.went.is === 'the-parent')
      expect(open).toHaveLength(1)
      expect(REQUEST_IS_OPEN[open[0]?.state ?? 'answered']).toBe(true)
      expect(
        host.questionsWaitingOn(pm).filter((one) => one.request.went.is === 'the-parent'),
      ).toHaveLength(1)
      // ⚠️ **And the work was never touched by any of it.**
      expect(stateOf(worker, piece)).toBe('working')

      // 🔴 **591 · the call used to say WHICH silence this was, off the ledger** — and `608`
      // removed the read because there is only one thing that can have happened. ⚑ **The ROW is
      // where *still theirs to answer* lives and always was**, which is HO-082 §2's whole ruling.
      expect(said.question_is).toBeUndefined()

      // 🔴 **591 · A LATE ANSWER IS TAKEN, and this assertion used to say the opposite** (HO-082
      // §2). ⛔ **It was `expect(late.ok).toBe(false)` with the rail `question-has-already-ended`**,
      // and every clause of it was true of the build it was written against — see this section's
      // own note on why that made the limit the finding rather than the test.
      const late = await host.answerQuestion(
        {
          questionId: open[0]?.requestId ?? '',
          answers: [{ part: 'answer', answer: ['not too late'] }],
        },
        asAgent(pm),
      )
      expect(late.ok, JSON.stringify(late)).toBe(true)
      // ⚑ **The ENDING is written**, which is what takes the row out of the queue a person reads —
      // HO-082 §4.1's *the queue must read a fact, not infer one*.
      expect(
        store.routedRequestsOf(worker).filter((one) => one.went.is === 'the-parent')[0]?.state,
      ).toBe('answered')
      // ⚠️ **`questionsWaitingOn` still NAMES it, and that is not a contradiction** — it is
      // `list_questions`' content and it carries ended rows with the word that ended them, which is
      // what `QUESTION_STATE_SENTENCE` exists for. ⛔ What moved is the STATE, and the state is
      // what every queue folds through {@link REQUEST_IS_OPEN}.
      const afterwards = host
        .questionsWaitingOn(pm)
        .filter((one) => one.request.went.is === 'the-parent')
      expect(afterwards).toHaveLength(1)
      expect(REQUEST_IS_OPEN[afterwards[0]?.request.state ?? 'open']).toBe(false)
    })

    it('⛔ a PERSON can answer a question this app is holding — the last step of the escalation chain', async () => {
      // ⛔ **`437`'s bound was derived from *ask → escalate → a person is told → the person
      // answers*, and that last step had to exist** (found by that dispatch's own review). A
      // person's door is `respondUserInput`, which would otherwise have forwarded an id no provider
      // ever minted. ⚑ **608 · the bound is gone and the chain is not** (HO-084 §4): the escalation
      // is what still gets a person told, and this is still the door they answer at.
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      const workerSurface = new RecordingSink('webContents:9')
      host.claimSession(worker, workerSurface)
      const said = await startAsking(workerTools, { piece, question: 'which one?' })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      const requestId =
        store.routedRequestsOf(worker).filter((one) => one.went.is === 'the-parent')[0]
          ?.requestId ?? ''
      const ack = await host.respondUserInput(
        worker,
        requestId,
        { kind: 'answer', answers: { answer: ['the person decided'] } },
        workerSurface,
      )
      expect(ack.outcome, JSON.stringify(ack)).toBe('taken')
      // ⚑ **And it closed the request through the SAME row the parent's door writes.**
      expect(
        store.routedRequestsOf(worker).filter((one) => one.went.is === 'the-parent')[0]?.state,
      ).toBe('answered')
      // 🔴 **608 · the answer reaches the worker as WORDS**, which is where it used to reach it as
      // the call's own result. ⛔ A person whose answer went nowhere is `589`'s defect with the
      // refusal removed and the delivery never built.
      await waitFor(
        () =>
          ledger(worker).some(
            (event) =>
              (event.type === 'user_turn' || event.type === 'message_queued') &&
              event.text.includes('the person decided'),
          ),
        'the person’s answer reaching the worker',
      )
    })

    /**
     * 🔴 **619 · the whole hop, from the verb's own argument to the row a person reads** —
     * `HO-093` §3.1.
     *
     * ⛔ **The two halves are tested apart everywhere else and this is the only place they meet.**
     * `answer-it-where-you-were-told.test.ts` measures the FOLD against a hand-built
     * `RaisedQuestion` and the ROW against a hand-built `PersonsQuestion`; neither can see that
     * `questionsForAPerson` actually spends the read it already makes. ⚠️ **A host that dropped
     * the field would pass both of them** and ship a queue that never offers anything —
     * `a-census-that-asks-for-the-import-must-ask-for-the-call`, one layer up.
     */
    it('🔴 a question asked WITH options reaches the person’s queue carrying them', async () => {
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      const said = await startAsking(workerTools, {
        piece,
        question: 'which train?',
        who_answers: 'a-person',
        options: ['The 09:10', 'The 11:40'],
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      const rows = host.questionsForAPerson().rows.filter((one) => one.request.askedBy === worker)
      expect(rows, JSON.stringify(rows)).toHaveLength(1)
      // ⛔ **The labels the CALLER wrote**, in the order it wrote them, under the part this app
      // composed — the key `respondUserInput` files the answer against.
      expect(rows[0]?.offered).toEqual({ part: 'answer', options: ['The 09:10', 'The 11:40'] })
      // ⚑ **And it is still the cardless population**, which is what makes the offer the only
      // thing a person has: nothing about this row changed except that it can now be acted on.
      expect(rows[0]?.raisedBy).toBe('this-app')
    })

    /**
     * ⛔ **The control, and it is the same call one fact over** (standing rule 3) — the one
     * argument that decides it, left out.
     */
    it('⛔ …and a question asked with NO options reaches it carrying nothing to press', async () => {
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      const said = await startAsking(workerTools, {
        piece,
        question: 'in your own words, which train?',
        who_answers: 'a-person',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      const rows = host.questionsForAPerson().rows.filter((one) => one.request.askedBy === worker)
      expect(rows, JSON.stringify(rows)).toHaveLength(1)
      expect(rows[0]?.offered).toBeNull()
    })

    /**
     * 🔴 **619 · the same door, handed the payload a SURFACE builds** — and it spread the word
     * into its letters.
     *
     * ## ⛔ The defect, and why nothing had ever met it
     *
     * ⚠️ **`UserInputResponse.answers` is `Record<string, string | string[]>`** — `answerMapSchema`
     * admits both because both providers send both — and this branch did `answer: [...answer]`,
     * which on a STRING is its characters. ⛔ **`UserInputCard` sends the string** for every
     * single-select question (`question.multiSelect ? picked : (picked[0] ?? '')`), and
     * `attention.ts`'s `answerFor` sends it for every one-click answer on a dashboard.
     *
     * ⚑ **It was unreachable until `619`.** `transcript.ts` folds `question_asked` into a notice,
     * so no card has ever been drawn over a question this app holds and nothing could reach this
     * line with a string — `589`: *"no person-facing answer control exposes that act"*. 🔴 `619`
     * gives the queue one, so the repair lands in the commit that reaches it.
     *
     * ⚠️ **The test above passes an ARRAY and always did**, which is exactly why it never saw
     * this: `one-failure-is-not-the-failure-shape`, on a parameter whose two legal spellings meet
     * at one line.
     */
    it('🔴 a person’s answer given as ONE STRING reaches the worker as that word, not its letters', async () => {
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      const workerSurface = new RecordingSink('webContents:11')
      host.claimSession(worker, workerSurface)
      const said = await startAsking(workerTools, { piece, question: 'which one?' })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      const requestId =
        store.routedRequestsOf(worker).filter((one) => one.went.is === 'the-parent')[0]
          ?.requestId ?? ''
      const ack = await host.respondUserInput(
        worker,
        requestId,
        // ⛔ **A bare string**, which is what every single-select surface in this app sends.
        { kind: 'answer', answers: { answer: 'Yes' } },
        workerSurface,
      )
      expect(ack.outcome, JSON.stringify(ack)).toBe('taken')
      const reached = async (): Promise<string> => {
        await waitFor(
          () =>
            ledger(worker).some(
              (event) =>
                (event.type === 'user_turn' || event.type === 'message_queued') &&
                event.text.includes('which one?'),
            ),
          'the answer reaching the worker',
        )
        return ledger(worker)
          .filter((event) => event.type === 'user_turn' || event.type === 'message_queued')
          .map((event) =>
            event.type === 'user_turn' || event.type === 'message_queued' ? event.text : '',
          )
          .join('\n')
      }
      const text = await reached()
      expect(text, 'the answer arrived spread into its characters').toContain('Yes')
      // 🔴 **The failure this pins, spelled out.** ⛔ `[...'Yes']` is `['Y', 'e', 's']`, and
      // `answerText` joins a part's answers with a comma — so the worker was told its question had
      // been answered *Y, e, s*. ⚑ Asserted as the SHAPE and not as one spelling, because what is
      // wrong is the split rather than the separator.
      expect(text, 'the word was spread into its letters').not.toContain('Y, e, s')
      expect(text.replace(/Yes/g, ''), 'a letter of the answer is standing on its own').not.toMatch(
        /\bY\b/,
      )
    })

    it('⛔ interrupting the worker writes the ending, and there is no held call to release', async () => {
      // 🔴 **`askTheWorkToStop` writes `request_interrupted` for every open routed request** — and
      // without also settling the parked ask, `437` measured, the ledger asserted an ending while
      // the app went on holding the tool call for the whole bound.
      //
      // ⛔ **608 · the release loop went with the hold** (HO-084 §4, standing rule 26). ⚑ **The
      // ENDING is the half that mattered and it is unchanged**; what is gone is the second act
      // that had to agree with it, and a stop can no longer outrun a call that is not running.
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      const said = await startAsking(workerTools, { piece, question: 'which one?' })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      const before = ledger(worker).length
      // ⚠️ **A PERSON stops it**, through the surface that took it over — the gesture `395` built
      // this path for, and the one that needs no grant.
      const surface = new RecordingSink('webContents:8')
      host.claimSession(worker, surface)
      await host.interrupt(worker, surface)
      expect(
        store.routedRequestsOf(worker).filter((one) => one.went.is === 'the-parent')[0]?.state,
      ).toBe('interrupted')
      // ⛔ **And the stop delivered no words** — an ending is a row; the words a worker gets are
      // answers, and nobody decided anything here.
      expect(
        ledger(worker)
          .slice(before)
          .filter((event) => event.type === 'user_turn' || event.type === 'message_queued'),
      ).toEqual([])
    })

    it('⛔ 608 · the bound this section was named for is gone, and its neighbour still refuses a non-positive one', () => {
      // 🔴 **This test pinned `askBoundMs`'s own construction guard** (437): a non-positive bound is
      // not a shorter wait, it is a wait that has always expired — every question reporting *nobody
      // answered* the instant it was asked, which reads as a working mechanism and is a broken one.
      //
      // ⛔ **608 removed the dep, the field and the constant** (HO-084 §4), so the guard has nothing
      // left to guard. ⚑ **Re-aimed rather than deleted** (standing rule 26): what it pins now is
      // that the number is GONE from every layer it lived in, and that the sibling guard the
      // argument was borrowed from still fires — without which this would be a negative with no
      // positive control anywhere near it.
      const questions = readFileSync(join(mainRoot, '../shared/questions.ts'), 'utf8')
      const code = questions.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
      expect(code).not.toContain('ASK_BOUND_MS')
      // ⚠️ **612 · the positive control was `ESCALATION_WINDOW_MS` and that number is GONE too**
      // (HO-088 §3.1, standing rule 26). ⛔ **A control has to be a thing that EXISTS**, so it is
      // re-pointed at the one this module still exports — otherwise this negative would be green
      // over an unreadable file.
      expect(code).toContain('export function aPersonsSince(')

      const host = readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8')
      const hostCode = host.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
      expect(hostCode).not.toContain('askBoundMs')
      expect(hostCode).not.toContain('escalationWindowMs')
      // ⚑ **616 · the argument was borrowed from a guard that no longer has anything to guard.**
      // ⛔ `612` re-pointed this at `positiveWindow(deps.proposalBoundMs ?? PROPOSAL_BOUND_MS,` —
      // *the only window `positiveWindow` still guards* — and `HO-093` §2 removed that one too,
      // so the helper itself went with its last caller. ⚠️ **Re-aimed a second time rather than
      // deleted** (standing rule 26): what it pins is that the guard and BOTH remaining windows
      // are gone from this class together, so a deadline cannot come back without its rule.
      expect(hostCode).not.toContain('proposalBoundMs')
      expect(hostCode).not.toContain('positiveWindow')
      // ⚑ **THE POSITIVE CONTROL, and it is a distinction rather than a spare string**: this class
      // still resolves three injected numbers — they bound THIS APP's own teardown and launch, not
      // how long somebody has to answer — so *no deadline window is resolved here* is a
      // measurement and not a reader pointed at a file that moved (standing rule 34.2).
      expect(hostCode).toContain('deps.closeDrainTimeoutMs ?? DEFAULT_CLOSE_DRAIN_TIMEOUT_MS')
    })
  })

  /**
   * 🔴 **§6 · the ask rail, demonstrated by refusal and paired with the same call one fact over.**
   */
  describe('§6 · no-open-work-by-that-name', () => {
    it('⛔ three causes, one sentence — and the same call while the work is open is admitted', async () => {
      const { pm, pmTools, worker, workerTools, piece } = await aWorkerHoldingWork()
      // ⛔ **Cause 1 — an id that names nothing.**
      const invented = await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece: 'work_nobody_minted',
        question: 'which one?',
      })
      expect(invented.outcome, JSON.stringify(invented)).toBe('refused')
      expect(invented.rail).toBe('no-open-work-by-that-name')
      expect(invented.permanence).toBe('permanent')
      expect(invented.retryable).toBe(false)
      // ⚑ **No remedy, and it is asserted rather than assumed** — see the rail's own note.
      expect(invented.remedy).toBeNull()

      // ⛔ **Cause 2 — work this worker was never given.** The id is real; it belongs to nobody here.
      // ⚠️ The PM holds no piece given to it, so the id below is given in a THIRD conversation, which
      // is what makes this a different cause from the first rather than a second spelling of it.
      await bringIdentityIntoBeing('other')
      const second = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'other',
        title: 'a second child with work of its own',
        brief: 'somebody else is doing this',
      })
      expect(second.outcome, JSON.stringify(second)).toBe('ok')
      const other = second.agent as string
      const someoneElses = taskOf(other).piece
      expect(someoneElses).not.toBe(piece)
      const notMine = await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece: someoneElses,
        question: 'which one?',
      })
      expect(notMine.outcome, JSON.stringify(notMine)).toBe('refused')
      expect(notMine.rail).toBe('no-open-work-by-that-name')

      // ⚑ **The paired POSITIVE, one fact over: the same caller, the same verb, its own open work.**
      const mine = await startAsking(workerTools, { piece, question: 'which one?' })
      expect(mine.outcome, JSON.stringify(mine)).toBe('ok')
      const { requestId, part } = theQuestionWaitingOn(pm)
      const answered = await host.answerQuestion(
        { questionId: requestId, answers: [{ part, answer: ['this one'] }] },
        asAgent(pm),
      )
      // ⚑ **608 · read off the ROW** — admission is what this cause-and-control pair is about, and
      // the call's own `answered` went with the wait.
      expect(answered.ok, JSON.stringify(answered)).toBe(true)
      expect(store.routedRequestsOf(worker).find((one) => one.requestId === requestId)?.state).toBe(
        'answered',
      )

      // ⛔ **Cause 3 — work that is no longer open**, which is the same id that worked a line ago.
      await callOn(workerTools, 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: 'finished',
      })
      expect(stateOf(worker, piece)).toBe('answered')
      const closed = await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'one more thing?',
      })
      expect(closed.outcome, JSON.stringify(closed)).toBe('refused')
      expect(closed.rail).toBe('no-open-work-by-that-name')
      // ⚠️ **The detail echoes what the caller spelled and nothing the app found** — see the rail.
      expect(closed.detail).toEqual({ piece })
    })

    // ⛔ **`the predicate refuses rows it was handed that belong to somebody else` is gone with its
    // subject** (D-016): `theTaskYouWereGiven` — and `thePieceYouHold` after it — was deleted; the
    // ask finds its piece in `RuntimeHost.heldBy`, which reads the asker's own ledger and nothing a
    // caller hands in.

    it('⚑ the ask door contributes its named rail, and the complete roster is pinned below', () => {
      // ⛔ **A closed vocabulary, asserted as MEMBERS and never as a count in a title** — `396`'s
      // correction. The ask contributed `no-open-work-by-that-name`; everything else a question can
      // be refused with was already there and is shared by both directions.
      expect([...QUESTION_RAILS]).toEqual([
        'no-question-by-that-name',
        'a-person-answers-this-one',
        'question-has-already-ended',
        'that-answer-cannot-be-sent',
        'the-conversation-that-asked-has-gone',
        // ⛔ **661's `the-conversation-that-asked-has-ended` is gone** (D-017 · R4): a question this
        // app asked outlives a stop and its answer starts the asker, so nothing is ever "ended, but a
        // reopen brings it back" — and there is no bring-back left to name.
        // ⚑ **679 · both answer doors' word for an id two of the caller's children share** (`675`
        // F-b) — a provider's request id is session-local, so the id alone names two questions.
        'more-than-one-question-has-that-id',
        // ⚑ **679 · and for an `asked_by` that raised nothing by an id another child did** — found by
        // `679`'s review: `no-question-by-that-name` said nobody was waiting on a live id.
        'that-conversation-did-not-ask-that',
        'no-open-work-by-that-name',
        // ⚑ **611 · the pass-up door's two, appended** (HO-088 §3.2) — one for a conversation
        // nothing spawned, one for words this app no longer holds.
        'nobody-to-pass-it-up-to',
        'this-app-does-not-hold-those-words',
        // ⚑ **D-009 · F012's three, appended** — an agent the caller may not ask, a question asked of
        // it by name passed on, and a withdrawal of a question it did not ask.
        'no-agent-you-can-ask-by-that-name',
        'a-question-asked-of-you-by-name-is-yours',
        'no-open-question-you-asked-by-that-name',
        // ⚑ **D-016 · an ask that names no piece, appended** — several held and none named, or none
        // held at all; `no-open-work-by-that-name` now answers a NAMED piece only.
        'name-the-piece-you-ask-about',
        'no-piece-to-ask-about',
        // ⚑ An answer over the bound, refused before anything is recorded.
        'answer-too-long',
        'move-offer-not-available',
        'move-offer-is-held',
        'move-offer-needs-a-person',
      ])
    })
  })

  /**
   * 🔴 **§7 · the words are durable, which is what `list_questions` needs after a resume.**
   */
  describe('§7 · the question row carries its own words', () => {
    it('⛔ a question this APP raised is found by the same reader a provider-raised one is', async () => {
      const { pm, worker, workerTools, piece } = await aWorkerHoldingWork()
      const asking = startAsking(workerTools, {
        piece,
        question: 'postgres or sqlite?',
        options: ['postgres', 'sqlite'],
      })
      const { requestId } = theQuestionWaitingOn(pm)
      // ⛔ **The store's own reader, which used to see only `user_input_request`.** ⚑ This is the
      // whole reason `437` widened it: without the row the app authors, a parent that resumed would
      // be handed an id it could not act on — `393`'s `list_tasks` gap with the fields swapped.
      const raised = store.questionsRaisedIn(worker)
      expect(raised.get(requestId)?.prompt).toBe('postgres or sqlite?')
      expect(raised.get(requestId)?.questions.map((one) => one.id)).toEqual(['answer'])
      expect(raised.get(requestId)?.questions[0]?.options.map((one) => one.label)).toEqual([
        'postgres',
        'sqlite',
      ])
      // ⚑ **And the piece it is about is on the row** — the first thing in this app that records it.
      const row = ledger(worker).find((event) => event.type === 'question_asked')
      expect(row).toMatchObject({ requestId, piece })
      // ⛔ **The debugger's line states the prompt's LENGTH and never its text**, which is a ruling
      // the docblock made and nothing asserted until this line (found by this dispatch's own
      // review). ⚠️ A stream that pasted a model's words into its own index becomes unreadable
      // exactly when a conversation is busy.
      const described = describeEvent(row as TranscriptEvent)
      expect(described).not.toContain('postgres or sqlite?')
      expect(described).toContain(`${'postgres or sqlite?'.length} chars`)
      expect(described).toContain(piece)
      void asking
    })
  })
})
