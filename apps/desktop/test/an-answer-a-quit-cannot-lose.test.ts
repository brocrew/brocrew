import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
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
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { A_PERSONS_ANSWER_TO_AN_ENDED_QUESTION } from '../src/main/runtime/question-rails'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { fixtureProviderConfig, syntheticProviderHome, neutralHostDeps } from './lib/host-fixture'

/**
 * A person's answer to a question this app asked reaches its asker like any other message:
 * starting a stopped asker, kept if that start fails, needing no take-over, and taken once.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

/** Every provider launch the host asks for, in order. */
interface Launched {
  readonly kind: 'start' | 'resume'
  readonly handle: FakeSessionHandle
}

class CountingRuntime extends FakeRuntime {
  /** When set, the next resume fails once, as a real adapter reports it. */
  static failTheNextResume: Error | null = null

  constructor(
    provider: Provider,
    private readonly launched: Launched[],
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    this.launched.push({ kind: 'start', handle })
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const failure = CountingRuntime.failTheNextResume
    if (failure !== null) {
      CountingRuntime.failTheNextResume = null
      const { ResumeError } = await import('@brobot2/runtime')
      throw new ResumeError(ref, `resume failed: ${failure.message}`, { cause: failure })
    }
    const handle = await super.resume(ref, options)
    this.launched.push({ kind: 'resume', handle })
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('an answer a quit cannot lose', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let launched: Launched[]
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
      createRuntime: (provider: Provider) =>
        new CountingRuntime(provider, launched, handed, issued),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-answer-quit-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-answer-quit-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    launched = []
    handed = []
    issued = new FakeProviderSessions()
    CountingRuntime.failTheNextResume = null
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const lastToolset = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed out')
    return last
  }

  /** What the rail's listing says about one conversation. */
  const listed = (sessionId: string): { running: string } | undefined => {
    const row = host.resumableSessions().find((one) => one.sessionId === sessionId)
    return row === undefined ? undefined : { running: row.running }
  }

  /** An identity exists only once a person has run a conversation as it. */
  const bringIntoBeing = async (profileId: string): Promise<void> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    await host.close(sessionId, window)
  }

