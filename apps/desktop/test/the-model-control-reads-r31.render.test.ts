import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  type AgentToolAnswer,
  type FakeSessionHandle,
  type ModelChoice,
  type ProviderRuntimeContext,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { ModelList, RuntimeBridge, RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { aChoiceIsInForce, whatAModelChoiceReaches } from '../src/shared/model-choice'
import {
  createAgentStore,
  providerForALaunch,
  type AgentStore,
} from '../src/renderer/src/lib/agent-store'
import {
  aChoiceForAnotherProviderSays,
  heldReachesSays,
  theMenusAreFor,
  theStandInNamed,
  whatTheProviderPressCleared,
} from '../src/renderer/src/lib/agent-model-choice'
import { createModelLists, type ModelLists } from '../src/renderer/src/lib/model-lists'
import { providerTakesEffectNextTime } from '../src/renderer/src/lib/front-door-words'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { everythingOverTheWire } from './lib/the-wire'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 696 · the model control reads R31 — `688` §1b, `688` L1's neighbour F-b, over the real doors
 *
 * ⚑ **`682` put R31 in main and `691` made the control compile against it**; what a PERSON reads
 * about a choice under R31 is this dispatch. Every section drives the renderer's own half — the
 * store over a real `RuntimeHost` behind the wire's clone, and the functions `AgentModelChoice.vue`
 * and `CapabilitiesSheet.vue` draw — and every section plants its control in the same host.
 *
 * | § | what a person reads | the control |
 * |---|---|---|
 * | 1 | a stand-in's menu says whose it is; the draft's words are the words Save leaves | an agent with its own list: the same default, the same words |
 * | 2 | whose list the menus are, NAMED (`agentName`, never the slug) — and the default saved carries none | its own home's menu names no list; a named BroBot is named |
 * | 3 | a choice not in force is read by nothing — and the two presses the sentence names do what it says | the same choice on no provider of its own is in force |
 * | 4 | a no-provider agent's menus are its CHOICE's provider | the same held choice beside a provider of its own |
 * | 5 | the provider press says what it CLEARED | a move to *nobody has said*, and to the choice's own provider, clear nothing |
 * | 6 | D-042 · a default a stand-in's list admitted STARTS the conversation — named, recorded and said; set aside nowhere | a default its own list offers too: the same start |
 *
 * ⚑ **D-042 moved §1, §2 and §6**: `682`'s stand-in re-judge is gone — `standIn` on a saved
 * default, its provisional clause and `model_choice_set_aside`. No launch judges a default again,
 * so the list that judged it at the sheet is the verdict, and R1 sends it as it is.
 *
 * ⚑ **D-016 · §7 is gone** — `681` F-b's *no project yet* was the Team page's *Works in* line, and
 * D-016 took projects and that line out, so a first conversation starting has no project to name.
 *
 * ⚠️ **The drawing is `test/dom/the-model-control-reads-r31.dom.test.ts`** — a real engine, real
 * presses, the photographs.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const levels = (...ids: string[]): { id: string; label: string }[] =>
  ids.map((id) => ({ id, label: id }))

/**
 * ⚑ **D-042 · the adapters' shape**: Claude's `default` row marked `isDefault` and `high` its rows'
 * default effort; Codex's `isDefault` row and each row's own default effort (`listModels`,
 * `modelChoiceOf`) — so a default saved with its effort left blank names the model's own.
 */
const CLAUDE_ROWS: ModelChoice[] = [
  {
    id: 'default',
    label: 'Default (recommended)',
    efforts: levels('low', 'medium', 'high'),
    isDefault: true,
    defaultEffort: 'high',
  },
  {
    id: 'opus',
    label: 'Opus',
    efforts: levels('low', 'medium', 'high', 'max'),
    defaultEffort: 'high',
  },
]
const CODEX_ROWS: ModelChoice[] = [
  {
    id: 'gpt-5.6-terra',
    label: 'terra',
    efforts: levels('low', 'medium', 'high', 'ultra'),
    defaultEffort: 'medium',
  },
  {
    id: 'gpt-5.6-luna',
    label: 'luna',
    efforts: levels('low', 'medium', 'high'),
    defaultEffort: 'medium',
    isDefault: true,
  },
]

// ⚑ **D-042 · `textsOf` and `draw` went with §6's drawing** — the SSR of `682`'s set-aside notice,
// a row no conversation carries any more.

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

/* ═══════════════════════ §1–§5 · the control, over the real doors ═══════════════════════ */

/**
 * ⚑ **`RuntimeScreen.vue`'s own `DEFAULT_PROVIDER`** — what a launch as an agent that has not said
 * resolves to. ⚠️ A constant local to that component, so it is spelled here; §4's premise asserts
 * the resolution it feeds rather than the constant.
 */
const THE_SCREENS_FALLBACK = 'codex' as const

/** `685`'s catalogue double: every home answers its provider's list. */
class CatalogueDouble extends FakeRuntime {
  override async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    await super.listModels(context)
    return this.provider === 'claude' ? CLAUDE_ROWS : CODEX_ROWS
  }
}

