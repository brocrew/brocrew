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
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN, TASK_STATES } from '../src/shared/tasks'
import { REQUEST_IS_OPEN, REQUEST_STATES } from '../src/shared/questions'
import type {
  PersistedEventInfo,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **591 · a question does not expire on a clock** — HO-082 §1–§4.1.
 *
 * ## ⚑ The property
 *
 * > ⛔ **A question outlives the turn that asked it. An answer given hours later reaches the agent.
 * > What ends a question is an event — answered, or its work withdrawn or ended — and never
 * > elapsed time.**
 *
 * ## 🔴 What a person hit, because this suite exists for a person and not for a rule
 *
 * A question must remain answerable after it reaches the person. A five-minute `ASK_BOUND_MS`
 * with a thirty-second escalation could leave an `open` ledger row after `raiseAQuestion`
 * stopped waiting without writing an ending; the queue would then count it indefinitely, with
 * only “End conversation” clearing it.
 *
 * ## ⛔ The repair is a DELETION and a WRITE, and they are the same repair from two sides
 *
 *  - 🔴 **The deletion**: the in-memory `waiting` flag was a SECOND ending vocabulary. The queue
 *    folds {@link REQUEST_IS_OPEN}; both answer doors refused on the flag; after the bound the two
 *    disagreed for ever. ⚑ Now the ledger is the only thing that ends a question, which is
 *    `admitAnswer`'s own note — *a rail with its own idea of which states are endings would be free
 *    to disagree with the derivation it guards* — applied to the two places it was not.
 *  - 🔴 **The write**: `withdraw_task` wrote `task_withdrawn` and nothing about the questions raised
 *    under it. ⛔ HO-082 §4.1 — *an explicit ending rather than a render-time filter, so the queue
 *    reads a fact instead of inferring one.* ⚠️ **It became mandatory rather than merely right the
 *    moment a question outlived its turn**: without it, §1's repair would have made a question
 *    answerable for ever about work that no longer exists.
 *
 * ## ⚠️ What this suite does NOT claim
 *
 * ⛔ **It does not measure a clock.** Every bound here is a dependency read at construction, and
 * `§4` moves the wall clock by hand rather than sleeping — standing rule 22: *a bound in
 * milliseconds is a claim about the machine unless the test controls the machine.*
 *
 * ⛔ **And it does not claim `437`'s hold was wrong.** HO-082 §3.1 said that objection was now
 * answerable; `§7` measured the code and found it was NOT, so the hold stayed and only what
 * happens at its end moved.
 *
 * ⚑ **603 · the second half of that sentence has since been BUILT**, and `§7`'s census is re-aimed
 * rather than left standing (see it). ⛔ The hold is still here — removing it is B1, `HO-084` §4,
 * held behind `HO-085` §4 — so nothing this suite measures moved.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

/** ⚑ Short enough that a section which lets a question go unanswered costs milliseconds. */
const BOUND = 150
// ⛔ **612 · `ESCALATE` stood here and is GONE** (HO-088 §3.1). ⚑ It was *"shorter than the bound,
// exactly as it is in production — the ratio `589` measured"*, and it configured a deadline this
// app no longer has. ⚠️ **This file's TITLE is now the app's behaviour rather than its test's**:
// a question does not expire on a clock because there is no clock, not because this one is short.

describe('591 · a question does not expire on a clock', () => {
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
  /** ⚠️ **Read at construction**, so a section that wants a longer bound sets it before `buildHost`. */
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-591-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-591-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
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
   * ⛔ **Every way words can reach a conversation, read as ONE population** (591).
   *
   * ⚠️ **`queueMessage` sends when the receiver is idle and HOLDS when it is busy**, so a reader
   * that asked only for `user_turn` would report *the answer never arrived* about an answer sitting
   * in the mailbox — which is the state a worker that carried on working is always in.
   * ⚑ §1 asserts the flush separately, because *queued* and *read* are two facts.
   */
  const wordsIn = (sessionId: string): readonly { type: string; text: string; kind?: string }[] =>
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

  const stateOfRequest = (sessionId: string, requestId: string): string => {
    const row = store.routedRequestsOf(sessionId).find((one) => one.requestId === requestId)
    if (row === undefined) throw new Error(`no request ${requestId} in ${sessionId}`)
    return row.state
  }

  /**
   * ⚑ A PM in a window, and a worker it gave one piece of work through the door. ⛔ No grant is set
   * for the give (D-014: any agent may give work to any agent). ⚑ **D-016 · the give starts the
   * worker, and its brief is the worker's first turn** — in the PM's `ask` it parks on a card.
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
      title: 'the work this dispatch is about',
      brief: 'migrate the schema',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerTools = theToolsetJustHandedOut()
    const open = store.piecesOwnedBy(worker).find((one) => TASK_IS_OPEN[one.state])
    if (open === undefined) throw new Error('the give never opened a piece')
    return { pm, worker, pmTools, workerTools, piece: open.piece }
  }

  /**
   * ⛔ **Let the worker's parked turn finish**, so the mailbox flushes.
   *
   * ⚠️ **The double parks every turn on a permission card**, which is how a receiver is made busy —
   * so a notice delivered while it is parked is HELD, and only answering the card turns it into a
   * turn the worker reads.
   */
  const letTheWorkerFinish = async (worker: string): Promise<void> => {
    const card = ledger(worker)
      .filter(
        (event): event is TranscriptEvent & { type: 'permission_request'; id: string } =>
          event.type === 'permission_request',
      )
      .at(-1)
    if (card === undefined) throw new Error('the worker is not parked on anything')
    const surface = new RecordingSink('webContents:7')
    host.claimSession(worker, surface)
    await host.respondPermission(worker, card.id, { outcome: 'allow' }, surface)
  }

  /**
   * 🔴 **Has this promise settled after a real macrotask tick?** — `437`'s helper, and this suite
   * needed it for a measured reason.
   *
   * ⛔ **`M13` SURVIVED without it.** The row that stops a withdrawal releasing the worker's held
   * call left the test GREEN and thirty seconds slower: `testTimeout` is 60,000 ms and the bound in
   * force was 30,000, so the suite simply waited the bound out and asserted the same three values.
   * ⚠️ `a-positive-assertion-must-differ-from-the-default` — an assertion satisfied by doing
   * nothing is not an assertion.
   *
   * ⚑ **The margin is derived and is not a claim about the machine** (standing rule 22): the bound
   * in force is 30,000 ms and this waits 50 ms, so a released call has ~600× the room it needs and
   * an unreleased one cannot possibly have arrived. ⛔ A microtask race would measure nothing — a
   * verb that returned immediately still takes several ticks to travel back through `guarded`, the
   * tool's `call` and `callOn`, so the sentinel wins either way.
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

  const sourceOf = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8')

  /**
   * ⛔ **CODE only** — `a-source-census-must-strip-prose-before-it-asserts`, and this suite is the
   * reason it is a rule: §7's first assertion went RED on its own docblock, which quotes the
   * refusal `591` removed so that a sentence deleted without its history cannot come back.
   */
  const codeOf = (dir: string, file: string): string =>
    sourceOf(dir, file)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^[ \t]*\/\/.*$/gm, ' ')

  /**
   * ⚑ **PROSE with its wrapping removed** — a docblock sentence is re-wrapped by `prettier` the
   * moment a word is added above it, so an assertion against the literal line is one edit from
   * measuring nothing.
   */
  const proseOf = (dir: string, file: string): string =>
    sourceOf(dir, file)
      .replace(/\n\s*\*\s?/g, ' ')
      .replace(/\s+/g, ' ')

  /**
   * ⚠️ **A function BODY, so an absence is about that function and not about the file** — `437`'s
   * own helper, and this suite needed it for a measured reason: `441` holds a SECOND map with a
   * `waiting` flag of its own (`proposalsThisAppHolds`), and a file-wide `not.toContain` of
   * `if (!holding.waiting) {` fires on `decideProposal`, which is a different subject and correct
   * as it stands. ⛔ `an-assertion-can-be-satisfied-by-a-neighbouring-element`, caught by its own
   * red.
   */
  const bodyOf = (source: string, signature: string, closes = '\n  }'): string => {
    const from = source.indexOf(signature)
    if (from === -1) throw new Error(`no such declaration: ${signature}`)
    const to = source.indexOf(closes, from)
    if (to === -1) throw new Error(`unterminated declaration: ${signature}`)
    return source.slice(from, to)
  }

  /**
   * 🔴 **§1 · the whole sequence, and the last assertion is the one HO-082 §2 is about.**
   *
   * ⚑ **A worker asks, nobody answers inside the bound, the call returns — and the question is
   * still the parent's to answer.** ⛔ Then the parent answers, and the answer REACHES THE WORKER.
   */
  describe('§1 · an answer given after the bound reaches the agent', () => {
    it('⛔ the call does not wait, the question stays open, and the answer arrives as a turn the worker reads', async () => {
      const { pm, worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      const said = await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which schema?',
        options: ['a', 'b'],
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      // ⛔ **608 · the call carries no answer and no word about one** (HO-084 §4). ⚠️ It used to
      // report `answered: false` and `question_is: 'open'` after a five-minute race; there is no
      // race, so both were constants and both went with it.
      expect(said.answered).toBeUndefined()
      expect(said.question_is).toBeUndefined()

      // 🔴 **The ROW is what says the question is still theirs, and it always was** — HO-082 §2's
      // whole ruling is that the LEDGER ends a question and nothing else does.
      const asked = openRequestOf(worker)
      expect(REQUEST_IS_OPEN[asked.state as (typeof REQUEST_STATES)[number]]).toBe(true)

      // ⛔ **TAKEN, where it used to be refused `question-has-already-ended`.**
      const late = await callOn(pmTools, 'answer_question', {
        question: asked.requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
      })
      expect(late.outcome, JSON.stringify(late)).toBe('ok')
      // ⚑ **The ENDING is written** — HO-082 §4.1's *the queue reads a fact*.
      expect(stateOfRequest(worker, asked.requestId)).toBe('answered')

      // ⚠️ **HELD first, because the worker is busy** — a notice, never work, so the singleton
      // cannot refuse it at the one moment the answer matters most.
      await waitFor(
        () => wordsIn(worker).some((one) => one.text.includes('answer: b')),
        'the answer delivered into the worker',
      )
      const delivered = wordsIn(worker)
        .filter((one) => one.text.includes('answer: b'))
        .at(-1)
      expect(delivered?.type).toBe('message_queued')
      expect(delivered?.kind).toBe('notice')
      // ⚑ **And it quotes the question back**, because the turn that asked it may be hours gone.
      expect(delivered?.text).toContain('which schema?')
      // ⚑ **And it names who answered** — by the piece that conversation owns, as every sentence
      // names another conversation (D-016 · commit 7 · R3), where it used to print the id.
      expect(delivered?.text).toContain(`${host.nameByItsWork(pm)} answered the question you asked`)

      // 🔴 **THE LOAD-BEARING HALF: it becomes a turn the worker actually reads.** ⛔ A notice that
      // only ever sat in a mailbox would be *reaches the agent* asserted about a queue.
      await letTheWorkerFinish(worker)
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'user_turn' && event.text.includes('answer: b'),
          ),
        'the notice flushing into a turn',
      )

      // ⚠️ **And it opened NO work.** The app is not an agent, and a notice gives no piece — only a
      // give does (D-016).
      expect(
        store
          .piecesOwnedBy(worker)
          .filter((one) => TASK_IS_OPEN[one.state])
          .map((one) => one.piece),
      ).toEqual([piece])
    })

    it('⚑ THE CONTROL · busy or idle the answer arrives as WORDS, and there is no second route', async () => {
      // ⛔ **608 · this control measured a route that no longer exists** (HO-084 §4, standing rule
      // 26 — strip AND re-aim). ⚠️ It set a 30-second bound, answered while the worker's call was
      // still parked, and asserted the answer came back as the call's RESULT with no words
      // delivered. 🔴 **`608` removed the parking**, so that arm is unreachable and deleting the
      // test would have left `591`'s delivery half measured on one side only.
      //
      // ⚑ **What divides the two readings NOW is what the receiver is doing** — `queueMessage`
      // SENDS to an idle conversation and HOLDS for a busy one — and the property is that the
      // answer arrives either way. ⛔ The test above takes the BUSY arm (held, then flushed); this
      // takes the IDLE one, where the worker's turn has already ended, which is the state `608`
      // made ordinary.
      const { pm, worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      const asking = callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which schema?',
      })
      // ⛔ **608 · it SETTLES, inside a window a parked call could not have met** — see
      // {@link settledYet} for why the helper exists and what survived without it. ⚑ Before
      // `HO-084` §4 this promise was pending for the whole bound, and the assertion below it would
      // have been reached only after five minutes of wall clock.
      expect(await settledYet(asking)).toBe(true)
      const said = await asking
      expect(said.outcome, JSON.stringify(said)).toBe('ok')

      // 🔴 **The hazard, on the path the code walks**: the worker's turn ENDS before anybody
      // answers. ⛔ If a message did not wake a conversation whose turn had ended, every question
      // asked after `608` would be silently stranded — the row would say `asking`, the answer
      // would be delivered, and nobody would ever read it.
      await letTheWorkerFinish(worker)
      const before = ledger(worker).length

      const asked = openRequestOf(worker)
      const late = await callOn(pmTools, 'answer_question', {
        question: asked.requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
      })
      expect(late.outcome, JSON.stringify(late)).toBe('ok')
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'user_turn' && event.text.includes('answer: b'),
          ),
        'the answer arriving as a TURN in a conversation whose turn had ended',
      )
      // ⛔ **SENT and not HELD, which is the whole difference from the arm above** — a
      // `message_queued` row here would mean the conversation was still busy and the turn had not
      // really ended, and the assertion would be measuring nothing.
      expect(
        ledger(worker)
          .slice(before)
          .filter((event) => event.type === 'message_queued'),
      ).toEqual([])
      expect(wordsIn(worker).at(-1)?.text).toContain(
        `${host.nameByItsWork(pm)} answered the question you asked`,
      )

      // ⚑ **And there is no second route left at either door** — the branch that settled a parked
      // call is gone from both, which is what makes *the answer arrives as words* a property
      // rather than a case.
      //
      // ⚑ **D-017 · R6 — still ONE route at each door, and it is awaited now**: the delivery holds
      // the answer in the asker's ledger and starts it when it is not running, and the door waits to
      // say whether that start happened (`kept`). ⚠️ The person's door hands a question this app
      // asked to one function, and the route is in there.
      const code = codeOf(mainRoot, 'runtime/runtime-host.ts')
      expect(code).not.toContain('aTurnIsWaiting')
      expect(bodyOf(code, 'async answerQuestion(')).toContain(
        'const told = this.deliverAnswer(held, request.requestId, speaking, said, null, null, stopAs)',
      )
      expect(bodyOf(code, 'async respondUserInput(')).toContain(
        'return await this.aPersonAnswersAQuestionThisAppAsked(',
      )
      expect(bodyOf(code, 'private async aPersonAnswersAQuestionThisAppAsked(')).toContain(
        'const delivered = this.deliverAnswer(asked, requestId, null, said, null, theSurfaceAsking(by))',
      )
    })
  })

  /**
   * 🔴 **§2 · the PERSON's door — the last step of the chain the bound was derived from.**
   *
   * A deadline derived from the escalation window must not close the answer door after
   * routing a question to the person.
   *
   * ⚑ **608 · the bound is gone and the chain is not** (HO-084 §4). ⛔ What `589` measured was a
   * person arriving with 4½ minutes of five; now there is no clock in front of this door at all,
   * and the escalation is what still gets a person told.
   */
  describe('§2 · a person answers, through the door the escalation chain ends at', () => {
    it('⛔ a person answering is TAKEN, and the answer reaches the worker', async () => {
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      const surface = new RecordingSink('webContents:9')
      host.claimSession(worker, surface)
      const said = await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which schema?',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      const asked = openRequestOf(worker)
      const ack = await host.respondUserInput(
        worker,
        asked.requestId,
        { kind: 'answer', answers: { answer: ['the person decided'] } },
        surface,
      )
      // ⚠️ **It used to be `{ outcome: 'refused', stillOpen: false }`** once the bound had passed,
      // and since `608` there is no moment at which it could be anything else.
      expect(ack.outcome, JSON.stringify(ack)).toBe('taken')
      expect(stateOfRequest(worker, asked.requestId)).toBe('answered')
      await waitFor(
        () => wordsIn(worker).some((one) => one.text.includes('the person decided')),
        'the person’s answer reaching the worker',
      )
      // ⚑ **`null` for the answerer is a PERSON and is not the string** — the words say so and the
      // call site passes nothing, so a conversation whose folder is called *a person* cannot be
      // mistaken for one.
      expect(wordsIn(worker).at(-1)?.text).toContain('A person answered')
    })

    it('⛔ and a person DECLINING late is taken too — *nobody chose* is not *they chose this*', async () => {
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      const surface = new RecordingSink('webContents:9')
      host.claimSession(worker, surface)
      await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which schema?',
      })
      const asked = openRequestOf(worker)
      const ack = await host.respondUserInput(worker, asked.requestId, { kind: 'reject' }, surface)
      expect(ack.outcome, JSON.stringify(ack)).toBe('taken')
      // ⚑ **`rejected`, not `answered`** — the two are different claims about history.
      expect(stateOfRequest(worker, asked.requestId)).toBe('rejected')
      await waitFor(
        () => wordsIn(worker).some((one) => one.text.includes('declined to answer')),
        'the decline reaching the worker',
      )
    })
  })

  /**
   * 🔴 **§3 · what DOES end a question — HO-082 §2.2's table, and the one row that wrote nothing.**
   *
   * ⛔ **`withdraw_task` is the ending this dispatch had to build.** ⚠️ It became mandatory the
   * moment §1 landed: a question that no clock ends and no withdrawal ends is a question that is
   * answerable for ever about work that no longer exists.
   */
  describe('§3 · the work is taken back, and the question ends with it', () => {
    it('⛔ withdrawing the work writes an ENDING, and a later answer is refused BY NAME with it', async () => {
      const { worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which schema?',
      })
      const asked = openRequestOf(worker)
      expect(REQUEST_IS_OPEN[asked.state as (typeof REQUEST_STATES)[number]]).toBe(true)

      const took = await callOn(pmTools, 'withdraw_task', { piece })
      expect(took.outcome, JSON.stringify(took)).toBe('ok')
      // ⚑ **Computed from the rows written**, which is what `tookBackTheMessage` already is.
      expect(took.endedQuestions).toBe(1)

      // ⛔ **A WRITE and not a filter** — the row itself, in the worker's ledger, naming who did it.
      // ⚑ **D-016 · it is the take-back's own row** (`work_taken_back`), which the questions fold
      // ends the piece's questions on.
      expect(ledger(worker).filter((event) => event.type === 'work_taken_back')).toHaveLength(1)
      expect(stateOfRequest(worker, asked.requestId)).toBe('work-withdrawn')
      expect(REQUEST_IS_OPEN['work-withdrawn']).toBe(false)

      // 🔴 **THE CONTROL THAT WAS PLANTED BY THE HARNESS AND NEARLY NOT ASSERTED** (found by this
      // dispatch's own review). ⛔ **The worker is parked on a PERMISSION card**, which is a routed
      // request of its own in the same ledger — and a withdrawal that ended it would be a parent
      // answering a permission on somebody's behalf, which HO-005 §2 Q2 calls *the kill switch with
      // extra steps*. ⚑ It is untouched by construction: only `question_asked` carries a piece, so a
      // permission-shaped routing can never match one — and this is what makes that a measurement
      // rather than a claim.
      const permissions = store
        .routedRequestsOf(worker)
        .filter((one) => one.went.is === 'the-person-the-channel-left-it-with')
      expect(permissions.length).toBeGreaterThan(0)
      expect(permissions.every((one) => REQUEST_IS_OPEN[one.state])).toBe(true)

      const late = await callOn(pmTools, 'answer_question', {
        question: asked.requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
      })
      expect(late.outcome, JSON.stringify(late)).toBe('refused')
      expect(late.rail).toBe('question-has-already-ended')
      // ⚑ **The refusal NAMES the ending**, which is what tells a caller *this one is not coming
      // back* apart from *somebody answered it*.
      expect((late.detail as Record<string, unknown>).state).toBe('work-withdrawn')
    })

    it('⚑ THE CONTROL · a question about ANOTHER task in the same ledger is untouched', async () => {
      // 🔴 **The divergence this control exists for**: a repair that ended every open question in
      // the worker's ledger passes every other assertion in this section. ⚑ The two questions are
      // about two open pieces, so only the piece taken back can end one; a piece handed back ends
      // its own questions too (`a-to-do-for-a-person.test.ts`).
      const { worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'about the first?',
      })
      const first = openRequestOf(worker)
      expect(stateOfRequest(worker, first.requestId)).toBe('open')

      // ⚑ **D-016 · the second piece is a second give**, which reaches the same worker.
      const second = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'and rename the column',
        brief: 'and rename the column',
      })
      expect(second.outcome, JSON.stringify(second)).toBe('ok')
      expect(second.agent).toBe(worker)
      const other = store.piecesOwnedBy(worker).find((one) => one.piece !== piece)
      if (other === undefined) throw new Error('the second give never opened a piece')
      await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece: other.piece,
        question: 'about the second?',
      })
      const secondAsk = openRequestOf(worker)
      expect(secondAsk.requestId).not.toBe(first.requestId)

      const took = await callOn(pmTools, 'withdraw_task', { piece: other.piece })
      expect(took.outcome, JSON.stringify(took)).toBe('ok')
      // ⛔ **ONE, not two** — the join is on the PIECE the question named and never on the ledger
      // it lives in, which is the only reading under which one withdrawal does not end every
      // question a worker is waiting on.
      expect(took.endedQuestions).toBe(1)
      expect(ledger(worker).filter((event) => event.type === 'work_taken_back')).toHaveLength(1)
      expect(stateOfRequest(worker, secondAsk.requestId)).toBe('work-withdrawn')
      expect(stateOfRequest(worker, first.requestId)).toBe('open')
      // ⚑ **And the untouched one is still answerable**, which is the half a state check alone
      // cannot prove.
      const still = await callOn(pmTools, 'answer_question', {
        question: first.requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
      })
      expect(still.outcome, JSON.stringify(still)).toBe('ok')
    })

    it('⛔ a withdrawal ends the question and there is NOTHING LEFT TO RELEASE', async () => {
      // 🔴 **608 · this test measured `437`'s release and the release is gone** (HO-084 §4,
      // standing rule 26 — strip AND re-aim). ⚠️ It shortened the bound to 30 s, asserted the
      // worker's call was still parked, withdrew the work, and asserted the call came back — the
      // measurement that stopped the ledger asserting an ending the app had not performed.
      // ⛔ **No call parks any more**, so `endTheQuestionsAbout`'s second half was deleted with the
      // promise it settled.
      //
      // ⚑ **The subject survives and is measured where it now lives**: after a withdrawal the
      // ledger's ending is the WHOLE of what happened — nothing in this process is holding a
      // different opinion, and the worker is told by the row rather than by a returning call.
      const { worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      const said = await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which schema?',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      const asked = openRequestOf(worker)
      const before = ledger(worker).length

      const took = await callOn(pmTools, 'withdraw_task', { piece })
      expect(took.outcome, JSON.stringify(took)).toBe('ok')
      expect(took.endedQuestions).toBe(1)
      expect(stateOfRequest(worker, asked.requestId)).toBe('work-withdrawn')

      // ⛔ **And nothing ANSWERS the worker's question** — a released call used to hand it *nobody
      // answered*; an ending is a row, and the words a worker gets about a question are answers.
      // ⚑ **D-016 · ruling 8 — the one thing it is handed is the take-back itself**: the app's own
      // notice that the piece is no longer its to do. ⚑
      // `a-positive-assertion-must-differ-from-the-default`: the arm above this one proves this
      // same reader DOES see an answer when there is one.
      const handed = ledger(worker)
        .slice(before)
        .filter(
          (event): event is Extract<TranscriptEvent, { type: 'user_turn' | 'message_queued' }> =>
            event.type === 'user_turn' || event.type === 'message_queued',
        )
      expect(handed.map((event) => event.appNotice)).toEqual(['a-piece-taken-back'])
      expect(handed.map((event) => event.text).join('\n')).not.toContain('answer')

      // ⚑ **The census half, because *there is nothing left to release* is a claim about CODE.**
      const code = codeOf(mainRoot, 'runtime/runtime-host.ts')
      expect(bodyOf(code, 'async takeBackPiece(')).not.toContain('questionsThisAppHolds')
      expect(bodyOf(code, 'private askTheWorkToStop(')).not.toContain('questionsThisAppHolds')
    })

    it('⚑ THE CONTROL · a question an ANSWER already ended is not ended twice, and keeps its first ending', async () => {
      const { worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which schema?',
      })
      const asked = openRequestOf(worker)
      await callOn(pmTools, 'answer_question', {
        question: asked.requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
      })
      expect(stateOfRequest(worker, asked.requestId)).toBe('answered')
      const took = await callOn(pmTools, 'withdraw_task', { piece })
      expect(took.outcome, JSON.stringify(took)).toBe('ok')
      // ⛔ **The FOLD decides which are still open, never a predicate written at the call site** —
      // `396`'s rule, third venue.
      expect(took.endedQuestions).toBe(0)
      expect(stateOfRequest(worker, asked.requestId)).toBe('answered')
    })
  })

  /**
   * 🔴 **§4 · elapsed time ends nothing, measured where the two readings DIVERGE.**
   *
   * ⛔ **A build that ended a question on the bound and one that does not agree on everything except
   * this**: the same worker, the same question, the same parent, and the only variable is how much
   * wall clock passed before the answer.
   */
  describe('§4 · elapsed time is not an ending', () => {
    it('⛔ ten bounds of wall clock later, the question is still the parent’s to answer', async () => {
      const { worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which schema?',
      })
      const asked = openRequestOf(worker)
      // ⚠️ **The clock is MOVED, never slept on** — standing rule 22. Nothing in this app watches
      // this number for a question; the point is that moving it changes nothing.
      clock += BOUND * 10
      expect(stateOfRequest(worker, asked.requestId)).toBe('open')
      const late = await callOn(pmTools, 'answer_question', {
        question: asked.requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
      })
      expect(late.outcome, JSON.stringify(late)).toBe('ok')
      expect(stateOfRequest(worker, asked.requestId)).toBe('answered')
    })

    it('⛔ a ledger this process can no longer READ cannot become a transport error, because it is no longer read', async () => {
      // 🔴 **Found by the gate's third run, not by me** (591 §10.3). ⛔ **`raiseAQuestion` did no
      // ledger read after its race until `591` added one**, and the three things that settled that
      // race — the bound, an interruption and a withdrawal — all fired at moments the app may be
      // going away. ⚠️ A teardown released every held ask and closed the database in the same
      // breath, so the released call read a closed store: *`TypeError: The database connection is
      // not open`*, one unhandled rejection with all 11,596 tests passing. `591` wrapped it.
      //
      // 🔴 **608 · the READ is gone rather than the guard** (HO-084 §4, standing rule 26). ⛔ The
      // read existed to say which of three silences a five-minute race had met; nothing is awaited
      // between the writes and the return, so it could only ever have answered `open`.
      // ⚑ **The hazard is still put on the path the code walks** — a store whose `routedRequestsOf`
      // throws exactly the way a closed one does — and the ask must still come back as an ANSWER.
      const brittle: SessionStore = {
        ...store,
        routedRequestsOf: () => {
          throw new Error('The database connection is not open')
        },
      }
      const { workerTools, piece } = await aWorkerHoldingWork()
      const asking = host as unknown as { deps: { store: SessionStore } }
      const real = asking.deps.store
      asking.deps.store = brittle
      try {
        const said = await callOn(workerTools, 'ask_question', {
          who_answers: 'the-parent',
          piece,
          question: 'which schema?',
        })
        // ⛔ **An ANSWER, never a throw** — `307`'s rule: a model meeting a transport error is told
        // its tool is broken rather than what happened.
        expect(said.outcome, JSON.stringify(said)).toBe('ok')
        expect(said.question).toEqual(expect.any(String))
      } finally {
        asking.deps.store = real
      }
      // ⚑ **And the structural half, which is what makes the hazard unreachable rather than
      // caught**: the verb reads no routing at all, and holds no `try` around one.
      const body = bodyOf(codeOf(mainRoot, 'runtime/runtime-host.ts'), 'async raiseAQuestion(')
      expect(body).not.toContain('routedRequestsOf')
      expect(body).not.toContain('whatBecameOfTheQuestion')
    })

    it('⛔ and the ONE table that decides it has no member a clock can reach', () => {
      // ⚑ **A closed vocabulary guards what a member says.** ⚠️ Every closed state here is an
      // EVENT this app watched happen; none of them is entered by a timer, and this is the
      // assertion that goes red the day somebody adds one.
      expect([...REQUEST_STATES]).toEqual([
        'open',
        'answered',
        'rejected',
        'decided',
        'withdrawn',
        'abandoned',
        'stranded',
        'interrupted',
        'work-withdrawn',
        // ⚑ **D-016** — the work it was about was closed by the one that gave it.
        'work-closed',
        // The work it was about was handed back.
        'work-replied',
        // ⚑ **D-009** — the conversation it was addressed to ended without answering it.
        'recipient-ended',
      ])
      expect(REQUEST_IS_OPEN.open).toBe(true)
      expect(
        [...REQUEST_STATES]
          .filter((state) => state !== 'open')
          .every((state) => !REQUEST_IS_OPEN[state]),
      ).toBe(true)
    })
  })

  /**
   * 🔴 **§5 · what a PERSON sees — the fold Home's counter is made of.**
   *
   * ⛔ **This is the section HO-082 §5 is about.** The old behaviour was pinned by a correct test
   * and nobody asked what a person saw at the limit; this asks, with the same fold the queue reads.
   */
  describe('§5 · the row a person could never clear', () => {
    it('⛔ an escalated question is in the person’s queue, and answering it LATE takes it out', async () => {
      const { worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      await callOn(workerTools, 'ask_question', {
        // ⚑ **612 · ADDRESSED to a person, because no sweep puts one there any more** (HO-088
        // §3.1, §2). ⛔ This drove `store.escalationsDue` and wrote the row through the host's own
        // door; the deadline is gone, and `611`'s recipient is how a question reaches a person in
        // one call. ⚠️ **The subject of this test is unchanged**: a LATE answer still lands, and
        // the row still leaves the queue when it does.
        who_answers: 'a-person',
        piece,
        question: 'which schema?',
      })
      const asked = store
        .routedRequestsOf(worker)
        .filter((one) => one.went.is === 'the-person-the-asker-named')
        .at(-1)
      if (asked === undefined) throw new Error('the question did not reach a person')

      const before = host.questionsForAPerson().rows
      expect(before.map((one) => one.request.requestId)).toEqual([asked.requestId])

      // A person can answer fifteen minutes later; the late call must not leave an
      // unanswerable open row.
      clock += BOUND * 6
      const late = await callOn(pmTools, 'answer_question', {
        question: asked.requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
      })
      expect(late.outcome, JSON.stringify(late)).toBe('ok')
      expect(host.questionsForAPerson().rows).toEqual([])
      // ⚑ **612 · and it never carried a stamp**, because nothing escalated it — it was addressed.
      expect(
        store.routedRequestsOf(worker).find((one) => one.requestId === asked.requestId)
          ?.escalatedAt,
      ).toBeNull()
    })

    it('⛔ and a question whose WORK was taken back leaves the queue too, without anybody answering it', async () => {
      const { pmTools, workerTools, piece } = await aWorkerHoldingWork()
      await callOn(workerTools, 'ask_question', {
        // ⚑ **612 · ADDRESSED to a person** — see the test above for why the sweep is gone.
        who_answers: 'a-person',
        piece,
        question: 'which schema?',
      })
      expect(host.questionsForAPerson().rows).toHaveLength(1)
      await callOn(pmTools, 'withdraw_task', { piece })
      // ⚑ **The queue reads a FACT** — HO-082 §4.1 — and the fact is a row in the ledger rather
      // than a filter in a renderer.
      expect(host.questionsForAPerson().rows).toEqual([])
    })
  })

  /**
   * ⚑ **§6 · the words, on every arm.**
   *
   * ⛔ **A sentence true of one arm and false of the others is what `591` was sent to remove**, so
   * each of the three silences gets its own reading and this section asserts they differ.
   */
  describe('§6 · what a model is told, and it is chosen by the row', () => {
    it('⛔ the expiry sentence says the question is still theirs, and the ENDED sentence says it is not', async () => {
      const { worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      const toolset = workerTools.tools.find((one) => one.name === 'ask_question')
      if (toolset === undefined) throw new Error('no ask_question')
      const expired = await toolset.call({
        piece,
        question: 'which schema?',
        who_answers: 'the-parent',
      })
      expect(expired.text).toContain('still theirs to answer')
      expect(expired.text).toContain('reaches you as a message')
      // ⛔ **And it does NOT promise the work is still open**, which is `437`'s own review finding
      // and the mistake this dispatch had every opportunity to repeat.
      expect(expired.text).not.toContain('the work is still yours')

      const asked = openRequestOf(worker)
      await callOn(pmTools, 'withdraw_task', { piece })
      expect(stateOfRequest(worker, asked.requestId)).toBe('work-withdrawn')

      // ⚑ **The other arm, reached through `list_questions`' own sentence table.**
      //
      // 🔴 **Read the TEXT and never the payload.** ⛔ The first draft asserted
      // `JSON.stringify(structured)` contained the word — and the payload carries `state` off the
      // row whether or not a sentence exists, so `M16` (delete the sentence) SURVIVED.
      // ⚠️ `an-assertion-can-be-satisfied-by-a-neighbouring-element`, caught by its own survivor.
      const listing = pmTools.tools.find((one) => one.name === 'list_questions')
      if (listing === undefined) throw new Error('no list_questions')
      const listed = await listing.call({ state: 'all' })
      expect(listed.text).toContain('the work it was about was taken back')
      expect(listed.text).toContain('work-withdrawn')
    })

    it('⚑ and the tool payload carries the id and NOTHING that described a wait', async () => {
      // 🔴 **608 · this test had TWO arms and there is one outcome now** (HO-084 §4, standing rule
      // 26). ⚠️ It shortened the bound to 30 s, answered while the call was parked, and asserted
      // `answered: true` with `question_is: 'answered'` — so that a derived field's ABSENCE could
      // never become a second fact. ⛔ **All three fields described the wait and went with it**, so
      // what this pins now is that none of them came back as a constant.
      const { workerTools, piece } = await aWorkerHoldingWork()
      const toolset = workerTools.tools.find((one) => one.name === 'ask_question')
      if (toolset === undefined) throw new Error('no ask_question')
      const said = await toolset.call({
        piece,
        question: 'which schema?',
        who_answers: 'the-parent',
      })
      const payload = said.structured as Record<string, unknown>
      expect(payload.outcome).toBe('ok')
      // ⚑ **611 · a THIRD key, and it is the one thing this call's outcome now varies in**
      // (HO-088 §2) — where the question went. ⛔ It is the caller's own declaration copied back,
      // which is why it satisfies `a-positive-assertion-must-differ-from-the-default` where
      // `answered: false` did not: the two arms are two different routings.
      expect(Object.keys(payload).sort()).toEqual(['outcome', 'question', 'went_to'])
      expect(payload.went_to).toBe('the-parent')
      // ⛔ **`a-positive-assertion-must-differ-from-the-default`**: a payload that reported
      // `answered: false` on every call is a fact a model reads and can never act on.
      expect(payload.answered).toBeUndefined()
      expect(payload.waitedForMs).toBeUndefined()
      expect(payload.question_is).toBeUndefined()
    })
  })

  /**
   * 🔴 **§7 · the sweep, and the premise HO-082 §3.1 asked me to check.**
   *
   * ⛔ **Standing rule 8.1: the sweep for sentences describing the OLD behaviour is part of
   * implementing the ruling.** ⚠️ These assertions are what stops one of them coming back.
   */
  describe('§7 · the prose that went false with the behaviour', () => {
    it('⛔ no door refuses an answer on a clock any more, and both read the ledger instead', () => {
      // 🔴 **CODE, not prose** — the first draft of this read the whole file and went red on its
      // own docblock, which quotes the refusal it is asserting the absence of.
      const code = codeOf(mainRoot, 'runtime/runtime-host.ts')
      // ⛔ **The two refusals that are gone, quoted as they stood.**
      expect(bodyOf(code, 'async answerQuestion(')).not.toContain(
        'if (held !== undefined && !held.waiting)',
      )
      // ⛔ **Asked of the DOOR's body and not of the file** — `441`'s proposal map has a `waiting`
      // flag of its own and `decideProposal` reads it correctly; see {@link bodyOf}.
      expect(bodyOf(code, 'async respondUserInput(')).not.toContain('if (!holding.waiting) {')
      // ⛔ **608 · the flag `591` left behind is GONE, and this line used to assert it was there**
      // (HO-084 §4, standing rule 26). ⚑ `591` narrowed `waiting` to `aTurnIsWaiting` — *is there
      // a promise in this process that `settle` would reach?* — and `608` made the answer *no,
      // always*, so the field went rather than staying as a constant a branch could hang off.
      expect(code).not.toContain('aTurnIsWaiting')
      // ⚠️ **Scoped to the two ANSWER DOORS and not to the file**, because `441`'s proposal map
      // has a `settle` of its own that `decideProposal` calls correctly —
      // `an-assertion-can-be-satisfied-by-a-neighbouring-element`, avoided rather than repaired.
      expect(bodyOf(code, 'async answerQuestion(')).not.toContain('.settle(')
      expect(bodyOf(code, 'async respondUserInput(')).not.toContain('.settle(')
      expect(bodyOf(code, 'private async aPersonAnswersAQuestionThisAppAsked(')).not.toContain(
        '.settle(',
      )
      expect(bodyOf(code, 'async answerQuestion(')).not.toMatch(/\bheld\.waiting\b/)
      expect(bodyOf(code, 'async respondUserInput(')).not.toMatch(/\bholding\.waiting\b/)
      // ⚑ **The positive control for the `not.toContain`s above**, without which they would all pass
      // over a file this suite had stopped reading: what a late answer is routed through is read at
      // both doors. ⚑ **D-017 · R6 — the asker's LEDGER** (`RuntimeHost.theWordsOf`), which replaced the
      // map this line used to name (`questionsThisAppHolds`, gone with the remember/bring-back).
      expect(code).not.toContain('questionsThisAppHolds')
      expect(bodyOf(code, 'async answerQuestion(')).toContain(
        'this.theWordsOf(request.askedBy, request.requestId)',
      )
      expect(bodyOf(code, 'async respondUserInput(')).toContain(
        'this.theWordsOf(sessionId, requestId)',
      )
      expect(bodyOf(code, 'private theWordsOf(')).toContain(
        'this.deps.store.questionsRaisedIn(askedBy)',
      )
      // ⛔ **The PROSE keeps the withdrawn sentence on purpose** — `498`'s rule: a sentence deleted
      // without its history comes back. ⚑ What may not survive is the claim stated as fact.
      expect(proseOf(mainRoot, 'runtime/runtime-host.ts')).toContain('it read a clock')
    })

    it('⛔ the ask_parent sentence no longer says an answer after the bound is refused', () => {
      const tools = codeOf(mainRoot, 'runtime/agent-tools.ts')
      expect(tools).toContain('reaches you as a message rather than as this call')
      // ⚠️ **Read as PROSE with its wrapping removed**, because a docblock sentence moves across
      // lines the moment anything above it changes length.
      const questions = proseOf(join(mainRoot, '..'), 'shared/questions.ts')
      expect(questions).toContain('deleted the behaviour that sentence described')
    })

    it('🔴 603/608 · HO-082 §3.1 · the condition EXISTS, the FOLD still has none, and the hold is GONE', () => {
      const tasks = codeOf(join(mainRoot, '..'), 'shared/tasks.ts')
      // ⛔ **This census guessed two spellings and it would have stayed GREEN over the world that
      // changed underneath it.** ⚠️ It read `not.toContain("'waiting_on_an_answer'")` and
      // `not.toContain("'asked_a_question'")` against a whole module, and `603` added `'asking'` —
      // a third spelling neither negative could see. 🔴 `a-negative-is-only-as-strong-as-the-search-
      // shape`, and `a-mutation-on-a-census-is-invisible-to-that-census` is why it is re-aimed
      // rather than stripped: stripping would have passed the gate with the instrument dead.
      //
      // ⚑ **What it should have been asking is about the FOLD, which is where `400`'s rule lives**
      // — and that answer has not changed.
      // 🔴 **624 · re-aimed onto the words that replaced it** (`HO-095` §5.2). ⛔ *and it replied
      // nothing* was false beside `614`'s quotation of the agent's own last words, and the PO's
      // replacement is a decomposition: *the turn ended with the task still open, and here is the
      // last thing it said.* ⚑ **The assertion is unchanged in kind** — this census exists to pin
      // that the fold's own account of `turn_ended` is a sentence and not a bare word — so it is
      // re-aimed rather than stripped (`a-mutation-on-a-census-is-invisible-to-that-census`).
      expect(tasks).toContain("turn_ended: 'its turn ended with this work still open.'")
      // ⛔ **And the clause that went is refused BY NAME**, which the old assertion could not do:
      // a census that only pins the new words goes green over a build that says both.
      expect(tasks).not.toContain("and it replied nothing.'")
      // ⚠️ **609 · re-aimed for the rename**, `a-question-a-worker-can-ask.test.ts`'s note.
      expect([...TASK_STATES]).toContain('waiting-on-an-answer')
      expect(TASK_IS_OPEN['waiting-on-an-answer']).toBe(true)
      // ⛔ **The fold cannot produce it**, because the join is above `derivePieces` (D-016's name
      // for `deriveTasks`) and the fold has no reader of the request derivation — the whole
      // property is `waiting-on-an-answer-is-not-stalled.test.ts` §1.
      const fold = tasks.slice(tasks.indexOf('export function derivePieces('))
      expect(fold.length, 'the slice found no derivePieces body').toBeGreaterThan(1_000)
      expect(fold).not.toContain("'asking'")
      expect(fold).not.toContain('composeWaitingOnAnAnswer')
      // 🔴 **608 · the hold is GONE, and this line used to assert it was still here** (HO-084 §4).
      // ⛔ `591` changed what happened at its end, `603` changed what the end reported, and `608`
      // removed it now that `TaskState.asking` answers the sentence it existed to prevent.
      //
      // ⚠️ **Keyed on the SHAPE and not on a spelling**, which is this file's own lesson one
      // dispatch on: the old assertion named `given = await Promise.race([answered, expiry])`, and
      // a negative keyed on a literal is a negative keyed on somebody's imagination
      // (`a-negative-is-only-as-strong-as-the-search-shape`). ⛔ **A wait needs an `await` or a
      // timer**, so those are what this refuses — and the verb's own body is the scope.
      const ask = bodyOf(codeOf(mainRoot, 'runtime/runtime-host.ts'), 'async raiseAQuestion(')
      expect(ask.length, 'the slice found no raiseAQuestion body').toBeGreaterThan(400)
      // ⚠️ **The SIGNATURE is skipped**, because `Promise<AskOutcome>` is the return type of every
      // verb in this class and the claim is about the body.
      const body = ask.slice(ask.indexOf('): Promise<AskOutcome> {'))
      expect(body.length, 'the slice found no raiseAQuestion body').toBeGreaterThan(400)
      expect(body).not.toContain('await ')
      expect(body).not.toContain('setTimeout')
      expect(body).not.toContain('new Promise')
      expect(body).not.toContain('Promise.race')
      // ⚑ **The positive control**: the slice really is the verb, and the verb really does write
      // the three durable things `394` ruled it owes.
      expect(ask).toContain("type: 'question_asked'")
      expect(ask).toContain("type: 'request_routed'")
      expect(ask).toContain('this.deliverQuestion(')
    })

    it('⚑ and the ending has exactly one producer, which is what the word claims', () => {
      // ⛔ **Asked of CODE**, so the three docblocks that name the type do not count as writers —
      // which is the whole shape `a-source-census-must-strip-prose-before-it-asserts` names.
      // ⚑ **D-016 · the ending is the take-back's own row** — `request_work_withdrawn` has no writer
      // now, and `work_taken_back` is written by the one door that takes a piece back.
      const code = codeOf(mainRoot, 'runtime/runtime-host.ts')
      expect(code.split("type: 'request_work_withdrawn'").length - 1).toBe(0)
      expect(code.split("type: 'work_taken_back'").length - 1).toBe(1)
      expect(bodyOf(code, 'async takeBackPiece(')).toContain("type: 'work_taken_back'")
    })
  })

  /** ⚑ Unused imports are a lint error; this keeps the fold's own type honest in one place. */
  const _entry = (ordinal: number, event: TranscriptEvent): PersistedEventInfo => ({
    ordinal,
    at: 10 + ordinal,
    event,
  })
  void _entry
})
