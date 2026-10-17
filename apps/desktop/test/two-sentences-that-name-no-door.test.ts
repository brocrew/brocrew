import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolAnswer, AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { TOOL_NAMES, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * # 🔴 644 · two sentences that named no door
 *
 * ⛔ **Backlog `D29`, from `642` F2 and F3.** Two person-visible strings that answered correctly
 * and left a caller with nothing to do next:
 *
 *  - ⚑ **`list_agents`' EMPTY answer** — *"no agents you can see"*, a success that under-reports,
 *    and the branch `factory-text.ts`'s degradation table already credits as the quiet one.
 *  - ⚑ **`no-such-agent`'s sentence** — whose second half, *"An agent you spawned is one you may
 *    reach"*, is not merely unactionable: §2.1 below ends a child this caller spawned and gets
 *    that sentence back about it.
 *
 * ## ⛔ Why §1 has two arms, which the dispatch asked for one of
 *
 * 🔴 **{@link RuntimeHost.withinMessagingReach} answers `true` for `slot.id === me` before it asks
 * any grant**, so an unfiltered listing always names at least the caller. ⚠️ §1.2 measured that as
 * the search shape for the negative: the unfiltered branch was reachable once the caller's own slot
 * had left the map. ⚑ **D-017 · R2 — not any more**: a conversation that stopped is still listed,
 * because a message starts it, so the caller names itself after its own Close too, and §1.2 plants
 * the empty reader to reach that arm's words. ⛔ **The branch a running caller CAN empty is the
 * filtered one** (§1.1), and there the old four words were not under-reporting but wrong — the
 * caller can see several. ⚑ **D-016 — §1.1 went**: `list_agents` takes no project, so there is no
 * filtered arm any more.
 *
 * ## ⚑ The controls
 *
 * 🔴 **Each string keeps its pre-`644` wording as a literal** ({@link THE_EMPTY_ANSWER_BEFORE_644},
 * {@link THE_REFUSAL_BEFORE_644}), asserted to FAIL exactly the new clause and to PASS everything
 * the sentence carried before — so the assertions are a measurement rather than a restatement
 * (rule 12, and `642` §4.1's own shape one dispatch back).
 *
 * ⚠️ **And §2.3 is `402`'s control**: a sentence may only name a verb the refused caller can
 * actually reach (`a-priced-cost-can-name-a-remedy-that-does-not-exist`), so both doors are called
 * by the very caller that was just refused.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const REPO = join(here, '../../..')

async function waitFor(predicate: () => Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

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

/**
 * ⛔ **The empty answer as it shipped from `380` until `644`.** ⚑ It is the exact string
 * `factory-text.ts`'s degradation table quotes, which is why §4 of that dispatch left the table
 * alone: the words are still the opening of the empty answer (of both arms, until D-016 took the
 * filtered one).
 */
const THE_EMPTY_ANSWER_BEFORE_644 = 'no agents you can see'

/** ⛔ **The refusal as it shipped until `644`** — `425`'s sentence with `628`'s act missing. */
const THE_REFUSAL_BEFORE_644 =
  'there is no agent by that name that you may reach, so nothing was done to it. An agent you spawned is one you may reach.'

/** ⚑ **The clause `644` removed, named so the control below cannot be satisfied by a paraphrase.** */
const THE_CLAIM_THAT_WAS_FALSE = 'An agent you spawned is one you may reach'

describe('644 · two sentences that name no door', () => {
  let userData: string
  let root: string
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-644-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-644-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
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
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    return sessionId
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  /** ⚑ **Both halves of an answer**, because the text is the half this dispatch is about. */
  const askFor = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<AgentToolAnswer> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return tool.call(args)
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> =>
    (await askFor(toolset, name, args)).structured as Record<string, unknown>

  const idsListedBy = async (toolset: AgentToolset): Promise<string[]> => {
    const listed = (await callOn(toolset, 'list_agents', {})) as { agents: { agent: string }[] }
    return listed.agents.map((one) => one.agent).sort()
  }

  /**
   * ⛔ **A child this caller really started**, so §2.1's refutation is about its own subject.
   * ⚑ **D-016** — started by a give, whose brief is the child's first turn.
   */
  const aParentAndTheChildItSpawned = async (): Promise<{
    parent: string
    child: string
    parentTools: AgentToolset
  }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const parent = await personOpens(DEFAULT_PROFILE_ID)
    const parentTools = theToolsetJustHandedOut()
    const given = await callOn(parentTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { parent, child: given.agent as string, parentTools }
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // §1 · the empty listing, and both ways a caller reaches it
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§1 · the success that under-reported', () => {
    // ⚑ **D-016 · §1.1 went with projects**: it measured the FILTERED arm — a caller that named a
    // project nobody here is in — and `list_agents` takes no project any more, so the unfiltered
    // listing below is the only empty answer there is.

    /**
     * 🔴 **The search shape for the negative** (standing rule 4). ⛔ An unfiltered listing was empty
     * only once the caller's own slot had left the map — {@link RuntimeHost.withinMessagingReach}
     * returns `true` for `me` before it asks any grant. ⚑ **D-017 · R2 — re-aimed**: the caller's own
     * conversation is still listed once it has stopped (a message starts it), so ending it no longer
     * reaches this arm. ⚠️ **So the arm's words are reached by planting `list_agents`' one reader
     * answering nothing** — `who-can-i-talk-to.test.ts` §5's shape for its page — which is what a
     * caller with nothing it may reach would be handed.
     */
    it('§1.2 the unfiltered listing still names the caller once its own slot has gone — and, empty, it names the roster', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const tools = theToolsetJustHandedOut()

      // ⚑ **The positive half, first**: while the caller is running, no grant and no listing makes
      // this branch reachable — it always names at least itself.
      expect(await idsListedBy(tools)).toEqual([brobot])

      await host.close(brobot, window)
      // ⚑ **…and once it has stopped, too** (D-017 · R2): it is listed, running nothing.
      expect(await idsListedBy(tools)).toEqual([brobot])

      host.agentsVisibleTo = () => ({ agents: [], notListed: 0 })
      const alone = await askFor(tools, 'list_agents', {})
      expect((alone.structured as { count: number }).count).toBe(0)
      // ⚑ **D-016** — the roster door names every agent this app holds: a give names one of them.
      expect(alone.text).toContain('list_profiles names every agent this app holds')

      // ⚠️ **The control fires.**
      expect(THE_EMPTY_ANSWER_BEFORE_644).not.toContain('list_profiles')
    })

    /**
     * ⚑ **The words `factory-text.ts`'s degradation table quotes are still the opening of the
     * empty answer**, which is why `644` left that table alone: the row keeps quoting a real prefix
     * of a real answer, and its claim — that discovery meets no rail — is untouched. ⚑ **D-016** —
     * there were two arms; the filtered one went with `list_agents`' project argument.
     */
    it('§1.3 the empty answer still opens with the words the degradation table credits', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const tools = theToolsetJustHandedOut()

      await host.close(brobot, window)
      // ⚑ **D-017 · R2** — the closed caller is still listed, so the empty arm is planted (§1.2).
      expect(await idsListedBy(tools)).toEqual([brobot])
      host.agentsVisibleTo = () => ({ agents: [], notListed: 0 })
      const unfiltered = await askFor(tools, 'list_agents', {})
      expect(unfiltered.text.startsWith(THE_EMPTY_ANSWER_BEFORE_644)).toBe(true)

      // 🔴 **…and it is not still only those words**, which is the whole of `642` F2.
      expect(unfiltered.text).not.toBe(THE_EMPTY_ANSWER_BEFORE_644)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §2 · the refusal that named no door
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§2 · the refusal that named no door', () => {
    /**
     * 🔴 **The refutation, on the refusal's own subject.** ⛔ The caller spawned a child, ended it,
     * and asked to message it — and the sentence it used to get back said *an agent you spawned is
     * one you may reach*, about the agent it had spawned.
     *
     * ⚑ **D-017 · R1/R2 — re-aimed: that message is no longer refused.** A child this caller spawned
     * stays listed once it is stopped, and the message starts it again, so the refusal this was the
     * counterexample to no longer happens. ⚑ (Stopped by the app's own close: `end_agent` is gone.) ⚠️ The clause stays out of the sentence, which is now
     * answered only for an id with no conversation behind it, or one this caller may not reach.
     */
    it('§2.1 a child this caller spawned and ended is still reachable, and the sentence still makes no claim about spawned agents', async () => {
      const { parent, child, parentTools } = await aParentAndTheChildItSpawned()
      expect(await idsListedBy(parentTools)).toContain(child)

      // ⚑ **D-017** — the parent's `end_agent` stopped it here, and is gone; the app's own close is
      // the same stop.
      await host.close(child, THE_APP_ITSELF)
      await waitFor(async () => !host.sessionIds.includes(child), 'the child’s teardown to finish')
      expect(await idsListedBy(parentTools)).toContain(child)

      const sent = await askFor(parentTools, 'message_agent', {
        agent: child,
        text: 'are you there',
        kind: 'note',
      })
      expect(sent.structured, JSON.stringify(sent.structured)).toMatchObject({
        outcome: 'ok',
        agent: child,
      })

      // ⛔ **The false clause is gone** from the sentence the refused ids are still told.
      const refused = await askFor(parentTools, 'message_agent', {
        agent: 'sess_nobody_ever_opened',
        text: 'are you there',
        kind: 'note',
      })
      const payload = refused.structured as { outcome: string; rail: string; reason: string }
      expect([payload.outcome, payload.rail]).toEqual(['refused', 'no-such-agent'])
      expect(payload.reason).not.toContain(THE_CLAIM_THAT_WAS_FALSE)
      // ⚠️ **The control fires**: the sentence that shipped until `644` makes exactly that claim.
      expect(THE_REFUSAL_BEFORE_644).toContain(THE_CLAIM_THAT_WAS_FALSE)
      expect(parent).not.toBe(child)
    })

    /**
     * ⛔ **628's invariant, and 425 §2's trap, asserted together** — because the sentence has to
     * satisfy both at once and either alone is easy.
     */
    it('§2.2 it names two doors and promises nothing about the id it just declined', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      const tools = theToolsetJustHandedOut()
      const ghost = 'sess_nobody_ever_opened'

      const refused = await askFor(tools, 'message_agent', {
        agent: ghost,
        text: 'hello',
        kind: 'note',
      })
      const payload = refused.structured as {
        rail: string
        permanence: string
        retryable: boolean
        remedy: string | null
        reason: string
      }

      // ⚑ **628 · the performable act is in the SENTENCE**, each door named with the population it
      // answers for, so neither reads as a claim about the refused id.
      // ⚑ **D-017 · R12** — *reach*, not *see*: the list names every conversation within reach; and
      // ⚑ **D-016** — every agent this app holds, which a give names rather than reaching this id.
      expect(payload.reason).toContain('list_agents names the ones you can reach')
      expect(payload.reason).toContain('list_profiles names every agent this app holds')

      // 🔴 **425 §2 · nothing about the declined object.** The id the caller sent is nowhere in the
      // sentence, and the refusal is still the permanent one with no remedy — `644` was forbidden
      // to touch that field and did not.
      expect(payload.reason).not.toContain(ghost)
      expect([payload.permanence, payload.retryable, payload.remedy]).toEqual([
        'permanent',
        false,
        null,
      ])

      // ⚠️ **The control fires, in both directions**: the old sentence carries neither door, and
      // the new one keeps every clause the old one was right about.
      expect(THE_REFUSAL_BEFORE_644).not.toContain('list_agents')
      expect(THE_REFUSAL_BEFORE_644).not.toContain('list_profiles')
      // ⚑ **D-017 · R12 — the first clause is reworded, and the fact it kept is kept**: it speaks of
      // a conversation, not *"an agent by that name"*, and still says that nothing was done.
      // ⚑ **D-016 · commit 7 · R1 — and a piece label reaches it too**: the word is said about an id
      // no conversation has, and about a label naming nothing this caller may reach (refused as an
      // unknown id is), so the clause says what holds of both, as one answer — *"no conversation
      // you can reach goes by that id or piece label"*.
      expect(payload.reason).toContain(
        'no conversation you can reach goes by that id or piece label, so nothing was done.',
      )
      expect(THE_REFUSAL_BEFORE_644).toContain('so nothing was done')
    })

    /**
     * 🔴 **`402`'s control** — a sentence that names a verb a rail refuses is the defect
     * `a-priced-cost-can-name-a-remedy-that-does-not-exist` is about. ⛔ So both doors are called
     * by the caller that was just refused, in the same run.
     */
    it('§2.3 both doors are in this refused caller’s own toolset, and neither refuses it', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      const tools = theToolsetJustHandedOut()

      const refused = await askFor(tools, 'message_agent', {
        agent: 'sess_nobody_ever_opened',
        text: 'hello',
        kind: 'note',
      })
      const said = (refused.structured as { reason: string }).reason

      for (const door of ['list_agents', 'list_profiles'] as const) {
        expect(said, `the sentence does not name ${door}`).toContain(door)
        expect(TOOL_NAMES as readonly string[], `${door} left the roster`).toContain(door)
        expect(
          tools.tools.map((one) => one.name),
          `${door} is not in the refused caller's toolset`,
        ).toContain(door)
        expect(
          (await callOn(tools, door, {})).outcome,
          `${door} refused the caller its sentence sent there`,
        ).toBe('ok')
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §3 · what a PERSON sees of them, which is not all of every sentence
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **The bound is DERIVED from the file that sets it**, never restated here — a number spelled
   * twice is `a-number-can-survive-the-death-of-its-derivation`.
   *
   * ⛔ **What it is:** `ToolEntry.vue` draws one summary per tool row and it is cut at
   * `TOOL_SUMMARY_MAX`; the model reads the whole answer. ⚠️ **So a clause past the cut is a clause
   * a person never sees**, which is why `644`'s two sentences were written to fit and not to be as
   * long as they could have been.
   */
  const theSummaryBound = (): number => {
    const source = readFileSync(join(REPO, 'packages/runtime/src/claude/normalize.ts'), 'utf8')
    const found = /export const TOOL_SUMMARY_MAX = (\d+)/.exec(source)
    expect(found, 'TOOL_SUMMARY_MAX is not declared where this reads it').not.toBeNull()
    return Number(found?.[1])
  }

  it('§3.1 both new sentences reach a person whole, and the bound they fit is not a formality', async () => {
    const bound = theSummaryBound()
    expect(bound).toBeGreaterThan(0)

    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const tools = theToolsetJustHandedOut()

    const refused = await askFor(tools, 'message_agent', {
      agent: 'sess_nobody_ever_opened',
      text: 'hello',
      kind: 'note',
    })
    // ⛔ **Taken while the caller is still running**, because the control below is a refusal about
    // the caller's own live row.
    const itself = await askFor(tools, 'message_agent', {
      agent: brobot,
      text: 'hello',
      kind: 'note',
    })
    await host.close(brobot, window)
    // ⚑ **D-017 · R2** — the closed caller is still listed, so the empty arm is planted (§1.2); an
    // unplanted call would measure a listing, not the sentence this row names.
    host.agentsVisibleTo = () => ({ agents: [], notListed: 0 })
    const unfiltered = await askFor(tools, 'list_agents', {})
    expect((unfiltered.structured as { count: number }).count).toBe(0)

    // A refusal's row must show its rail and its whole reason; what the answer adds after the
    // reason may run past the cut.
    const theReasonPart = (answered: AgentToolAnswer): string => {
      const structured = answered.structured as { rail: string; reason: string }
      const part = `refused (${structured.rail}): ${structured.reason}`
      expect(answered.text.startsWith(part), answered.text).toBe(true)
      return part
    }
    for (const [what, answered] of [
      ['the empty listing', unfiltered],
      ['the no-such-agent refusal', refused],
    ] as const) {
      expect(
        what === 'the empty listing' ? answered.text.length : theReasonPart(answered).length,
        `${what} is cut before a person finishes it`,
      ).toBeLessThanOrEqual(bound)
    }

    // 🔴 **675 · the control this used to be was `644` F2 itself, and `675` repaired it.** A caller
    // addressing itself is refused `that-agent-is-you`, whose act sat past the cut; it now fits whole.
    expect((itself.structured as { rail: string }).rail).toBe('that-agent-is-you')
    const itselfPart = theReasonPart(itself)
    expect(itselfPart.length, 'that-agent-is-you is cut again').toBeLessThanOrEqual(bound)
    // ⚑ **So the control is a row that still runs past the bound** — its act leads it, which is
    // `the-act-inside-the-cut.test.ts`' whole subject — and the assertions above still measure
    // something rather than restating a property every refusal happens to have.
    // ⚠️ **Taken off a LIVE answer's `.text`**, which is what the assertions above read — a
    // string this test built for itself would pass whatever happened to `.text` (review of `675`).
    const stillLong = await askFor(tools, 'answer_question', {
      question: 'req_nobody_ever_asked',
      answers: [{ part: 'q0', answer: ['x'] }],
    })
    expect((stillLong.structured as { rail: string }).rail).toBe('no-question-by-that-name')
    expect(
      theReasonPart(stillLong).length,
      'no shipped refusal exceeds the bound, so §3.1 is measuring nothing',
    ).toBeGreaterThan(bound)
  })
})
