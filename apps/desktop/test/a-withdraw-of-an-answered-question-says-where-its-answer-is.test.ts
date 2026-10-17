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
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # F020 · a withdraw refused because the question was just answered says so, and where the answer is
 *
 * Landing coverage for `39c9978d`. An agent that withdrew its own question after it had been answered
 * or declined was told only that it had no open question by that id, and reported without the
 * answer that was on its way. ⚑ Now the refusal says the question was already answered (or
 * declined), that nothing was withdrawn, and puts first what to do about the answer — by where it
 * is: held behind a turn being stopped for it, held until that turn ends, held until the usage limit
 * resets, or already sent. ⚑ The detail carries `state`, `at` and `itsAnswer`.
 *
 * ⛔ Every other refusal of `withdraw_question` is unchanged: an unknown id, somebody else's
 * question, a provider's own question, another ending. And a question still open IS withdrawn.
 *
 * ⚑ Every arm runs on the real chain BroBot → Ada → Ali, built through `give_work` in `auto` (the
 * harness of `message-now-stops-the-turn-it-reads-in`): Ali asks Ada, and a BUSY Ali — a thinking
 * burst, so its handle is `working` with no card up — is what holds Ada's answer in its mailbox.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const HOUR = 3_600_000

/** ⚑ The rail's own sentence, which every refusal that is not about an answered question keeps. */
const NO_OPEN_QUESTION =
  'you have no open question by that id — you did not ask it, or it has ended — so nothing was withdrawn. Use the id ask_question returned; withdrawing this one again will never succeed.'

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

