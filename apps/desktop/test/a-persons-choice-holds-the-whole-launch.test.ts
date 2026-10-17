import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AuthUnavailableError,
  FakeProviderSessions,
  type AgentInfo,
  type AgentToolAnswer,
  type FakeSessionHandle,
  type ModelChoice,
  type ProviderRuntimeContext,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  DEFAULT_CAPABILITIES,
  createSessionStore,
  type SessionStore,
} from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF, type RuntimeEventSink } from './helpers/giver-notice-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { MODEL_CHOICE_RAILS, aChoiceIsInForce } from '../src/shared/model-choice'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 682 · A person's choice holds the whole launch — PM ruling `R31`, four parts
 *
 * 🔴 **D-042 moved the choice and what a launch does with it** (`d042-rulings.md`): a person's
 * choice is the agent's DEFAULT (R2) — what its NEW conversations start on; every start names a pair
 * by R1's order (named → the agent's default → the last pick → the provider's default BY NAME) and
 * records it, and every later start of that conversation — a wake, a Reopen — replays its ROW. So
 * `682`'s machinery is gone: the stand-in's provisional verdict (`standIn`), its re-judging at the
 * first launch (`confirmModelChoice`, `model_choice_set_aside`) and the wake's re-read of the
 * identity. Each case below is re-aimed at its successor, or retired with a ⚑ D-042 line.
 *
 *  - **§1 · `R31d`** — a NEVER-RUN identity can be given a choice: its list is the stand-in's
 *    (BroBot's own home), asked without creating its folder. ⚑ D-042 · judged once, at the door: its
 *    first launch sends it as saved and asks no list. Each with its control.
 *  - **§2 · `R31a`** — a give to a chosen identity starts on the person's provider, whatever the
 *    giver runs on; the same give to an identity with no choice starts on the giver's (`419`, the
 *    control). ⚑ **D-016** — a give names no provider, so the refusal of a spawner's own provider
 *    went with `spawn_agent`'s `provider` argument.
 *  - **§3 · `R31b`** — the door refuses a choice for another provider; `setAgentProvider` across
 *    providers clears the choice and says so; a contradiction written before `682` is read by
 *    nothing and healed by the provider door. Both person doors announce `agents` (inbox 10).
 *  - **§4 · a wake** — ⚑ D-042: it replays the conversation's ROW (a person's live pair included);
 *    only a row that names no pair, or a model with no effort, is resolved by R1 and recorded; and
 *    what the provider REPORTS is kept beside the selected pair (R5), never over it.
 *    ⚑ **D-017** — a wake is the start an agent's MESSAGE makes (`resume_agent` is gone, and with it
 *    the wake's own answer, which said what it resumed on).
 *  - **§5 · inbox 9** — a Claude sign-in failure is `refused` with its reason, not `closing`.
 *  - **§6 · inbox 8** — `list_profiles` carries the default in force (`default_model`, D-042 · R6).
 *  - **§7 · ⚑ gone at D-016 commit 3** — the database is ONE migration, so `0045`'s `ALTER` went
 *    with the history, and `schema.ts` no longer states a foreign-key count to hold to the snapshot.
 *
 * ⚑ **D-016 · `spawn_agent` is gone**: an agent starts a conversation by GIVING it a piece
 * (`give_work`), whose brief is that conversation's first turn, and a follow-up names the piece it
 * follows. Every launch below is a give.
 *
 * ⚠️ **Why each home answers its OWN list here**: measured on six real BroBot homes (682's response
 * §1), every home keeps its own copy of the provider's catalogue, fetched under its own login at its
 * own moment — so a stand-in's list and an identity's own can differ, and this rig lets them.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  readonly messages: RuntimeEventMessage[] = []
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const levels = (...ids: string[]): { id: string; label: string }[] =>
  ids.map((id) => ({ id, label: id }))

/** ⚑ BroBot's home offers `wide`; an agent's own home, unless a test says otherwise, does not. */
const WIDE: ModelChoice = { id: 'wide', label: 'Wide', efforts: levels('low', 'high') }
/**
 * ⚑ **D-042 · R1 — every list's DEFAULT row** (`isDefault`, Codex's `model/list` shape): a Codex
 * launch that names nothing runs on it, at its own default effort — never an unnamed default.
 */
const NARROW: ModelChoice = {
  id: 'narrow',
  label: 'Narrow',
  efforts: levels('low', 'medium', 'high'),
  defaultEffort: 'medium',
  isDefault: true,
}

/**
 * `394`'s double, keeping every start and resume, answering each HOME its own list, and — when a
 * test says so — a resumed handle that REPORTS the model and effort it runs (Codex's resume answer
 * does), which D-042 · R5 keeps on the row beside the selected pair.
 */
class HomeListDouble extends ProviderDouble {
  constructor(
    provider: Provider,
    handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    gate: ResumeGate,
    private readonly world: World,
  ) {
    super(provider, handles, sessions, gate)
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    this.world.started.push({ provider: this.provider, options })
    return super.start(options)
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    this.world.resumed.push({ provider: this.provider, options })
    const handle = await super.resume(ref, options)
    if (this.world.reportsItKept !== null) {
      const info: AgentInfo = {
        model: this.world.reportsItKept.model,
        reasoningEffort: this.world.reportsItKept.effort,
        reasoningEffortReported: true,
      }
      Object.defineProperty(handle, 'agentInfo', { value: info, configurable: true })
    }
    return handle
  }
  override async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    await super.listModels(context)
    // ⚑ Whatever a test plants to happen WHILE a list is being asked — a person's other window.
    this.world.whileAsking?.()
    const profile = basename(dirname(context.providerHome))
    this.world.listed.push(`${profile}/${this.provider}`)
    const answer = this.world.lists[`${profile}/${this.provider}`] ?? this.world.lists['*'] ?? []
    if (answer instanceof Error) throw answer
    return answer
  }
}

interface World {
  started: { provider: Provider; options: StartOptions }[]
  resumed: { provider: Provider; options: ResumeOptions }[]
  listed: string[]
  lists: Record<string, ModelChoice[] | Error>
  reportsItKept: { model: string; effort: string } | null
  whileAsking?: () => void
}

