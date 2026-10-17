import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, TurnInProgress } from '@brobot2/runtime'
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
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 Message now · `message_agent` and `answer_question` with `interrupt: true`
 *
 * Landing coverage for the commit that let a sender hold a message, then ask the receiver's running
 * turn to stop so that it reads the message without waiting. ⚑ Hold FIRST, stop second; the stop
 * takes `interrupt_agent`'s rails and its entitlement (an agent the caller started, or one started
 * under it); the receiver reads who asked; the sender's receipt says what became of the stop and
 * promises no timing. ⛔ Without `interrupt` nothing here changes.
 *
 * Every arm runs on the real chain BroBot → Ada → Ali, built through `give_work`, and a negative is
 * read beside the positive it differs from by one fact.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

describe('message now · a message or an answer can stop the running turn', () => {
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
      // ⚑ **Bounded, because `interruptAgent` races the provider against it** — the Fake's
      // interrupt resolves at once, and a short deadline keeps a wedged one from holding the suite.
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-msgnow-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-msgnow-root-'))
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

  /** ⚑ The sentence a call answers with, beside what it structures. */
  const sentenceOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<string> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).text
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

  /**
   * 🔴 **Put a conversation into a WORKING turn**, which is the state the ruling is about.
   *
   * ⛔ **Not the Fake's ordinary turn**, which parks on a permission card — and `INTERRUPT_RAILS`
   * correctly refuses `a-person-is-being-asked`, so a fixture that used one would measure that
   * rail instead of this one. ⚑ A thinking burst makes the handle `working` and nothing else.
   */
  const makeItWork = async (handle: FakeSessionHandle): Promise<void> => {
    handle.simulateThinking({ text: 'driving the browser', redacted: false })
    await waitFor(() => handle.status() === 'working', 'the conversation to be working')
  }

  /**
   * ⚑ **D-016 · a give, and the child's first turn is its brief** — waited out to its END, so the
   * turn {@link makeItWork} starts is the only one in flight. ⛔ **The chain runs in `auto`** (BroBot
   * is opened so, and a child runs in its giver's mode): in `ask` every brief parks on a permission
   * card, and `INTERRUPT_RAILS` refuses `a-person-is-being-asked` — the rail this file must not
   * measure.
   */
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

  /**
   * 🔴 **BroBot → Ada → Ali, through the real door.**
   *
   * ⛔ **Every hop is a give** and not a hand-written provenance row: what the ruling walks is what
   * the rails wrote, and a fixture that wrote the chain itself would be measuring its own INSERT
   * (`a-fixture-built-with-the-helper-under-test-proves-nothing`, one table over).
   *
   * ⚠️ **Every tier holds the RULED grants** — nothing here grants anything, so the reach measured
   * is the one every install ships with.
   */
  const aChainOfThree = async (): Promise<{
    brobot: string
    ada: string
    ali: string
    /** ⚑ The piece Ada gave Ali — its id and its label. */
    aliPiece: string
    aliLabel: string
    aliHandle: FakeSessionHandle
    brobotTools: AgentToolset
    adaTools: AgentToolset
    pmProfile: string
    workerProfile: string
    /** ⚑ A SECOND worker identity, because a parent has ONE conversation with an identity — a
     * give to the same one reaches it (D-016's lookup). A sibling needs an identity of its own. */
    siblingProfile: string
  }> => {
    const nth = ++chains
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    const siblingProfile = `sibling-${String(nth)}`
    await bringIdentityIntoBeing(pmProfile)
    await bringIdentityIntoBeing(workerProfile)
    await bringIdentityIntoBeing(siblingProfile)
    const brobot = await personOpens(DEFAULT_PROFILE_ID, 'auto')
    const brobotTools = agentToolsFor(host, brobot)
    const ada = (await give(brobotTools, pmProfile, 'run the front-end work')).agent
    const adaTools = agentToolsFor(host, ada)
    const toAli = await give(adaTools, workerProfile, 'build the world-clock page')
    const ali = toAli.agent
    const aliHandle = latestHandle()
    return {
      brobot,
      ada,
      ali,
      aliPiece: toAli.piece,
      aliLabel: toAli.label,
      aliHandle,
      brobotTools,
      adaTools,
      pmProfile,
      workerProfile,
      siblingProfile,
    }
  }

  /** ⚑ The tools a conversation was handed. */
  const asTools = (sessionId: string): AgentToolset => agentToolsFor(host, sessionId)

  /** ⚑ What a conversation has been handed as a turn or a held message, in order. */
  const wordsReaching = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) =>
      event.type === 'user_turn' || event.type === 'message_queued' ? [event.text] : [],
    )

  /** ⚑ What the provider was handed, as the double echoes it — the framing is part of it. */
  const handedToTheProvider = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) =>
      event.type === 'assistant_message' && event.text.startsWith('echo: ') ? [event.text] : [],
    )

  const STOP_LINE = 'asked for the turn you were in to be stopped'

  describe('§1 · message_agent with interrupt', () => {
    it('🔴 the message is held, the running turn is asked to stop, and the receipt says so and promises no timing', async () => {
      const { ali, adaTools, aliHandle } = await aChainOfThree()
      await makeItWork(aliHandle)

      const said = await callOn(adaTools, 'message_agent', {
        agent: ali,
        text: 'stop and write down where you are',
        kind: 'note',
        interrupt: true,
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      expect(said.asked_to_stop, JSON.stringify(said)).toBe(true)
      expect(said.not_stopped_because).toBeUndefined()

      // The ask is recorded on the receiver's ledger, by the agent who made it.
      await waitFor(
        () => ledger(ali).some((event) => event.type === 'work_interrupted'),
        'the stop to be recorded',
      )
      // …and what the receiver reads says who asked, once the stopped turn is over.
      await waitFor(
        () => handedToTheProvider(ali).some((words) => words.includes('write down where you are')),
        'the message to reach the receiver',
      )
      const read = handedToTheProvider(ali).find((words) =>
        words.includes('write down where you are'),
      )!
      expect(read).toContain(STOP_LINE)
      expect(read).toContain('anything not named there still runs')
    })

    it('⚑ the receipt’s sentence states the intent and no timing, and the idle one says nothing was interrupted', async () => {
      const { ali, adaTools, aliHandle } = await aChainOfThree()
      const idle = await sentenceOn(adaTools, 'message_agent', {
        agent: ali,
        text: 'a note while nothing runs',
        kind: 'note',
        interrupt: true,
      })
      expect(idle).toContain(
        'No turn was running that needed stopping, so nothing was interrupted.',
      )

      await makeItWork(aliHandle)
      const running = await sentenceOn(adaTools, 'message_agent', {
        agent: ali,
        text: 'a note while it runs',
        kind: 'note',
        interrupt: true,
      })
      expect(running).toContain('need not wait for that work to finish')
      // ⚑ F084 — the stopped turn ended inside the wait, so the receipt says what its stop ended.
      expect(running).toContain('The stop ended none of its commands.')
      // The stop's own sentence (after the hold's), which promises when nothing happens.
      expect(running.slice(running.indexOf('The turn '))).not.toMatch(
        /immediately|at once|right away|does not wait/i,
      )
    })

    it('⚑ …and the control: the same message without interrupt stops nothing and carries no such line', async () => {
      const { ali, adaTools, aliHandle } = await aChainOfThree()
      await makeItWork(aliHandle)
      const said = await callOn(adaTools, 'message_agent', {
        agent: ali,
        text: 'whenever you are free, a note',
        kind: 'note',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      expect(said.asked_to_stop).toBeUndefined()
      expect(said.not_stopped_because).toBeUndefined()
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(ledger(ali).some((event) => event.type === 'work_interrupted')).toBe(false)
      for (const words of handedToTheProvider(ali)) expect(words).not.toContain(STOP_LINE)
    })

    it('⛔ a conversation that is idle needs no stop, and the receipt says nothing was interrupted', async () => {
      const { ali, adaTools } = await aChainOfThree()
      const said = await callOn(adaTools, 'message_agent', {
        agent: ali,
        text: 'a note for an agent with nothing running',
        kind: 'note',
        interrupt: true,
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      expect(said.asked_to_stop).toBe(false)
      expect(said.not_stopped_because).toBe('not-needed')
      expect(ledger(ali).some((event) => event.type === 'work_interrupted')).toBe(false)
    })

    it('⛔ an agent that is not below the sender is refused, nothing is sent, and the refusal says how to send it plainly', async () => {
      const { ada, ali, aliHandle, siblingProfile } = await aChainOfThree()
      await makeItWork(aliHandle)
      // Ali is Ada's child: Ali may not interrupt UP the chain.
      const upward = await callOn(asTools(ali), 'message_agent', {
        agent: ada,
        text: 'stop what you are doing',
        kind: 'note',
        interrupt: true,
      })
      expect(upward.outcome, JSON.stringify(upward)).toBe('refused')
      expect(JSON.stringify(upward)).toContain('that-agent-is-not-below-you')
      expect(JSON.stringify(upward)).toContain('without interrupt')
      expect(wordsReaching(ada).some((words) => words.includes('stop what you are doing'))).toBe(
        false,
      )
      expect(ledger(ada).some((event) => event.type === 'work_interrupted')).toBe(false)

      // The pair: the same words, without interrupt, are an ordinary message and are sent.
      const plain = await callOn(asTools(ali), 'message_agent', {
        agent: ada,
        text: 'stop what you are doing',
        kind: 'note',
      })
      expect(plain.outcome, JSON.stringify(plain)).toBe('ok')
      expect(siblingProfile).toBeTruthy()
    })

    it('🔴 interrupt classes message_agent as destroying work in flight — and an answer never asks a person (c118ae04)', () => {
      const tools = agentToolsFor(host, 'sess_unused')
      const message = tools.tools.find((one) => one.name === 'message_agent')!
      const answerQuestion = tools.tools.find((one) => one.name === 'answer_question')!
      expect(message.beyondItsRailsWhen?.({ interrupt: true })).toBe('it-destroys-work-in-flight')
      expect(message.beyondItsRailsWhen?.({ interrupt: false })).toBe(
        'nothing-its-rails-do-not-cover',
      )
      expect(message.beyondItsRailsWhen?.({})).toBe('nothing-its-rails-do-not-cover')
      // ⚑ Since c118ae04 an answer asks the asker's turn to stop by default, and no person is asked to
      // approve it, whatever `interrupt` says.
      for (const args of [{ interrupt: true }, { interrupt: false }, {}]) {
        expect(
          answerQuestion.beyondItsRailsWhen?.(args) ?? answerQuestion.beyondItsRails,
          JSON.stringify(args),
        ).toBe('nothing-its-rails-do-not-cover')
      }
    })
  })

  describe('§2 · answer_question with interrupt', () => {
    /** Ali asks its parent a question, and goes on working. */
    async function aliAsksAndKeepsWorking() {
      const asked = await aliAsks()
      await makeItWork(asked.aliHandle)
      return asked
    }

    /** Ali asks its parent a question between turns. */
    async function aliAsks() {
      const chain = await aChainOfThree()
      const asked = await callOn(asTools(chain.ali), 'ask_question', {
        who_answers: 'the-parent',
        piece: chain.aliPiece,
        question: 'which schema?',
        options: ['a', 'b'],
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      const row = store
        .routedRequestsOf(chain.ali)
        .filter((one) => one.went.is === 'the-parent')
        .at(-1)
      if (row === undefined) throw new Error('the question was not routed')
      return { ...chain, requestId: row.requestId }
    }

    it('🔴 an answer that asks for it stops the asker’s turn, and the asker reads who asked and that its questions stay open', async () => {
      const { ali, adaTools, requestId } = await aliAsksAndKeepsWorking()
      const said = await callOn(adaTools, 'answer_question', {
        question: requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
        interrupt: true,
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      expect(said.asked_to_stop, JSON.stringify(said)).toBe(true)
      await waitFor(
        () => ledger(ali).some((event) => event.type === 'work_interrupted'),
        'the stop to be recorded',
      )
      await waitFor(
        () => handedToTheProvider(ali).some((words) => words.includes(STOP_LINE)),
        'the answer to reach the asker',
      )
      const read = handedToTheProvider(ali).find((words) => words.includes(STOP_LINE))!
      expect(read).toContain('your open questions are still open')
    })

    /** Its turns from here stay working until the returned call releases them. */
    const holdItsTurns = (handle: FakeSessionHandle): (() => void) => {
      let release = (): void => {}
      const held = new Promise<void>((done) => {
        release = done
      })
      const internals = handle as unknown as {
        driveTurn(text: string, turnId: number): Promise<void>
      }
      const drive = internals.driveTurn.bind(handle)
      internals.driveTurn = async (text, turnId) => {
        await held
        return drive(text, turnId)
      }
      return () => {
        internals.driveTurn = drive
        release()
      }
    }

    /** A person's words go in to it, as from its window. */
    const aPersonWrites = async (sessionId: string): Promise<void> => {
      host.claimSession(sessionId, window)
      await host.send(sessionId, 'how is it going?', window)
    }

    /** Ada answers Ali's question, asking Ali's running turn to stop. */
    const adaAnswersNow = (adaTools: AgentToolset, requestId: string) =>
      callOn(adaTools, 'answer_question', {
        question: requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
        interrupt: true,
      })

    const itsTurnWasStopped = (sessionId: string): boolean =>
      ledger(sessionId).some((event) => event.type === 'work_interrupted')

    it('⛔ an answer asks no stop of a person’s turn that an agent’s words lost the race to', async () => {
      const { ali, adaTools, aliHandle, requestId } = await aliAsks()
      // Ada's note passes the first sign-in check, and waits at the one just before its handover.
      let checks = 0
      let holdFrom = Number.POSITIVE_INFINITY
      let releaseTheCheck = (): void => {}
      const checkHeld = new Promise<void>((done) => {
        releaseTheCheck = done
      })
      ;(aliHandle as unknown as { checkSignIn: () => Promise<boolean> }).checkSignIn = async () => {
        checks += 1
        if (checks >= holdFrom) await checkHeld
        return false
      }
      holdFrom = checks + 2
      const noting = callOn(adaTools, 'message_agent', {
        agent: ali,
        kind: 'note',
        text: 'the dates moved',
      })
      await waitFor(() => checks === holdFrom, 'the note to wait at its last sign-in check')
      holdFrom = Number.POSITIVE_INFINITY
      // A person's words go in meanwhile, and their turn is held working.
      const release = holdItsTurns(aliHandle)
      await aPersonWrites(ali)
      try {
        // The note reaches its handover, the provider refuses it for that turn, and it is held.
        const send = aliHandle.send.bind(aliHandle)
        const refused: unknown[] = []
        aliHandle.send = async (...args: Parameters<typeof send>) => {
          try {
            await send(...args)
          } catch (error) {
            refused.push(error)
            throw error
          }
        }
        releaseTheCheck()
        expect((await noting).outcome).toBe('ok')
        expect(refused).toHaveLength(1)
        expect(refused[0]).toBeInstanceOf(TurnInProgress)
        const said = await adaAnswersNow(adaTools, requestId)
        expect(said.outcome, JSON.stringify(said)).toBe('ok')
        expect(said.asked_to_stop, JSON.stringify(said)).toBe(false)
        expect(said.not_stopped_because).toBe('a-person-started-its-turn')
        expect(itsTurnWasStopped(ali)).toBe(false)
      } finally {
        release()
      }
    })

    it('⛔ an answer asks no stop of a person’s turn once an agent’s turn before it settles late', async () => {
      const { ali, adaTools, aliHandle, requestId } = await aliAsks()
      const turnsBefore = ledger(ali).filter((event) => event.type === 'turn').length
      // Ada's note goes in and its turn ends, but the call that handed it over settles only later.
      const send = aliHandle.send.bind(aliHandle)
      let settle = (): void => {}
      const settled = new Promise<void>((done) => {
        settle = done
      })
      let first = true
      aliHandle.send = async (...args: Parameters<typeof send>) => {
        await send(...args)
        if (!first) return
        first = false
        await settled
      }
      const noting = callOn(adaTools, 'message_agent', {
        agent: ali,
        kind: 'note',
        text: 'the dates moved',
      })
      await waitFor(
        () => ledger(ali).filter((event) => event.type === 'turn').length === turnsBefore + 1,
        'the note’s turn to end',
      )
      // A person's words go in, and their turn is held working; then the note's turn row lands.
      const release = holdItsTurns(aliHandle)
      try {
        await aPersonWrites(ali)
        settle()
        expect((await noting).outcome).toBe('ok')
        const turns = ledger(ali).flatMap((event) =>
          event.type === 'user_turn' ? [event.text] : [],
        )
        expect(turns.at(-2)).toContain('how is it going?')
        expect(turns.at(-1)).toContain('the dates moved')
        const said = await adaAnswersNow(adaTools, requestId)
        expect(said.outcome, JSON.stringify(said)).toBe('ok')
        expect(said.not_stopped_because).toBe('a-person-started-its-turn')
        expect(itsTurnWasStopped(ali)).toBe(false)
      } finally {
        release()
      }
    })

    it('⛔ an answer asks no stop of a turn its provider began by itself after a person’s', async () => {
      const { ali, adaTools, aliHandle, requestId } = await aliAsks()
      const turnsBefore = ledger(ali).filter((event) => event.type === 'turn').length
      await aPersonWrites(ali)
      await waitFor(
        () => ledger(ali).filter((event) => event.type === 'turn').length === turnsBefore + 1,
        'the person’s turn to end',
      )
      await makeItWork(aliHandle)
      const said = await adaAnswersNow(adaTools, requestId)
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      expect(said.not_stopped_because).toBe('a-person-started-its-turn')
      expect(itsTurnWasStopped(ali)).toBe(false)
    })

    it('🔴 an answer stops a running turn an agent’s words opened, after a person’s turn has ended', async () => {
      const { ali, adaTools, aliHandle, requestId } = await aliAsks()
      const turnsBefore = ledger(ali).filter((event) => event.type === 'turn').length
      await aPersonWrites(ali)
      await waitFor(
        () => ledger(ali).filter((event) => event.type === 'turn').length === turnsBefore + 1,
        'the person’s turn to end',
      )
      const release = holdItsTurns(aliHandle)
      try {
        const noted = await callOn(adaTools, 'message_agent', {
          agent: ali,
          kind: 'note',
          text: 'the dates moved',
        })
        expect(noted.outcome).toBe('ok')
        expect(aliHandle.status()).toBe('working')
        const said = await adaAnswersNow(adaTools, requestId)
        expect(said.outcome, JSON.stringify(said)).toBe('ok')
        expect(said.asked_to_stop, JSON.stringify(said)).toBe(true)
        await waitFor(() => itsTurnWasStopped(ali), 'the stop to be recorded')
      } finally {
        release()
      }
    })

    it('⚑ …and the control: an answer with interrupt: false is held and stops nothing', async () => {
      const { ali, adaTools, requestId } = await aliAsksAndKeepsWorking()
      const said = await callOn(adaTools, 'answer_question', {
        question: requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
        interrupt: false,
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      expect(said.asked_to_stop).toBeUndefined()
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(ledger(ali).some((event) => event.type === 'work_interrupted')).toBe(false)
    })

    it('⛔ an interrupt flag that is not a boolean is a malformed request, not a stop', async () => {
      const { adaTools, requestId, ali } = await aliAsksAndKeepsWorking()
      const said = await callOn(adaTools, 'answer_question', {
        question: requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
        interrupt: 'yes',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('refused')
      expect(ledger(ali).some((event) => event.type === 'work_interrupted')).toBe(false)
    })
  })
})