describe('696 §1–§5 · what a person reads about a model choice under R31', () => {
  let userData: string
  let db: AppDatabase
  let sessions: SessionStore
  let host: RuntimeHost
  let folders: Set<string>
  let agents: AgentStore
  /** ⚑ UI-012 · the picker's lists, over the same wire. */
  let lists: ModelLists
  const window = new Window('webContents:1')

  beforeEach(async () => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-696-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    sessions = createSessionStore(db)
    folders = new Set(['brobot'])
    host = new RuntimeHost({
      store: sessions,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new CatalogueDouble(provider),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'brobot', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      listProfiles: () => [...folders],
      newSessionId: () => `sess_${Math.random().toString(36).slice(2)}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    const run = async <T>(kind: string, input: Record<string, unknown> = {}): Promise<T> =>
      (await executeRuntimeCommand(host, window, { kind, ...input } as Parameters<
        typeof executeRuntimeCommand
      >[2])) as T
    // ⚑ **The preload's own spellings**, and the wire's clone in front of every call.
    const bridge: Partial<RuntimeBridge> = {
      agentIdentities: () => run('agentIdentities'),
      profiles: () => run('profiles'),
      modelList: (input) => run('modelList', { ...input }),
      agentModelAndEffort: (input) => run('agentModelAndEffort', { ...input }),
      setAgentModelAndEffort: (input) => run('setAgentModelAndEffort', { ...input }),
      setAgentProvider: (input) => run('setAgentProvider', { ...input }),
    }
    agents = createAgentStore(everythingOverTheWire(bridge) as RuntimeBridge)
    lists = createModelLists(() => everythingOverTheWire(bridge) as RuntimeBridge)
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /** An identity row — with its own folder unless it has never run. */
  const anAgent = (slug: string, folder: 'has-run' | 'never-run' = 'has-run'): void => {
    expect(
      sessions.createAgentIdentity({ slug, displayName: null, provider: null }, { by: 'a-person' }),
    ).not.toBeNull()
    if (folder === 'has-run') folders.add(slug)
  }
  const roster = () => agents.identities.value?.identities ?? null
  const heldBy = async (slug: string) => {
    const read = await agents.modelChoiceFor(slug)
    if (read === null) throw new Error('the read failed')
    return read.held
  }
  /** ⚑ UI-012 · the list the picker draws for one provider — the press that opens it. */
  const listFor = async (slug: string, provider: Provider): Promise<ModelList> => {
    await lists.read(provider, slug)
    const held = lists.held(provider, slug)
    if (held?.state !== 'answered' || held.list.notAsked !== null) {
      throw new Error(`no list: ${JSON.stringify(held)}`)
    }
    return held.list
  }
  const providerOf = async (slug: string, provider: Provider | null): Promise<void> => {
    const moved = await agents.chooseProviderFor(slug, provider)
    expect(moved.ok, moved.ok ? '' : moved.reason).toBe(true)
  }

  /* ─────────────────────────── §1 · the menu names its stand-in ── */

  // ⚑ **D-042 · re-aimed** — the draft's sentence named the stand-in because `682` stamped it on
  // what Save left and called it provisional. ⚑ That stamp is gone with the stand-in re-judge, so
  // what stands of `691` §8.1 is the rule itself: the words before Save are the words after it —
  // and, one fact over, whose list judged a default no longer changes a word said about it.
  it('🔴 §1 · a never-run agent’s menu says whose list it is, and the draft’s sentence is the one Save leaves', async () => {
    anAgent('fresh', 'never-run')
    await agents.load()
    const lets = await listFor('fresh', 'claude')
    expect(lets.standIn).toBe('brobot')
    const named = theStandInNamed({ standIn: lets.standIn }, roster()).standIn
    expect(named).toBe('BroBot')
    // ⚑ UI-012 · what the picker's Take hands the door for `opus` with no effort named.
    const draft = { provider: 'claude' as const, model: 'opus', effort: null }
    const before = whatAModelChoiceReaches(draft)
    const saved = await agents.chooseModelFor('fresh', draft)
    if (!saved.ok || saved.held === null) throw new Error('not saved')
    // ⚑ The door judged by the same list, named the model's own effort (D-042 · R1) — and stamped
    // no list on it.
    expect(saved.held).toEqual({ provider: 'claude', model: 'opus', effort: 'high' })
    // 🔴 …so the words before the press ARE the words after it.
    expect(heldReachesSays(saved.held, null)).toBe(before)

    // ⚑ THE CONTROL, one fact over — an agent with its own list: the same default, the same words.
    anAgent('ran')
    const own = await listFor('ran', 'claude')
    expect(own.standIn).toBeNull()
    const ownSaved = await agents.chooseModelFor('ran', draft)
    if (!ownSaved.ok || ownSaved.held === null) throw new Error('not saved')
    expect(ownSaved.held).toEqual(saved.held)
    expect(heldReachesSays(ownSaved.held, null)).toBe(before)
  })

  /* ─────────────────────────── §2 · provenance, named ── */

  // ⚑ **D-042 · re-aimed** — a saved default carries no provenance any more (`682`'s `standIn`
  // went with the stand-in re-judge). ⚑ The one place a list's provenance is still drawn is above
  // the menus (`agent-model-stand-in`), and that is where it is NAMED.
  it('🔴 §2 · whose list the menus are is NAMED the way every surface names that agent — and the default saved from it carries none', async () => {
    anAgent('fresh', 'never-run')
    const lets = await listFor('fresh', 'codex')
    // ⚑ The door's own word is the SLUG…
    expect(lets.standIn).toBe('brobot')
    await agents.load()
    // 🔴 …and the person reads the NAME: `agentName`, BroBot's own.
    expect(theStandInNamed(lets, roster()).standIn).toBe('BroBot')
    // ⚑ What is saved from that menu, read back, is the default alone.
    await agents.chooseModelFor('fresh', { provider: 'codex', model: 'gpt-5.6-luna', effort: null })
    expect(await heldBy('fresh')).toEqual({
      provider: 'codex',
      model: 'gpt-5.6-luna',
      effort: 'medium',
    })
    // ⚑ It is `agentName`, not a word typed here: a person who named BroBot reads that name.
    expect(
      sessions.createAgentIdentity(
        { slug: 'brobot', displayName: 'Bee', provider: null },
        { by: 'a-person' },
      ),
    ).not.toBeNull()
    await agents.load()
    expect(theStandInNamed(lets, roster()).standIn).toBe('Bee')

    // ⚑ THE CONTROL: its own home's menu names no list — nothing to name.
    anAgent('ran')
    const own = await listFor('ran', 'codex')
    expect(own.standIn).toBeNull()
    expect(theStandInNamed(own, roster())).toBe(own)
  })

  /* ─────────────────────────── §3 · not in force ── */

  it('🔴 §3 · a choice not in force is said to be read by nothing — and the two presses it names do what it says', async () => {
    anAgent('worker')
    await providerOf('worker', 'codex')
    // ⚑ A contradiction written before 682 — no door can write one now (the model door refuses it
    // and the provider door clears it), so it is planted where 677's door wrote it: the store.
    const planted = { provider: 'claude' as const, model: 'opus', effort: null }
    expect(sessions.setModelChoice('worker', planted)).toBe(true)
    const held = await heldBy('worker')
    if (held === null) throw new Error('nothing held')
    expect(aChoiceIsInForce(held, 'codex')).toBe(false)
    expect(aChoiceForAnotherProviderSays(held, 'codex')).toBe(
      'It is for Claude, and this agent runs on Codex, so no launch reads it: another agent that starts this one, or whose message starts it, does so as though nobody had chosen. Its picker picks a Codex model in its place, and Clear takes it away.',
    )
    expect(heldReachesSays(held, 'codex')).toBeNull()

    // ⚑ *Its picker picks a Codex model in its place* — the list is Codex's, and the door replaces
    // it.
    expect(theMenusAreFor('codex', 'codex', held)).toBe('codex')
    await listFor('worker', 'codex')
    const replaced = await agents.chooseModelFor('worker', {
      provider: 'codex',
      model: 'gpt-5.6-terra',
      effort: null,
    })
    // ⚑ D-042 · the default whole, at the model's own effort the door named (R1).
    expect(replaced).toEqual({
      ok: true,
      held: { provider: 'codex', model: 'gpt-5.6-terra', effort: 'medium' },
    })
    // ⚑ *…and Clear takes it away* — the three nulls, through the same door.
    expect(sessions.setModelChoice('worker', planted)).toBe(true)
    expect(await agents.chooseModelFor('worker', null)).toEqual({ ok: true, held: null })
    expect(await heldBy('worker')).toBeNull()

    // ⚑ THE CONTROL, one fact over: the same choice on an agent with no provider of its own holds.
    anAgent('free')
    expect(sessions.setModelChoice('free', planted)).toBe(true)
    const free = await heldBy('free')
    if (free === null) throw new Error('nothing held')
    expect(aChoiceForAnotherProviderSays(free, null)).toBeNull()
    expect(heldReachesSays(free, null)).toBe(whatAModelChoiceReaches(free))
  })

  /* ─────────────────────────── §4 · the menus of a no-provider agent ── */

  it('🔴 §4 · an agent with no provider of its own offers its CHOICE’s provider’s menus — the provider its agent-started launches run on', async () => {
    anAgent('worker')
    await agents.load()
    // ⚑ The premise: the sheet's *Runs on* resolves to the screen's fallback — `RuntimeScreen`'s own
    // `DEFAULT_PROVIDER`, Codex, a constant local to that component — for a launch a PERSON starts.
    const runsOn = providerForALaunch(agents.identities.value, 'worker', THE_SCREENS_FALLBACK)
    expect(runsOn).toBe('codex')
    // ⚑ An agent with no provider takes a choice for either (`682` F-1)…
    const saved = await agents.chooseModelFor('worker', {
      provider: 'claude',
      model: 'opus',
      effort: null,
    })
    if (!saved.ok || saved.held === null) throw new Error('not saved')
    // 🔴 …and it holds its agent-started launches' PROVIDER (`R31a`), so the menus are Claude's.
    expect(theMenusAreFor(runsOn, null, saved.held)).toBe('claude')
    // ⚑ D-042's words for it (R2): what its new conversations start on.
    expect(heldReachesSays(saved.held, null)).toMatch(
      /^Its new conversations start on this, on Claude/,
    )
    // ⚑ …while the sheet's own note is scoped to the launch it derives from — the one YOU start.
    expect(providerTakesEffectNextTime(runsOn)).toMatch(
      /^The next conversation you start as this identity will run on Codex\. /,
    )
    // ⚑ The clause about a door that asks is for BroBot's own identity alone — the front door asks;
    // `StartAsAgent`, which starts every other identity, does not (round two).
    expect(providerTakesEffectNextTime(runsOn)).not.toContain('unless you choose')
    expect(providerTakesEffectNextTime(runsOn, true)).toContain(
      'will run on Codex, unless you choose another provider where you start it.',
    )

    // ⚑ THE CONTROL, where the readings diverge — the same held choice beside a provider of its own
    // (Codex) is read by nothing, so the menus are the agent's own.
    await providerOf('worker', 'codex')
    // ⚠️ The provider door just CLEARED it (`R31b`, §5) — so the contradiction is planted back.
    expect(sessions.setModelChoice('worker', saved.held)).toBe(true)
    const contradicted = await heldBy('worker')
    expect(theMenusAreFor('codex', 'codex', contradicted)).toBe('codex')
    // ⚑ …and with no choice at all, the resolved one, as 685 built.
    expect(theMenusAreFor('codex', null, null)).toBe('codex')
  })

  /* ─────────────────────────── §5 · what the provider press cleared ── */

  it('🔴 §5 · moving the provider says what the same act CLEARED, from the door’s answer', async () => {
    anAgent('worker')
    await agents.chooseModelFor('worker', { provider: 'claude', model: 'opus', effort: 'high' })
    const moved = await agents.chooseProviderFor('worker', 'codex')
    expect(moved).toEqual({
      ok: true,
      cleared: { provider: 'claude', model: 'opus', effort: 'high' },
    })
    if (!moved.ok || moved.cleared === null) throw new Error('nothing cleared')
    expect(whatTheProviderPressCleared(moved.cleared, 'codex')).toBe(
      'The model and effort chosen for it — “opus” at high effort on Claude — were cleared: a choice is always for its own provider, and its provider is now Codex.',
    )
    // ⚑ And it IS gone — the sentence reports a write, not a guess.
    expect(await heldBy('worker')).toBeNull()

    // ⚑ THE CONTROLS: a move to *nobody has said* keeps the choice, and says nothing…
    await agents.chooseModelFor('worker', {
      provider: 'codex',
      model: 'gpt-5.6-luna',
      effort: null,
    })
    expect(await agents.chooseProviderFor('worker', null)).toEqual({ ok: true, cleared: null })
    expect((await heldBy('worker'))?.model).toBe('gpt-5.6-luna')
    // ⚑ …and so does a move to the choice's OWN provider.
    expect(await agents.chooseProviderFor('worker', 'codex')).toEqual({ ok: true, cleared: null })
    expect((await heldBy('worker'))?.model).toBe('gpt-5.6-luna')
    // ⛔ A refusal carries its sentence and no clearing: a name with no row.
    const refused = await agents.chooseProviderFor('ghost', 'codex')
    expect(refused.ok).toBe(false)
  })
})

/* ═══════════════════════ §6 · D-042 — what `682` set aside now STARTS the conversation ═══════════════════════ */

const WIDE: ModelChoice = { id: 'wide', label: 'Wide', efforts: levels('low', 'high') }
const NARROW: ModelChoice = { id: 'narrow', label: 'Narrow', efforts: levels('low', 'high') }

/** `682`'s double, one list per HOME — the stand-in's and the agent's own can differ. */
class HomeListDouble extends ProviderDouble {
  constructor(
    provider: Provider,
    handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    gate: ResumeGate,
    private readonly lists: Record<string, ModelChoice[]>,
    private readonly started: { provider: Provider; options: StartOptions }[],
  ) {
    super(provider, handles, sessions, gate)
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    this.started.push({ provider: this.provider, options })
    return super.start(options)
  }
  override async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    await super.listModels(context)
    const profile = basename(dirname(context.providerHome))
    return this.lists[`${profile}/${this.provider}`] ?? this.lists['*'] ?? []
  }
}

/**
 * ⚑ **D-042 · re-aimed: `682`'s `model_choice_set_aside` is gone, and with it the row this section
 * drew** (the notice, its reading view and its export). ⚑ Its successor is R1: a conversation
 * starts on its agent's default, BY NAME, records it on its row, and the give's answer says so —
 * and no launch judges that default against the agent's own list again (the re-judge that set it
 * aside). ⚠️ What a provider then makes of a model it does not offer is its own words at that call
 * (D-039), not this app's guess.
 */
describe('696 §6 · D-042 — a default a stand-in’s list admitted is what its conversation STARTS on', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let counter: number
  /** ⚑ Every launch a provider was handed, in order — what was SENT. */
  let started: { provider: Provider; options: StartOptions }[]
  const window = new Window('webContents:1')
  const homes = (): string => join(userData, 'provider-homes')

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-696-aside-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-696-aside-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    counter = 0
    started = []
    const handles: FakeSessionHandle[] = []
    const issued = new FakeProviderSessions()
    const gate = anOpenGate()
    // ⚑ BroBot's home offers `wide`; every other home only `narrow`.
    const lists = { 'brobot/codex': [WIDE, NARROW], 'brobot/claude': [WIDE, NARROW], '*': [NARROW] }
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new HomeListDouble(provider, handles, issued, gate, lists, started),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(homes(), profileId ?? 'brobot', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(homes(), provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      listProfiles: () => [
        'brobot',
        ...(existsSync(homes()) ? readdirSync(homes()).filter((one) => one !== 'brobot') : []),
      ],
      newSessionId: () => `sess_${++counter}`,
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

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<AgentToolAnswer> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return tool.call(args)
  }

  /**
   * A person-made agent, never run, a default saved for it, and a PM that gives it work (D-016) —
   * the helper's conversation and the give's answer, in words.
   */
  const spawnedWithAChoice = async (
    slug: string,
    model: string,
  ): Promise<{ child: string; said: string }> => {
    expect(
      store.createAgentIdentity({ slug, displayName: null, provider: null }, { by: 'a-person' }),
    ).not.toBeNull()
    expect(
      await executeRuntimeCommand(host, window, {
        kind: 'setAgentModelAndEffort',
        profileId: slug,
        provider: 'codex',
        model,
        effort: 'high',
      }),
    ).toMatchObject({ ok: true })
    const { sessionId: pm } = await host.createSession(
      { provider: 'claude', profileId: 'pm', approvalMode: 'ask', cwd: root },
      window,
    )
    const answered = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: slug,
      title: 'work',
      brief: 'work',
    })
    expect((answered.structured as { outcome: string }).outcome, answered.text).toBe('ok')
    return { child: (answered.structured as { agent: string }).agent, said: answered.text }
  }

  /** The conversation as a window opening it folds it — the ledger, replayed. */
  const folded = (sessionId: string) => {
    const state = createTranscript()
    for (const entry of store.events(sessionId)) {
      applyEvent(state, entry.event, entry.at, entry.ordinal)
    }
    return state.items
  }

  /** ⚑ What `682` drew on such a conversation — none may be there. */
  const setAsideRows = (sessionId: string) =>
    folded(sessionId).filter(
      (item) => item.kind === 'notice' && item.text.startsWith('A person chose'),
    )

  it('🔴 the default BroBot’s list admitted is SENT as chosen — named at the launch, recorded on the row, said in the answer — and set aside nowhere', async () => {
    const { child, said } = await spawnedWithAChoice('fresh', 'wide')
    // ⚑ The premise `682` set it aside on: the agent's OWN list — its home exists now — does not
    // offer `wide` (D-042's one list door, asked in that home).
    const its = await host.modelList('codex', 'fresh')
    expect(its.standIn).toBeNull()
    expect(its.models.map((one) => one.id)).toEqual(['narrow'])
    // 🔴 R1 — the launch names the conversation's pair, its agent's default, by name.
    const launches = started.filter((one) => one.provider === 'codex')
    expect(launches).toHaveLength(1)
    expect(launches[0]?.options.model).toBe('wide')
    expect(launches[0]?.options.reasoningEffort).toBe('high')
    // ⚑ …recorded on its row, so every later start replays it…
    expect(store.whatItRunsOn(child)).toMatchObject({ model: 'wide', reasoningEffort: 'high' })
    // ⚑ …and the give's answer says what it runs on, and where that came from (R4, R1's order).
    expect(said).toContain('It runs on “wide” at high effort')
    expect(said).toContain('— its default.')
    // ⛔ …and nothing of `682`'s set-aside reaches the conversation a window folds.
    expect(setAsideRows(child)).toEqual([])
  })

  it('⚑ THE CONTROL — a default its own list offers too starts the same way: whose list judged it changes nothing at the launch', async () => {
    // ⚑ The agent's own list offers `narrow`, so `682` sent it as well — and still does.
    const { child, said } = await spawnedWithAChoice('steady', 'narrow')
    expect((await host.modelList('codex', 'steady')).models.map((one) => one.id)).toEqual([
      'narrow',
    ])
    const launches = started.filter((one) => one.provider === 'codex')
    expect(launches).toHaveLength(1)
    expect(launches[0]?.options.model).toBe('narrow')
    expect(launches[0]?.options.reasoningEffort).toBe('high')
    expect(store.whatItRunsOn(child)).toMatchObject({ model: 'narrow', reasoningEffort: 'high' })
    expect(said).toContain('It runs on “narrow” at high effort')
    expect(setAsideRows(child)).toEqual([])
  })
})
