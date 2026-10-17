import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, FakeSessionHandle, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { clockTimeFrom } from '../src/shared/clock'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * A helper in Ask mode whose turn is stopped on a person's approval takes nothing until the person
 * answers it — so its giver is told so, by every tool it reads it through: its state's line
 * (`get_agent_status`, `list_agents`), the record of the piece it holds (`list_tasks`) and the
 * receipt of what it sends it (`message_agent`). ⚑ Real host, real SQLite ledger; the provider is
 * the double, whose turn in Ask mode stops on its own card.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

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
}

const THE_BRIEF = 'run the tests'
/**
 * What the double's card asks, as the giver is told it: its tool, and the first line of what it
 * would run — the double runs the brief as it was sent, which opens with its sender line.
 */
const ITS_REQUEST = 'its request to use Bash (run: Sent by'

describe('a helper stopped on a person’s approval', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-stopped-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-stopped-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    const sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, sessions),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string, approvalMode: 'ask' | 'auto'): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answered = await tool.call(args)
    return {
      structured: (answered.structured ?? {}) as Record<string, unknown>,
      text: answered.text,
    }
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /**
   * A giver in Ask mode and the helper its give started: the brief is the helper's first turn,
   * which stops on its card, as a give runs in its giver's mode.
   */
  const aGiverAndItsStoppedHelper = async () => {
    await host.close(await personOpens('worker', 'ask'), window)
    const pm = await personOpens('pm', 'ask')
    const pmTools = agentToolsFor(host, pm)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The tests',
      brief: THE_BRIEF,
    })
    expect(given.structured['outcome'], given.text).toBe('ok')
    const worker = String(given.structured['agent'])
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no helper was started')
    await waitFor(
      () =>
        handle.status() === 'waiting_permission' &&
        ledger(worker).some((event) => event.type === 'permission_request'),
      'the helper’s turn to stop on its card',
    )
    const asked = ledger(worker).find((event) => event.type === 'permission_request')
    const routed = ledger(worker).find((event) => event.type === 'request_routed')
    if (asked?.type !== 'permission_request' || routed === undefined) throw new Error('no card')
    const at = store.events(worker).find((entry) => entry.event.type === 'request_routed')?.at ?? 0
    return {
      pm,
      pmTools,
      worker,
      handle,
      card: asked.id,
      label: String(given.structured['label']),
      at,
    }
  }

  /** When the card was asked, as the line says it. */
  const askedAt = (at: number): string => clockTimeFrom(at, clock)

  describe('every tool its giver reads it through says it, and that nothing sent goes in', () => {
    it('get_agent_status: what it asks, since when, and where the person answers it', async () => {
      const { pmTools, worker, at } = await aGiverAndItsStoppedHelper()
      const status = await callOn(pmTools, 'get_agent_status', { agent: worker })
      expect(status.text).toContain('needs you')
      expect(status.text).toContain(`(its turn is stopped until a person answers ${ITS_REQUEST}`)
      expect(status.text).toContain(
        `, asked at ${askedAt(at)}, under Waiting on you; nothing sent to it goes in until then)`,
      )
      const stopped = (
        status.structured['agent'] as { stoppedOnAPerson: { asks: string; since: number } }
      ).stoppedOnAPerson
      expect(stopped.since).toBe(at)
      // ⚑ One line of what it would run, cut short: the card the person answers holds the whole.
      expect(stopped.asks.startsWith(ITS_REQUEST)).toBe(true)
      expect(stopped.asks).not.toContain('\n')
      expect(stopped.asks).toMatch(/…\)$/)
    })

    it('list_agents: the helper’s line says it, and the giver’s does not', async () => {
      const { pm, pmTools, worker } = await aGiverAndItsStoppedHelper()
      const listed = await callOn(pmTools, 'list_agents', {})
      const lines = listed.text.split('\n')
      const helper = lines.find((line) => line.includes('worker') && line.includes('needs you'))
      expect(helper).toContain(`its turn is stopped until a person answers ${ITS_REQUEST}`)
      const agents = listed.structured['agents'] as { agent: string; stoppedOnAPerson: unknown }[]
      expect(agents.find((one) => one.agent === worker)?.stoppedOnAPerson).not.toBeNull()
      expect(agents.find((one) => one.agent === pm)?.stoppedOnAPerson).toBeNull()
    })

    it('message_agent: the receipt says it is held until the person answers', async () => {
      const { pmTools, worker, label } = await aGiverAndItsStoppedHelper()
      const sent = await callOn(pmTools, 'message_agent', {
        agent: worker,
        kind: 'follow-up',
        piece: label,
        text: 'You are blocked by a permission; do this instead.',
      })
      expect(sent.structured['delivery']).toBe('queued')
      expect(sent.text).toContain(`Its turn is stopped until a person answers ${ITS_REQUEST}`)
      expect(sent.text).toMatch(/under Waiting on you: nothing sent to it goes in until then\.$/)
      expect(sent.text).not.toContain('is free')
    })

    it('message_agent with interrupt: the stop is refused, and the words stay true', async () => {
      const { pmTools, worker, label, handle } = await aGiverAndItsStoppedHelper()
      const sent = await callOn(pmTools, 'message_agent', {
        agent: worker,
        kind: 'follow-up',
        piece: label,
        text: 'Stop and do this instead.',
        interrupt: true,
      })
      expect(sent.structured['delivery']).toBe('queued')
      expect(sent.structured['asked_to_stop']).toBe(false)
      expect(sent.text).toContain(`Its turn is stopped until a person answers ${ITS_REQUEST}`)
      // ⚑ What it waits for is said once; the refused stop says only why.
      expect(sent.text).toMatch(
        /was not interrupted: stopping it would answer for the person it waits on\.$/,
      )
      expect(sent.text).not.toContain('waits for that turn to end')
      expect(handle.status()).toBe('waiting_permission')
    })

    it('list_tasks: the piece it holds says what its holder’s turn is stopped on', async () => {
      const { pmTools } = await aGiverAndItsStoppedHelper()
      const board = await callOn(pmTools, 'list_tasks', {})
      expect(board.text).toContain(
        `the conversation holding it is waiting on a person (its turn is stopped until a person answers ${ITS_REQUEST}`,
      )
      // ⚑ Nothing is held for it yet: its brief went in as its turn.
      expect(board.text).not.toContain('what is held for the conversation holding it waits')
    })

    it('a question it asked its giver with ask_question holds no turn: the stop is still said', async () => {
      const { pmTools, worker, label } = await aGiverAndItsStoppedHelper()
      const asked = await callOn(agentToolsFor(host, worker), 'ask_question', {
        who_answers: 'the-parent',
        piece: label,
        question: 'Which suite?',
        options: ['unit', 'all'],
      })
      expect(asked.structured['outcome'], asked.text).toBe('ok')
      const status = await callOn(pmTools, 'get_agent_status', { agent: worker })
      expect(status.text).toContain(`its turn is stopped until a person answers ${ITS_REQUEST}`)
      const board = await callOn(pmTools, 'list_tasks', {})
      const held = (board.structured['you_gave'] as Record<string, unknown>[]).find(
        (one) => one['label'] === label,
      )
      expect(held?.['stopped_on_a_person']).toMatchObject({
        asks: expect.stringContaining(ITS_REQUEST) as unknown,
      })
    })

    it('list_tasks: with a message held for it, the stop is said once', async () => {
      const { pmTools, worker, label } = await aGiverAndItsStoppedHelper()
      await callOn(pmTools, 'message_agent', {
        agent: worker,
        kind: 'follow-up',
        piece: label,
        text: 'One more thing.',
      })
      const board = await callOn(pmTools, 'list_tasks', {})
      expect(board.text.split('its turn is stopped until a person answers')).toHaveLength(2)
      expect(board.text).not.toContain('Its turn is stopped')
      expect(board.text).not.toContain('what is held for the conversation holding it waits')
    })
  })

  describe('controls', () => {
    it('a turn that also waits on a question its giver answers is not said to wait on a person', async () => {
      const { pmTools, worker, handle, label } = await aGiverAndItsStoppedHelper()
      const raised = handle.simulateUserInput('Which suite?', ['unit', 'all'])
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the question to go to its giver',
      )
      // ⚑ The premise: it went to its giver, whose answer goes straight in.
      const routed = store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)
      expect(routed?.went.to).not.toBe('a-person')
      const status = await callOn(pmTools, 'get_agent_status', { agent: worker })
      expect(status.structured['agent']).toMatchObject({ stoppedOnAPerson: null })
      expect(status.text).not.toContain('its turn is stopped')
      const sent = await callOn(pmTools, 'message_agent', {
        agent: worker,
        kind: 'follow-up',
        piece: label,
        text: 'One more thing.',
      })
      expect(sent.text).not.toContain('Its turn is stopped')
    })

    it('…and at a usage limit, what is held for it waits for the limit and for that turn', async () => {
      const { pmTools, worker, handle, label } = await aGiverAndItsStoppedHelper()
      const raised = handle.simulateUserInput('Which suite?', ['unit', 'all'])
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the question to go to its giver',
      )
      // ⚑ A limit another Claude conversation here met, with a reset still ahead — a minute on, so
      // the limits are read again.
      clock += 60_000
      store.create({
        id: 'sess_wall',
        provider: 'claude',
        cwd: root,
        approvalMode: 'ask',
        profileId: 'default',
      })
      const resets = new Date(clock + 60 * 60_000).toISOString()
      store.append(
        'sess_wall',
        0,
        {
          type: 'error',
          message: `claude is rate-limited (five_hour) — the turn may stall until it resets; resets ${resets}`,
          fatal: false,
        },
        tick(),
      )
      const sent = await callOn(pmTools, 'message_agent', {
        agent: worker,
        kind: 'follow-up',
        piece: label,
        text: 'One more thing.',
      })
      expect(sent.text).toContain('Claude’s usage limit is reached')
      expect(sent.text).toContain('It also waits for the turn this conversation is running to end.')
      expect(sent.text).not.toContain('Its turn is stopped')
    })

    it('once the person answers, nothing says it, and a message goes in', async () => {
      const { pmTools, worker, card, label, handle } = await aGiverAndItsStoppedHelper()
      host.claimSession(worker, window)
      await expect(
        host.respondPermission(worker, card, { outcome: 'allow' }, window),
      ).resolves.toEqual({ outcome: 'taken' })
      await waitFor(() => handle.status() === 'idle', 'the helper’s turn to end')

      const status = await callOn(pmTools, 'get_agent_status', { agent: worker })
      expect(status.text).not.toContain('its turn is stopped')
      expect(status.structured['agent']).toMatchObject({ stoppedOnAPerson: null })
      const sent = await callOn(pmTools, 'message_agent', {
        agent: worker,
        kind: 'follow-up',
        piece: label,
        text: 'One more thing.',
      })
      expect(sent.text).not.toContain('Its turn is stopped')
    })

    it('a helper that runs without asking is never stopped on a person', async () => {
      await host.close(await personOpens('worker', 'auto'), window)
      const pm = await personOpens('pm', 'auto')
      const pmTools = agentToolsFor(host, pm)
      const given = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The tests',
        brief: THE_BRIEF,
      })
      const worker = String(given.structured['agent'])
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'turn'),
        'the brief’s turn to end',
      )
      const status = await callOn(pmTools, 'get_agent_status', { agent: worker })
      expect(status.text).not.toContain('needs you')
      expect(status.structured['agent']).toMatchObject({ stoppedOnAPerson: null })
      expect(ledger(worker).some((event) => event.type === 'permission_request')).toBe(false)
    })

    it('a helper and a giver busy on turns of their own, with no person asked, keep the ordinary words', async () => {
      await host.close(await personOpens('worker', 'auto'), window)
      const pm = await personOpens('pm', 'auto')
      const pmHandle = handles.at(-1)
      const pmTools = agentToolsFor(host, pm)
      const given = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The tests',
        brief: THE_BRIEF,
      })
      expect(given.structured['outcome'], given.text).toBe('ok')
      const worker = String(given.structured['agent'])
      const label = String(given.structured['label'])
      const workerHandle = handles.at(-1)
      if (pmHandle === undefined || workerHandle === undefined || workerHandle === pmHandle) {
        throw new Error('the giver and the helper were not both started')
      }
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'turn'),
        'the brief’s turn to end',
      )
      // ⚑ The helper asks its giver something, then goes on with a turn of its own.
      const workerTools = agentToolsFor(host, worker)
      const asked = await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece: label,
        question: 'Which suite?',
        options: ['unit', 'all'],
      })
      expect(asked.structured['outcome'], asked.text).toBe('ok')
      const question = store
        .routedRequestsOf(worker)
        .filter((one) => one.went.is === 'the-parent')
        .at(-1)?.requestId
      if (question === undefined) throw new Error('the question was not routed')
      workerHandle.simulateThinking({ text: 'reading the tests', redacted: false })
      await waitFor(() => workerHandle.status() === 'working', 'the helper to be working')

      const status = await callOn(pmTools, 'get_agent_status', { agent: worker })
      expect(status.structured['agent']).toMatchObject({ stoppedOnAPerson: null })

      const sent = await callOn(pmTools, 'message_agent', {
        agent: worker,
        kind: 'follow-up',
        piece: label,
        text: 'One more thing.',
      })
      expect(sent.structured['delivery']).toBe('queued')
      expect(sent.text).toContain(
        'is free — at once, if it is — with whatever else is held for it, oldest first',
      )
      expect(sent.text).not.toContain('Its turn is stopped')

      const answered = await callOn(pmTools, 'answer_question', {
        question,
        answers: [{ part: 'answer', answer: ['unit'] }],
        interrupt: false,
      })
      expect(answered.structured['outcome'], answered.text).toBe('ok')
      expect(answered.text).toContain('reads your answer when the turn it is running ends')
      expect(answered.text).not.toContain('Its turn is stopped')

      pmHandle.simulateThinking({ text: 'planning', redacted: false })
      await waitFor(() => pmHandle.status() === 'working', 'the giver to be working')
      const replied = await callOn(workerTools, 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'The tests pass.',
      })
      expect(replied.text).toMatch(
        /it is held until .+ is free, then goes out with whatever else is held for it/,
      )
      expect(replied.text).not.toContain('Its turn is stopped')
    })
  })
})
