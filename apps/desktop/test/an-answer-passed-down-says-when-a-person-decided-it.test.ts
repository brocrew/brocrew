import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import { type AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase } from '../src/main/db/connection'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { ToolWatchingResumeRuntime as ToolWatchingRuntime } from './lib/provider-double'
import { fixtureFolder, fixtureDatabase, fixtureProviderConfig, syntheticProviderHome, neutralHostDeps, RecordingSink } from './lib/host-fixture'

const PASSED_UP =
  'It had passed your question up, and a person answered it there. Its answer below is in its own words: it may quote that answer, or say it differently.'
const INSTEAD = 'instead of that person'
const CANNOT_TELL = 'This app cannot tell you whether it asked them first.'

describe('an answer an agent passes down says when a person decided it', () => {
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
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, order, issued),
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
    userData = fixtureFolder('brobot2-passed-down-')
    root = fixtureFolder('brobot2-passed-down-root-')
    db = fixtureDatabase(userData)
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

  const toldIn = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) =>
      event.type === 'user_turn' || event.type === 'message_queued' ? [event.text] : [],
    )

  const theAnswerTo = async (asker: string, id: string): Promise<string> => {
    await waitFor(
      () => toldIn(asker).some((text) => text.includes(`quoting ${id}.`)),
      `the answer to ${id} to reach ${asker}`,
    )
    const text = toldIn(asker).find((one) => one.includes(`quoting ${id}.`))
    if (text === undefined) throw new Error('no answer')
    return text
  }

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

  const ask = async (
    tools: AgentToolset,
    whoAnswers: 'the-parent' | 'a-person',
    piece: string,
    question: string,
  ): Promise<string> => {
    const asked = await callOn(tools, 'ask_question', { who_answers: whoAnswers, piece, question })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    return asked.question as string
  }

  const passUp = async (
    pmTools: AgentToolset,
    id: string,
    worker: string,
    whoAnswers: 'the-parent' | 'a-person',
  ): Promise<string> => {
    const passed = await callOn(pmTools, 'pass_question_up', {
      question: id,
      asked_by: worker,
      who_answers: whoAnswers,
    })
    expect(passed.outcome, JSON.stringify(passed)).toBe('ok')
    return passed.question as string
  }

  const aPersonAnswers = async (asker: string, up: string, answer: string): Promise<void> => {
    const taken = await host.respondUserInput(
      asker,
      up,
      { kind: 'answer', answers: { answer: [answer] } },
      window,
    )
    expect(taken.outcome, JSON.stringify(taken)).toBe('taken')
    await waitFor(
      () => store.theDecisionOn(asker, up) !== null,
      'the person’s decision to land in the passer’s ledger',
    )
  }

  const answerDown = async (
    pmTools: AgentToolset,
    id: string,
    worker: string,
    answer: string,
  ): Promise<void> => {
    const down = await callOn(pmTools, 'answer_question', {
      question: id,
      asked_by: worker,
      answers: [{ part: 'answer', answer: [answer] }],
    })
    expect(down.outcome, JSON.stringify(down)).toBe('ok')
  }

  describe('§1 · passed up, and a person answered it there', () => {
    it('the asker reads that it was passed up and a person answered it there, and that the words are the agent’s own', async () => {
      const { pm, worker, workerTools, piece } = await aPmWithAWorkerOnATask()
      const id = await ask(workerTools, 'the-parent', piece, 'which city?')
      const up = await passUp(pm.tools, id, worker, 'a-person')
      await aPersonAnswers(pm.id, up, 'Lisbon')
      await answerDown(pm.tools, id, worker, 'Lisbon')

      const text = await theAnswerTo(worker, id)
      expect(text).toContain(
        `${host.nameByItsWork(pm.id)} answered the question you asked about ${piece}, quoting ${id}.\n\n${PASSED_UP}\n\nYou asked: which city?`,
      )
      expect(text).not.toContain(INSTEAD)
      expect(text).not.toContain(CANNOT_TELL)
    })

    it('passed up, and nobody has answered it there yet: the agent’s answer is its own, and says nothing of a person', async () => {
      const { pm, worker, workerTools, piece } = await aPmWithAWorkerOnATask()
      const id = await ask(workerTools, 'the-parent', piece, 'which city?')
      const up = await passUp(pm.tools, id, worker, 'a-person')
      expect(store.theDecisionOn(pm.id, up)).toBeNull()
      await answerDown(pm.tools, id, worker, 'Rabat')

      const text = await theAnswerTo(worker, id)
      expect(text).toContain(
        `${host.nameByItsWork(pm.id)} answered the question you asked about ${piece}, quoting ${id}.\n\nYou asked: which city?`,
      )
      expect(text).not.toContain('It had passed your question up')
    })

    it('passed up, and the person DECLINED it there: no sentence says a person answered', async () => {
      const { pm, worker, workerTools, piece } = await aPmWithAWorkerOnATask()
      const id = await ask(workerTools, 'the-parent', piece, 'which city?')
      const up = await passUp(pm.tools, id, worker, 'a-person')
      const taken = await host.respondUserInput(pm.id, up, { kind: 'reject' }, window)
      expect(taken.outcome, JSON.stringify(taken)).toBe('taken')
      await waitFor(
        () => store.theDecisionOn(pm.id, up) !== null,
        'the person’s decline to land in the passer’s ledger',
      )
      expect(store.theDecisionOn(pm.id, up)).toMatchObject({
        outcome: 'rejected',
        by: { who: 'a-person' },
      })
      await answerDown(pm.tools, id, worker, 'Rabat')

      const text = await theAnswerTo(worker, id)
      expect(text).not.toContain('It had passed your question up')
      expect(text).not.toContain(INSTEAD)
    })

    it('the agent DECLINES the asker after a person answered upstream: a decline carries neither sentence', async () => {
      const { pm, worker, workerTools, piece } = await aPmWithAWorkerOnATask()
      const id = await ask(workerTools, 'the-parent', piece, 'which city?')
      const up = await passUp(pm.tools, id, worker, 'a-person')
      await aPersonAnswers(pm.id, up, 'Lisbon')
      const declined = await callOn(pm.tools, 'answer_question', {
        question: id,
        asked_by: worker,
        cannot_answer: 'the person’s answer does not settle it',
      })
      expect(declined.outcome, JSON.stringify(declined)).toBe('ok')

      const text = await theAnswerTo(worker, id)
      expect(text).toContain(
        `${host.nameByItsWork(pm.id)} declined to answer the question you asked about ${piece}, quoting ${id}.`,
      )
      expect(text).not.toContain('It had passed your question up')
      expect(text).not.toContain(INSTEAD)
    })

    it('passed up to its own PARENT, and an AGENT answered it there: no sentence says a person did', async () => {
      await host.close((await personOpens('lead')).id, window)
      await host.close((await personOpens('worker')).id, window)
      const top = await personOpens(DEFAULT_PROFILE_ID)
      const toLead = await callOn(top.tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'lead',
        title: 'The front end',
        brief: 'run it',
      })
      expect(toLead.outcome, JSON.stringify(toLead)).toBe('ok')
      const lead = toLead.agent as string
      const leadTools = order.at(-1)
      if (leadTools === undefined) throw new Error('no lead toolset')
      const toWorker = await callOn(leadTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The notes',
        brief: 'write it',
      })
      expect(toWorker.outcome, JSON.stringify(toWorker)).toBe('ok')
      const worker = toWorker.agent as string
      const workerTools = order.at(-1)
      if (workerTools === undefined) throw new Error('no worker toolset')
      const piece = toWorker.label as string

      const id = await ask(workerTools, 'the-parent', piece, 'which city?')
      const up = await passUp(leadTools, id, worker, 'the-parent')
      const upstream = await callOn(top.tools, 'answer_question', {
        question: up,
        asked_by: lead,
        answers: [{ part: 'answer', answer: ['Lisbon'] }],
      })
      expect(upstream.outcome, JSON.stringify(upstream)).toBe('ok')
      await waitFor(
        () => store.theDecisionOn(lead, up) !== null,
        'the top’s decision to land in the lead’s ledger',
      )
      expect(store.theDecisionOn(lead, up)).toMatchObject({
        outcome: 'answered',
        by: { who: 'an-agent' },
      })
      await answerDown(leadTools, id, worker, 'Lisbon')

      const text = await theAnswerTo(worker, id)
      expect(text).toContain(
        `${host.nameByItsWork(lead)} answered the question you asked about ${piece}, quoting ${id}.\n\nYou asked: which city?`,
      )
      expect(text).not.toContain('It had passed your question up')
    })
  })

  describe('§2 · asked of a person, and an agent answered instead', () => {
    it('the asker reads that the agent answered instead of that person, and that this app cannot tell whether it asked them first', async () => {
      const { pm, worker, workerTools, piece } = await aPmWithAWorkerOnATask()
      const id = await ask(workerTools, 'a-person', piece, 'which colour?')
      await answerDown(pm.tools, id, worker, 'blue')

      const text = await theAnswerTo(worker, id)
      expect(text).toContain(
        `${host.nameByItsWork(pm.id)} answered the question you asked a person about ${piece}, instead of that person, quoting ${id}. ${CANNOT_TELL}\n\nYou asked: which colour?`,
      )
      expect(text).not.toContain('It had passed your question up')
    })

    it('the person answers it themselves: a person’s answer, and no word of anybody answering instead', async () => {
      const { worker, workerTools, piece, surface } = await aPmWithAWorkerOnATask()
      const id = await ask(workerTools, 'a-person', piece, 'which colour?')
      const taken = await host.respondUserInput(
        worker,
        id,
        { kind: 'answer', answers: { answer: ['blue'] } },
        surface,
      )
      expect(taken.outcome, JSON.stringify(taken)).toBe('taken')

      const text = await theAnswerTo(worker, id)
      expect(text).toContain(
        `A person answered the question you asked about ${piece}, quoting ${id}.`,
      )
      expect(text).not.toContain(INSTEAD)
      expect(text).not.toContain(CANNOT_TELL)
      expect(text).not.toContain('It had passed your question up')
    })

    it('asked of a person, passed up to a person and answered there: the person’s answer is said, never “instead of that person”', async () => {
      const { pm, worker, workerTools, piece } = await aPmWithAWorkerOnATask()
      const id = await ask(workerTools, 'a-person', piece, 'which colour?')
      const up = await passUp(pm.tools, id, worker, 'a-person')
      await aPersonAnswers(pm.id, up, 'blue')
      await answerDown(pm.tools, id, worker, 'blue')

      const text = await theAnswerTo(worker, id)
      expect(text).toContain(
        `${host.nameByItsWork(pm.id)} answered the question you asked about ${piece}, quoting ${id}.\n\n${PASSED_UP}`,
      )
      expect(text).not.toContain(INSTEAD)
      expect(text).not.toContain(CANNOT_TELL)
    })
  })

  describe('§3 · a peer’s answer has neither sentence', () => {
    it('asked of a peer by name and answered by it: neither sentence', async () => {
      const ada = await personOpens(DEFAULT_PROFILE_ID)
      const bo = await personOpens('reviewer')
      const asked = await callOn(ada.tools, 'ask_question', {
        who_answers: 'an-agent',
        agent: bo.id,
        question: 'which schema do you use?',
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      const id = asked.question as string
      const answered = await callOn(bo.tools, 'answer_question', {
        question: id,
        asked_by: ada.id,
        answers: [{ part: 'answer', answer: ['the one in schema.sql'] }],
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')

      const text = await theAnswerTo(ada.id, id)
      expect(text).toContain(
        `${host.nameByItsWork(bo.id)} answered the question you asked, quoting ${id}.`,
      )
      expect(text).not.toContain('It had passed your question up')
      expect(text).not.toContain(INSTEAD)
      expect(text).not.toContain(CANNOT_TELL)
    })
  })
})
