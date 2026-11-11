import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import { type AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { REQUEST_IS_OPEN } from '../src/shared/questions'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { ToolWatchingResumeRuntime as ToolWatchingRuntime } from './lib/provider-double'
import { syntheticProviderHome, fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'

/**
 * 🔴 **608 · the turn that no longer waits** — `HO-084` §4 (B1), held behind `603` by `HO-085` §4.
 *
 * ## ⛔ The property
 *
 * > ⚑ **`ask_parent` returns as soon as the question is recorded and routed. The worker's turn
 * > ends. The answer reaches it later, as a turn.**
 *
 * ## 🔴 Why the hold existed, and why `603` is what let it go
 *
 * ⚠️ **`437` parked the worker's tool call for five minutes**, and the argument was written down
 * rather than omitted: *"A verb that returned immediately would end the turn, and the fold would
 * then say `stalled` with `turn_ended`: 'its turn ended and it replied nothing', which is FALSE of
 * a worker that asked."* ⛔ **The hold bought one thing** — it kept the fold from lying — and
 * `591` re-derived that rather than assuming it.
 *
 * ⚑ **`603` built the word the fold was missing**: `TaskState.asking`, `true` in `TASK_IS_OPEN`,
 * composed above both folds by `composeWaitingOnAnAnswer`. 🔴 **So the false sentence is answered
 * by what every surface READS**, and `HO-084` §4 said what follows: *"a task now has a condition
 * distinct from its lifecycle, so the blocking goes."*
 *
 * ⚠️ **And the hold never covered the whole case.** The five-minute bound ended the CALL and —
 * since `591` — left the QUESTION open, so a turn already ended underneath an answerable question.
 * ⛔ **This dispatch removed a DELAY in front of a case that already happened.**
 *
 * ## 🔴 §2 is the risk, and it was measured BEFORE the hold came off
 *
 * ⛔ **If a message did not wake a conversation whose turn had ended, every question asked after
 * this dispatch would be silently stranded** — the row would read `asking`, the answer would be
 * delivered, and nobody would ever read it. ⚠️ **That is a worse product than the hold.**
 * ⚑ A test that asserted `deliverAnswer` had been CALLED would not have said so
 * (`prove-a-field-is-read-with-a-type-error`, `assert-in-the-gap-not-after-the-repair`), so §2
 * follows the words all the way into a `user_turn` in the worker's own ledger.
 *
 * ## ⚠️ What this suite does NOT claim
 *
 * ⛔ **It does not measure a clock**, because there is no longer one to measure: every bound this
 * dispatch touched was removed rather than shortened, and §4 is where that is asserted.
 *
 * ⛔ **And it does not re-measure `603`.** The whole composition property is
 * `waiting-on-an-answer-is-not-stalled.test.ts`; §3 here asserts only the half `608` made
 * ordinary — that the turn really does end, and that the surfaces say so anyway.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
describe('608 · the turn that no longer waits', () => {
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
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-608-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-608-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 8_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
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
   * ⛔ **Every way words can reach a conversation, read as ONE population** (591's reader). ⚠️
   * `queueMessage` SENDS when the receiver is idle and HOLDS when it is busy, so a reader that
   * asked only for `user_turn` would report *the answer never arrived* about one in a mailbox.
   */
  const wordsIn = (sessionId: string): readonly { type: string; text: string }[] =>
    ledger(sessionId).filter(
      (event): event is TranscriptEvent & { type: 'user_turn' | 'message_queued'; text: string } =>
        event.type === 'user_turn' || event.type === 'message_queued',
    )

  const openRequestOf = (sessionId: string): { requestId: string; state: string } => {
    const row = store
      .routedRequestsOf(sessionId)
      .filter((one) => one.went.is === 'the-parent')
      .at(-1)
    if (row === undefined) throw new Error(`no routed question in ${sessionId}`)
    return row
  }

  /**
   * ⚑ A PM in a window, and a worker holding one piece of work it gave through the door.
   *
   * ⚑ **D-016 · the give starts the worker and hands the work over in one act**: its brief is the
   * worker's first turn, which parks on the Fake's card (the PM is in `ask`, and a give runs in its
   * giver's mode) — where a spawn started it idle and a `work` message opened the task.
   */
  const aWorkerHoldingWork = async (): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerTools: AgentToolset
    piece: string
  }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The schema',
      brief: 'migrate the schema',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerTools = theToolsetJustHandedOut()
    const open = store.openPiecesOf(worker).find((one) => one.piece === given.piece)
    if (open === undefined) throw new Error('the give never wrote its piece')
    await waitFor(
      () => ledger(worker).some((event) => event.type === 'permission_request'),
      'the brief’s turn to park on its card',
    )
    return { pm, worker, pmTools, workerTools, piece: open.piece }
  }

  /**
   * ⛔ **Let the worker's parked turn finish, so its conversation goes IDLE.**
   *
   * ⚠️ **The double parks every turn on a permission card**, which is how a receiver is made busy.
   * ⚑ Answering the card is what ends the turn — and an ended turn is the state this whole
   * dispatch creates and §2 is written against.
   */
  const letTheTurnEnd = async (worker: string): Promise<RecordingSink> => {
    const card = ledger(worker)
      .filter(
        (event): event is TranscriptEvent & { type: 'permission_request'; id: string } =>
          event.type === 'permission_request',
      )
      .at(-1)
    if (card === undefined) throw new Error('the worker is not parked on anything')
    // ⚠️ **ONE claim per conversation, and the surface is handed back** — a second
    // `claimSession` with a different window is refused *this conversation is already open in
    // another window*, which is `418`'s rail and not something to work around.
    const surface = new RecordingSink('webContents:7')
    host.claimSession(worker, surface)
    await host.respondPermission(worker, card.id, { outcome: 'allow' }, surface)
    return surface
  }

  /**
   * 🔴 **Has this promise settled after a real macrotask tick?** — `437`'s helper, kept because the
   * claim it serves inverted rather than disappeared.
   *
   * ⚑ **The margin is derived and is not a claim about the machine** (standing rule 22): a verb
   * that writes three rows and returns takes microtasks, and 50 ms is three orders of magnitude
   * more than it needs. ⛔ Before `608` the same promise was pending for five minutes.
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

  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **§1 · the call comes back, and `394`'s three writes are all there when it does.**
   */
  describe('§1 · the call returns as soon as the question is recorded and routed', () => {
    it('⛔ it SETTLES, where `437` left it pending for the whole bound', async () => {
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      const asking = callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'postgres or sqlite?',
        options: ['postgres', 'sqlite'],
      })
      // ⚑ **The positive control for the instrument**, without which *"it settled"* means nothing:
      // a promise that really is pending is reported pending by this same helper.
      expect(await settledYet(new Promise(() => {}))).toBe(false)
      expect(await settledYet(asking)).toBe(true)
      const said = await asking
      expect(said.outcome, JSON.stringify(said)).toBe('ok')

      // ⛔ **All three durable writes are already there.** ⚑ `394`'s ruling is what makes a
      // question answerable at all, and none of it depended on anybody waiting behind it — which
      // is why removing the wait costs the durability nothing.
      const events = ledger(worker)
      expect(events.some((one) => one.type === 'question_asked')).toBe(true)
      const routed = store.routedRequestsOf(worker).filter((one) => one.went.is === 'the-parent')
      expect(routed).toHaveLength(1)
      expect(REQUEST_IS_OPEN[routed[0]?.state ?? 'answered']).toBe(true)
      expect(routed[0]?.requestId).toBe(said.question)
    })

    it('⛔ the payload is the id, and nothing that described a wait', async () => {
      const { workerTools, piece } = await aWorkerHoldingWork()
      const tool = workerTools.tools.find((one) => one.name === 'ask_question')
      if (tool === undefined) throw new Error('no ask_question')
      const said = await tool.call({
        piece,
        question: 'which one?',
        who_answers: 'the-parent',
      })
      const payload = said.structured as Record<string, unknown>
      // ⚑ **611 · a THIRD key** — where the question went, which is the one thing this call's
      // outcome varies in since `HO-088` §2. ⛔ It is the caller's own declaration copied back, so
      // it differs between two calls rather than being the constant this test's subject removed.
      expect(Object.keys(payload).sort()).toEqual(['outcome', 'question', 'went_to'])
      // ⛔ **`answered`, `waitedForMs` and `question_is` are GONE rather than constant.** ⚑ All
      // three reported what a five-minute race had met; with no race, `answered` could only be
      // `null`, `waitedForMs` a few ticks of the caller's own dispatch, and the ledger read behind
      // `question_is` only `open` — `a-positive-assertion-must-differ-from-the-default`.
      for (const dead of ['answered', 'answers', 'waitedForMs', 'question_is']) {
        expect(payload[dead], `${dead} came back as a constant`).toBeUndefined()
      }
      // 🔴 **591's clause is kept WORD FOR WORD, and it is load-bearing now rather than a
      // consolation**: before `608` it said an answer could still arrive after an expiry; after
      // `608` it is the only way an answer ever arrives.
      expect(said.text).toContain('reaches you as a message rather than as this call')
      expect(said.text).toContain('still theirs to answer')
      // ⛔ **And it does NOT promise the work is still open**, which is `437`'s own review finding:
      // a parent can withdraw the work at any moment, so a sentence about the world is a sentence
      // that can be false by the time the model reads it.
      expect(said.text).not.toContain('the work is still yours')
    })

    /**
     * 🔴 **612 · this asserted the ARM and the arm is GONE** (HO-088 §3.1, standing rule 26).
     *
     * ⛔ **It read: *the ask ARMS the escalation, which is now the last mechanism that tells a
     * PERSON*** — measured through the armed timer rather than by driving the sweep, because
     * *"a mutation deleting the arm SURVIVED that whole suite"*. ⚑ **`608`'s own sentence said the
     * escalation was *the only thing left that gets a person told*, and it was true for two
     * dispatches**: `611` built `pass_question_up`, and `612` took the clock.
     *
     * ⚠️ **What it was FOR is unchanged and is asserted the same way** — end to end, through the
     * real arm, with nothing in the test driving a sweep: a question a parent will not answer
     * still reaches a person. 🔴 **What moved is that the last step is an ACT.**
     */
    it('🔴 the ask reaches a PERSON when the parent says so, with no clock in between', async () => {
      const { pm, worker, workerTools, piece } = await aWorkerHoldingWork()
      expect(host.questionsForAPerson().rows).toEqual([])
      const said = await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which?',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')

      // ⛔ **The NEGATIVE first, in real time**: the ledger clock and a wall-clock wait both pass
      // and nothing happens on its own. ⚠️ Bounded (rule 13) and derived (rule 22): 120 ms is
      // three times the 40 ms window this suite used to arm, so a surviving timer would have
      // fired three times over.
      clock += 30_000_000
      await new Promise((resolve) => setTimeout(resolve, 120))
      expect(host.questionsForAPerson().rows).toEqual([])
      expect(ledger(worker).some((event) => event.type === 'request_escalated')).toBe(false)

      // ⚑ **And the ACT, which is what carries it now.**
      const passed = await callOn(agentToolsFor(host, pm), 'pass_question_up', {
        question: said.question,
        who_answers: 'a-person',
      })
      expect(passed.outcome, JSON.stringify(passed)).toBe('ok')
      expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toEqual([
        passed.question,
      ])
      // ⛔ **Still no escalation row anywhere**, which is the whole of `HO-088` §3.1.
      expect(ledger(pm).some((event) => event.type === 'request_escalated')).toBe(false)
    })
  })

  /**
   * 🔴 **§2 · THE RISK, and the reason this dispatch was allowed to land.**
   *
   * > ⛔ **Does a message to a conversation whose turn has ENDED actually start a new turn?**
   *
   * ⚑ **Measured on the UNMODIFIED build before the hold came off** — `queueMessage` SENDS to an
   * idle conversation and HOLDS for a busy one, and an ended turn is idle. ⚠️ **The observable
   * difference is the ledger**: the sent path writes a `user_turn`, the held path writes a
   * `message_queued` first, so a test that saw no `message_queued` saw the send.
   */
  describe('§2 · the answer reaches a worker whose turn has ENDED, as a turn', () => {
    it('⛔ the parent answers, and the worker takes a NEW turn carrying the words', async () => {
      const { pm, worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      const said = await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which schema?',
        options: ['a', 'b'],
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')

      // 🔴 **The hazard, put on the path the code walks**: the turn ENDS before anybody answers.
      // ⚠️ Not a session that happened to still be running.
      await letTheTurnEnd(worker)
      const before = ledger(worker).length

      const asked = openRequestOf(worker)
      const late = await callOn(pmTools, 'answer_question', {
        question: asked.requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
      })
      expect(late.outcome, JSON.stringify(late)).toBe('ok')

      await waitFor(
        () =>
          ledger(worker)
            .slice(before)
            .some((event) => event.type === 'user_turn' && event.text.includes('answer: b')),
        'the answer arriving as a turn in a conversation whose turn had ended',
      )
      // ⛔ **SENT and not HELD** — a `message_queued` row here would mean the conversation was
      // still busy and the turn had not really ended, and every assertion above it would be
      // measuring the case this dispatch is NOT about.
      expect(
        ledger(worker)
          .slice(before)
          .filter((event) => event.type === 'message_queued'),
      ).toEqual([])
      // ⚑ **And it quotes the question back**, because the turn that asked it may be hours gone.
      const arrived = wordsIn(worker).at(-1)
      expect(arrived?.text).toContain('which schema?')
      // ⚑ **And it names who answered** — by the piece that conversation owns (D-016 · commit 7 ·
      // R3), where it used to print the id.
      expect(arrived?.text).toContain(`${host.nameByItsWork(pm)} answered the question you asked`)

      // 🔴 **The worker ACTED on it** — the provider took the turn and produced a message of its
      // own, which is *reaches the agent* rather than *was written into a ledger*.
      await waitFor(
        () =>
          ledger(worker)
            .slice(before)
            .some((event) => event.type === 'assistant_message'),
        'the worker taking the turn it was handed',
      )
      // ⚠️ **And it opened NO work.** ⚑ D-016: only a give writes a piece, so the answer never
      // becomes a second piece the worker owes a reply to.
      expect(
        store
          .piecesOwnedBy(worker)
          .filter((one) => TASK_IS_OPEN[one.state])
          .map((one) => one.piece),
      ).toEqual([piece])
    })

    it('⛔ a PERSON answering an ENDED turn reaches it the same way — the last step of the chain', async () => {
      // ⛔ **`437`'s bound was derived from *ask → escalate → a person is told → the person
      // answers*.** ⚑ `608` removed the bound and not the chain, and this is its last step meeting
      // the state `608` made ordinary.
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      const said = await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which?',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      // ⚑ **The window that ended the turn is the window the person answers from**, which is the
      // ordinary shape: a person is looking at the conversation they are answering about.
      const surface = await letTheTurnEnd(worker)
      const before = ledger(worker).length
      const asked = openRequestOf(worker)
      const ack = await host.respondUserInput(
        worker,
        asked.requestId,
        { kind: 'answer', answers: { answer: ['the person decided'] } },
        surface,
      )
      expect(ack.outcome, JSON.stringify(ack)).toBe('taken')
      await waitFor(
        () =>
          ledger(worker)
            .slice(before)
            .some(
              (event) => event.type === 'user_turn' && event.text.includes('the person decided'),
            ),
        'the person’s answer waking the worker',
      )
      // ⚑ **`null` for the answerer is a PERSON and is not the string.**
      expect(wordsIn(worker).at(-1)?.text).toContain('A person answered')
    })

    it('⚑ THE CONTROL · a BUSY worker is HELD and reads it at the turn boundary', async () => {
      // ⛔ **The two readings, where they diverge** (standing rule 3): one answer, one question,
      // and the only difference is whether the receiver's turn has ended. ⚠️ Without this arm the
      // assertion above would be *no message_queued* over a build that queues nothing at all.
      const { worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      const said = await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which?',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      const asked = openRequestOf(worker)
      const answered = await callOn(pmTools, 'answer_question', {
        question: asked.requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      await waitFor(
        () => ledger(worker).some((one) => one.type === 'message_queued'),
        'the answer being HELD for a busy worker',
      )
      // ⚑ **A notice and never work** — a message that opened work to a busy child would have been
      // the wrong kind of row for an answer, exactly when the worker has most going on.
      const held = ledger(worker).filter(
        (one): one is TranscriptEvent & { type: 'message_queued'; kind?: string; text: string } =>
          one.type === 'message_queued',
      )
      expect(held.at(-1)?.kind).toBe('notice')
      // 🔴 **And it becomes a turn at the boundary**, which is the same destination by another
      // route — so *the answer reaches the agent* holds in both states rather than in one.
      await letTheTurnEnd(worker)
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'user_turn' && event.text.includes('answer: b'),
          ),
        'the notice flushing into a turn',
      )
    })
  })

  /**
   * 🔴 **§3 · the word that replaced the hold, measured on the turn ENDING.**
   *
   * ⛔ **`603` proved the composition; this proves the case it was built for.** ⚠️ `437` predicted
   * exactly what the fold would say the moment a verb returned, and it says it — so the whole of
   * what stands between a parent and *its turn ended and it replied nothing* is the composition.
   */
  describe('§3 · the fold says `turn_ended` and every surface says `asking`', () => {
    it('⛔ the worker asks, its turn ends, and the raw fold stalls it exactly as `437` predicted', async () => {
      const { pm, worker, workerTools, piece } = await aWorkerHoldingWork()
      await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which schema?',
      })
      await letTheTurnEnd(worker)
      await waitFor(
        () => store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.state === 'stalled',
        'the fold stalling the piece when the turn ended',
      )
      // 🔴 **`437`'s sentence, made true by this dispatch** — and it is the raw fold's, not a
      // surface's.
      const raw = store.piecesOwnedBy(worker).find((one) => one.piece === piece)
      expect(raw?.state).toBe('stalled')
      expect(raw?.stalledBecause).toBe('turn_ended')

      // ⛔ **And nobody is ever shown that.** ⚑ The worker's own board and the parent's board both
      // resolve through `composeWhatEachPieceIsWaitingOn` (`609`'s name for it, re-keyed by D-016).
      expect(host.pieceBoard(worker).hold.find((one) => one.piece === piece)?.state).toBe(
        'waiting-on-an-answer',
      )
      const assigned = host.pieceBoard(pm).gave.find((one) => one.piece === piece)
      expect(assigned?.state).toBe('waiting-on-an-answer')
      // ⚑ **The invariant holds through the composition**: `stalledBecause` is non-null if and
      // only if the state is `stalled`, which is what keeps a stall NOTICE from being owed.
      expect(assigned?.stalledBecause).toBeNull()
    })

    it('⛔ and the parent is never PUSHED *its turn ended and it replied nothing*', async () => {
      // 🔴 **`HO-019` §1's defect with a message attached.** ⚠️ `tellIfNobodyHasYet` seeds a
      // de-duplicator, so a parent told once is not told again — `661` sets right only a notice
      // that the conversation had ENDED — which is why the composition has to reach the notice
      // reader and not only the list.
      const { pm, worker, workerTools, piece } = await aWorkerHoldingWork()
      await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which schema?',
      })
      await letTheTurnEnd(worker)
      await waitFor(
        () => store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.state === 'stalled',
        'the fold stalling the piece when the turn ended',
      )
      expect(
        wordsIn(pm).filter((one) => one.text.includes('its turn ended and it replied nothing')),
      ).toEqual([])
    })
  })

  /**
   * 🔴 **§6 · what still ends a question — HO-082 §2.2's table, unchanged by this dispatch.**
   *
   * ⛔ **`608` removed the last clock in this mechanism.** ⚑ Every ending below is an EVENT this
   * app watched happen, which is what `591` ruled and what `REQUEST_IS_OPEN` is keyed by.
   */
  describe('§6 · the endings, and elapsed time is still not one of them', () => {
    it('⛔ a withdrawal ends it, an interruption ends it, and a clock does not', async () => {
      const { worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which schema?',
      })
      const asked = openRequestOf(worker)
      // ⚠️ **The clock is MOVED, never slept on** — standing rule 22, and with the bound gone this
      // is the assertion that says nothing watches it.
      clock += 300_000 * 10
      expect(
        store.routedRequestsOf(worker).find((one) => one.requestId === asked.requestId)?.state,
      ).toBe('open')

      // ⚑ **D-016 · a piece is taken back by naming it** — the piece says whose it is.
      const took = await callOn(pmTools, 'withdraw_task', { piece })
      expect(took.outcome, JSON.stringify(took)).toBe('ok')
      expect(took.endedQuestions).toBe(1)
      expect(
        store.routedRequestsOf(worker).find((one) => one.requestId === asked.requestId)?.state,
      ).toBe('work-withdrawn')
    })

    it('⛔ an interruption writes the ending, and delivers no words doing it', async () => {
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which schema?',
      })
      const before = ledger(worker).length
      const surface = new RecordingSink('webContents:8')
      host.claimSession(worker, surface)
      await host.interrupt(worker, surface)
      expect(openRequestOf(worker).state).toBe('interrupted')
      // ⛔ **An ending is a ROW.** ⚑ A released call used to hand the worker *nobody answered*;
      // the words a worker gets are answers, and nobody decided anything here.
      expect(
        ledger(worker)
          .slice(before)
          .filter((event) => event.type === 'user_turn' || event.type === 'message_queued'),
      ).toEqual([])
    })
  })
})
