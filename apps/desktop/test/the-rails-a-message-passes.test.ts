import { ToolWatchingResumeRuntime as ToolWatchingRuntime } from './lib/provider-double'
import {
  neutralHostDeps,
  RecordingSink,
  syntheticProviderHome,
  fixtureProviderConfig,
} from './lib/host-fixture'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, whatTheChildWouldLack } from '@brobot2/runtime'
import type { AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { CallerIdentity } from '../src/main/runtime/runtime-host'
import {
  TOOL_REFUSALS,
  agentCallerId,
  refuseTool,
  type ToolName,
} from '../src/main/runtime/agent-tools'

import { SPAWN_RAILS, describeRail, permanenceOf } from '../src/main/runtime/spawn-rails'
import { CAPABILITY_FIELDS, capabilityField } from '../src/shared/capabilities'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

/** `373`'s double, and its registry is shared for `373`'s reason — see {@link issued}. */

describe('374 · the rails a message passes', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  /**
   * ⚠️ **One registry for every runtime this suite builds** (`373`). `createRuntime` is called once
   * per launch, so a runtime holding its own would forget every ref the next launch asked for and a
   * restart would fail as *"never issued by this provider"* — a state of the double, not of the app.
   */
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let secondWindow: RecordingSink
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-messaging-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-messaging-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    secondWindow = new RecordingSink('webContents:2')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    cwd = root,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd },
      window,
    )
    return sessionId
  }

  /** An identity exists only once a person has run a conversation as it — 341 criterion 12. */
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

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const restart = async (): Promise<void> => {
    await host.closeAll()
    host = buildHost()
  }

  /** What an agent's own calls look like from outside the toolset — `agent:<its session>`. */
  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  /**
   * `373`'s helper: a PM in a window with one child of its own, started through the real door.
   * ⚑ **D-016** — a child is started by `give_work` when the PM has no conversation with that agent,
   * and the brief is the child's first turn. ⚠️ **A child runs in its giver's mode**: under an `ask`
   * PM the brief's turn parks on the card it raises; under an `auto` PM it runs to its end.
   */
  const aPmAndItsWorker = async (
    pmProfile = 'pm',
    workerProfile = 'worker',
    pmMode: 'ask' | 'auto' = 'ask',
  ): Promise<{ pm: string; worker: string; pmTools: AgentToolset }> => {
    await bringIdentityIntoBeing(workerProfile)
    const pm = await personOpens(pmProfile, root, pmMode)
    const pmTools = theToolsetJustHandedOut()
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'the work this dispatch is about',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.started, JSON.stringify(given)).toBe(true)
    return { pm, worker: given.agent as string, pmTools }
  }

  /** One capability, changed and nothing else — the *"one fact over"* half of every pair below. */

  describe('§1 · `can_message` is read at the chokepoint', () => {

    it('⛔ it did NOT stop seeing its child, and that is what a wider `mayCommand` would have cost', async () => {
      // ⚑ **D-016 · an `auto` PM**, so its worker's brief runs with no card: a child parked on a
      // person's card refuses an interrupt BY THAT CARD first (§9), which is not the grant measured.
      const { worker, pmTools } = await aPmAndItsWorker('pm', 'worker', 'auto')

      const listed = await callOn(pmTools, 'list_agents', {})
      expect((listed.agents as { agent: string }[]).map((card) => card.agent)).toContain(worker)
      expect((await callOn(pmTools, 'get_agent_status', { agent: worker })).outcome).toBe('ok')
      expect(
        (await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'done' })).outcome,
      ).toBe('ok')
    })

    it('🔴 a PERSON is never asked the question — the same session, the same words, the same moment', async () => {
      const pm = await personOpens('pm')

      // ⛔ **HO-007: *"the human unrestricted."*** The gate decodes the caller first, and a window
      // is not an identity — so there is no capability to look up rather than an exemption to grant.
      // ⚠️ This is the paired positive for every refusal in this file: the refusals below are about
      // WHO is asking, and this is the proof that they are.
      await expect(host.send(pm, 'a person typing', window)).resolves.toBeUndefined()
      // ⚠️ **Which of `QueueOutcome`'s two arms comes back is a race and not the subject** — 077's
      // whole point — so this asserts what this dispatch could have broken: that it came back at all.
      await expect(host.queueMessage(pm, 'and again', window)).resolves.toBeDefined()
      await expect(host.interrupt(pm, window)).resolves.toBeUndefined()
      await expect(host.sendInterrupting(pm, 'no, this', window)).resolves.toBeUndefined()
    })

  })

  describe('§2 · one capability, one gate — interrupting asks none', () => {
    it('🔴 may NOT message and still stops what it commands: the interrupt goes, the queue is refused', async () => {
      const { pm, worker } = await aPmAndItsWorker()

      const by = speakingAs(pm)

      // ⛔ **D-014 · what a caller commands it may always stop**, so the one grant left in front of
      // these verbs is the one that delivers WORDS — and a caller refused it still interrupts.
      await expect(host.interrupt(worker, by)).resolves.toBeUndefined()
      await expect(host.queueMessage(worker, 'when you are free', by)).rejects.toThrow(
        /not allowed to send/i,
      )
      await expect(host.send(worker, 'now', by)).rejects.toThrow(/not allowed to send/i)
      await expect(host.sendInterrupting(worker, 'no, this', by)).rejects.toThrow(
        /not allowed to send/i,
      )
    })

    it('⛔ `cancelQueuedMessage` is deliberately NOT gated, and the revocation cannot strand a message', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      const by = speakingAs(pm)
      // A message the parent put there while it was allowed to.
      await host.send(worker, 'something long', by)
      const outcome = await host.queueMessage(worker, 'and then this', by)
      expect(outcome.outcome).toBe('queued')
      const held = outcome.outcome === 'queued' ? outcome.messageId : ''

      // 🔴 **A person narrows the grant while the message is still held.** Taking words back is not
      // a new act against the conversation, and the fifth commanding verb is deliberately outside
      // this dispatch's gate — a caller that could no longer withdraw what it had already put there
      // would be worse off than one that had never been allowed to put it.

      await expect(host.cancelQueuedMessage(worker, held, by)).resolves.toBeUndefined()
      // ⚑ …and the pair: a second message is still refused, so the grant really did narrow.
      await expect(host.queueMessage(worker, 'one more', by)).rejects.toThrow(
        /not allowed to send/i,
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · a REHYDRATED parent — 373's state, which the gate has to work on
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the rail holds on a relationship that was derived rather than live', () => {

    it('🔴 …and it works when the parent itself was never reopened, which the slot could not answer', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      await restart()
      // ⛔ **Only the CHILD comes back.** `373` established that `mayCommand` asks nothing about
      // liveness — a parent that is not open still commands what its row says it spawned — and a
      // capability looked up from `this.slots` would have quietly closed that door, because there is
      // no slot for `pm` at all. ⚑ Every fact this gate reads comes from the ledger for that reason.
      await reopenInto(worker, secondWindow)
      expect(host.agentCard(pm, secondWindow, null)).toBeNull()

      const by = speakingAs(pm)

      await expect(host.queueMessage(worker, 'x', by)).rejects.toThrow(/not allowed to send/i)
      // ⚑ **The paired positive on the state that matters**: the grant, and nothing else, is what
      // decides. Without it this test would be satisfied by a gate that refuses every dead parent.

      await expect(host.queueMessage(worker, 'x', by)).resolves.toBeDefined()
    })

    it('⚠️ the same pair BEFORE the restart gives the same two answers — so the restart is the only variable', async () => {
      // ⛔ **The control `373` paid for.** Both readings agree here; if this pair were the whole
      // section, a gate that could not survive a restart would still pass it.
      const { pm, worker } = await aPmAndItsWorker()
      const by = speakingAs(pm)

      await expect(host.queueMessage(worker, 'x', by)).rejects.toThrow(/not allowed to send/i)

      await expect(host.queueMessage(worker, 'x', by)).resolves.toBeDefined()
    })
  })

  const reopenInto = async (sessionId: string, sink: RecordingSink): Promise<AgentToolset> => {
    await host.resumeSession(sessionId, sink)
    return theToolsetJustHandedOut()
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · what must keep working
  // ───────────────────────────────────────────────────────────────────────────────────────────

  // ⚑ `726` · R92 deleted `371`'s row here — *the cwd bound is still the parent’s, whatever the
  // messaging grant says*. The bound it paired against the grant (`cwd-outside-parent`) is gone:
  // a spawn may start in any folder that exists. The other rows' rules still stand.
  describe('§5 · the rules 341, 354 and 366 already own', () => {
    it('⛔ `354` · an interruption still does not contend with the singleton, WITH the new gate above it', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      const by = speakingAs(pm)
      await host.send(worker, 'the first thing', by)
      const queued = await host.queueMessage(worker, 'the one that was waiting', by)
      // ⚑ **HO-007: interruptions are delivered immediately, not held.** The gate is a second
      // question in front of the same verb; it must not have turned a delivery into a queue.
      await expect(host.sendInterrupting(worker, 'no, do THIS', by)).resolves.toBeUndefined()
      expect(queued.outcome === 'queued' || queued.outcome === 'sent').toBe(true)
    })

    it('⛔ `499` · a spawned conversation still cannot be given more than its spawner has', async () => {
      // ⚑ **D-016** — a give names no mode: the conversation it starts runs in the giver's, on the
      // agent's own provider. 🔴 **D-038 moved this fact (F050)**: the one start that was refused
      // here — a Claude `auto` giver starting an agent that runs on Codex, where `auto` also takes
      // the sandbox off — is GIVEN now, because the rail compares reach, and Codex `auto` reaches no
      // further past its folder than Claude `auto`. ⚠️ So no give meets the rail at all (D-038 F-B),
      // and what this pins is that the start takes the spawner's mode and no more.
      await bringIdentityIntoBeing('worker2')
      expect(store.setAgentProvider('worker2', 'codex')).toBe(true)
      await host.createSession(
        { provider: 'claude', profileId: 'pm', approvalMode: 'auto', cwd: root },
        window,
      )
      const pmTools = theToolsetJustHandedOut()

      const given = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker2',
        title: 'with no questions',
        brief: 'with no questions',
      })
      expect(given, JSON.stringify(given)).toMatchObject({
        outcome: 'ok',
        started: true,
        delivery: 'sent',
      })
      expect(store.find(given.agent as string)).toMatchObject({
        approvalMode: 'auto',
        provider: 'codex',
      })

      // 🔴 **The widest messaging grant this app can give buys nothing at the give's start.**
      // Two vocabularies, two doors. ⚑ An `ask` spawner holding the same grant starts the same
      // agent in `ask` — the grant hands down no laxness the spawner does not run in.
      await host.createSession(
        { provider: 'claude', profileId: 'pm2', approvalMode: 'ask', cwd: root },
        window,
      )
      const askingTools = theToolsetJustHandedOut()

      const asking = await callOn(askingTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker2',
        title: 'with questions',
        brief: 'with questions',
      })
      expect(asking.outcome, JSON.stringify(asking)).toBe('ok')
      expect(store.find(asking.agent as string)?.approvalMode).toBe('ask')
      // ⛔ **…and WIDER is still refused, where it can be: that `ask` spawner's child in `auto`.**
      // No give reaches it, so the rail's own comparison is asked. ⛔ **`499` moved both the name
      // and the word**: HO-036 withdrew `spawn-must-prompt`, and its successor is
      // `until-a-person-changes-it` because the parent's own approvals button is the switch `366`
      // said did not exist.
      expect(
        whatTheChildWouldLack(
          { provider: 'codex', approvalMode: 'auto' },
          { provider: 'claude', approvalMode: 'ask' },
        ),
      ).toEqual(['the-card-before-an-act'])
      expect(permanenceOf('wider-than-its-parent')).toBe('until-a-person-changes-it')
    })

    it('⛔ `340` §2 · a commander granted everything still may not answer for a person', async () => {
      const { pm, worker } = await aPmAndItsWorker()

      // 🔴 **HO-005 Q2, untouched.** *"Knowledge escalates, authority does not."* The widest grant
      // this dispatch can give is about giving a conversation WORK; nothing about it decides what
      // that work is allowed to do, and `setApprovalMode` is still `mayControl`'s.
      // ⚠️ **421 changed the SENTENCE and not the rail.** A spawned worker is owned by nobody, so
      // *"another window"* was never true of it; the refusal now says so and names the take-over.
      // ⛔ Matched on the clause that carries the rule — this conversation is not the caller's to
      // decide for — rather than on the whole string, which is `session-unavailable.test.ts`'s to pin.
      // ⚑ **D-017 · F024** — the clause says where it is; it said *"nobody is watching it"*, a
      // process fact. ⚑ **D-017b** reworded it to *no window holds this conversation*.
      await expect(host.setApprovalMode(worker, 'auto', speakingAs(pm))).rejects.toThrow(
        /no window holds this conversation/i,
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · the grammar — one shape, the compared vocabulary roster
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The capability pair — hoisted so §6 and §7 measure the same shapes. ⚠️ **D-016 took the two
   * projects that stood beside it**: the pure doors take no parties now.
   *
   * ⚠️ **553 · the second column DEFAULTS to the ruled word.** ⛔ Every assertion in this file that
   * does not name it is about a different act, so the value is inert there. ⚑ Since D-016 the
   * ruled word is also the widest (`same-project` went); the two loops that walk
   * {@link MESSAGING_ACTS} pass both explicitly.
   */
  describe('§6 · the payload a model meets', () => {

  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §9 · the interrupt verbs an agent holds — 395 REVERSED the first half of this section
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§9 · the interrupt rails now have the tool that trips them', () => {
    it('🔴 …and `interrupt_agent` of a child parked on a person’s card is refused BY THAT CARD, first', async () => {
      // 🔴 **D-014 · `375`'s floor is gone** — `can_interrupt`, `may-not-end` and the project
      // boundary beside it were deleted, and interrupting reaches the chain below the caller with no
      // grant. ⚠️ **So the refusal a parent meets first is the target's own state**: this child is
      // parked on a person's card, and `INTERRUPT_RAILS` refuses an agent that would answer it for
      // them (HO-034 §1). ⚑ **D-017** — this was `end_agent`'s door and `END_RAILS`, both gone.
      const { pm, worker, pmTools } = await aPmAndItsWorker()
      await host.send(worker, 'a long piece of work', speakingAs(pm))
      // ⚠️ **496 · waited for rather than assumed.** `send` resolves before the turn has moved, and
      // this test depends on the child's state — an unwaited read would be flaky in exactly the
      // direction that reads as *"there was no card"*.
      for (let attempt = 0; attempt < 400; attempt++) {
        const card = (await callOn(pmTools, 'get_agent_status', { agent: worker })).agent
        // ⚑ **D-017 · R11** — the one derivation's words: *needs you*.
        if ((card as { state: string }).state === 'needs you') break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const refused = await callOn(pmTools, 'interrupt_agent', {
        agent: worker,
        reason: 'never mind',
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('a-person-is-being-asked')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · the door itself, as a pure function — every reading, including the unreachable ones
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · `admitReachAtAll`, at each reading', () => {
    const caps = capsFor

  })
})
