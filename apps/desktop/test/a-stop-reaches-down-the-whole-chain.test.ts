import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF, mayInterruptDownTheChain } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import {
  A_CONVERSATION_CANNOT_INTERRUPT_ITSELF,
  agentToolsFor,
  refuseTool,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { permanenceInWords } from '../src/main/runtime/agent-tool-answer-words'

/**
 * 🔴 **629 · a stop reaches down the whole chain** — ordered by `HO-095` §4, a RULING.
 *
 * > ⛔ **Any agent above another in the spawn chain may interrupt it.**
 *
 * ## ⚑ What it is for, measured on the clean-install run rather than argued
 *
 * A stop targeting a working descendant must not queue behind an intermediate manager’s turn.
 * Otherwise a descendant driving a browser could continue while the person’s stop waits for
 * the manager to become idle.
 *
 * ## ⛔ The sentence this file exists to produce is the NEGATIVE one
 *
 * ⚑ **`an-escalation-guarantee-is-only-as-wide-as-what-gets-denied`**, which is the brief's §6:
 * *do not report "a grandparent may now interrupt"; report what is still refused, by name, and
 * which test refuses it.* ⚠️ **So §2 is the substance** — four refusals, each an ACTUAL refused
 * call, each paired with the same call one fact over that is allowed (standing rule 3).
 *
 * ## ⚠️ Depth ≥ 2, because a parent is the case that already worked
 *
 * ⛔ **`an-exception-made-at-one-depth-of-a-walk`**: a rule made at two of three levels is not the
 * rule. ⚑ Every arm below runs on a real three-tier chain — BroBot → Ada → Ali — built through
 * the real door: `spawn_agent` until D-016, `give_work` since (a give that finds no conversation
 * starts one, and its brief is that conversation's first turn).
 *
 * ## ⚑ How it is arranged
 *
 * §0 **what was already built**, asserted rather than claimed (standing rule 38) ·
 * §1 **the ruling, on the real path** · §2 **the four refusals and their pairs** ·
 * §3 went with projects (D-016: no project, so no floor to cross) · §4 **the manager sees it** ·
 * §5 **`mayCommand` did not widen** · §6 **F091 · a conversation that names itself is told so**.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

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

describe('629 · a stop reaches down the whole chain', () => {
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
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      // ⚑ **Bounded, because `interruptAgent` races the provider against it** — the Fake's
      // interrupt resolves at once, and a short deadline keeps a wedged one from holding the suite.
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-629-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-629-root-'))
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
    vi.restoreAllMocks()
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
   * 🔴 **Put a conversation into a WORKING turn**, which is the state the ruling is about.
   *
   * ⛔ **Not the Fake's ordinary turn**, which parks on a permission card — and `INTERRUPT_RAILS`
   * correctly refuses `a-person-is-being-asked`, so a fixture that used one would measure that
   * rail instead of this one. ⚑ A thinking burst makes the handle `working` and nothing else.
   */
  const makeItWork = async (handle: FakeSessionHandle): Promise<void> => {
    handle.simulateThinking({ text: 'driving the browser', redacted: false })
    await waitFor(() => handle.status() === 'working', 'the conversation to be working')
  }

  /** ⚑ A caller, as an agent's conversation spells one. */
  const asAgent = (sessionId: string): { ownerId: string } => ({ ownerId: `agent:${sessionId}` })

  /**
   * ⚑ **D-016 · a give, and the child's first turn is its brief** — waited out to its END, so the
   * turn {@link makeItWork} starts is the only one in flight. ⛔ **The chain runs in `auto`** (BroBot
   * is opened so, and a child runs in its giver's mode): in `ask` every brief parks on a permission
   * card, and `INTERRUPT_RAILS` refuses `a-person-is-being-asked` — the rail this file must not
   * measure.
   */
  const give = async (
    tools: AgentToolset,
    profile: string,
    title: string,
  ): Promise<{ agent: string; piece: string; label: string }> => {
    const given = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief: title,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.started, JSON.stringify(given)).toBe(true)
    const agent = given.agent as string
    await waitFor(
      () => ledger(agent).some((event) => event.type === 'turn'),
      'the brief’s turn to end',
    )
    return { agent, piece: given.piece as string, label: given.label as string }
  }

  /**
   * 🔴 **BroBot → Ada → Ali, through the real door.**
   *
   * ⛔ **Every hop is a give** and not a hand-written provenance row: what the ruling walks is what
   * the rails wrote, and a fixture that wrote the chain itself would be measuring its own INSERT
   * (`a-fixture-built-with-the-helper-under-test-proves-nothing`, one table over).
   *
   * ⚠️ **Every tier holds the RULED grants** — nothing here grants anything, so the reach measured
   * is the one every install ships with.
   */
  const aChainOfThree = async (): Promise<{
    brobot: string
    ada: string
    ali: string
    /** ⚑ The piece Ada gave Ali — its id and its label. */
    aliPiece: string
    aliLabel: string
    aliHandle: FakeSessionHandle
    brobotTools: AgentToolset
    adaTools: AgentToolset
    pmProfile: string
    workerProfile: string
    /** ⚑ A SECOND worker identity, because a parent has ONE conversation with an identity — a
     * give to the same one reaches it (D-016's lookup). A sibling needs an identity of its own. */
    siblingProfile: string
  }> => {
    const nth = ++chains
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    const siblingProfile = `sibling-${String(nth)}`
    await bringIdentityIntoBeing(pmProfile)
    await bringIdentityIntoBeing(workerProfile)
    await bringIdentityIntoBeing(siblingProfile)
    const brobot = await personOpens(DEFAULT_PROFILE_ID, 'auto')
    const brobotTools = agentToolsFor(host, brobot)
    const ada = (await give(brobotTools, pmProfile, 'run the front-end work')).agent
    const adaTools = agentToolsFor(host, ada)
    const toAli = await give(adaTools, workerProfile, 'build the world-clock page')
    const ali = toAli.agent
    const aliHandle = latestHandle()
    return {
      brobot,
      ada,
      ali,
      aliPiece: toAli.piece,
      aliLabel: toAli.label,
      aliHandle,
      brobotTools,
      adaTools,
      pmProfile,
      workerProfile,
      siblingProfile,
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §0 · what was already built
  // ─────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **Standing rule 38 · a document describes what SHOULD be true; only the code says what
   * IS.** ⚑ Asserted rather than written in prose, so the next dispatch that wonders can run it.
   */
  describe('§0 · the chain and the actor were already recorded', () => {
    it('⚑ ALREADY BUILT · the chain is DURABLE, and the depth rail already walks it', async () => {
      const { brobot, ada, ali, aliPiece } = await aChainOfThree()
      // ⛔ **`341` criterion 8's row, written by the rails in the child's own transaction.**
      // ⚑ D-016: the parent is the one provenance fact left (`parentOf`).
      expect(store.parentOf(ali)).toBe(ada)
      expect(store.parentOf(ada)).toBe(brobot)
      expect(store.parentOf(brobot)).toBeNull()
      // ⚑ **And the WALK existed** — `341` wrote it for the `too-deep` rail. ⚑ **D-016 · the depth
      // is counted on `work`**: the piece Ali holds sits two below BroBot's root. 🔴 **What `629`
      // added is the conversations' walk asked for its MEMBERS**, not a new relationship: see
      // {@link SessionStore.ancestorsOf}.
      expect(store.depthOf(aliPiece)).toBe(2)
      expect(store.ancestorsOf(ali)).toEqual([ada, brobot])
      expect(store.ancestorsOf(ada)).toEqual([brobot])
      // ⛔ **`[]` is *nothing above it* and is the top of the chain**, never *we could not look*.
      expect(store.ancestorsOf(brobot)).toEqual([])
    })

    it('⚑ ALREADY BUILT · the interrupt already records WHO performed it', async () => {
      // 🔴 **§3.1 asked whether *a grandparent stopped your worker* is expressible in what the
      // interrupt already records.** ⛔ **It is**: `RuntimeHost.recordTheAsk` has written
      // `work_interrupted` with `whoDidIt`'s discriminated actor since `501`, and the agent arm
      // carries the asking CONVERSATION. ⚑ So no new field was needed and none was added.
      const { ada, ali, aliHandle, adaTools } = await aChainOfThree()
      await makeItWork(aliHandle)
      const said = await callOn(adaTools, 'interrupt_agent', { agent: ali, reason: 'stop' })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      const asked = ledger(ali).find((event) => event.type === 'work_interrupted')
      expect(asked).toMatchObject({ type: 'work_interrupted', by: 'an-agent', agent: ada })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the ruling
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a grandparent may interrupt a grandchild', () => {
    it('🔴 THE RULING · BroBot stops Ali directly, at depth 2, without going through Ada', async () => {
      const { brobot, ali, aliPiece, aliHandle, brobotTools } = await aChainOfThree()
      // Keep the descendant working so the stop measures interruption of active work.
      await makeItWork(aliHandle)
      expect(store.depthOf(aliPiece)).toBe(2)

      const said = await callOn(brobotTools, 'interrupt_agent', {
        agent: ali,
        reason: 'the person asked for it to stop',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      expect(said.agent).toBe(ali)
      expect(said.asked).toBe(true)

      // 🔴 **And the ask really landed on Ali**, naming BroBot — which is what makes this a stop
      // rather than a call that answered `ok`.
      await waitFor(
        () => ledger(ali).some((event) => event.type === 'work_interrupted'),
        'the ask to reach the grandchild',
      )
      expect(ledger(ali).find((event) => event.type === 'work_interrupted')).toMatchObject({
        by: 'an-agent',
        agent: brobot,
      })
      // ⛔ **Ada was not asked to do anything**, which is the whole point: the stop did not queue
      // behind a manager. ⚑ Her ledger holds no interruption of her own.
      expect(ledger(brobot).some((event) => event.type === 'work_interrupted')).toBe(false)
    })

    it('⚑ THE PAIR one fact over · the DIRECT commander still stops it, unchanged', async () => {
      // ⛔ **Without this arm, *the grandparent may* is satisfied by a build that admits
      // everybody** — standing rule 3's pairing, pointed at the allowed side.
      const { ada, ali, aliHandle, adaTools } = await aChainOfThree()
      await makeItWork(aliHandle)
      const said = await callOn(adaTools, 'interrupt_agent', { agent: ali, reason: 'stop' })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      expect(ledger(ali).find((event) => event.type === 'work_interrupted')).toMatchObject({
        agent: ada,
      })
    })

    /**
     * ⚑ **D-014's pair, one direction over — the grandchild may not stop what is above it.** ⛔ Until
     * D-017 this was measured on `end_agent` too; commit 3 removed that verb (nothing ends a
     * conversation), so the chain's reach is interrupt's alone. ⚑ **D-017 · R12**: an id that exists
     * and is not below the caller is refused `not-below-you`, never `no-such-agent`.
     */
    it('🔴 D-014 · the grandchild may not interrupt what is above it — and the grandparent may interrupt it', async () => {
      const { ada, ali, aliHandle, brobotTools } = await aChainOfThree()
      await makeItWork(aliHandle)
      const upward = await callOn(agentToolsFor(host, ali), 'interrupt_agent', {
        agent: ada,
        reason: 'no',
      })
      expect(upward.outcome, JSON.stringify(upward)).toBe('refused')
      expect(upward.rail).toBe('not-below-you')
      expect(ledger(ada).some((event) => event.type === 'work_interrupted')).toBe(false)
      const down = await callOn(brobotTools, 'interrupt_agent', { agent: ali, reason: 'done' })
      expect(down.outcome, JSON.stringify(down)).toBe('ok')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what is STILL refused — the sentence the brief asked for
  // ─────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **§2.2's four, each an ACTUAL refused call paired with the same call one fact over.**
   *
   * ⚑ **D-017 · R12 — `not-below-you` is the word the interrupt refusals get** for a conversation
   * that exists and is not below the caller; `no-such-agent` is kept for an id no conversation has.
   * ⛔ `341`'s ordering, which answered both in one word so a caller could not learn whether the
   * conversation existed, is gone with the one list every agent can read.
   */
  describe('§2 · sideways, upward and spawning are all still refused', () => {
    it('⛔ REFUSED · a SIBLING cannot interrupt its sibling — and their parent can', async () => {
      const { ali, aliHandle, adaTools, siblingProfile } = await aChainOfThree()
      await makeItWork(aliHandle)
      const sibling = (await give(adaTools, siblingProfile, 'the second worker')).agent
      const siblingTools = agentToolsFor(host, sibling)
      // ⚑ **They really are siblings**, or the refusal below is about something else.
      expect(store.parentOf(sibling)).toBe(store.parentOf(ali))
      // ⛔ **And Ali is not above the sibling either** — the walk only goes UP from the target,
      // so a sibling is absent from it in both directions.
      expect(store.ancestorsOf(ali)).not.toContain(sibling)

      const refused = await callOn(siblingTools, 'interrupt_agent', { agent: ali, reason: 'stop' })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('not-below-you')

      // ⚑ **THE PAIR one fact over** — the same call, the same target, from the conversation that
      // IS above it.
      const allowed = await callOn(adaTools, 'interrupt_agent', { agent: ali, reason: 'stop' })
      expect(allowed.outcome, JSON.stringify(allowed)).toBe('ok')
    })

    it('⛔ REFUSED · an UNRELATED agent cannot interrupt anything — and its own child it can', async () => {
      const { ali, aliHandle } = await aChainOfThree()
      await makeItWork(aliHandle)
      // ⚑ **A second, separate chain** — nobody in it is above or below anybody in the first.
      const other = await aChainOfThree()
      await makeItWork(other.aliHandle)
      expect(store.ancestorsOf(ali)).not.toContain(other.brobot)
      expect(store.ancestorsOf(ali)).not.toContain(other.ada)

      const refused = await callOn(other.brobotTools, 'interrupt_agent', {
        agent: ali,
        reason: 'stop',
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('not-below-you')

      // ⚑ **THE PAIR** — the identical caller, one fact over: a grandchild of its OWN.
      const allowed = await callOn(other.brobotTools, 'interrupt_agent', {
        agent: other.ali,
        reason: 'stop',
      })
      expect(allowed.outcome, JSON.stringify(allowed)).toBe('ok')
    })

    it('⛔ REFUSED · a conversation is not ABOVE ITSELF — and the one above it is', async () => {
      // ⛔ **The ruling is *above another*, and a conversation is not above itself.** ⚠️ The walk
      // could say otherwise in two ways — by keeping its seed row, or by coming back round a
      // cycle — and both are refused in the statement rather than here, which is why this arm
      // exists: the rule is stated where a reader looks for it.
      const { ali, aliHandle, adaTools } = await aChainOfThree()
      await makeItWork(aliHandle)
      expect(store.ancestorsOf(ali)).not.toContain(ali)

      // 🔴 **F091 · the door answers first, with what the call is** — that is this conversation
      // (`that-agent-is-you`, `message_agent`'s word), where the chain's word pointed at a door that
      // refuses a message to oneself (§6)…
      const itself = await callOn(agentToolsFor(host, ali), 'interrupt_agent', {
        agent: ali,
        reason: 'stop',
      })
      expect(itself.outcome, JSON.stringify(itself)).toBe('refused')
      expect(itself.rail).toBe('that-agent-is-you')
      // ⚑ …and the walk's rule still holds where it is asked: the host's own entitlement refuses a
      // conversation interrupting itself with the chain's word.
      expect(await host.interruptAgent(ali, asAgent(ali))).toMatchObject({
        ok: false,
        refusal: { rail: 'not-below-you' },
      })
      expect(aliHandle.status()).toBe('working')

      // ⚑ **THE PAIR one fact over** — the same target, from the conversation directly above it.
      const allowed = await callOn(adaTools, 'interrupt_agent', { agent: ali, reason: 'stop' })
      expect(allowed.outcome, JSON.stringify(allowed)).toBe('ok')
    })

    it('⛔ REFUSED · the chain grants no SPAWN — a grandparent may not start a child under its grandchild', async () => {
      const { brobot, ali, aliLabel, siblingProfile } = await aChainOfThree()
      // ⛔ **The chain is not a relationship that admits a give**: D-016's give hangs its piece
      // under one the CALLER holds, so a grandparent naming its grandchild's piece is refused as a
      // piece it does not hold — the successor of the spawn door's `not-your-parent`.
      const request = {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: siblingProfile,
        title: 'a helper',
        brief: 'a helper',
      }
      const refused = await host.giveWork({ ...request, piece: aliLabel }, asAgent(brobot))
      if (refused.ok) throw new Error(`the grandparent's give was admitted: ${refused.owner}`)
      expect(refused.refusal.rail).toBe('no-piece-you-hold-by-that-name')

      // ⚑ **THE PAIR one fact over** — the same request from the conversation that holds the piece.
      const allowed = await host.giveWork({ ...request, piece: aliLabel }, asAgent(ali))
      expect(allowed.ok, JSON.stringify(allowed)).toBe(true)
      if (allowed.ok) expect(store.parentOf(allowed.owner)).toBe(ali)
    })

    // ⚑ **Landing D-014 · `1014 M4`**: interrupt reaches the whole chain, but work goes only
    // to a conversation the caller STARTED. The chain is not a relationship that admits work.
    // ⚑ **D-016** — work is followed up only by the one that gave it: naming the grandchild's piece
    // is refused to the grandparent, which did not give it.
    it('⛔ REFUSED · the chain grants no WORK — a grandparent may not give its grandchild work', async () => {
      const { ali, aliLabel, brobotTools, adaTools } = await aChainOfThree()
      const refused = await callOn(brobotTools, 'message_agent', {
        agent: ali,
        kind: 'follow-up',
        piece: aliLabel,
        text: 'build the settings page too',
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('not-a-piece-you-gave')

      // ⚑ **THE PAIR one fact over** — the same work from the conversation that started Ali.
      const given = await callOn(adaTools, 'message_agent', {
        agent: ali,
        kind: 'follow-up',
        piece: aliLabel,
        text: 'build the settings page too',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the manager sees it
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · a reach past a manager is visible to the manager', () => {
    it('🔴 Ada can read that her worker was stopped, and that BroBot did it', async () => {
      const { brobot, ada, ali, aliHandle, brobotTools } = await aChainOfThree()
      await makeItWork(aliHandle)
      expect(
        (await callOn(brobotTools, 'interrupt_agent', { agent: ali, reason: 'stop' })).outcome,
      ).toBe('ok')
      await waitFor(
        () => ledger(ali).some((event) => event.type === 'work_interrupted'),
        'the ask to reach the grandchild',
      )

      // ⚑ **ALREADY BUILT, and this is the assertion that says so** — `484` put
      // {@link AgentCard.lastAskToStop} on the card exactly because *"a supervisor that cannot see
      // human intervention in its own subtree will confidently narrate a false history"*, and an
      // intervention from ABOVE is the same sentence with a different actor.
      // ⚑ **`me` is Ada's own conversation** — `agentCard`'s third argument, which carries who is
      // asking so the reach is a parameter rather than something the card derives for itself.
      const card = host.agentCard(ali, asAgent(ada), ada)
      expect(card, 'Ada cannot read her own worker’s card').not.toBeNull()
      expect(card?.lastAskToStop).toMatchObject({ by: 'an-agent', asker: brobot })
      // ⛔ **And it does NOT say Ada did it**, which is `617`'s distinction and criterion 18: if
      // her view cannot say who stopped Ali it must not imply she did.
      expect(card?.lastAskToStop?.asker).not.toBe(ada)

      // ⚠️ **The honest limit, asserted rather than left to be discovered**: the card carries the
      // CONVERSATION and not a name. ⛔ `HO-092` §2's class, and it is reported rather than
      // repaired here — see this dispatch's response.
      expect(card?.lastAskToStop?.asker).toMatch(/^sess_/)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §5 · `mayCommand` did not widen
  // ─────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **§5 row 4 · name `mayCommand`'s other questions and show they did not widen.**
   *
   * ⛔ **The enumeration itself is `a-reach-you-can-see.test.ts` §3's**, which COMPUTES the call
   * sites and the sixteen questions rather than restating them — and it is green on this tree, which
   * is the evidence that none of the questions moved (`703`'s two new call sites choose a refusal's
   * words and are named out there). ⚑ **What is asserted here is the other half**: the
   * widening has exactly ONE call site, the verb D-014 names that is left — ⛔ `end_agent`, the
   * other, went with D-017's commit 3. ⚑ **D-016 · commit 7 · R1 — that call site is the verb's
   * entitlement, `mayInterrupt`, in a method of its own**: `interruptAgent` asks it, and so does the
   * one resolver of an agent address for `interrupt_agent`'s label — one entitlement, two askers,
   * so the door and its address cannot come to two readings of it.
   */
  describe('§5 · the widening is one predicate with one caller', () => {
    /** ⛔ **CODE only** — `a-source-census-must-strip-prose-before-it-asserts`. */
    const codeOf = (file: string): string =>
      readFileSync(join(mainRoot, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^[ \t]*\/\/.*$/gm, ' ')

    it('⛔ exactly ONE call site asks the predicate — `mayInterrupt`, which the door and the resolver of its address ask', () => {
      const code = codeOf('runtime/runtime-host.ts')
      const lines = code.split('\n')
      const declaration = /^ {2}(?:private |protected |public )?(?:static )?(?:async )?(\w+)\s*\(/
      let current: string | null = null
      const asked: string[] = []
      /** ⚑ Each method's own code, so the condition is read where the predicate is asked. */
      const bodies = new Map<string, string>()
      for (const line of lines) {
        // ⛔ **A zero-indent declaration RESETS the method**, and that line is the difference
        // between this census and the one in `a-reach-you-can-see.test.ts` §3. ⚠️ That one relies
        // on `mayCommand(`'s own declaration wrapping its arguments onto the next line, so the
        // `\(\w` shape misses it by luck; this predicate's fits on one line, and without the reset
        // it was attributed to whatever two-space `if (` happened to have matched last — the
        // census reported `['if', 'interruptAgent']` and would have gone on doing so for a real
        // ninth call site in any `export function` below.
        if (/^(?:export )?(?:async )?function \w/.test(line)) current = null
        const declared = declaration.exec(line)
        if (declared !== null) current = declared[1] ?? null
        if (current !== null) bodies.set(current, `${bodies.get(current) ?? ''}${line}\n`)
        // ⛔ **Inside a METHOD** — the predicate's own declaration is excluded by position now
        // that the reset above makes that true rather than accidental.
        // ⚠️ **Its arguments may wrap onto the next line** (D-017 · R10 maps the chain through the
        // one in each place), so an open paren at the end of the line counts as a call too.
        if (/\bmayInterruptDownTheChain\((?:\w|\s*$)/.test(line) && current !== null)
          asked.push(current)
      }
      expect(asked).toEqual(['mayInterrupt'])
      // ⚑ **And it spells `mayCommand` in the SAME condition**, which is what keeps
      // `a-reach-you-can-see.test.ts` §3's count honest rather than accidentally short.
      const oneCondition =
        /mayCommand\(this\.commandedNow\(target\), by\)\)\s*(?:\|\||&&)\s*!?mayInterruptDownTheChain\(\s*by,\s*this\.ancestorsAsItWillRun\(sessionId\)/
      for (const name of asked) expect(bodies.get(name), name).toMatch(oneCondition)
      // ⚑ **D-016 · commit 7 · R1 — and the entitlement has exactly two askers**: the door's verb,
      // and the one resolver of an agent address, for the label `interrupt_agent` is handed.
      // ⚑ **Four**: a message and an answer that ask the turn they wait behind to stop ask it too.
      const askers = [...bodies.entries()]
        .filter(([, body]) => /\bthis\.mayInterrupt\(/.test(body))
        .map(([name]) => name)
        .sort()
      expect(askers).toEqual([
        'interruptAgent',
        'messageAgentNow',
        'stopForAnAnswer',
        'theConversationAddressed',
      ])
      // ⛔ **The stripper has teeth**, written as a comparison rather than as a pinned sentence.
      const raw = readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8')
      expect(raw.match(/mayInterruptDownTheChain/g)?.length ?? 0).toBeGreaterThan(
        code.match(/mayInterruptDownTheChain/g)?.length ?? 0,
      )
    })

    it('⛔ the model-facing sentence of the verb names the chain and not *you created*', () => {
      // 🔴 **Standing rule 8.1.** ⛔ A description that went on saying *an agent you created*
      // would instruct a model not to try the act this app now admits — `402`'s defect pointed
      // the other way. ⚑ One verb since D-017's commit 3 removed `end_agent`.
      for (const name of ['interrupt_agent'] as const) {
        const said = agentToolsFor(host, 'sess_none').tools.find(
          (one) => one.name === name,
        )?.description
        expect(said, `${name} has no description`).toBeTruthy()
        expect(said, name).toContain('below you')
        expect(said, name).not.toContain('an agent you created')
      }
    })

    it('⛔ the predicate admits NO caller that is not a conversation, and no empty chain', () => {
      // 🔴 **A window and the app decode to `null`**, so neither can be matched by a list of
      // session ids however that list was built — `mayCommand`'s *null matches nothing, by
      // construction and not by care*, one predicate over.
      expect(mayInterruptDownTheChain({ ownerId: 'webContents:1' }, ['sess_a'])).toBe(false)
      expect(mayInterruptDownTheChain(THE_APP_ITSELF, ['sess_a'])).toBe(false)
      // ⛔ **An empty chain admits nobody** — which is what the null store answers and what a
      // conversation nobody spawned has.
      expect(mayInterruptDownTheChain(asAgent('sess_a'), [])).toBe(false)
      // ⚑ **THE PAIR**: the one shape it does admit.
      expect(mayInterruptDownTheChain(asAgent('sess_a'), ['sess_b', 'sess_a'])).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §6 · F091 — a conversation that names itself
  // ─────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **F091 · `interrupt_agent` naming the conversation that calls it says that is this
   * conversation** — by its id, by a piece it holds (a label names its owner), by its own root, and,
   * for a conversation standing in another's place, by that one's id or piece — as `message_agent`
   * says it. ⛔ It answered the chain's word, `not-below-you`, whose *"to tell it something,
   * message_agent"* pointed at a door that refuses a message to oneself.
   */
  describe('§6 · a conversation that names itself', () => {
    /** ⚑ The words a model reads, beside the payload. */
    const callWithText = async (
      toolset: AgentToolset,
      name: ToolName,
      args: Record<string, unknown>,
    ): Promise<{ structured: Record<string, unknown>; text: string }> => {
      const tool = toolset.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      const result = await tool.call(args)
      return { structured: result.structured as Record<string, unknown>, text: result.text }
    }

    it('🔴 F091 · its id, a piece it holds and its own root name this conversation: nothing is interrupted, and the acts are its own', async () => {
      const { brobot, ada, ali, aliLabel, aliHandle, brobotTools, adaTools, pmProfile } =
        await aChainOfThree()
      await makeItWork(aliHandle)
      const adaLabel = store.piecesOwnedBy(ada)[0]?.label
      expect(typeof adaLabel).toBe('string')
      const aliTools = agentToolsFor(host, ali)
      const brobotsRoot = store.rootOf(brobot)?.label
      if (brobotsRoot === undefined) throw new Error('a conversation a person opened owns a root')
      const readPiece = host.pieceRecord.bind(host)
      vi.spyOn(host, 'pieceRecord').mockImplementation((caller, named) => {
        const record = readPiece(caller, named)
        const ownRoot = caller === brobot && named === brobotsRoot
        if (!ownRoot || record.is === 'no-piece-by-that-name') return record
        return {
          ...record,
          children: record.children.map((child) => {
            if (child.owner !== ada) return child
            return { ...child, state: 'working' as const }
          }),
        }
      })
      const premise = host.pieceRecord(brobot, brobotsRoot)
      expect(premise.is).not.toBe('no-piece-by-that-name')
      if (premise.is === 'no-piece-by-that-name') throw new Error('the caller owns this root')
      expect(premise.children.find((child) => child.owner === ada)?.state).toBe('working')
      for (const [tools, named, itself] of [
        [aliTools, ali, ali],
        [aliTools, aliLabel, ali],
        [brobotTools, brobotsRoot, brobot],
      ] as const) {
        const said = await callWithText(tools, 'interrupt_agent', { agent: named, reason: 'stop' })
        const guide =
          named === aliLabel
            ? ` ${aliLabel} is your own piece, with no helpers recorded under it. list_agents names who you can reach.`
            : named === brobotsRoot
              ? ` ${brobotsRoot} is your own piece. Its helpers: Ada (${pmProfile}) on ${adaLabel} (working). Reach a helper by its piece's label, even after it ended: message_agent with kind: note, or ask_question. For new work, give_work with its profile. To stop a helper below you, interrupt_agent with its label.`
              : ''
        expect(said.structured, named).toMatchObject({
          outcome: 'refused',
          rail: 'that-agent-is-you',
          permanence: 'permanent',
          retryable: false,
          remedy: null,
          reason: A_CONVERSATION_CANNOT_INTERRUPT_ITSELF + guide,
          detail: { agent: itself },
        })
        expect(said.text, named).toBe(
          `refused (that-agent-is-you): ${A_CONVERSATION_CANNOT_INTERRUPT_ITSELF}${guide} ${permanenceInWords('that-agent-is-you', 'permanent')}`,
        )
        // ⛔ …never the door the chain's word pointed at.
        expect(
          said.text.slice(
            0,
            `refused (that-agent-is-you): ${A_CONVERSATION_CANNOT_INTERRUPT_ITSELF}`.length,
          ),
          named,
        ).not.toContain('message_agent')
      }
      // ⛔ Nothing was interrupted.
      expect(aliHandle.status()).toBe('working')
      expect(ledger(ali).some((event) => event.type === 'work_interrupted')).toBe(false)
      // ⚑ The controls: a conversation outside its tree keeps the chain's word, and the one above it
      // interrupts it.
      const other = await aChainOfThree()
      await makeItWork(other.aliHandle)
      expect(
        await callOn(aliTools, 'interrupt_agent', { agent: other.ali, reason: 'stop' }),
      ).toMatchObject({ outcome: 'refused', rail: 'not-below-you' })
      expect(
        (await callOn(adaTools, 'interrupt_agent', { agent: ali, reason: 'stop' })).outcome,
      ).toBe('ok')
    })

    it('🔴 F091 · a conversation in another’s place: that one’s id and its piece name this conversation too — at interrupt_agent and at message_agent', async () => {
      const { ali, aliLabel, adaTools } = await aChainOfThree()
      // ⚑ Ali stops, its provider forgets it, and Ada's next message puts a conversation in its place.
      await host.close(ali, THE_APP_ITSELF)
      await waitFor(
        () =>
          ![...host.resumableSessions()].some(
            (row) => row.sessionId === ali && row.running !== 'not-running',
          ),
        'Ali to stop',
      )
      issued.forgetAll()
      const woken = await callOn(adaTools, 'message_agent', {
        agent: ali,
        kind: 'follow-up',
        piece: aliLabel,
        text: 'carry on',
      })
      expect(woken.outcome, JSON.stringify(woken)).toBe('ok')
      const next = woken.went_to as string
      expect(typeof next).toBe('string')
      expect(next).not.toBe(ali)
      const nextTools = agentToolsFor(host, next)
      for (const named of [ali, aliLabel, next]) {
        const guide =
          named === aliLabel
            ? ` ${aliLabel} is your own piece, with no helpers recorded under it. list_agents names who you can reach.`
            : ''
        expect(
          await callOn(nextTools, 'interrupt_agent', { agent: named, reason: 'stop' }),
          named,
        ).toMatchObject({
          outcome: 'refused',
          rail: 'that-agent-is-you',
          reason: A_CONVERSATION_CANNOT_INTERRUPT_ITSELF + guide,
        })
        // ⚑ …and `message_agent`'s own word, where the host's gate answered a conversation that could
        // take no message, and sent a person to look at it.
        expect(
          await callOn(nextTools, 'message_agent', { kind: 'note', agent: named, text: 'hello' }),
          named,
        ).toMatchObject({
          outcome: 'refused',
          rail: 'that-agent-is-you',
          reason: refuseTool('that-agent-is-you').reason + guide,
        })
      }
      // ⚑ The controls: Ada's message to Ali's id still reaches the conversation in its place, and
      // so does her interrupt — the old id names the caller only when the caller is in its place.
      expect(
        await callOn(adaTools, 'message_agent', { agent: ali, kind: 'note', text: 'and this' }),
      ).toMatchObject({ outcome: 'ok', went_to: next })
      expect(
        await callOn(adaTools, 'interrupt_agent', { agent: ali, reason: 'stop' }),
      ).toMatchObject({ outcome: 'ok', agent: next })
    })
  })
})
