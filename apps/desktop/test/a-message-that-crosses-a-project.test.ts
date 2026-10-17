import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { CallerIdentity, RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 🔴 **431 · the message that crosses a project** — HO-024 §4 row 6, owed since Slice 4, and
 * HO-022 §3's other half.
 *
 * ## ⚑ D-016 · there is no project left to cross
 *
 * ⛔ **`D-016` took projects out** — the rooms, `create_project`, project placement, the
 * `same-project` reach and every `-outside-your-project` rail. ⚠️ **The cases that were about the
 * project boundary went with it** (§1's *same project, allowed* and *foreign target* rows, and §3's
 * project-rail pair); every other pair's narrow half is `none` now. ⚑ **What stays is the message
 * reach with no project in it**: `any` admits a conversation its holder did not start, `none` admits
 * nothing, the verbs that cut into a conversation still ask for a relationship, work goes only to a
 * conversation you started, a reply asks no grant, and a caller this app cannot place reaches
 * nothing. ⚠️ Where the history below says *another project*, read *a conversation a person
 * opened*.
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
 * ⚠️ **§2's last two tests DO edit the database, and they say so in their own docblocks.** They are
 * about the two absences the predicate refuses — a conversation with no `agent_identity_id`, and a
 * placed one whose `agent_identity` row cannot be read — and no product door produces either. ⛔ A
 * clause that refuses a state the product cannot reach is still a clause, and a safety sentence with
 * no test is a comment.
 *
 * 🔴 **The widening is one word at TWO call sites, and the pair is the rule rather than a second
 * exception.** `RuntimeHost.send` and `RuntimeHost.queueMessage` ask `requireToMessage`; they are
 * the two spellings of one act and the only two whose single capability question is `'message'`, and
 * `queueMessage` delegates to `send` on the idle path, so a gate at one of them alone refuses the
 * caller the other just admitted. ⛔ `sendInterrupting`, `cancelQueuedMessage` and `interrupt` still
 * ask `requireToCommand`, and §2 is as much of this dispatch as §1: a reach that also ended,
 * interrupted or enumerated would be the trap `430` named, *"widening `mayCommand` globally would
 * also widen other commands"*.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real IPC boundary.** The only double is the
 * provider.
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

/** Keeps the toolsets the HOST handed out, so an agent's calls go through the real one. */
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
}

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
  const reach = (
    profileSlug: string,
    edit: { canMessage?: string; canAssignWork?: string },
  ): void => {
    expect(store.setCapabilities(profileSlug, edit as never)).toBe(true)
  }

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

  describe('§1 · the four cases, and not one hand-written binding', () => {
    /**
     * 🔴 **The criterion, both halves, one target, one call, one column apart.**
     *
     * ⛔ **The same conversation, the same words, two callers** — so what
     * differs is the identity and, with it, the grant. ⚠️ **The test three below isolates the grant
     * ALONE**, by moving one column on one identity and asking again; this one is the pair a
     * reader meets first, and the two together are what make `can_message` mean something at the
     * message door for the first time.
     */
    it('🔴 BroBot reaches a manager a person opened, and a `none` identity does not', async () => {
      const { brobot, brobotTools, manager } = await aManagerInAnotherProject()

      // ⚑ **The capability** — HO-022 §3, held here as the ruled default.
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canMessage).toBe('any')
      const reached = await callOn(brobotTools, 'message_agent', {
        agent: manager,
        text: 'what is this project up to?',
        kind: 'note',
      })
      expect(reached, JSON.stringify(reached)).toMatchObject({ outcome: 'ok', agent: manager })
      // ⛔ **And the words really landed in the manager's conversation**, which is the half a
      // refusal-shaped assertion could never prove.
      expect(eventKinds(manager)).toContain('user_turn')

      // 🔴 **The rail** — a second identity, narrowed to `none`.
      const other = await personOpens('explorer')
      const otherTools = theToolsetJustHandedOut()
      // 🔴 **549 · the unentitled caller is one a PERSON narrowed** (HO-058 §1) — the ruled
      // default is `any`, so an identity left alone reaches everything. ⚑ **D-016 · narrowed to
      // `none`**, the one narrower word left now `same-project` is gone; the pair is still one
      // column, one word apart.
      reach('explorer', { canMessage: 'none' })
      expect(store.capabilitiesOf('explorer')?.canMessage).toBe('none')
      const refused = await callOn(otherTools, 'message_agent', {
        agent: manager,
        text: 'what is this project up to?',
        kind: 'note',
      })
      // ⚑ **D-017 · R12 — the reach rail, not `no-such-agent`**: that word is said only about an id
      // no conversation has, and this one exists — so the answer is the boundary itself, which a
      // person can move (`05` rule 6).
      expect(refused, JSON.stringify(refused)).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-message',
        permanence: 'until-a-person-changes-it',
        retryable: false,
      })
      // ⚠️ **Nothing was delivered by the refused call**, and the count is what says so: the one
      // turn above is still the only one.
      expect(eventKinds(manager).filter((kind) => kind === 'user_turn')).toHaveLength(1)
      expect(brobot).not.toBe(other)
    })

    // ⚑ **D-016 · Row 1 (*same project, allowed*) went with projects** — its pair was the
    // `same-project` reach, and the positive half is the first half of the test above.

    // ⚑ **D-016 · Row 4 (*a foreign target, two callers*) went with `same-project`.** It measured
    // that a caller whose grant admitted the VERB but not the target was told the boundary about a
    // real id and `no-such-agent` about a ghost. ⛔ With `none` and `any` left, no grant admits the
    // verb and refuses a target: `none` meets the standing wall before any id is read (486 — the
    // same word for every id, which discloses nothing; the narrowed-identity test below), and `any`
    // admits every conversation there is.

    /**
     * 🔴 **A person's decision is what moves it, in both directions** — HO-016 §2's rule at the one
     * door this dispatch opened. ⛔ The app never re-grants; a narrowing takes the reach away, and
     * granting it to somebody else hands it over.
     */
    it('🔴 the reach follows the grant, not the identity — narrowed it refuses, granted it admits', async () => {
      const { brobotTools, manager } = await aManagerInAnotherProject()
      // ⚠️ **Every call below is a NOTE** — ⚑ D-016: a message hands no work over, and a note names
      // no piece — so the only thing that can refuse the second, third and fourth is the gate this
      // test is about.
      const asking = { agent: manager, text: 'how is it going?', kind: 'note' }
      reach(DEFAULT_PROFILE_ID, { canMessage: 'none' })
      // ⚑ **D-017 · R12** — the reach rail for a conversation that exists, not `no-such-agent`.
      expect(await callOn(brobotTools, 'message_agent', asking)).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-message',
      })
      reach(DEFAULT_PROFILE_ID, { canMessage: 'any' })
      expect(await callOn(brobotTools, 'message_agent', asking)).toMatchObject({ outcome: 'ok' })

      // ⛔ **And it is not about BEING BroBot.** The same word granted to an ordinary identity
      // reaches the same conversation — so the gate reads a column and never a slug.
      await personOpens('explorer')
      const otherTools = theToolsetJustHandedOut()
      // 🔴 **549 · the unentitled caller is one a PERSON narrowed** (HO-058 §1) — the ruled
      // default is `any`, so an identity left alone reaches everything. ⚑ **D-016 · narrowed to
      // `none`**, the one narrower word left now `same-project` is gone; the pair is still one
      // column, one word apart.
      reach('explorer', { canMessage: 'none' })
      expect(await callOn(otherTools, 'message_agent', asking)).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-message',
      })
      reach('explorer', { canMessage: 'any' })
      expect(await callOn(otherTools, 'message_agent', asking)).toMatchObject({ outcome: 'ok' })
    })

    /**
     * 🔴 **The entitlement is asked BEFORE the capability, and the two refusals are about two
     * different things** — `refuse-on-entitlement-before-refusing-on-existence`, at the message
     * door.
     *
     * ⛔ **`none` reaches nothing it did not start, so a conversation elsewhere is `no-such-agent`
     * and NOT `may-not-message`** — and that is the non-leak rather than a lost sentence: a rail
     * naming the caller's own grant would tell it the id was real. ⚑ **The capability sentence is
     * still exactly where it always was**: over a conversation this identity DID start, which is
     * the set `374`'s rails were built to narrow, and the second half here is what says so.
     */
    it('🔴 a narrowed identity is told two different things, and which one depends on what it started', async () => {
      const { brobotTools, manager } = await aManagerInAnotherProject()
      const asking = { agent: manager, text: 'how is it going?', kind: 'note' }
      expect(await callOn(brobotTools, 'message_agent', asking)).toMatchObject({ outcome: 'ok' })

      // ⛔ **Its own child, through the give door** — the one conversation `mayCommand` admits.
      // ⚑ **D-016 · `give_work` where `spawn_agent` was**: it starts BroBot's one conversation with
      // that agent, and no message grant is asked for it.
      const { child } = await aChildOfBroBot(brobotTools)

      reach(DEFAULT_PROFILE_ID, { canMessage: 'none' })
      // 🔴 **`486` collapsed these two answers into ONE, and that is `341`'s own ordering arriving
      // here** (HO-031 §2.5). ⛔ **This asserted `no-such-agent · permanent` for the conversation
      // elsewhere and `may-not-message · until-a-person-changes-it` for its own child** — a policy
      // wall sitting BEHIND an existence answer, which is *entitlement before existence* read
      // backwards. ⚠️ A caller a person has granted no reach at all was told *this call can never
      // succeed* about a conversation that becomes reachable the moment somebody widens a column.
      //
      // ⚑ **So the messaging door now asks the grant first, and both arms answer the same word** —
      // which discloses nothing, because it is the same word for every id including one that names
      // nothing.
      for (const args of [asking, { agent: child, text: 'do the thing' }]) {
        const refused = await callOn(brobotTools, 'message_agent', args)
        expect(refused, JSON.stringify(refused)).toMatchObject({
          outcome: 'refused',
          rail: 'may-not-message',
          permanence: 'until-a-person-changes-it',
        })
      }
      // 🔴 **`431`'s own property is UNCHANGED and is measured here rather than assumed**: a caller
      // may SEE exactly what it may SEND to, and the reader is where that shows. ⛔ Its own child is
      // still named. ⚑ **D-017 · R12** — the conversation elsewhere no longer folds to
      // `no-such-agent`: the reader answers it with the refusal the send door gives, at every door.
      expect((await callOn(brobotTools, 'get_agent_status', { agent: child })).outcome).toBe('ok')
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-message',
      })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the widening is opt-in at ONE call site — 430's trap, pressed
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · what the reach did NOT widen', () => {
    /**
     * ⛔ **The trap `430` named, measured where the two readings diverge.**
     *
     * ⚠️ **`can_message` is at its widest HERE deliberately.** `interruptAgent` reads no grant at
     * all (D-014): it admits the conversation's commander and the chain above it, in any project.
     * ⛔ **So the refusal below can only be that relationship** — the manager a person opened has
     * nothing above it — and the day somebody lets the message reach widen a verb that cuts into a
     * conversation, this test goes red. ⚑ **D-017** — `end_agent` is gone (nothing ends a
     * conversation), and the refusal is `not-below-you`, since `no-such-agent` is said only about
     * an id no conversation has.
     */
    it('⛔ `interrupt_agent` still refuses it, with the message reach at its widest', async () => {
      const { brobotTools, manager } = await aManagerInAnotherProject()
      reach(DEFAULT_PROFILE_ID, { canMessage: 'any' })
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
      reach(DEFAULT_PROFILE_ID, { canMessage: 'any' })
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
     * 🔴 **D-014 · work goes only to a conversation the giver started** — the ruled
     * `can_assign_work: 'any'` widens nothing past that. ⚑ **D-016 · by the lookup rather than a
     * rail**: a give names a profile and reaches the giver's own conversation with it, so a give to
     * the manager's profile STARTS BroBot's own `pm` conversation and the manager a person opened
     * holds no piece. ⚠️ A second caller never reaches BroBot's child for the same reason: its give
     * starts a conversation of its own.
     */
    it('🔴 a give files a piece in the RECEIVER’s ledger, and only in a conversation the giver started', async () => {
      const { brobot, brobotTools, manager } = await aManagerInAnotherProject()
      // ⛔ **The premise, asserted before the act** — the ruled default, and the widest word.
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canAssignWork).toBe('any')
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
      expect(store.capabilitiesOf('explorer')?.canAssignWork).toBe('any')
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

    /**
     * ⚠️ **The RETURN leg crosses back, and it asks no capability at all** — measured here because
     * `431` is what made it reachable across a project.
     *
     * ⛔ **`reply_to_parent` resolves its destination from the piece's giver and delivers as
     * {@link THE_APP_ITSELF}**, which passes the entitlement unconditionally and is never asked a
     * grant (`sessionSpeakingAs` answers `null` for the app). ⚑ **That is `393`'s design and not a
     * hole this dispatch opened**: refusing a reply would strand the work its own parent asked for.
     * ⚠️ **The replier's own `can_message` is not consulted even when a person set it to `none`**
     * (D-016: the parent is no longer in another project, and the property never needed it to be).
     * 🔴 **Asserted rather than left to be re-found.**
     */
    it('⚠️ the reply to cross-project work lands back, from an identity granted no reach at all', async () => {
      const { brobot, brobotTools } = await aManagerInAnotherProject()
      // ⚑ **D-016 · the give is the work** — no second message hands it over.
      const { childTools, label } = await aChildOfBroBot(brobotTools)
      const mine = (await callOn(childTools, 'list_tasks', {})) as {
        you_hold: { piece: string; label: string }[]
      }
      expect(mine.you_hold.map((one) => one.label)).toEqual([label])

      // ⛔ **A person has granted this identity NOTHING**, and the reply still goes out.
      reach('worker', { canMessage: 'none' })
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
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canMessage).toBe('any')
      expect(host.withinMessagingReach(brobot, speakingAs(brobot))).toBe(false)
      // ⛔ **The sentence, not merely a throw.** `rejects.toThrow()` with no matcher accepts a type
      // error from a renamed method as readily as the refusal, which is a green test over a broken
      // door.
      await expect(host.queueMessage(brobot, 'to myself', speakingAs(brobot))).rejects.toThrow(
        /belongs to another window|held for/i,
      )
      // ⚑ **One fact over**: the same predicate admits it when the DOOR supplies `me`, which is how
      // `424`'s `that-agent-is-you` is reached instead of `no-such-agent`.
      expect(host.withinMessagingReach(brobot, speakingAs(brobot), brobot)).toBe(true)
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
    it('⛔ a caller with no identity row reaches nothing, and the same call from a placed one does', async () => {
      const { brobot, manager } = await aManagerInAnotherProject()
      expect(host.withinMessagingReach(manager, speakingAs(brobot))).toBe(true)
      // ⛔ **The user's own home row** — `agent_identity_id` is null, which `identityOf` documents as
      // the conversation swept out of `~/.claude` and attributed to no identity of ours.
      db.prepare('UPDATE provider_session SET agent_identity_id = NULL WHERE id = ?').run(brobot)
      expect(store.identityOf(brobot)).toBeNull()
      expect(host.withinMessagingReach(manager, speakingAs(brobot))).toBe(false)
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
    it('⛔ a placed caller whose IDENTITY row cannot be read is refused, not given the defaults', async () => {
      const { brobot, manager } = await aManagerInAnotherProject()
      // ⚑ **The paired positive, first**: with the row readable, this caller reaches the manager.
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canMessage).toBe('any')
      expect(host.withinMessagingReach(manager, speakingAs(brobot))).toBe(true)

      db.prepare(
        `UPDATE agent_identity SET slug = 'no-such-identity'
           WHERE id = (SELECT agent_identity_id FROM provider_session WHERE id = ?)`,
      ).run(brobot)
      // ⚠️ **The premise, asserted**: the conversation is still placed, so what changed is only
      // whether a grant can be looked up for it.
      expect(store.identityOf(brobot)?.profileSlug).toBe('no-such-identity')
      expect(store.capabilitiesOf('no-such-identity')).toBeNull()
      expect(host.withinMessagingReach(manager, speakingAs(brobot))).toBe(false)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the opt-in, as source
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the opt-in, as source', () => {
    // ⚑ **D-016 · the project-rail pair went** — *"the only reach that crosses a project is the one
    // that never compares projects"* measured `same-project` against `any` at `admitMessaging`, and
    // both the word and the rail are gone. ⛔ What `any` admits and `none` refuses is §1.

    /**
     * ⛔ **The opt-in, as source** — one verb asks the wider question and its four siblings do not.
     * ⚠️ A behaviour test can show that `interrupt_agent` refuses today; only this can show that the
     * NEXT verb gets the strict question by writing the name every other verb writes.
     */
    it('⛔ the two send verbs and the move press ask `requireToMessage`, and the readers ask it too since `433`', () => {
      const code = withoutProse(readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8'))
      // The definition, two send verbs, and the move press before and after its waits.
      expect(code.match(/requireToMessage\(/g)).toHaveLength(5)
      expect(code.match(/this\.requireToMessage\(offer\.destination, by\)/g)).toHaveLength(2)
      // ⚠️ **681 · `queueMessage`'s call carries a third argument now** — the walls it asks inside the
      // gate, before *not started* (R30b) — so the spelling ends at the caller either way.
      expect(code.match(/this\.requireToMessage\(sessionId, by[,)]/g)).toHaveLength(2)
      // ⛔ **The siblings, still strict** — `sendInterrupting`, `cancelQueuedMessage`, `interrupt`
      // and `replyToParent`'s own resolution, which is what keeps *"a way to cut into a conversation
      // in another project"* out of this dispatch.
      expect(code.match(/this\.requireToCommand\(/g)).toHaveLength(4)
      // 🔴 **The two readers were `mayCommand`'s and are the REACH's since `433`.** ⛔ **These two
      // lines are still pinned verbatim and that is deliberate here**: this file's subject is the
      // GATE, and the cheapest statement of *the readers moved* is the two lines that moved.
      // ⚠️ **The durable question — how many call sites the strict predicate has and which methods
      // they sit in — is `a-reach-you-can-see.test.ts` §3's census**, which also computes the
      // question count; it is named rather than copied so the two files cannot come to two answers.
      expect(code).toContain('.filter((slot) => this.withinMessagingReach(slot.id, by, me))')
      expect(code).toContain('if (!this.withinMessagingReach(sessionId, by, me)) return null')
      // ⚠️ **The stripper has teeth, and this is the control that says so**: the file's PROSE
      // names this gate more often than its code does, so a census that counted comments would have
      // reported a different app. ⛔ Written as a comparison rather than as a pinned sentence —
      // `a-source-census-that-pins-a-line-kills-every-row-on-it`, and a docblock is prose that
      // moves.
      const raw = readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8')
      expect(raw.match(/requireToMessage/g)?.length ?? 0).toBeGreaterThan(
        code.match(/requireToMessage/g)?.length ?? 0,
      )
    })
  })
})

/** Line and block comments removed — `send-refusals.test.ts`'s stripper, for its reason. */
function withoutProse(source: string): string {
  let inBlock = false
  return source
    .split('\n')
    .map((raw) => {
      let code = ''
      for (let at = 0; at < raw.length; at += 1) {
        const rest = raw.slice(at)
        if (inBlock) {
          if (!rest.startsWith('*/')) continue
          at += 1
          inBlock = false
          continue
        }
        if (rest.startsWith('//')) break
        if (rest.startsWith('/*')) {
          inBlock = true
          at += 1
          continue
        }
        code += raw[at]
      }
      return code
    })
    .join('\n')
}
