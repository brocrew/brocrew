import { callOn } from './helpers/call-agent-tool'
import { personOpenerOverIpc } from './helpers/person-opens-session'
import { ToolWatchingRuntime } from './lib/provider-double'
import {
  fixtureDatabase,
  fixtureFolder,
  numberedFixtureHostPaths,
  closeHostFixture,
  RecordingSink,
  latestToolset,
  waitFor,
} from './lib/host-fixture'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { AppDatabase } from '../src/main/db/connection'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { CallerIdentity } from '../src/main/runtime/runtime-host'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

/**
 * 🔴 **431 · the message that crosses a project** — HO-024 §4 row 6, owed since Slice 4, and
 * HO-022 §3's other half.
 *
 * ## ⚑ D-016 · there is no project left to cross
 *
 * ⛔ **`D-016` took projects out** — the rooms, `create_project`, project placement, the
 * `same-project` reach and every `-outside-your-project` rail. ⚠️ **The cases that were about the
 * project boundary went with it**. ⚑ **What stays is the message reach with no project in it**:
 * any agent's words reach a conversation it did not start, the verbs that cut into a conversation
 * still ask for a relationship, work goes only to a conversation you started, and a reply lands
 * back in its giver's conversation. ⚠️ Where the history below says *another project*, read *a
 * conversation a person opened*.
 *
 * ## ⛔ The criterion, and the two halves it has
 *
 * > **6 · A cross-project message is refused in the product**, not only in a constructed control.
 *
 * ⚑ **`374` demonstrated the refusal at a state it BUILT by hand** — a session whose
 * `agent_profile_id` it moved with an `UPDATE` — and said so rather than writing a test that could
 * not fail. ⛔ **`376` then turned that over and found the product still could not produce the
 * state**, because a child inherits its spawner's project and nothing moves a conversation
 * afterwards.
 *
 * 🔴 **`430` found why the OTHER half was unreachable too, and it is not the rail.** BroBot's
 * `can_message: 'any'` is *"necessary but not sufficient"*: `message_agent` resolves an
 * entitlement through `mayCommand`, a project manager a PERSON opened in another project is neither
 * BroBot's owner nor its commander, and *"the product creation door can put a PM in project B but
 * cannot make BroBot command it."* ⚠️ **So the grant was never asked**, and the seed's own
 * sentence — *"BroBot talks to a project manager in every project"* — described something this app
 * refused.
 *
 * ## ⚑ What this suite measures, and what it deliberately does not
 *
 * ⛔ **Every fixture in §1 is built through product doors** — `createSession`, `give_work` (D-016:
 * `spawn_agent`'s successor), and the agent toolset the HOST handed the launch. ⚠️ **No
 * `agent_identity` row is written by hand and no identity is moved there**, which is the whole
 * difference between this file and `the-rails-a-message-passes.test.ts` §4.
 *
 * 🔴 **The widening is one word at TWO call sites, and the pair is the rule rather than a second
 * exception.** `RuntimeHost.send` and `RuntimeHost.queueMessage` ask `requireToMessage`; they are
 * the two spellings of one act, and
 * `queueMessage` delegates to `send` on the idle path, so a gate at one of them alone refuses the
 * caller the other just admitted. ⛔ `sendInterrupting`, `cancelQueuedMessage` and `interrupt` still
 * ask `requireToCommand`, and §2 is as much of this dispatch as §1: a reach that also ended,
 * interrupted or enumerated would be the trap `430` named, *"widening `mayCommand` globally would
 * also widen other commands"*.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real IPC boundary.** The only double is the
 * provider.
 */

