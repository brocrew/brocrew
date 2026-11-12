import { ToolWatchingRuntime } from './lib/provider-double'
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

/** Keeps the toolsets the HOST handed out, so an agent's calls go through the real one. */
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
    // ⛔ **Two callers, one grant apart, and nothing else different about them** — standing rule 3.
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
      const itsOwn = host.agentCard(manager)
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
  })
})
