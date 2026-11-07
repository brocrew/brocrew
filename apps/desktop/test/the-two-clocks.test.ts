import { fixtureProviderConfig, neutralHostDeps, RecordingSink } from './lib/host-fixture'
import { waitFor } from './lib/f093-host'
import type { RoutedRequest } from '../src/shared/question-contracts'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/conversation-events'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  CHAIN_HOP_LIMIT,
  REQUEST_IS_OPEN,
  chainSentence,
  deriveRoutedRequests,
  escalationChain,
} from '../src/shared/questions'

import {
  codeOnly,
  sourceOf,
  expectTypeImports,
  expectNoDeadlineDeps,
} from './helpers/source-contracts'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')
const sharedRoot = join(here, '../src/shared')

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

const ESCALATE_WINDOW = 3_000

describe('398 · 612 · the two clocks this app had, and the nothing that replaced them', () => {
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
  let pairs: number
  const tick = (): number => clock++

  const buildHost = (over: SessionStore = store): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      ...neutralHostDeps(() => userData),
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
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-clocks-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-clocks-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
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

  const waitOutMs = (ms: number): void => {
    clock += ms
  }

  const thePmPassesItUp = async (pm: string, questionId: string): Promise<string> => {
    const passed = await callOn(agentToolsFor(host, pm), 'pass_question_up', {
      question: questionId,
      who_answers: 'a-person',
    })
    expect(passed.outcome, JSON.stringify(passed)).toBe('ok')
    return passed.question as string
  }

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

  const bringIdentityIntoBeing = async (
    profileId: string,
    provider: Provider = 'claude',
  ): Promise<void> => {
    const id = await personOpens(profileId, host, provider)
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

  const ledger = (sessionId: string): readonly PersistedEventInfo[] => store.events(sessionId)
  const events = (sessionId: string): TranscriptEvent[] =>
    ledger(sessionId).map((entry) => entry.event)

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  const aPmAndItsWorker = async (
    provider: Provider = 'claude',
    on: RuntimeHost = host,
  ): Promise<{
    pm: string
    pmProfile: string
    worker: string
    pmTools: AgentToolset
    workerHandle: FakeSessionHandle
  }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    for (const one of [workerProfile, `${workerProfile}-b`])
      await bringIdentityIntoBeing(one, provider)
    const pm = await personOpens(pmProfile, on, provider)
    const pmTools = agentToolsFor(on, pm)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'The work',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { pm, pmProfile, worker: given.agent as string, pmTools, workerHandle: latestHandle() }
  }

  const filesUnder = (dir: string): { path: string; text: string }[] => {
    const out: { path: string; text: string }[] = []
    const walk = (at: string, prefix: string): void => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const full = join(at, entry.name)
        if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`)
        else if (entry.name.endsWith('.ts')) {
          out.push({ path: `${prefix}${entry.name}`, text: readFileSync(full, 'utf8') })
        }
      }
    }
    walk(dir, '')
    return out
  }

  describe('§2 · there is no decider, and a launch had nothing to sweep even when there was', () => {
    it('🔴 a question CANNOT survive a launch, which is why there is no launch sweep for it', async () => {
      const { worker, workerHandle } = await aPmAndItsWorker()
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      expect(store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)?.state).toBe(
        'open',
      )

      waitOutMs(ESCALATE_WINDOW * 5)
      buildHost(createSessionStore(db, tick))

      const row = store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)
      expect(row?.state).toBe('stranded')
      expect(REQUEST_IS_OPEN[row?.state ?? 'open']).toBe(false)
      expect(row?.escalatedAt).toBeNull()
    })

    it('⛔ 612 · nothing in this app decides a question has run out of time', () => {
      const store_ = codeOnly(sourceOf(join(mainRoot, 'db'), 'session-store.ts'))
      const host_ = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      const questions_ = codeOnly(sourceOf(sharedRoot, 'questions.ts'))

      expect(store_).not.toContain('escalationsDue')
      expect(store_).not.toContain("type: 'request_escalated'")
      for (const gone of [
        'watchForEscalation',
        'armEscalationLook',
        'writeWhatIsDue',
        'escalationWindowMs',
      ]) {
        expect(host_, gone).not.toContain(gone)
      }
      expect(questions_).not.toContain('ESCALATION_WINDOW_MS')

      expect(store_).toContain('questionsAPersonMustAnswer')
      expect(host_).toContain('passQuestionUp')
      expect(questions_).toContain('aPersonsSince')
      expect(store_).not.toContain('work_quiet')
      expect(host_).not.toContain('work_quiet')
      expectNoDeadlineDeps(mainRoot, 'quiet-work')
    })
  })

  describe('§4 · both providers', () => {
    for (const provider of ['claude', 'codex'] as const) {
      it(`⛔ ${provider}: a question its parent will not answer reaches a person`, async () => {
        const { pm, worker, workerHandle } = await aPmAndItsWorker(provider)
        expect(store.recordedOne(worker)?.provider).toBe(provider)
        const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
        await waitFor(
          () =>
            events(worker).some(
              (event) => event.type === 'request_routed' && event.requestId === raised.id,
            ),
          'the routing',
        )
        const passed = await thePmPassesItUp(pm, raised.id)
        expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toEqual([
          passed,
        ])
        expect(store.questionsRaisedIn(pm).get(passed)?.prompt).toBe('which region?')
        expect(store.questionsRaisedIn(pm).get(passed)?.passedUpFrom).toBe(raised.id)
      })
    }
  })

  describe('§5 · a question reaches a person because somebody decided', () => {
    it('⛔ the paired negative: the PARENT answers it, and nobody else is ever told', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const pmTools = agentToolsFor(host, pm)
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      const askedAt =
        store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)?.at ?? 0

      const answered = await callOn(pmTools, 'answer_question', {
        question: raised.id,
        answers: [{ part: 'q0', answer: ['eu'] }],
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')

      clock = askedAt + 5_000_000
      const row = store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)
      expect(row?.state).toBe('answered')
      expect(row?.escalatedAt).toBeNull()
      expect(host.questionsForAPerson().rows).toHaveLength(0)
      expect(events(worker).filter((event) => event.type === 'request_escalated')).toEqual([])
    })

    it('🔴 no amount of elapsed time stamps anything, and nothing is armed to try', async () => {
      const { worker, workerHandle } = await aPmAndItsWorker()
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      const askedAt =
        store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)?.at ?? 0
      expect(askedAt).toBeGreaterThan(0)

      clock = askedAt + 30_000_000
      await new Promise((resolve) => setTimeout(resolve, 120))

      const row = store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)
      expect(row?.escalatedAt).toBeNull()
      expect(row?.state).toBe('open')
      expect(events(worker).filter((event) => event.type === 'request_escalated')).toEqual([])
      expect(host.questionsForAPerson().rows).toEqual([])

      const passed = await thePmPassesItUp(store.parentOf(worker) ?? '', raised.id)
      expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toEqual([passed])
      const persons = host.questionsForAPerson().rows[0]
      expect(persons?.request.escalatedAt).toBeNull()
      expect(persons?.request.went.is).toBe('the-person-the-asker-named')
    })

    it('🔴 passing it up does not un-ask it: the parent can still answer, and does', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const pmTools = agentToolsFor(host, pm)
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      const passed = await thePmPassesItUp(pm, raised.id)
      expect(store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)?.state).toBe(
        'open',
      )

      const answered = await callOn(pmTools, 'answer_question', {
        question: raised.id,
        answers: [{ part: 'q0', answer: ['eu'] }],
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')

      const row = store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)
      expect(row?.state).toBe('answered')
      expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toEqual([passed])
    })

    it('🔴 two answers to one question: the FIRST wins and the second is refused BY NAME', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const pmTools = agentToolsFor(host, pm)
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )

      host.claimSession(worker, window)
      const ack = await host.respondUserInput(
        worker,
        raised.id,
        { kind: 'answer', answers: { q0: ['eu'] } },
        window,
      )
      expect(ack.outcome).toBe('taken')

      const second = await callOn(pmTools, 'answer_question', {
        question: raised.id,
        answers: [{ part: 'q0', answer: ['us'] }],
      })
      expect(second.outcome).toBe('refused')
      expect(second.rail).toBe('question-has-already-ended')
      expect((second.detail as { state?: string } | undefined)?.state).toBe('answered')
    })

    it('⛔ a PERMISSION is never escalated, and every refusal shape is the control', async () => {
      const { worker, workerHandle } = await aPmAndItsWorker()
      host.claimSession(worker, window)
      await waitFor(
        () => workerHandle.status() === 'waiting_permission',
        'the worker to raise its permission card',
      )
      await waitFor(
        () => events(worker).some((event) => event.type === 'permission_request'),
        'the card to reach the ledger',
      )
      const routed = store.routedRequestsOf(worker)
      expect(routed.length).toBeGreaterThan(0)
      expect(routed.every((one) => one.went.is === 'the-person-the-channel-left-it-with')).toBe(
        true,
      )
      expect(routed.every((one) => one.went.to === 'a-person')).toBe(true)

      waitOutMs(30_000_000)
      expect(store.routedRequestsOf(worker).every((one) => one.escalatedAt === null)).toBe(true)
      expect(host.questionsForAPerson().rows).toHaveLength(0)
      expect(store.routedRequestsOf(worker).length).toBe(routed.length)
    })
  })

  describe('§6 · worker waiting on PM, PM waiting on you', () => {
    const request = (
      over: Partial<RoutedRequest> & { requestId: string; askedBy: string; parent: string },
    ): RoutedRequest => ({
      went: { is: 'the-parent', to: 'the-parent' },
      at: 1,
      state: 'open',
      endedAt: null,
      escalatedAt: 1,
      ...over,
    })

    it('🔴 a chain of ONE is still a chain, and it reads as HO-007 wrote it', () => {
      const worker = request({ requestId: 'req_1', askedBy: 'sess_worker', parent: 'sess_pm' })
      const chain = escalationChain(worker, () => null)
      expect(chain.endsWithAPerson).toBe(true)
      expect(chain.links).toEqual([{ waiting: 'sess_worker', requestId: 'req_1', on: 'sess_pm' }])
      expect(chainSentence(chain, (id) => id.replace('sess_', ''))).toBe(
        'worker waiting on pm, pm waiting on you',
      )
    })

    it('⛔ a PM blocked on its own question makes the chain longer, in order', () => {
      const worker = request({ requestId: 'req_1', askedBy: 'sess_worker', parent: 'sess_pm' })
      const pm = request({ requestId: 'req_2', askedBy: 'sess_pm', parent: 'sess_lead' })
      const chain = escalationChain(worker, (id) => (id === 'sess_pm' ? pm : null))
      expect(chain.endsWithAPerson).toBe(true)
      expect(chain.links.map((link) => link.waiting)).toEqual(['sess_worker', 'sess_pm'])
      expect(chainSentence(chain, (id) => id.replace('sess_', ''))).toBe(
        'worker waiting on pm, pm waiting on lead, lead waiting on you',
      )
    })

    it('⛔ a CYCLE is refused, and the sentence does not name a person after it', () => {
      const a = request({ requestId: 'req_a', askedBy: 'sess_a', parent: 'sess_b' })
      const b = request({ requestId: 'req_b', askedBy: 'sess_b', parent: 'sess_a' })
      const chain = escalationChain(a, (id) => (id === 'sess_b' ? b : id === 'sess_a' ? a : null))
      expect(chain.endsWithAPerson).toBe(false)
      expect(chain.links).toHaveLength(2)
      expect(chainSentence(chain, (id) => id)).toContain('could not be followed')
      expect(chainSentence(chain, (id) => id)).not.toContain('waiting on you')
    })

    it('⛔ an absurd chain stops at the bound rather than walking for ever', () => {
      const chain = escalationChain(
        request({ requestId: 'req_0', askedBy: 'sess_0', parent: 'sess_1' }),
        (id) => {
          const nth = Number(id.replace('sess_', ''))
          return request({
            requestId: `req_${String(nth)}`,
            askedBy: `sess_${String(nth)}`,
            parent: `sess_${String(nth + 1)}`,
          })
        },
      )
      expect(chain.links).toHaveLength(CHAIN_HOP_LIMIT)
      expect(chain.endsWithAPerson).toBe(false)
    })

    it('🔴 the live chain, off a real ledger, names the conversations a person sees', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      const passed = await thePmPassesItUp(pm, raised.id)

      const waiting = host.questionsForAPerson().rows
      expect(waiting).toHaveLength(1)
      const only = waiting[0]
      expect(only?.request.askedBy).toBe(pm)
      expect(only?.request.requestId).toBe(passed)
      expect(only?.chain.links).toEqual([{ waiting: pm, requestId: passed, on: null }])
      expect(only?.chain.endsWithAPerson).toBe(true)
      expect(only?.sentence).toContain('waiting on you')
      expect(only?.sentence.split(' waiting on ')).toHaveLength(2)
      expect(store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)?.state).toBe(
        'open',
      )
    })

    it('⛔ the wire carries it: the command answers a person and takes nothing', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      const passed = await thePmPassesItUp(pm, raised.id)

      const { executeRuntimeCommand } = await import('../src/main/runtime/ipc')
      const answered = (await executeRuntimeCommand(host, window, {
        kind: 'questionsForAPerson',
      })) as {
        rows: { request: { requestId: string }; sentence: string }[]
        walk: string
        ledgers: number
      }
      expect(answered.rows.map((one) => one.request.requestId)).toEqual([passed])
      expect(answered.rows[0]?.sentence).toContain('waiting on you')
      expect(answered.walk).toBe('every-conversation-that-routed')
      expect(answered.ledgers).toBeGreaterThan(0)
      expect(JSON.stringify(answered)).toContain('which region?')
    })
  })

  describe('§8 · 612 · nothing happens on its own, and the act does', () => {
    it('🔴 an unanswered question escalates NEVER, and the pass-up is the control', async () => {
      const on = buildHost(store)
      const { pm, worker, workerHandle } = await aPmAndItsWorker('claude', on)
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(events(worker).filter((event) => event.type === 'request_escalated')).toEqual([])
      expect(
        store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)?.escalatedAt,
      ).toBeNull()
      expect(on.questionsForAPerson().rows).toEqual([])

      const passed = await callOn(agentToolsFor(on, pm), 'pass_question_up', {
        question: raised.id,
        who_answers: 'a-person',
      })
      expect(passed.outcome, JSON.stringify(passed)).toBe('ok')
      expect(on.questionsForAPerson().rows.map((one) => one.request.requestId)).toEqual([
        passed.question,
      ])
    })
  })

  describe('§9 · one number, one decision, one order', () => {
    it('⛔ there is no window left to refuse, and no guard left to refuse it with', () => {
      const host_ = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      expect(host_).not.toContain('positiveWindow')
      expect(host_).not.toContain('escalationWindowMs')
      expect(host_).not.toContain('proposalBoundMs')
      expectNoDeadlineDeps(mainRoot, 'answer-windows')
      expect(host_).toContain('deps.closeDrainTimeoutMs ?? DEFAULT_CLOSE_DRAIN_TIMEOUT_MS')
      expect(host_).toContain('deps.interruptWaitMs ?? DEFAULT_INTERRUPT_WAIT_MS')
      expect(host_).not.toContain('launchTimeoutMs')
    })

    it('🔴 ZERO places decide the row, and the control shows the walk can see two', () => {
      const writers = (literal: string): string[] =>
        filesUnder(join(here, '../src/main'))
          .filter(({ text }) => codeOnly(text).includes(literal))
          .map(({ path }) => path)
          .sort()
      expect(writers("type: 'request_escalated'")).toEqual([])
      expect(writers('escalationsDue(')).toEqual([])
      expect(writers("'request_routed'")).toEqual([
        'db/committed-changes.ts',
        'db/conversation-tree.ts',
        'db/fold-index.ts',
        'db/schema.ts',
        'db/session-store.ts',
        'db/team-profile-graph-engine.ts',
        'db/window-read-engine.ts',
        'db/window-writer-stamp.ts',
        'runtime/digest.ts',
        'runtime/runtime-host.ts',
      ])
    })

    it('⛔ the runtime package never learned the word, and now nothing else knows it either', () => {
      const runtime = filesUnder(join(here, '../../../packages/runtime/src')).map(
        ({ text }) => text,
      )
      expect(runtime.filter((text) => text.includes('request_escalated'))).toHaveLength(0)
      expect(runtime.filter((text) => text.includes('completeTurn')).length).toBeGreaterThan(1)
    })

    it('🔴 a stamp still lands on a question the parent answered a moment earlier', () => {
      const entries: PersistedEventInfo[] = [
        {
          ordinal: 0,
          at: 10,
          event: { type: 'request_routed', requestId: 'ui_1', to: 'the-parent', parent: 'sess_pm' },
        },
        {
          ordinal: 1,
          at: 20,
          event: { type: 'user_decision', requestId: 'ui_1', outcome: 'answered' },
        },
        { ordinal: 2, at: 15, event: { type: 'request_escalated', requestId: 'ui_1' } },
      ]
      const [row] = deriveRoutedRequests('sess_worker', entries)
      expect(row?.state).toBe('answered')
      expect(row?.escalatedAt).toBe(15)
    })

    it('⛔ the two shared folds still reach nothing — no clock, no store, no timer', () => {
      for (const file of [
        'tasks.ts',
        'questions.ts',
        'task-contracts.ts',
        'question-contracts.ts',
        'how-work-stopped.ts',
        'who-did-it.ts',
        'a-persons-own-words.ts',
      ]) {
        const text = sourceOf(sharedRoot, file)
        const allowed = [
          "import { AGENT_MESSAGE_KINDS, TASK_STATES } from './task-contracts'",
          "import { PASS_UP_RECIPIENTS } from './question-contracts'",
          "import { whoCancelledIt, type AskToStop } from './how-work-stopped'",
          "import { WHO_DID_IT, WHO_DID_IT_SAYS, type ActedBy, type WhoDidIt } from './who-did-it'",
          "import { aPersonsOwnWords } from './a-persons-own-words'",
        ]
        expectTypeImports(text, allowed, file)
        const code = codeOnly(text)
        expect(code, file).not.toContain('Date.now')
        expect(code, file).not.toContain('setTimeout')
      }
    })
  })
})
