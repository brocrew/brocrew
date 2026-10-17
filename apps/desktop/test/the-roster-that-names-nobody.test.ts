import { navigationReply, expectIdsOnlyInLinkTargets } from './helpers/navigation-reply'
import { conversationLink, agentLink, pieceLink } from '../src/shared/links'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  AN_IDENTITY_THIS_APP_CANNOT_NAME,
  RuntimeHost,
  whoseConversationIs,
  type AgentCard,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  THIS_APP_CANNOT_NAME_IT,
  agentToolsFor,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_LABEL,
  agentName,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { theOwnerOf } from '../src/shared/piece-called'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * # 🔴 610 · the roster that names nobody
 *
 * ## The roster must distinguish the conversations on screen
 *
 * ⚠️ **He asked Ali to relay a message to Ada. Ali answered:** *"I don't see anyone named 'Ada'
 * among the agents/conversations visible to me in this app… Could you clarify who Ada is?"* — and,
 * asked what it COULD see, *"Neither is named 'Ada' — that first one's ID just happens to contain
 * 'ada' as a substring, but it's not a person or an agent called Ada."*
 *
 * ⛔ **The app knew.** The same screen said *SPAWNED THIS CONVERSATION · Ada* and *Task #2 from
 * Ada*. ⚑ **And Ali reasoned WELL on the data it had**: a session id carrying `ada` as a substring
 * really is a coincidence worth naming. 🔴 **It did careful work and reached a false conclusion
 * because the tool answered badly** — standing rule 15: the fix is code, not instructions.
 *
 * ## ⚠️ Why nothing in this tree was red
 *
 * ⛔ **`list_agents`' own description said *"Reports **id**, project, profile, state and where each
 * came from"*, and it was TRUE.** ⚑ **No assertion anywhere asked for a name**, so none could fail
 * — `a-title-that-names-a-count-the-assertion-never-checks`, one layer down: a test that checks a
 * field EXISTS is not a test that the row is USABLE.
 *
 * ⚑ **So every section below asserts the RENDERED LINE, whole**, rather than a field.
 *
 * ## 🔴 The forbidden input, which is what §2 and §3 are about
 *
 * `runtime-ipc.ts` excludes adopted personal conversations with no profile from `agentName`:
 * defaulting one to BroBot would invent an identity. Such rows can come from `~/.claude` or
 * `~/.codex`; the app can read them without naming them as its own.
 */

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((one) => one.event)
  }
}