describe('682 · a person’s choice holds the whole launch', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let counter: number
  let clock: number
  let world: World
  let announced: string[]
  let failSignIn: boolean
  const window = new Window('webContents:1')
  const tick = (): number => clock++
  const homes = (): string => join(userData, 'provider-homes')

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-682-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-682-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_820_000
    store = createSessionStore(db, tick)
    counter = 0
    announced = []
    failSignIn = false
    world = {
      started: [],
      resumed: [],
      listed: [],
      lists: { 'brobot/claude': [WIDE, NARROW], 'brobot/codex': [WIDE, NARROW], '*': [NARROW] },
      reportsItKept: null,
    }
    const handles: FakeSessionHandle[] = []
    const issued = new FakeProviderSessions()
    const gate = anOpenGate()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new HomeListDouble(provider, handles, issued, gate, world),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        // ⚑ Claude's machine login is checked HERE in the real app, before any child exists — the
        // shape inbox 9 is about.
        if (failSignIn && provider === 'claude') {
          throw new AuthUnavailableError(
            'claude',
            'Claude machine login unavailable: not signed in',
          )
        }
        const home = join(homes(), profileId ?? 'brobot', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(homes(), provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      // ⚑ The app's rule: a profile IS its folder, and BroBot's is always listed.
      listProfiles: () => [
        'brobot',
        ...(existsSync(homes()) ? readdirSync(homes()).filter((one) => one !== 'brobot') : []),
      ],
      announce: ({ what }) => announced.push(what),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)
  const turnsIn = (sessionId: string): number =>
    events(sessionId).filter((event) => event.type === 'turn').length
  const runningOf = (sessionId: string): string | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (row) => row.sessionId === sessionId,
    )?.running
  const rowOf = (sessionId: string) =>
    db
      .prepare(
        'SELECT model, reasoning_effort, model_or_effort_set_by_a_person_at AS setLive, reported_model, reported_effort FROM provider_session WHERE id = ?',
      )
      .get(sessionId) as {
      model: string | null
      reasoning_effort: string | null
      setLive: number | null
      /** ⚑ D-042 · R5 — what the provider last reported running, kept beside the selected pair. */
      reported_model: string | null
      reported_effort: string | null
    }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<AgentToolAnswer> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return tool.call(args)
  }
  const structured = (answer: AgentToolAnswer): Record<string, unknown> =>
    answer.structured as Record<string, unknown>

  /** ⚑ D-049 · both providers' lists for one profile, each through the host's one-provider read. */
  const bothLists = async (profileId: string) => {
    const [claude, codex] = await Promise.all([
      host.providerModels(profileId, 'claude'),
      host.providerModels(profileId, 'codex'),
    ])
    return { claude, codex }
  }

  /** An identity a person made, with its own provider or none — and NO folder: it has never run. */
  const anAgent = (slug: string, provider: Provider | null = null): void => {
    expect(
      store.createAgentIdentity({ slug, displayName: null, provider }, { by: 'a-person' }),
    ).not.toBeNull()
  }

  /**
   * A PM a person opened; like every agent, it may start any identity this app holds. ⚑ In `ask`: a
   * child inherits its parent's mode, and `auto` would take the sandbox off a Codex child —
   * `wider-than-its-parent`, a rail this file is not about.
   */
  const aPm = async (): Promise<string> => aPmOn('claude', 'ask')
  /**
   * ⚑ §4's PM: `auto` on the worker's own provider, so the child's turns run to their end without an
   * approval nobody would give, and nothing is wider than its parent.
   */
  const aPmOn = async (provider: Provider, approvalMode: 'ask' | 'auto'): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider, profileId: 'pm', approvalMode, cwd: root },
      window,
    )
    return sessionId
  }

  const choose = (
    profileId: string,
    choice: { provider: Provider | null; model?: string | null; effort?: string | null },
  ) =>
    executeRuntimeCommand(host, window, {
      kind: 'setAgentModelAndEffort',
      profileId,
      model: null,
      effort: null,
      ...choice,
    })

  const startOf = (profile: string, provider: Provider): StartOptions => {
    const found = world.started.find(
      (one) =>
        one.provider === provider && one.options.providerHome === join(homes(), profile, provider),
    )
    if (found === undefined) throw new Error(`${profile} never started on ${provider}`)
    return found.options
  }

  /* ───────────────────────────────────────────── §1 · `R31d` — a never-run identity ── */

  describe('§1 · `R31d` — a NEVER-RUN identity can be given a choice', () => {
    it('🔴 the list read answers a never-run AGENT from BroBot’s home, marked `standIn` — and creates no folder of its', async () => {
      anAgent('fresh')
      const menu = await bothLists('fresh')
      expect(menu.codex).toEqual({ ok: true, models: [WIDE, NARROW], standIn: 'brobot' })
      expect(menu.claude).toEqual({ ok: true, models: [WIDE, NARROW], standIn: 'brobot' })
      expect(world.listed.sort()).toEqual(['brobot/claude', 'brobot/codex'])
      expect(existsSync(join(homes(), 'fresh'))).toBe(false)
      // ⛔ CONTROL · a name with no identity row is still somebody typing — no list, nothing asked.
      world.listed = []
      expect(await bothLists('typing')).toEqual({
        claude: { ok: false, reason: 'no-profile' },
        codex: { ok: false, reason: 'no-profile' },
      })
      expect(world.listed).toEqual([])
      // ⚑ CONTROL · an agent that HAS run answers from its own home, with no `standIn`.
      mkdirSync(join(homes(), 'fresh', 'codex'), { recursive: true })
      const own = await bothLists('fresh')
      expect(own.codex).toEqual({ ok: true, models: [NARROW] })
    })

    it('🔴 given a choice, then its FIRST SPAWN runs on it — judged once, at the door: the launch asks no list of its own', async () => {
      anAgent('fresh')
      world.lists['fresh/codex'] = [WIDE, NARROW]
      // 🔴 **D-042 — no `standIn` on the saved choice**: it is a DEFAULT, judged at the door against
      // the stand-in's list, and no launch judges it again (`682`'s provisional verdict is gone).
      expect(await choose('fresh', { provider: 'codex', model: 'wide', effort: 'high' })).toEqual({
        ok: true,
        choice: { provider: 'codex', model: 'wide', effort: 'high' },
      })
      expect(existsSync(join(homes(), 'fresh'))).toBe(false)
      const pm = await aPm()
      const answered = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'fresh',
        title: 'work',
        brief: 'work',
      })
      expect(structured(answered).outcome, answered.text).toBe('ok')
      // ⚑ The launch carried the person's model and effort to the provider…
      const start = startOf('fresh', 'codex')
      expect(start.model).toBe('wide')
      expect(start.reasoningEffort).toBe('high')
      // ⚑ …and says so, by R1's source (D-042 · R4: *"the give's answer says what it now runs"*).
      expect(answered.text).toContain('It runs on “wide” at high effort (requested) — its default.')
      // ⛔ …its OWN list was NOT asked: a default that names its whole pair needs none (R1)…
      expect(world.listed).not.toContain('fresh/codex')
      // ⚑ …and the default is as the person saved it: no launch writes one.
      expect(store.modelChoiceOf('fresh')).toEqual({
        provider: 'codex',
        model: 'wide',
        effort: 'high',
      })
    })

    it('🔴 a choice its own list does NOT offer is still sent as saved — no launch sets it aside; a provider that refuses it says so in its own words (D-039)', async () => {
      anAgent('fresh')
      // ⚑ BroBot's home offers `wide`; `fresh`'s own does not (the `*` list).
      expect(
        await choose('fresh', { provider: 'codex', model: 'wide', effort: 'high' }),
      ).toMatchObject({ ok: true })
      const pm = await aPm()
      const answered = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'fresh',
        title: 'work',
        brief: 'work',
      })
      expect(structured(answered).outcome, answered.text).toBe('ok')
      // 🔴 **D-042 — `682`'s re-judging at the first launch is gone** (`confirmModelChoice`,
      // `model_choice_set_aside`): the default is a person's, judged once at the door, and R3 leaves
      // a model the provider then refuses to the provider's own words at that call (D-039). So the
      // whole pair is SENT, and its own list was never asked.
      const start = startOf('fresh', 'codex')
      expect(start.model).toBe('wide')
      expect(start.reasoningEffort).toBe('high')
      expect(world.listed).not.toContain('fresh/codex')
      expect(answered.text).toContain('It runs on “wide” at high effort (requested) — its default.')
      // ⚑ The choice is the person's: kept as saved.
      expect(store.modelChoiceOf('fresh')).toEqual({
        provider: 'codex',
        model: 'wide',
        effort: 'high',
      })
    })

    // ⚑ **D-042 · `702`'s `696` G1 control is retired**: the one sentence that named the STAND-IN —
    // the set-aside's *"checked against BroBot’s list"* — went with `model_choice_set_aside`, and no
    // surface main writes names a stand-in any more (`modelList.standIn` is a KEY, the slug).
    // ⚑ `707`'s R41 — an identity by the roster's NAME — still has a sentence: `not-its-provider`'s,
    // where the two cases below now read it.

    it('🔴 707 · R41 — the SUBJECT is named too: a name a PERSON gave the identity, never its slug', async () => {
      anAgent('fresh', 'codex')
      // ⚑ **One fact over `Ada`, the pool's name**: the name is one a person chose — so the word
      // cannot be a handle the sentence happened to share with the pool.
      expect(store.setAgentDisplayName('fresh', 'Hedda')).toBe(true)
      // ⚑ **D-042** — re-aimed from the set-aside's sentence, which is gone, to the one that names
      // the identity now: the door's `not-its-provider`.
      const out = await choose('fresh', { provider: 'claude', model: 'wide', effort: 'high' })
      expect(out).toMatchObject({ ok: false, rail: 'not-its-provider' })
      const said = (out as { reason: string }).reason
      expect(said).toContain('Hedda runs on Codex')
      expect(said).not.toContain('fresh')
    })

    it('⚑ 707 · R41 control — an identity with NO display name reads its canonical spelling, and nothing is invented', async () => {
      anAgent('fresh', 'codex')
      // ⚑ A person cleared the pool's name: `display_name` NULL, *nobody has said*.
      expect(store.setAgentDisplayName('fresh', null)).toBe(true)
      const out = await choose('fresh', { provider: 'claude', model: 'wide', effort: 'high' })
      expect(out).toMatchObject({ ok: false, rail: 'not-its-provider' })
      const said = (out as { reason: string }).reason
      // ⚑ `agentName`'s fallback — the folded slug.
      expect(said).toMatch(/^Choose a Codex model: “?fresh”? runs on Codex/)
      // ⛔ …and no name the roster does not hold: not the pool's, not the product's own.
      expect(said).not.toMatch(/(Ada|BroBot|brobot) runs on/)
    })

    it('⛔ CONTROL · an identity that HAS run is judged by its own list at the door — no second ask at its spawn', async () => {
      anAgent('ran')
      mkdirSync(join(homes(), 'ran', 'codex'), { recursive: true })
      // ⚑ **D-042 · R1 — an effort left out is the model's OWN default, named at the door.**
      expect(await choose('ran', { provider: 'codex', model: 'narrow' })).toEqual({
        ok: true,
        choice: { provider: 'codex', model: 'narrow', effort: 'medium' },
      })
      world.listed = []
      const pm = await aPm()
      const answered = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'ran',
        title: 'work',
        brief: 'work',
      })
      expect(structured(answered).outcome, answered.text).toBe('ok')
      expect(startOf('ran', 'codex').model).toBe('narrow')
      expect(startOf('ran', 'codex').reasoningEffort).toBe('medium')
      expect(world.listed).toEqual([])
    })

    it('⚠️ its own list could not be ASKED — and nothing asks it: the choice is sent as saved', async () => {
      anAgent('fresh')
      expect(
        await choose('fresh', { provider: 'codex', model: 'wide', effort: 'high' }),
      ).toMatchObject({ ok: true })
      world.lists['fresh/codex'] = new Error('network is down')
      const pm = await aPm()
      const answered = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'fresh',
        title: 'work',
        brief: 'work',
      })
      expect(structured(answered).outcome, answered.text).toBe('ok')
      expect(startOf('fresh', 'codex').model).toBe('wide')
      // ⚑ **D-042** — `682`'s *"checked again the next time something starts it"* is gone with the
      // provisional verdict: an outage of its own list costs a launch that names its pair nothing.
      expect(world.listed).not.toContain('fresh/codex')
      expect(answered.text).toContain('It runs on “wide” at high effort (requested) — its default.')
      expect(store.modelChoiceOf('fresh')).toEqual({
        provider: 'codex',
        model: 'wide',
        effort: 'high',
      })
    })

    // ⚑ **D-042 · retired — *"a confirmation never writes over a choice a person changed since"***:
    // `confirmModelChoice` was the one write a LAUNCH made to a default, and it is gone — a default
    // has writers that are a person's acts and `create_agent`'s, and none races a launch.

    it('⛔ the door never CREATES the never-run identity’s folder, and `has-never-run` is gone from the vocabulary', async () => {
      anAgent('fresh')
      // ⚑ The door's own outcome first (review): a door that refused early would also leave no folder.
      // ⚑ D-042 · `wide` names no default effort, so the Save names one.
      expect(
        await choose('fresh', { provider: 'claude', model: 'wide', effort: 'high' }),
      ).toMatchObject({
        ok: true,
      })
      expect(existsSync(join(homes(), 'fresh'))).toBe(false)
      expect(MODEL_CHOICE_RAILS as readonly string[]).not.toContain('has-never-run')
    })
  })

  /* ─────────────────────────────────────────────────────── §2 · `R31a` — the provider ── */

  describe('§2 · `R31a` — the choice holds the provider, over the real tool', () => {
    // ⚑ **D-016 · a give names no provider** (plan ruling 3): the refusal of a spawner that named
    // another provider over a person's choice went with `spawn_agent`'s `provider` argument. What
    // is left is the half that was the ruling — the choice holds the provider a give starts on.
    it('🔴 a give to a chosen identity starts on the PERSON’s provider, whatever the giver runs on', async () => {
      anAgent('builder')
      mkdirSync(join(homes(), 'builder', 'codex'), { recursive: true })
      expect(await choose('builder', { provider: 'codex', model: 'narrow' })).toMatchObject({
        ok: true,
      })
      // ⚑ The PM runs on Claude, so a start on Codex is the choice's and nobody else's.
      const pm = await aPm()
      const admitted = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'builder',
        title: 'work',
        brief: 'work',
      })
      expect(structured(admitted).outcome, admitted.text).toBe('ok')
      expect(startOf('builder', 'codex').model).toBe('narrow')
      expect(
        world.started.some((one) => one.options.providerHome.includes('/builder/claude')),
      ).toBe(false)
    })

    it('⛔ CONTROL (`419`) · the identical give for an identity nobody chose for starts on the giver’s provider', async () => {
      anAgent('builder')
      const pm = await aPm()
      const admitted = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'builder',
        title: 'work',
        brief: 'work',
      })
      expect(structured(admitted).outcome, admitted.text).toBe('ok')
      // ⚑ **D-042 · R1** — on the giver's provider, and on its own default BY NAME: Claude's
      // `default` at `medium` (W4.28) (`677`'s *"names nothing"* is reversed — nothing runs unnamed).
      const start = startOf('builder', 'claude')
      expect([start.model, start.reasoningEffort]).toEqual(['default', 'medium'])
    })
  })

  /* ─────────────────────────────────────────────── §3 · `R31b` — the two person doors ── */

  describe('§3 · `R31b` — the choice is always for the identity’s own provider', () => {
    it('🔴 the door refuses a choice for another provider, BY NAME, before any list is asked — and nothing is written', async () => {
      anAgent('builder', 'codex')
      mkdirSync(join(homes(), 'builder', 'codex'), { recursive: true })
      world.listed = []
      const out = await choose('builder', { provider: 'claude', model: 'narrow' })
      expect(out).toMatchObject({
        ok: false,
        rail: 'not-its-provider',
        detail: { profileId: 'builder', provider: 'claude', itsProvider: 'codex' },
      })
      // 🔴 **707 · R41 — the identity by its NAME** (`Ada`, `584`'s pool, when it was brought into
      // being); `main` read *"“builder” runs on Codex"*. ⚑ The detail keeps the slug as its key.
      expect((out as { reason: string }).reason).toBe(
        'Choose a Codex model: Ada runs on Codex, and a choice is always for its own provider — change its provider first to choose for Claude. Nothing was saved.',
      )
      expect(world.listed).toEqual([])
      expect(store.modelChoiceOf('builder')).toBeNull()
      // ⚑ THE PAIR · its own provider is admitted.
      expect(await choose('builder', { provider: 'codex', model: 'narrow' })).toMatchObject({
        ok: true,
      })
    })

    it('🔴 a provider MOVED while the door asks its list is caught before the write — no contradiction is left', async () => {
      // ⚑ The review's race: the door checks, awaits the list, then writes. A person's other window
      // moves the provider in between.
      anAgent('builder', 'codex')
      mkdirSync(join(homes(), 'builder', 'codex'), { recursive: true })
      world.whileAsking = () => {
        store.setAgentProvider('builder', 'claude')
      }
      const out = await choose('builder', { provider: 'codex', model: 'narrow' })
      expect(out).toMatchObject({
        ok: false,
        rail: 'not-its-provider',
        detail: { itsProvider: 'claude' },
      })
      // 🔴 **707 · R41 — this second door names the identity too** (review, round two: it was the one
      // `not-its-provider` sentence no test read) — `Ada`, `584`'s pool, never *“builder”*.
      expect((out as { reason: string }).reason).toContain(
        'Choose a Claude model: Ada runs on Claude,',
      )
      expect(store.modelChoiceOf('builder')).toBeNull()
      // ⚑ THE PAIR: nobody moved it, and the same Save is admitted.
      world.whileAsking = undefined
      store.setAgentProvider('builder', 'codex')
      expect(await choose('builder', { provider: 'codex', model: 'narrow' })).toMatchObject({
        ok: true,
      })
    })

    it('⚑ an identity with NO provider of its own takes a choice for either — the choice is then what holds it', async () => {
      anAgent('anyone')
      mkdirSync(join(homes(), 'anyone', 'claude'), { recursive: true })
      expect(await choose('anyone', { provider: 'claude', model: 'narrow' })).toMatchObject({
        ok: true,
      })
      expect(aChoiceIsInForce({ provider: 'claude', model: 'narrow', effort: null }, null)).toBe(
        true,
      )
    })

    it('🔴 `setAgentProvider` moving an identity to another provider CLEARS its choice in the same act — and its answer says so', async () => {
      anAgent('builder', 'codex')
      mkdirSync(join(homes(), 'builder', 'codex'), { recursive: true })
      await choose('builder', { provider: 'codex', model: 'narrow', effort: 'high' })
      announced = []
      const moved = await executeRuntimeCommand(host, window, {
        kind: 'setAgentProvider',
        profileId: 'builder',
        provider: 'claude',
      })
      expect(moved).toMatchObject({
        slug: 'builder',
        provider: 'claude',
        modelChoiceCleared: { provider: 'codex', model: 'narrow', effort: 'high' },
      })
      expect(store.modelChoiceOf('builder')).toBeNull()
      // ⚑ Announced (inbox 10), as the model door is.
      expect(announced).toEqual(['agents'])
    })

    it('⛔ CONTROLS · the same provider keeps the choice; a clear to NULL keeps it; a refused write announces nothing', async () => {
      anAgent('builder', 'codex')
      mkdirSync(join(homes(), 'builder', 'codex'), { recursive: true })
      await choose('builder', { provider: 'codex', model: 'narrow' })
      const same = await executeRuntimeCommand(host, window, {
        kind: 'setAgentProvider',
        profileId: 'builder',
        provider: 'codex',
      })
      expect(same).toMatchObject({ modelChoiceCleared: null })
      const cleared = await executeRuntimeCommand(host, window, {
        kind: 'setAgentProvider',
        profileId: 'builder',
        provider: null,
      })
      expect(cleared).toMatchObject({ provider: null, modelChoiceCleared: null })
      expect(store.modelChoiceOf('builder')?.model).toBe('narrow')
      announced = []
      expect(
        await executeRuntimeCommand(host, window, {
          kind: 'setAgentProvider',
          profileId: 'nobody',
          provider: 'codex',
        }),
      ).toBeNull()
      expect(announced).toEqual([])
    })

    it('⚠️ a contradiction written BEFORE `682` is read by nothing — and re-saving the provider it has heals it, and says so', async () => {
      anAgent('builder', 'codex')
      // ⚑ `677`'s door never compared the two; the store's own writer still can.
      expect(
        store.setModelChoice('builder', { provider: 'claude', model: 'opus', effort: null }),
      ).toBe(true)
      const pm = await aPm()
      const answered = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'builder',
        title: 'work',
        brief: 'work',
      })
      expect(structured(answered).outcome, answered.text).toBe('ok')
      // ⚑ **D-042** — read by nothing, so the start resolves R1 as though it had none: Codex's own
      // default, the row its list marks, by name. ⛔ Nothing of the Claude choice is sent.
      const start = startOf('builder', 'codex')
      expect([start.model, start.reasoningEffort]).toEqual(['narrow', 'medium'])
      // ⚑ `677`'s sentence for a choice not used (`aChoiceForAnotherProvider`) went with D-042: the
      // answer says what the start runs on, and where that came from.
      expect(answered.text).toContain(
        'It runs on “narrow” at medium effort (requested) — Codex’s default.',
      )
      expect(answered.text).not.toContain('opus')
      const healed = await executeRuntimeCommand(host, window, {
        kind: 'setAgentProvider',
        profileId: 'builder',
        provider: 'codex',
      })
      expect(healed).toMatchObject({
        modelChoiceCleared: { provider: 'claude', model: 'opus', effort: null },
      })
    })

    it('⚑ `setCapabilities` announces `agents` too (inbox 10) — and only when it wrote', async () => {
      anAgent('builder')
      announced = []
      expect(host.setCapabilities('builder', DEFAULT_CAPABILITIES)).not.toBeNull()
      expect(announced).toEqual(['agents'])
      announced = []
      expect(host.setCapabilities('nobody', DEFAULT_CAPABILITIES)).toBeNull()
      expect(announced).toEqual([])
    })
  })

  /* ─────────────────────────────── §4 · `R31c`, and inbox 4 and 5 — what a wake runs on ── */

  describe('§4 · a wake — `R31c`, and what it runs on', () => {
    /**
     * ⚑ A worker the PM's give started on `provider`, its brief's turn over, then STOPPED — exactly
     * what a wake is for. `live`, when given, is a model a PERSON set on it while it ran (after claiming it).
     *
     * ⚑ **D-017 — nothing ends a conversation** (`end_agent` is gone): the stop is the app's own,
     * which is what the parent's `end_agent` was.
     */
    const anEndedWorker = async (
      provider: Provider,
      live?: { model?: string; effort?: string },
      /** ⚑ A person's DEFAULT made BEFORE the give, which its start then runs on — or none. */
      chosenFirst?: { model: string; effort: string },
    ): Promise<{ pm: string; worker: string }> => {
      anAgent('worker', provider)
      mkdirSync(join(homes(), 'worker', provider), { recursive: true })
      if (chosenFirst !== undefined) {
        expect(store.setModelChoice('worker', { provider, ...chosenFirst })).toBe(true)
      }
      const pm = await aPmOn(provider, 'auto')
      // ⚑ **D-016 · the give starts the worker, and its brief is the worker's first turn.**
      // ⚑ **D-042 · R4 — and, with no default in play, the give NAMES its model** — `narrow`, at the
      // effort the seam carries over (Claude's `high`, Codex's `medium`). ⚠️ Until D-042 a give named
      // none, and the model was planted on the row after the turn.
      const given = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'work',
        brief: 'go',
        ...(chosenFirst === undefined ? { model: 'narrow' } : {}),
      })
      expect(structured(given).outcome, given.text).toBe('ok')
      const worker = structured(given).agent as string
      await waitFor(() => turnsIn(worker) > 0, 'the work’s turn to end')
      if (live !== undefined) {
        host.claimSession(worker, window)
        if (live.model !== undefined) {
          await executeRuntimeCommand(host, window, {
            kind: 'setSessionSetting',
            sessionId: worker,
            body: { kind: 'model', value: live.model },
          })
        }
        if (live.effort !== undefined) {
          await executeRuntimeCommand(host, window, {
            kind: 'setSessionSetting',
            sessionId: worker,
            body: { kind: 'reasoningEffort', value: live.effort },
          })
        }
        await host.close(worker, window)
      } else {
        await host.close(worker, THE_APP_ITSELF)
      }
      await waitFor(() => runningOf(worker) === 'not-running', 'the worker to be over')
      expect(
        store
          .piecesOwnedBy(worker)
          .some((piece) => piece.giver === pm && TASK_IS_OPEN[piece.state]),
      ).toBe(true)
      return { pm, worker }
    }
    /**
     * ⚑ **D-017 — the wake is the start the parent's MESSAGE makes** (`resume_agent` is gone).
     * ⚠️ Its answer is `message_agent`'s, and says nothing of what it resumed on — so what is
     * measured below is what was SENT and what the conversation RECORDS.
     */
    const wake = async (pm: string, worker: string): Promise<AgentToolAnswer> => {
      const resumed = world.resumed.length
      // ⚑ **D-016 · a follow-up names the piece it follows** — the one the PM gave this worker.
      const piece = store.piecesOwnedBy(worker).find((one) => one.giver === pm)?.label
      const woke = await callOn(pm, 'message_agent', {
        agent: worker,
        text: 'carry on',
        kind: 'follow-up',
        piece,
      })
      expect(structured(woke).outcome, woke.text).toBe('ok')
      await waitFor(() => world.resumed.length > resumed, 'the message to start the worker')
      await waitFor(() => runningOf(worker) !== 'not-running', 'the worker to be running')
      return woke
    }
    const lastResume = (): ResumeOptions => {
      const last = world.resumed.at(-1)
      if (last === undefined) throw new Error('nothing was resumed')
      return last.options
    }
    /** ⚑ Stopped again by the app, between two wakes. */
    const stopAgain = async (worker: string): Promise<void> => {
      await host.close(worker, THE_APP_ITSELF)
      await waitFor(() => runningOf(worker) === 'not-running', 'the worker to be over again')
    }

    it('⚑ `R31c` · the live-change door STAMPS the row — the control below it carries none', async () => {
      const { worker } = await anEndedWorker('claude', { model: 'hand-picked' })
      expect(rowOf(worker).setLive).toEqual(expect.any(Number))
    })

    it('🔴 `R31c` · a model a PERSON set live survives a wake', async () => {
      const { pm, worker } = await anEndedWorker('claude', { model: 'hand-picked' })
      expect(rowOf(worker).model).toBe('hand-picked')
      expect(
        store.setModelChoice('worker', { provider: 'claude', model: 'wide', effort: 'high' }),
      ).toBe(true)
      await wake(pm, worker)
      expect(lastResume().model).toBe('hand-picked')
      expect(rowOf(worker).model).toBe('hand-picked')
      // ⚑ **D-042** — the stamp's force at a wake is now every row's (R1 replays it); where it still
      // decides is a GIVE naming another pair, which it keeps from switching (F1).
    })

    it('⛔ CONTROL · a conversation nobody set live replays its ROW at the same wake — D-042 · R2: the default reaches its NEW conversations, not this one', async () => {
      const { pm, worker } = await anEndedWorker('claude')
      // ⚑ No stamp — and the wake below writes none either.
      expect(rowOf(worker).setLive).toBeNull()
      expect(rowOf(worker)).toMatchObject({ model: 'narrow', reasoning_effort: 'medium' })
      expect(
        store.setModelChoice('worker', { provider: 'claude', model: 'wide', effort: 'high' }),
      ).toBe(true)
      await wake(pm, worker)
      // ⛔ **`677`/`682`'s wake re-read of the standing choice is gone**: it took `wide` here.
      expect(lastResume().model).toBe('narrow')
      expect(lastResume().reasoningEffort).toBe('medium')
      expect(rowOf(worker).setLive).toBeNull()
    })

    it('⚑ a live EFFORT counts as the person’s act too — the pair stays as recorded', async () => {
      const { pm, worker } = await anEndedWorker('claude', { effort: 'low' })
      expect(
        store.setModelChoice('worker', { provider: 'claude', model: 'wide', effort: 'high' }),
      ).toBe(true)
      await wake(pm, worker)
      expect(lastResume().model).toBe('narrow')
      expect(lastResume().reasoningEffort).toBe('low')
    })

    it('⚑ inbox 4 · an effort-only value beside a recorded model is not applied', async () => {
      const { pm, worker } = await anEndedWorker('claude')
      // ⚑ **D-042 — `682`'s effort-only choice is no default** (a default is a model and its effort),
      // so only the column can still hold one, written before D-042; the fold reads it as none.
      db.prepare(`UPDATE agent_identity SET model_choice = ? WHERE slug = 'worker'`).run(
        '{"provider":"claude","model":null,"effort":"low"}',
      )
      expect(store.modelChoiceOf('worker')).toBeNull()
      await wake(pm, worker)
      expect(lastResume().reasoningEffort).toBe('medium')
      expect(lastResume().model).toBe('narrow')
    })

    it('⛔ a choice NOT IN FORCE is not applied by a wake either — even on the conversation’s own provider', async () => {
      const { pm, worker } = await anEndedWorker('claude')
      // ⚑ The contradiction a database from before 682 can hold: the identity says Codex, the
      // choice says Claude — the conversation's own provider. ⚑ D-042: a wake replays its row anyway.
      expect(store.setAgentProvider('worker', 'codex')).toBe(true)
      expect(
        store.setModelChoice('worker', { provider: 'claude', model: 'wide', effort: 'high' }),
      ).toBe(true)
      await wake(pm, worker)
      expect(lastResume().model).toBe('narrow')
    })

    it('🔴 D-042 · R1 — a wake whose row names NOTHING names R1’s pair, and records it — never an unnamed default (reverses `677` D1)', async () => {
      const { pm, worker } = await anEndedWorker('claude')
      // ⚑ The row every helper had before D-042: nothing recorded. ⚑ And a default read by nothing
      // (not in force), so R1 passes it by — to the last pick (none), then Claude's own, BY NAME.
      store.setModel(worker, null)
      store.setReasoningEffort(worker, null)
      expect(store.setAgentProvider('worker', 'codex')).toBe(true)
      expect(
        store.setModelChoice('worker', { provider: 'claude', model: 'wide', effort: 'high' }),
      ).toBe(true)
      await wake(pm, worker)
      expect([lastResume().model, lastResume().reasoningEffort]).toEqual(['default', 'medium'])
      // ⚑ …recorded, so every later start replays it.
      expect(rowOf(worker)).toMatchObject({ model: 'default', reasoning_effort: 'medium' })
    })

    // ⚑ **D-017 — `inbox 4 CONTROL · with no choice in play the wake’s answer is what it always was`
    // is gone with that answer** (`resume_agent`'s). What a wake with nothing chosen SENDS is
    // `a-spawn-reaches-the-provider-with-a-persons-model.test.ts`' own control.

    it('🔴 inbox 5 · a recorded model whose effort was left to the provider is SENT that model’s own default — and records it', async () => {
      // ⚑ **The hazard, planted**: the thread ran `wide` at `high`, so it HOLDS an effort (Codex
      // keeps it across a resume — `677` D2).
      const { pm, worker } = await anEndedWorker('codex', undefined, {
        model: 'wide',
        effort: 'high',
      })
      expect(rowOf(worker).reasoning_effort).toBe('high')
      world.lists['worker/codex'] = [NARROW, WIDE]
      // ⚑ **D-042 · R1** — a recorded MODEL with no effort beside it (what a pre-D-042 launch that
      // left the effort to the provider wrote) is resolved at the wake: its row's own default.
      store.setModel(worker, 'narrow')
      store.setReasoningEffort(worker, null)
      await wake(pm, worker)
      expect(lastResume().model).toBe('narrow')
      expect(lastResume().reasoningEffort).toBe('medium')
      expect(rowOf(worker).reasoning_effort).toBe('medium')
    })

    it('⚑ inbox 5 → D-042 · R5 · what the provider REPORTS is kept beside the selected pair — never written over it', async () => {
      // ⚑ **D-042 moved inbox 5's second half**: the effort the provider reports it kept was written
      // over `reasoning_effort` (the selected pair); R5 keeps the report in its own columns, so a
      // card can say both. ⚑ A model named alone whose list row names its effort is the case above;
      // one the provider's rows do not hold (a person added it, or the list lacks it) runs at its
      // row's default where it has one, else the provider's default effort — and refuses the launch
      // (F2, `nothing-names-a-model`) only where that is unnamed too: Codex's list could not be
      // read, or marks no default at an effort (Claude's is `high`, by name).
      // ⚑ **UNPINNED since D-042 — the retired half's own row**: a model the provider's list DOES
      // hold, offering efforts but naming no default (a Claude row without `high`, a Codex row with
      // an empty `defaultReasoningEffort`), is neither refused nor named one — R1 sends it with NO
      // effort (`theEffortOfAModelNamedAlone` hands back the row's `null`; `theSettingNamed` too).
      // Passed to DEV as a product defect; its case lands beside the WHOLE-pair control below once
      // the fallback or the refusal is ruled.
      const { pm, worker } = await anEndedWorker('codex', undefined, {
        model: 'wide',
        effort: 'high',
      })
      world.reportsItKept = { model: 'wide-2026-09', effort: 'xhigh' }
      const turns = turnsIn(worker)
      await wake(pm, worker)
      expect([lastResume().model, lastResume().reasoningEffort]).toEqual(['wide', 'high'])
      // ⚑ Read once the woken turn is over — the moment its CONTROL below reads nothing: the pump
      // keeps the report as it delivers each event, and the turn's row is appended in that same call.
      await waitFor(() => turnsIn(worker) > turns, 'the woken turn to end')
      expect(rowOf(worker)).toMatchObject({
        model: 'wide',
        reasoning_effort: 'high',
        reported_model: 'wide-2026-09',
        reported_effort: 'xhigh',
      })
    })

    it('⛔ inbox 5 CONTROL · a provider that reports nothing leaves the row saying nothing was reported', async () => {
      const { pm, worker } = await anEndedWorker('codex', undefined, {
        model: 'wide',
        effort: 'high',
      })
      const turns = turnsIn(worker)
      await wake(pm, worker)
      // ⛔ **Not read at the resume**: R5's report is kept as the pump delivers each event, so a
      // null read before the woken conversation's events were delivered proves nothing. Its twin
      // above holds the report at this same moment.
      await waitFor(() => turnsIn(worker) > turns, 'the woken turn to end')
      expect(rowOf(worker)).toMatchObject({
        model: 'wide',
        reasoning_effort: 'high',
        reported_model: null,
        reported_effort: null,
      })
    })

    it('⛔ inbox 5 CONTROL · a row that names its WHOLE pair is not asked for a default — no list, the pair sent as recorded', async () => {
      // ⚑ **D-042 · R1** — its give named `narrow`, and the start recorded the effort it ran at.
      const { pm, worker } = await anEndedWorker('codex')
      expect(rowOf(worker)).toMatchObject({ model: 'narrow', reasoning_effort: 'medium' })
      world.lists['worker/codex'] = [NARROW, WIDE]
      world.listed = []
      await wake(pm, worker)
      expect([lastResume().model, lastResume().reasoningEffort]).toEqual(['narrow', 'medium'])
      expect(world.listed).toEqual([])
    })

    it('🔴 `R31d` on a wake → D-042 · a default its own list does not offer is NOT judged at a wake — the conversation resumes as it was, and the default is left as saved', async () => {
      const { pm, worker } = await anEndedWorker('codex')
      // ⚑ `wide` is BroBot's, and not in `worker`'s own list (the `*` list) — `682`'s set-aside premise.
      const saved = { provider: 'codex' as const, model: 'wide', effort: 'high' }
      expect(store.setModelChoice('worker', saved)).toBe(true)
      world.listed = []
      await wake(pm, worker)
      // ⛔ **D-042 — `682`'s re-judging, and its `model_choice_set_aside` row, are gone**: a wake
      // replays its row and asks no list of the default.
      expect([lastResume().model, lastResume().reasoningEffort]).toEqual(['narrow', 'medium'])
      expect(world.listed).toEqual([])
      expect(store.modelChoiceOf('worker')).toEqual(saved)
    })

    it('⚑ D-042 · a wake WRITES no default — it announces exactly what the identical wake announces with none', async () => {
      // ⚑ **Re-aimed from `682`'s confirmation** (*"written back, and announced once more"*): no
      // launch writes a default since D-042, so a default in play moves the count by nothing.
      const { pm, worker } = await anEndedWorker('codex')
      const agentsAnnounced = (): number => announced.filter((what) => what === 'agents').length
      const judged = { provider: 'codex' as const, model: 'narrow', effort: 'medium' }
      expect(store.setModelChoice('worker', judged)).toBe(true)
      announced = []
      await wake(pm, worker)
      const withADefault = agentsAnnounced()
      expect(store.modelChoiceOf('worker')).toEqual(judged)
      // ⚑ THE CONTROL: the same wake, with no default at all.
      await stopAgain(worker)
      expect(store.setModelChoice('worker', null)).toBe(true)
      announced = []
      await wake(pm, worker)
      expect(withADefault).toBe(agentsAnnounced())
    })

    it('🔴 `R31d` on a wake · the RECORD is the pair its first launch named — and the wake names it again, whatever its own list now says', async () => {
      // ⚑ The review's case, whole: never run; chosen against BroBot's list; its own list could not
      // be asked at its first launch; now its own list answers — without `wide`.
      anAgent('worker', 'codex')
      expect(
        await choose('worker', { provider: 'codex', model: 'wide', effort: 'high' }),
      ).toMatchObject({ ok: true, choice: { model: 'wide', effort: 'high' } })
      world.lists['worker/codex'] = new Error('network is down')
      const pm = await aPmOn('codex', 'auto')
      // ⚑ **D-016 · the give starts it, and its brief is its first turn.**
      const given = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'work',
        brief: 'go',
      })
      expect(structured(given).outcome, given.text).toBe('ok')
      const worker = structured(given).agent as string
      expect(rowOf(worker)).toMatchObject({ model: 'wide', reasoning_effort: 'high' })
      await waitFor(() => turnsIn(worker) > 0, 'the work’s turn to end')
      await stopAgain(worker)
      world.lists['worker/codex'] = [NARROW]
      await wake(pm, worker)
      // 🔴 **D-042 · R1 reverses `682`'s *"not asked for again"***: every start names the row's pair,
      // so the wake asks for `wide` at `high` — both keys — and a provider that refuses it says so in
      // its own words (R3, D-039).
      expect([lastResume().model, lastResume().reasoningEffort]).toEqual(['wide', 'high'])
      expect(rowOf(worker)).toMatchObject({ model: 'wide', reasoning_effort: 'high' })
      // ⚑ …and neither launch asked its own list: a pair named whole needs none.
      expect(world.listed).not.toContain('worker/codex')
    })

    it('⚑ an effort recorded ALONE is applied at a wake, on the model R1 lands it on — where that model offers it', async () => {
      const { pm, worker } = await anEndedWorker('claude')
      // ⚑ **D-042** — a row from before D-042 holding an effort beside no model: R1 lands it on
      // Claude's own default, BY NAME, and keeps the effort only where that model offers it.
      store.setModel(worker, null)
      store.setReasoningEffort(worker, 'low')
      await wake(pm, worker)
      expect([lastResume().model, lastResume().reasoningEffort]).toEqual(['default', 'low'])
      expect(rowOf(worker)).toMatchObject({ model: 'default', reasoning_effort: 'low' })
      // ⛔ THE PAIR · an effort that model does not offer is not sent beside it — its own is.
      await stopAgain(worker)
      store.setModel(worker, null)
      store.setReasoningEffort(worker, 'max')
      await wake(pm, worker)
      expect([lastResume().model, lastResume().reasoningEffort]).toEqual(['default', 'medium'])
      expect(rowOf(worker)).toMatchObject({ model: 'default', reasoning_effort: 'medium' })
    })

    it('🔴 W4.28 · a conversation whose row recorded `high` wakes on `high` — the new fallback reaches only what named nothing', async () => {
      const { pm, worker } = await anEndedWorker('claude')
      // ⚑ The pair every Claude conversation started on before W4.28, planted on its row.
      store.setModel(worker, 'default')
      store.setReasoningEffort(worker, 'high')
      await wake(pm, worker)
      expect([lastResume().model, lastResume().reasoningEffort]).toEqual(['default', 'high'])
      expect(rowOf(worker)).toMatchObject({ model: 'default', reasoning_effort: 'high' })
    })
  })

  /* ──────────────────────────────────────────── §5 · inbox 9 — the probe's real reason ── */

  describe('§5 · inbox 9 — a sign-in failure is `refused`, in its own words', () => {
    it('🔴 a Claude machine login that is unavailable is NOT `closing` — the reason is the provider’s', async () => {
      failSignIn = true
      const menu = await bothLists('brobot')
      expect(menu.claude).toEqual({
        ok: false,
        reason: 'refused',
        detail: 'Claude machine login unavailable: not signed in',
      })
      // ⚑ …and the provider that could answer still did.
      expect(menu.codex.ok).toBe(true)
    })
  })

  /* ─────────────────────────────────────────── §6 · inbox 8 — the spawner knows first ── */

  describe('§6 · inbox 8 — `list_profiles` carries the default in force', () => {
    it('🔴 a chosen identity is listed with its choice; one nobody chose for, and a contradiction, are listed without', async () => {
      anAgent('chosen', 'codex')
      anAgent('unchosen')
      anAgent('contradicted', 'codex')
      mkdirSync(join(homes(), 'chosen', 'codex'), { recursive: true })
      await choose('chosen', { provider: 'codex', model: 'narrow', effort: 'high' })
      store.setModelChoice('contradicted', { provider: 'claude', model: 'opus', effort: null })
      const pm = await aPm()
      const listed = structured(await callOn(pm, 'list_profiles')).profiles as Record<
        string,
        unknown
      >[]
      const of = (slug: string) => listed.find((one) => one.profile === slug)
      // ⚑ **D-042 · R6 — `a_person_chose` is `default_model` now**: what its new conversations start on.
      expect(of('chosen')?.default_model).toEqual({
        provider: 'codex',
        model: 'narrow',
        effort: 'high',
      })
      expect(of('unchosen')).not.toHaveProperty('default_model')
      expect(of('contradicted')).not.toHaveProperty('default_model')
    })
  })

  // ⚑ **D-016 commit 3 · §7 is gone** — the database is ONE migration (`0000_the_tree.sql`), so
  // `0045`'s `ALTER` went with the history, and `schema.ts` no longer states a count of the foreign
  // keys that point at `agent_identity` for the snapshot to hold it to.
})
