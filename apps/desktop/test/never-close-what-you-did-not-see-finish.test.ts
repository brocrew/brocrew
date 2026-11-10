import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { waitFor } from './lib/f093-host'
import { TASK_STALL_CAUSES, TASK_STATES } from '../src/shared/task-contracts'
import type { PieceRow, TaskState } from '../src/shared/task-contracts'
import { REQUEST_STATES } from '../src/shared/question-contracts'
import { MAILBOX_KINDS } from '../src/shared/conversation-events'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset, FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { isGiverStallNotice, RuntimeHost } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  TASK_IS_OPEN,
  AN_ASK_RIDES_ON,
  UNDRIVEN_SENTENCES,
  derivePieces,
} from '../src/shared/tasks'
import { pieceLine } from '../src/shared/piece-called'
import { REQUEST_IS_OPEN } from '../src/shared/questions'
import {
  fixtureProviderConfig,
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
} from './lib/host-fixture'
import { ProviderDouble } from './lib/provider-double'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('400 · never close what you did not see finish', () => {
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
  let claimed: Set<string>
  let pairs: number
  const tick = (): number => clock++

  const buildHost = (over: SessionStore = store): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-undriven-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-undriven-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    claimed = new Set()
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    pairs = 0
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): readonly PersistedEventInfo[] => store.events(sessionId)
  const events = (sessionId: string): TranscriptEvent[] =>
    ledger(sessionId).map((entry) => entry.event)

  const personOpens = async (
    profileId: string,
    on: RuntimeHost = host,
    provider: Provider = 'claude',
  ): Promise<string> => {
    const { sessionId } = await on.createSession(
      { provider, profileId, approvalMode: 'ask', cwd: root },
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
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  interface Given {
    readonly piece: string
    readonly label: string
  }

  const aGive = async (
    tools: AgentToolset,
    profile: string,
    brief: string,
  ): Promise<Given & { worker: string; delivery: unknown }> => {
    const given = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title: brief,
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      worker: given.agent as string,
      piece: given.piece as string,
      label: given.label as string,
      delivery: given.delivery,
    }
  }

  const aPmAndItsWorker = async (
    provider: Provider = 'claude',
    on: RuntimeHost = host,
    brief = 'the work',
  ): Promise<
    Given & {
      pm: string
      worker: string
      /** The worker's profile — what a second give to the same agent names. */
      profile: string
      pmTools: AgentToolset
      workerHandle: FakeSessionHandle
      giveAnother: (
        brief: string,
      ) => Promise<Given & { worker: string; workerHandle: FakeSessionHandle }>
    }
  > => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    for (const one of [workerProfile, `${workerProfile}-b`]) await bringIdentityIntoBeing(one)
    const pm = await personOpens(pmProfile, on, provider)
    const pmTools = agentToolsFor(on, pm)
    const first = await aGive(pmTools, workerProfile, brief)
    return {
      pm,
      worker: first.worker,
      profile: workerProfile,
      piece: first.piece,
      label: first.label,
      pmTools,
      workerHandle: latestHandle(),
      giveAnother: async (another) => {
        const second = await aGive(pmTools, `${workerProfile}-b`, another)
        return {
          worker: second.worker,
          piece: second.piece,
          label: second.label,
          workerHandle: latestHandle(),
        }
      },
    }
  }

  const cardsOn = (sessionId: string): number =>
    events(sessionId).filter((event) => event.type === 'permission_request').length

  const cardOn = async (sessionId: string, after = 0): Promise<string> => {
    await waitFor(() => cardsOn(sessionId) > after, 'the card the turn parks on')
    const asked = events(sessionId)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (asked === undefined || asked.type !== 'permission_request') {
      throw new Error('no permission request on the ledger')
    }
    return asked.id
  }

  const letTheTurnFinish = async (
    sessionId: string,
    on: RuntimeHost = host,
    after = 0,
  ): Promise<void> => {
    const turnsBefore = events(sessionId).filter((event) => event.type === 'turn').length
    const id = await cardOn(sessionId, after)
    if (!claimed.has(sessionId)) {
      on.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await on.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    await waitFor(
      () => events(sessionId).filter((event) => event.type === 'turn').length > turnsBefore,
      'the turn to reach its own terminal',
    )
  }

  const taskOf = (sessionId: string, piece: string): PieceRow | undefined =>
    store.piecesOwnedBy(sessionId).find((one) => one.piece === piece)

  const stateOf = (sessionId: string, piece: string): TaskState | undefined =>
    taskOf(sessionId, piece)?.state

  const wordsSentTo = (parent: string): string[] =>
    events(parent)
      .filter((event) => event.type === 'user_turn')
      .map((event) => (event.type === 'user_turn' ? event.text : ''))

  const noticesTo = (parent: string, label: string): string[] => {
    const given = store.workByLabel(label)
    if (given === null) throw new Error(`no piece is labelled ${label}`)
    const line = pieceLine(label, given.title)
    return wordsSentTo(parent).filter(
      (text) =>
        (text.includes(line) || text.startsWith(`${label} still needs attention:`)) &&
        isGiverStallNotice(text),
    )
  }

  const unplugTheWindow = (): void => {
    window.alive = false
  }

  const relaunchAfterACrash = (): RuntimeHost => buildHost(createSessionStore(db, tick))

  describe('one word for “nothing is driving this”, and the two vocabularies stay two', () => {
    it('`silent` is gone and `stalled` survives', () => {
      expect([...TASK_STATES]).toEqual([
        'waiting',
        'working',
        'waiting-on-an-answer',
        'waiting-on-a-person',
        'waiting-on-a-worker',
        'waiting-on-the-person-who-asked',
        'waiting-on-the-person-who-wrote',
        'waiting-on-purpose',
        'stalled',
        'answered',
        'withdrawn',
        'closed',
      ])
      expect([...TASK_STATES]).not.toContain('silent')
    })

    it('the TASK vocabulary lost `abandoned` and the REQUEST vocabulary kept it', () => {
      expect([...TASK_STATES]).not.toContain('abandoned')
      expect([...REQUEST_STATES]).toContain('abandoned')
      expect(REQUEST_IS_OPEN.abandoned).toBe(false)
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
        // The work it was about was handed back.
        'work-replied',
        'recipient-ended',
      ])
    })

    it('exactly three states close a task, and all of them are somebody DECIDING', () => {
      expect(Object.keys(TASK_IS_OPEN).sort()).toEqual([...TASK_STATES].sort())
      expect(TASK_STATES.filter((state) => !TASK_IS_OPEN[state])).toEqual([
        'answered',
        'withdrawn',
        'closed',
      ])
      expect(TASK_IS_OPEN.stalled).toBe(true)
    })

    it('the stall causes, and the ones an ask rides on', () => {
      expect([...TASK_STALL_CAUSES]).toEqual([
        'turn_ended',
        'turn_interrupted',
        'app_restarted',
        'message_never_sent',
        'could_not_be_reopened',
        'background_stopped',
        'provider_limited',
        'login_refused',
        'billing_refused',
      ])
      expect(TASK_STALL_CAUSES.filter((cause) => AN_ASK_RIDES_ON[cause])).toEqual([
        'turn_ended',
        'turn_interrupted',
        'provider_limited',
        'login_refused',
        'billing_refused',
      ])
    })
  })

  describe('§2 · a turn that ends with the work open, and the parent is TOLD', () => {
    it('🔴 the headline: the turn ends, the task stalls, and the parent is pushed WITH NO WINDOW', async () => {
      const {
        pm,
        worker,
        piece: task,
        label,
      } = await aPmAndItsWorker('claude', host, 'do the thing')
      expect(stateOf(worker, task)).toBe('working')

      await cardOn(worker)
      const sawBefore = window.messages.length
      unplugTheWindow()
      await letTheTurnFinish(worker)

      expect(taskOf(worker, task)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_ended',
        endedAt: null,
        outcome: null,
      })
      expect(TASK_IS_OPEN.stalled).toBe(true)

      await waitFor(() => noticesTo(pm, label).length === 1, 'the parent to be told')
      const told = noticesTo(pm, label)[0] ?? ''
      expect(told).toContain('its turn ended with this work still open')
      expect(told).not.toContain('replied nothing')
      expect(told).toContain(label)
      expect(told).toContain('after a reminder')
      expect(told).toContain('Follow it up with them, or close it and give it again.')
      expect(
        window.messages
          .slice(sawBefore)
          .filter(
            (one) => JSON.stringify(one).includes(task) || JSON.stringify(one).includes(label),
          ),
      ).toEqual([])
      expect(sawBefore).toBeGreaterThan(0)
    })

    it('⛔ the paired negative: a child that REPLIES is not stalled and its parent gets no notice', async () => {
      const {
        pm,
        worker,
        piece: task,
        label,
      } = await aPmAndItsWorker('claude', host, 'do the thing')
      await cardOn(worker)
      unplugTheWindow()

      const answered = await callOn(agentToolsFor(host, worker), 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'it is done',
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      await letTheTurnFinish(worker)

      expect(taskOf(worker, task)).toMatchObject({ state: 'answered', outcome: 'done' })
      expect(noticesTo(pm, label)).toEqual([])
      expect(wordsSentTo(pm).some((text) => text.includes('it is done'))).toBe(true)
    })

    it('🔴 an INTERRUPTED turn stalls it too, and `393` and `398` both ruled the other way', async () => {
      const {
        pm,
        worker,
        piece: task,
        label,
      } = await aPmAndItsWorker('claude', host, 'the long job')
      await cardOn(worker)
      unplugTheWindow()
      host.claimSession(worker, window)
      claimed.add(worker)
      await host.interrupt(worker, window)
      await waitFor(() => stateOf(worker, task) === 'stalled', 'the interrupted task')

      expect(taskOf(worker, task)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_interrupted',
        endedAt: null,
      })
      await waitFor(() => noticesTo(pm, label).length === 1, 'the parent to be told')
      expect(noticesTo(pm, label)[0]).toContain('the turn it was running in was stopped')
      expect(noticesTo(pm, label)[0]).not.toContain('with this work still open')
      expect(noticesTo(pm, label)[0]).not.toContain('replied nothing')
    })

    it('⛔ the notice is NOT refused when the parent is already holding work — criterion 13 intact', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      await cardOn(worker)

      await host.send(pm, 'think about something', window)
      await cardOn(pm)
      const held = await host.queueMessage(pm, 'a person’s words, held', window)
      expect(held.outcome).toBe('queued')
      unplugTheWindow()

      await letTheTurnFinish(worker)
      await waitFor(
        () =>
          events(pm).some((event) => event.type === 'message_queued' && event.kind === 'notice'),
        'the notice to take a slot beside the held work',
      )
      const kinds = events(pm)
        .filter((event) => event.type === 'message_queued')
        .map((event) => (event.type === 'message_queued' ? event.kind : undefined))
      expect(kinds).toEqual(['work', 'notice'])
      expect([...MAILBOX_KINDS]).toContain('notice')
      const next = await host.queueMessage(pm, 'a person’s next words', window)
      expect(next.outcome).toBe('queued')
    })

    it('⛔ told once per episode: a second look says nothing, and a second stall says it again', async () => {
      const {
        pm,
        worker,
        workerHandle,
        piece: task,
        label,
      } = await aPmAndItsWorker('claude', host, 'round one')
      await cardOn(worker)
      unplugTheWindow()
      await letTheTurnFinish(worker)
      await waitFor(() => noticesTo(pm, label).length === 1, 'the first notice')

      await waitFor(() => workerHandle.status() === 'idle', 'the first turn to settle')
      const roundOne = cardsOn(worker)
      await host.send(worker, 'a person prods it', window)
      await letTheTurnFinish(worker, host, roundOne)
      expect(noticesTo(pm, label)).toHaveLength(1)

      await waitFor(() => workerHandle.status() === 'idle', 'the second turn to settle')
      const roundTwo = cardsOn(worker)
      await host.send(worker, 'try again', window)
      await cardOn(worker, roundTwo)
      await host.interrupt(worker, window)
      await waitFor(() => workerHandle.status() === 'idle', 'the interrupted turn to settle')
      expect(taskOf(worker, task)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_interrupted',
      })
      expect(noticesTo(pm, label)).toHaveLength(1)
    })
  })

  describe('§3 · the app is killed while the work is running', () => {
    it('🔴 the headline: a task that was RUNNING comes back OPEN, with the app’s own row saying why', async () => {
      const { worker, piece: task } = await aPmAndItsWorker(
        'claude',
        host,
        'work that outlives a kill',
      )
      await cardOn(worker)
      expect(stateOf(worker, task)).toBe('working')
      expect(events(worker).some((event) => event.type === 'work_restarted')).toBe(false)

      const next = relaunchAfterACrash()
      try {
        expect(events(worker).filter((event) => event.type === 'work_restarted')).toHaveLength(1)
        expect(taskOf(worker, task)).toMatchObject({
          state: 'stalled',
          stalledBecause: 'app_restarted',
          endedAt: null,
        })
        expect(TASK_IS_OPEN[taskOf(worker, task)?.state ?? 'answered']).toBe(true)
      } finally {
        await next.closeAll()
      }
    })

    it('⛔ the paired negative: a launch that finds the ledger LIVE writes nothing', async () => {
      const { worker, piece: task } = await aPmAndItsWorker(
        'claude',
        host,
        'work somebody is doing',
      )
      await cardOn(worker)

      const alongside = buildHost()
      try {
        expect(events(worker).filter((event) => event.type === 'work_restarted')).toEqual([])
        expect(stateOf(worker, task)).toBe('working')
        const blind = relaunchAfterACrash()
        try {
          expect(events(worker).filter((event) => event.type === 'work_restarted')).toHaveLength(1)
        } finally {
          await blind.closeAll()
        }
      } finally {
        await alongside.closeAll()
      }
    })

    it('⛔ a second launch writes no second row, and the latch is the derived state itself', async () => {
      const { worker } = await aPmAndItsWorker()
      await cardOn(worker)

      const first = relaunchAfterACrash()
      await first.closeAll()
      expect(events(worker).filter((event) => event.type === 'work_restarted')).toHaveLength(1)
      const second = relaunchAfterACrash()
      try {
        expect(events(worker).filter((event) => event.type === 'work_restarted')).toHaveLength(1)
      } finally {
        await second.closeAll()
      }
    })

    it('⛔ a RESTART does not re-tell: a stall a previous life already reported is not news', async () => {
      const { pm, worker, piece: task, label } = await aPmAndItsWorker()
      await cardOn(worker)
      unplugTheWindow()
      await letTheTurnFinish(worker)
      await waitFor(() => noticesTo(pm, label).length === 1, 'the first notice')

      await host.closeAll()
      host = buildHost()
      await host.resumeSession(pm, window)
      await host.resumeSession(worker, window)
      expect(taskOf(worker, task)).toMatchObject({ state: 'stalled', endedAt: null })

      const before = cardsOn(worker)
      await host.send(worker, 'a person prods it', window)
      await letTheTurnFinish(worker, host, before)
      expect(noticesTo(pm, label)).toHaveLength(1)
    })

    it('⛔ a cause with no audience is recorded and NOT pushed, beside one that is', async () => {
      const { pm, worker, profile, pmTools, giveAnother } = await aPmAndItsWorker(
        'claude',
        host,
        'the first one',
      )
      const other = await giveAnother('the running one')
      const running = other.piece
      await cardOn(other.worker)
      await cardOn(worker)
      const held = await aGive(pmTools, profile, 'the held one')
      expect(held.worker).toBe(worker)
      expect(held.delivery, JSON.stringify(held)).toBe('held')
      const waiting = held.piece
      expect(stateOf(worker, waiting)).toBe('waiting')
      host.claimSession(other.worker, window)
      unplugTheWindow()

      await host.close(other.worker, window)
      await waitFor(() => noticesTo(pm, other.label).length === 1, 'the control notice')

      const next = relaunchAfterACrash()
      try {
        await waitFor(() => stateOf(worker, waiting) === 'stalled', 'the held work to stall')

        expect(taskOf(worker, waiting)?.stalledBecause).toBe('message_never_sent')
        expect(noticesTo(pm, held.label)).toEqual([])
      } finally {
        await next.closeAll()
      }
      expect(taskOf(other.worker, running)?.stalledBecause).toBe('turn_interrupted')
      expect(noticesTo(pm, other.label)[0]).toContain(
        UNDRIVEN_SENTENCES.turn_interrupted.replace(/\.$/, ''),
      )
    })

    it('⛔ a conversation with no open task is never written about', async () => {
      const { worker, piece: task, label } = await aPmAndItsWorker()
      await cardOn(worker)
      const answered = await callOn(agentToolsFor(host, worker), 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'finished before the crash',
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')

      const next = relaunchAfterACrash()
      try {
        expect(events(worker).filter((event) => event.type === 'work_restarted')).toEqual([])
        expect(stateOf(worker, task)).toBe('answered')
      } finally {
        await next.closeAll()
      }
    })

    it('🔴 the CLEAN quit reaches the same place by a different row, and neither closes the work', async () => {
      const { worker, piece: task } = await aPmAndItsWorker()
      await cardOn(worker)

      await host.closeAll()
      expect(events(worker).some((event) => event.type === 'status')).toBe(true)
      expect(taskOf(worker, task)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_interrupted',
        endedAt: null,
      })
      const next = relaunchAfterACrash()
      try {
        expect(events(worker).filter((event) => event.type === 'work_restarted')).toEqual([])
      } finally {
        await next.closeAll()
      }
    })

    it('⛔ work still HELD when the app died gets its own cause, and the MESSAGE is still abandoned', async () => {
      const { worker, profile, pmTools } = await aPmAndItsWorker('claude', host, 'are you free?')
      await cardOn(worker)
      const held = await aGive(pmTools, profile, 'the held one')
      expect(held.worker).toBe(worker)
      expect(held.delivery, JSON.stringify(held)).toBe('held')
      const waiting = held.piece
      expect(stateOf(worker, waiting)).toBe('waiting')

      const next = relaunchAfterACrash()
      try {
        const ending = events(worker).filter((event) => event.type === 'message_unqueued')
        expect(ending).toHaveLength(1)
        expect(ending[0]).toMatchObject({ reason: 'abandoned' })
        expect(taskOf(worker, waiting)).toMatchObject({
          state: 'stalled',
          stalledBecause: 'message_never_sent',
          endedAt: null,
        })
      } finally {
        await next.closeAll()
      }
    })
  })

  describe('§4 · a question that was pending when the app stopped', () => {
    const aChildHoldingWorkAndAQuestion = async (): Promise<{
      pm: string
      worker: string
      task: string
      request: string
    }> => {
      const { pm, worker, workerHandle, piece: task } = await aPmAndItsWorker()
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      return { pm, worker, task, request: raised.id }
    }

    it('🔴 the request CLOSES and the task says a question was lost — two vocabularies, one restart', async () => {
      const { worker, task, request } = await aChildHoldingWorkAndAQuestion()
      expect(taskOf(worker, task)?.questionLostAtRestart).toBe(false)

      const next = relaunchAfterACrash()
      try {
        const row = store.routedRequestsOf(worker).find((one) => one.requestId === request)
        expect(row?.state).toBe('stranded')
        expect(REQUEST_IS_OPEN.stranded).toBe(false)
        expect(taskOf(worker, task)).toMatchObject({
          questionLostAtRestart: true,
          state: 'stalled',
        })
      } finally {
        await next.closeAll()
      }
    })

    it('⛔ the paired negative: a question ANSWERED before the crash leaves the flag false', async () => {
      const { pm, worker, task, request } = await aChildHoldingWorkAndAQuestion()
      const answered = await callOn(agentToolsFor(host, pm), 'answer_question', {
        question: request,
        answers: [{ part: 'q0', answer: ['eu'] }],
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')

      const next = relaunchAfterACrash()
      try {
        expect(store.routedRequestsOf(worker).find((one) => one.requestId === request)?.state).toBe(
          'answered',
        )
        expect(taskOf(worker, task)?.questionLostAtRestart).toBe(false)
        expect(taskOf(worker, task)?.stalledBecause).toBe('app_restarted')
      } finally {
        await next.closeAll()
      }
    })

    it('⛔ it is a LATCH: the answer outlives the ending, unlike the cause', async () => {
      const { worker, task } = await aChildHoldingWorkAndAQuestion()
      const next = relaunchAfterACrash()
      try {
        expect(taskOf(worker, task)?.questionLostAtRestart).toBe(true)
        await next.resumeSession(worker, window)
        const landed = await callOn(agentToolsFor(next, worker), 'reply_to_parent', {
          piece: task,
          outcome: 'blocked',
          summary: 'I never got my answer',
        })
        expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
        expect(taskOf(worker, task)).toMatchObject({
          state: 'answered',
          stalledBecause: null,
          questionLostAtRestart: true,
        })
      } finally {
        await next.closeAll()
      }
    })

    it('⛔ a model reads both, and the words are the ones the push uses', async () => {
      const { pm, task } = await aChildHoldingWorkAndAQuestion()
      const next = relaunchAfterACrash()
      try {
        await next.resumeSession(pm, window)
        const seen = (await callOn(agentToolsFor(next, pm), 'list_tasks', {})).you_gave as {
          piece: string
          state: string
          stalled_because: string | null
          question_lost_at_restart: boolean
        }[]
        const row = seen.find((one) => one.piece === task)
        expect(row).toMatchObject({
          state: 'stalled',
          stalled_because: 'app_restarted',
          question_lost_at_restart: true,
        })
        expect((await callOn(agentToolsFor(next, pm), 'list_tasks', {})).outcome).toBe('ok')
      } finally {
        await next.closeAll()
      }
    })
  })

  describe('both providers, and the order', () => {
    for (const provider of ['claude', 'codex'] as const) {
      it(`${provider}: a turn ends and the parent is told; the app dies and the work stays open`, async () => {
        const {
          pm,
          worker,
          giveAnother,
          piece: first,
          label,
        } = await aPmAndItsWorker(provider, host, `work on ${provider}`)
        await cardOn(worker)
        unplugTheWindow()
        await letTheTurnFinish(worker)
        await waitFor(() => noticesTo(pm, label).length === 1, `${provider}'s notice`)
        expect(taskOf(worker, first)?.stalledBecause).toBe('turn_ended')

        const other = await giveAnother('the second thing')
        const second = other.piece
        await cardOn(other.worker)
        expect(stateOf(other.worker, second)).toBe('working')

        const next = relaunchAfterACrash()
        try {
          expect(taskOf(other.worker, second)).toMatchObject({
            state: 'stalled',
            stalledBecause: 'app_restarted',
            endedAt: null,
          })
          expect(taskOf(worker, first)?.stalledBecause).toBe('turn_ended')
        } finally {
          await next.closeAll()
        }
      })
    }
  })

  describe('the fold', () => {
    it('is the same answer for the same ledger, and marks a question lost at restart', () => {
      const entries: PersistedEventInfo[] = [
        {
          ordinal: 0,
          at: 10,
          event: {
            type: 'work_given',
            piece: 'work_1',
            label: 'W1.1',
            parent: 'work_root',
            givenBy: 'sess_pm',
            title: 'a thing',
            brief: 'a thing',
          },
        },
        {
          ordinal: 1,
          at: 15,
          event: { type: 'request_routed', requestId: 'ui_1', to: 'the-parent', parent: 'sess_pm' },
        },
        { ordinal: 2, at: 20, event: { type: 'turn', state: 'completed' } },
        { ordinal: 3, at: 30, event: { type: 'work_restarted', pieces: ['work_1'] } },
        { ordinal: 4, at: 40, event: { type: 'request_stranded', requestId: 'ui_1' } },
      ]
      expect(derivePieces('sess_w', entries)).toEqual(derivePieces('sess_w', entries))
      expect(derivePieces('sess_w', entries)[0]).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_ended',
        questionLostAtRestart: true,
      })
      expect(
        derivePieces(
          'sess_w',
          entries.filter((entry) => entry.event.type !== 'request_routed'),
        )[0]?.questionLostAtRestart,
      ).toBe(false)
    })
  })
})
