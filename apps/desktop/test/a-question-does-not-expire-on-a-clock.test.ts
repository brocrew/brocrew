import { waitFor } from './lib/f093-host'
import { TASK_STATES } from '../src/shared/task-contracts'
import { REQUEST_STATES } from '../src/shared/question-contracts'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { REQUEST_IS_OPEN } from '../src/shared/questions'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { ToolWatchingResumeRuntime as ToolWatchingRuntime } from './lib/provider-double'
import { syntheticProviderHome, fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

const BOUND = 150

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

  const codeOf = (dir: string, file: string): string =>
    sourceOf(dir, file)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^[ \t]*\/\/.*$/gm, ' ')

  const proseOf = (dir: string, file: string): string =>
    sourceOf(dir, file)
      .replace(/\n\s*\*\s?/g, ' ')
      .replace(/\s+/g, ' ')

  const bodyOf = (source: string, signature: string, closes = '\n  }'): string => {
    const from = source.indexOf(signature)
    if (from === -1) throw new Error(`no such declaration: ${signature}`)
    const to = source.indexOf(closes, from)
    if (to === -1) throw new Error(`unterminated declaration: ${signature}`)
    return source.slice(from, to)
  }

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
      expect(said.answered).toBeUndefined()
      expect(said.question_is).toBeUndefined()

      const asked = openRequestOf(worker)
      expect(REQUEST_IS_OPEN[asked.state as (typeof REQUEST_STATES)[number]]).toBe(true)

      const late = await callOn(pmTools, 'answer_question', {
        question: asked.requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
      })
      expect(late.outcome, JSON.stringify(late)).toBe('ok')
      expect(stateOfRequest(worker, asked.requestId)).toBe('answered')

      await waitFor(
        () => wordsIn(worker).some((one) => one.text.includes('answer: b')),
        'the answer delivered into the worker',
      )
      const delivered = wordsIn(worker)
        .filter((one) => one.text.includes('answer: b'))
        .at(-1)
      expect(delivered?.type).toBe('message_queued')
      expect(delivered?.kind).toBe('notice')
      expect(delivered?.text).toContain('which schema?')
      expect(delivered?.text).toContain(`${host.nameByItsWork(pm)} answered the question you asked`)

      await letTheWorkerFinish(worker)
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'user_turn' && event.text.includes('answer: b'),
          ),
        'the notice flushing into a turn',
      )

      expect(
        store
          .piecesOwnedBy(worker)
          .filter((one) => TASK_IS_OPEN[one.state])
          .map((one) => one.piece),
      ).toEqual([piece])
    })

    it('⚑ THE CONTROL · busy or idle the answer arrives as WORDS, and there is no second route', async () => {
      const { pm, worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      const asking = callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which schema?',
      })
      expect(await settledYet(asking)).toBe(true)
      const said = await asking
      expect(said.outcome, JSON.stringify(said)).toBe('ok')

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
      expect(
        ledger(worker)
          .slice(before)
          .filter((event) => event.type === 'message_queued'),
      ).toEqual([])
      expect(wordsIn(worker).at(-1)?.text).toContain(
        `${host.nameByItsWork(pm)} answered the question you asked`,
      )

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
      expect(ack.outcome, JSON.stringify(ack)).toBe('taken')
      expect(stateOfRequest(worker, asked.requestId)).toBe('answered')
      await waitFor(
        () => wordsIn(worker).some((one) => one.text.includes('the person decided')),
        'the person’s answer reaching the worker',
      )
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
      expect(stateOfRequest(worker, asked.requestId)).toBe('rejected')
      await waitFor(
        () => wordsIn(worker).some((one) => one.text.includes('declined to answer')),
        'the decline reaching the worker',
      )
    })
  })

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
      expect(took.endedQuestions).toBe(1)

      expect(ledger(worker).filter((event) => event.type === 'work_taken_back')).toHaveLength(1)
      expect(stateOfRequest(worker, asked.requestId)).toBe('work-withdrawn')
      expect(REQUEST_IS_OPEN['work-withdrawn']).toBe(false)

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
      expect((late.detail as Record<string, unknown>).state).toBe('work-withdrawn')
    })

    it('⚑ THE CONTROL · a question about ANOTHER task in the same ledger is untouched', async () => {
      const { worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'about the first?',
      })
      const first = openRequestOf(worker)
      expect(stateOfRequest(worker, first.requestId)).toBe('open')

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
      expect(took.endedQuestions).toBe(1)
      expect(ledger(worker).filter((event) => event.type === 'work_taken_back')).toHaveLength(1)
      expect(stateOfRequest(worker, secondAsk.requestId)).toBe('work-withdrawn')
      expect(stateOfRequest(worker, first.requestId)).toBe('open')
      const still = await callOn(pmTools, 'answer_question', {
        question: first.requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
      })
      expect(still.outcome, JSON.stringify(still)).toBe('ok')
    })

    it('⛔ a withdrawal ends the question and there is NOTHING LEFT TO RELEASE', async () => {
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

      const handed = ledger(worker)
        .slice(before)
        .filter(
          (event): event is Extract<TranscriptEvent, { type: 'user_turn' | 'message_queued' }> =>
            event.type === 'user_turn' || event.type === 'message_queued',
        )
      expect(handed.map((event) => event.appNotice)).toEqual(['a-piece-taken-back'])
      expect(handed.map((event) => event.text).join('\n')).not.toContain('answer')

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
      expect(took.endedQuestions).toBe(0)
      expect(stateOfRequest(worker, asked.requestId)).toBe('answered')
    })
  })

  describe('§4 · elapsed time is not an ending', () => {
    it('⛔ ten bounds of wall clock later, the question is still the parent’s to answer', async () => {
      const { worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'which schema?',
      })
      const asked = openRequestOf(worker)
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
        expect(said.outcome, JSON.stringify(said)).toBe('ok')
        expect(said.question).toEqual(expect.any(String))
      } finally {
        asking.deps.store = real
      }
      const body = bodyOf(codeOf(mainRoot, 'runtime/runtime-host.ts'), 'async raiseAQuestion(')
      expect(body).not.toContain('routedRequestsOf')
      expect(body).not.toContain('whatBecameOfTheQuestion')
    })

    it('⛔ and the ONE table that decides it has no member a clock can reach', () => {
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
        'work-closed',
        'work-replied',
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

  describe('§5 · the row a person could never clear', () => {
    it('⛔ an escalated question is in the person’s queue, and answering it LATE takes it out', async () => {
      const { worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      await callOn(workerTools, 'ask_question', {
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

      clock += BOUND * 6
      const late = await callOn(pmTools, 'answer_question', {
        question: asked.requestId,
        answers: [{ part: 'answer', answer: ['b'] }],
      })
      expect(late.outcome, JSON.stringify(late)).toBe('ok')
      expect(host.questionsForAPerson().rows).toEqual([])
      expect(
        store.routedRequestsOf(worker).find((one) => one.requestId === asked.requestId)
          ?.escalatedAt,
      ).toBeNull()
    })

    it('⛔ and a question whose WORK was taken back leaves the queue too, without anybody answering it', async () => {
      const { pmTools, workerTools, piece } = await aWorkerHoldingWork()
      await callOn(workerTools, 'ask_question', {
        who_answers: 'a-person',
        piece,
        question: 'which schema?',
      })
      expect(host.questionsForAPerson().rows).toHaveLength(1)
      await callOn(pmTools, 'withdraw_task', { piece })
      expect(host.questionsForAPerson().rows).toEqual([])
    })
  })

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
      expect(expired.text).not.toContain('the work is still yours')

      const asked = openRequestOf(worker)
      await callOn(pmTools, 'withdraw_task', { piece })
      expect(stateOfRequest(worker, asked.requestId)).toBe('work-withdrawn')

      const listing = pmTools.tools.find((one) => one.name === 'list_questions')
      if (listing === undefined) throw new Error('no list_questions')
      const listed = await listing.call({ state: 'all' })
      expect(listed.text).toContain('the work it was about was taken back')
      expect(listed.text).toContain('work-withdrawn')
    })

    it('⚑ and the tool payload carries the id and NOTHING that described a wait', async () => {
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
      expect(Object.keys(payload).sort()).toEqual(['outcome', 'question', 'went_to'])
      expect(payload.went_to).toBe('the-parent')
      expect(payload.answered).toBeUndefined()
      expect(payload.waitedForMs).toBeUndefined()
      expect(payload.question_is).toBeUndefined()
    })
  })

  describe('§7 · the prose that went false with the behaviour', () => {
    it('⛔ no door refuses an answer on a clock any more, and both read the ledger instead', () => {
      const code = codeOf(mainRoot, 'runtime/runtime-host.ts')
      expect(bodyOf(code, 'async answerQuestion(')).not.toContain(
        'if (held !== undefined && !held.waiting)',
      )
      expect(bodyOf(code, 'async respondUserInput(')).not.toContain('if (!holding.waiting) {')
      expect(code).not.toContain('aTurnIsWaiting')
      expect(bodyOf(code, 'async answerQuestion(')).not.toContain('.settle(')
      expect(bodyOf(code, 'async respondUserInput(')).not.toContain('.settle(')
      expect(bodyOf(code, 'private async aPersonAnswersAQuestionThisAppAsked(')).not.toContain(
        '.settle(',
      )
      expect(bodyOf(code, 'async answerQuestion(')).not.toMatch(/\bheld\.waiting\b/)
      expect(bodyOf(code, 'async respondUserInput(')).not.toMatch(/\bholding\.waiting\b/)
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
      expect(proseOf(mainRoot, 'runtime/runtime-host.ts')).toContain('it read a clock')
    })

    it('⛔ the ask_parent sentence no longer says an answer after the bound is refused', () => {
      const tools = codeOf(mainRoot, 'runtime/agent-tools.ts')
      expect(tools).toContain('reaches you as a message rather than as this call')
      const questions = proseOf(join(mainRoot, '..'), 'shared/question-contracts.ts')
      expect(questions).toContain('deleted the behaviour that sentence described')
    })

    it('🔴 603/608 · HO-082 §3.1 · the condition EXISTS, the FOLD still has none, and the hold is GONE', () => {
      const tasks = codeOf(join(mainRoot, '..'), 'shared/tasks.ts')
      expect(tasks).toContain("turn_ended: 'its turn ended with this work still open.'")
      expect(tasks).not.toContain("and it replied nothing.'")
      expect([...TASK_STATES]).toContain('waiting-on-an-answer')
      expect(TASK_IS_OPEN['waiting-on-an-answer']).toBe(true)
      const fold = tasks.slice(tasks.indexOf('export function derivePieces('))
      expect(fold.length, 'the slice found no derivePieces body').toBeGreaterThan(1_000)
      expect(fold).not.toContain("'asking'")
      expect(fold).not.toContain('composeWaitingOnAnAnswer')
      const ask = bodyOf(codeOf(mainRoot, 'runtime/runtime-host.ts'), 'async raiseAQuestion(')
      expect(ask.length, 'the slice found no raiseAQuestion body').toBeGreaterThan(400)
      const body = ask.slice(ask.indexOf('): Promise<AskOutcome> {'))
      expect(body.length, 'the slice found no raiseAQuestion body').toBeGreaterThan(400)
      expect(body).not.toContain('await ')
      expect(body).not.toContain('setTimeout')
      expect(body).not.toContain('new Promise')
      expect(body).not.toContain('Promise.race')
      expect(ask).toContain("type: 'question_asked'")
      expect(ask).toContain("type: 'request_routed'")
      expect(ask).toContain('this.deliverQuestion(')
    })

    it('⚑ and the ending has exactly one producer, which is what the word claims', () => {
      const code = codeOf(mainRoot, 'runtime/runtime-host.ts')
      expect(code.split("type: 'request_work_withdrawn'").length - 1).toBe(0)
      expect(code.split("type: 'work_taken_back'").length - 1).toBe(1)
      expect(bodyOf(code, 'async takeBackPiece(')).toContain("type: 'work_taken_back'")
    })
  })

  const _entry = (ordinal: number, event: TranscriptEvent): PersistedEventInfo => ({
    ordinal,
    at: 10 + ordinal,
    event,
  })
  void _entry
})
