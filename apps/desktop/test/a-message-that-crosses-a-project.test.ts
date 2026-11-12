import { ToolWatchingRuntime } from './lib/provider-double'
import {
  fixtureProviderConfig,
  neutralHostDeps,
  RecordingSink,
  syntheticProviderHome,
} from './lib/host-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { CallerIdentity } from '../src/main/runtime/runtime-host'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** Keeps the toolsets the HOST handed out, so an agent's calls go through the real one. */
describe('431 · the message that crosses a project', () => {
  let userData: string
  let root: string
  let elsewhere: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
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
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-crossing-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-crossing-root-'))
    elsewhere = mkdtempSync(join(tmpdir(), 'brobot2-crossing-elsewhere-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    // ⛔ **Past `0013`'s own wall clock** — `a-second-project-and-the-grant.test.ts` argues why.
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root, elsewhere]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⛔ Through the real boundary, so nothing here reaches a host method a window cannot. */
  const ask = (command: Parameters<typeof executeRuntimeCommand>[2]): Promise<unknown> =>
    executeRuntimeCommand(host, window, command)

  /** `423`'s *New conversation as …* — a person opens a conversation as an identity. */
  const personOpens = async (profileId: string): Promise<string> => {
    const opened = (await ask({
      kind: 'createSession',
      provider: 'claude',
      profileId,
      approvalMode: 'ask',
      cwd: root,
    })) as { sessionId: string }
    return opened.sessionId
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  /** What an agent's own calls look like from outside the toolset — `agent:<its session>`. */
  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  const eventKinds = (sessionId: string): string[] =>
    store.events(sessionId).map((one) => one.event.type)

  /** One capability, changed and nothing else — the *"one grant over"* half of every pair below. */

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
    // ⛔ **And the entitlement really is absent** — the premise the whole file rests on.
    //
    // 🔴 **`433` RE-POINTED this line and did not delete it.** It read
    // `expect(host.agentCard(…)).toBeNull()`, with *"the card reader cannot see it, which is
    // `mayCommand` answering no"* beside it — and since `433` the card reader asks the REACH
    // instead, on the ruling *a caller may SEE exactly what it may SEND to*. ⚠️ **The premise is
    // unchanged and only its instrument moved**: nothing here makes BroBot command that
    // conversation or puts it in the chain above it, so the doors that ask for a relationship
    // refuse it.
    //
    // ⛔ **`interruptAgent` is the instrument because it is PURE when it refuses** — it answers
    // `no-such-agent` before reaching anything, and if the premise ever broke this fixture would
    // stop being a fixture, loudly, rather than silently interrupting a conversation.
    // ⚑ **D-016 · the parent alone** — nothing started the manager, so nothing is above it.
    expect(store.parentOf(manager)).toBeNull()
    expect((await host.interruptAgent(manager, speakingAs(brobot))).ok).toBe(false)
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

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the widening is opt-in at ONE call site — 430's trap, pressed
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · what the reach did NOT widen', () => {
    it('⛔ `interrupt_agent` still refuses it, with the message reach at its widest', async () => {
      const { brobotTools, manager } = await aManagerInAnotherProject()

      // ⚑ **The positive control, first**: the message door admits this exact conversation.
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: manager,
          text: 'x',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'ok' })
      expect(
        await callOn(brobotTools, 'interrupt_agent', { agent: manager, reason: 'stop' }),
      ).toMatchObject({ outcome: 'refused', rail: 'not-below-you' })
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

    it('🔴 a give files a piece in the RECEIVER’s ledger, and only in a conversation the giver started', async () => {
      const { brobot, brobotTools, manager } = await aManagerInAnotherProject()
      // ⛔ **The premise, asserted before the act** — the ruled default, and the widest word.
      const toTheManagersProfile = await callOn(brobotTools, 'give_work', {
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

      // ⚑ **A second caller, holding the widest word, never reaches the child** — it did not start
      // it, so its give to the same profile starts a conversation of its own.
      await personOpens('explorer')
      const second = await callOn(theToolsetJustHandedOut(), 'give_work', {
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

    it('⚠️ the reply to cross-project work lands back, from an identity granted no reach at all', async () => {
      const { brobot, brobotTools } = await aManagerInAnotherProject()
      // ⚑ **D-016 · the give is the work** — no second message hands it over.
      const { childTools, label } = await aChildOfBroBot(brobotTools)
      const mine = (await callOn(childTools, 'list_tasks', {})) as {
        you_hold: { piece: string; label: string }[]
      }
      expect(mine.you_hold.map((one) => one.label)).toEqual([label])

      // ⛔ **A person has granted this identity NOTHING**, and the reply still goes out.

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

    /**
     * ⛔ **A conversation cannot reach ITSELF through the grant**, and the host is where that is
     * closed. ⚠️ The tool answers `that-agent-is-you` one line after the reach admits `me`; the
     * gate has no `me`, so the clause has to be in the predicate rather than in the door.
     */
    it('⛔ the widest reach does not let a conversation queue words into itself', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const brobotTools = theToolsetJustHandedOut()
      expect(host.withinMessagingReach(brobot)).toBe(true)
      // ⛔ **The sentence, not merely a throw.** `rejects.toThrow()` with no matcher accepts a type
      // error from a renamed method as readily as the refusal, which is a green test over a broken
      // door.
      await expect(host.queueMessage(brobot, 'to myself', speakingAs(brobot))).rejects.toThrow(
        /belongs to another window|held for/i,
      )
      // ⚑ **One fact over**: the same predicate admits it when the DOOR supplies `me`, which is how
      // `424`'s `that-agent-is-you` is reached instead of `no-such-agent`.
      expect(host.withinMessagingReach(brobot)).toBe(true)
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: brobot,
          text: 'to myself',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'that-agent-is-you' })
      // ⚑ **Non-vacuity first**: this ledger is not empty, so the absence below is about the turn
      // and not about a reader that found nothing.
      expect(eventKinds(brobot).length).toBeGreaterThan(0)
      expect(eventKinds(brobot)).not.toContain('user_turn')
    })

    /**
     * ⚠️ **An identity this app cannot place is refused rather than defaulted** — `admitMessaging`'s
     * own direction, and `unknown-profile`'s one door over. ⛔ Handing the ruled grant to a caller
     * with no row is the widening the whole capability system exists to refuse.
     */
    it('⛔ messaging reach does not depend on an identity row', async () => {
      const { brobot, manager } = await aManagerInAnotherProject()
      expect(host.withinMessagingReach(manager)).toBe(true)
      // ⛔ **The user's own home row** — `agent_identity_id` is null, which `identityOf` documents as
      // the conversation swept out of `~/.claude` and attributed to no identity of ours.
      db.prepare('UPDATE provider_session SET agent_identity_id = NULL WHERE id = ?').run(brobot)
      expect(store.identityOf(brobot)).toBeNull()
      expect(host.withinMessagingReach(manager)).toBe(true)
    })

    /**
     * ⚠️ **The OTHER absence, and it is a different row** — the conversation is placed, so
     * `identityOf` answers, and the identity that answer names has no `agent_identity` row for a
     * grant to be read from. ⛔ **Falling back to the ruled defaults there is the widening
     * `unknown-profile` exists to refuse one door over**, and until this test that clause had no
     * assertion on it at all.
     *
     * ⛔ **Constructed, and named as constructed**: the identity's slug is moved off the name its
     * `aid:` row id is derived from, so the lookup by that name misses it. No product door produces that state today — it is an upgrade that dropped a
     * row, or an adopted session pointing at one — which is exactly why the clause is there and why
     * a test has to build it. `374` §4's honesty, one clause over.
     */
    it('⛔ messaging reach does not depend on a readable capability record', async () => {
      const { brobot, manager } = await aManagerInAnotherProject()
      // ⚑ **The paired positive, first**: with the row readable, this caller reaches the manager.
      expect(host.withinMessagingReach(manager)).toBe(true)

      db.prepare(
        `UPDATE agent_identity SET slug = 'no-such-identity'
           WHERE id = (SELECT agent_identity_id FROM provider_session WHERE id = ?)`,
      ).run(brobot)
      // ⚠️ **The premise, asserted**: the conversation is still placed, so what changed is only
      // whether a grant can be looked up for it.
      expect(store.identityOf(brobot)?.profileSlug).toBe('no-such-identity')
      expect(store.capabilitiesOf('no-such-identity')).toBeNull()
      expect(host.withinMessagingReach(manager)).toBe(true)
    })
  })
})
