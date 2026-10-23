import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, whatTheChildWouldLack } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { CallerIdentity, RuntimeEventSink } from '../src/main/runtime/runtime-host'
import {
  TOOL_REFUSALS,
  agentCallerId,
  refuseTool,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import {
  MESSAGE_RAILS,
  MESSAGING_ACTS,
  type MessagingAct,
  MessagingRefused,
  admitReachAtAll,
  describeMessageRail,
  messagePermanenceOf,
  messageRetryableOf,
  type MessageRail,
} from '../src/main/runtime/message-rails'
import { SPAWN_RAILS, describeRail, permanenceOf } from '../src/main/runtime/spawn-rails'
import { CAPABILITY_FIELDS, MESSAGING_REACH, capabilityField } from '../src/shared/capabilities'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 🔴 **374 · the rails a message passes** — Slice 4 P3, the last rail dispatch before the S-work.
 *
 * ## ⛔ The ticket, and the two halves of it
 *
 * `can_message` was a capability nothing branched on — `341` landed the column and said so out loud,
 * in a test — and `can_interrupt` did not exist at all. HO-007 §2.1: *"`can_message` gets its
 * chokepoint — same-project by default, BroBot global, the human unrestricted — and `can_interrupt`
 * arrives as a capability of its own."*
 *
 * ⚑ **The chokepoint is the five verbs that give a conversation work, and the gate is a SECOND
 * line at four of them rather than a wider `mayCommand`.** ⚠️ **Two of the five ask
 * `requireToMessage` since `431` and three still ask `requireToCommand`**; what that changed is
 * which callers ARRIVE at the gate below, not what it asks them. That predicate also answers
 * `endAgent`, `interruptAgent`, `withdrawTask`, the two answer verbs and the spawn door's
 * `not-your-parent`; narrowing it would make an identity with `can_message: none` stop being able
 * to SEE its own children, which nobody revoked. 340 §5's rule in the other direction — a narrowing
 * is opt-in at the call site too.
 *
 * ⚠️ **`375` added a FIFTH line, at `endAgent`, and the sentence above is still true of it**: the
 * predicate was not narrowed and the line is written at that verb's own call site.
 *
 * 🔴 **`433` moved TWO of the questions that are not verbs — `agentsVisibleTo` and `agentCard` —
 * onto `withinMessagingReach`**, so *"still answer exactly as they did"* is no longer true of them
 * and this paragraph no longer says it. ⛔ **`mayCommand` itself was not touched**: those two now
 * reach it as clause 2 of that reader, which is the same admission with a grant after it.
 *
 * ## ⚠️ Where the readings diverge, which is where every section is written
 *
 *  - **§1** `can_message` allowed vs refused — an identity that may SPAWN but may not MESSAGE. A
 *    test whose identity holds both passes under *"one gate"* and *"two gates"* alike.
 *  - **§2** `can_message` refused while interrupting stays open — D-014 deleted `can_interrupt`,
 *    so a commander may always stop what it commands, and only the words are gated.
 *  - **§3** a live parent vs a **rehydrated** one — `373`'s new state. A test that restarts nothing
 *    passes under both readings.
 *  - **§4** same-project vs any — criterion 6. ⚠️ **D-016 took `same-project` and projects with
 *    it**, so §4 went; the reach vocabulary is `none | any`.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real rails.** The only double is the provider,
 * subclassed to keep the toolsets the HOST handed out — so an agent's calls go through the toolset
 * this app built for it rather than through an identity the test minted.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

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

/** `373`'s double, and its registry is shared for `373`'s reason — see {@link issued}. */
class ToolWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

/**
 * 🔴 **Which capability each act reads, as a table the compiler keeps exhaustive** (439).
 *
 * ⛔ **The two loops below held `act === 'message' ? … : …`**, a literal that meant *the message act
 * and everything else* — and `439` added `read`, a SECOND act on `can_message`. ⚠️ The ternary then
 * handed it `can_interrupt`, so both loops asserted the opposite of what they mean about the one act
 * that was new. ⚑ **A `Record` over {@link MessagingAct} cannot be written for three acts when there
 * are four**: the next act fails to compile until somebody says which column it reads, which is
 * `REACH_OF`'s own argument moved into the tests that walk it.
 *
 * ⚠️ **It is declared once and used at both sites**, because two copies of one table are two things
 * to keep in step — which is the defect this file exists to measure, one subject over.
 */
const READS_THE_MESSAGE_REACH: Record<MessagingAct, 'canMessage' | 'canAssignWork'> = {
  // ⚠️ **D-016 took `read`** (it asked about a project) — two acts now, and the Record still
  // refuses to compile a third that nobody placed.
  message: 'canMessage',
  // 🔴 **553 · a THIRD column, and the boolean this table used to hold could not say so**
  // (HO-060 §2). ⛔ It was `Record<MessagingAct, boolean>` — *reads the message reach, or does
  // not* — and `assign` reads neither of the two it could name. ⚑ **Re-aimed rather than
  // stripped** (standing rule 26): what it pins now is which of THREE columns each act reads, so a
  // fourth act still cannot compile until somebody decides.
  assign: 'canAssignWork',
}

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
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
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
  const reach = (profileId: string, edit: { canMessage?: string }): void => {
    expect(store.setCapabilities(profileId, edit as never)).toBe(true)
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · can_message at the chokepoint — an identity that may SPAWN but may not MESSAGE
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · `can_message` is read at the chokepoint', () => {
    it('🔴 an identity that may spawn but may not message is refused BY NAME, and one fact over it is allowed', async () => {
      const { worker, pmTools } = await aPmAndItsWorker()
      // ⛔ **The divergence.** This identity still holds `can_spawn` and still spawned the child two
      // lines ago — so a test that only checked *"can it reach its own child"* would pass under one
      // gate and under two alike. What differs is one word in one column.
      reach('pm', { canMessage: 'none' })
      const refused = await callOn(pmTools, 'message_agent', {
        // ⚑ **D-016** — a follow-up names a piece; these words only need to be DELIVERED, so a note.
        kind: 'note',
        agent: worker,
        text: 'do the thing',
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('may-not-message')
      // ⚑ **A refusal is a SUCCESSFUL call whose payload names the rule** — 341's shape, carried
      // over the tool boundary unchanged, permanence and all.
      expect(refused.permanence).toBe('until-a-person-changes-it')
      expect(refused.retryable).toBe(false)
      expect(String(refused.reason)).toMatch(/not allowed to send/i)

      // ⚑ **The same call, one fact over.** Nothing else moved: same parent, same child, same words.
      reach('pm', { canMessage: 'any' })
      const allowed = await callOn(pmTools, 'message_agent', {
        kind: 'note',
        agent: worker,
        text: 'do the thing',
      })
      expect(allowed.outcome, JSON.stringify(allowed)).toBe('ok')
    })

    it('⛔ it did NOT stop seeing its child, and that is what a wider `mayCommand` would have cost', async () => {
      // ⚑ **D-016 · an `auto` PM**, so its worker's brief runs with no card: a child parked on a
      // person's card refuses an interrupt BY THAT CARD first (§9), which is not the grant measured.
      const { worker, pmTools } = await aPmAndItsWorker('pm', 'worker', 'auto')
      reach('pm', { canMessage: 'none' })
      // 🔴 **The narrowing is opt-in at each call site and nowhere else.** Had it gone into
      // `mayCommand`, all three of these would have flipped with it — an identity a person revoked
      // MESSAGING from would have lost sight of its own workers and the ability to stop them.
      // ⚠️ **D-014 · no grant stands in front of the third line at all**: interrupting reaches the
      // chain below the caller, so `can_message: none` still leaves this parent able to interrupt its
      // worker. ⚑ **D-017** — it was `end_agent`, which is gone; `interrupt_agent` is the verb left.
      const listed = await callOn(pmTools, 'list_agents', {})
      expect((listed.agents as { agent: string }[]).map((card) => card.agent)).toContain(worker)
      expect((await callOn(pmTools, 'get_agent_status', { agent: worker })).outcome).toBe('ok')
      expect(
        (await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'done' })).outcome,
      ).toBe('ok')
    })

    it('🔴 a PERSON is never asked the question — the same session, the same words, the same moment', async () => {
      const pm = await personOpens('pm')
      reach('pm', { canMessage: 'none' })
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

    it('⛔ a speaker this app cannot place is refused rather than given the ruled default', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      const by = speakingAs(pm)
      // ⚑ **The paired positive FIRST, so the refusal below is about the one fact that changes.**
      await expect(host.queueMessage(worker, 'hello', by)).resolves.toBeDefined()

      // ⛔ **A conversation with no `agent_identity_id`** — `identityOf`'s own documented state, the
      // one swept out of the user's own `~/.claude` and *"attributed to no agent of ours on
      // purpose"*. ⚠️ It still commands the child: `commandedBy` is a string comparison and 373
      // established it asks nothing else. So this is a caller the gate must answer for, and the only
      // honest answer is no — falling back to `DEFAULT_CAPABILITIES` would hand a conversation this
      // app cannot place the ruled `same-project`, which is a grant nobody made. `unknown-profile`'s
      // direction, one door over.
      // ⚑ **The binding is kept, so the paired positive below can put it back** — the one fact
      // that differs between the two halves is whether this app can find the caller's identity.
      const binding = (
        db.prepare('SELECT agent_identity_id AS id FROM provider_session WHERE id = ?').get(pm) as {
          id: string | null
        }
      ).id
      // ⚠️ **The premise, asserted**: the caller WAS placed, so the NULL below is the one change.
      expect(binding).not.toBeNull()
      db.prepare('UPDATE provider_session SET agent_identity_id = NULL WHERE id = ?').run(pm)
      expect(store.identityOf(pm)).toBeNull()
      await expect(host.queueMessage(worker, 'hello', by)).rejects.toThrow(/not allowed to send/i)

      // 🔴 **…and the payload states NOTHING about a grant, because none was read.** ⚠️ `reach:
      // 'none'` here would be a column value nobody looked at: a model relaying it would tell a
      // person their sheet says `none`, and the sheet would say `same-project`. 340's finding — a
      // reason answering with another reason's sentence — in a payload field.
      const refusedWith = async (): Promise<MessagingRefused> => {
        try {
          await host.queueMessage(worker, 'hello', by)
        } catch (error) {
          if (error instanceof MessagingRefused) return error
          throw error
        }
        throw new Error('that call was not refused')
      }
      const unplaceable = await refusedWith()
      expect(unplaceable.refusal.rail).toBe('may-not-message')
      expect(unplaceable.refusal.detail.reach).toBeUndefined()

      // ⚑ **The paired positive, so the absence above is THIS state and not every refusal**: put the
      // binding back, set the column to `none`, and the same rail now says which value refused it.
      db.prepare('UPDATE provider_session SET agent_identity_id = ? WHERE id = ?').run(binding, pm)
      reach('pm', { canMessage: 'none' })
      const chosen = await refusedWith()
      expect(chosen.refusal.rail).toBe('may-not-message')
      expect(chosen.refusal.detail.reach).toBe('none')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · can_message refused, and interrupting still open — D-014 deleted can_interrupt
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · one capability, one gate — interrupting asks none', () => {
    it('🔴 may NOT message and still stops what it commands: the interrupt goes, the queue is refused', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      reach('pm', { canMessage: 'none' })
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
      reach('pm', { canMessage: 'none' })
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
    it('🔴 after a restart the reopened parent is refused BY THIS RAIL, and one fact over it is allowed', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      reach('pm', { canMessage: 'none' })
      await restart()
      await reopenInto(worker, secondWindow)
      const toolset = await reopenInto(pm, window)

      // ⛔ **`373`'s state and this dispatch's rail, in one call.** The commander was derived from
      // the provenance row; the capability is looked up for a parent whose slot is brand new. A gate
      // that read the speaker's profile off the old slot would have had nothing to read.
      // ⚑ **D-016** — a follow-up names a piece; these words only need to be DELIVERED, so a note.
      const refused = await callOn(toolset, 'message_agent', {
        agent: worker,
        text: 'carry on',
        kind: 'note',
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('may-not-message')

      reach('pm', { canMessage: 'any' })
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
      // liveness — a parent that is not open still commands what its row says it spawned — and a
      // capability looked up from `this.slots` would have quietly closed that door, because there is
      // no slot for `pm` at all. ⚑ Every fact this gate reads comes from the ledger for that reason.
      await reopenInto(worker, secondWindow)
      expect(host.agentCard(pm, secondWindow, null)).toBeNull()

      const by = speakingAs(pm)
      reach('pm', { canMessage: 'none' })
      await expect(host.queueMessage(worker, 'x', by)).rejects.toThrow(/not allowed to send/i)
      // ⚑ **The paired positive on the state that matters**: the grant, and nothing else, is what
      // decides. Without it this test would be satisfied by a gate that refuses every dead parent.
      reach('pm', { canMessage: 'any' })
      await expect(host.queueMessage(worker, 'x', by)).resolves.toBeDefined()
    })

    it('⚠️ the same pair BEFORE the restart gives the same two answers — so the restart is the only variable', async () => {
      // ⛔ **The control `373` paid for.** Both readings agree here; if this pair were the whole
      // section, a gate that could not survive a restart would still pass it.
      const { pm, worker } = await aPmAndItsWorker()
      const by = speakingAs(pm)
      reach('pm', { canMessage: 'none' })
      await expect(host.queueMessage(worker, 'x', by)).rejects.toThrow(/not allowed to send/i)
      reach('pm', { canMessage: 'any' })
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
      reach('pm', { canMessage: 'any' })
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
      reach('pm2', { canMessage: 'any' })
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
      reach('pm', { canMessage: 'any' })
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
  const capsFor = (canMessage: string, canAssignWork = 'any') =>
    ({
      maxDepth: 2,
      canMessage,
      canAssignWork,
    }) as never
  /**
   * ⛔ **553 · `assign` had its own door**, because its composite asked *did this caller start it*.
   * ⚑ **D-016** — `give_work` asks `assign` of the caller alone, through {@link admitReachAtAll},
   * because work goes only to the giver's own conversation by construction; so every act reads its
   * grant through the one door.
   */
  const admitAct = (act: MessagingAct, allowed: never) => admitReachAtAll(act, allowed)

  describe('§6 · the payload a model meets', () => {
    it('⛔ every rail has one permanence, and `retryable` is DERIVED from it', () => {
      for (const rail of MESSAGE_RAILS) {
        expect(messageRetryableOf(rail)).toBe(messagePermanenceOf(rail) === 'while-this-holds')
      }
      // 🔴 **ONE permanence, and `486` is why** (HO-031 §2.5). ⛔ It read *"both named permanences
      // are used, and each is honest for its remedy"* — and the four `-outside-your-project` rails
      // were `permanent` while the four `may-not-` rails were not, from ONE column. ⚠️
      // `admitMessaging` reached an `-outside-` rail only when a person had set that column to
      // `same-project`, so widening it to `any` made the IDENTICAL call succeed — which is what
      // `permanent` denies. ⚑ **D-016 took those rails with `same-project`.** ⚑ **The table is now
      // uniform because the wall is**: every rail here is a grant only a person can widen.
      // 🔴 **D-014 gave it ONE exception, and D-016 took it**: work went only to a conversation the
      // caller started, a `permanent` rail no person could widen. ⚑ The give's lookup makes that
      // true by construction now, so no rail says it and nothing here is `permanent`.
      expect(new Set(MESSAGE_RAILS.map(messagePermanenceOf))).toEqual(
        new Set(['until-a-person-changes-it']),
      )
      expect(MESSAGE_RAILS.filter((rail) => messagePermanenceOf(rail) === 'permanent')).toEqual([])
      // ⛔ Nothing here is retryable, and that is asserted rather than left to be read off the table.
      expect(MESSAGE_RAILS.some(messageRetryableOf)).toBe(false)
    })

    it('⛔ every sentence reads as one, names no session id, no column and no rail slug', () => {
      for (const rail of MESSAGE_RAILS) {
        const sentence = describeMessageRail(rail)
        expect(sentence.length, rail).toBeGreaterThan(40)
        expect(sentence.trim().endsWith('.'), rail).toBe(true)
        expect(sentence).not.toContain('sess_')
        // ⚑ **A refusal INSTRUCTS; it does not DESCRIBE** (HO-015 §2). A sentence naming the column
        // it was refused by is a sentence about how the system works, and it drifts when the system
        // does — which is exactly what happened to eight of `370`'s.
        for (const field of CAPABILITY_FIELDS) {
          expect(sentence, `${rail} names ${field.key}`).not.toContain(field.key)
          expect(sentence, `${rail} names ${field.column}`).not.toContain(field.column)
        }
        expect(sentence.toLowerCase(), rail).not.toContain(rail)
      }
    })

    it('⛔ no two rails in the compared roster share a sentence', () => {
      // ⚠️ **One model meets the roster through the same published tools.** Two rules with one sentence is
      // a model that cannot tell them apart, whichever list they live in.
      // ⚠️ **Every list named below is included, including the one that matters most** (found reviewing
      // this diff — the title said *ANYWHERE* while its roster was incomplete). `MessagingRefused` and
      // `agent-cannot-take-a-message` are classified in the SAME catch block of `message_agent`, so
      // those are the two sentences one model has to tell apart in one payload stream.
      // `TOOL_SENTENCES` is not exported; `refuseTool` is, and it is the thing that builds the
      // payload, so asking it is asking the shipped answer rather than a copy of the table.
      const sentences = [
        ...MESSAGE_RAILS.map((rail) => describeMessageRail(rail)),
        ...SPAWN_RAILS.map((rail) => describeRail(rail)),
        ...TOOL_REFUSALS.map((rail) => refuseTool(rail).reason),
      ]
      expect(new Set(sentences).size).toBe(sentences.length)
      expect(sentences.length).toBe(
        MESSAGE_RAILS.length + SPAWN_RAILS.length + TOOL_REFUSALS.length,
      )
      // ⛔ **…and no NAME 374 added collides with one that already existed**, so a payload's `rail`
      // field says which rule stopped the call whichever door built it.
      const older: string[] = [...SPAWN_RAILS, ...TOOL_REFUSALS]
      for (const rail of MESSAGE_RAILS) expect(older, rail).not.toContain(rail)
      expect(new Set(MESSAGE_RAILS).size).toBe(MESSAGE_RAILS.length)
      // ⚠️ **A deliberate share in the older lists is exercised as a positive control**: `341`'s
      // door and `347`'s tools both answer `malformed-request`, for the same reason, with different
      // sentences. ⛔ The complete shared-name allowlist belongs to
      // `what-an-agent-is-told-about-its-work.test.ts`; this assertion proves only that the local
      // comparison did not accidentally assume the older lists were disjoint.
      expect(older.filter((rail) => rail === 'malformed-request')).toHaveLength(2)
    })

    it('🔴 every rail in the vocabulary is REACHED by the door, and each by an actual refusal', () => {
      // ⛔ **`341`'s twin rule, and `366` is where it cost something**: a vocabulary that lists a
      // rule the door no longer applies is a committed statement of a false machine fact. ⚠️ The
      // spawn door's version greps for `no('<rail>'`; this door dispatches through one table keyed
      // by the act, so the census is over THAT table — the site that decides which member fires.
      const code = readFileSync(join(mainRoot, 'runtime/message-rails.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
      expect(code).toContain('export function admitReachAtAll')
      for (const rail of MESSAGE_RAILS) {
        expect(code, `${rail} is in the vocabulary and nothing dispatches to it`).toContain(
          `'${rail}'`,
        )
      }
      // ⚑ **The control**: a member that exists only inside a comment must fail the same sweep, so
      // the strip is doing the work rather than a `toContain` a docblock would satisfy.
      const planted = `/** a rail nothing dispatches to: 'may-not-broadcast' */`
      expect(code + planted).toContain(`'may-not-broadcast'`)
      expect((code + planted).replace(/\/\*[\s\S]*?\*\//g, ' ')).not.toContain(
        `'may-not-broadcast'`,
      )
      // ⛔ **…and the behavioural half, which the source census cannot give**: every member of the
      // vocabulary is produced by a call somewhere in this file. `refuseMessage` builds the whole
      // payload from the rail, so reaching one here is the same thing the host reaches.
      const reached = new Set<MessageRail>()
      // ⛔ **`MESSAGING_ACTS` and not a literal** (375). This loop held `['message', 'interrupt']`
      // when there were two acts, so the day a third arrived it would have swept the same four rails
      // and reported the two new ones as *"in the vocabulary and nothing dispatches to them"* — a
      // census weaker than it reads, which is exactly the defect it exists to catch. The list is
      // exported now and `RAILS_OF` is a `Record` over it, so neither can gain a member alone.
      // ⚑ **D-016 · the relationship half `assign` pressed is gone** — work goes only to the giver's
      // own conversation by construction — so each act is pressed at each word of its own grant.
      // ⚠️ D-016 also took the `same-project` row between them, with the rails it reached.
      for (const act of MESSAGING_ACTS) {
        for (const word of MESSAGING_REACH) {
          const outcome = admitAct(
            act,
            READS_THE_MESSAGE_REACH[act] === 'canMessage'
              ? capsFor(word, 'any')
              : capsFor('any', word),
          )
          if (outcome !== null) reached.add(outcome.rail)
        }
      }
      expect([...reached].sort()).toEqual([...MESSAGE_RAILS].sort())
    })

    it('⚑ the vocabulary is the schema’s, so a grant and a rail cannot come to disagree', () => {
      // ⛔ Both columns offer exactly the words the rails branch on — one list, two fields.
      // ⚑ **`capabilityField` and not a `find`**: the descriptor's type narrows on the key, so
      // `vocabulary` is a field of THIS capability rather than a maybe-property of the union — which
      // is the compile-time half of what makes the assertion below about the right thing.
      for (const key of ['canMessage', 'canAssignWork'] as const) {
        expect(capabilityField(key).vocabulary, key).toEqual([...MESSAGING_REACH])
      }
      expect(MESSAGING_REACH).toEqual(['none', 'any'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §8 · HO-008 §3, collected on — the fifth capability cost no surface
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§8 · a capability reaches the surface with no surface change', () => {
    it('⛔ the sheet names a capability only in the exact dormant-field filter', () => {
      // 🔴 **HO-008 §3, and this is the collection.** *"Build it to enumerate the capability schema
      // rather than hardcode a field list. Then `can_interrupt` appears when P3 lands **without a
      // second pass** — and P0b can run in parallel with P1–P3 instead of queueing behind them."*
      //
      // ⚠️ **A green DOM test proves it DRAWS; it cannot prove nothing was edited to make it draw.**
      // `capabilities-sheet.dom.test.ts` does the first half against the real schema; this is the
      // second: rendering still cannot name a field. Only the explicit dormant-field filter
      // below is allowed to do so.
      // ⛔ **Prose-stripped, and the file is a `.vue`, so BOTH comment grammars go** — `/* */` and
      // `//` in the script block, `<!-- -->` in the template. ⚠️ The sheet's docblocks discuss
      // `can_spawn` and `maxConcurrent` at length, and a census that counted those would report a
      // component that hardcodes every field it in fact never mentions.
      const sheet = readFileSync(
        join(here, '../src/renderer/src/components/CapabilitiesSheet.vue'),
        'utf8',
      )
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
      const hiddenRulesFilter = "props.fields.filter((field) => field.key !== 'canWriteRules')"
      expect(sheet.split(hiddenRulesFilter)).toHaveLength(2)
      const genericSheet = sheet.replace(hiddenRulesFilter, 'props.fields')
      for (const field of CAPABILITY_FIELDS) {
        expect(genericSheet, `${field.key} is spelled outside the dormant filter`).not.toContain(field.key)
        expect(sheet, `${field.column} is spelled in the sheet`).not.toContain(field.column)
      }
      // ⛔ **Non-vacuity, twice.** The file was really read, and the loop really swept five fields —
      // a renamed or emptied schema would make the sweep pass over nothing.
      expect(sheet).toContain('field.editor')
      expect(sheet.length).toBeGreaterThan(2000)
      // ⚑ **The control FIRES, and the first version of it did not** (found reviewing this diff):
      // it asserted `not.toContain` — the same direction as the subject — and so demonstrated only
      // that a docblock is removed, never that a real occurrence survives the strip and is found.
      // ⛔ Both halves are here now: code is kept, prose is not.
      const asCode = `${sheet}\nconst canMessage = 1`
      const asProse = `${sheet}\n/** a comment naming canMessage */`
      const strip = (text: string): string =>
        text
          .replace(/<!--[\s\S]*?-->/g, ' ')
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/^\s*\/\/.*$/gm, ' ')
      expect(strip(asCode)).toContain('canMessage')
      expect(strip(asProse)).not.toContain('canMessage')
      // ⚑ **D-014 · `canInterrupt` is gone; `canAssignWork` (553) arrived the same way** — a field the
      // sheet never names, drawn off the schema.
      expect(CAPABILITY_FIELDS.map((field) => field.key)).toContain('canAssignWork')
      expect(CAPABILITY_FIELDS.length).toBeGreaterThanOrEqual(5)
    })

    it('⛔ …and the tool layer still cannot say either capability’s name', () => {
      // ⚑ `347`'s census auto-extended to this dispatch's field the moment the field existed, which
      // is what deriving it bought. ⚠️ Asserted here too, in the dispatch that could have broken it:
      // the classifier `message_agent` gained carries a RAIL name and never a column.
      const tools = readFileSync(join(mainRoot, 'runtime/agent-tools.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
      for (const field of CAPABILITY_FIELDS) {
        expect(tools, field.key).not.toContain(field.key)
        expect(tools, field.column).not.toContain(field.column)
      }
      // ⚑ …and it does carry the refusal, so the sweep above is not passing over a file that stopped
      // knowing about messaging at all.
      expect(tools).toContain('MessagingRefused')
      expect(tools).toContain('carryMessageRefusal')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §9 · the interrupt verbs an agent holds — 395 REVERSED the first half of this section
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§9 · the interrupt rails now have the tool that trips them', () => {
    it('🔴 an agent tool reaches `interrupt` and NOT `sendInterrupting` — 395 flipped 374’s pin', () => {
      // 🔴 **This is the flip `374` asked for, in the commit it asked for it in.**
      //
      // ⛔ **What stood here, verbatim:** *"no agent tool reaches `interrupt` or `sendInterrupting`
      // — 341's ordering, one dispatch on"*, asserting `expect(surface).not.toContain('interrupt')`,
      // under: *"Pinned, because the alternative is a capability a person can set that quietly does
      // nothing… ⛔ The day S5 hands an agent one of these verbs this assertion turns red, and the
      // sentence in the sheet's help text that says so has to come out in the same commit."*
      //
      // ⚑ **Both happened here**: `interrupt_agent` is published, and
      // `capabilities.ts`'s *"Interrupting is not a tool any agent has yet; ending is."* came out
      // in this diff. The assertion below is what keeps the pair honest in the other direction.
      //
      // 🔴 **`sendInterrupting` is STILL not on the surface, and that half is not an oversight.**
      // It composes an interruption with a send — `RuntimeHost.sendInterrupting` asks
      // `assertMayReach` for `message` (D-014: the interrupt half asks no grant) — and an agent that wants
      // both already has both verbs and can choose the order. ⛔ A composed verb would be a THIRD
      // answer to *"what happens when the target is busy"* published to a model that already has
      // two, and `354`'s singleton is what it would have to disagree with.
      const tools = readFileSync(join(mainRoot, 'runtime/agent-tools.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
      const surface = tools.slice(
        tools.indexOf('export interface AgentToolHost'),
        tools.indexOf('}', tools.indexOf('export interface AgentToolHost')),
      )
      // ⚑ **The slice really is the surface** — it names the verbs an agent CAN reach.
      expect(surface).toContain('queueMessage')
      // ⚑ **D-016** — the verb that starts a child is the give.
      expect(surface).toContain('giveWork')
      // 🔴 …and one interrupting verb is now on it.
      expect(surface).toContain('interruptAgent')
      expect(tools).toContain('host.interruptAgent')
      // ⛔ **The OTHER one still is not**, and neither is the raw host verb that throws.
      expect(surface).not.toContain('sendInterrupting')
      expect(tools).not.toContain('host.sendInterrupting')
      // ⚠️ **`host.interrupt(` with the paren, so `host.interruptAgent` does not satisfy it.** The
      // agent-facing door is the one that ANSWERS; the raw one refuses by throwing, which reaches a
      // model as a transport error rather than as a rule.
      expect(tools).not.toContain('host.interrupt(')
      // ⚑ **The control**: the verbs it DOES call are found by the same search.
      expect(tools).toContain('host.queueMessage')
      expect(tools).toContain('host.giveWork')
    })

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

    it('⛔ `none` refuses, and `any` allows', () => {
      expect(admitReachAtAll('message', caps('none', 'any'))?.rail).toBe('may-not-message')
      expect(admitReachAtAll('message', caps('any', 'none'))).toBeNull()
    })

    it('⛔ an identity with no capabilities at all is refused, never defaulted', () => {
      expect(admitReachAtAll('message', null)?.rail).toBe('may-not-message')
    })

    it('⚑ every reading of every act is covered, and no act reads a column it was not given', () => {
      // ⚑ **D-014 · the destructive acts left this table with `can_interrupt`**, so what is measured
      // is that sending reads `can_message` and giving work reads its own column.
      // ⛔ **A comparison tested where both readings agree measures nothing**, so this walks the
      // whole product: each act, each word, with the OTHER capability set to the value that would
      // give the opposite answer if the gates were sharing a field.
      for (const act of MESSAGING_ACTS) {
        for (const word of MESSAGING_REACH) {
          const other = word === 'none' ? 'any' : 'none'
          const allowed =
            READS_THE_MESSAGE_REACH[act] === 'canMessage' ? caps(word, other) : caps(other, word)
          const outcome = admitAct(act, allowed)
          expect(outcome === null, `${act} · ${word}`).toBe(word !== 'none')
        }
      }
    })
  })
})
