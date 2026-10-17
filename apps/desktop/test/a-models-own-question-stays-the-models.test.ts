import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  FakeSessionHandle,
  ResumeOptions,
  SessionRef,
  StartOptions,
  UserInputResponse,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 🔴 **D-009 · a model's OWN question stays the model's.**
 *
 * ⚑ D-009 gave the question doors a second kind of subject: a question THIS APP raised for an agent
 * (`ask_question`), beside the one a PROVIDER raised when its model asked for user input. ⛔ The
 * two share one routing, one id space and one ledger, and they differ in who is waiting: this app's
 * question is held in the app, and a provider's is held by a model parked on its request.
 *
 * ⚑ So four things D-009 wrote are the provider's side of that line, and each is pinned here:
 * - an asker may withdraw only a question this app raised — never its own model's live card;
 * - a quit ends a provider's question, and the launch after it does not route it again, because the
 *   provider that held it is gone — while (⚑ D-017 · R4) this app's own question outlives it;
 * - its recipient's conversation stopping closes neither question — the model's card stays open,
 *   and the asker is not told that nobody will answer it. ⚑ D-017: nothing ends a conversation
 *   (`end_agent` is gone), so ruling 5's sweep, which closed this app's questions when their
 *   recipient ended, has nothing left to answer; a stop is what is measured;
 * - `cannot_answer` on a provider's question is declined TO the provider, as a person's reject at
 *   the card is — a `rejected` row alone leaves the model parked forever.
 *
 * ⚑ Real host, real SQLite ledger, real toolsets; the only double is the provider, whose handles
 * are kept so a test can BE the provider and raise the request.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

/** ⚑ The provider double, with every handle it issued kept — starts AND resumes. */
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

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * ⛔ **Whether the provider was answered, after a real interval** — a request nobody answers never
 * settles, so an `await` on it would be red by timeout rather than by the assertion.
 */
async function settledYet(promise: Promise<UserInputResponse>): Promise<boolean> {
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  await new Promise((resolve) => setTimeout(resolve, 50))
  return settled
}

interface Child {
  readonly id: string
  readonly handle: FakeSessionHandle
}

