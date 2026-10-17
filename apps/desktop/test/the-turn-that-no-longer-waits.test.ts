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
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { REQUEST_IS_OPEN } from '../src/shared/questions'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

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
const srcRoot = join(here, '../src')

// ⛔ **612 · `ESCALATE` stood here and is GONE** (HO-088 §3.1) — *"shorter than anything a question
// could need, because nothing here waits on it"*. ⚑ Nothing waits on it anywhere now.

/**
 * ⛔ **CODE only** — `a-source-census-must-strip-prose-before-it-asserts`. ⚠️ Every negative in §4
 * is about what the app DOES, and this file's own history sections quote the names they removed.
 */
const codeOf = (file: string): string =>
  readFileSync(join(srcRoot, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

/** ⚑ **PROSE with its wrapping removed**, because prettier re-wraps a docblock sentence freely. */
const proseOf = (file: string): string =>
  readFileSync(join(srcRoot, file), 'utf8')
    .replace(/\n\s*\*\s?/g, ' ')
    .replace(/\s+/g, ' ')

/**
 * ⚠️ **A function BODY, so an absence is about that function and not about the file** — `437`'s
 * helper, and this suite needs it for the same measured reason: a file-wide negative would fire on
 * a sibling declaration (`441`'s `decideProposal` did until D-016 took it out; `slot.settle()`
 * does).
 */
const bodyOf = (source: string, signature: string, closes = '\n  }'): string => {
  const from = source.indexOf(signature)
  if (from === -1) throw new Error(`no such declaration: ${signature}`)
  const to = source.indexOf(closes, from)
  if (to === -1) throw new Error(`unterminated declaration: ${signature}`)
  return source.slice(from, to)
}

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
   * 🔴 **§4 · what went, asserted against the code rather than against a memory of it.**
   *
   * ⛔ **Every name below described the WAIT**, and standing rule 19's corollary is why they moved
   * in this commit: a number can survive the death of its derivation, and so can a field.
   */
  describe('§4 · the bound, the flag and the three constants are gone', () => {
    it('⛔ `raiseAQuestion` has no await, no timer and no promise in its body', () => {
      const ask = bodyOf(codeOf('main/runtime/runtime-host.ts'), 'async raiseAQuestion(')
      const body = ask.slice(ask.indexOf('): Promise<AskOutcome> {'))
      expect(body.length, 'the slice found no raiseAQuestion body').toBeGreaterThan(400)
      // ⚠️ **Keyed on the SHAPE of a wait and not on the spelling `437` happened to use** — a
      // negative keyed on a literal is a negative keyed on somebody's imagination
      // (`a-negative-is-only-as-strong-as-the-search-shape`).
      expect(body).not.toContain('await ')
      expect(body).not.toContain('setTimeout')
      expect(body).not.toContain('new Promise')
      expect(body).not.toContain('Promise.race')
      // ⚑ **The positive control**: the slice really is the verb, and the verb really does write
      // the three durable things `394` ruled it owes.
      expect(body).toContain("type: 'question_asked'")
      expect(body).toContain("type: 'request_routed'")
      expect(body).toContain('this.deliverQuestion(')
    })

    it('⛔ the bound is gone from every layer it lived in, and its sibling is untouched', () => {
      const questions = codeOf('shared/questions.ts')
      const hostCode = codeOf('main/runtime/runtime-host.ts')
      const tools = codeOf('main/runtime/agent-tools.ts')
      // ⛔ **The constant, the dep, the field and the advertised sentence.**
      expect(questions).not.toContain('ASK_BOUND_MS')
      expect(hostCode).not.toContain('ASK_BOUND_MS')
      expect(hostCode).not.toContain('askBoundMs')
      expect(tools).not.toContain('ASK_BOUND_MS')
      // ⚠️ **612 pointed the control at the escalation window and `616` removed THAT one too**
      // (HO-088 §3.1, HO-093 §2, standing rule 26). ⛔ **A positive control has to be a thing that
      // exists**, and there is no window of this kind left anywhere — so it is re-pointed at a
      // number this class still resolves that is NOT a deadline on somebody answering: the drain
      // it gives its own provider at teardown. ⚑ That is the distinction all three removals were
      // about, so the control carries the rule rather than just proving the file is readable.
      expect(questions).toContain('export function aPersonsSince(')
      expect(hostCode).toContain('deps.closeDrainTimeoutMs ?? DEFAULT_CLOSE_DRAIN_TIMEOUT_MS')
      // ⚑ **And `612`'s and `616`'s negatives ride here**, because it is the same four layers:
      // three waits on somebody answering, and none of them left.
      expect(questions).not.toContain('export const ESCALATION_WINDOW_MS')
      expect(hostCode).not.toContain('escalationWindowMs')
      expect(hostCode).not.toContain('PROPOSAL_BOUND_MS')
      expect(hostCode).not.toContain('proposalBoundMs')
    })

    it('⛔ the flag and the promise are gone from the map, and both answer doors take ONE route', () => {
      const hostCode = codeOf('main/runtime/runtime-host.ts')
      // 🔴 **A flag that can only be false is not a fact, and a branch behind it is a trap**:
      // `held.settle(said)` would have gone on compiling and would have DROPPED the answer the day
      // somebody set it again — a worker told nothing, with every state assertion passing.
      expect(hostCode).not.toContain('aTurnIsWaiting')
      expect(bodyOf(hostCode, 'async answerQuestion(')).not.toContain('.settle(')
      expect(bodyOf(hostCode, 'async respondUserInput(')).not.toContain('.settle(')
      expect(bodyOf(hostCode, 'private async aPersonAnswersAQuestionThisAppAsked(')).not.toContain(
        '.settle(',
      )
      // ⚑ **D-017 · R6 — ONE route at each door still, and it is awaited now** (the door says
      // whether the asker's start happened); the person's door hands a question this app asked to
      // one function, and the route is in there.
      expect(bodyOf(hostCode, 'async answerQuestion(')).toContain(
        'const told = this.deliverAnswer(held, request.requestId, speaking, said, null, null, stopAs)',
      )
      expect(bodyOf(hostCode, 'async respondUserInput(')).toContain(
        'return await this.aPersonAnswersAQuestionThisAppAsked(',
      )
      expect(bodyOf(hostCode, 'private async aPersonAnswersAQuestionThisAppAsked(')).toContain(
        'const delivered = this.deliverAnswer(asked, requestId, null, said, null, theSurfaceAsking(by))',
      )
      // ⛔ **And the two release loops went with the promise they settled.** ⚑ D-017 · R6: so did
      // the map itself — `questionsThisAppHolds` is gone, and neither loop reads a map of words.
      // ⚑ **D-016 · the first loop is `takeBackPiece` now** — `endTheQuestionsAbout` was merged
      // into the one take-back path, which ends a piece's questions by writing `work_taken_back`.
      expect(bodyOf(hostCode, 'async takeBackPiece(')).not.toContain('questionsThisAppHolds')
      expect(bodyOf(hostCode, 'private askTheWorkToStop(')).not.toContain('questionsThisAppHolds')
      // ⚑ **The positive control**: what a late answer is routed through is still here and still
      // read at both doors — ⚑ D-017 · R6: the asker's LEDGER (`theWordsOf`), which replaced the
      // map; the negatives above are about the removed fields and the removed map, not about it.
      expect(hostCode).not.toContain('questionsThisAppHolds')
      expect(bodyOf(hostCode, 'async answerQuestion(')).toContain(
        'this.theWordsOf(request.askedBy, request.requestId)',
      )
      expect(bodyOf(hostCode, 'async respondUserInput(')).toContain(
        'this.theWordsOf(sessionId, requestId)',
      )
      // ⚠️ **`441`'s proposal doors were once the control here, then two more body-scoped
      // negatives** (615, 616); ⛔ D-016 took both doors out with proposals. ⚑ The negatives stay
      // BODY-SCOPED — a file-wide one would fire on `slot.settle()`, which is a launch reservation
      // and has nothing to do with an answer
      // (`a-file-level-contains-cannot-tell-sibling-declarations-apart`).
      // ⚑ **THE POSITIVE CONTROL for the three `.settle(` negatives** — the reader finds the one this
      // app still has, so *no door settles an answer* is a measurement rather than a string that
      // appears nowhere in this file (standing rule 34.2).
      expect(hostCode).toContain('slot.settle()')
    })

    it('⛔ the three fields that described the wait, and the two readers that produced them', () => {
      const rails = codeOf('main/runtime/question-rails.ts')
      const hostCode = codeOf('main/runtime/runtime-host.ts')
      const tools = codeOf('main/runtime/agent-tools.ts')
      for (const dead of ['waitedForMs', 'questionIs']) {
        expect(rails, `${dead} is still on AskOutcome`).not.toContain(dead)
      }
      expect(hostCode).not.toContain('whatBecameOfTheQuestion')
      expect(tools).not.toContain('stillTheirs')
      // ⛔ **`parent` went with them, and it is the one removal `608` did not cause**: `437`
      // returned the conversation that was asked and nothing ever read it — found reviewing this
      // dispatch's own diff. ⚑ Removed rather than surfaced, because putting a parent's session id
      // into a payload a worker reads is a DISCLOSURE (`433`; `437` §2 measures that `list_agents`
      // does not name the parent) and that is a product decision, not a side effect.
      expect(rails).not.toContain('readonly parent: string')
      // ⚑ **The positive control for five negatives**: `AskOutcome` is still the returned union
      // `341` ruled for, and it still names the one fact a caller can act on.
      expect(rails).toContain('export type AskOutcome =')
      expect(rails).toContain('readonly question: string')
      // ⚑ **And `REQUEST_IS_OPEN` is still what decides whether a question has ended**, which is
      // where *still theirs to answer* lives now that no call reports it.
      expect(rails).toContain('REQUEST_IS_OPEN')
    })
  })

  /**
   * 🔴 **§5 · the prose sweep, and standing rule 8.1 says to name BOTH audiences.**
   *
   * ⛔ **Doing one well is how the other is missed** — measured on `591`, whose sweep repaired
   * every sentence a MODEL reads and left `proposal-offer.ts`'s sentence to a PERSON saying the
   * exact negation of its own commit's first line.
   */
  describe('§5 · the sentences that went false with the behaviour', () => {
    it("⛔ the MODEL's: `ask_parent` no longer says it waits, and says where the answer goes", () => {
      // ⛔ **The advertised STRING and not the region around it** — this file's own docblock
      // quotes the clause it removed, on purpose (`498`: a sentence deleted without its history
      // comes back), so a slice that swept up the prose would go red on the history it kept.
      // ⚠️ `a-source-census-must-strip-prose-before-it-asserts`, met head-on.
      const tools = readFileSync(join(srcRoot, 'main/runtime/agent-tools.ts'), 'utf8')
      // ⚠️ **611 · the opening clause moved with the ruling** (HO-088 §2, standing rule 26). ⛔ It
      // read *"Ask the conversation that gave you a piece of work for a decision"*, which named
      // the recipient in the sentence; the recipient is `who_answers` now, so the sentence asks
      // for a decision and says to name who answers. ⚑ **What this test is FOR is unchanged** —
      // the wait clause — and all four assertions below still measure it.
      // ⚑ **D-009 · the opening clause moved again** (F012): a question may go to an agent by name,
      // about no work at all. ⚑ What this test is FOR — the wait clause — is unchanged.
      const from = tools.indexOf("description:\n        'Ask a question and get the answer back")
      expect(from, 'ask_question no longer advertises a description this shape').toBeGreaterThan(0)
      const sentence = tools.slice(from, tools.indexOf("',\n", from))
      expect(sentence).toContain('This call does not wait')
      expect(sentence).toContain('reaches you later as a message')
      // ⛔ **The clause that was there and is gone**, quoted as it stood.
      expect(sentence).not.toContain('and wait for the answer')
      // ⚑ **And the work claim is unchanged**, because `ask_parent` still keeps the work.
      // ⚑ **D-009 · *any* work**, because a question to an agent may be about none.
      expect(sentence).toContain('Any work stays yours and stays open')
    })

    it("⛔ the MODEL's second: the line every work message carries no longer INSTRUCTS a wait", () => {
      // 🔴 **This is the worse of the two, because it is an INSTRUCTION rather than a
      // description** — `HO-070` §3: a stale sentence about a MECHANISM is an agent that stops
      // asking. ⚠️ A model told to wait on a call that has already returned is being told to do
      // something this app no longer lets it do.
      const rails = readFileSync(join(srcRoot, 'main/runtime/reply-rails.ts'), 'utf8')
      const line = rails.slice(rails.indexOf('const line ='), rails.indexOf('return text.trim()'))
      // ⚑ **611 · the verb is named and so is its argument** — see `reply-rails.ts`: a line naming
      // the verb without `who_answers` would walk a model into a `malformed-request`. ⚑ D-016: the
      // piece is named by its label, where it was the same `task_id`.
      expect(line).toContain('call ask_question with piece ${label} and')
      expect(line).toContain('who_answers')
      expect(line).not.toContain('wait for the answer')
      // ⚑ **And the clause that still INSTRUCTS is kept** — which tool keeps the work and which
      // hands it back is the one thing a model cannot infer from the others it has.
      expect(line).toContain('that keeps the work yours, where reply_to_parent hands it back')
    })

    it('⛔ the exemption a routed question has is no longer justified by *the asker is blocked*', () => {
      // ⚠️ **`394` gave the reason as *a question cannot be dropped on the floor — the conversation
      // that asked it is BLOCKED until somebody answers*.** ⛔ That is now true of a
      // PROVIDER-raised question only; an `ask_parent` question blocks nobody, and the exemption
      // survives for a different reason on that side.
      const ipc = proseOf('shared/runtime-ipc.ts')
      expect(ipc).toContain('question no longer blocks anybody')
      // ⚑ **D-010 · the host half went with the exemption itself**: every message is held now, so
      // the rail whose note gave the reason is retired, and there is no exemption left to justify.
    })

    it("⚑ the PERSON's side: nothing a person reads described the hold, with the control that found it", () => {
      // 🔴 **Standing rule 8.1 wants BOTH counts reported, including *I found none on this
      // side*.** ⛔ A sweep scoped to the prose an agent reads passes its own review, because that
      // is the prose the dispatch was already holding open.
      //
      // ⚑ **Derived from the modules a PERSON's words come out of**, and the search is for the
      // CLAIM rather than for a file: a surface that told somebody an agent was waiting inside a
      // call would have had to say so.
      const personsModules = [
        'renderer/src/lib/work-report.ts',
        'shared/work-state-words.ts',
        'renderer/src/lib/persons-queue.ts',
        'renderer/src/lib/home-attention.ts',
        'renderer/src/lib/agent-state.ts',
      ]
      const held =
        /(inside|within) its (ask|call)|holds? (its|the) turn open|waiting for the answer/i
      for (const file of personsModules) {
        expect(readFileSync(join(srcRoot, file), 'utf8'), `${file} describes the hold`).not.toMatch(
          held,
        )
      }
      // ⚑ **THE CONTROL, and it is what makes the four negatives above worth reading** (standing
      // rule 34.2): the same pattern finds the sentence that DID describe the hold, in this
      // suite's own words — so a pattern that had stopped matching anything would be visible here.
      expect('⚠️ It holds the turn open for up to five minutes').toMatch(held)
      // ⚑ **And the one word a person DOES read about this is `603`'s**, which `608` did not move
      // and `609` did not move either — ⚠️ **609 re-aimed the KEY and not the word**, which is the
      // whole point of quoting the value here rather than the line.
      expect(codeOf('renderer/src/lib/work-report.ts')).toContain(
        "import { WORK_STATE_WORD } from '../../../shared/work-state-words'",
      )
      expect(codeOf('shared/work-state-words.ts')).toContain(
        "'waiting-on-an-answer': 'waiting on an answer'",
      )
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