describe('610 · the roster that names nobody', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let sessions: FakeProviderSessions
  let counter: number
  let window: RecordingSink
  let clock: number
  const tick = (): number => clock++
  /**
   * ⚑ **A launch held inside `prepareProviderHome`, which is the seam §2 needs.**
   *
   * ⛔ **`null` unless a test asks for one** — installed for the whole suite it would park every
   * launch. ⚠️ It is this dep rather than a `FakeLaunchGate` because the state §2 is about is the
   * RESERVATION, which exists before the runtime is ever asked to start.
   */
  let holdTheHome: { released: Promise<void>; release: () => void } | null

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-610-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-610-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 3_000_000
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    holdTheHome = null
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => new FakeRuntime('claude', { sessions }),
      prepareProviderHome: async (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        if (holdTheHome !== null) await holdTheHome.released
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
    holdTheHome?.release()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  /** ⚑ **Both halves of one tool answer** — the line a model reads, and the data beside it. */
  const ask = async (
    sessionId: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<{ text: string; structured: Record<string, unknown> }> => {
    const set = agentToolsFor(host, sessionId)
    const tool = set.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answered = await tool.call(args)
    return {
      text: answered.text,
      structured: (answered.structured ?? {}) as Record<string, unknown>,
    }
  }

  const describedBy = (sessionId: string, name: ToolName): string => {
    const tool = agentToolsFor(host, sessionId).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return tool.description
  }

  /**
   * ⛔ **The one state a slot can be in that cannot name its identity**, held open.
   *
   * ⚠️ **{@link SessionSlot.profileId}'s own words:** *"`null` means 'this slot cannot name its
   * identity', never 'it has none.' A resumed row that was adopted out of a provider home carries
   * no `profile_id`."* ⚑ `resumeSession` reserves from `find(sessionId)?.profileId ?? null`, so a
   * row with a NULL profile puts exactly that value on the slot — and this holds the launch inside
   * `prepareProviderHome`, which is the first `await` after the reservation.
   *
   * 🔴 **The SWEPT row cannot be used here, and §3 is where that is measured**: `reopenSession`
   * refuses it by `row.homeRefusal` before this seam is reached, so it never registers at all. ⚑
   * What this plants is the SAME value on the SAME field, which is the input the card derives from.
   */
  const whileAResumeIsHeld = async (
    sessionId: string,
    look: (cards: readonly AgentCard[]) => Promise<void> | void,
  ): Promise<void> => {
    let release = (): void => {}
    holdTheHome = {
      released: new Promise<void>((resolve) => {
        release = resolve
      }),
      release: () => release(),
    }
    // ⛔ **The SAME window**, because a window's reach is its own slots — a resume into a
    // second sink would produce a slot this caller is not entitled to see, and the helper would
    // time out on an entitlement rather than on the state it is waiting for.
    const resuming = host.resumeSession(sessionId, window)
    try {
      // ⚑ **Microtask stepping, and it is bounded** — a reservation is synchronous and the launch
      // stops at the held dep, so the slot is in the map within a handful of ticks. ⛔ A wall-clock
      // wait would report the machine (standing rule 22); this waits on the THING.
      //
      // ⚑ **D-017 · R12 — the THING is the reservation, and the card's presence no longer says so**:
      // one list names the stopped conversation too (`05` rule 6), so the card is on it before the
      // resume reserves anything. ⚑ A reserved slot reads `active` (R11: *a start is on its way
      // in*) and the stopped one it replaces reads `idle`, so the wait is on that one fact.
      for (let n = 0; n < 200; n += 1) {
        const cards = host.agentsVisibleTo({ ownerId: window.ownerId }, null).agents
        if (cards.some((card) => card.agent === sessionId && card.state.is === 'active')) {
          await look(cards)
          return
        }
        await Promise.resolve()
      }
      throw new Error('the resume never reached its reservation')
    } finally {
      holdTheHome?.release()
      holdTheHome = null
      await resuming.catch(() => undefined)
    }
  }

  /** ⚑ **A conversation whose ledger row names no profile** — planted, because no door writes one. */
  const forgetTheProfile = (sessionId: string): void => {
    db.prepare('UPDATE provider_session SET profile_id = NULL WHERE id = ?').run(sessionId)
  }

  /**
   * A personal conversation adopted by the sweep has `adopted_at` set and `profile_id` NULL,
   * matching `session-store.ts`’s `foundInUserHome`.
   */
  const sweptOutOfHisOwnHome = (sessionId: string): void => {
    db.prepare('UPDATE provider_session SET adopted_at = ?, profile_id = NULL WHERE id = ?').run(
      4_000_000,
      sessionId,
    )
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the line a model reads NAMES the agent
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * ⚑ **D-016 · commit 7 · R3 — a line leads with the piece its conversation owns** (`theOwnerOf`,
   * the one spelling): every line pinned below is the first conversation's, which owns root `W1`,
   * untitled. ⚑ Its id is in the payload beside the line.
   */
  const ownerOf = (label: string): string => theOwnerOf({ label, title: null })

  /**
   * ⚑ **D-042 · R6 — what each conversation runs on, on its line, after its state** (`runsOnText`):
   * every launch here names nothing, so R1 names Claude's own default BY NAME, `default` at `high`
   * — marked *(requested)*, because Claude reports no effort and the Fake reports nothing at all.
   * ⛔ Written out whole rather than matched loosely: §1's rule is that the RENDERED LINE is the
   * assertion.
   */
  const runsOn = ' · on “default” at medium effort (requested)'

  function expectRosterText(
    text: string,
    prose: string,
    session: string,
    name: string,
    slug: string,
  ): void {
    const root = store.rootOf(session)
    const identity = store.agentIdentities().find((one) => one.slug === slug)
    if (root === null || identity === undefined) throw new Error('fictional roster records missing')
    const reply = navigationReply(text)
    expect(reply.prose).toBe(prose)
    expect(reply.links).toEqual([
      conversationLink(session, `${name} (${ownerOf(root.label)})`),
      agentLink(identity.id, identity.displayName ?? slug),
      pieceLink(root.piece, root.label, root.title ?? ''),
    ])
    expectIdsOnlyInLinkTargets(text, [session, root.piece, identity.id])
  }

  describe('§1 · the rendered row', () => {
    it('🔴 names the agent Ali could not find, and the id it reasoned about is still in the payload', async () => {
      // The test does not plant the name. Launch mints it through `nameForANewIdentity`;
      // `Ada` is the first free handle in `HUMAN_NAMES`, so the tool reading must retain the
      // identity name already known to the app.
      const ada = await personOpens('ada')
      expect(store.agentIdentities().find((one) => one.slug === 'ada')?.displayName).toBe('Ada')

      const listed = await ask(ada, 'list_agents')
      // ⚑ **D-016 · and the piece it holds** — every conversation owns its root (spec §4.11, D17),
      // untitled until `update_work` names it, so the line ends with its bare label.
      expect(store.rootOf(ada)?.label).toBe('W1')
      expectRosterText(
        listed.text,
        `${ownerOf('W1')} · Ada (ada) · idle${runsOn} · holds W1`,
        ada,
        'Ada',
        'ada',
      )
      expect((listed.structured.agents as AgentCard[])[0]?.whose).toEqual({
        is: 'an-identity-this-app-holds',
        profile: 'ada',
        name: 'Ada',
      })
      // ⚑ **D-016 · commit 7 · R3 — the id left the line for the payload**, where a caller that
      // reasons about it still finds it; the line names the conversation by the piece it owns.
      expect((listed.structured.agents as AgentCard[])[0]?.agent).toBe(ada)
      expectIdsOnlyInLinkTargets(listed.text, [ada])

      // ⛔ **The slug did not go anywhere, and that is the half a caller can SPEND** —
      // `give_work` takes a slug and not a name, so a line that traded one for the other would
      // be a second unusable row.
      expect(listed.text).toContain('(ada)')
    })

    it('⚠️ a name nobody gave is not printed twice, and one somebody gave is', async () => {
      const worker = await personOpens('worker')
      // ⛔ **The mint again**, cleared here so the row is the one `profileLabel` answers for: an
      // identity nobody has named. ⚑ `agentName`'s own contract — *"a row nobody has named"* falls
      // through to the older function.
      expect(store.setAgentDisplayName('worker', null)).toBe(true)
      expectRosterText(
        (await ask(worker, 'list_agents')).text,
        `${ownerOf('W1')} · worker · idle${runsOn} · holds W1`,
        worker,
        'worker',
        'worker',
      )

      // ⚑ **The paired positive, one fact over** — `profileText`'s rule is that a display name
      // equal to the slug is dropped; a name a person actually chose is not.
      expect(store.setAgentDisplayName('worker', 'Ada')).toBe(true)
      expectRosterText(
        (await ask(worker, 'list_agents')).text,
        `${ownerOf('W1')} · Ada (worker) · idle${runsOn} · holds W1`,
        worker,
        'Ada',
        'worker',
      )
    })

    it('🔴 a capitalised profile spelling is still that identity, and the row says her name', async () => {
      // ⛔ **Two columns, two spellings** — `agent_identity.slug` is folded at the mint and
      // `provider_session.profile_id` keeps what a person typed. ⚠️ **Found while building this
      // dispatch**: the card said `Dev` and the app had known this agent as `Ada` since its first
      // launch, which is the same defect one fold away from the one `610` was sent to close.
      const dev = await personOpens('Dev')
      expect(store.agentIdentities().map((one) => one.slug)).toContain('dev')
      expectRosterText(
        (await ask(dev, 'list_agents')).text,
        `${ownerOf('W1')} · Ada (Dev) · idle${runsOn} · holds W1`,
        dev,
        'Ada',
        'dev',
      )
    })

    it('⚑ the identity this app ships is BroBot on the line, and brobot in the slug', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      expectRosterText(
        (await ask(brobot, 'list_agents')).text,
        `${ownerOf('W1')} · ${DEFAULT_PROFILE_LABEL} (${DEFAULT_PROFILE_ID}) · idle${runsOn} · holds W1`,
        brobot,
        'BroBot',
        'brobot',
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · a conversation this app cannot name is LISTED, and not NAMED
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the forbidden input, refused where it arrives', () => {
    it('🔴 a slot that cannot name its identity is drawn as one, not as BroBot', async () => {
      const ours = await personOpens('ada')
      await host.close(ours, window)
      forgetTheProfile(ours)
      expect(store.find(ours)?.profileId).toBeNull()
      // ⚑ **A second conversation, so there is a CALLER to read the listing** — its reach is the
      // ruled default (`any`, `549`), which is what puts the held reservation on its list.
      const reader = await personOpens('worker')

      let card: AgentCard | undefined
      let listed = ''
      await whileAResumeIsHeld(ours, async (cards) => {
        card = cards.find((one) => one.agent === ours)
        listed = (await ask(reader, 'list_agents')).text
      })
      // ⚑ **D-017 · R11 — a start reads `active`** (`starting` was a process fact, and is gone).
      expect(card?.state).toEqual({ is: 'active' })
      expect(card?.whose).toEqual(AN_IDENTITY_THIS_APP_CANNOT_NAME)

      // ⛔ **The LINE the tool actually returns**, not a second copy of the renderer — the absence
      // is RENDERED rather than left out, because a row that simply skipped the identity would
      // read as *this one has none* (HO-024 §5.3, `430`'s renderable unknowns).
      expect(store.rootOf(ours)?.label).toBe('W1')
      // ⚑ D-042 · a held resume runs on its row's pair, replayed — what the line says it runs on.
      expect(listed.split('\n')).toContain(
        `${ownerOf('W1')} · ${THIS_APP_CANNOT_NAME_IT} · active${runsOn} · holds W1`,
      )
      expect(THIS_APP_CANNOT_NAME_IT).toBe('an agent this app cannot name')
      // 🔴 **And the word it did NOT print**, which is the whole of the forbidden input: the
      // identity this app ships is called BroBot, and this row is not it.
      expect(listed).not.toContain(`${ownerOf('W1')} · ${DEFAULT_PROFILE_LABEL}`)
    })

    it('⛔ the same call one fact over IS named — the reservation carries the answer', async () => {
      const ours = await personOpens('ada')
      await host.close(ours, window)
      // ⚠️ **No `forgetTheProfile` here, and that is the ONLY difference** — the row still names
      // `ada`, so the reservation names it too and the card is the named arm.
      let card: AgentCard | undefined
      await whileAResumeIsHeld(ours, (cards) => {
        card = cards.find((one) => one.agent === ours)
      })
      expect(card?.state).toEqual({ is: 'active' })
      expect(card?.whose).toEqual({ is: 'an-identity-this-app-holds', profile: 'ada', name: 'Ada' })
    })

    it('🔴 the unguarded call DOES invent a name, which is the whole reason for the guard', () => {
      const roster = store.agentIdentities()
      // ⛔ **The refusal and the same call one fact over** (standing rule 3), at the exact input
      // `runtime-ipc.ts` warns about twice.
      expect(agentName(null, roster)).toBe(DEFAULT_PROFILE_LABEL)
      expect(whoseConversationIs(null, roster)).toEqual(AN_IDENTITY_THIS_APP_CANNOT_NAME)
      expect(whoseConversationIs(DEFAULT_PROFILE_ID, roster)).toEqual({
        is: 'an-identity-this-app-holds',
        profile: DEFAULT_PROFILE_ID,
        name: DEFAULT_PROFILE_LABEL,
      })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the swept row — where it lands, and why it never reaches a card at all
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · one of his own conversations', () => {
    it('⛔ carries the NULL profile a card would have to name from, and is refused before it can', async () => {
      const his = await personOpens('ada')
      await host.close(his, window)
      sweptOutOfHisOwnHome(his)

      // ⚑ **The value `resumeSession` would put on the slot**, read from the very reader it reads.
      expect(store.find(his)?.profileId).toBeNull()
      // ⛔ **…and the store's own sentence about whose conversation it is.** ⚑ D-017b: a message
      // continues a conversation (there is no separate *reopen* press), so the sentence names the
      // message as what would start the provider in the wrong folder.
      expect(store.find(his)?.homeRefusal).toBe(
        "one of your own Claude conversations, found in Claude's own folder — BroCrew can read it " +
          "here, but a message here would start Claude in BroCrew's own folder, where this " +
          'conversation is not',
      )

      // 🔴 **So it never becomes a live card**: the refusal lands before the launch.
      await expect(host.resumeSession(his, window)).rejects.toThrow(
        /can be read and exported, but not continued here/,
      )
      expect(host.agentCard(his, { ownerId: window.ownerId }, null)).toBeNull()
    })

    it('⚑ the paired positive · a row of OURS has no refusal and does reopen', async () => {
      const ours = await personOpens('ada')
      await host.close(ours, window)
      expect(store.find(ours)?.homeRefusal).toBeNull()
      const back = await host.resumeSession(ours, window)
      expect(back.sessionId).toBe(ours)
      expect(host.agentCard(ours, { ownerId: window.ownerId }, null)?.whose).toEqual({
        is: 'an-identity-this-app-holds',
        profile: 'ada',
        name: 'Ada',
      })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the roster of doors that hand back a card (HO-092 §4.3)
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · every door that hands back a card', () => {
    it('⚠️ get_agent_status had the same hole, and it closes with the same card', async () => {
      const ada = await personOpens('ada')
      const asked = await ask(ada, 'get_agent_status', { agent: ada })
      expectRosterText(
        asked.text,
        `${ownerOf('W1')} · Ada (ada) · idle${runsOn} · holds W1`,
        ada,
        'Ada',
        'ada',
      )
      expect((asked.structured.agent as AgentCard).whose).toEqual({
        is: 'an-identity-this-app-holds',
        profile: 'ada',
        name: 'Ada',
      })
      // ⛔ **The same bytes as the listing**, which is `433`'s invariant made visible: enumerating
      // and inspecting are one question asked for a set and for one id.
      expect(asked.text).toBe((await ask(ada, 'list_agents')).text)
    })

    // ⚑ **D-016** — `list_projects`, the third door that carried the same card, is gone with
    // projects; `list_agents` and `get_agent_status` are the two doors that hand one back.

    it('🔴 no door hands back a card without an answer to *who is this*', async () => {
      const ada = await personOpens('ada')
      const everyCard: AgentCard[] = [
        ...host.agentsVisibleTo({ ownerId: window.ownerId }, null).agents,
        ...(host.agentCard(ada, { ownerId: window.ownerId }, null) === null
          ? []
          : [host.agentCard(ada, { ownerId: window.ownerId }, null) as AgentCard]),
      ]
      expect(everyCard.length).toBeGreaterThan(0)
      for (const card of everyCard) {
        // ⚠️ **A census over the VOCABULARY, so a third arm is a red line here** rather than a
        // silent fall-through — `a-loop-over-a-literal-variant-list-is-not-exhaustive` in the
        // direction that catches it.
        expect(['an-identity-this-app-holds', 'an-identity-this-app-cannot-name']).toContain(
          card.whose.is,
        )
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the sentences, pinned by name (standing rule 5)
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · what the two doors tell a model they report', () => {
    it('⛔ list_agents no longer promises four fields and no name', async () => {
      const ada = await personOpens('ada')
      const said = describedBy(ada, 'list_agents')
      // ⚑ **The clause that changed, by name** — a safety sentence with no test is a comment.
      // ⚑ **D-016 · commit 7 · R3 — each is named by the piece it owns first, then who it is.**
      expect(said).toContain('Each is named by the piece of work it owns')
      expect(said).toContain('then who it is — the name a person gave that agent')
      expect(said).toContain('A conversation this app cannot attribute is still listed')
      // ⛔ **And the sentence it replaced, which was TRUE and useless.**
      expect(said).not.toContain('Reports id, project, profile, state')
    })

    it('⚠️ get_agent_status says who, and keeps the clause that binds it to the listing', async () => {
      const ada = await personOpens('ada')
      const said = describedBy(ada, 'get_agent_status')
      expect(said).toContain('Who one agent is')
      // ⚑ **D-017 · R2 — the clause re-aimed, still binding it to the listing**: `list_agents` names
      // the stopped conversations only up to its cut, so the card answers every id the listing
      // names AND any other the same reach admits — one predicate, `withinMessagingReach`.
      // ⚑ **D-016 · commit 7 · R1 — and by the piece it owns**, the label every door that takes an
      // agent takes beside its id.
      expect(said).toContain(
        'It answers for any conversation you may reach — every one list_agents names, and any other by the piece it owns (W1.2) or by its id.',
      )
    })
  })
})