/** Keeps the toolsets the HOST handed out, so an agent's calls go through the real one. */
describe('431 · the message that crosses a project', () => {
  let userData: string
  let root: string
  let elsewhere: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handed: AgentToolset[]
  let window: RecordingSink

  beforeEach(() => {
    userData = fixtureFolder('brobot2-crossing-')
    root = fixtureFolder('brobot2-crossing-root-')
    elsewhere = fixtureFolder('brobot2-crossing-elsewhere-')
    db = fixtureDatabase(userData)
    let clock = Date.UTC(2030, 0, 1)
    const tick = (): number => clock++
    store = createSessionStore(db, tick)
    handed = []
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      ...numberedFixtureHostPaths(() => userData, tick),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await closeHostFixture(host, db, userData, root, elsewhere)
  })

  /** ⛔ Through the real boundary, so nothing here reaches a host method a window cannot. */
  const ask = (command: Parameters<typeof executeRuntimeCommand>[2]): Promise<unknown> =>
    executeRuntimeCommand(host, window, command)

  const personOpens = personOpenerOverIpc(() => ({ host, root, window }))
  const theToolsetJustHandedOut = (): AgentToolset => latestToolset(handed)

  /** What an agent's own calls look like from outside the toolset — `agent:<its session>`. */
  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  const eventKinds = (sessionId: string): string[] =>
    store.events(sessionId).map((one) => one.event.type)

  /**
   * 🔴 **The fixture the whole file rests on, and every step is a door a person presses.**
   *
   * ⚑ A project manager a PERSON opened, and BroBot. ⛔ **Nothing here makes BroBot command that
   * conversation** — it has no `commandedBy`, no shared owner and no spawn between them, which is
   * exactly the state `430` found unreachable. ⚑ **D-016** — the second project this fixture built
   * is gone; what made the pair interesting was always who started what, and that is unchanged.
   */
  const aManagerInAnotherProject = async (): Promise<{
    brobot: string
    brobotTools: AgentToolset
    manager: string
  }> => {
    const manager = await personOpens('pm')
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const brobotTools = theToolsetJustHandedOut()
    expect(store.parentOf(manager)).toBeNull()
    return { brobot, brobotTools, manager }
  }

  /**
   * ⚑ **BroBot's OWN child** — the one kind of receiver work goes to (D-014: work goes only to
   * conversations the giver started). ⛔ Built through the product door. ⚑ **D-016** — it was
   * spawned by `spawn_agent` and then sent work; `give_work` is both now: it starts BroBot's one
   * conversation with `worker` and files the piece in it, and the child runs the brief as a turn.
   * ⚠️ `worker` is opened by a person first so the profile exists (R3: a give to a name this app
   * does not hold is refused), and that conversation is not BroBot's, so the give starts its own.
   */
  const aChildOfBroBot = async (
    brobotTools: AgentToolset,
  ): Promise<{ child: string; childTools: AgentToolset; label: string }> => {
    await personOpens('worker')
    const given = await callOn(brobotTools, 'give_work', {
      to: 'new',
      conversation_title: 'the work',
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work',
      brief: 'do the thing',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.started, JSON.stringify(given)).toBe(true)
    const child = given.agent as string
    return { child, childTools: theToolsetJustHandedOut(), label: given.label as string }
  }

  const workGivenIn = (sessionId: string): unknown[] =>
    store
      .events(sessionId)
      .map((one) => one.event)
      .filter((event) => event.type === 'work_given')

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · criterion 6, through the product — the four cases 430 named
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a conversation a person opened, reached by an agent that did not start it', () => {
    it('🔴 BroBot reaches a manager a person opened, and so does any other agent', async () => {
      const { brobot, brobotTools, manager } = await aManagerInAnotherProject()
      const reached = await callOn(brobotTools, 'message_agent', {
        agent: manager,
        text: 'what is this project up to?',
        kind: 'note',
      })
      expect(reached, JSON.stringify(reached)).toMatchObject({
        outcome: 'ok',
        delivery: 'sent',
        agent: manager,
      })
      // ⛔ **And the words really landed in the manager's conversation**, which is the half a
      // refusal-shaped assertion could never prove.
      expect(eventKinds(manager)).toContain('user_turn')

      const permission = () =>
        store.events(manager).find(({ event }) => event.type === 'permission_request')?.event
      await waitFor(() => permission() !== undefined, 'the first turn’s permission request')

      // A second identity, not BroBot: reach reads no slug and no grant.
      const other = await personOpens('explorer')
      const otherTools = theToolsetJustHandedOut()
      const alsoReached = await callOn(otherTools, 'message_agent', {
        agent: manager,
        text: 'and from me?',
        kind: 'note',
      })
      expect(alsoReached, JSON.stringify(alsoReached)).toMatchObject({
        outcome: 'ok',
        delivery: 'queued',
        agent: manager,
      })
      expect(eventKinds(manager).filter((kind) => kind === 'user_turn')).toHaveLength(1)
      const request = permission()
      if (request?.type !== 'permission_request')
        throw new Error('the first request was not recorded')
      await ask({
        kind: 'respondPermission',
        sessionId: manager,
        requestId: request.id,
        decision: { outcome: 'allow' },
      })
      const delivered = () =>
        store
          .events(manager)
          .flatMap(({ event }) => (event.type === 'user_turn' ? [event.text] : []))
      await waitFor(() => delivered().length === 2, 'delivery of the second message')
      expect(delivered()).toEqual([
        expect.stringContaining('what is this project up to?'),
        expect.stringContaining('and from me?'),
      ])
      expect(brobot).not.toBe(other)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the widening is opt-in at ONE call site — 430's trap, pressed
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · what the reach did NOT widen', () => {
    it('interrupt_agent accepts a known conversation in another project', async () => {
      const { brobotTools, manager } = await aManagerInAnotherProject()
      expect(store.routedRequestsOf(manager)).toEqual([])
      await ask({ kind: 'setApprovalMode', sessionId: manager, mode: 'auto' })
      expect(store.findLive(manager)?.approvalMode).toBe('auto')
      // ⚑ **The positive control, first**: the message door admits this exact conversation.
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: manager,
          text: 'x',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'ok' })
      const stopped = await callOn(brobotTools, 'interrupt_agent', {
        agent: manager,
        reason: 'stop',
      })
      expect(stopped, JSON.stringify(stopped)).toMatchObject({ outcome: 'ok' })
      // ⛔ **And it is still there, untouched.**
      expect(host.sessionIds).toContain(manager)
    })

    /**
     * 🔴 **`431` asserted that the two readers did NOT move, and `433` moved them — so this test
     * asserts the opposite fact and says which dispatch owns which half.**
     *
     * ⛔ **It is not redundant and it was not deleted.** What `431` measured here was a GAP it
     * wrote down in its own words: *"an identity this reach admits can send to a conversation
     * neither reader will name for it."* `433` §B is the ruling that closed it — *a caller may SEE
     * exactly what it may SEND to* — and the assertion this file needs is the SAME pairing pointed
     * the other way: the send and the two readers agree, for this caller, about this target.
     *
     * ⚠️ **The half that did not change is still measured, one test up**: `interrupt_agent` asks
     * for a relationship (commander, or the chain above) and still refuses this exact conversation
     * (`end_agent` went at D-017). ⛔ So the reach widened two READERS and no verb, which is what `430`'s trap
     * was about.
     */
    it('⚑ `list_agents` and `get_agent_status` now name exactly what the send admits', async () => {
      const { brobot, brobotTools, manager } = await aManagerInAnotherProject()
      const listed = (await callOn(brobotTools, 'list_agents', {})) as {
        agents: { agent: string }[]
      }
      // ⚑ **Non-vacuity: the listing names the caller's own conversation too**, which is the row
      // the `me` clause adds and which no grant is needed for.
      expect(listed.agents.map((one) => one.agent).sort()).toEqual([brobot, manager].sort())
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
        agent: { agent: manager },
      })
      // ⛔ …and the send works, which is the whole of what the two readers now promise.
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: manager,
          text: 'x',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'ok' })
    })

    /**
     * 🔴 **What a GIVE actually does, pinned rather than discovered later.**
     *
     * ⛔ **A give FILES A PIECE** in the RECEIVER's ledger. ⚑ **D-016** — it was a declared `work`
     * message that minted a task there, and took the receiver's one work slot; the message kind and
     * the one-open-task rail are gone, and `give_work` is the one verb that hands work over.
     *
     * 🔴 **D-014 · work goes only to a conversation the giver started.** ⚑ **D-016 · by the lookup rather than a
     * rail**: a give names a profile and reaches the giver's own conversation with it, so a give to
     * the manager's profile STARTS BroBot's own `pm` conversation and the manager a person opened
     * holds no piece. ⚠️ A second caller never reaches BroBot's child for the same reason: its give
     * starts a conversation of its own.
     */
    it('🔴 a give files a piece in the RECEIVER’s ledger, and only in a conversation the giver started', async () => {
      const { brobot, brobotTools, manager } = await aManagerInAnotherProject()
      const toTheManagersProfile = await callOn(brobotTools, 'give_work', {
        to: 'new',
        conversation_title: 'the thing',
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'the thing',
        brief: 'do the thing',
      })
      expect(toTheManagersProfile, JSON.stringify(toTheManagersProfile)).toMatchObject({
        outcome: 'ok',
        started: true,
      })
      // ⚑ **It went to a conversation BroBot started, never the one a person opened.**
      expect(toTheManagersProfile.agent).not.toBe(manager)
      expect(store.parentOf(toTheManagersProfile.agent as string)).toBe(brobot)
      expect(workGivenIn(manager)).toHaveLength(0)

      const { child, label } = await aChildOfBroBot(brobotTools)

      // ⛔ **The row, read from the RECEIVER's own ledger.**
      const given = workGivenIn(child)
      expect(given).toHaveLength(1)
      expect(given[0]).toMatchObject({ givenBy: brobot, label })
      // ⚑ **The paired negative, one ledger over**: BroBot's own conversation got no piece row, so
      // the assertion above is about where the work was filed and not about a row existing at all.
      expect(workGivenIn(brobot)).toHaveLength(0)

      // ⚑ **A second caller never reaches the child** — it did not start it, so its give to the
      // same profile starts a conversation of its own.
      await personOpens('explorer')
      const second = await callOn(theToolsetJustHandedOut(), 'give_work', {
        to: 'new',
        conversation_title: 'and this too',
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'and this too',
        brief: 'and this too',
      })
      expect(second, JSON.stringify(second)).toMatchObject({ outcome: 'ok', started: true })
      expect(second.agent).not.toBe(child)
      expect(workGivenIn(child)).toHaveLength(1)
      // ⚑ **One argument over, admitted**: a follow-up on the piece BroBot gave opens nothing — the
      // child's ledger still holds the one piece.
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: child,
          text: 'how is it going?',
          kind: 'follow-up',
          piece: label,
        }),
      ).toMatchObject({ outcome: 'ok' })
      expect(workGivenIn(child)).toHaveLength(1)
    })

    /**
     * ⚠️ **The RETURN leg crosses back** — `reply_to_parent` resolves its destination from the
     * piece's giver and delivers as {@link THE_APP_ITSELF}: refusing a reply would strand the work
     * its own parent asked for.
     */
    it('⚠️ the reply to cross-project work lands back in the giver’s conversation', async () => {
      const { brobot, brobotTools } = await aManagerInAnotherProject()
      // ⚑ **D-016 · the give is the work** — no second message hands it over.
      const { childTools, label } = await aChildOfBroBot(brobotTools)
      const mine = (await callOn(childTools, 'list_tasks', {})) as {
        you_hold: { piece: string; label: string }[]
      }
      expect(mine.you_hold.map((one) => one.label)).toEqual([label])

      const replied = await callOn(childTools, 'reply_to_parent', {
        piece: mine.you_hold[0]?.piece,
        outcome: 'done',
        summary: 'it is finished',
      })
      expect(replied, JSON.stringify(replied)).toMatchObject({ outcome: 'ok' })
      // 🔴 **The words crossed back into the giver's conversation.**
      const heard = store
        .events(brobot)
        .map((one) => one.event)
        .filter((event) => event.type === 'user_turn')
      expect(JSON.stringify(heard)).toContain('it is finished')
    })

    it('accepts a self-message through the public Message action with its sender intact', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const brobotTools = theToolsetJustHandedOut()
      expect(host.withinMessagingReach(brobot, speakingAs(brobot))).toBe(false)
      await expect(host.queueMessage(brobot, 'through host', speakingAs(brobot))).rejects.toThrow(
        /belongs to another window|held for/i,
      )
      expect(
        await callOn(brobotTools, 'message_agent', { agent: brobot, text: 'to myself' }),
      ).toMatchObject({ outcome: 'ok', agent: brobot, receipt: { recipient: { id: brobot } } })
      expect(eventKinds(brobot)).toContain('user_turn')
      expect(eventKinds(brobot)).toContain('message_sent')
    })
  })
})
