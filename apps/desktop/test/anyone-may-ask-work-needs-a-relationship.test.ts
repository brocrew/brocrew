import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, parametersOf } from '@brobot2/runtime'
import type { AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { admitReachAtAll } from '../src/main/runtime/message-rails'
import {
  ASSIGNMENT_REACH_ADMITS,
  capabilityField,
  DEFAULT_CAPABILITIES,
} from '../src/shared/capabilities'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { AGENT_MESSAGE_KINDS, TASK_IS_OPEN } from '../src/shared/tasks'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * # 🔴 553 · anyone may ask; work needs a relationship
 *
 * **Two PO rulings, and the first one narrows what `549` shipped three hours earlier.**
 *
 * > ⚑ **HO-060 §2:** *Anyone may ask anyone. Assigning work requires a relationship.*
 * > ⛔ **§2.2, the property rather than the mechanism:** *You spawned it, or a person granted you
 * > the right.*
 * >
 * > ⚑ **HO-060 §3:** *`kind` defaulting to `work` means a model that simply sends a message
 * > assigns work. That is backwards wherever it happens, including between a parent and its own
 * > child.*
 *
 * ⚑ **D-014 kept §2.2's first arm and nothing else**: work goes only to a conversation the giver
 * started, and no grant admits one it did not start. `can_assign_work` says whether that reaches —
 * `any`, the ruled default; `none` nowhere. ⚠️ **D-016** took `same-project` and the project half
 * of the composite with it.
 *
 * ## ⚑ D-016 · work is GIVEN, by profile, and a message never carries it
 *
 * ⛔ **The `work` kind of message is gone**, and with it the rail that refused one to a conversation
 * the caller did not start (`assign-work-to-one-you-did-not-start`) and `admitAssignment`. ⚑ Work is
 * handed out with `give_work`, which names an AGENT, not a conversation: it goes to the giver's one
 * conversation with that agent, started for it the first time. **So the relationship is how the
 * give finds its conversation** — a conversation a person opened is never one a give reaches — and
 * the grant (`can_assign_work`) is the give's whole wall, asked by `admitReachAtAll('assign', …)`.
 * A message is a note or a follow-up on a piece the sender gave.
 *
 * ## ⛔ Why a GIVE and two strangers are in the fixture
 *
 * ⚠️ **A test that exercised only the admitted pair would pass under a gate that admitted
 * everything.** ⛔ So the fixture below plants two conversations a person opened, which this caller
 * did not start, and a child this caller started — and every section asks the same question of
 * each, which is `a-comparison-tested-where-both-sides-agree-measures-nothing`.
 *
 * ## ⚑ What fails on `main` at `b688a9b2`, and it is every section
 *
 * ⛔ **§1** — there is no `can_assign_work` column, so a `work` message to a conversation the
 * caller did not start is ADMITTED by `can_message: 'any'` and mints a task. ⛔ **§3** — the omitted `kind` defaulted to
 * `'work'` there, so it opened one. ⚑ Since D-010 there is no default: an omitted kind is refused,
 * and since D-016 no kind of message gives work at all.
 *
 * ## ⚠️ What this file does NOT measure, and where it is measured instead
 *
 * ⛔ **The provider asymmetry behind §3's choice** — the MCP SDK's parse-and-throw against Codex's
 * unparsed hand-off — is `538` §3.3's measurement and is not re-derived here; what §3 asserts is
 * the CHOICE that measurement decided, which is that the argument stayed optional.
 * ⛔ **The exhaustive act and rail tables** are `the-rails-a-message-passes.test.ts` and
 * `a-floor-under-the-most-destructive-verb.test.ts` §7, which `553` re-aimed rather than copied.
 */

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

/** ⚑ **A `FakeRuntime` that keeps the toolset it was launched with** — `431`'s device. */
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

describe('553 · anyone may ask; work needs a relationship', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-553-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-553-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    // ⛔ **Past `0013`'s own wall clock** — `a-second-project-and-the-grant.test.ts` argues why.
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    issued = new FakeProviderSessions()
    host = new RuntimeHost({
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
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⛔ Through the real boundary, so nothing here reaches a host method a window cannot. */
  const ask = (command: Parameters<typeof executeRuntimeCommand>[2]): Promise<unknown> =>
    executeRuntimeCommand(host, window, command)

  /** `423`'s *New conversation as …* — a person opens a conversation. */
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

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** One capability, changed and nothing else — the *"one grant over"* half of every pair below. */
  const reach = (profileSlug: string, edit: Record<string, unknown>): void => {
    expect(store.setCapabilities(profileSlug, edit as never)).toBe(true)
  }

  /**
   * ⛔ **The RAW column, not `capabilitiesOf`** — a NULL column is *nobody has chosen*, and it is
   * what makes a refusal below a fact about the ruled DEFAULT rather than about a grant this test
   * wrote.
   */
  const rawColumn = (slug: string, column: string): unknown =>
    (
      db.prepare(`SELECT ${column} AS held FROM agent_identity WHERE slug = ?`).get(slug) as
        { held: unknown } | undefined
    )?.held

  /**
   * 🔴 **The fixture — one caller, and TWO receivers it stands in two different relations to.**
   *
   * ⛔ **`boss` is the caller under test.** It STARTED `child`, by giving it a piece (D-016); it has
   * no relation of any kind to `stranger` or `peer`, which a person opened. ⚑ **So the admitted
   * pair and the refused pair are present in one fixture**, and a gate that admitted everything and
   * one that admitted nothing are told apart by the same test.
   *
   * ⚠️ **Every premise is ASSERTED before anything is admitted or refused**: the parent edge exists
   * on one pair and is absent on the others, and every capability column the ruling touches is
   * NULL — *nobody has chosen* — on the caller's row.
   */
  const aBossItsChildAndAStranger = async (): Promise<{
    boss: string
    bossTools: AgentToolset
    child: string
    label: string
    peer: string
    stranger: string
  }> => {
    const stranger = await personOpens('scribe')
    // ⚑ **A third receiver the caller did not start** — the reading `431` reported and did not
    // ship: *every conversation in your project, whoever started it*. ⚠️ Since D-016 there is no
    // project, and it stays as a second conversation the caller did not start.
    const peer = await personOpens('archivist')
    // ⛔ **An identity exists when a conversation has actually run as it** (criterion 12), so the
    // name a give will use is brought into being by a person before it can be given to —
    // `admitGive` refuses `no-such-profile` otherwise, which is a rail about names and not about
    // this ruling.
    await personOpens('hand')
    const boss = await personOpens('lead')
    const bossTools = theToolsetJustHandedOut()
    const given = await callOn(bossTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'hand',
      title: 'the work',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const child = given.agent as string

    // ⚠️ **The premises.** ⛔ One parent edge, no parent edge — and the two capability columns this
    // ruling reads are both NULL on the caller, so every verdict below is the ruled default
    // answering and not a grant this fixture wrote.
    expect(store.parentOf(child)).toBe(boss)
    expect(store.parentOf(stranger)).toBeNull()
    expect(rawColumn('lead', 'can_message')).toBeNull()
    expect(rawColumn('lead', 'can_assign_work')).toBeNull()
    expect(store.parentOf(peer)).toBeNull()
    return { boss, bossTools, child, label: given.label as string, peer, stranger }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · HO-060 §2 · the three cases the brief asks for, in one place
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · anyone may ask; assigning work requires a relationship', () => {
    /**
     * 🔴 **The whole ruling, over ONE caller, at ONE moment** (standing rule 3 + rule 12).
     *
     * ⛔ **Three verdicts and they must all be taken from the same identity**: a note to a
     * conversation the caller did not start with nothing granted, work given to the agent that
     * conversation runs as, and work given to the agent of a conversation this caller started. ⚑
     * **Split across three fixtures the first two would prove nothing** — a give that reached
     * whatever ran as the agent would pass the first and the last alike.
     *
     * ⚑ **D-016 · a give names an AGENT**, so *the same words as work* are a give to the stranger's
     * own agent — and they reach a conversation the caller starts for them, never the stranger.
     */
    it('🔴 a note crosses · work never reaches what it did not start · work reaches what it started', async () => {
      const { boss, bossTools, child, peer, stranger } = await aBossItsChildAndAStranger()

      // ⚑ **ADMITTED · a note to one it did not start, with nothing granted.** HO-060 §2.1:
      // *a worker asking another project's specialist how they handled this last time opens
      // nothing*, and BroBot used this arm the night the work arm refused it.
      const asked = await callOn(bossTools, 'message_agent', {
        agent: stranger,
        text: 'how did you handle this last time?',
        kind: 'note',
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      expect(asked.kind).toBe('note')

      // ⛔ **NOT THE STRANGER · the same moment, the stranger's own agent given work.** The give goes
      // to the one conversation this caller has with that agent — none yet, so one it starts —
      // and nothing at all reached the conversation a person opened.
      const given = await callOn(bossTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'scribe',
        title: 'for me',
        brief: 'please do this for me',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(given.agent).not.toBe(stranger)
      expect(store.parentOf(given.agent as string)).toBe(boss)
      expect(store.piecesOwnedBy(stranger)).toHaveLength(0)

      // ⛔ **NOT THE PEER · a second conversation that it did not start.** ⚠️ This is the half `431`
      // reported and declined to ship — *every conversation in your project, whoever started it* —
      // and D-014 refuses it at every word: a desk in the same room is not a conversation you
      // started.
      const nearby = await callOn(bossTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'archivist',
        title: 'for me',
        brief: 'please do this for me',
      })
      expect(nearby.outcome, JSON.stringify(nearby)).toBe('ok')
      expect(nearby.agent).not.toBe(peer)
      expect(store.piecesOwnedBy(peer)).toHaveLength(0)
      // ⚑ **…and a note reaches it**, so what did not reach it is the work and not the words.
      expect(
        (
          await callOn(bossTools, 'message_agent', {
            agent: peer,
            text: 'how do you do this?',
            kind: 'note',
          })
        ).outcome,
      ).toBe('ok')

      // ⚑ **REACHED · work to the agent of a conversation this caller STARTED** — the one
      // relationship the rule admits, and it needs nobody to open a sheet.
      const handed = await callOn(bossTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'hand',
        title: 'the thing',
        brief: 'do the thing',
      })
      expect(handed.outcome, JSON.stringify(handed)).toBe('ok')
      expect(handed.agent).toBe(child)
      const mine = store.piecesGivenBy(boss).filter((one) => one.owner === child)
      expect(mine).toHaveLength(2)
      expect(TASK_IS_OPEN[mine.at(-1)!.state]).toBe(true)
    })

    // ⚑ **D-016** — *a person writing the widest grant does not admit the identical call* went with
    // its rail: `assign-work-to-one-you-did-not-start` was the `permanent` refusal a grant could not
    // move, and a give names an agent, so there is no call that reaches a conversation the giver did
    // not start for any grant to admit.

    /**
     * ⛔ **`none` refuses a conversation this identity STARTED, and that is the person's act.**
     *
     * ⚑ **Standing rule 11 read in the direction it is usually read backwards.** *The app may seed
     * a default at creation; it never re-grants what a person removed* — so descent is not an
     * exemption from a column a person set to `none`, and {@link ASSIGNMENT_REACH_ADMITS} says so
     * in as many words rather than leaving a reader to infer it.
     *
     * ⚠️ **Paired with the sibling one fact over**: the same caller can still SPEAK to the same
     * child, which is what makes this a narrowing of one act rather than of the conversation.
     */
    it('⛔ a person who narrows it to `none` stops work to its OWN child, and not the talking', async () => {
      const { bossTools, child, label } = await aBossItsChildAndAStranger()
      reach('lead', { canAssignWork: 'none' })

      const given = await callOn(bossTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'hand',
        title: 'the thing',
        brief: 'do the thing',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('refused')
      expect(given.rail).toBe('may-not-assign-work')
      // ⚑ **The grant that WAS read is reported**, which is `MessageRefusalDetail`'s presence rule.
      expect((given.detail as { reach?: string }).reach).toBe('none')

      const asked = await callOn(bossTools, 'message_agent', {
        agent: child,
        text: 'how is it going?',
        kind: 'follow-up',
        piece: label,
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    })

    /**
     * 🔴 **Two columns, two gates — which is HO-060 §2.3 made true rather than aspirational.**
     *
     * > ⚑ *"I claimed that sending and assigning were separate acts with separate gates. They were
     * > separate names under one gate."*
     *
     * ⛔ **So the test is that each column moves ONE of the two acts and not the other**, measured
     * where the two readings diverge: `can_message: 'none'` stops the note and not the give,
     * `can_assign_work: 'none'` stops only the give, and each refusal comes back under its own rail.
     */
    it('🔴 the two gates are two columns — each refusal names its own, on one pair', async () => {
      const { bossTools, child } = await aBossItsChildAndAStranger()
      const askIt = { agent: child, text: 'how is it going?', kind: 'note' }
      const giveIt = {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'hand',
        title: 'the thing',
        brief: 'do the thing',
      }

      reach('lead', { canMessage: 'none', canAssignWork: 'any' })
      expect((await callOn(bossTools, 'message_agent', askIt)).rail).toBe('may-not-message')
      // ⛔ **D-016 · a give is not a message**, so `can_message` does not gate it — where a work
      // message met the message rail first. ⚑ The two acts are two gates all the way down now.
      expect((await callOn(bossTools, 'give_work', giveIt)).outcome).toBe('ok')

      reach('lead', { canMessage: 'any', canAssignWork: 'none' })
      expect((await callOn(bossTools, 'message_agent', askIt)).outcome).toBe('ok')
      expect((await callOn(bossTools, 'give_work', giveIt)).rail).toBe('may-not-assign-work')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1b · the gate's own contract, where a product door cannot reach it
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **The gate's `none` clause, pinned on the function as well as through the door** (standing
   * rule 5). ⚠️ **D-016** took the project half of the composite — *a conversation you started
   * that is not here*, and *a conversation this app cannot place* — with `same-project`, so the two
   * cases that pressed it with hand-built parties went with it. ⚑ **And it took `admitAssignment`**:
   * a give has no target the grant could be asked about, so `admitReachAtAll('assign', …)` is the
   * whole question.
   */
  describe('§1b · the grant, asserted on `admitReachAtAll` itself', () => {
    const caps = (canAssignWork: string) => ({ ...DEFAULT_CAPABILITIES, canAssignWork }) as never

    /**
     * ⛔ **`none` reaches nothing at all, and the SENTENCE says so in as many words** (standing
     * rule 5, and `449`'s measured defect: a model read a bare vocabulary word and got the rule
     * wrong).
     *
     * ⚠️ **Asserted against the behaviour and not against the help string**, because the help is
     * WALKED from this table — so the two move together and an assertion over the help alone is a
     * comparison tested where both sides agree.
     */
    it('⛔ `none` refuses a conversation it started, and the shipped sentence says exactly that', () => {
      expect(admitReachAtAll('assign', caps('none'))?.rail).toBe('may-not-assign-work')
      expect(ASSIGNMENT_REACH_ADMITS.none).toContain('not even a conversation it started itself')
      // ⚑ **And the widest word is not the same claim**, so the table is two answers and not one:
      // it never drops the relationship (D-014) — the work goes to the giver's own conversation.
      expect(admitReachAtAll('assign', caps('any'))).toBeNull()
      expect(ASSIGNMENT_REACH_ADMITS.any).toContain('a conversation it has with that agent')
      expect(ASSIGNMENT_REACH_ADMITS.any).not.toContain('whoever started it')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · HO-058 §4 · the configuration burden, applied to the new column
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the grant a person never has to open', () => {
    /**
     * > 🔴 **The standing test (HO-058 §4):** *A person should never have to open a capability
     * > sheet to make a newly created agent do the thing its category exists to do.*
     *
     * ⛔ **A project manager's category exists to STAFF its project**, and one default set is the
     * same for every agent (D-014): any agent may add an agent, start it, and give it work — so a
     * project manager an agent created does all three with every column NULL. ⚠️ **Over an identity
     * `create_agent` MADE**, which writes no grant at all, so this is about the default.
     */
    it('🔴 a created project manager staffs and gives work with every column NULL', async () => {
      await personOpens('maker')
      const makerTools = theToolsetJustHandedOut()
      expect(rawColumn('maker', 'can_create_agents')).toBeNull()
      const made = await callOn(makerTools, 'create_agent', {
        profile_slug: 'fresh-pm',
        display_name: 'Fresh',
      })
      expect(made.outcome, JSON.stringify(made)).toBe('ok')

      // ⛔ **Creation wrote no grant**, which is the assertion: the tier works because of the ruled
      // DEFAULT and not because anything wrote a word.
      expect(rawColumn('fresh-pm', 'can_assign_work')).toBeNull()
      expect(rawColumn('fresh-pm', 'can_message')).toBeNull()
      expect(rawColumn('fresh-pm', 'can_create_agents')).toBeNull()

      const pm = await personOpens('fresh-pm')
      const pmTools = theToolsetJustHandedOut()
      const staffed = await callOn(pmTools, 'create_agent', {
        profile_slug: 'fresh-hand',
        display_name: 'Hand',
      })
      expect(staffed.outcome, JSON.stringify(staffed)).toBe('ok')
      // ⚑ **D-016 · starting it and giving it work are one act** — the give starts it.
      const given = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'fresh-hand',
        title: 'the piece',
        brief: 'here is the piece',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(store.piecesGivenBy(pm)).toHaveLength(1)
    })

    /**
     * ⚑ **D-014 · BroBot holds what every agent holds, and nobody wrote it.** ⛔ No code seeds a
     * column for any identity, so BroBot's first run leaves `can_assign_work` NULL and it gives work
     * by the ruled default, as every other row does.
     *
     * ⚠️ **The row and the reading are asserted apart**: the raw column is NULL, where a seed would
     * have written a word, and what the rails read is the default.
     */
    it('⚑ BroBot gives work by the ruled default after its FIRST run, with no column written', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      expect(rawColumn(DEFAULT_PROFILE_ID, 'can_assign_work')).toBeNull()
      expect(capabilityField('canAssignWork').ruled).toBe('any')
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canAssignWork).toBe('any')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · HO-060 §3 · the default kind must be harmless
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · a model that simply sends a message assigns nothing', () => {
    /**
     * 🔴 **The ruling, measured on the one caller that can tell the two readings apart.**
     *
     * ⛔ **A parent and its own child is the case HO-060 §3 calls out by name** — *"that is
     * backwards wherever it happens, including between a parent and its own child"* — because it
     * is the one pair where the assignment gate admits, so the only thing deciding whether a task
     * is opened is the default. ⚑ **Measured where the two readings DIVERGE**, exactly.
     *
     * ⚑ **D-016 · no message opens a piece**, whatever its kind: `work` is no kind now, and a piece
     * is opened by a give alone.
     */
    it('🔴 D-010 · no `kind` to its OWN child is refused and opens nothing, and only a give opens one', async () => {
      const { boss, bossTools, child } = await aBossItsChildAndAStranger()
      // ⚑ The fixture's own give — the count every step below is measured against.
      const before = store.piecesGivenBy(boss).length
      expect(before).toBe(1)

      const said = await callOn(bossTools, 'message_agent', {
        agent: child,
        text: 'a thought about the thing',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('refused')
      expect(said.rail).toBe('malformed-request')
      expect(store.piecesGivenBy(boss)).toHaveLength(before)
      // ⚑ **A note opens nothing either**, echoed back so a caller sees which reading was taken.
      const noted = await callOn(bossTools, 'message_agent', {
        agent: child,
        text: 'a thought about the thing',
        kind: 'note',
      })
      expect(noted.outcome, JSON.stringify(noted)).toBe('ok')
      expect(noted.kind).toBe('note')
      expect(store.piecesGivenBy(boss)).toHaveLength(before)
      // ⛔ **And `work` is no kind at all** — a message never gives work.
      const worded = await callOn(bossTools, 'message_agent', {
        agent: child,
        text: 'a thought about the thing',
        kind: 'work',
      })
      expect(worded.outcome, JSON.stringify(worded)).toBe('refused')
      expect(worded.rail).toBe('malformed-request')
      expect(store.piecesGivenBy(boss)).toHaveLength(before)

      const given = await callOn(bossTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'hand',
        title: 'the thing',
        brief: 'a thought about the thing',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(store.piecesGivenBy(boss)).toHaveLength(before + 1)
    })

    /**
     * ⛔ **The other acceptable answer was to REQUIRE the argument, and it was declined** — §2.1's
     * price, asserted as the choice rather than re-deriving `538` §3.3's SDK measurement.
     *
     * ⚠️ **A required argument fails differently per provider**: the MCP SDK throws
     * `McpError(InvalidParams, …)` before this app's own door runs on Claude, while
     * `answerCodexToolCall` hands arguments over unparsed — so `required` would be a rail on one
     * provider and a hint on the other, and the missing arm would still exist unhandled.
     * 🔴 **So the published schema must still accept a call with no `kind` at all**, and it is
     * asserted on the tool this app publishes rather than on a docblock about it.
     */
    it('⛔ the argument stayed OPTIONAL in the schema — the door refuses its absence on both providers', async () => {
      const { bossTools, child } = await aBossItsChildAndAStranger()
      const tool = bossTools.tools.find((one) => one.name === 'message_agent')
      if (tool === undefined) throw new Error('message_agent is not published')

      // ⚑ **What a model is actually told**, read back out of the tool's own input shape —
      // `parametersOf` is the reader both adapters build their schema through.
      const kind = parametersOf(tool.input ?? {}).find((one) => one.name === 'kind')
      expect(kind, 'kind is not advertised at all').toBeDefined()
      expect(kind?.required, 'requiring it would be a rail on Claude and a hint on Codex').toBe(
        false,
      )

      // ⛔ **And the call reaches THIS door with the argument absent**, which is the half a schema
      // assertion alone cannot make: the answer is this app's own named refusal, naming the
      // vocabulary — never a transport error.
      const said = await callOn(bossTools, 'message_agent', { agent: child, text: 'anything' })
      expect(said.outcome, JSON.stringify(said)).toBe('refused')
      expect(said.rail).toBe('malformed-request')
      const problems = (said.detail as { problems: string[] }).problems.join(' ')
      for (const member of AGENT_MESSAGE_KINDS) expect(problems).toContain(member)

      // ⚠️ **What leaving it out means is published beside the field** (D-010): nothing — say which.
      expect(kind?.description ?? '').toContain('There is no default')
    })

    // ⚑ **Landing D-014 · `1014 M23`**: what a model is told about giving work is what the rail
    // does. A sentence offering another way in sends it to a door that is permanently shut. ⚑
    // **D-016** — the message tool sends work to `give_work`, and the give says where work goes.
    it('⛔ the description sends work to give_work, which goes only to your own conversation', async () => {
      const { bossTools } = await aBossItsChildAndAStranger()
      const tool = bossTools.tools.find((one) => one.name === 'message_agent')
      if (tool === undefined) throw new Error('message_agent is not published')
      expect(tool.description).toContain('To give work, use give_work')
      expect(tool.description).not.toContain('takes work from anybody')
      expect(tool.description).not.toContain('granted you more')
      const give = bossTools.tools.find((one) => one.name === 'give_work')
      if (give === undefined) throw new Error('give_work is not published')
      expect(give.description).toContain(
        'By default, it goes to the one conversation you have with that agent',
      )
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §4 · what the brief said must NOT move, pressed rather than promised
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · HO-026 §2, against the new grant', () => {
    /**
     * 🔴 **HO-026 §2:** *a reach grant lets you speak; only a command relationship lets you destroy
     * in-flight work.* ⚠️ **HO-060 makes that line MORE load-bearing**, so it is pressed against
     * the widest form of both message grants.
     *
     * ⛔ **One caller holding BOTH message grants at their widest still cannot interrupt a
     * conversation it did not start**, because interrupting reads no grant: it reaches only the
     * chain below the caller (D-014). ⚑ **D-017 — `end_agent` is gone** (nothing ends a
     * conversation), and the refusal is `not-below-you`: `no-such-agent` is said only about an id
     * no conversation has.
     */
    it('🔴 the widest message grants buy no destruction — interrupt still refuses', async () => {
      const { bossTools, stranger } = await aBossItsChildAndAStranger()
      reach('lead', { canMessage: 'any', canAssignWork: 'any' })

      // ⚑ **Admitted**, so the refusals below are about the act and not about the pair.
      expect(
        (
          await callOn(bossTools, 'message_agent', {
            agent: stranger,
            text: 'here is a note',
            kind: 'note',
          })
        ).outcome,
      ).toBe('ok')

      const refused = await callOn(bossTools, 'interrupt_agent', { agent: stranger, reason: 'no' })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('not-below-you')
      expect(host.sessionIds).toContain(stranger)
    })

    // ⚑ **D-016** — *a person queues WORK into a narrowed conversation, and nothing asks them for a
    // grant* went with its subject: the grant on giving is asked by `give_work` alone, which no
    // person calls, and no message of any kind — a person's or an agent's — meets it or opens a piece.
  })
})
