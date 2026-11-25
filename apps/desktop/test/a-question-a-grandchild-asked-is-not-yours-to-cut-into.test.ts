import { personOpener } from './helpers/person-opens-session'
import { callOn } from './helpers/call-tool'
import { HandleKeepingRuntime as ProviderDouble } from './helpers/handle-keeping-runtime'
import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset, FakeSessionHandle, UserInputResponse } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import {
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
  RecordingSink,
} from './lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('D-017 · R19 · a question a grandchild asked is not yours to cut into', () => {
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
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      now: tick,
      // ⚑ Bounded, same as `a-stop-reaches-down-the-whole-chain.test.ts`: `interruptAgent` races
      // the provider against it, and a short deadline keeps a wedged one from holding the suite.
      interruptWaitMs: 40,
      readProviderConfig: fixtureProviderConfig,
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

  const personOpens = personOpener(() => ({ host, root, window }), 'ask')

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

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
      to: 'new',
      conversation_title: 'run the front-end work',
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: pmProfile,
      title: 'run the front-end work',
      brief: 'run the front-end work',
    })
    expect(givenAda.outcome, JSON.stringify(givenAda)).toBe('ok')
    const ada = givenAda.agent as string
    const adaTools = agentToolsFor(host, ada)
    const givenAli = await callOn(adaTools, 'give_work', {
      to: 'new',
      conversation_title: 'build the world-clock page',
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
   * release is chained onto the same promise the person’s native answer settles, so the wait ends exactly
   * when — and only when — that conversation's own answer lands, never by anything this helper
   * does on a timer.
   */
  const childAsksThePerson = async (
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

  it("a grandchild's provider question stays with the person and cannot be interrupted", async () => {
    const { brobot, ali, aliHandle, brobotTools } = await aChainOfThree()

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

    const raised = await childAsksThePerson(ali, aliHandle)
    expect(aliHandle.status()).toBe('waiting_permission')
    // ⚑ **The premise, asserted rather than assumed**: Ali has a parent, so the routing really did
    // travel rather than land on a person — `routeRequest`'s `to: 'the-parent'` arm.
    const routed = ledger(ali).find(
      (event) => event.type === 'request_routed' && event.requestId === raised.id,
    )
    expect(routed).toMatchObject({ to: 'a-person' })
    expect(routed).not.toHaveProperty('parent')

    const refused = await callOn(brobotTools, 'interrupt_agent', {
      agent: ali,
      reason: 'the person asked for it to stop',
    })
    expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
    expect(refused.rail).toBe('a-person-is-being-asked')
    expect(refused.permanence).toBe('until-a-person-changes-it')
    expect(refused.retryable).toBe(false)
    // The native question remains with the person even when the caller is an ancestor.
    const reason = refused.reason as string
    expect(reason).toContain('person')

    // ⛔ **Nothing was actually cut into by the refused call.** The one `work_interrupted` on
    // Ali's ledger is the earlier, SUCCESSFUL ask above; the refusal wrote no second one.
    const cuts = ledger(ali).filter((event) => event.type === 'work_interrupted')
    expect(cuts).toHaveLength(1)
    expect(brobot).toBeTruthy()
  })

  it('the immediate giver is also refused, and the person’s answer clears the turn', async () => {
    const { ali, aliHandle, adaTools } = await aChainOfThree()
    const raised = await childAsksThePerson(ali, aliHandle)
    expect(aliHandle.status()).toBe('waiting_permission')

    // ⚑ **Ada is Ali's direct commander AND the very conversation `askedOf` names, and is refused
    // all the same.** The rail fires on the state of the CARD, not on who is entitled to command
    // the target — a shape `not-below-you` could never show, since it is about entitlement.
    const refused = await callOn(adaTools, 'interrupt_agent', {
      agent: ali,
      reason: 'stop so I can answer it myself',
    })
    expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
    expect(refused.rail).toBe('a-person-is-being-asked')
    const cuts = ledger(ali).filter((event) => event.type === 'work_interrupted')
    expect(cuts).toHaveLength(0)

    // ⚑ **THE PAIR — the identical call, once the wait really has ended**, through the real door:
    // The giver cannot answer a native question; the person answers its card.
    const answered = await callOn(adaTools, 'answer_question', {
      question: raised.id,
      answers: [{ part: 'q0', answer: ['main'] }],
    })
    expect(answered).toMatchObject({ outcome: 'refused' })
    host.claimSession(ali, window)
    await host.respondUserInput(
      ali,
      raised.id,
      { kind: 'answer', answers: { q0: ['main'] } },
      window,
    )

    await waitFor(() => aliHandle.status() === 'idle', 'Ali to settle once the answer lands')
    expect(store.routedRequestsOf(ali).find((one) => one.requestId === raised.id)?.state).toBe(
      'answered',
    )
    await makeItWork(aliHandle)
    const again = await callOn(adaTools, 'interrupt_agent', {
      agent: ali,
      reason: 'a check after the answer',
    })
    // The person's answer cleared the card; ordinary work can now be asked to stop.
    expect(again.outcome, JSON.stringify(again)).toBe('ok')
    expect(again.asked).toBe(true)
    expect(ledger(ali).filter((event) => event.type === 'work_interrupted')).toHaveLength(1)
  })
})