describe('F020 · a withdraw of a question already answered says so, and where its answer is', () => {
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
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let chains: number
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      // ⚑ Bounded: the stop an answer asks is raced against it, and a gated one must not hold the suite.
      interruptWaitMs: 40,
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f020-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-f020-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    chains = 0
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
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

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  /** ⚑ A thinking burst: the handle is `working`, no card is up, and no turn of ours is open. */
  const makeItWork = async (handle: FakeSessionHandle): Promise<void> => {
    handle.simulateThinking({ text: 'driving the browser', redacted: false })
    await waitFor(() => handle.status() === 'working', 'the conversation to be working')
  }

  /** ⚑ A give, waited out to the END of the child's brief turn. */
  const give = async (
    tools: AgentToolset,
    profile: string,
    title: string,
  ): Promise<{ agent: string; piece: string; label: string }> => {
    const given = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief: title,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.started, JSON.stringify(given)).toBe(true)
    const agent = given.agent as string
    await waitFor(
      () => ledger(agent).some((event) => event.type === 'turn'),
      'the brief’s turn to end',
    )
    return { agent, piece: given.piece as string, label: given.label as string }
  }

  /** ⚑ BroBot → Ada → Ali, through the real door, in `auto`. */
  const aChainOfThree = async (): Promise<{
    brobot: string
    ada: string
    ali: string
    aliPiece: string
    adaHandle: FakeSessionHandle
    aliHandle: FakeSessionHandle
    adaTools: AgentToolset
  }> => {
    const nth = ++chains
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    await bringIdentityIntoBeing(pmProfile)
    await bringIdentityIntoBeing(workerProfile)
    const brobot = await personOpens(DEFAULT_PROFILE_ID, 'auto')
    const brobotTools = agentToolsFor(host, brobot)
    const ada = (await give(brobotTools, pmProfile, 'run the front-end work')).agent
    const adaHandle = latestHandle()
    const adaTools = agentToolsFor(host, ada)
    const toAli = await give(adaTools, workerProfile, 'build the world-clock page')
    return {
      brobot,
      ada,
      ali: toAli.agent,
      aliPiece: toAli.piece,
      adaHandle,
      aliHandle: latestHandle(),
      adaTools,
    }
  }

  const asTools = (sessionId: string): AgentToolset => agentToolsFor(host, sessionId)

  /** ⚑ What a conversation has been handed as a turn or a held message, in order. */
  const wordsReaching = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) =>
      event.type === 'user_turn' || event.type === 'message_queued' ? [event.text] : [],
    )

  /** ⚑ What the provider was handed, as the double echoes it. */
  const handedToTheProvider = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) =>
      event.type === 'assistant_message' && event.text.startsWith('echo: ') ? [event.text] : [],
    )

  const questionOf = (asker: string, requestId: string) =>
    store
      .routedRequestsOf(asker)
      .filter((one) => one.requestId === requestId)
      .at(-1)

  /** ⚑ Ali asks its parent, Ada, about the piece it holds. */
  const aliAsks = async (ali: string, aliPiece: string): Promise<string> => {
    const asked = await callOn(asTools(ali), 'ask_question', {
      who_answers: 'the-parent',
      piece: aliPiece,
      question: 'which schema?',
      options: ['a', 'b'],
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    return asked.question as string
  }

  /** ⚑ …and goes on working, so an answer is held behind its running burst. */
  const aliAsksAndKeepsWorking = async () => {
    const chain = await aChainOfThree()
    const id = await aliAsks(chain.ali, chain.aliPiece)
    await makeItWork(chain.aliHandle)
    return { ...chain, id }
  }

  const withdraw = (sessionId: string, id: string): Promise<Record<string, unknown>> =>
    callOn(asTools(sessionId), 'withdraw_question', { question: id })

  const answerAs = (
    tools: AgentToolset,
    ali: string,
    id: string,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> =>
    callOn(tools, 'answer_question', {
      question: id,
      asked_by: ali,
      answers: [{ part: 'answer', answer: ['b'] }],
      ...extra,
    })

  const quoting = (id: string): string => `quoting ${id}.`

  /** ⚑ Nothing was withdrawn: the fold still reads the ending, and no withdrawal was written. */
  const nothingWasWithdrawn = (ali: string, id: string, state: 'answered' | 'rejected'): void => {
    expect(questionOf(ali, id)?.state).toBe(state)
    expect(
      ledger(ali).some((event) => event.type === 'question_withdrawn' && event.requestId === id),
    ).toBe(false)
  }

  describe('§1 · where the answer is, said first', () => {
    it('🔴 already sent: the refusal says to read it, the detail says answered, when, and already-sent', async () => {
      const { ali, aliPiece, adaTools } = await aChainOfThree()
      const id = await aliAsks(ali, aliPiece)
      const answered = await answerAs(adaTools, ali, id)
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      // ⚑ Ali was idle, so the answer went straight in, and the provider has it.
      await waitFor(
        () => handedToTheProvider(ali).some((words) => words.includes(quoting(id))),
        'the answer to reach Ali',
      )

      const refused = await withdraw(ali, id)
      expect(refused, JSON.stringify(refused)).toMatchObject({
        outcome: 'refused',
        rail: 'no-open-question-you-asked-by-that-name',
        detail: { question: id, state: 'answered', itsAnswer: 'already-sent' },
      })
      expect(refused.reason).toBe(
        'read its answer, which was sent to you as a message: that question was already answered, so nothing was withdrawn.',
      )
      // ⚑ `at` is when it ended, as the fold has it.
      const at = (refused.detail as { at?: unknown }).at
      expect(typeof at).toBe('number')
      expect(at).toBe(questionOf(ali, id)?.endedAt)
      nothingWasWithdrawn(ali, id, 'answered')
    })

    it('🔴 held until this turn ends: an answer with interrupt: false waits behind the running turn, and the refusal says to end it', async () => {
      const { ali, adaTools, aliHandle, id } = await aliAsksAndKeepsWorking()
      const answered = await answerAs(adaTools, ali, id, { interrupt: false })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      // ⛔ THE PREMISE: held for Ali, and not yet handed to its provider.
      expect(wordsReaching(ali).some((words) => words.includes(quoting(id)))).toBe(true)
      expect(handedToTheProvider(ali).some((words) => words.includes(quoting(id)))).toBe(false)

      const refused = await withdraw(ali, id)
      expect(refused, JSON.stringify(refused)).toMatchObject({
        outcome: 'refused',
        rail: 'no-open-question-you-asked-by-that-name',
        detail: { question: id, state: 'answered', itsAnswer: 'held-until-this-turn-ends' },
      })
      expect(refused.reason).toBe(
        'end this turn to read its answer before you report on that question: it was already answered, so nothing was withdrawn, and its answer is held for you until this turn ends.',
      )
      nothingWasWithdrawn(ali, id, 'answered')

      // ⚑ THE PAIR: the burst ends, the held answer goes in — and the same withdraw now reads it as sent.
      await aliHandle.interrupt()
      await waitFor(
        () => handedToTheProvider(ali).some((words) => words.includes(quoting(id))),
        'the held answer to reach Ali once its turn ended',
      )
      const again = await withdraw(ali, id)
      expect(again.detail, JSON.stringify(again)).toMatchObject({
        state: 'answered',
        itsAnswer: 'already-sent',
      })
    })

    it('🔴 held, and this turn is being stopped for it: the refusal says to stop here, and the answer comes in once the stop lands', async () => {
      const { ali, adaTools, aliHandle, id } = await aliAsksAndKeepsWorking()
      // ⚑ The provider takes its time answering the stop, so the ask stands while Ali withdraws.
      const gate: { release: () => void } = { release: () => undefined }
      const theStopLands = new Promise<void>((resolve) => {
        gate.release = resolve
      })
      const providerInterrupt = aliHandle.interrupt.bind(aliHandle)
      aliHandle.interrupt = async (): Promise<void> => {
        await theStopLands
        await providerInterrupt()
      }

      // ⚑ The default: an answer to an asker below asks its running turn to stop.
      const answered = await answerAs(adaTools, ali, id)
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      expect(answered.asked_to_stop, JSON.stringify(answered)).toBe(true)

      const refused = await withdraw(ali, id)
      expect(refused, JSON.stringify(refused)).toMatchObject({
        outcome: 'refused',
        rail: 'no-open-question-you-asked-by-that-name',
        detail: { question: id, state: 'answered', itsAnswer: 'held-and-this-turn-is-stopping' },
      })
      expect(refused.reason).toBe(
        'stop here and read its answer: that question was already answered, so nothing was withdrawn. This turn is being stopped, so its answer, held for you, comes in now.',
      )
      nothingWasWithdrawn(ali, id, 'answered')

      // ⚑ THE PAIR: the stop lands, the answer goes in, and the same withdraw reads it as sent.
      gate.release()
      await waitFor(
        () => handedToTheProvider(ali).some((words) => words.includes(quoting(id))),
        'the answer to reach Ali once its turn was stopped',
      )
      const again = await withdraw(ali, id)
      expect(again.detail, JSON.stringify(again)).toMatchObject({ itsAnswer: 'already-sent' })
    })

    it('🔴 held until the usage limit resets: only Claude’s own wall moves it there — another provider’s does not', async () => {
      const { ada, ali, adaHandle, adaTools, aliHandle, id } = await aliAsksAndKeepsWorking()
      // ⚠️ A Claude turn that COMPLETES after a wall retracts it (`foldProviderLimits`): Ada's turn on
      // Ali's question is waited out first, so nothing Claude runs lands after the wall below.
      await waitFor(
        () =>
          handedToTheProvider(ada).some((words) => words.includes(id)) &&
          adaHandle.status() === 'idle',
        'Ada’s turn on the question to end',
      )
      const answered = await answerAs(adaTools, ali, id, { interrupt: false })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      const errorsBefore = ledger(ali).filter((event) => event.type === 'error').length

      // ⛔ THE CONTROL: Codex is at its limit, and Ali runs on Claude — the turn's end still decides.
      aliHandle.simulateError(
        `codex is rate-limited (rate_limit_reached) — the turn may stall until it resets; resets ${new Date(clock + HOUR).toISOString()}`,
        false,
      )
      await waitFor(
        () => ledger(ali).filter((event) => event.type === 'error').length === errorsBefore + 1,
        'Codex’s wall to be recorded',
      )
      const codexWalled = await withdraw(ali, id)
      expect(codexWalled.detail, JSON.stringify(codexWalled)).toMatchObject({
        itsAnswer: 'held-until-this-turn-ends',
      })

      // 🔴 Claude's own wall, with a reset ahead: the answer waits for this turn's end, and for the
      // reset only if the limit outlives it (W4.172: a turn that completes ends the limit's hold).
      aliHandle.simulateError(
        `claude is rate-limited (five_hour) — the turn may stall until it resets; resets ${new Date(clock + HOUR).toISOString()}`,
        false,
      )
      await waitFor(
        () => ledger(ali).filter((event) => event.type === 'error').length === errorsBefore + 2,
        'Claude’s wall to be recorded',
      )
      const refused = await withdraw(ali, id)
      expect(refused, JSON.stringify(refused)).toMatchObject({
        outcome: 'refused',
        rail: 'no-open-question-you-asked-by-that-name',
        detail: { question: id, state: 'answered', itsAnswer: 'held-until-the-limit-resets' },
      })
      expect(refused.reason).toBe(
        'end this turn to read its answer before you report on that question: it was already answered, so nothing was withdrawn, and its answer is held for you until this turn ends, or longer if your usage limit still holds then.',
      )
      nothingWasWithdrawn(ali, id, 'answered')
    })
  })

  describe('§2 · a declined question reads the same arms, with the reply declining it', () => {
    it('🔴 a decline held behind the running turn: state rejected, and the reply declining it is held until the turn ends', async () => {
      const { ali, adaTools, id } = await aliAsksAndKeepsWorking()
      const declined = await callOn(adaTools, 'answer_question', {
        question: id,
        asked_by: ali,
        cannot_answer: 'I have not chosen a schema yet',
        interrupt: false,
      })
      expect(declined.outcome, JSON.stringify(declined)).toBe('ok')

      const refused = await withdraw(ali, id)
      expect(refused, JSON.stringify(refused)).toMatchObject({
        outcome: 'refused',
        rail: 'no-open-question-you-asked-by-that-name',
        detail: { question: id, state: 'rejected', itsAnswer: 'held-until-this-turn-ends' },
      })
      expect(refused.reason).toBe(
        'end this turn to read the reply declining it before you report on that question: it was already declined, so nothing was withdrawn, and the reply declining it is held for you until this turn ends.',
      )
      // ⛔ …and never in an answer's words.
      expect(String(refused.reason)).not.toContain('already answered')
      nothingWasWithdrawn(ali, id, 'rejected')
    })

    it('⚑ a decline already sent: the refusal says to read the reply declining it', async () => {
      const { ali, aliPiece, adaTools } = await aChainOfThree()
      const id = await aliAsks(ali, aliPiece)
      const declined = await callOn(adaTools, 'answer_question', {
        question: id,
        asked_by: ali,
        cannot_answer: 'I have not chosen a schema yet',
      })
      expect(declined.outcome, JSON.stringify(declined)).toBe('ok')
      await waitFor(
        () => handedToTheProvider(ali).some((words) => words.includes(quoting(id))),
        'the decline to reach Ali',
      )

      const refused = await withdraw(ali, id)
      expect(refused.detail, JSON.stringify(refused)).toMatchObject({
        question: id,
        state: 'rejected',
        itsAnswer: 'already-sent',
      })
      expect(refused.reason).toBe(
        'read the reply declining it, which was sent to you as a message: that question was already declined, so nothing was withdrawn.',
      )
    })
  })

  describe('§3 · every other refusal of withdraw_question is unchanged', () => {
    it('⚑ a question still open IS withdrawn — and withdrawing it again is the plain refusal, with no answer to point at', async () => {
      const { ali, aliPiece, adaTools } = await aChainOfThree()
      const id = await aliAsks(ali, aliPiece)
      const withdrawn = await withdraw(ali, id)
      expect(withdrawn, JSON.stringify(withdrawn)).toEqual({ outcome: 'ok', question: id })
      expect(questionOf(ali, id)?.state).toBe('withdrawn')
      // ⚑ A late answer is refused as over.
      const late = await answerAs(adaTools, ali, id)
      expect(late.rail, JSON.stringify(late)).toBe('question-has-already-ended')

      // ⛔ Withdrawn is another ending: the rail's own sentence, and a detail with nothing beside the id.
      const again = await withdraw(ali, id)
      expect(again).toMatchObject({
        outcome: 'refused',
        rail: 'no-open-question-you-asked-by-that-name',
      })
      expect(again.reason).toBe(NO_OPEN_QUESTION)
      expect(again.detail).toEqual({ question: id })
    })

    it('⛔ an id nobody asked: the plain refusal, unchanged', async () => {
      const { ali } = await aChainOfThree()
      const refused = await withdraw(ali, 'req_nobody-asked-this')
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'no-open-question-you-asked-by-that-name',
      })
      expect(refused.reason).toBe(NO_OPEN_QUESTION)
      expect(refused.detail).toEqual({ question: 'req_nobody-asked-this' })
    })

    it('⛔ an answered question that is not yours: the plain refusal — never where somebody else’s answer is', async () => {
      const { brobot, ada, ali, aliPiece, adaTools } = await aChainOfThree()
      const id = await aliAsks(ali, aliPiece)
      const answered = await answerAs(adaTools, ali, id)
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      await waitFor(
        () => handedToTheProvider(ali).some((words) => words.includes(quoting(id))),
        'the answer to reach Ali',
      )
      // ⛔ Ada answered it and BroBot is above it: neither asked it.
      for (const other of [ada, brobot]) {
        const refused = await withdraw(other, id)
        expect(refused.rail, other).toBe('no-open-question-you-asked-by-that-name')
        expect(refused.reason, other).toBe(NO_OPEN_QUESTION)
        expect(refused.detail, other).toEqual({ question: id })
      }
      // ⚑ THE PAIR: the one who asked it is told it was answered.
      const own = await withdraw(ali, id)
      expect(own.detail).toMatchObject({ state: 'answered', itsAnswer: 'already-sent' })
    })

    it('⛔ its own MODEL’s question, answered: the plain refusal — the app did not ask it', async () => {
      const { ali, aliHandle, adaTools } = await aChainOfThree()
      const raised = aliHandle.simulateUserInput('which branch?', ['main', 'dev'])
      await waitFor(
        () => questionOf(ali, raised.id) !== undefined,
        `the routing of ${raised.id} on ${ali}`,
      )
      expect(store.questionsRaisedIn(ali).get(raised.id)?.raisedBy).not.toBe('this-app')
      const answered = await callOn(adaTools, 'answer_question', {
        question: raised.id,
        asked_by: ali,
        answers: [{ part: 'q0', answer: ['main'] }],
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      await waitFor(
        () => questionOf(ali, raised.id)?.state === 'answered',
        'the model’s question to read answered',
      )

      const refused = await withdraw(ali, raised.id)
      expect(refused.rail, JSON.stringify(refused)).toBe('no-open-question-you-asked-by-that-name')
      expect(refused.reason).toBe(NO_OPEN_QUESTION)
      expect(refused.detail).toEqual({ question: raised.id })
    })
  })
})
