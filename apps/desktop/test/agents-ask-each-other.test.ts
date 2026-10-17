import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { REQUEST_IS_OPEN } from '../src/shared/questions'
import {
  DEFAULT_PROFILE_ID,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **D-009 · F012 — agents can ask each other, and the answer comes back.**
 *
 * A peer question sent as a message can produce an answer only in the recipient’s transcript.
 * A question tool needs an answer route back to the asker.
 *
 * One question door accepts the parent, a person, or a named agent. The recipient answers or
 * says it cannot; only questions to the parent pass further up. There is no clock expiry: the
 * question closes and notifies the asker when the recipient’s conversation ends, or the asker
 * withdraws it. Quit is not an ending.
 *
 * ⚑ **D-017 — nothing ends a conversation** (`end_agent` is gone, and a Close, a reload, a provider
 * failure and a quit are a STOP, which a message starts again), so ruling 5's ending has no act left:
 * a question stays open until it is answered, declined or withdrawn. §2 measures the stop.
 *
 * ⚑ **D-016 · the tree** — work is a piece now, handed out with `give_work`, whose brief is the
 * helper's first turn; a question to the parent or a person is about a piece the asker holds (its
 * root counts), and **a question about no piece holds nothing** (plan R14): only one that names a
 * piece makes its asker — or that piece — wait on the answer.
 *
 * ⚑ Real host, real SQLite ledger, real toolsets; the only double is the provider.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('D-009 · agents ask each other, and the answer comes back', () => {
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

  /** ⚑ Every toolset a launch was handed, starts AND resumes, keyed by the conversation. */
  class ToolWatchingRuntime extends FakeRuntime {
    constructor(
      provider: Provider,
      private readonly handed: Map<string, AgentToolset>,
      private readonly order: AgentToolset[],
      sessions: FakeProviderSessions,
    ) {
      super(provider, { sessions })
    }
    override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
      const handle = await super.start(options)
      if (options.agentTools) this.order.push(options.agentTools)
      return handle
    }
    override async resume(
      ref: SessionRef,
      options: ResumeOptions,
    ): ReturnType<FakeRuntime['resume']> {
      const handle = await super.resume(ref, options)
      if (options.agentTools) this.order.push(options.agentTools)
      return handle
    }
  }

  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let order: AgentToolset[]
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
      createRuntime: (provider: Provider) =>
        new ToolWatchingRuntime(provider, new Map(), order, issued),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d009-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d009-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    order = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⚑ A person opens a conversation; its toolset is the last one handed out. */
  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<{ id: string; tools: AgentToolset }> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    const tools = order.at(-1)
    if (tools === undefined) throw new Error('no toolset was handed to that launch')
    return { id: sessionId, tools }
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

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** ⚑ Every message this conversation was handed — a turn or a held message — by its words. */
  const toldIn = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) =>
      event.type === 'user_turn' || event.type === 'message_queued' ? [event.text] : [],
    )

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const questionOf = (asker: string, requestId: string) =>
    store
      .routedRequestsOf(asker)
      .filter((one) => one.requestId === requestId)
      .at(-1)

  const waitOf = (conversation: string): string | null | undefined =>
    host
      .whatEachConversationIsWaitingOn()
      .conversations.find((row) => row.conversation === conversation)?.waiting

  /** ⚑ Two conversations a person opened: Ada asks, Bo is asked. */
  const adaAndBo = async () => {
    const ada = await personOpens(DEFAULT_PROFILE_ID)
    const bo = await personOpens('reviewer')
    return { ada, bo }
  }

  const askBo = async (
    ada: { tools: AgentToolset },
    bo: { id: string },
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const asked = await callOn(ada.tools, 'ask_question', {
      who_answers: 'an-agent',
      agent: bo.id,
      question: 'which schema do you use?',
      ...extra,
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    return asked.question as string
  }

  /**
   * ⚑ A person's PM gives a worker a piece: the worker holds it open, its turn — the brief, D-016 —
   * is parked on a card a person is watching (so the card stays the person's), and its giver is the
   * PM.
   */
  const aPmWithAWorkerOnATask = async () => {
    await host.close((await personOpens('worker')).id, window)
    const pm = await personOpens(DEFAULT_PROFILE_ID)
    const given = await callOn(pm.tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The notes',
      brief: 'write it',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerTools = order.at(-1)
    if (workerTools === undefined) throw new Error('no worker toolset')
    const surface = new RecordingSink('webContents:9')
    host.claimSession(worker, surface)
    await waitFor(
      () => ledger(worker).some((event) => event.type === 'permission_request'),
      'the worker to park on its card',
    )
    return { pm, worker, workerTools, piece: given.label as string, surface }
  }

  /**
   * ⚑ **D-017 · R3 — a Close, a reload, a provider failure and a quit are a STOP, and a stop ends
   * nothing** — and since commit 3 there is no ending left at all (`end_agent` is gone). Bo is a
   * helper Ada started herself, so Ada's message is what starts Bo again.
   *
   * ⚠️ **Both run `auto`** (a child inherits its parent's mode, HO-036), so no card stands in the way.
   * ⚑ **D-016** — Ada's give started Bo, and its brief was Bo's first turn.
   */
  const adaAndTheHelperSheStarted = async () => {
    await host.close((await personOpens('reviewer')).id, window)
    const ada = await personOpens(DEFAULT_PROFILE_ID, 'auto')
    const given = await callOn(ada.tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'reviewer',
      title: 'The schema',
      brief: 'the schema',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const tools = order.at(-1)
    if (tools === undefined) throw new Error('no toolset was handed to the helper')
    return { ada, bo: { id: given.agent as string, tools } }
  }

  /** ⚑ **D-016** — a conversation a person opened holds its own ROOT piece, by its label. */
  const rootOf = (conversation: string): string => {
    const root = store.rootOf(conversation)
    if (root === null) throw new Error(`no root for ${conversation}`)
    return root.label
  }

  describe('§1 · the door, the answer, and the way back', () => {
    it('🔴 F012 · an agent asks another by name, needing no task — and the answer comes back to it', async () => {
      const { ada, bo } = await adaAndBo()
      // ⛔ **THE BEFORE**: Ada holds no work given to her, and is waiting on nothing.
      expect(store.piecesOwnedBy(ada.id)).toEqual([])
      expect(waitOf(ada.id)).toBeNull()

      const id = await askBo(ada, bo)
      // ⚑ The routing names Bo as the one who answers.
      expect(questionOf(ada.id, id)).toMatchObject({
        state: 'open',
        parent: bo.id,
        went: { is: 'the-agent-the-asker-named', to: 'an-agent' },
      })
      // ⚑ **D-016 · plan R14 — a question about no piece holds nothing**, so Ada's conversation reads
      // no wait while it is open; a question that NAMES a piece is what waits on its answer.
      expect(waitOf(ada.id)).toBeNull()
      // ⚑ Bo is told, with the id to quote, and finds it in its own list.
      await waitFor(
        () => toldIn(bo.id).some((text) => text.includes(id)),
        'the question to reach Bo',
      )
      const listed = await callOn(bo.tools, 'list_questions', {})
      expect(JSON.stringify(listed)).toContain(id)

      const answered = await callOn(bo.tools, 'answer_question', {
        question: id,
        asked_by: ada.id,
        answers: [{ part: 'answer', answer: ['the one in schema.sql'] }],
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      // 🔴 **The way back, which F012 found missing**: Ada is sent Bo's answer, and the question is over.
      await waitFor(
        () => toldIn(ada.id).some((text) => text.includes('the one in schema.sql')),
        'the answer to reach Ada',
      )
      // ⚑ **D-016 · commit 7 · R3 — Bo named by the piece it owns**, where the words printed its id.
      expect(toldIn(ada.id).find((text) => text.includes('the one in schema.sql'))).toContain(
        `${host.nameByItsWork(bo.id)} answered the question you asked, quoting ${id}.`,
      )
      expect(questionOf(ada.id, id)?.state).toBe('answered')
      // ⚑ **D-017 · R19 — no longer waiting on an ANSWER; what she waits on now is a person.** The
      // answer opened a turn in Ada, which the double parks on a card, and Ada has no parent — so that
      // card is routed to a person, and it is the only request of hers still open.
      await waitFor(
        () => waitOf(ada.id) === 'waiting-on-a-person',
        'the card Ada’s next turn parks on',
      )
      const stillOpen = store.routedRequestsOf(ada.id).filter((one) => REQUEST_IS_OPEN[one.state])
      expect(stillOpen.map((one) => one.requestId)).not.toContain(id)
      expect(stillOpen.map((one) => one.went.to)).toEqual(['a-person'])
    })

    it('⚑ the one asked may say it cannot answer — and the asker is told why', async () => {
      const { ada, bo } = await adaAndBo()
      const id = await askBo(ada, bo)
      const declined = await callOn(bo.tools, 'answer_question', {
        question: id,
        asked_by: ada.id,
        cannot_answer: 'I have never seen that schema',
      })
      expect(declined.outcome, JSON.stringify(declined)).toBe('ok')
      await waitFor(
        () => toldIn(ada.id).some((text) => text.includes('I have never seen that schema')),
        'the decline to reach Ada',
      )
      const told = toldIn(ada.id).find((text) => text.includes('I have never seen that schema'))
      expect(told).toContain(
        `${host.nameByItsWork(bo.id)} declined to answer the question you asked, quoting ${id}.`,
      )
      expect(told).toContain('It said: I have never seen that schema')
      expect(questionOf(ada.id, id)?.state).toBe('rejected')
      // ⛔ An answer and a reason together is refused: one or the other.
      const both = await callOn(bo.tools, 'answer_question', {
        question: id,
        cannot_answer: 'no',
        answers: [{ part: 'answer', answer: ['yes'] }],
      })
      expect(both.outcome).toBe('refused')
    })

    it('⛔ an answer and a reason together, on a question still OPEN, is refused — and the question still takes its answer', async () => {
      // ⚠️ The test above sends both only after the decline has closed the question, so the host
      // refuses it as over whatever the door does. ⚑ Here the question is open: only the door's own
      // "one or the other" rule stands between the call and a decline that drops the answer.
      const { ada, bo } = await adaAndBo()
      // ⚑ **D-016 · about Ada's own root** (plan R14: a question about no piece holds nothing), so
      // the wait below has something to say.
      const id = await askBo(ada, bo, { piece: rootOf(ada.id) })
      const both = await callOn(bo.tools, 'answer_question', {
        question: id,
        asked_by: ada.id,
        cannot_answer: 'I have never seen that schema',
        answers: [{ part: 'answer', answer: ['the one in schema.sql'] }],
      })
      expect(both.outcome, JSON.stringify(both)).toBe('refused')
      expect(both.rail).toBe('malformed-request')
      expect(JSON.stringify(both.detail)).toContain(
        'answers: send answers or cannot_answer, not both',
      )
      // ⛔ **And nothing happened**: the question is still Bo's to answer.
      expect(questionOf(ada.id, id)?.state).toBe('open')
      expect(waitOf(ada.id)).toBe('waiting-on-an-answer')

      // ⚑ **THE PAIR**: the same question, answered alone, is taken — and when its answer has
      // reached Ada, she was never told it was declined.
      const answered = await callOn(bo.tools, 'answer_question', {
        question: id,
        asked_by: ada.id,
        answers: [{ part: 'answer', answer: ['the one in schema.sql'] }],
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      await waitFor(
        () => toldIn(ada.id).some((text) => text.includes('the one in schema.sql')),
        'the answer to reach Ada',
      )
      expect(questionOf(ada.id, id)?.state).toBe('answered')
      expect(toldIn(ada.id).some((text) => text.includes('declined to answer'))).toBe(false)
    })

    it('⛔ a decline’s reason is bounded like every reply: one unit over is refused, and nothing reaches the asker', async () => {
      // ⚠️ `cannot_answer` is agent-written text that lands in ANOTHER conversation's turn — the
      // hole `437` and `676` closed for answers, at the new field. ⚑ Literals, not the constant
      // plus one (`reply-rails.ts`: a test that writes `REPLY_SUMMARY_LIMIT + 1` pins nothing).
      const { ada, bo } = await adaAndBo()
      // ⚑ **D-016 · about Ada's own root** (plan R14: a question about no piece holds nothing), so
      // the wait below has something to say.
      const id = await askBo(ada, bo, { piece: rootOf(ada.id) })
      const tooLong = 'x'.repeat(1281)
      const refused = await callOn(bo.tools, 'answer_question', {
        question: id,
        asked_by: ada.id,
        cannot_answer: tooLong,
      })
      expect(refused.outcome, JSON.stringify(refused).slice(0, 400)).toBe('refused')
      // ⚑ The rail a long answer meets too, saying the length, the limit and what to do.
      expect(refused.rail).toBe('answer-too-long')
      expect(refused.detail).toMatchObject({ argument: 'cannot_answer', limit: 1280, was: 1281 })
      expect(refused.reason).toContain('It is 1281 units long and a reason may be at most 1280')
      expect(refused.reason).toContain('name its full path in cannot_answer')
      // ⛔ **And nothing happened**: the question is still Bo's, and Ada still waits on it.
      expect(questionOf(ada.id, id)?.state).toBe('open')
      expect(waitOf(ada.id)).toBe('waiting-on-an-answer')

      // ⚑ **THE PAIR**: a reason AT the limit is taken, and reaches Ada whole — so the bound is the
      // limit, not a shorter one — and the refused one never reached her.
      const atTheLimit = 'y'.repeat(1280)
      const declined = await callOn(bo.tools, 'answer_question', {
        question: id,
        asked_by: ada.id,
        cannot_answer: atTheLimit,
      })
      expect(declined.outcome, JSON.stringify(declined).slice(0, 400)).toBe('ok')
      await waitFor(
        () => toldIn(ada.id).some((text) => text.includes(`It said: ${atTheLimit}`)),
        'the decline at the limit to reach Ada',
      )
      expect(questionOf(ada.id, id)?.state).toBe('rejected')
      expect(toldIn(ada.id).some((text) => text.includes('x'.repeat(1281)))).toBe(false)
    })

    it('⛔ ruling 2: a question asked of you by name cannot be passed up', async () => {
      const { ada, bo } = await adaAndBo()
      const id = await askBo(ada, bo)
      const passed = await callOn(bo.tools, 'pass_question_up', {
        question: id,
        asked_by: ada.id,
        who_answers: 'a-person',
      })
      expect(passed.rail, JSON.stringify(passed)).toBe('a-question-asked-of-you-by-name-is-yours')
      expect(questionOf(ada.id, id)?.state).toBe('open')
      // ⛔ …and the pass-up door never offers an agent by name.
      const toAgent = await callOn(bo.tools, 'pass_question_up', {
        question: id,
        asked_by: ada.id,
        who_answers: 'an-agent',
      })
      expect(toAgent.outcome).toBe('refused')
      expect(JSON.stringify(toAgent)).toContain('the-parent, a-person')
    })

    it('⛔ only an agent the asker may name, and never itself', async () => {
      const { ada } = await adaAndBo()
      for (const agent of ['sess_nobody', ada.id]) {
        const asked = await callOn(ada.tools, 'ask_question', {
          who_answers: 'an-agent',
          agent,
          question: 'anyone?',
        })
        expect([agent, asked.rail]).toEqual([
          agent,
          agent === ada.id ? 'that-agent-is-you' : 'no-agent-you-can-ask-by-that-name',
        ])
      }
      // ⛔ The parent and a person are still about work — a piece the asker holds. ⚑ **D-016** — Ada's
      // own root counts, and is inferred when she names none, so the refusal is a piece she does
      // not hold.
      const toParent = await callOn(ada.tools, 'ask_question', {
        who_answers: 'the-parent',
        piece: 'W99',
        question: 'anyone?',
      })
      expect(toParent).toMatchObject({
        outcome: 'refused',
        rail: 'no-open-work-by-that-name',
        detail: { piece: 'W99' },
      })
    })
  })

  describe('§2 · no clock: withdrawn by the asker — and a recipient’s stop closes nothing (D-017)', () => {
    it('🔴 the asker withdraws it — and a late answer is refused as over', async () => {
      const { ada, bo } = await adaAndBo()
      // ⚑ **D-016 · about Ada's own root** (plan R14: a question about no piece holds nothing), so
      // the wait below has something to say.
      const id = await askBo(ada, bo, { piece: rootOf(ada.id) })
      const withdrawn = await callOn(ada.tools, 'withdraw_question', { question: id })
      expect(withdrawn.outcome, JSON.stringify(withdrawn)).toBe('ok')
      expect(questionOf(ada.id, id)?.state).toBe('withdrawn')
      expect(waitOf(ada.id)).toBeNull()
      const late = await callOn(bo.tools, 'answer_question', {
        question: id,
        asked_by: ada.id,
        answers: [{ part: 'answer', answer: ['too late'] }],
      })
      expect(late.rail).toBe('question-has-already-ended')
      // ⛔ Only the asker's own open question: again, or someone else's, is refused.
      const again = await callOn(ada.tools, 'withdraw_question', { question: id })
      expect(again.rail).toBe('no-open-question-you-asked-by-that-name')
      const second = await askBo(ada, bo)
      const notBos = await callOn(bo.tools, 'withdraw_question', { question: second })
      expect(notBos.rail).toBe('no-open-question-you-asked-by-that-name')
      expect(questionOf(ada.id, second)?.state).toBe('open')
    })

    it('🔴 a question its asker withdrew is refused at the PERSON’s door too — and never reaches the asker', async () => {
      // ⚠️ The person's door (`respondUserInput`) reads the words the app holds and never asks the
      // fold whether the question is open, so withdrawing must stop holding them. ⚑ The reach: the
      // person's queue drew the row, its rows are seconds old, and the press lands after the
      // withdrawal.
      const { worker, workerTools, piece, surface } = await aPmWithAWorkerOnATask()
      const asked = await callOn(workerTools, 'ask_question', {
        who_answers: 'a-person',
        piece,
        question: 'which timezone should the clock open on?',
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      const id = asked.question as string
      const inTheQueue = (): string[] =>
        host.questionsForAPerson().rows.map((row) => row.request.requestId)
      // ⛔ **THE PREMISE**: a question a person answers, drawn in the person's queue.
      expect(questionOf(worker, id)?.went.is).toBe('the-person-the-asker-named')
      expect(inTheQueue()).toContain(id)

      const withdrawn = await callOn(workerTools, 'withdraw_question', { question: id })
      expect(withdrawn.outcome, JSON.stringify(withdrawn)).toBe('ok')
      expect(inTheQueue()).not.toContain(id)
      const late = await host.respondUserInput(
        worker,
        id,
        { kind: 'answer', answers: { answer: ['UTC'] } },
        surface,
      )
      expect(late, JSON.stringify(late)).toMatchObject({ outcome: 'refused', stillOpen: false })
      expect(questionOf(worker, id)?.state).toBe('withdrawn')

      // ⚑ **THE CONTROL**: the same door, surface and worker take a person's answer to a question
      // still open — so the refusal above is the withdrawal's, and the answer it refused never came.
      const again = await callOn(workerTools, 'ask_question', {
        who_answers: 'a-person',
        piece,
        question: 'which locale should the clock open on?',
      })
      expect(again.outcome, JSON.stringify(again)).toBe('ok')
      const open = again.question as string
      const taken = await host.respondUserInput(
        worker,
        open,
        { kind: 'answer', answers: { answer: ['en-GB'] } },
        surface,
      )
      expect(taken.outcome, JSON.stringify(taken)).toBe('taken')
      await waitFor(
        () =>
          toldIn(worker).some((text) =>
            text.includes(
              `A person answered the question you asked about ${piece}, quoting ${open}.`,
            ),
          ),
        'the open question’s answer to reach the worker',
      )
      expect(toldIn(worker).some((text) => text.includes(`quoting ${id}.`))).toBe(false)
      expect(
        ledger(worker).some((event) => event.type === 'user_decision' && event.requestId === id),
      ).toBe(false)
    })

    it('🔴 the recipient’s conversation STOPS — the question stays open, the asker is told nothing, and its next message starts it again', async () => {
      // ⚑ **D-017 — this was ruling 5's ending** (*the recipient's conversation ENDS — the question
      // closes and the asker is told*). Nothing ends a conversation now (`end_agent` is gone), so
      // ruling 5 has no act left, and its three siblings here — the PERSON's door on an ended
      // recipient, *closes only what is OPEN*, and a child's question to a parent that ended — went
      // with it. ⚑ What is left is the stop, which was always this test's pair.
      const { ada, bo } = await adaAndTheHelperSheStarted()
      // ⚑ **D-016 · about Ada's own root** (plan R14: a question about no piece holds nothing), so
      // the wait below has something to say.
      const id = await askBo(ada, bo, { piece: rootOf(ada.id) })
      await waitFor(
        () => toldIn(bo.id).some((text) => text.includes(id)),
        'the question to reach Bo',
      )
      // ⛔ **D-017 · R3 — a Close is a STOP, and a stop ends nothing.** The next thing sent to Bo
      // starts it again, so the question is still Bo's to answer, and Ada is told nothing.
      await host.close(bo.id, THE_APP_ITSELF)
      expect(questionOf(ada.id, id)?.state).toBe('open')
      expect(waitOf(ada.id)).toBe('waiting-on-an-answer')
      expect(toldIn(ada.id).some((text) => text.includes(`${bo.id}'s conversation ended`))).toBe(
        false,
      )
      // ⚑ Ada's next message starts Bo again (R1) — and the question is still open, and still Bo's.
      // ⚑ **D-016** — a note: it is talk, not a follow-up on a piece.
      const sent = await callOn(ada.tools, 'message_agent', {
        agent: bo.id,
        text: 'never mind, I will look it up myself',
        kind: 'note',
      })
      expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
      expect(host.sessionIds).toContain(bo.id)
      expect(questionOf(ada.id, id)?.state).toBe('open')
      expect(ledger(ada.id).some((event) => event.type === 'question_recipient_ended')).toBe(false)
    })
  })

  describe('§3 · decision 4: a question survives a quit, as work does', () => {
    it('🔴 after a quit both are open, the question is still open, and its answer starts the asker', async () => {
      const { ada, bo } = await adaAndBo()
      const id = await askBo(ada, bo)
      await host.closeAll()
      // ⚑ The next launch, with its own store object (`a-next-launch-test-needs-its-own-store-object`).
      store = createSessionStore(db, tick)
      host = buildHost()
      // ⛔ **The quit was not the recipient's ending**, and it did not close the asker's question.
      expect(questionOf(ada.id, id)?.state).toBe('open')
      expect(REQUEST_IS_OPEN[questionOf(ada.id, id)?.state ?? 'answered']).toBe(true)

      // ⚑ Bo is opened again; Ada is still closed by the quit, running nothing.
      await host.resumeSession(bo.id, window)
      const boAgain = order.at(-1)
      if (boAgain === undefined) throw new Error('no toolset was handed to the reopen')
      const listed = await callOn(boAgain, 'list_questions', {})
      expect(JSON.stringify(listed)).toContain(id)
      const answered = await callOn(boAgain, 'answer_question', {
        question: id,
        asked_by: ada.id,
        answers: [{ part: 'answer', answer: ['still the one in schema.sql'] }],
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      // 🔴 **The answer started Ada and reached it** — the words came from Ada's own ledger.
      await waitFor(
        () => toldIn(ada.id).some((text) => text.includes('still the one in schema.sql')),
        'the answer to start Ada and reach it',
      )
      // ⛔ **W4.91 · held is not started.** `toldIn` counts a `message_queued` row, which the answer
      // writes into Ada's ledger before it starts her — so the line above passes with no start at
      // all (1009 M13 survived it). ⚑ The words go in as Ada's TURN only once she runs.
      await waitFor(
        () =>
          ledger(ada.id).some(
            (event) =>
              event.type === 'user_turn' && event.text.includes('still the one in schema.sql'),
          ),
        'the answer to go in as a turn of Ada started for it',
      )
      expect(questionOf(ada.id, id)?.state).toBe('answered')
    })
  })

  // ⚑ **D-017b · §3b is gone with the stamp it planted** — `SessionStore.theQuitIsClosing`, the quit's
  // mark before its teardown, was deleted: a stop ends nothing (D-017 · R3), so a quit's teardown
  // needs no mark to be told apart from an ending, and §2's stop is the same act without one.

  // ⚑ **D-016 · plan R14 — a question about no piece holds nothing**, so `609`'s composition case
  // (*an open question about no work holds every piece its asker holds*) went with
  // `anAnswerAboutNoWork`; a peer question holds the piece it NAMES, which is what §4 drives now.
  describe('§4 · a peer question never sends the asker’s giver a false stall notice', () => {
    /**
     * ⚑ A worker holding a piece asks a PEER about it, mid-turn — and the turn then ends with the
     * piece still open, which the fold alone would read as stalled.
     */
    const aWorkerThatAskedAPeerAndStopped = async () => {
      const rig = await aPmWithAWorkerOnATask()
      const bo = await personOpens('reviewer')
      // ⚑ Mid-turn, the worker asks a PEER, about the piece it holds (D-016: named, so it holds it).
      const asked = await callOn(rig.workerTools, 'ask_question', {
        who_answers: 'an-agent',
        agent: bo.id,
        piece: rig.piece,
        question: 'where is the style guide?',
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      const card = ledger(rig.worker)
        .filter(
          (event): event is TranscriptEvent & { type: 'permission_request'; id: string } =>
            event.type === 'permission_request',
        )
        .at(-1)
      if (card === undefined) throw new Error('no card')
      await host.respondPermission(rig.worker, card.id, { outcome: 'allow' }, rig.surface)
      await waitFor(
        () => ledger(rig.worker).some((event) => event.type === 'turn'),
        'the worker’s turn to end',
      )
      return rig
    }

    it('🔴 END TO END: a worker asks a peer and its turn ends — its giver reads it waiting, and is told nothing', async () => {
      const { pm, piece } = await aWorkerThatAskedAPeerAndStopped()
      // 🔴 **Waiting on an answer, not stalled** — and so nothing was pushed to its giver.
      const seen = host.pieceBoard(pm.id).gave.find((one) => one.label === piece)
      expect(seen?.state).toBe('waiting-on-an-answer')
      expect(toldIn(pm.id).some((text) => text.includes('not being worked on'))).toBe(false)
    })

    it('🔴 …and the person reads it the same way: no stalled row in their queue, waiting on the Work tab', async () => {
      // ⚠️ The test above reads the host's own wait read; the person's queue and the Work tab are
      // the STORE's composition of the same facts, and the two must not disagree about one task.
      const { pm, worker, piece } = await aWorkerThatAskedAPeerAndStopped()
      // ⛔ **THE PREMISE**: the fold alone calls it stalled — only the open question says otherwise.
      expect(store.piecesOwnedBy(worker).find((one) => one.label === piece)?.state).toBe('stalled')
      const workTab = host.workGivenBy(pm.id).rows.find((one) => one.label === piece)
      expect(workTab?.state).toBe('waiting-on-an-answer')
      expect(host.stalledWorkForAPerson().rows.map((row) => row.label)).not.toContain(piece)
    })
  })
})
