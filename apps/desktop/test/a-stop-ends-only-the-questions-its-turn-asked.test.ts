import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { theQuestionsAStopEnded } from '../src/main/runtime/turn-origin'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { REQUEST_IS_OPEN, type RequestState } from '../src/shared/questions'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * A stop of a conversation's turn ends the questions that turn asked, and every card its provider
 * holds. A question this app raised for it in an earlier turn stays open, with its place in front
 * of a person. Whatever of its own a stop ends, the conversation is told in front of its next
 * words, once, and after a restart too.
 *
 * Real host, real SQLite ledger, real rails; the only double is the provider. In `ask` mode the
 * double's every turn waits on a permission card, which is how a turn is kept running here and
 * how it is ended (by answering the card).
 */

describe('a stop ends only the questions its turn asked, and tells the asker', () => {
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
      started.push(handle)
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
  /** Every handle a start issued, in order: a give's helper is the newest. */
  let started: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  /** How far the clock moves at each read: one millisecond, none, or back. */
  let step: number
  let window: RecordingSink
  const tick = (): number => {
    const at = clock
    clock += step
    return at
  }

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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-stop-questions-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-stop-questions-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    step = 1
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    started = []
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
   * ⚑ **The chain `HO-088` §1 watched**: a PM in a window, a worker it gave one piece of work.
   *
   * ⛔ It is the shape every assertion here needs: a conversation with a parent, holding work it
   * can ask about. No grant is set for the give (D-014: any agent may give work to any agent).
   * ⚑ **D-016 · the give starts the worker, and its brief is the worker's first turn** — in the
   * PM's `ask` that turn parks on a permission card.
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
      brief: 'gather the requirements',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerTools = theToolsetJustHandedOut()
    const open = store.piecesOwnedBy(worker).find((one) => TASK_IS_OPEN[one.state])
    if (open === undefined) throw new Error('the give never opened a piece')
    return { pm, worker, pmTools, workerTools, piece: open.piece }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────

  const EARLIER = 'did the rest of the Mac freeze at about 17:05?'
  const LATER = 'which port does the other one use?'
  const WAS_ENDED = 'was ended unanswered when your turn was stopped'

  const turnsEnded = (id: string): number =>
    ledger(id).filter((event) => event.type === 'turn').length
  /** The card the turn that runs waits on: the newest one its provider raised. */
  const theCardItWaitsOn = (id: string): string => {
    const card = ledger(id)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (card === undefined || card.type !== 'permission_request') throw new Error('no card')
    return card.id
  }
  const cardsRaised = (id: string): number =>
    ledger(id).filter((event) => event.type === 'permission_request').length
  /** The words each turn handed its provider, as the double says them back. */
  const handedOver = (id: string): string[] =>
    ledger(id).flatMap((event) =>
      event.type === 'assistant_message' && event.text.startsWith('echo: ') ? [event.text] : [],
    )
  const stateOf = (id: string, requestId: string): RequestState | undefined =>
    store.routedRequestsOf(id).find((one) => one.requestId === requestId)?.state
  const endedByAStop = (id: string): string[] =>
    ledger(id).flatMap((event) => (event.type === 'request_interrupted' ? [event.requestId] : []))
  const waitingOnAPerson = (): string[] =>
    host.questionsForAPerson().rows.map((one) => one.request.requestId)
  const asks = async (tools: AgentToolset, piece: string, question: string): Promise<string> => {
    const asked = await callOn(tools, 'ask_question', { piece, question, who_answers: 'a-person' })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    return asked.question as string
  }

  /**
   * A helper whose first turn asked a person a question and ended, and whose second turn — a
   * person's message — asked another and is still running, waiting on its provider's card.
   */
  const aSecondTurnThatRuns = async (): Promise<{
    worker: string
    pmTools: AgentToolset
    surface: RecordingSink
    earlier: string
    later: string
    itsCard: string
  }> => {
    const { worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
    const surface = new RecordingSink('webContents:8')
    host.claimSession(worker, surface)
    await waitFor(() => cardsRaised(worker) === 1, 'its first turn to wait on its card')
    const earlier = await asks(workerTools, piece, EARLIER)
    await host.respondPermission(worker, theCardItWaitsOn(worker), { outcome: 'allow' }, surface)
    await waitFor(() => turnsEnded(worker) === 1, 'its first turn to end')
    await host.send(worker, 'also start the other one', surface)
    await waitFor(() => cardsRaised(worker) === 2, 'its second turn to wait on its card')
    const later = await asks(workerTools, piece, LATER)
    return { worker, pmTools, surface, earlier, later, itsCard: theCardItWaitsOn(worker) }
  }

  /** What every stop of that second turn must leave: the earlier question open, the rest ended. */
  const theEarlierOneIsStillOpen = (
    worker: string,
    earlier: string,
    later: string,
    itsCard: string,
  ): void => {
    const earlierState = stateOf(worker, earlier)
    expect(earlierState !== undefined && REQUEST_IS_OPEN[earlierState], earlierState).toBe(true)
    expect(waitingOnAPerson()).toContain(earlier)
    // ⚑ The turn's own question ends, and so does the card its provider held.
    expect(stateOf(worker, later)).toBe('interrupted')
    expect(stateOf(worker, itsCard)).toBe('interrupted')
    expect(waitingOnAPerson()).not.toContain(later)
    expect(endedByAStop(worker).sort()).toEqual([later, itsCard].sort())
  }

  it('🔴 a person’s Stop of a later turn leaves an earlier turn’s question open, ends the stopped turn’s own and its provider’s card, and the asker is told once', async () => {
    const { worker, surface, earlier, later, itsCard } = await aSecondTurnThatRuns()
    await host.interrupt(worker, surface)
    await waitFor(() => turnsEnded(worker) === 2, 'the stopped turn to end')
    theEarlierOneIsStillOpen(worker, earlier, later, itsCard)
    // ⛔ The stop itself hands over no words.
    expect(handedOver(worker)).toHaveLength(2)

    // Its next words say which question the stop ended, by its id and what it asked.
    await host.send(worker, 'go on', surface)
    await waitFor(() => handedOver(worker).length === 3, 'its next words to be handed over')
    const next = handedOver(worker)[2] ?? ''
    expect(next).toContain(
      `Your question ${later} (“${LATER}”) was ended unanswered when your turn was stopped. Ask it again if you still need the answer.`,
    )
    expect(next).toContain(theQuestionsAStopEnded([{ id: later, prompt: LATER }]))
    expect(next).toContain('go on')
    // ⛔ Nothing of the earlier question is said: it is still open.
    expect(withoutWhatThisAppAdds(next)).not.toContain(earlier)

    // …and once only.
    await waitFor(() => cardsRaised(worker) === 3, 'that turn to wait on its card')
    await host.respondPermission(worker, theCardItWaitsOn(worker), { outcome: 'allow' }, surface)
    await waitFor(() => turnsEnded(worker) === 3, 'that turn to end')
    await host.send(worker, 'and again', surface)
    await waitFor(() => handedOver(worker).length === 4, 'the turn after it')
    expect(handedOver(worker)[3]).not.toContain(WAS_ENDED)
    // ⚑ The earlier question can still be answered, and its answer is taken.
    expect(waitingOnAPerson()).toContain(earlier)
    const answered = await host.respondUserInput(
      worker,
      earlier,
      { kind: 'answer', answers: { answer: 'Yes, all of it' } },
      surface,
    )
    expect(answered.outcome, JSON.stringify(answered)).toBe('taken')
    expect(stateOf(worker, earlier)).toBe('answered')
    expect(waitingOnAPerson()).not.toContain(earlier)
  })

  it('🔴 a message sent over a running turn leaves the earlier question open, and its own words carry the line', async () => {
    const { worker, surface, earlier, later, itsCard } = await aSecondTurnThatRuns()
    await host.sendInterrupting(worker, 'stop that, do this instead', surface)
    await waitFor(() => handedOver(worker).length === 3, 'the message to be handed over')
    theEarlierOneIsStillOpen(worker, earlier, later, itsCard)
    const next = handedOver(worker)[2] ?? ''
    expect(next).toContain('stop that, do this instead')
    expect(next).toContain(theQuestionsAStopEnded([{ id: later, prompt: LATER }]))
  })

  it('🔴 an agent’s interrupt leaves the earlier question open too, and ends what was asked since', async () => {
    // ⚑ An agent may not stop a conversation that waits on a person's card, so here the helper
    // works with no card: its provider began working by itself after its first turn ended.
    const { worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
    const itsHandle = started.at(-1)
    if (itsHandle === undefined) throw new Error('the give started no helper')
    const surface = new RecordingSink('webContents:8')
    host.claimSession(worker, surface)
    await waitFor(() => cardsRaised(worker) === 1, 'its first turn to wait on its card')
    const earlier = await asks(workerTools, piece, EARLIER)
    await host.respondPermission(worker, theCardItWaitsOn(worker), { outcome: 'allow' }, surface)
    await waitFor(() => turnsEnded(worker) === 1, 'its first turn to end')
    itsHandle.simulateThinking({ text: 'deciding what to do', redacted: false })
    await waitFor(() => itsHandle.status() === 'working', 'the helper to be working')
    const later = await asks(workerTools, piece, LATER)

    const stopped = await callOn(pmTools, 'interrupt_agent', {
      agent: worker,
      reason: 'no longer needed',
    })
    expect(stopped.outcome, JSON.stringify(stopped)).toBe('ok')
    const earlierState = stateOf(worker, earlier)
    expect(earlierState !== undefined && REQUEST_IS_OPEN[earlierState], earlierState).toBe(true)
    expect(waitingOnAPerson()).toContain(earlier)
    expect(stateOf(worker, later)).toBe('interrupted')
    expect(endedByAStop(worker)).toEqual([later])
  })

  it('⚑ the line outlives a restart: a conversation stopped before its next turn is told at its next start, once', async () => {
    const { worker, surface, earlier, later, itsCard } = await aSecondTurnThatRuns()
    await host.interrupt(worker, surface)
    await waitFor(() => turnsEnded(worker) === 2, 'the stopped turn to end')
    theEarlierOneIsStillOpen(worker, earlier, later, itsCard)

    // The app quits and starts again; a person writes to the conversation.
    await host.closeAll()
    host = buildHost()
    const before = handedOver(worker).length
    const sent = await host.startAndSend(worker, 'hello again', window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(() => handedOver(worker).length === before + 1, 'its first words after the start')
    const first = handedOver(worker).at(-1) ?? ''
    expect(first).toContain(theQuestionsAStopEnded([{ id: later, prompt: LATER }]))
    expect(first).toContain('hello again')
    // ⛔ Nothing is said of the earlier question: it is open.
    expect(withoutWhatThisAppAdds(first)).not.toContain(earlier)

    // A second restart owes nothing more: a turn has run since the stop.
    // ⚠️ A limit: a turn of this app's words that its provider never began counts as one too, so a
    // restart straight after such a turn owes nothing, though the line was never taken.
    await host.closeAll()
    host = buildHost()
    const again = await host.startAndSend(worker, 'and once more', window)
    expect('notSent' in again, JSON.stringify(again)).toBe(false)
    await waitFor(
      () => handedOver(worker).length === before + 2,
      'its words after the second start',
    )
    expect(handedOver(worker).at(-1)).not.toContain(WAS_ENDED)
    // ⚑ Through both restarts the earlier question stayed a person's to answer.
    expect(waitingOnAPerson()).toContain(earlier)
  })

  it('⛔ a question whose id is open again is not said to have ended: a restart says nothing of it', async () => {
    const { worker, surface, later } = await aSecondTurnThatRuns()
    await host.interrupt(worker, surface)
    await waitFor(() => turnsEnded(worker) === 2, 'the stopped turn to end')
    expect(store.requestsItsLastEndedTurnInterrupted(worker)).toContain(later)
    await host.closeAll()
    // A fiction no door of this app writes: the same id routed again after its ending.
    const routed = ledger(worker).find(
      (event) => event.type === 'request_routed' && event.requestId === later,
    )
    if (routed === undefined) throw new Error('its routing is in the ledger')
    store.append(worker, store.nextOrdinal(worker), routed, tick())
    const versions = store.routedRequestsOf(worker).filter((one) => one.requestId === later)
    expect(versions.map((one) => REQUEST_IS_OPEN[one.state])).toEqual([false, true])

    host = buildHost()
    const before = handedOver(worker).length
    const sent = await host.startAndSend(worker, 'hello again', window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(() => handedOver(worker).length === before + 1, 'its first words after the start')
    expect(handedOver(worker).at(-1)).toContain('hello again')
    expect(handedOver(worker).at(-1)).not.toContain(WAS_ENDED)
  })

  it.each([
    ['in the same millisecond', 0],
    ['with the clock going back', -1],
  ])(
    '🔴 two turns stopped one after the other, %s: after a restart only the last one’s question is owed, read off that turn’s own rows',
    async (_, moves) => {
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      const surface = new RecordingSink('webContents:8')
      host.claimSession(worker, surface)
      await waitFor(() => cardsRaised(worker) === 1, 'its first turn to wait on its card')
      const first = await asks(workerTools, piece, EARLIER)
      step = moves
      await host.interrupt(worker, surface)
      await waitFor(() => turnsEnded(worker) === 1, 'the first stopped turn to end')
      // Its next turn is told of the first question, asks a second, and is stopped too.
      await host.send(worker, 'go on', surface)
      await waitFor(() => cardsRaised(worker) === 2, 'its second turn to wait on its card')
      expect(handedOver(worker).at(-1)).toContain(
        theQuestionsAStopEnded([{ id: first, prompt: EARLIER }]),
      )
      const second = await asks(workerTools, piece, LATER)
      await host.interrupt(worker, surface)
      await waitFor(() => turnsEnded(worker) === 2, 'the second stopped turn to end')
      // ⛔ A request ended with no turn open carries no turn: it is in nobody's line.
      store.append(
        worker,
        store.nextOrdinal(worker),
        { type: 'request_interrupted', requestId: 'req_ended_with_no_turn_open' },
        tick(),
      )
      expect(store.requestsItsLastEndedTurnInterrupted(worker)).toContain(second)
      expect(store.requestsItsLastEndedTurnInterrupted(worker)).not.toContain(first)
      expect(store.requestsItsLastEndedTurnInterrupted(worker)).not.toContain(
        'req_ended_with_no_turn_open',
      )

      step = 1
      await host.closeAll()
      host = buildHost()
      const before = handedOver(worker).length
      const sent = await host.startAndSend(worker, 'hello again', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await waitFor(
        () => handedOver(worker).length === before + 1,
        'its first words after the start',
      )
      const words = handedOver(worker).at(-1) ?? ''
      expect(words).toContain(theQuestionsAStopEnded([{ id: second, prompt: LATER }]))
      // ⛔ Not the first again: it was told of that one, and no time says otherwise.
      expect(words).not.toContain(first)
    },
  )

  it('⚠️ a limit: a question asked between turns, by work left running, counts as the next turn’s — its stop ends it, and the asker is told', async () => {
    const { worker, workerTools, piece } = await aWorkerHoldingWork()
    const surface = new RecordingSink('webContents:8')
    host.claimSession(worker, surface)
    await waitFor(() => cardsRaised(worker) === 1, 'its first turn to wait on its card')
    await host.respondPermission(worker, theCardItWaitsOn(worker), { outcome: 'allow' }, surface)
    await waitFor(() => turnsEnded(worker) === 1, 'its first turn to end')
    // No turn runs: the question is asked by what the first turn left running.
    const between = await asks(workerTools, piece, EARLIER)
    await host.send(worker, 'also start the other one', surface)
    await waitFor(() => cardsRaised(worker) === 2, 'its second turn to wait on its card')
    await host.interrupt(worker, surface)
    await waitFor(() => turnsEnded(worker) === 2, 'the stopped turn to end')
    expect(stateOf(worker, between)).toBe('interrupted')
    // …and it is not silent: the next words say so.
    const before = handedOver(worker).length
    await host.send(worker, 'go on', surface)
    await waitFor(() => handedOver(worker).length === before + 1, 'its next words')
    expect(handedOver(worker).at(-1)).toContain(
      theQuestionsAStopEnded([{ id: between, prompt: EARLIER }]),
    )
  })

  it('⚑ a stop of a turn that asked nothing ends only its provider’s card, and says nothing of questions', async () => {
    const { worker, workerTools, piece } = await aWorkerHoldingWork()
    const surface = new RecordingSink('webContents:8')
    host.claimSession(worker, surface)
    await waitFor(() => cardsRaised(worker) === 1, 'its first turn to wait on its card')
    const earlier = await asks(workerTools, piece, EARLIER)
    await host.respondPermission(worker, theCardItWaitsOn(worker), { outcome: 'allow' }, surface)
    await waitFor(() => turnsEnded(worker) === 1, 'its first turn to end')
    await host.send(worker, 'also start the other one', surface)
    await waitFor(() => cardsRaised(worker) === 2, 'its second turn to wait on its card')
    const itsCard = theCardItWaitsOn(worker)
    await host.interrupt(worker, surface)
    await waitFor(() => turnsEnded(worker) === 2, 'the stopped turn to end')
    expect(endedByAStop(worker)).toEqual([itsCard])
    expect(waitingOnAPerson()).toContain(earlier)
    await host.send(worker, 'go on', surface)
    await waitFor(() => handedOver(worker).length === 3, 'its next words')
    expect(handedOver(worker)[2]).not.toContain(WAS_ENDED)
  })

  it('⚑ the line names each question by its id and the first line of what it asked, cut at eighty characters', () => {
    expect(theQuestionsAStopEnded([{ id: 'req_a', prompt: 'which one?\nthe second line' }])).toBe(
      'Your question req_a (“which one?”) was ended unanswered when your turn was stopped. Ask it again if you still need the answer.',
    )
    expect(
      theQuestionsAStopEnded([
        { id: 'req_a', prompt: 'which one?' },
        { id: 'req_b', prompt: 'x'.repeat(81) },
        { id: 'req_c', prompt: '' },
      ]),
    ).toBe(
      `Your questions req_a (“which one?”), req_b (“${'x'.repeat(80)}…”) and req_c were ended unanswered when your turn was stopped. Ask them again if you still need the answers.`,
    )
  })
})
