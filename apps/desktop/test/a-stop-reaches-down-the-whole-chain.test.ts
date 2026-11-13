import { personOpener } from './helpers/person-opens-session'
import { callOn } from './helpers/call-agent-tool'
import { HandleKeepingRuntime as ProviderDouble } from './helpers/handle-keeping-runtime'
import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset, FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import {
  A_CONVERSATION_CANNOT_INTERRUPT_ITSELF,
  agentToolsFor,
  refuseTool,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { permanenceInWords } from '../src/main/runtime/agent-tool-answer-words'
import {
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
  RecordingSink,
} from './lib/host-fixture'

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

describe('629 · a stop reaches down the whole chain', () => {
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
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      // ⚑ **Bounded, because `interruptAgent` races the provider against it** — the Fake's
      // interrupt resolves at once, and a short deadline keeps a wedged one from holding the suite.
      interruptWaitMs: 40,
      readProviderConfig: fixtureProviderConfig,
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
    adaHandle: FakeSessionHandle
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
    const adaHandle = latestHandle()
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
      adaHandle,
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

    it('a grandchild can stop its working parent, and a grandparent can stop its running descendant', async () => {
      const { ada, ali, aliHandle, adaHandle, brobotTools } = await aChainOfThree()
      await makeItWork(aliHandle)
      await makeItWork(adaHandle)
      const upward = await callOn(agentToolsFor(host, ali), 'interrupt_agent', {
        agent: ada,
        reason: 'no',
      })
      expect(upward).toMatchObject({ outcome: 'ok', agent: ada, asked: true })
      expect(ledger(ada).find((event) => event.type === 'work_interrupted')).toMatchObject({
        by: 'an-agent',
        agent: ali,
      })
      const down = await callOn(brobotTools, 'interrupt_agent', { agent: ali, reason: 'done' })
      expect(down.outcome, JSON.stringify(down)).toBe('ok')
    })
  })

  describe('§2 · peers may interrupt; self, spawning and work controls remain', () => {
    it('a sibling can stop its running sibling, and the parent can ask again', async () => {
      const { ali, aliHandle, adaTools, siblingProfile } = await aChainOfThree()
      await makeItWork(aliHandle)
      const sibling = (await give(adaTools, siblingProfile, 'the second worker')).agent
      const siblingTools = agentToolsFor(host, sibling)
      expect(store.parentOf(sibling)).toBe(store.parentOf(ali))
      expect(store.ancestorsOf(ali)).not.toContain(sibling)

      const refused = await callOn(siblingTools, 'interrupt_agent', { agent: ali, reason: 'stop' })
      expect(refused).toMatchObject({ outcome: 'ok', asked: true })

      const allowed = await callOn(adaTools, 'interrupt_agent', { agent: ali, reason: 'stop' })
      expect(allowed.outcome, JSON.stringify(allowed)).toBe('ok')
    })
    it('an unrelated colleague can stop a running peer as well as its own descendant', async () => {
      const { ali, aliHandle } = await aChainOfThree()
      await makeItWork(aliHandle)
      const other = await aChainOfThree()
      await makeItWork(other.aliHandle)
      expect(store.ancestorsOf(ali)).not.toContain(other.brobot)
      expect(store.ancestorsOf(ali)).not.toContain(other.ada)

      const refused = await callOn(other.brobotTools, 'interrupt_agent', {
        agent: ali,
        reason: 'stop',
      })
      expect(refused).toMatchObject({ outcome: 'ok', asked: true })

      const allowed = await callOn(other.brobotTools, 'interrupt_agent', {
        agent: other.ali,
        reason: 'stop',
      })
      expect(allowed.outcome, JSON.stringify(allowed)).toBe('ok')
    })
    it('a conversation cannot interrupt itself, and a colleague can', async () => {
      const { ali, aliHandle, adaTools } = await aChainOfThree()
      await makeItWork(aliHandle)
      expect(store.ancestorsOf(ali)).not.toContain(ali)

      const itself = await callOn(agentToolsFor(host, ali), 'interrupt_agent', {
        agent: ali,
        reason: 'stop',
      })
      expect(itself.outcome, JSON.stringify(itself)).toBe('refused')
      expect(itself.rail).toBe('that-agent-is-you')
      expect(await host.interruptAgent(ali, asAgent(ali))).toMatchObject({
        ok: false,
        refusal: 'that-agent-is-you',
      })
      expect(aliHandle.status()).toBe('working')

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

  describe('§5 · the public description admits known conversations', () => {
    it('the model-facing sentence names known conversations', () => {
      // 🔴 **Standing rule 8.1.** ⛔ A description that went on saying *an agent you created*
      // would instruct a model not to try the act this app now admits — `402`'s defect pointed
      // the other way. ⚑ One verb since D-017's commit 3 removed `end_agent`.
      for (const name of ['interrupt_agent'] as const) {
        const said = agentToolsFor(host, 'sess_none').tools.find(
          (one) => one.name === name,
        )?.description
        expect(said, `${name} has no description`).toBeTruthy()
        expect(said, name).toContain('known conversation')
        expect(said, name).not.toContain('an agent you created')
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §6 · F091 — a conversation that names itself
  // ─────────────────────────────────────────────────────────────────────────────────────────

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
            ? ` ${aliLabel} is your own piece, with no helpers recorded under it. list_agents names conversations; message_agent answers whether one can take your message.`
            : named === brobotsRoot
              ? ` ${brobotsRoot} is your own piece. Its helpers: Ada (${pmProfile}) on ${adaLabel} (working). Reach a helper by its piece's label, even after it ended: message_agent with kind: note, or ask_question. For new work, give_work with its profile. To stop a known conversation, interrupt_agent with its label.`
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
      const other = await aChainOfThree()
      await makeItWork(other.aliHandle)
      expect(
        await callOn(aliTools, 'interrupt_agent', { agent: other.ali, reason: 'stop' }),
      ).toMatchObject({ outcome: 'ok', asked: true })
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
            ? ` ${aliLabel} is your own piece, with no helpers recorded under it. list_agents names conversations; message_agent answers whether one can take your message.`
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
