import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import { FakeRuntime, type ModelChoice, type ProviderRuntimeContext } from '@brobot2/runtime'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { ModelList, RuntimeBridge } from '../src/shared/runtime-ipc'
import { MODEL_CHOICE_SAID, whatAModelChoiceReaches } from '../src/shared/model-choice'
import { createAgentStore, type AgentStore } from '../src/renderer/src/lib/agent-store'
import {
  aChoiceForAnotherProviderSays,
  heldReachesSays,
} from '../src/renderer/src/lib/agent-model-choice'
import {
  createModelLists,
  isNoLongerListed,
  NO_LONGER_LISTED,
  theEffortsOffered,
  thePickerRows,
  type ModelLists,
} from '../src/renderer/src/lib/model-lists'
import { everythingOverTheWire } from './lib/the-wire'

/**
 * # 🔴 685 · a person chooses each agent's model and effort — the control, over the REAL doors
 *
 * ⚑ **`677` built the doors and nothing on screen reached them.** This file drives the renderer's
 * half — `agent-store.ts`' methods, `lib/agent-model-choice.ts`' words and, since UI-012, the
 * model picker's lists (`lib/model-lists.ts`) that `AgentModelChoice.vue` draws — through a real
 * `RuntimeHost` over a real database, with the real wire's clone in front of every call
 * (`everythingOverTheWire`).
 *
 *  - **§1 · set** — a listed model and effort, saved, read back, announced.
 *  - **§2 · clear** — all three `null`, the brief's spelling and the door's.
 *  - **§3 · a refusal** — drawn with the door's `reason`, verbatim. ⚑ UI-012 · the picker drafts only
 *    an effort the model offers, so the pre-press sentence went with the `<select>`s that needed it.
 *  - **§4 · the effort menu** — the NAMED model's own levels. ⚑ **D-042 moved it**: a default is a
 *    model and its effort, so there is no *effort with no model* to take the door's old
 *    intersection of; ⚑ UI-012 · and no pooled menu is left anywhere to diverge from.
 *  - **§5 · an agent that has never run** — whatever the doors answer. ⚑ **Since `682` (`R31d`,
 *    re-aimed by `691`) that is a MENU**: BroBot's own list, marked `standIn`, asked without creating
 *    the agent's folder — and the Save door judges by the same list. ⚑ **D-042 · it stamps nothing
 *    on what it saves**: no launch judges a default again, so nothing calls it provisional.
 *    ⚑ `no-profile` is now reached only by a name with no identity row, and draws the door's
 *    `no-such-agent`.
 *  - **§6 · the folder's own spelling** — the fold, with the control that proves it is load-bearing.
 *  - **§7 · a read that fails** — says so, and is not *nobody has chosen*.
 *
 * ⚠️ **The drawing itself is `test/dom/an-agents-model-on-screen.dom.test.ts`** — a real engine,
 * a real click, and the photographs.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * Claude's shape: one row the provider left undescribed (`haiku`), measured by `677`. ⚑ **D-042 ·
 * the adapter now marks the `default` row `isDefault`** (R1: Claude's default, by name) **and gives
 * every row that lists `high` `defaultEffort: 'high'`** (F3) — `claude-runtime.ts`' `listModels`.
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
  { id: 'haiku', label: 'Haiku' },
]
/**
 * Codex's shape: efforts per model, and not the same list for every row. ⚑ **D-042 · each row's
 * `defaultReasoningEffort` and the server's `isDefault` row** (`modelChoiceOf`) — ⚠️ not the FIRST
 * row here, so a menu that starts on it has read the mark and not the order.
 */
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
function levels(...ids: string[]): { id: string; label: string }[] {
  return ids.map((id) => ({ id, label: id }))
}

/** A provider whose catalogue is one of the above, counted — a probe is a launch. */
class CatalogueDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly rows: () => ModelChoice[] | Error,
    private readonly counts: Record<string, number>,
  ) {
    super(provider)
  }
  override async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    await super.listModels(context)
    this.counts[this.provider] = (this.counts[this.provider] ?? 0) + 1
    const answer = this.rows()
    if (answer instanceof Error) throw answer
    return answer
  }
}

