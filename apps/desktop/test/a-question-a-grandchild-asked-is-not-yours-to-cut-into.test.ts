import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
  UserInputResponse,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **D-017 · R19 — a card routed to another CONVERSATION is that one's to answer, and the
 * refusal names whose.** `admitInterrupt` forks on `askedOf`: a card nobody is named for reads
 * `a-person-is-being-asked`; a card a native question routed to the caller's parent (or to an
 * agent it named) reads `it-is-waiting-on-an-answer` instead, and carries `detail.askedOf`.
 *
 * ## ⛔ Why this file exists
 *
 * No behavioural test reached the `it-is-waiting-on-an-answer` branch before this one — only the
 * census tables (`a-refusal-carries-its-remedy.test.ts`, `the-doors-our-own-verbs-do-not-need
 * .test.ts`) know the rail's *name*. A rail nothing reaches passes vacuously, so this pins the
 * shape on the real three-tier chain (`a-stop-reaches-down-the-whole-chain.test.ts`'s own
 * `aChainOfThree` pattern): BroBot → Ada → Ali, through the real `give_work` door (D-016; it was
 * `spawn_agent`'s), with Ali raising its provider's own native question exactly as
 * `the-word-for-a-question-nobody-stopped.test.ts`'s `childAsks` does.
 *
 * ## ⚑ The one thing the borrowed helpers do not give for free
 *
 * ⚠️ **`FakeSessionHandle.simulateUserInput` deliberately does NOT hold `status()` at
 * `waiting_permission`** — its own docblock: *"a test can call it with no turn running at all,
 * and a real adapter cannot… Taking it unconditionally would publish `waiting_permission` on an
 * idle session, which nothing it doubles can do."* Both REAL adapters hold it themselves, around
 * their own `user_input_request`: push the event, `this.machine.beginWait()`, await the broker's
 * answer, `this.machine.endWait()` (`claude-runtime.ts`'s `AskUserQuestion` handling). So a
 * fixture that wants the shape `admitInterrupt` actually branches on — a card genuinely open,
 * `status()` genuinely `waiting_permission` — asks for it explicitly, through the same public
 * `waitForAPerson()` method the adapters use, released the same way: once the broker's answer
 * settles. {@link childAsksItsParent} does exactly this and nothing more.
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

describe('D-017 · R19 · a question a grandchild asked is not yours to cut into', () => {
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
      newSessionId: () => `sess_${String(++counter)}`,
      now: tick,
      // ⚑ Bounded, same as `a-stop-reaches-down-the-whole-chain.test.ts`: `interruptAgent` races
      // the provider against it, and a short deadline keeps a wedged one from holding the suite.
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-grandchild-ask-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-grandchild-ask-root-'))
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
   * 🔴 **Put a conversation into a WORKING turn** — `a-stop-reaches-down-the-whole-chain
   * .test.ts`'s `makeItWork`, unchanged: a thinking burst makes the handle `working` and nothing
   * else, which is the state the paired positive below needs (no card open at all).
   */
  const makeItWork = async (handle: FakeSessionHandle): Promise<void> => {
    handle.simulateThinking({ text: 'driving the browser', redacted: false })
    await waitFor(() => handle.status() === 'working', 'the conversation to be working')
  }

  /**
   * 🔴 **BroBot → Ada → Ali, through the real give door** — `a-stop-reaches-down-the-whole-chain
   * .test.ts`'s `aChainOfThree`, trimmed to the two tiers this file needs. Every hop is
   * `give_work` and not a hand-written parent row, so Ali really does have Ada for a parent
   * before either test asks what that parent is owed.
   *
   * ⚑ **D-016 · each give's brief is the child's first turn**, so BroBot runs in `auto` and each
   * child inherits it: the brief's turn ENDS rather than parking on a permission card, and no card
   * is open on Ali when the tests below begin — the premise the pair needs.
   */
  const aChainOfThree = async (): Promise<{
    brobot: string
    ada: string
    ali: string
    aliHandle: FakeSessionHandle
    brobotTools: AgentToolset
    adaTools: AgentToolset
  }> => {
    const nth = ++chains
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    await bringIdentityIntoBeing(pmProfile)
    await bringIdentityIntoBeing(workerProfile)
    const brobot = await personOpens(DEFAULT_PROFILE_ID, 'auto')
    const brobotTools = agentToolsFor(host, brobot)
    const givenAda = await callOn(brobotTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: pmProfile,
      title: 'run the front-end work',
      brief: 'run the front-end work',
    })
    expect(givenAda.outcome, JSON.stringify(givenAda)).toBe('ok')
    const ada = givenAda.agent as string
    const adaTools = agentToolsFor(host, ada)
    const givenAli = await callOn(adaTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'build the world-clock page',
      brief: 'build the world-clock page',
    })
    expect(givenAli.outcome, JSON.stringify(givenAli)).toBe('ok')
    const ali = givenAli.agent as string
    const aliHandle = latestHandle()
    await waitFor(
      () => ledger(ali).some((event) => event.type === 'turn') && aliHandle.status() === 'idle',
      'Ali’s brief to run and end',
    )
    return { brobot, ada, ali, aliHandle, brobotTools, adaTools }
  }

  /**
   * ⚑ **Raise a native question on `child` and hold it open the way a real adapter does** — see
   * this file's own docblock for why `simulateUserInput` alone is not enough. `waitForAPerson`'s
   * release is chained onto the same promise `answer_question` settles, so the wait ends exactly
   * when — and only when — that conversation's own answer lands, never by anything this helper
   * does on a timer.
   */
  const childAsksItsParent = async (
    child: string,
    handle: FakeSessionHandle,
    prompt = 'which branch?',
    options: readonly string[] = ['main', 'dev'],
  ): Promise<{ id: string; answered: Promise<UserInputResponse> }> => {
    const raised = handle.simulateUserInput(prompt, options, false)
    const release = handle.waitForAPerson()
    void raised.answered.then(() => release())
    await waitFor(
      () =>
        ledger(child).some(
          (event) => event.type === 'request_routed' && event.requestId === raised.id,
        ),
      `the routing of ${raised.id}`,
    )
    return raised
  }

  it('D-017 · R19 — a grandchild parked on its own question is refused it-is-waiting-on-an-answer, naming its parent — not a-person-is-being-asked', async () => {
    const { brobot, ada, ali, aliHandle, brobotTools } = await aChainOfThree()

    // ⚑ **THE PAIR, taken FIRST on the identical target** (standing rule 3): while Ali is merely
    // working — no card of any kind open — the identical call from the identical caller succeeds.
    // This isolates the refusal below to the open question-card rather than to Ali or BroBot's
    // relationship, which the chain already admits (`629`'s ruling).
    await makeItWork(aliHandle)
    const whileWorking = await callOn(brobotTools, 'interrupt_agent', {
      agent: ali,
      reason: 'a check before the real ask',
    })
    expect(whileWorking.outcome, JSON.stringify(whileWorking)).toBe('ok')
    expect(whileWorking.asked).toBe(true)
    await waitFor(() => aliHandle.status() === 'idle', 'Ali to settle back to idle')

    const raised = await childAsksItsParent(ali, aliHandle)
    expect(aliHandle.status()).toBe('waiting_permission')
    // ⚑ **The premise, asserted rather than assumed**: Ali has a parent, so the routing really did
    // travel rather than land on a person — `routeRequest`'s `to: 'the-parent'` arm.
    const routed = ledger(ali).find(
      (event) => event.type === 'request_routed' && event.requestId === raised.id,
    )
    expect(routed).toMatchObject({ to: 'the-parent', parent: ada })

    const refused = await callOn(brobotTools, 'interrupt_agent', {
      agent: ali,
      reason: 'the person asked for it to stop',
    })
    expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
    expect(refused.rail).toBe('it-is-waiting-on-an-answer')
    expect(refused.permanence).toBe('until-a-person-changes-it')
    expect(refused.retryable).toBe(false)
    expect((refused.detail as { askedOf?: string | null }).askedOf).toBe(ada)
    // The question targets a conversation, so it does not belong on the person’s rail.
    expect(refused.rail).not.toBe('a-person-is-being-asked')
    const reason = refused.reason as string
    expect(reason).toContain('answer_question')
    expect(reason).toContain('not to a person')

    // ⛔ **Nothing was actually cut into by the refused call.** The one `work_interrupted` on
    // Ali's ledger is the earlier, SUCCESSFUL ask above; the refusal wrote no second one.
    const cuts = ledger(ali).filter((event) => event.type === 'work_interrupted')
    expect(cuts).toHaveLength(1)
    expect(brobot).toBeTruthy()
  })

  it('…and the conversation the card names is refused the identical way — the rail is about the card, not the caller’s entitlement, and it clears once that conversation answers', async () => {
    const { ada, ali, aliHandle, adaTools } = await aChainOfThree()
    const raised = await childAsksItsParent(ali, aliHandle)
    expect(aliHandle.status()).toBe('waiting_permission')

    // ⚑ **Ada is Ali's direct commander AND the very conversation `askedOf` names, and is refused
    // all the same.** The rail fires on the state of the CARD, not on who is entitled to command
    // the target — a shape `not-below-you` could never show, since it is about entitlement.
    const refused = await callOn(adaTools, 'interrupt_agent', {
      agent: ali,
      reason: 'stop so I can answer it myself',
    })
    expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
    expect(refused.rail).toBe('it-is-waiting-on-an-answer')
    expect((refused.detail as { askedOf?: string | null }).askedOf).toBe(ada)
    const cuts = ledger(ali).filter((event) => event.type === 'work_interrupted')
    expect(cuts).toHaveLength(0)

    // ⚑ **THE PAIR — the identical call, once the wait really has ended**, through the real door:
    // Ada answers the question rather than cutting into it.
    const answered = await callOn(adaTools, 'answer_question', {
      question: raised.id,
      answers: [{ part: 'q0', answer: ['main'] }],
    })
    expect(answered.outcome, JSON.stringify(answered)).toBe('ok')

    await waitFor(() => aliHandle.status() === 'idle', 'Ali to settle once the answer lands')
    const again = await callOn(adaTools, 'interrupt_agent', {
      agent: ali,
      reason: 'a check after the answer',
    })
    // ⛔ **No longer `it-is-waiting-on-an-answer`** — nothing is open to be waiting on, so the
    // call reads `ok` with nothing to interrupt, proving the wait cleared with the ANSWER rather
    // than with time or a retry.
    expect(again.outcome, JSON.stringify(again)).toBe('ok')
    expect(again.asked).toBe(false)
  })
})