  /** A person's lead in a window, and three agents it gave work to. */
  const theFourOpen = async (): Promise<{
    lead: string
    children: [string, string, string]
    leadTools: AgentToolset
  }> => {
    const kids = ['mock-dev', 'mock-dev-2', 'platform-runtime-pm']
    for (const kid of kids) await bringIntoBeing(kid)
    const { sessionId: lead } = await host.createSession(
      { provider: 'claude', profileId: 'lead', approvalMode: 'ask', cwd: root },
      window,
    )
    const leadTools = lastToolset()
    const children: string[] = []
    for (const kid of kids) {
      const given = await callOn(leadTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: kid,
        title: `The ${kid} half of the work`,
        brief: 'pick one of the two',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      children.push(given.agent as string)
    }
    const [a, b, c] = children
    if (a === undefined || b === undefined || c === undefined) throw new Error('three spawns')
    return { lead, children: [a, b, c], leadTools }
  }

  /** Has one child ask a person about the piece it holds; returns the question's request id. */
  const askedOfAPerson = async (
    asker: string,
    askerTools: AgentToolset,
    question: string,
  ): Promise<{ piece: string; requestId: string }> => {
    const piece = store.piecesOwnedBy(asker)[0]?.label ?? ''
    expect(piece, 'the premise: the asker holds the work it will ask about').not.toBe('')
    const asked = await callOn(askerTools, 'ask_question', {
      who_answers: 'a-person',
      piece,
      question,
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    const rows = host
      .questionsForAPerson()
      .rows.filter(
        (row) =>
          row.request.askedBy === asker && row.request.went.is === 'the-person-the-asker-named',
      )
    expect(rows, 'the premise: a person is holding its question').toHaveLength(1)
    return { piece, requestId: rows[0]!.request.requestId }
  }

  describe('the asker has stopped, and a person answers it anyway', () => {
    it('a person answers this app’s own question after its asker has stopped, and the asker starts to read it', async () => {
      const { children } = await theFourOpen()
      const asker = children[2]
      const askerTools = lastToolset()
      const { requestId } = await askedOfAPerson(asker, askerTools, 'which of the two?')

      // A running, unwatched child must be taken over by a window before it can be closed.
      host.claimSession(asker, window)
      await host.close(asker, window)
      expect(listed(asker)?.running, 'the premise: the asker has stopped').toBe('not-running')

      const before = launched.length
      // A window that never owned the asker.
      const stranger = new RecordingSink('webContents:9')
      const ack = await host.respondUserInput(
        asker,
        requestId,
        { kind: 'answer', answers: { answer: ['left'] } },
        stranger,
      )
      expect(ack, JSON.stringify(ack)).toMatchObject({ outcome: 'taken' })
      expect((ack as { reason?: string }).reason, JSON.stringify(ack)).toBeUndefined()
      expect(launched.length - before).toBe(1)
      await waitFor(
        () =>
          ledger(asker).some(
            (event) => event.type === 'assistant_message' && event.text.includes('left'),
          ),
        'the asker to read the answer',
      )
      const request = store.routedRequestsOf(asker).find((one) => one.requestId === requestId)
      expect(request?.state, 'the question is closed').toBe('answered')
    })

    it('when the stopped asker cannot be started again, the answer is kept for it and nothing is lost', async () => {
      const { children } = await theFourOpen()
      const asker = children[2]
      const askerTools = lastToolset()
      const { requestId } = await askedOfAPerson(asker, askerTools, 'which of the two?')
      host.claimSession(asker, window)
      await host.close(asker, window)

      CountingRuntime.failTheNextResume = new Error('the app-server closed its pipe')
      const stranger = new RecordingSink('webContents:9')
      const ack = await host.respondUserInput(
        asker,
        requestId,
        { kind: 'answer', answers: { answer: ['left'] } },
        stranger,
      )
      expect(ack.outcome, JSON.stringify(ack)).toBe('taken')
      const reason = (ack as { reason?: string }).reason
      expect(reason, JSON.stringify(ack)).toBeDefined()
      expect(reason).toContain('The answer is recorded and kept for')
      expect(reason).toContain('It could not be started now')
      expect(
        ledger(asker).some(
          (event) => event.type === 'message_queued' && event.text.includes('left'),
        ),
        'the held answer is on the asker’s own ledger',
      ).toBe(true)
      const heldAnswer = store
        .messagesWaitingIn(asker)
        .find((one) => one.authorship.answeredQuestion?.requestId === requestId)
      expect(heldAnswer?.authorship.answeredQuestion).toEqual({
        requestId,
        answeredBy: null,
        answer: 'left',
      })
      await host.closeAll()
      host = buildHost()
      await host.resumeSession(asker, stranger)
      await waitFor(
        () =>
          ledger(asker).some(
            (one) => one.type === 'user_turn' && one.answeredQuestion?.requestId === requestId,
          ),
        'the restored answer delivery',
      )
      const deliveredAnswer = ledger(asker).find(
        (one) => one.type === 'user_turn' && one.answeredQuestion?.requestId === requestId,
      )
      expect(deliveredAnswer?.type === 'user_turn' && deliveredAnswer.answeredQuestion).toEqual(
        heldAnswer?.authorship.answeredQuestion,
      )
      const request = store.routedRequestsOf(asker).find((one) => one.requestId === requestId)
      expect(request?.state, 'the question is closed even though delivery failed').toBe('answered')
    })
  })

  describe('answering needs no take-over, and only the first answer lands', () => {
    it('a person answers this app’s question without holding the conversation — no take-over first', async () => {
      const { children } = await theFourOpen()
      const asker = children[2]
      const askerTools = lastToolset()
      // Kept running: the asker's own turn also parks on a provider card.
      const { requestId } = await askedOfAPerson(asker, askerTools, 'which of the two?')
      await waitFor(
        () => ledger(asker).some((event) => event.type === 'permission_request'),
        'the asker’s own turn to park on a card',
      )
      const providerCard = ledger(asker).find((event) => event.type === 'permission_request')
      if (providerCard?.type !== 'permission_request') throw new Error('no provider card')
      expect(listed(asker)?.running, 'the premise: the asker is running, unwatched').toBe(
        'unwatched',
      )

      const stranger = new RecordingSink('webContents:9')
      const ack = await host.respondUserInput(
        asker,
        requestId,
        { kind: 'answer', answers: { answer: ['left'] } },
        stranger,
      )
      expect(ack, JSON.stringify(ack)).toMatchObject({ outcome: 'taken' })
      expect(listed(asker)?.running).toBe('unwatched')

      // The provider's own card is a person's too while no window holds the asker: the same
      // stranger answers it from the queue, still without taking it over.
      await expect(
        host.respondPermission(asker, providerCard.id, { outcome: 'allow' }, stranger),
      ).resolves.toMatchObject({ outcome: 'taken' })
      expect(listed(asker)?.running).toBe('unwatched')
    })

    it('a second answer to a question this app already closed is refused in this app’s own words', async () => {
      const { children } = await theFourOpen()
      const asker = children[2]
      const askerTools = lastToolset()
      const { requestId } = await askedOfAPerson(asker, askerTools, 'which of the two?')

      const first = new RecordingSink('webContents:9')
      const taken = await host.respondUserInput(
        asker,
        requestId,
        { kind: 'answer', answers: { answer: ['left'] } },
        first,
      )
      expect(taken, JSON.stringify(taken)).toMatchObject({ outcome: 'taken' })

      const second = new RecordingSink('webContents:10')
      const refused = await host.respondUserInput(
        asker,
        requestId,
        { kind: 'answer', answers: { answer: ['right'] } },
        second,
      )
      expect(refused).toMatchObject({
        outcome: 'refused',
        reason: A_PERSONS_ANSWER_TO_AN_ENDED_QUESTION.answered,
        stillOpen: false,
      })
      expect((refused as { reason: string }).reason).not.toBe(
        'the agent is no longer waiting for an answer to this',
      )
    })
  })

  describe('a person’s window takes a root a delivery started with no window', () => {
    it('and cannot take an agent-spawned child the same way', async () => {
      // A giver allowed to message a conversation it did not start.
      await host.createSession(
        { provider: 'claude', profileId: 'giver', approvalMode: 'ask', cwd: root },
        window,
      )
      const giverTools = lastToolset()

      // A root, built directly and then closed.
      const { sessionId: root_ } = await host.createSession(
        { provider: 'claude', profileId: 'a-root', approvalMode: 'ask', cwd: root },
        window,
      )
      await host.close(root_, window)

      // An agent's note starts it with no window.
      const said = await callOn(giverTools, 'message_agent', {
        agent: root_,
        kind: 'note',
        text: 'are you there',
      })
      expect(said, JSON.stringify(said)).toMatchObject({ outcome: 'ok', agent: root_ })
      await waitFor(
        () => ledger(root_).some((event) => event.type === 'permission_request'),
        'the root’s own first turn to park on a card',
      )
      const rootCard = ledger(root_).find((event) => event.type === 'permission_request')
      if (rootCard?.type !== 'permission_request') throw new Error('no card on the root')
      expect(listed(root_)?.running, 'started, with no window').toBe('unwatched')

      // A fresh window takes it with no prior Reopen or claim.
      const fresh = new RecordingSink('webContents:20')
      await expect(
        host.respondPermission(root_, rootCard.id, { outcome: 'allow' }, fresh),
      ).resolves.toMatchObject({ outcome: 'taken' })

      // An ordinary child the giver started itself is not taken over.
      await bringIntoBeing('a-worker')
      const givenToChild = await callOn(giverTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'a-worker',
        title: 'An ordinary piece of work',
        brief: 'an ordinary piece of work',
      })
      expect(givenToChild, JSON.stringify(givenToChild)).toMatchObject({
        outcome: 'ok',
        started: true,
      })
      const child = givenToChild.agent as string
      await waitFor(
        () => ledger(child).some((event) => event.type === 'permission_request'),
        'the child’s own first turn to park on a card',
      )
      const childCard = ledger(child).find((event) => event.type === 'permission_request')
      if (childCard?.type !== 'permission_request') throw new Error('no card on the child')

      // A person answers its card from the queue, but does not take it over.
      await expect(
        host.respondPermission(child, childCard.id, { outcome: 'allow' }, fresh),
      ).resolves.toMatchObject({ outcome: 'taken' })
      expect(listed(child)?.running).toBe('unwatched')
    })
  })
})