describe('685 · a person chooses each agent’s model and effort — over the real doors', () => {
  let userData: string
  let db: AppDatabase
  let sessions: SessionStore
  let host: RuntimeHost
  let folders: Set<string>
  let probes: Record<string, number>
  let refusing: boolean
  let announced: string[]
  /** ⚑ What the window put on the wire, per command — so a test can assert what was ASKED. */
  let sent: { kind: string; input: Record<string, unknown> }[]
  let agents: AgentStore
  /** ⚑ UI-012 · the picker's lists, over the same wire. */
  let lists: ModelLists

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-685-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    sessions = createSessionStore(db)
    folders = new Set(['brobot'])
    probes = {}
    refusing = false
    announced = []
    sent = []
    host = new RuntimeHost({
      store: sessions,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new CatalogueDouble(
          provider,
          () =>
            refusing
              ? new Error('not signed in')
              : provider === 'claude'
                ? CLAUDE_ROWS
                : CODEX_ROWS,
          probes,
        ),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'brobot', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      listProfiles: () => [...folders],
      announce: ({ what }) => announced.push(what),
      newSessionId: () => `sess_${Math.random().toString(36).slice(2)}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    const sink: RuntimeEventSink = {
      ownerId: 'webContents:1',
      aPersonIsBehindIt: true,
      alive: true,
      send: () => {},
      sendLiveness: () => {},
    }
    const run = async <T>(kind: string, input: Record<string, unknown> = {}): Promise<T> => {
      sent.push({ kind, input })
      return (await executeRuntimeCommand(host, sink, { kind, ...input } as Parameters<
        typeof executeRuntimeCommand
      >[2])) as T
    }
    // ⚑ **The preload's own spellings.**
    const bridge: Partial<RuntimeBridge> = {
      agentIdentities: () => run('agentIdentities'),
      profiles: () => run('profiles'),
      modelList: (input) => run('modelList', { ...input }),
      agentModelAndEffort: (input) => run('agentModelAndEffort', { ...input }),
      setAgentModelAndEffort: (input) => run('setAgentModelAndEffort', { ...input }),
    }
    agents = createAgentStore(everythingOverTheWire(bridge) as RuntimeBridge)
    lists = createModelLists(() => everythingOverTheWire(bridge) as RuntimeBridge)
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /** An identity row, and — unless it has never run — its folder, spelled as given. */
  const anAgent = (slug: string, folder: string | null = slug): void => {
    expect(
      sessions.createAgentIdentity({ slug, displayName: null, provider: null }, { by: 'a-person' }),
    ).not.toBeNull()
    if (folder !== null) folders.add(folder)
  }

  /** ⚑ UI-012 · the list the picker draws, for one provider — the press that opens it. */
  const listFor = async (slug: string, provider: Provider): Promise<ModelList> => {
    await lists.read(provider, slug)
    const held = lists.held(provider, slug)
    if (held?.state !== 'answered') throw new Error(`no list: ${JSON.stringify(held)}`)
    return held.list
  }
  /** ⚑ …and its rows, where the provider answered. */
  const menuFor = async (slug: string, provider: Provider): Promise<ModelList> => {
    const list = await listFor(slug, provider)
    if (list.notAsked !== null) throw new Error(`no menu: ${list.notAsked.reason}`)
    return list
  }

  /* ─────────────────────────────────────────────────────────────── §1 · set ── */

  it('🔴 §1 · SET — the menus are the provider’s, a listed choice is saved, read back and announced', async () => {
    anAgent('worker')
    const list = await menuFor('worker', 'claude')
    // ⚑ The model menu is the catalogue's rows in its order. ⚑ **D-042 · no *provider default*
    // above them**: a default is a model, and the provider's own is a row of the list BY NAME.
    expect(thePickerRows(list, null).map((one) => one.id)).toEqual(['default', 'opus', 'haiku'])
    // ⚑ UI-012 · what the picker's Take hands the door: a model and an effort its row offers.
    const draft = { provider: 'claude' as const, model: 'opus', effort: 'max' }

    const saved = await agents.chooseModelFor('worker', draft)
    // ⚑ **D-042 · the default, whole** — `682`'s `standIn` stamp went with the stand-in re-judge.
    expect(saved).toEqual({
      ok: true,
      held: { provider: 'claude', model: 'opus', effort: 'max' },
    })
    // ⚑ Read back through the read door — what the idle control draws after a re-read.
    expect(await agents.modelChoiceFor('worker')).toEqual({
      held: { provider: 'claude', model: 'opus', effort: 'max' },
    })
    // ⚑ …and announced, which is how another window's sheet re-reads (`RuntimeScreen`'s `agents` arm).
    expect(announced).toContain('agents')

    // 🔴 **The sentence beside the control** — rendered from the choice, and it names the provider.
    if (!saved.ok || saved.held === null) throw new Error('unreachable')
    // ⚑ **D-042 · R2 moved what it says**: it is the agent's DEFAULT — what its NEW conversations
    // start on, whoever starts them — and no longer a rail on the launches another agent causes.
    const reaches = whatAModelChoiceReaches(saved.held)
    expect(reaches).toMatch(
      /^Its new conversations start on this, on Claude — the ones you start and the ones another agent starts for it\./,
    )
    expect(reaches).toContain('A conversation already open keeps its own until it is changed there')
    // ⚑ …and the one thing an agent may still do about it (R4): name another for its one give.
    expect(reaches).toContain(
      'an agent that gives it work may name another for that one conversation',
    )
    // ⚑ D-042 · `682`'s provisional clause is retired with `standIn` (§5), so this case no longer
    // pins its absence here: there is no clause left that could be drawn.
  })

  /* ─────────────────────────────────────────────────────────────── §2 · clear ── */

  it('🔴 §2 · CLEAR — all three `null` on the wire, the column emptied, announced', async () => {
    anAgent('worker')
    await agents.chooseModelFor('worker', { provider: 'claude', model: 'opus', effort: null })
    // ⚑ The premise — something IS held, so the clear below is a clear. ⚑ **D-042 · a blank effort
    // is the model's OWN default, named by the door** (R1), so what is held names it.
    expect(await agents.modelChoiceFor('worker')).toEqual({
      held: { provider: 'claude', model: 'opus', effort: 'high' },
    })
    announced = []
    sent = []
    const cleared = await agents.chooseModelFor('worker', null)
    expect(cleared).toEqual({ ok: true, held: null })
    // ⛔ The brief's spelling and the door's: a clear is the three `null`s, not a missing field.
    expect(sent).toEqual([
      {
        kind: 'setAgentModelAndEffort',
        input: { profileId: 'worker', provider: null, model: null, effort: null },
      },
    ])
    expect(await agents.modelChoiceFor('worker')).toEqual({ held: null })
    expect(announced).toEqual(['agents'])
  })

  /* ─────────────────────────────────────────────────────────────── §3 · a refusal ── */

  it('🔴 §3 · a REFUSAL arrives with the door’s `reason`, verbatim', async () => {
    anAgent('worker')
    const list = await menuFor('worker', 'codex')
    // ⚑ A choice the catalogue does not list — the one the picker keeps as *no longer listed*.
    const gone = { provider: 'codex' as const, model: 'gpt-5.4', effort: null }
    expect(thePickerRows(list, 'gpt-5.4').at(-1)).toEqual({ id: 'gpt-5.4', row: null })
    expect(isNoLongerListed(list, 'gpt-5.4')).toBe(true)
    expect(NO_LONGER_LISTED).toBe('(no longer listed)')
    const out = await agents.chooseModelFor('worker', gone)
    if (out.ok) throw new Error('the door saved a model its provider did not list')
    // ⛔ Verbatim: the store neither rewrites the door's sentence nor wraps it.
    expect(out.reason).toBe(
      MODEL_CHOICE_SAID['model-not-offered']({
        profileId: 'worker',
        provider: 'codex',
        model: 'gpt-5.4',
      }),
    )
    // ⚑ **D-042 · R3 — the list is the provider's rows AND a person's own**, and the sentence says
    // both, with the act first.
    expect(out.reason).toMatch(
      /^Pick a model from the list: “gpt-5\.4” is not in Codex’s list, nor one you added\.$/,
    )
    // ⚑ Nothing was written, and nothing was announced.
    expect(await agents.modelChoiceFor('worker')).toEqual({ held: null })
    expect(announced).not.toContain('agents')

    // ⚑ The pair (standing rule 3): the same call one fact over — a listed model — is admitted,
    // ⚑ **D-042 · at the model's own default effort, named by the door** (R1).
    expect(
      await agents.chooseModelFor('worker', {
        provider: 'codex',
        model: 'gpt-5.6-luna',
        effort: null,
      }),
    ).toEqual({
      ok: true,
      held: { provider: 'codex', model: 'gpt-5.6-luna', effort: 'medium' },
    })
  })

  it('⚑ §3 · an effort the model does not list — the door’s sentence, and the picker offers none', async () => {
    anAgent('worker')
    const list = await menuFor('worker', 'codex')
    const wrong = { provider: 'codex' as const, model: 'gpt-5.6-luna', effort: 'ultra' }
    const out = await agents.chooseModelFor('worker', wrong)
    if (out.ok) throw new Error('saved an effort the model does not list')
    // ⚑ D-042's sentence: the act first, from the model's own row.
    expect(out.reason).toBe(
      'Pick an effort “gpt-5.6-luna” offers: “low”, “medium”, “high”. It does not offer “ultra”.',
    )
    // ⚑ UI-012 · …a level the picker never offers for that model: its levels are the row's own.
    const offered = theEffortsOffered(list, 'gpt-5.6-luna')
    expect(offered.known && offered.levels.map((one) => one.id)).not.toContain('ultra')
  })

  /* ─────────────────────────────────────────────────────────────── §4 · the effort menu ── */

  // ⚑ **D-042 moved this case's subject**: `effortsAChoiceMayName`'s no-model INTERSECTION is gone
  // with a default that names no model (R1: a default is a model and its effort). What it pinned
  // stands one step over — the effort menu is the NAMED model's own levels, and with no model there
  // is no level to pick, where the launcher's pooled menu still offers one the door refuses.
  it('🔴 §4 · the effort menu is the NAMED model’s own levels — and none with no model', async () => {
    anAgent('worker')
    const list = await menuFor('worker', 'codex')
    const levelsOf = (id: string): string[] => {
      const offered = theEffortsOffered(list, id)
      return offered.known ? offered.levels.map((one) => one.id) : []
    }
    expect(levelsOf('gpt-5.6-luna')).toEqual(['low', 'medium', 'high'])
    // ⚑ The door refuses an effort with no model. ⚠️ A draft the picker cannot build (it drafts a
    // model first), sent anyway.
    const pooled = await agents.chooseModelFor('worker', {
      provider: 'codex',
      model: null as unknown as string,
      effort: 'ultra',
    })
    expect(pooled).toMatchObject({ ok: false })
    // ⚑ …refused by the WIRE, for that reason, before any host code runs (`ipc.ts`' refine).
    expect(pooled.ok ? '' : pooled.reason).toContain('a default is a model for a provider')
    // ⚑ A model named: that row's levels exactly, and `terra` does list `ultra`.
    expect(levelsOf('gpt-5.6-terra')).toContain('ultra')
    // ⚑ A row the provider left undescribed offers no level at all (`677`) — known, and none.
    const claude = await menuFor('worker', 'claude')
    expect(theEffortsOffered(claude, 'haiku')).toEqual({ known: true, levels: [] })
  })

  /* ─────────────────────────────────────────────────────────────── §5 · never run ── */

  it('🔴 §5 · an agent that has NEVER RUN has a menu — BroBot’s own list, marked, and no folder made for it', async () => {
    anAgent('fresh', null)
    const list = await menuFor('fresh', 'claude')
    // ⚑ `682` · `R31d` — the list is BroBot's, and each answered list says so.
    expect(list.standIn).toBe('brobot')
    expect(list.models).toEqual(CLAUDE_ROWS.map((row) => ({ ...row, addedBy: 'the-provider' })))
    // ⚑ D-042 · no blank above the rows (§1).
    expect(thePickerRows(list, null).map((one) => one.id)).toEqual(['default', 'opus', 'haiku'])
    // ⛔ A probe is a launch: it ran in BroBot's home, and none was made for `fresh`.
    expect(existsSync(join(userData, 'provider-homes', 'brobot'))).toBe(true)
    expect(existsSync(join(userData, 'provider-homes', 'fresh'))).toBe(false)

    // 🔴 **Whatever the door answers** — it judges by the same list the picker draws.
    const gone = { provider: 'claude' as const, model: 'sonnet-9', effort: null }
    expect(isNoLongerListed(list, 'sonnet-9')).toBe(true)
    const refused = await agents.chooseModelFor('fresh', gone)
    if (refused.ok) throw new Error('saved a model BroBot’s list does not offer')
    expect(refused.reason).toBe(
      'Pick a model from the list: “sonnet-9” is not in Claude’s list, nor one you added.',
    )

    // ⚑ The pair (standing rule 3): a listed model is saved, at its own default effort (D-042 · R1).
    const saved = await agents.chooseModelFor('fresh', {
      provider: 'claude',
      model: 'opus',
      effort: null,
    })
    // 🔴 **D-042 · and NOTHING is stamped on it** — `682`'s `standIn` and its provisional clause
    // are retired with the stand-in re-judge: no launch judges a default again, so the list that
    // judged it here is the verdict, and the clause promised a re-check that no longer happens.
    // ⚑ Whose list it was is said where a person picks from it — above the menus (`the-model-
    // control-reads-r31`).
    expect(saved).toEqual({
      ok: true,
      held: { provider: 'claude', model: 'opus', effort: 'high' },
    })
    if (!saved.ok || saved.held === null) throw new Error('unreachable')
    // ⛔ …and saving it made no folder: only a launch does that.
    expect(existsSync(join(userData, 'provider-homes', 'fresh'))).toBe(false)
    // ⚑ **And the READ door hands back the same default** — what the idle control draws when the
    // sheet is opened again (`691`'s review: the read, not only the save's answer).
    const again = await agents.modelChoiceFor('fresh')
    expect(again).toEqual({ held: { provider: 'claude', model: 'opus', effort: 'high' } })
    if (again === null || again.held === null) throw new Error('unreachable')
    expect(heldReachesSays(again.held, null)).toBe(whatAModelChoiceReaches(again.held))
  })

  it('⚑ §5 · the control: an agent that HAS run is answered from its own home, and nothing is marked', async () => {
    anAgent('worker')
    const list = await menuFor('worker', 'claude')
    expect(list.models.map((row) => row.id)).toEqual(CLAUDE_ROWS.map((row) => row.id))
    expect(list.standIn).toBeNull()
    expect(existsSync(join(userData, 'provider-homes', 'worker'))).toBe(true)
  })

  it('🔴 §5 · `no-profile` — a name with no agent: nothing asked, and the Save door’s own sentence', async () => {
    // ⚑ **The one way this control meets `no-profile` since `682`**: an agent removed while its
    // sheet was open (`removeAgent` takes only one nothing holds, so it never ran and has no
    // folder). ⚠️ `691`'s first draft built this by deleting BroBot's folder from the fixture's
    // list — a world the product cannot make, since `listProfileIds` always lists BroBot's own.
    anAgent('gone', null)
    expect(host.removeAgent('gone')).toMatchObject({ ok: true })
    const list = await listFor('gone', 'claude')
    expect(list.notAsked).toEqual({ ok: false, reason: 'no-profile' })
    expect(probes).toEqual({})
    // 🔴 **Whatever the door answers** — the Save door's own refusal, which the picker draws
    // verbatim (`685` §5's pair, re-aimed from `has-never-run`).
    const door = await agents.chooseModelFor('gone', {
      provider: 'claude',
      model: 'opus',
      effort: null,
    })
    if (door.ok) throw new Error('saved a choice for a name with no agent')
    expect(door.reason).toBe(
      'There is no agent called “gone”, so there is nothing to choose a model for.',
    )
    // ⛔ …and nothing was probed or made for it.
    expect(probes).toEqual({})
    expect(existsSync(join(userData, 'provider-homes', 'gone'))).toBe(false)
  })

  /* ─────────────────────────────────────────────────────────────── §6 · the folder ── */

  it('⚑ §6 · the list is asked under the FOLDER’s own spelling — and the fold is what finds it', async () => {
    anAgent('developer', 'Developer')
    // ⚑ The control: asked by the slug as-is, the host has no such folder and answers `no-profile`.
    expect(await host.providerModels('developer', 'claude')).toEqual({
      ok: false,
      reason: 'no-profile',
    })
    // 🔴 …and D-042's list door finds `Developer/` by the fold (UI-012 · the host's `theListFor`,
    // where the store's own lookup was), so the picker's list is the provider's — asked by the slug.
    sent = []
    const list = await menuFor('developer', 'claude')
    expect(list.models.map((one) => one.id)).toEqual(['default', 'opus', 'haiku'])
    expect(sent.find((one) => one.kind === 'modelList')?.input).toEqual({
      provider: 'claude',
      profileId: 'developer',
    })
  })

  /* ─────────────────────────────────────────────────────────────── §6b · another provider ── */

  it('⚑ §6b · a choice for another provider says it is read by NOTHING — `R31b`, re-aimed by 696', async () => {
    anAgent('worker')
    await agents.chooseModelFor('worker', { provider: 'claude', model: 'opus', effort: null })
    const said = await agents.modelChoiceFor('worker')
    if (said === null || said.held === null) throw new Error('no choice read back')
    expect(aChoiceForAnotherProviderSays(said.held, 'codex')).toBe(
      'It is for Claude, and this agent runs on Codex, so no launch reads it: another agent that starts this one, or whose message starts it, does so as though nobody had chosen. Its picker picks a Codex model in its place, and Clear takes it away.',
    )
    // ⚑ The controls: its own provider, and no provider of its own, add nothing.
    expect(aChoiceForAnotherProviderSays(said.held, 'claude')).toBeNull()
    expect(aChoiceForAnotherProviderSays(said.held, null)).toBeNull()
    // 🔴 **`691` · and the sentence beside it is drawn only for a choice IN FORCE** — main reads
    // nothing of this one, so *"its new conversations start on this, on Claude"* (D-042's words)
    // would be false beside it.
    expect(heldReachesSays(said.held, 'codex')).toBeNull()
    // ⚑ The pair, where the two readings diverge: in force on its own provider, and on none.
    expect(heldReachesSays(said.held, 'claude')).toMatch(
      /^Its new conversations start on this, on Claude/,
    )
    expect(heldReachesSays(said.held, null)).toBe(whatAModelChoiceReaches(said.held))
  })

  /* ─────────────────────────────────────────────────────────────── §7 · failures ── */

  it('⚑ §7 · a provider that cannot be asked — the door’s `models-unavailable`, in the provider’s words, both before and after', async () => {
    anAgent('worker')
    refusing = true
    // ⚑ UI-012 · the list says why its rows are missing, in the provider's words — the picker draws
    // it — and the door says it again on a Save.
    const list = await listFor('worker', 'claude')
    expect(list.notAsked).toEqual({ ok: false, reason: 'refused', detail: 'not signed in' })
    const door = await agents.chooseModelFor('worker', {
      provider: 'claude',
      model: 'opus',
      effort: null,
    })
    expect(door).toEqual({
      ok: false,
      reason:
        'Nothing was saved: Claude could not be asked which models it offers — not signed in.',
    })
  })

  it('⛔ §7 · a READ that fails is `null`, never *nobody has chosen*', async () => {
    const down = everythingOverTheWire({
      agentModelAndEffort: () => Promise.reject(new Error('the wire is down')),
      profiles: () => Promise.reject(new Error('the wire is down')),
      modelList: () => Promise.reject(new Error('the wire is down')),
      setAgentModelAndEffort: () =>
        Promise.reject(
          new Error("Error invoking remote method 'runtime:command': Error: the wire is down"),
        ),
    }) as unknown as RuntimeBridge
    const broken = createAgentStore(down)
    expect(await broken.modelChoiceFor('worker')).toBeNull()
    // ⚑ UI-012 · a list read that threw is UNREAD, with why — never an empty list.
    const brokenLists = createModelLists(() => down)
    await brokenLists.read('claude', 'worker')
    expect(brokenLists.held('claude', 'worker')).toEqual({
      state: 'unread',
      why: 'the wire is down',
    })
    // ⚑ A save that threw arrives as a sentence a person can read — `readableError`'s strip of
    // Electron's wrapper, so the words are the door's and nothing in front of them.
    const out = await broken.chooseModelFor('worker', null)
    expect(out).toEqual({ ok: false, reason: 'the wire is down' })
    // ⚑ The positive control, a store over the real host: a working read answers `{ held }`.
    anAgent('worker')
    expect(await agents.modelChoiceFor('worker')).toEqual({ held: null })
  })
})
