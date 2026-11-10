import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type {
  AgentToolAnswer,
  AgentToolset,
  FakeRuntime,
  FakeSessionHandle,
  RuntimeEvent,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { giverStallReceipts, RuntimeHost } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN, undrivenSentence } from '../src/shared/tasks'
import { REQUEST_IS_OPEN } from '../src/shared/questions'
import { theMessagesOf } from '../src/shared/runtime-ipc'
import { ProviderDouble, type ResumeGate } from './lib/provider-double'
import {
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
} from './lib/host-fixture'

/**
 * What a Close does that a reopen never undoes, on one host with a real Close and a real Reopen:
 * an agent-started conversation is handed back rather than ended, a question the conversation was
 * asking stays open and answerable, and a parent is told about stopped work once.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** What a Close of a worker mid-turn tells its parent: the turn it interrupted. */
const ITS_TURN_WAS_STOPPED = undrivenSentence('turn_interrupted')

describe('what a close does that a reopen never undoes', () => {
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
  let secondWindow: RecordingSink
  let gate: ResumeGate
  const tick = (): number => clock++

  const buildHost = (
    over: SessionStore = store,
    runtime: (provider: Provider) => FakeRuntime = (provider) =>
      new ProviderDouble(provider, handles, issued, gate),
  ): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      ...neutralHostDeps(() => userData),
      createRuntime: runtime,
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-close-reopen-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-close-reopen-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_610_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    gate = { held: null, entered: 0, silentUntilItsFirstTurn: false }
    host = buildHost()
    window = new RecordingSink('webContents:1')
    secondWindow = new RecordingSink('webContents:2')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** A restart: the next host gets its own SessionStore object over the same database. */
  const relaunch = async (): Promise<void> => {
    await host.closeAll()
    host = buildHost(createSessionStore(db, tick))
  }

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** A real macrotask pause, so a negative is measured after whatever was queued has run. */
  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

  const personOpens = async (profileId: string, sink = window): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      sink,
    )
    return sessionId
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const runningOf = (sessionId: string): string | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (row) => row.sessionId === sessionId,
    )?.running

  /** A PM in a window and one child it gave a piece to; the brief is the child's first turn. */
  const aPmAndItsWorker = async (
    brief = 'migrate the schema',
  ): Promise<{ pm: string; worker: string }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const pm = await personOpens('pm')
    const given = await callOn(agentToolsFor(host, pm), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work this dispatch is about',
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { pm, worker: given.agent as string }
  }

  const cardsOn = (sessionId: string): number =>
    events(sessionId).filter((event) => event.type === 'permission_request').length

  /** A piece by the label a notice names it by. */
  const pieceOf = (label: string): string => {
    const row = store.workByLabel(label)
    if (row === null) throw new Error(`no piece labelled ${label}`)
    return row.piece
  }

  /** The worker holds the work mid-turn, parked on its brief's card. */
  const aWorkerMidTurn = async (): Promise<{ pm: string; worker: string; label: string }> => {
    const { pm, worker } = await aPmAndItsWorker()
    host.claimSession(worker, window)
    await waitFor(() => cardsOn(worker) > 0, 'the card the work parks on')
    const open = store.piecesOwnedBy(worker).find((one) => TASK_IS_OPEN[one.state])
    if (open === undefined) throw new Error('the give never opened a piece')
    return { pm, worker, label: open.label }
  }

  /** …and asks its parent a question about it with ask_question. */
  const aWorkerAskingItsParent = async (): Promise<{
    pm: string
    worker: string
    label: string
    requestId: string
  }> => {
    const held = await aWorkerMidTurn()
    const asked = await callOn(agentToolsFor(host, held.worker), 'ask_question', {
      who_answers: 'the-parent',
      piece: held.label,
      question: 'postgres or sqlite?',
      options: ['postgres', 'sqlite'],
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    return { ...held, requestId: theQuestionOf(held.worker).requestId }
  }

  /** Answer the conversation's card, so its turn ends and it is idle. */
  const letTheTurnFinish = async (worker: string): Promise<void> => {
    const card = events(worker)
      .filter(
        (event): event is TranscriptEvent & { type: 'permission_request'; id: string } =>
          event.type === 'permission_request',
      )
      .at(-1)
    if (card === undefined) throw new Error('the worker is not parked on anything')
    const turns = events(worker).filter((event) => event.type === 'turn').length
    await host.respondPermission(worker, card.id, { outcome: 'allow' }, window)
    await waitFor(
      () => events(worker).filter((event) => event.type === 'turn').length > turns,
      'the turn to reach its own terminal',
    )
  }

  const theQuestionOf = (worker: string): { requestId: string; state: string } => {
    const row = store
      .routedRequestsOf(worker)
      .filter((one) => one.went.is === 'the-parent')
      .at(-1)
    if (row === undefined) throw new Error(`no routed question in ${worker}`)
    return row
  }

  const answerTo = (pm: string, requestId: string): Promise<Record<string, unknown>> =>
    callOn(agentToolsFor(host, pm), 'answer_question', {
      question: requestId,
      answers: [{ part: 'answer', answer: ['sqlite'] }],
    })

  /** Every way words reach a conversation: a busy one holds them, an idle one takes a turn. */
  const wordsIn = (sessionId: string): string[] => {
    const rows = events(sessionId)
    const sent = new Set(
      rows.flatMap((event) =>
        event.type === 'message_unqueued' &&
        event.reason === 'sent' &&
        event.messageId !== undefined
          ? [event.messageId]
          : [],
      ),
    )
    return rows.flatMap((event) =>
      event.type === 'user_turn'
        ? theMessagesOf(event).map((one) => one.text)
        : event.type === 'message_queued' &&
            (event.messageId === undefined || !sent.has(event.messageId))
          ? [event.text]
          : [],
    )
  }

  const theAnswerReached = (worker: string): boolean =>
    wordsIn(worker).some((text) => text.includes('answer: sqlite'))

  /** Notices matched on their first line and the closing imperative naming the piece. */
  const noticesAbout = (parent: string, label: string, opening: string): string[] =>
    wordsIn(parent).filter((text) => {
      const lines = text.split('\n')
      return (
        ((lines[0] ?? '').includes(opening) && (lines.at(-1) ?? '').includes(`naming ${label}.`)) ||
        ((opening === 'not being worked on' || opening === '') &&
          (lines[0] ?? '').startsWith(`${label} still needs attention:`))
      )
    })

  const toldItWasStopped = (parent: string, label: string): string[] =>
    noticesAbout(parent, label, 'not being worked on').filter((text) =>
      text.includes(ITS_TURN_WAS_STOPPED),
    )

  /** Everything this app said to a parent about one piece. */
  const everythingSaidAbout = (parent: string, label: string): string[] =>
    noticesAbout(parent, label, '')

  /** The giver's stall receipts for one piece. */
  const receiptsTo = (parent: string, label: string) =>
    giverStallReceipts(store, parent).filter((event) => event.piece === pieceOf(label))

  /** What each receipt told; a set-right receipt carries no cause, so it reads as its how. */
  const whatEachReceiptTold = (parent: string, label: string): string[] =>
    receiptsTo(parent, label).map((one) =>
      one.type === 'work_reconciliation'
        ? (one.cause ?? one.outcome)
        : 'cause' in one
          ? one.cause
          : one.how,
    )

  describe('the hand-back an agent-asked conversation was born with', () => {
    it('an agent’s child, closed and reopened by a window, is RELEASED when that window goes — not ended', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      host.claimSession(worker, window)
      await host.close(worker, window)

      const opened = await host.resumeSession(worker, secondWindow)

      expect(opened).toMatchObject({ startedWithoutAWindow: true, mayHandItBack: true })
      await host.closeSessionsForOwner(secondWindow.ownerId)
      expect(runningOf(worker)).toBe('unwatched')
      expect(host.unclaimedSessions().map((one) => one.sessionId)).toContain(worker)
      expect(runningOf(pm)).toBe('in-a-window')
    })

    it('THE CONTROL — a conversation a PERSON started still ends with the window that reopened it', async () => {
      const mine = await personOpens('alpha')
      await host.close(mine, window)

      const opened = await host.resumeSession(mine, secondWindow)

      expect(opened).toMatchObject({ startedWithoutAWindow: false, mayHandItBack: false })
      await host.closeSessionsForOwner(secondWindow.ownerId)
      expect(runningOf(mine)).toBe('not-running')
    })

    it('a window that goes while its reopen is still STARTING cancels the reopen — it is not released onto a departed sink', async () => {
      const { worker } = await aPmAndItsWorker()
      host.claimSession(worker, window)
      await host.close(worker, window)
      let open = (): void => {}
      gate.held = new Promise<void>((resolve) => {
        open = resolve
      })
      const before = gate.entered
      const reopening = host.resumeSession(worker, secondWindow).then(
        () => 'reopened',
        (error: unknown) => (error as Error).message,
      )
      await waitFor(() => gate.entered > before, 'the reopen to reach the provider')

      const leaving = host.closeSessionsForOwner(secondWindow.ownerId)
      open()
      await leaving

      expect(await reopening).not.toBe('reopened')
      expect(runningOf(worker)).toBe('not-running')
    })
  })

  describe('a question the conversation was still asking when it was closed', () => {
    it('a Close leaves it open, a reopen routes nothing again, and the parent’s answer reaches the worker', async () => {
      const { pm, worker, requestId } = await aWorkerAskingItsParent()
      await host.close(worker, window)
      expect(theQuestionOf(worker)).toMatchObject({ requestId, state: 'open' })

      await host.resumeSession(worker, window)

      expect(
        store.routedRequestsOf(worker).filter((one) => one.requestId === requestId),
      ).toHaveLength(1)
      const again = theQuestionOf(worker)
      expect(again.requestId).toBe(requestId)
      expect(REQUEST_IS_OPEN[again.state as keyof typeof REQUEST_IS_OPEN]).toBe(true)
      expect(theAnswerReached(worker)).toBe(false)
      const cards = store.routedRequestsOf(worker).filter((one) => one.requestId !== requestId)
      expect(cards.length).toBeGreaterThan(0)
      expect(cards.every((one) => one.state === 'abandoned')).toBe(true)

      const answered = await answerTo(pm, requestId)
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      expect(theQuestionOf(worker).state).toBe('answered')
      await waitFor(() => theAnswerReached(worker), 'the answer delivered into the worker')
      expect(wordsIn(worker).find((text) => text.includes('answer: sqlite'))).toContain(
        'postgres or sqlite?',
      )
    })

    it('answered WHILE the asker is closed: taken, and the answer starts it', async () => {
      const { pm, worker, requestId } = await aWorkerAskingItsParent()
      await host.close(worker, window)
      expect(runningOf(worker)).toBe('not-running')

      const early = await answerTo(pm, requestId)
      expect(early.outcome, JSON.stringify(early)).toBe('ok')
      expect(theQuestionOf(worker).state).toBe('answered')
      await waitFor(() => theAnswerReached(worker), 'the answer to start the worker and reach it')
      expect(runningOf(worker)).not.toBe('not-running')
    })

    it('the pass-up door takes the one open question while its asker is stopped', async () => {
      const { pm, worker, requestId } = await aWorkerAskingItsParent()
      await host.close(worker, window)
      expect(
        store.routedRequestsOf(worker).filter((one) => one.requestId === requestId),
      ).toHaveLength(1)

      const passed = await callOn(agentToolsFor(host, pm), 'pass_question_up', {
        question: requestId,
        who_answers: 'a-person',
      })
      expect(passed.outcome, JSON.stringify(passed)).toBe('ok')
    })

    it('…and after a RESTART it is still open, and the answer starts the asker', async () => {
      const { pm, worker, requestId } = await aWorkerAskingItsParent()
      await host.close(worker, window)
      await relaunch()

      expect(theQuestionOf(worker)).toMatchObject({ requestId, state: 'open' })
      await host.resumeSession(pm, window)
      const answered = await answerTo(pm, requestId)
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      await waitFor(() => theAnswerReached(worker), 'the answer to start the worker and reach it')
    })
  })

  describe('a parent told the conversation had stopped', () => {
    it('is told ONCE, with the cause the row stands on — and the reopen tells it nothing more', async () => {
      const { pm, worker, label } = await aWorkerMidTurn()
      await host.close(worker, window)
      await waitFor(() => toldItWasStopped(pm, label).length === 1, 'the parent told the stop')
      expect(everythingSaidAbout(pm, label)).toHaveLength(1)

      await host.resumeSession(worker, window)
      await letItSettle()

      expect(store.piecesOwnedBy(worker).find((one) => one.label === label)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_interrupted',
      })
      expect(everythingSaidAbout(pm, label)).toHaveLength(1)
      expect(whatEachReceiptTold(pm, label)).toEqual(['turn_interrupted'])
      expect(store.workReportedTo(pm).has(pieceOf(label))).toBe(true)
    })

    it('a worker that was ASKING: the Close tells its parent nothing, and so does the reopen', async () => {
      const { pm, worker, label } = await aWorkerAskingItsParent()
      await host.close(worker, window)
      await letItSettle()
      expect(everythingSaidAbout(pm, label)).toEqual([])
      expect(whatEachReceiptTold(pm, label)).toEqual([])

      await host.resumeSession(worker, window)
      await letItSettle()

      expect(everythingSaidAbout(pm, label)).toEqual([])
      expect(whatEachReceiptTold(pm, label)).toEqual([])
    })

    it('THE CONTROL — a parent whose last notice was NOT a stop is told nothing by the reopen', async () => {
      const { pm, worker, label } = await aWorkerMidTurn()
      await letTheTurnFinish(worker)
      await waitFor(
        () =>
          noticesAbout(pm, label, 'not being worked on').some((text) =>
            text.includes(undrivenSentence('turn_ended')),
          ),
        'the parent told the turn ended',
      )
      await host.close(worker, window)
      await letItSettle()
      expect(toldItWasStopped(pm, label)).toEqual([])
      expect(everythingSaidAbout(pm, label)).toHaveLength(1)

      await host.resumeSession(worker, window)
      await letItSettle()

      expect(everythingSaidAbout(pm, label)).toHaveLength(1)
      expect(noticesAbout(pm, label, 'not being worked on')).toHaveLength(1)
    })

    it('held work a Close hands on: delivered at its start, never `message_never_sent`, and its giver is told nothing', async () => {
      const { pm, worker } = await aPmAndItsWorker('busy with something else')
      host.claimSession(worker, window)
      const handle = handles.at(-1)
      if (handle === undefined) throw new Error('no provider handle was issued')
      await waitFor(() => cardsOn(worker) > 0, 'the worker to be busy')
      const given = await callOn(agentToolsFor(host, pm), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The held one',
        brief: 'the held one',
      })
      expect(given).toMatchObject({ outcome: 'ok', agent: worker, delivery: 'held' })
      const label = given.label as string

      await host.close(worker, window)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'user_turn' && event.text.startsWith('the held one'),
          ),
        'the held work to be handed on and delivered at the start',
      )
      await letItSettle()
      expect(store.piecesOwnedBy(worker).find((one) => one.label === label)).toMatchObject({
        state: 'working',
        stalledBecause: null,
      })
      expect(everythingSaidAbout(pm, label)).toEqual([])
      expect(whatEachReceiptTold(pm, label)).toEqual([])
    })

    it('…and the same when the provider ends its OWN stream — its slot is still `live` while it is torn down', async () => {
      const { pm, worker } = await aPmAndItsWorker('busy with something else')
      host.claimSession(worker, window)
      const handle = handles.at(-1)
      if (handle === undefined) throw new Error('no provider handle was issued')
      await waitFor(() => cardsOn(worker) > 0, 'the worker to be busy')
      const given = await callOn(agentToolsFor(host, pm), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The held one',
        brief: 'the held one',
      })
      expect(given).toMatchObject({ outcome: 'ok', agent: worker, delivery: 'held' })
      const label = given.label as string

      handle.simulateError('the provider fell over', true)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'user_turn' && event.text.startsWith('the held one'),
          ),
        'the held work to be handed on and delivered at the start',
      )
      await letItSettle()
      expect(store.piecesOwnedBy(worker).find((one) => one.label === label)).toMatchObject({
        state: 'working',
        stalledBecause: null,
      })
      expect(everythingSaidAbout(pm, label)).toEqual([])
      expect(whatEachReceiptTold(pm, label)).toEqual([])
    })

    it('…and when that parent has stopped, a second stop neither starts it nor tells it — and a person is not handed it', async () => {
      const { pm, worker, label } = await aWorkerMidTurn()
      await host.close(worker, window)
      await waitFor(() => toldItWasStopped(pm, label).length === 1, 'the parent told the stop')
      await waitFor(() => cardsOn(pm) > 0, 'the parent’s own turn to park on its card')
      await letTheTurnFinish(pm)
      await host.resumeSession(worker, window)
      await letItSettle()
      const namedToAPerson = (): string[] =>
        host.stalledWorkForAPerson().rows.map((work) => work.label)
      expect(namedToAPerson()).not.toContain(label)

      await host.close(pm, window)
      await host.close(worker, window)
      expect(store.piecesOwnedBy(worker)[0]?.stalledBecause).toBe('turn_interrupted')
      await letItSettle()

      expect(runningOf(pm)).toBe('not-running')
      expect(everythingSaidAbout(pm, label)).toHaveLength(1)
      expect(whatEachReceiptTold(pm, label)).toEqual(['turn_interrupted'])
      expect(namedToAPerson()).not.toContain(label)
    })

    it('across a RESTART the receipt is what remembers the first notice, and nothing more is told', async () => {
      const { pm, worker, label } = await aWorkerMidTurn()
      await host.close(worker, window)
      await waitFor(() => toldItWasStopped(pm, label).length === 1, 'the parent told the stop')
      await relaunch()

      await host.resumeSession(pm, window)
      await letItSettle()
      expect(everythingSaidAbout(pm, label)).toHaveLength(1)

      await host.resumeSession(worker, secondWindow)
      await letItSettle()

      expect(everythingSaidAbout(pm, label)).toHaveLength(1)
      expect(store.workReportedTo(pm).has(pieceOf(label))).toBe(true)
    })
  })

  describe('what the answer doors say', () => {
    /** A double whose stream can fail under the host, so no status row is written. */
    const levers = new Map<FakeSessionHandle, () => void>()
    class ADoubleWhoseStreamCanFail extends ProviderDouble {
      override async start(options: StartOptions): Promise<FakeSessionHandle> {
        const handle = await super.start(options)
        let fail!: () => void
        const failed = new Promise<IteratorResult<RuntimeEvent>>((_resolve, reject) => {
          fail = () => reject(new Error('the stream failed under the host'))
        })
        failed.catch(() => undefined)
        levers.set(handle, fail)
        return new Proxy(handle, {
          get(target, property) {
            if (property === 'events') {
              return (): AsyncIterable<RuntimeEvent> => ({
                [Symbol.asyncIterator]() {
                  const inner = target.events()[Symbol.asyncIterator]()
                  return {
                    next: () => Promise.race([inner.next(), failed]),
                    return: async (): Promise<IteratorResult<RuntimeEvent>> =>
                      (await inner.return?.()) ?? { done: true, value: undefined },
                  }
                },
              })
            }
            const value = Reflect.get(target, property, target) as unknown
            return typeof value === 'function' ? (value as () => unknown).bind(target) : value
          },
        })
      }
    }
    const aHostWhoseStreamsCanFail = (): RuntimeHost =>
      buildHost(store, (provider) => new ADoubleWhoseStreamCanFail(provider, handles, issued, gate))

    /** The stream under the last conversation started fails, and the host takes it down. */
    const itsStreamFails = async (sessionId: string): Promise<void> => {
      const handle = handles.at(-1)
      const fail = handle === undefined ? undefined : levers.get(handle)
      if (fail === undefined) throw new Error('no lever on the last start')
      fail()
      await waitFor(() => !host.sessionIds.includes(sessionId), 'the failed stream to end it')
    }

    const listing = async (pm: string): Promise<AgentToolAnswer> => {
      const tool = agentToolsFor(host, pm).tools.find((one) => one.name === 'list_questions')
      if (tool === undefined) throw new Error('no list_questions')
      return tool.call({ state: 'all' })
    }

    it('a question THIS APP raised is not “gone” when its stream fails — the answer is taken, and starts the asker', async () => {
      host = aHostWhoseStreamsCanFail()
      const { pm, worker, requestId } = await aWorkerAskingItsParent()
      await itsStreamFails(worker)
      expect(REQUEST_IS_OPEN[theQuestionOf(worker).state as keyof typeof REQUEST_IS_OPEN]).toBe(
        true,
      )
      expect(
        events(worker).some(
          (event) => event.type === 'error' && event.message.includes('event stream failed'),
        ),
      ).toBe(true)

      const early = await answerTo(pm, requestId)
      expect(early.outcome, JSON.stringify(early)).toBe('ok')
      await waitFor(() => theAnswerReached(worker), 'the answer to start the worker and reach it')
    })

    it('THE CONTROL — a question the PROVIDER raised dies with the stream, and there “never” is true', async () => {
      host = aHostWhoseStreamsCanFail()
      const { pm, worker } = await aPmAndItsWorker()
      const raised = handles.at(-1)!.simulateUserInput('which branch?', ['main', 'dev'], false, {})
      await waitFor(
        () =>
          store
            .routedRequestsOf(worker)
            .some((one) => one.requestId === raised.id && one.went.is === 'the-parent'),
        'the provider question to reach the parent',
      )
      await itsStreamFails(worker)

      const early = await answerTo(pm, raised.id)
      expect(early).toMatchObject({
        outcome: 'refused',
        rail: 'the-conversation-that-asked-has-gone',
        permanence: 'permanent',
      })
      await host.resumeSession(worker, window)
      expect((await answerTo(pm, raised.id)).rail).toBe('question-has-already-ended')
    })

    it('`list_questions` lists a question whose asker was closed ONCE, and open — before and after the reopen', async () => {
      const { pm, worker, requestId } = await aWorkerAskingItsParent()
      await host.close(worker, window)

      const statesListed = async (): Promise<string[]> => {
        const listed = await listing(pm)
        const entries = (listed.structured as { questions: { question: string; state: string }[] })
          .questions
        const lines = listed.text.split('\n')
        // One row for the question, and its own words once beneath it, with the asker to quote.
        expect(lines.filter((one) => one.startsWith(`  ${requestId} · `))).toHaveLength(1)
        const quoted = lines.filter((one) => one.includes(`quoting ${requestId} with asked_by `))
        expect(quoted).toHaveLength(1)
        expect(lines.filter((one) => one.includes(requestId))).toHaveLength(2)
        return entries.filter((one) => one.question === requestId).map((one) => one.state)
      }
      expect(await statesListed()).toEqual(['open'])

      await host.resumeSession(worker, window)
      expect(
        store.routedRequestsOf(worker).filter((one) => one.requestId === requestId),
      ).toHaveLength(1)
      expect(await statesListed()).toEqual(['open'])
    })
  })
})
