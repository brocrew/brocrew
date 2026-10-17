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
import {
  CAPABILITY_FIELDS,
  ASSIGNMENT_REACH_ADMITS,
  MESSAGING_REACH,
  type MessagingReach,
  MESSAGING_REACH_ADMITS,
  capabilityField,
  type AnyCapabilityField,
} from '../src/shared/capabilities'
import { reachesWhatItDidNotStart, refuseOutOfReach } from '../src/main/runtime/message-rails'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { agentStateWords } from '../src/shared/agent-state'

/**
 * 🔴 **433 §B · the agents a reach can see** — the asymmetry `431` measured and declined to guess
 * about, and the ruling that closed it.
 *
 * ## ⛔ What `431` left, in its own words
 *
 * > *"`list_agents` and `get_agent_status` still answer `mayCommand`'s question, so an identity
 * > this reach admits **can send to a conversation it cannot enumerate or inspect**. In a test the
 * > id comes from the fixture; in the product a model would have to be handed it. **That is one
 * > line at each of two call sites and I did not write it** — it is a disclosure decision."*
 *
 * ⚑ **The ruling (433 §B.1):** **a caller may SEE exactly what it may SEND to. No more, and no
 * less.**
 *
 *  - ⛔ **Not less**, because a capability a model cannot discover is a capability it will not use,
 *    and criterion 6 exists so BroBot can reach a project manager in another project. *"Handing it
 *    an id out of band is not a product."*
 *  - ⛔ **Not more**, because `refuse-on-entitlement-before-refusing-on-existence` is this app's
 *    ordering and an unentitled caller must not learn what exists from the shape of an answer.
 *
 * ## ⚠️ Enumerating and inspecting are two ACTS and one question
 *
 * ⛔ **`430` noted that `get_agent_status` reads the card two tools away**, and `433` §B.2 asks
 * whether seeing and sending differ. ⚑ **They do not, and neither do the two readers**: both ask
 * {@link RuntimeHost.withinMessagingReach}, which is `431`'s own narrow question and not a third
 * one — `agentsVisibleTo` for a set, `agentCard` for one id. §1 measures that as an invariant
 * rather than as two coincidences.
 *
 * ## 🔴 What a card SAYS to a caller that did not start it, which is §B.3
 *
 * ⛔ **Nothing is redacted** — {@link RuntimeHost.agentCard}'s docblock carries the reasons, and §2
 * measures that the card a granted caller gets is the card the conversation's own side gets.
 * ⚑ **D-016** — the card's `project` field, the `list_agents` project filter and the `same-project`
 * reach are gone, and the cases about them with them; the narrow caller in every pair below holds
 * `none`, the one narrower word left.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real IPC boundary.** The only double is the
 * provider, and every fixture is built through product doors — `createSession` and the toolset the
 * HOST handed the launch.
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

describe('433 §B · the agents a reach can see', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-seeing-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-seeing-root-'))
    elsewhere = mkdtempSync(join(tmpdir(), 'brobot2-seeing-elsewhere-'))
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

  const idsListedBy = async (toolset: AgentToolset): Promise<string[]> => {
    const listed = (await callOn(toolset, 'list_agents', {})) as { agents: { agent: string }[] }
    return listed.agents.map((one) => one.agent).sort()
  }

  /**
   * 🔴 **The fixture, and every step of it is a door a person presses** — `431`'s, because this is
   * the same world seen through the other two tools.
   *
   * ⚑ A project manager a person opened; BroBot and one more identity. ⛔ **Nothing here makes
   * anybody command anything**: no `commandedBy`, no shared owner and no spawn between any two of
   * them, so the only thing that can admit an answer about the manager is the grant. ⚑ **D-016** —
   * the second project the manager sat in is gone; who started what is what this fixture is for.
   */
  const twoCallersAndOneTarget = async (): Promise<{
    brobot: string
    brobotTools: AgentToolset
    explorer: string
    explorerTools: AgentToolset
    manager: string
  }> => {
    const manager = await personOpens('pm')
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const brobotTools = theToolsetJustHandedOut()
    const explorer = await personOpens('explorer')
    const explorerTools = theToolsetJustHandedOut()
    // 🔴 **549 · the narrow caller is one a PERSON narrowed** (HO-058 §1) — the ruled default is
    // `any`, so a caller left alone is not the narrow half of this pair. ⚑ **D-016 · narrowed to
    // `none`**, the one narrower word left now `same-project` is gone — still one column, one word
    // apart, nothing else different, which is what standing rule 3 asks of it. ⚠️ **That the DEFAULT
    // does not refuse is measured in `two-withdrawals-open-what-was-scoped.test.ts` §4.**
    expect(store.setCapabilities('explorer', { canMessage: 'none' })).toBe(true)
    // ⛔ **Two callers, one grant apart, and nothing else different about them** — standing rule 3.
    expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canMessage).toBe('any')
    expect(store.capabilitiesOf('explorer')?.canMessage).toBe('none')
    // ⛔ **And neither COMMANDS it**, which the door that still asks `mayCommand` says for both.
    // ⚑ **D-016 · the parent alone** — nothing started the manager, so nothing is above it.
    expect(store.parentOf(manager)).toBeNull()
    expect((await host.interruptAgent(manager, speakingAs(brobot))).ok).toBe(false)
    expect((await host.interruptAgent(manager, speakingAs(explorer))).ok).toBe(false)
    return { brobot, brobotTools, explorer, explorerTools, manager }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · a caller may SEE exactly what it may SEND to
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the ruling, as two callers over one target', () => {
    /**
     * 🔴 **§B's pair: two callers, one target, one sample, one grant apart** (433 §B.3's *"two
     * callers, one target — otherwise the negative is about the target rather than about the
     * reach"*).
     *
     * ⛔ **Both readers, for both callers, in the same run.** A test that asked only `list_agents`
     * would miss that `get_agent_status` reads a different method; one that asked only the granted
     * caller would be measuring that a conversation exists.
     */
    it('🔴 the granted caller sees the foreign conversation and the narrow one does not', async () => {
      const { brobot, brobotTools, explorer, explorerTools, manager } =
        await twoCallersAndOneTarget()

      // ⚑ **All three, and the third one is the measurement's own control**: a global reach reaches
      // everything, so `explorer` — a conversation BroBot did not start, in BroBot's own project —
      // is named too. ⛔ A list of exactly *the caller plus the foreign one* would have been a list
      // about projects, which is not what this grant says.
      expect(await idsListedBy(brobotTools)).toEqual([brobot, explorer, manager].sort())
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
        agent: { agent: manager },
      })

      // ⛔ **The same two calls, one grant over.** `explorer` holds `none` — a person's choice —
      // and sees only itself — the `me` clause, which no grant is needed for.
      expect(await idsListedBy(explorerTools)).toEqual([explorer])
      // ⚑ **D-017 · R12 — refused by its REACH, and no longer as `no-such-agent`**: the conversation
      // exists, and `no-such-agent` is said only about an id no conversation has (`05` rule 6) —
      // and, as the same answer, about a piece label that names nothing within the caller's reach
      // (D-016 · commit 7 · R1). ⚑ A person widening the grant admits the identical call, so it is
      // not `permanent`.
      expect(await callOn(explorerTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-message',
        permanence: 'until-a-person-changes-it',
      })
    })

    /**
     * ⛔ **The leak negative, and it is the *no more* half of the ruling** (§B.1).
     *
     * ⚑ **D-017 · R12 — re-aimed: *not within your reach* and *there is no such conversation* are
     * TWO answers now.** It read *"both readers ask one boolean, so they are one answer"*, compared
     * payload-for-payload against an id that was never a session; `05` rule 6 says `no-such-agent`
     * only for an id no conversation has — and D-016 · commit 7 · R1 for a piece label that names
     * nothing within the caller's reach, so a label beyond that reach never says whether its piece
     * exists. ⚠️ **But a caller learns that an id EXISTS** — and what it learns about it is the
     * rail: the refusal volunteers the caller's own reach and the id it typed, never anything about
     * the conversation (`MessageRefusalDetail`). ⛔ **The card is still withheld**, and the send door
     * refuses by the same rail, so no door says more.
     *
     * ⚑ **D-016 · the send door's answer is the standing wall now.** The narrow caller held
     * `same-project`, whose send door read the id and gave this refusal byte for byte; the one
     * narrow word left is `none`, which `message_agent` refuses before any id is read (486), so
     * there the refusal is identical but for the id the caller typed — it names nothing at all.
     */
    it('⛔ an unentitled caller is told its reach about a real foreign conversation, and nothing about it', async () => {
      const { explorer, explorerTools, manager } = await twoCallersAndOneTarget()
      const aboutTheReal = await callOn(explorerTools, 'get_agent_status', { agent: manager })
      const aboutAGhost = await callOn(explorerTools, 'get_agent_status', {
        agent: 'sess_nobody_ever_opened',
      })
      expect(aboutTheReal).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-message',
      })
      expect(aboutAGhost).toMatchObject({ outcome: 'refused', rail: 'no-such-agent' })
      // ⛔ **Nothing about the conversation rides on the refusal** — no card, nothing of its own.
      expect(aboutTheReal).not.toHaveProperty('agent')
      expect(aboutTheReal['detail']).toStrictEqual({ reach: 'none', agent: manager })
      // ⚑ **…and it is the answer `message_agent` gives, byte for byte but for the id** — one rail
      // at every door; the send door's wall is asked before the id is read (D-016, above).
      expect(
        await callOn(explorerTools, 'message_agent', {
          agent: manager,
          text: 'anything at all',
          kind: 'note',
        }),
      ).toStrictEqual({ ...aboutTheReal, detail: { reach: 'none' } })
      // ⚑ **And the listing says the same thing by saying nothing** — the real id and the ghost are
      // both simply absent, which is the only shape a list can refuse in.
      const listed = await idsListedBy(explorerTools)
      // ⚑ **The positive control the two negatives need** — the listing CAN name something, so
      // *absent* is a fact about these two ids rather than about a reader that returns nothing.
      expect(listed).toContain(explorer)
      expect(listed).not.toContain(manager)
      expect(listed).not.toContain('sess_nobody_ever_opened')
    })

    /**
     * 🔴 **THE INVARIANT — what the two doors agree about, which is NAMING and not writing.**
     * ⚠️ `list_agents`' description promises exactly this and no more; a draft of it promised
     * writability and `agent-tools.ts` records why that was false.
     *
     * ⛔ **Driven over four ids and both callers, in one sample.** For every pair, the card reader
     * answers a card **if and only if** the send door does not refuse on entitlement. ⚠️ *Not
     * `ok`*: a caller addressing ITSELF is admitted by the reach and refused one line later by the
     * host's own gate (`424`'s `that-agent-is-you`), and a busy target is refused by a rail about
     * its state. ⛔ Those are refusals about the ACT; the entitlement refusals are the only ones this
     * invariant is about.
     *
     * ⚑ **D-017 · R12 — the entitlement refusal is no longer one word.** `no-such-agent` is said only
     * about an id no conversation has (and, D-016 · commit 7 · R1, a piece label naming nothing
     * within reach), and a real id out of reach gets the reach rail — so where the card reader
     * refuses, the send door gives the SAME refusal, byte for byte (one answer at every door), and
     * where it answers, the send door refuses on none of those words.
     *
     * ⚑ **`kind: 'note'` throughout** — ⚑ **D-016**: a follow-up must name a piece the sender gave
     * that agent, so one here would be refused for its missing argument, which is a refusal about
     * the call rather than about the caller.
     *
     * ⚑ **D-016 · driven for the caller whose send door reads the id.** The narrow half held
     * `same-project`, which the send door asked per id; the one narrow word left is `none`, which
     * meets the standing wall before any id (486) — and a `none` caller naming more than it may send
     * is the concession the NAMING test below already makes (*it lists its own children and may
     * write to none of them*). ⛔ So the walled caller is measured OUT, and that it is walled is
     * asserted rather than assumed.
     */
    it('🔴 the card reader answers for exactly the ids the send door does not refuse', async () => {
      const { brobot, brobotTools, explorer, explorerTools, manager } =
        await twoCallersAndOneTarget()
      // ⚠️ **The premise of the loop, both ways**: BroBot's send door reads the id, explorer's is
      // walled before it does.
      expect(host.mayReachAtAll('message', speakingAs(brobot))).toBeNull()
      expect(host.mayReachAtAll('message', speakingAs(explorer))?.rail).toBe('may-not-message')
      const ghost = 'sess_nobody_ever_opened'
      const targets = [brobot, explorer, manager, ghost]
      // ⚑ **The words an entitlement refusal can carry** — the reach rail, read off the product's own
      // refusal rather than typed (D-016: `none` is the only reach that refuses, so the one rail is
      // the wall's), and the two about the id itself.
      const entitlement = [
        refuseOutOfReach(null).rail,
        'no-such-agent',
        'that-conversation-takes-no-messages',
      ]

      for (const [who, tools] of [['brobot', brobotTools]] as const) {
        for (const target of targets) {
          const seen = await callOn(tools, 'get_agent_status', { agent: target })
          const sent = await callOn(tools, 'message_agent', {
            agent: target,
            text: 'anything at all',
            kind: 'note',
          })
          const pair = `${who} → ${target}: saw ${JSON.stringify(seen)}, sent ${JSON.stringify(sent)}`
          if (seen.outcome === 'ok') expect(entitlement, pair).not.toContain(sent.rail)
          else expect(sent, pair).toStrictEqual(seen)
        }
      }

      // ⛔ **Non-vacuity: the loop really met both answers**, or the biconditional above would be
      // four repetitions of one side.
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
      })
      // ⚑ …and the entitlement word it can meet: the id that never was.
      expect(await callOn(brobotTools, 'get_agent_status', { agent: ghost })).toMatchObject({
        outcome: 'refused',
        rail: 'no-such-agent',
      })
      // ⚑ The narrow caller's reader still refuses the real id — §1's pair, one test up.
      expect(await callOn(explorerTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'refused',
      })
    })

    /**
     * ⛔ **The two sentences a MODEL is handed, pinned against the invariant above** — standing
     * rule 5, and standing rule 8's *"a sentence that DESCRIBES a capability drifts every time the
     * capability changes; a sentence RENDERED FROM the capability cannot."*
     *
     * 🔴 **`list_agents` said *"the ones you spawned, and yourself"* until 433**, and `431` made
     * that false without touching the line — a reach a person grants admits conversations nobody
     * spawned.
     *
     * ⛔ **And the replacement's FIRST draft was false in the other direction**, which this test now
     * exists to stop coming back: *"exactly the set message_agent will let you write to"* promises
     * writability, and the listing always contains the caller's own row, which `message_agent`
     * refuses permanently (`424`'s `that-agent-is-you`). ⚠️ **A caller holding `can_message: 'none'`
     * is the sharper case**: it lists its own children and may write to none of them.
     *
     * ⚑ **So the promise is about NAMING** — and the sentence must carry the warning as well as the
     * claim, because a model that reads *"you can see it"* as *"you can write to it"* is the model
     * `422` measured retrying for ever.
     */
    it('⛔ each reader promises NAMING, and `list_agents` says that seeing is not sending', async () => {
      const { brobotTools } = await twoCallersAndOneTarget()
      const saidBy = (name: string): string => {
        const tool = brobotTools.tools.find((one) => one.name === name)
        if (tool === undefined) throw new Error(`no such tool: ${name}`)
        return tool.description
      }
      // ⛔ **The warning, by name** — without it the sentence over-promises for every caller.
      // ⚑ **D-017 · R13 — rewritten true, and the warning kept**: *listed* is not *admitted*.
      expect(saidBy('list_agents')).toContain(
        'Being listed is not a promise that every message to it is admitted — message_agent answers that separately.',
      )
      expect(saidBy('list_agents')).toContain('message_agent')
      // ⛔ …and `get_agent_status` promises the LISTING's own answer, which is the other half of
      // §B.2 and is true because it is literally the same predicate.
      expect(saidBy('get_agent_status')).toContain('list_agents')
      // ⚑ **D-017 · R2 — re-aimed from *exactly***: `list_agents` cuts its stopped conversations at
      // the most recently active, so the promise is the REACH both readers ask, and the listing is
      // named as a subset of it — one predicate still (`withinMessagingReach`).
      expect(saidBy('get_agent_status')).toContain('any conversation you may reach')
      // ⚑ **Non-vacuity**: the reader really reads a description, and a tool that promises neither
      // is what the assertions above would otherwise be satisfied by. ⚑ **D-017** — `end_agent`
      // stood here and is gone; `interrupt_agent` is the verb that took its place below a caller.
      expect(saidBy('interrupt_agent')).not.toContain('Being listed is not a promise')
    })

    /**
     * 🔴 **The counterexample that killed the first draft, kept as an assertion.**
     *
     * ⛔ **A caller can SEE a conversation it may not write to, and the commonest instance is
     * ITSELF.** ⚑ That is not a hole: `424` split `that-agent-is-you` out precisely so the refusal
     * is permanent and honest instead of a retry promise. ⚠️ **What it is, is the bound on what
     * `list_agents` may promise** — and the pair below is the two answers in one sample, so a future
     * sentence that widens the promise has a red waiting for it.
     */
    it('⛔ seeing is not sending: the caller’s own row is listed and permanently refused', async () => {
      const { brobot, brobotTools } = await twoCallersAndOneTarget()
      expect(await idsListedBy(brobotTools)).toContain(brobot)
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: brobot,
          text: 'hello me',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'that-agent-is-you', permanence: 'permanent' })
      // ⚑ **The paired positive, one target over**: the same caller writing to a conversation it may
      // write to — so the refusal above is about the TARGET being itself, not about the door.
      const { manager } = {
        manager: (await idsListedBy(brobotTools)).filter((id) => id !== brobot)[0] as string,
      }
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: manager,
          text: 'hello you',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'ok' })
    })

    /**
     * 🔴 **The sentence a PERSON reads before granting this, and it is the one that survives a
     * careful diff** (`431` F8, one dispatch later).
     *
     * ⛔ **`can_message` decided one thing until 433 and decides two now.** A person moving the
     * control to `any` is also deciding what that identity may enumerate and inspect, in every
     * project — and the grant sheet draws {@link CapabilityField.help} verbatim, so a string that
     * named one consequence would be this app understating a permission at the moment somebody
     * grants it.
     *
     * ⚠️ **Clauses by name, not the sentence pinned** — the same rule the tool descriptions above
     * are held to.
     */
    it('🔴 the grant sheet’s own help text names BOTH things this control now decides', () => {
      const field = CAPABILITY_FIELDS.find((one) => one.key === 'canMessage')
      expect(field, 'the field this whole suite is about is gone').toBeDefined()
      const help = field?.help ?? ''
      expect(help).toContain('send a message to')
      // ⛔ **One shape, not an alternation** — an `|` here is two claims of which only one is ever
      // controlled, and the uncontrolled branch is the one that quietly carries the test.
      expect(help).toContain('list and ask about')
      // ⚑ **Non-vacuity**: a neighbouring control's help does NOT claim the second consequence, so
      // the assertion above is about this field rather than about every help string being long.
      // ⚠️ Read through {@link capabilityField}, which cannot answer `undefined`, so a neighbour that
      // left the table cannot turn this into a comparison with the empty string.
      expect(capabilityField('canAssignWork').help).not.toContain('list and ask about')
    })

    /**
     * ⚑ **Enumerating and inspecting answer the SAME card** (§B.2's *"answer both, and say if they
     * differ"* — they do not).
     *
     * ⛔ **Byte-for-byte, in one sample**, because two readers that agreed today and were built on
     * two questions would drift the first time either moved.
     */
    it('⚑ the card `get_agent_status` answers is the card `list_agents` names', async () => {
      const { brobotTools, manager } = await twoCallersAndOneTarget()
      const listed = (await callOn(brobotTools, 'list_agents', {})) as {
        agents: { agent: string }[]
      }
      const inTheList = listed.agents.find((one) => one.agent === manager)
      const oneByOne = (await callOn(brobotTools, 'get_agent_status', { agent: manager })) as {
        agent: unknown
      }
      expect(inTheList).toBeDefined()
      expect(oneByOne.agent).toEqual(inTheList)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what a card says to a caller that did not start it — 433 §B.3
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the card, whole', () => {
    /**
     * 🔴 **The judgement: nothing is redacted.**
     *
     * ⛔ **Reason 1, measured here**: the card a granted caller that did not start the conversation
     * gets is the same card the conversation's own caller gets. ⚠️ A second shape — the same row
     * with a field hollowed out — would mean two things, and the caller entitled to act on the
     * difference is the only one who could not tell them apart. ⚑ **D-016** — the card's `project`
     * field went with projects, so this no longer asserts it.
     */
    it('🔴 a card asked from across is the card its own side sees', async () => {
      const { brobotTools, manager } = await twoCallersAndOneTarget()
      const fromAcross = (await callOn(brobotTools, 'get_agent_status', { agent: manager })) as {
        agent: { whose: { profile?: string } }
      }
      expect(fromAcross.agent.whose.profile).toBe('pm')
      // ⛔ **The same card, asked by a caller nobody disputes is entitled**: the conversation
      // itself, through the `me` clause. ⚑ **D-017 · R11** — a tool's payload carries the card's one
      // state in its words (`agentStateWords`), so the host's card is compared in those words.
      const itsOwn = host.agentCard(manager, speakingAs(manager), manager)
      expect(itsOwn).not.toBeNull()
      if (itsOwn === null) throw new Error('unreachable')
      expect({ ...itsOwn, state: agentStateWords(itsOwn.state) }).toEqual(fromAcross.agent)
    })

    // ⚑ **D-016 · Reason 2 went with the field it measured** — `list_agents`' `project` filter and
    // the card's `project` are gone, so there is nothing a redaction could have emptied.
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · what did NOT widen with the readers
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the verbs, and the predicate they still ask', () => {
    /**
     * ⛔ **Seeing a conversation is not holding its work: `withdraw_task` still cannot take it back.**
     *
     * ⚑ **D-016 · re-aimed.** `withdraw_task` named an agent and read the card to find it, so the
     * reach widened its PRECHECK and not the verb. ⛔ It names one PIECE now, and the piece's giver
     * is the whole entitlement — `takeBackPiece` asks `mayCommand` directly and reads no reach. ⚠️
     * **So the two callers meet one answer**: the granted identity that can SEE the manager, and
     * the narrow one that cannot, are both told `not-a-piece-you-gave` about the manager's own root,
     * which a person opened and nobody gave. ⚑ **The piece is real**, read off the store, so the
     * refusal is about who gave it and not about a name nothing holds.
     */
    it('⛔ `withdraw_task` names a piece, and a caller that can see the conversation still cannot take its work back', async () => {
      const { brobotTools, explorerTools, manager } = await twoCallersAndOneTarget()
      // ⚠️ **The premises, asserted**: the manager owns a root nobody gave, and BroBot sees it.
      const itsRoot = store.rootOf(manager)
      expect(itsRoot, 'a conversation a person opened owns a root').not.toBeNull()
      expect(itsRoot?.givenBy).toBeNull()
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
      })
      const refused = await callOn(brobotTools, 'withdraw_task', { piece: itsRoot?.label })
      expect(refused, JSON.stringify(refused)).toMatchObject({
        outcome: 'refused',
        rail: 'not-a-piece-you-gave',
      })
      // ⚑ **The same call, one caller over** — the narrow identity meets the same word, because
      // the reach is not asked at this door. ⛔ **The fixture's own return, never `handed.at(-1)`**
      // — a later launch would silently point this pair at a different caller and the refusal
      // would go on passing.
      expect(await callOn(explorerTools, 'withdraw_task', { piece: itsRoot?.label })).toMatchObject(
        { outcome: 'refused', rail: 'not-a-piece-you-gave' },
      )
    })

    /**
     * 🔴 **The census `mayCommand`'s own docblock points at, so no number is restated in prose.**
     *
     * ⛔ **`431` wrote *ten* into that docblock and it was wrong when it was written** —
     * {@link RuntimeHost.takeBackPiece} and {@link RuntimeHost.interruptAgent} ask the predicate
     * against a slot they looked up themselves, which is how a hand-counted list comes to be short.
     * ⚑ **This counts the call sites and names the method each one sits in**, so a sixth arrives
     * with the list in front of whoever added it.
     *
     * ⚠️ **Prose is stripped first.** The file names this predicate far more often in comments than
     * in code, and a census that counted docblocks would report a different app — the control below
     * says the stripper has teeth without pinning any sentence, which is
     * `a-source-census-that-pins-a-line-kills-every-row-on-it`.
     */
    it('🔴 exactly six call sites ask `mayCommand`, and the two readers are not among them', () => {
      const raw = readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8')
      const code = withoutProse(raw)
      const lines = code.split('\n')
      // ⚠️ **A METHOD of the class, at two-space indent** — the shape every member in this file is
      // declared with, so the nearest one above a call site is the method it sits in.
      const declaration = /^ {2}(?:private |protected |public )?(?:static )?(?:async )?(\w+)\s*\(/
      let current: string | null = null
      const asked: string[] = []
      for (const line of lines) {
        const declared = declaration.exec(line)
        if (declared !== null) current = declared[1] ?? null
        // ⛔ **`mayCommand(` with ANY argument, inside a method** — the predicate's own
        // declaration is an `export function` at zero indent, so `current` is null there and it is
        // excluded by position rather than by spelling. ⚠️ **This asked for `mayCommand(slot` or
        // `mayCommand(parent` until this dispatch's review**, which is a census that pins argument
        // NAMES: an eighth call site spelled `mayCommand(target, by)` would have left the list
        // below identical, and the promise two paragraphs up would have been false.
        if (/\bmayCommand\(\w/.test(line) && current !== null) {
          asked.push(current)
        }
      }
      expect(asked.sort()).toEqual(
        [
          // ⚑ **D-016 · `spawnFacts` went with `spawn_agent`** — the spawn door's `not-your-parent`
          // rail; a give's relationship is its own lookup (the giver's one conversation with that
          // agent), which asks no predicate.
          // clause 2 of the reach — `send`, `queueMessage`, and since 433 both readers
          'withinMessagingReach',
          // ⚑ **D-016 · `withdrawTask` is `takeBackPiece`** — one path for a running and a stopped
          // owner, and it still asks the predicate against the slot it looked up. ⚑ **D-016 · the
          // giver's verbs moved that site into `whereItsHolderStands`**, the one order a take-back
          // and a close both ask — computed through its callers below.
          'whereItsHolderStands',
          // ⚑ **D-017 · `endAgent` went with `end_agent`** — nothing ends a conversation.
          // ⚑ **D-016 · commit 7 · `interruptAgent`'s entitlement is its own method**, asked by the
          // verb and by the resolver that reads `interrupt_agent`'s piece label — computed through
          // its callers below.
          'mayInterrupt',
          // ⚑ **D-016 · `assertMayAssign` went with work sent as a message** — 553's *you spawned
          // it*; `give_work` reaches only the giver's own conversation with that agent, so the
          // relationship is the lookup and not a question. Seven is five.
          // ⛔ **703's ninth and tenth — `queueAs` and `aMessageWaitsThere` — went with D-010**: they
          // chose the words a held message was refused with, and nothing is refused for that now.
          // whatever asks `requireToCommand` — computed below rather than listed here
          'assertMayCommand',
          // whatever asks `requireToAnswer` — likewise
          'assertMayAnswer',
          // a person answering from the queue where no window holds the conversation: never its
          // commander
          'aPersonsRequestNobodyHolds',
        ].sort(),
      )

      // 🔴 **And the QUESTIONS, COMPUTED — because every hand count of them has been short.**
      //
      // ⛔ `431` wrote *ten* into `withinMessagingReach`'s docblock; `433`'s own first draft wrote
      // *twelve* and its review found two more. ⚠️ **The ones a reader misses are the verbs that do
      // not spell the predicate**: `withdrawTask` and `interruptAgent` ask it against a slot they
      // looked up, and the two ANSWER verbs reach it through `requireToAnswer`, which nobody
      // grepping `mayCommand(` can see. ⚑ So the list below is derived from the gates' own callers,
      // and a fifteenth question arrives with this list in front of whoever added it.
      const callersOf = (gate: string): string[] => {
        const found: string[] = []
        let inside: string | null = null
        for (const line of lines) {
          const declared = declaration.exec(line)
          if (declared !== null) inside = declared[1] ?? null
          if (line.includes(`this.${gate}(`) && inside !== null && inside !== gate) {
            found.push(inside)
          }
        }
        return found
      }
      const questions = [
        // asked at their own line, by a method that IS the question — ⚠️ less `703`'s two, which
        // are not questions of entitlement at all: they choose a refusal's WORDS (see above), so
        // they are named out here rather than counted as a door
        ...asked.filter(
          (each) =>
            ![
              'withinMessagingReach',
              'assertMayCommand',
              'assertMayAnswer',
              'queueAs',
              'aMessageWaitsThere',
              'whereItsHolderStands',
              'mayInterrupt',
              // reached only through the two answer doors, counted below
              'aPersonsRequestNobodyHolds',
            ].includes(each),
        ),
        // the holder's standing, asked in one order by a take-back and a close (D-016)
        ...callersOf('whereItsHolderStands'),
        // the interrupt entitlement, asked by the verb and by the label resolver (D-016 · commit 7)
        ...callersOf('mayInterrupt'),
        // clause 2 of the reach: the two verbs that ask it, plus the two readers 433 moved
        ...callersOf('requireToMessage'),
        'agentsVisibleTo',
        'agentCard',
        // ⚑ **F009 · and a third reader**: an agent's record lists its conversations by the reach
        'agentRecord',
        // the strict gate, and the answer gate
        ...callersOf('requireToCommand'),
        ...callersOf('requireToAnswer'),
      ]
      expect(questions.sort()).toEqual(
        [
          'agentCard',
          // ⚑ **F009** — an agent's record, the reach's third reader beside the two 433 moved.
          'agentRecord',
          'agentsVisibleTo',
          // ⚑ **D-016 · the assignment gate (`assertMayAssign`, 553) went with work sent as a
          // message**, and the spawn door's `spawnFacts` with `spawn_agent`.
          'cancelQueuedMessage',
          'decideMoveRequest',
          'decideMoveRequest',
          // ⚑ **D-016 · `decideProposal` went with proposals** — `441`'s person-only verb, which
          // arrived through `requireToAnswer`.
          'interrupt',
          'interruptAgent',
          // ⚑ **A message, or an answer, that asks the turn it waits behind to stop** asks
          // `interrupt_agent`'s entitlement, reached through `mayInterrupt`.
          'messageAgentNow',
          'stopForAnAnswer',
          // ⚑ **657 · the question moved with `queueMessage`'s body into its private worker**, so
          // the method that asks it is named `queueAs` now. The public verb only delegates; the
          // count is unchanged, which is what this list exists to prove.
          'queueAs',
          'replyToParent',
          'respondPermission',
          'respondUserInput',
          // ⚑ **670 · the same move for `send`**: its body is the private `sendAs` now, because a
          // lost race is held at the public door and passed on at `queueAs`'s. The public verb
          // only delegates; the count is unchanged.
          'sendAs',
          'sendInterrupting',
          // ⚑ **D-016 · `withdrawTask` is `takeBackPiece`**, asking the same question.
          'takeBackPiece',
          // ⚑ **D-016 · commit 7 · R1 — the one reading of an agent address** asks
          // `interrupt_agent`'s entitlement, so a piece label names its owner exactly where that
          // door would take the owner's id — a question of its own, reached through `mayInterrupt`.
          'theConversationAddressed',
          // ⚑ **D-016 · `update_work`'s close asks what a take-back asks**, through the same helper,
          // so it is a question of its own — the kind a reader grepping `mayCommand(` misses.
          'updateWork',
        ].sort(),
      )
      // ⛔ **The number the docblocks state, asserted where it is computed** — a count in prose that
      // nothing checks is the defect this whole test exists because of.
      // 🔴 **553 · sixteen, and the number in `mayCommand`'s own docblock was corrected with
      // it.** ⛔ That prose read *fourteen* from `433` to here while this line computed FIFTEEN —
      // `441` put `decideProposal` on `requireToAnswer` and moved the derivation without moving
      // the sentence, which is exactly what that docblock warns a hand count does.
      // ⚑ `assertMayAssign` is the sixteenth (HO-060 §2.2's *you spawned it*).
      // ⚑ **D-017 · fifteen** — `endAgent`'s question went with the verb.
      // ⚑ **D-016 · fourteen** — `decideProposal`'s went with proposals.
      // ⚑ **D-016 · twelve** — `assertMayAssign`'s and `spawnFacts`' went with work by message and
      // `spawn_agent`.
      // ⚑ **D-016 · thirteen** — `update_work`'s close asks the holder's standing as a take-back does.
      // ⚑ **D-016 · commit 7 · fourteen** — the label resolver asks `interrupt_agent`'s entitlement.
      // ⚑ **Sixteen** — so do a message and an answer that ask the turn they wait behind to stop.
      // ⚑ **F009 · seventeen** — an agent's record asks the reach of each of that agent's
      // conversations, a reader as `agentsVisibleTo` and `agentCard` are.
      expect(questions).toHaveLength(19)
      // ⛔ **The two readers ask the REACH**, which is the whole of §B at the source.
      expect(code).toContain('.filter((slot) => this.withinMessagingReach(slot.id, by, me))')
      expect(code).toContain('if (!this.withinMessagingReach(sessionId, by, me)) return null')
      // ⚑ **The stripper has teeth**, written as a comparison rather than as a pinned sentence.
      expect(raw.match(/mayCommand/g)?.length ?? 0).toBeGreaterThan(
        code.match(/mayCommand/g)?.length ?? 0,
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · 449 · what the surfaces SAY about the enforcement §1 measures
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **449 · the enforcement was measured here and the SENTENCES were never pinned anywhere.**
   *
   * ⛔ **Found by one of our own agents**, reading its stated grant (`same-project`) against the
   * narrower enforcement it hit. ⚑ What was missing was that every surface which publishes the word
   * said something else, or said nothing.
   *
   * ⚑ **D-016 · `same-project` is gone, and with it every case here that was about it** — `675`'s
   * pin on the `-outside-your-project` sentences, the *same-project caller refused a conversation in
   * its own project* divergence, and the walk over the boundary rails of each act (the `read` act and
   * every `away` rail went too). ⛔ **What is left is the one that holds for any vocabulary**: each
   * grant a model reads names what its own gate asks, in the bytes the person's sheet draws.
   */
  describe('§4 · one word, two composites, and the three places that publish it', () => {
    /**
     * ⛔ **The MODEL's own copy of the rule, against the enforcement above** (standing rule 5).
     *
     * ⚑ **It is the same bytes the person's sheet draws**, which is the property that makes this
     * one sentence rather than three that happen to agree today — `433` F8's shape, refused.
     */
    it('⛔ each grant a model reads names what its OWN gate asks, and the sheet says it in the same bytes', () => {
      // ⚑ **D-016 · the sentence under test is `any`'s** — `same-project`'s, which this read first,
      // went with the word.
      const said = MESSAGING_REACH_ADMITS.any
      expect(said).toContain('whoever started it')
      // ⛔ **The roster is DERIVED from the descriptors, not typed here** — every field whose
      // vocabulary IS this one. ⚑ A third reach grant added tomorrow goes red until both of its
      // surfaces say what it admits, which is the whole reason `431` F8's shape keeps recurring:
      // *a help string two hundred lines from the docblock that was already corrected.*
      // ⚠️ **Widened to the union first**: `CAPABILITY_FIELDS` is a `const` tuple whose members
      // have DIFFERENT types, and only some of them declare `vocabulary` at all — reading the
      // property off the tuple does not compile, which is the tightening `374` bought deliberately.
      //
      // ⚑ **D-016 · by DECLARATION as well as spelling.** `same-project` was the word that told this
      // vocabulary from `CREATION_REACH`; with it gone both spell `none|any`, and a spelling filter
      // alone would sweep `canCreateAgents` in. ⛔ So each descriptor is read out of the source too,
      // and a field is on THIS vocabulary when its `vocabulary` is spread from `MESSAGING_REACH`.
      const capabilitiesSource = readFileSync(join(here, '../src/shared/capabilities.ts'), 'utf8')
      const declaredFrom = (key: string): string | null => {
        const at = capabilitiesSource.indexOf(`    key: '${key}',`)
        if (at < 0) return null
        const body = capabilitiesSource.slice(at, capabilitiesSource.indexOf('\n  },', at))
        return /vocabulary: \[\.\.\.(\w+)\]/.exec(body)?.[1] ?? null
      }
      // ⚠️ **The anchor, present before it is used**: the neighbour this filter must now tell apart.
      expect(declaredFrom('canCreateAgents')).toBe('CREATION_REACH')
      const everyField: readonly AnyCapabilityField[] = CAPABILITY_FIELDS
      const reachFields = everyField.filter(
        (field) =>
          field.vocabulary !== undefined &&
          [...field.vocabulary].join('|') === [...MESSAGING_REACH].join('|') &&
          declaredFrom(field.key) === 'MESSAGING_REACH',
      )
      // ⚑ **553 · a second field on this vocabulary, and a second composite with it** (HO-060 §2).
      // ⛔ The whole point of this walk is that sharing `MESSAGING_REACH` is not sharing a gate;
      // `canAssignWork` is the proof, and the loop below holds it to the same rule as
      // `canMessage` — its own `says` table, naming both facts. ⚑ **D-014 · the interrupt grant
      // left the vocabulary**: ending and interrupting are asked of the chain, not of a grant.
      expect(reachFields.map((field) => field.key)).toEqual(['canMessage', 'canAssignWork'])
      // 🔴 **553 · a TABLE, because a ternary was a comparison tested where both sides agree.**
      // ⛔ One that picked a table by key checked any other field on this vocabulary against the
      // MESSAGE table by default, so the walk would have passed over a field whose sentence nobody
      // had decided. ⚑ **A named table forces the decision**: a third reach grant goes red on the
      // equality two lines up until somebody adds a row here and says whose sentence it reads, and
      // then `admits[word]` is `undefined` until they do — which is this test's own argument
      // applied to itself.
      //
      // ⚠️ **`satisfies` and not an annotation**, because a `Record` over `CapabilityKey` would
      // demand a row for every field including the four on other vocabularies, and one over
      // `(typeof reachFields)[number]['key']` widens to the same thing — the union is computed
      // from the `const` tuple and not from the filter.
      const SAYS = {
        canMessage: MESSAGING_REACH_ADMITS,
        canAssignWork: ASSIGNMENT_REACH_ADMITS,
      } satisfies Readonly<Record<string, Readonly<Record<MessagingReach, string>>>>
      for (const field of reachFields) {
        const admits = SAYS[field.key as keyof typeof SAYS]
        for (const word of MESSAGING_REACH) {
          expect(field.help, `${field.key} does not say what ${word} reaches`).toContain(
            admits[word],
          )
        }
      }
      // 🔴 **493 · vocabulary equality is not gate equality.** Message `any` reaches a
      // conversation this identity did not start; giving work at `any` still goes only to one it
      // Work goes to a conversation the caller has with the agent, started when needed.
      expect(ASSIGNMENT_REACH_ADMITS.any).not.toBe(MESSAGING_REACH_ADMITS.any)
      expect(ASSIGNMENT_REACH_ADMITS.any).toBe(
        'any agent — the work goes to a conversation it has with that agent, started for it when needed',
      )
      // ⚠️ **Non-vacuity**: a field on the OTHER two-word vocabulary does not carry these
      // sentences, so the loop above is about this vocabulary rather than about help strings being
      // long enough to contain anything.
      expect(capabilityField('canCreateAgents').help).not.toContain(said)
      // ⛔ **`none` is NOT `any`'s claim** — the two words of the one vocabulary say two things.
      expect(MESSAGING_REACH_ADMITS.none).not.toBe(said)
      // 🔴 **D-014 · the two tables differ at `any` and nowhere else.** ⛔ `565` gave
      // `admitAssignment` a third arm — *an identity that accepts many callers accepts work from any
      // caller* — and D-014 withdrew it (a shared service takes questions and notes, not work).
      // ⚑ **What separates the two tables is `any`**, asserted above, and `none` is pinned
      // byte-identical so a rewrite of either one arrives as a decision (D-016: `same-project`, the
      // other word pinned here, is gone).
      expect(ASSIGNMENT_REACH_ADMITS.none).toBe(MESSAGING_REACH_ADMITS.none)
      // ⛔ **No word admits work by the receiver's breadth any more** — absence, on purpose.
      for (const word of MESSAGING_REACH) {
        expect(ASSIGNMENT_REACH_ADMITS[word], word).not.toContain('many callers')
      }
      expect(SAYS.canAssignWork).not.toBe(SAYS.canMessage)
      // ⚑ **D-016 · the pair is `none` against `any` now** — it compared `none` with `same-project`.
      expect(reachesWhatItDidNotStart('none')).toBe(false)
      // ⚠️ **Non-vacuity for the pair above**: the one word that DOES reach past its holder.
      expect(reachesWhatItDidNotStart('any')).toBe(true)
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