describe('D-009 · a model’s own question stays the model’s', () => {
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
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
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
      readProviderConfig: (_provider, home) => ({
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d009-own-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d009-own-root-'))
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
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⚑ Through the CURRENT host, so a call after a relaunch is the next launch's own door. */
  const callOn = async (
    sessionId: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, sessionId).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

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

  /**
   * ⚑ A PM in a window, and one child it gave a piece to through the real door (D-016: the give
   * starts the child, and its brief is the child's first turn).
   */
  const aPmAndAChild = async (): Promise<{ pm: string; child: Child }> => {
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens(DEFAULT_PROFILE_ID)
    const spawned = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the notes',
      brief: 'the notes',
    })
    expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle was issued to the child')
    return { pm, child: { id: spawned.agent as string, handle } }
  }

  const questionOf = (asker: string, requestId: string) =>
    store
      .routedRequestsOf(asker)
      .filter((one) => one.requestId === requestId)
      .at(-1)

  /** ⚑ The child's MODEL asks, exactly as its provider would, and the app routes it to the parent. */
  const itsModelAsks = async (
    child: Child,
  ): Promise<{ id: string; answered: Promise<UserInputResponse> }> => {
    const raised = child.handle.simulateUserInput('which branch?', ['main', 'dev'])
    await waitFor(
      () => questionOf(child.id, raised.id) !== undefined,
      `the routing of ${raised.id} on ${child.id}`,
    )
    // ⚑ **The premise**: a provider's request, open, routed to the parent — the shape every test here
    // is about.
    expect(questionOf(child.id, raised.id)).toMatchObject({ state: 'open' })
    expect(store.questionsRaisedIn(child.id).get(raised.id)?.raisedBy).not.toBe('this-app')
    return raised
  }

  it('⛔ an asker cannot withdraw its own model’s question — the card stays open, and the model is still waiting on it', async () => {
    const { pm, child } = await aPmAndAChild()
    const raised = await itsModelAsks(child)
    // ⛔ The id IS open in the child's own ledger — but the child did not ask it; its model did.
    const withdrawn = await callOn(child.id, 'withdraw_question', { question: raised.id })
    expect(withdrawn.rail, JSON.stringify(withdrawn)).toBe(
      'no-open-question-you-asked-by-that-name',
    )
    expect(questionOf(child.id, raised.id)?.state).toBe('open')
    expect(await settledYet(raised.answered)).toBe(false)
    // ⚑ **THE PAIR**: still the parent's to answer, and the answer reaches the model that asked.
    const answered = await callOn(pm, 'answer_question', {
      question: raised.id,
      asked_by: child.id,
      answers: [{ part: 'q0', answer: ['main'] }],
    })
    expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
    await expect(raised.answered).resolves.toMatchObject({ kind: 'answer' })
  })

  it('⛔ a quit ends its model’s question for good — the next launch does not route it again, and the parent is not offered it', async () => {
    const { pm, child } = await aPmAndAChild()
    const raised = await itsModelAsks(child)
    // ⚑ **THE CONTROL, in the same ledger**: a question the child asked through the APP, which
    // decision 4 keeps across a quit — so the sweep that must leave the model's alone is seen to run.
    const asked = await callOn(child.id, 'ask_question', {
      who_answers: 'an-agent',
      agent: pm,
      question: 'where are the notes?',
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    const ours = asked.question as string
    await host.closeAll()
    // ⚑ **The premise**: the quit closed the child, and its ending abandoned the MODEL's question —
    // ⚑ D-017 · R4: only that one. This app's own question outlives the stop (the launch marker
    // says so), which is what makes it the control.
    expect(store.whatTheQuitClosed()).toContain(child.id)
    expect([questionOf(child.id, ours)?.state, questionOf(child.id, raised.id)?.state]).toEqual([
      'open',
      'abandoned',
    ])
    // ⚑ The next launch, with its own store object.
    store = createSessionStore(db, tick)
    host = buildHost()
    expect(questionOf(child.id, ours)?.state).toBe('open')
    // ⛔ **The provider that held it is gone**: nothing could ever answer it, so it stays ended.
    expect(questionOf(child.id, raised.id)?.state).toBe('abandoned')
    // ⚑ …and the parent's list says so: its own question is offered open, the model's is over.
    await host.resumeSession(pm, window)
    const listed = await callOn(pm, 'list_questions', { state: 'all' })
    const stateOf = (id: string): unknown =>
      (listed.questions as { question: string; state: string }[]).find((one) => one.question === id)
        ?.state
    expect([stateOf(ours), stateOf(raised.id)], JSON.stringify(listed)).toEqual([
      'open',
      'abandoned',
    ])
  })

  it('⛔ its parent’s conversation stops — the model’s question stays open, and the child is not told nobody will answer', async () => {
    // ⚑ Ruling 5 closed the questions THIS APP held when their recipient ENDED, and left a
    // provider's request alone: its model is still parked on the card, and a person can still
    // settle it there. ⚑ **D-017 — nothing ends a conversation** (`end_agent` is gone), so the
    // recipient here is STOPPED — the one thing left that happens to it — and a stop ends nothing
    // (R3): neither question closes, and nobody tells the child that nobody will answer.
    await host.close(await personOpens('pm'), window)
    await host.close(await personOpens('worker'), window)
    const lead = await personOpens(DEFAULT_PROFILE_ID, 'auto')
    const spawnedPm = await callOn(lead, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'pm',
      title: 'the release',
      brief: 'the release',
    })
    expect(spawnedPm.outcome, JSON.stringify(spawnedPm)).toBe('ok')
    const pm = spawnedPm.agent as string
    const spawned = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the notes',
      brief: 'the notes',
    })
    expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle was issued to the child')
    const child: Child = { id: spawned.agent as string, handle }
    const raised = await itsModelAsks(child)
    // ⚑ **THE CONTROL, in the same ledger**: a question the child asked through the APP, of the same
    // parent — the kind ruling 5 used to close.
    const asked = await callOn(child.id, 'ask_question', {
      who_answers: 'an-agent',
      agent: pm,
      question: 'where are the notes?',
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    const ours = asked.question as string

    // ⚑ The app's own stop of the parent — what its parent's `end_agent` was.
    await host.close(pm, THE_APP_ITSELF)
    expect(host.sessionIds).not.toContain(pm)
    const toldTheChild = (): string[] =>
      store
        .events(child.id)
        .flatMap(({ event }) =>
          event.type === 'user_turn' || event.type === 'message_queued' ? [event.text] : [],
        )
    // 🔴 **The model's own question is still open**, and still the model's: nothing settled it.
    expect(questionOf(child.id, raised.id)?.state).toBe('open')
    expect(await settledYet(raised.answered)).toBe(false)
    // ⚑ …and so is the app's: a stop ends nothing, and a message starts the parent again.
    expect(questionOf(child.id, ours)?.state).toBe('open')
    // ⛔ …and the child was told about neither.
    expect(toldTheChild().some((text) => text.includes(ours))).toBe(false)
    expect(toldTheChild().some((text) => text.includes(raised.id))).toBe(false)
    expect(
      store
        .events(child.id)
        .flatMap(({ event }) =>
          event.type === 'question_recipient_ended' ? [event.requestId] : [],
        ),
    ).toEqual([])
  })

  it('⛔ “cannot answer” to a model’s question is said to the MODEL — its request is declined, not only recorded', async () => {
    const { pm, child } = await aPmAndAChild()
    const raised = await itsModelAsks(child)
    const declined = await callOn(pm, 'answer_question', {
      question: raised.id,
      asked_by: child.id,
      cannot_answer: 'I do not know which branch',
    })
    expect(declined.outcome, JSON.stringify(declined)).toBe('ok')
    expect(questionOf(child.id, raised.id)?.state).toBe('rejected')
    // 🔴 **A `rejected` row alone leaves the model parked forever**: the provider is told, as a
    // person's reject at the card tells it.
    expect(await settledYet(raised.answered)).toBe(true)
    // ⚑ …with its reason, for a provider that can carry it.
    await expect(raised.answered).resolves.toEqual({
      kind: 'reject',
      reason: 'I do not know which branch',
    })
  })
})
