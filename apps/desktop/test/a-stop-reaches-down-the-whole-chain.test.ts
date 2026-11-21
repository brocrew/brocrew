import { giveAndWaitForBriefTurn, openFrontEndChain } from './lib/give-fixture'
import { personOpener } from './helpers/person-opens-session'
import { callOn } from './helpers/call-agent-tool'
import { chainAbove } from './helpers/conversation-ancestry'
import { HandleKeepingRuntime as ProviderDouble } from './helpers/handle-keeping-runtime'
import { waitFor } from './lib/f093-host'
import { seedHistoricalSuccessor } from './lib/historical-replacement'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { closeAndRemove, homesUnder, scratchHostState } from './helpers/scratch-host'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset, FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { AppDatabase } from '../src/main/db/connection'
import type { SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from './helpers/giver-notice-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import {
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
  type RecordingSink,
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
 * §5 **`mayCommand` did not widen** · §6 **F091 · the addresses a conversation can use to stop its own turn**.
 */

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
      ...homesUnder(() => userData),
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
    clock = 9_000_000
    ;({ userData, root, db, store, issued, window } = scratchHostState('brobot2-629', tick))
    counter = 0
    hosts = []
    handles = []
    chains = 0
    host = buildHost()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await closeAndRemove(hosts, db, userData, root)
  })

  const personOpens = personOpener(() => ({ host, root, window }), 'ask')

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> =>
    host.close(await personOpens(profileId), window)

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
  const give = (tools: AgentToolset, profile: string, title: string) =>
    giveAndWaitForBriefTurn(tools, profile, title, ledger)

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
    return openFrontEndChain({
      host,
      nth: ++chains,
      includeSibling: true,
      bringIdentityIntoBeing,
      personOpens,
      ledger,
      firstHandle: latestHandle,
      finalHandle: latestHandle,
    })
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §0 · what was already built
  // ─────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **Standing rule 38 · a document describes what SHOULD be true; only the code says what
   * IS.** ⚑ Asserted rather than written in prose, so the next dispatch that wonders can run it.
   */
  describe('§0 · the chain and the actor were already recorded', () => {
    it('⚑ ALREADY BUILT · the chain is DURABLE, and the store walks it', async () => {
      const { brobot, ada, ali, aliPiece } = await aChainOfThree()
      // ⛔ **`341` criterion 8's row, written by the rails in the child's own transaction.**
      // ⚑ D-016: the parent is the one provenance fact left (`parentOf`).
      expect(store.parentOf(ali)).toBe(ada)
      expect(store.parentOf(ada)).toBe(brobot)
      expect(store.parentOf(brobot)).toBeNull()
      // ⚑ **D-016 · the chain is on `work` too**: the piece Ali holds sits two below BroBot's root,
      // which its label says. 🔴 **What `629` added is the conversations' walk asked for its
      // MEMBERS**, not a new relationship: see `chainAbove`.
      expect(store.workById(aliPiece)?.label.split('.')).toHaveLength(3)
      expect(chainAbove(store, ali)).toEqual([ada, brobot])
      expect(chainAbove(store, ada)).toEqual([brobot])
      // ⛔ **`[]` is *nothing above it* and is the top of the chain**, never *we could not look*.
      expect(chainAbove(store, brobot)).toEqual([])
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

    it.each([
      'live',
      'live, with no reason given',
      'reopened',
      'stopped by the person as well',
      'reopened after both stops',
    ])('explains an explicit stop once when the target is %s', async (life) => {
      const { ada, adaTools, ali, aliHandle } = await aChainOfThree()
      const given = life.includes('no reason') ? undefined : 'The copied clock face is enough'
      const reason = given ?? 'no reason given'
      const personAlsoStops =
        life === 'stopped by the person as well' || life === 'reopened after both stops'
      await makeItWork(aliHandle)
      if (personAlsoStops) {
        // The provider acknowledges the agent's request while the same turn is still running.
        vi.spyOn(aliHandle, 'interrupt').mockResolvedValueOnce(undefined)
      }
      expect(
        await callOn(adaTools, 'interrupt_agent', { agent: ali, reason: given }),
      ).toMatchObject({
        outcome: 'ok',
        asked: true,
      })
      expect(store.lastAskToStop(ali)).toMatchObject({ asker: ada, reason })
      if (personAlsoStops) {
        expect(aliHandle.status()).toBe('working')
        expect(host.claimSession(ali, window)).not.toBeNull()
        await host.interrupt(ali, window)
        expect(store.lastAskToStop(ali)).toMatchObject({ by: 'a-person' })
      }
      await waitFor(() => aliHandle.status() === 'idle', 'the provider to finish the stopped turn')
      if (life === 'reopened' || life === 'reopened after both stops') {
        await host.closeAll()
        host = buildHost()
        await host.reopenForAPerson(ali, window, null)
      } else if (life.startsWith('live')) {
        expect(host.claimSession(ali, window)).not.toBeNull()
      }
      const heard = () =>
        ledger(ali).flatMap((event) => (event.type === 'assistant_message' ? [event.text] : []))
      const send = async (message: string) => {
        await host.send(ali, message, window)
        await waitFor(
          () => heard().some((word) => word.includes(message)),
          'the message to reach the provider',
        )
        await waitFor(() => latestHandle().status() === 'idle', 'the continuation turn to end')
      }

      await send('Continue the clock work')
      await send('Record the next clock detail')

      // It rides the next ordinary input, once, and started no turn of its own.
      const notice = heard().filter((word) => word.includes(reason))
      expect(notice).toHaveLength(1)
      expect(notice[0]).toContain('Continue the clock work')
      expect(notice[0]).toContain(
        `${host.whatToCallTheConversation(ada)}, conversation W4.1 · run the front-end work, stopped your turn: ${reason}. Read what was recorded before continuing instead of redoing it.`,
      )
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
      expect(store.workById(aliPiece)?.label.split('.')).toHaveLength(3)

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
      expect(chainAbove(store, ali)).not.toContain(sibling)

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
      expect(chainAbove(store, ali)).not.toContain(other.brobot)
      expect(chainAbove(store, ali)).not.toContain(other.ada)

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
    it('a conversation and a colleague can both ask its running turn to stop', async () => {
      const selfTool = await aChainOfThree()
      await makeItWork(selfTool.aliHandle)
      expect(chainAbove(store, selfTool.ali)).not.toContain(selfTool.ali)
      const itself = await callOn(agentToolsFor(host, selfTool.ali), 'interrupt_agent', {
        agent: selfTool.ali,
        reason: 'stop',
      })
      expect(itself).toMatchObject({ outcome: 'ok', agent: selfTool.ali, asked: true })

      const direct = await aChainOfThree()
      await makeItWork(direct.aliHandle)
      expect(await host.interruptAgent(direct.ali, asAgent(direct.ali))).toMatchObject({
        ok: true,
        agent: direct.ali,
        asked: true,
      })

      const peer = await aChainOfThree()
      await makeItWork(peer.aliHandle)
      expect(
        await callOn(peer.adaTools, 'interrupt_agent', { agent: peer.ali, reason: 'stop' }),
      ).toMatchObject({ outcome: 'ok', agent: peer.ali, asked: true })
    })
    it('⛔ REFUSED · the chain grants no SPAWN — a grandparent may not start a child under its grandchild', async () => {
      const { brobot, ali, aliLabel, siblingProfile } = await aChainOfThree()
      // ⛔ **The chain is not a relationship that admits a give**: D-016's give hangs its piece
      // under one the CALLER holds, so a grandparent naming its grandchild's piece is refused as a
      // piece it does not hold — the successor of the spawn door's `not-your-parent`.
      const request = {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: siblingProfile,
        to: 'new',
        conversation_title: 'a helper',
        title: 'a helper',
        brief: 'a helper',
      }
      const refused = await host.giveWork({ ...request, under: aliLabel }, asAgent(brobot))
      if (refused.ok) throw new Error(`the grandparent's give was admitted: ${refused.owner}`)
      expect(refused.refusal.rail).toBe('no-piece-you-hold-by-that-name')

      // ⚑ **THE PAIR one fact over** — the same request from the conversation that holds the piece.
      const allowed = await host.giveWork({ ...request, under: aliLabel }, asAgent(ali))
      expect(allowed.ok, JSON.stringify(allowed)).toBe(true)
      if (allowed.ok) expect(store.parentOf(allowed.owner)).toBe(ali)
    })

    it('the grandparent can send a task note and its giver sends a follow-up', async () => {
      const { ali, aliLabel, brobotTools, adaTools } = await aChainOfThree()
      const note = await callOn(brobotTools, 'message_agent', {
        agent: ali,
        kind: 'follow-up',
        piece: aliLabel,
        text: 'build the settings page too',
      })
      expect(note).toMatchObject({ outcome: 'ok', kind: 'note', label: aliLabel })

      // ⚑ **THE PAIR one fact over** — the same work from the conversation that started Ali.
      const given = await callOn(adaTools, 'message_agent', {
        agent: ali,
        kind: 'follow-up',
        piece: aliLabel,
        text: 'build the settings page too',
      })
      expect(given).toMatchObject({ outcome: 'ok', kind: 'follow-up', label: aliLabel })
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
        expect(said, name).toContain('Any conversation may do this')
        expect(said, name).not.toContain('an agent you created')
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §6 · F091 — a conversation that names itself
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · a conversation that names itself', () => {
    it('its id, its held piece and its own root name the conversation to stop', async () => {
      for (const naming of ['id', 'held piece'] as const) {
        const { ali, aliLabel, aliHandle } = await aChainOfThree()
        const address = naming === 'id' ? ali : aliLabel
        await makeItWork(aliHandle)
        expect(
          await callOn(agentToolsFor(host, ali), 'interrupt_agent', {
            agent: address,
            reason: 'stop',
          }),
          naming,
        ).toMatchObject({ outcome: 'ok', agent: ali, asked: true })
        expect(ledger(ali).filter((event) => event.type === 'work_interrupted')).toHaveLength(1)
      }
      const { brobot, ali, aliHandle, brobotTools, adaTools } = await aChainOfThree()
      const itsRoot = store.rootOf(brobot)?.label
      if (itsRoot === undefined) throw new Error('a conversation a person opened owns a root')
      expect(
        await callOn(brobotTools, 'interrupt_agent', { agent: itsRoot, reason: 'stop' }),
      ).toMatchObject({ outcome: 'ok', agent: brobot, asked: false })
      const other = await aChainOfThree()
      await makeItWork(other.aliHandle)
      expect(
        await callOn(agentToolsFor(host, ali), 'interrupt_agent', {
          agent: other.ali,
          reason: 'stop',
        }),
      ).toMatchObject({ outcome: 'ok', agent: other.ali, asked: true })
      await makeItWork(aliHandle)
      expect(
        await callOn(adaTools, 'interrupt_agent', { agent: ali, reason: 'stop' }),
      ).toMatchObject({ outcome: 'ok', agent: ali, asked: true })
    })

    it('🔴 F091 · a conversation in another’s place: that one’s id and its piece name this conversation too — at interrupt_agent and at message_agent', async () => {
      const { ali, aliLabel, ada, workerProfile } = await aChainOfThree()
      await host.closeAll()
      const next = seedHistoricalSuccessor(store, ali, `sess_${++counter}`, tick(), {
        sessions: issued,
        home: syntheticProviderHome(() => userData)('claude', workerProfile),
      })
      host = buildHost()
      await host.resumeSession(ada, window)
      const adaTools = agentToolsFor(host, ada)
      const woken = await callOn(adaTools, 'message_agent', {
        agent: ali,
        kind: 'follow-up',
        piece: aliLabel,
        text: 'carry on',
      })
      expect(woken, JSON.stringify(woken)).toMatchObject({ outcome: 'ok', went_to: next })
      const nextTools = agentToolsFor(host, next)
      for (const named of [ali, aliLabel, next]) {
        expect(
          await callOn(nextTools, 'interrupt_agent', { agent: named, reason: 'stop' }),
          named,
        ).toMatchObject({ outcome: 'ok', agent: next })
        expect(
          await callOn(nextTools, 'message_agent', { agent: named, text: 'hello' }),
          named,
        ).toMatchObject({
          outcome: 'ok',
          receipt: { recipient: { id: next } },
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
