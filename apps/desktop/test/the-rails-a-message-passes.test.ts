import { giveANewWorkerItsFirstTask } from './lib/give-fixture'
import { ToolWatchingResumeRuntime as ToolWatchingRuntime } from './lib/provider-double'
import {
  neutralHostDeps,
  RecordingSink,
  syntheticProviderHome,
  fixtureProviderConfig,
} from './lib/host-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
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
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'

/**
 * 🔴 **374 · the rails a message passes.**
 *
 * ⚑ An agent's words reach any existing conversation that is not a service's; no per-agent grant
 * is read. What this file pins is what surrounds that: a commander may always see and stop what it
 * commands, a person's own sends are never asked anything, words a caller queued can be taken
 * back, a relationship read back from the ledger after a restart still admits, and the rules other
 * dispatches own (an interruption is not held, a started conversation runs in its giver's mode, a
 * commander may not answer for a person) still hold.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real rails.** The only double is the provider,
 * subclassed to keep the toolsets the HOST handed out — so an agent's calls go through the toolset
 * this app built for it rather than through an identity the test minted.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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
    const given = await giveANewWorkerItsFirstTask(
      pmTools,
      workerProfile,
      'the work this dispatch is about',
    )
    return { pm, worker: given.agent as string, pmTools }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · what a commander keeps, and a person's own sends
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a commander sees and stops its child, and a person is never asked', () => {
    it('⛔ a parent lists, reads and interrupts its own child', async () => {
      // ⚑ **D-016 · an `auto` PM**, so its worker's brief runs with no card: a child parked on a
      // person's card refuses an interrupt BY THAT CARD first (§9).
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
      // ⛔ **HO-007: *"the human unrestricted."*** A window is not an identity.
      await expect(host.send(pm, 'a person typing', window)).resolves.toBeUndefined()
      // ⚠️ **Which of `QueueOutcome`'s two arms comes back is a race and not the subject** — 077's
      // whole point — so this asserts that it came back at all.
      await expect(host.queueMessage(pm, 'and again', window)).resolves.toBeDefined()
      await expect(host.interrupt(pm, window)).resolves.toBeUndefined()
      await expect(host.sendInterrupting(pm, 'no, this', window)).resolves.toBeUndefined()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · interrupting, sending and taking words back, from the commander
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · a commander interrupts, sends and takes back', () => {
    it('🔴 the parent interrupts and its words are delivered, whatever the retired can_message column holds', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      db.prepare(`UPDATE agent_identity SET can_message = 'none' WHERE slug = 'pm'`).run()
      const by = speakingAs(pm)

      await expect(host.interrupt(worker, by)).resolves.toBeUndefined()
      // `queueMessage` answers whether the child is mid-turn or idle; only a refusal would throw.
      await expect(host.queueMessage(worker, 'when you are free', by)).resolves.toBeDefined()
      await expect(host.sendInterrupting(worker, 'no, this', by)).resolves.toBeUndefined()
    })

    it('⛔ `cancelQueuedMessage` takes back a message the parent queued', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      const by = speakingAs(pm)
      await host.send(worker, 'something long', by)
      const outcome = await host.queueMessage(worker, 'and then this', by)
      expect(outcome.outcome).toBe('queued')
      const held = outcome.outcome === 'queued' ? outcome.messageId : ''
      await expect(host.cancelQueuedMessage(worker, held, by)).resolves.toBeUndefined()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · a REHYDRATED parent — 373's state, which the gate has to work on
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · a relationship that was derived rather than live still admits', () => {
    it('🔴 after a restart the reopened parent reaches its child through its new toolset', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      await restart()
      await reopenInto(worker, secondWindow)
      const toolset = await reopenInto(pm, window)

      // ⛔ **`373`'s state.** The commander was derived from the provenance row, for a parent whose
      // slot is brand new.
      // ⚑ **D-016** — a follow-up names a piece; these words only need to be DELIVERED, so a note.
      expect(
        (
          await callOn(toolset, 'message_agent', {
            agent: worker,
            text: 'carry on',
            kind: 'note',
          })
        ).outcome,
      ).toBe('ok')
    })

    it('🔴 …and it works when the parent itself was never reopened, which the slot could not answer', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      await restart()
      // ⛔ **Only the CHILD comes back.** `373` established that `mayCommand` asks nothing about
      // liveness — a parent that is not open still commands what its row says it spawned — so every
      // fact this door reads comes from the ledger.
      await reopenInto(worker, secondWindow)
      expect(host.agentCard(pm, secondWindow, null)).not.toBeNull()
      await expect(host.queueMessage(worker, 'x', speakingAs(pm))).resolves.toBeDefined()
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
    it('⛔ `354` · an interruption still does not contend with the singleton', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      const by = speakingAs(pm)
      await host.send(worker, 'the first thing', by)
      const queued = await host.queueMessage(worker, 'the one that was waiting', by)
      // ⚑ **HO-007: interruptions are delivered immediately, not held.**
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
        to: 'new',
        conversation_title: 'with no questions',
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

      // ⚑ An `ask` spawner starts the same agent in `ask` — no laxness is handed down that the
      // spawner does not run in.
      await host.createSession(
        { provider: 'claude', profileId: 'pm2', approvalMode: 'ask', cwd: root },
        window,
      )
      const askingTools = theToolsetJustHandedOut()
      const asking = await callOn(askingTools, 'give_work', {
        to: 'new',
        conversation_title: 'with questions',
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

    it('⛔ `340` §2 · a commander still may not answer for a person', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      // 🔴 **HO-005 Q2, untouched.** *"Knowledge escalates, authority does not."* `setApprovalMode`
      // is still `mayControl`'s.
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
  // §6 · the grammar — the compared vocabulary roster
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · the payload a model meets', () => {
    it('⛔ no two rails in the compared roster share a sentence', () => {
      // ⚠️ **One model meets the roster through the same published tools.** Two rules with one
      // sentence is a model that cannot tell them apart, whichever list they live in.
      // `TOOL_SENTENCES` is not exported; `refuseTool` is, and it is the thing that builds the
      // payload, so asking it is asking the shipped answer rather than a copy of the table.
      const sentences = [
        ...SPAWN_RAILS.map((rail) => describeRail(rail)),
        ...TOOL_REFUSALS.map((rail) => refuseTool(rail).reason),
      ]
      expect(new Set(sentences).size).toBe(sentences.length)
      expect(sentences.length).toBe(SPAWN_RAILS.length + TOOL_REFUSALS.length)
      // ⚠️ **A deliberate share of a NAME is exercised as a positive control**: `341`'s door and
      // `347`'s tools both answer `malformed-request`, for the same reason, with different
      // sentences. ⛔ The complete shared-name allowlist belongs to
      // `what-an-agent-is-told-about-its-work.test.ts`.
      const names: string[] = [...SPAWN_RAILS, ...TOOL_REFUSALS]
      expect(names.filter((rail) => rail === 'malformed-request')).toHaveLength(2)
    })
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
})
