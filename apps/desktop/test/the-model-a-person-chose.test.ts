import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import {
  FakeRuntime,
  type FakeSessionHandle,
  type ModelChoice,
  type ProviderRuntimeContext,
  type StartOptions,
} from '@brobot2/runtime'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  DEFAULT_CAPABILITIES,
  createSessionStore,
  modelChoiceWritten,
  parseModelChoice,
  type SessionStore,
} from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  type CallerIdentity,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand, noPersonBehindIt } from '../src/main/runtime/ipc'
import {
  admitGive,
  type AdmittedSpawn,
  type GiveAdmission,
  type GiveFacts,
  type GivingConversation,
  type WhatItRunsOn,
} from '../src/main/runtime/spawn-rails'
import { judgeAnAgentsChoice } from '../src/main/runtime/model-rails'
import {
  MODEL_CHOICE_RAILS,
  MODEL_CHOICE_SAID,
  judgeAgainstTheList,
  theList,
  whatAModelChoiceReaches,
  type AgentModelChoice,
} from '../src/shared/model-choice'
import { agentCallerId, whatItRunsOnSaid } from '../src/main/runtime/agent-tools'

/**
 * # 🔴 677 · `R25` — each agent runs on the model and effort a PERSON chose — 🔴 D-042: on its DEFAULT
 *
 * A person may set a model and effort per identity. The model belongs to a provider, and the
 * person’s own launcher retains its choices.
 *
 * 🔴 **D-042 moved three of its facts** (`d042-rulings.md`): R1 — every call names its model and
 * effort, resolved by the HOST in one order (named → the agent's default → the person's last pick →
 * the provider's default BY NAME), so *unset is today's behaviour* is gone: nothing runs on an
 * unnamed default; R2 — a person's choice is the agent's DEFAULT, what its new conversations start
 * on; R4 — a give MAY name a model and an effort, judged by `model-rails.ts`' one seam.
 *
 *  - **§1 · the launch a give starts** — the door takes a model and an effort (R4); a default holds
 *    the PROVIDER of a start (`R31a`). ⚑ The pair a start runs on is the host's (R1), measured in
 *    §4's last block over a real host, where the readings DIVERGE (standing rule 3).
 *  - **§1b · the answer** — `whatItRunsOnSaid`, every arm of D-042's `WhatItRunsOn`.
 *  - **§2 · the order** — the default is a fact about the TARGET, read only after the name is known.
 *  - **§3 · the rule** — `judgeAgainstTheList` (a person's door) and `judgeAnAgentsChoice` (the
 *    agents' seam), against lists shaped like the two the adapters really produce since D-042.
 *  - **§4 · the door** — `setAgentModelAndEffort`, refusing what the list does not hold, over a
 *    real host and a real database; the person gate over the real wire; and R1 at a give's start.
 *  - **§5 · the column** — the fold that reads `agent_identity.model_choice`.
 *
 * ⚠️ **What reaches the PROVIDER, and what a wake does, are in
 * `a-spawn-reaches-the-provider-with-a-persons-model.test.ts`** — real adapters over their seams.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/* ─────────────────────────────────────────────────────── §1 · the launch a give starts ── */

const GIVER: GivingConversation = {
  sessionId: 'sess_parent',
  profileId: 'pm',
  provider: 'claude',
  cwd: '/tmp/677-work',
  approvalMode: 'ask',
}

/** ⚑ The giver speaking as itself — the one caller a give is answered for. */
const BY_THE_GIVER: CallerIdentity = { ownerId: agentCallerId(GIVER.sessionId) }

/** A world in which `pm` gives `worker` work, and `worker` carries `choice`. Every test moves ONE fact. */
function facts(
  choice: AgentModelChoice | null,
  over: Partial<GiveFacts> = {},
): GiveFacts & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    giver: () => GIVER,
    held: () => [{ piece: 'work_root', label: 'W1', root: true, giver: null, received: true }],
    drivenByTheTurn: () => null,
    isAHelper: () => false,
    mayGiveWork: () => null,
    depthOf: () => 0,
    capabilitiesOf: (slug) => (slug === 'pm' || slug === 'worker' ? DEFAULT_CAPABILITIES : null),
    helperAs: () => null,
    serviceAt: () => ({ is: 'normal' }),
    spawningEnabled: () => true,
    mayCreateAgents: () => null,
    itsProvider: () => ({ provider: null, from: 'nothing-yet' }),
    theNamedModelsProvider: () => null,
    modelChoiceOf: (slug) => {
      asked.push(slug)
      // ⚑ D-042 · an agent's DEFAULT — a model for a provider, and the effort it runs at.
      return choice
    },
    checkFolder: (path) => ({ ok: true, path }),
    ...over,
  }
}

const ask = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  definition_of_done: 'The requested result and its checks are recorded.',
  profile: 'worker',
  title: 'the work',
  brief: 'the work this is about',
  ...over,
})

/** The START a give admitted — every other answer fails the test with what it was. */
const started = (out: GiveAdmission): AdmittedSpawn => {
  if (!out.ok) throw new Error(out.refusal.reason)
  if (out.goes.to !== 'a-new-conversation') throw new Error('the give found a conversation')
  return out.goes.start
}

const OPUS_HIGH: AgentModelChoice = { provider: 'claude', model: 'opus', effort: 'high' }
const TERRA_HIGH: AgentModelChoice = { provider: 'codex', model: 'gpt-5.6-terra', effort: 'high' }

describe('677 §1 · the launch a give starts — D-042: the give may name its pair, and a default holds the provider', () => {
  it('🔴 D-042 · R4 — a giver NAMING a model and an effort is admitted, both carried as asked; a provider is still refused by name', () => {
    // ⛔ **Reversed by D-042 · R4** (`677` ruled the door took no model): an agent chooses what its
    // helper's one conversation with it runs on, judged in the host at `model-rails.ts`' one seam
    // (§3) — the door's part is the shape. ⚑ `.strict()` still refuses a key it does not take BY
    // NAME rather than dropping it in silence: a give names no provider (plan ruling 3).
    const named = admitGive(ask({ model: 'haiku', effort: 'low' }), BY_THE_GIVER, facts(OPUS_HIGH))
    if (!named.ok) throw new Error(named.refusal.reason)
    expect(named.asked).toMatchObject({ model: 'haiku', effort: 'low' })
    const out = admitGive(ask({ provider: 'codex' }), BY_THE_GIVER, facts(OPUS_HIGH))
    if (out.ok) throw new Error('admitted a give that named a provider')
    expect(out.refusal.rail).toBe('malformed-request')
    expect(JSON.stringify(out.refusal.detail)).toContain('provider')
    // ⚑ …and a model is bounded shape: an empty name names no model.
    const blank = admitGive(ask({ model: '' }), BY_THE_GIVER, facts(OPUS_HIGH))
    expect(blank.ok ? 'admitted' : blank.refusal.rail).toBe('malformed-request')
  })

  // ⚑ **D-042 · R1 — THE PAIR and WHERE THE READINGS DIVERGE moved to the host** (§4's last block):
  // the start token no longer carries a pair (`AdmittedSpawn.runsOn` is gone); the host resolves
  // one for every start — the agent's default, else the last pick, else the provider's default by
  // name — and the give's answer says it (`GiveOutcome.runsOn`).

  it('🔴 682 · `R31a` — the default holds the PROVIDER: a give starts on its provider, though its giver runs on another', () => {
    const start = started(admitGive(ask(), BY_THE_GIVER, facts(TERRA_HIGH)))
    expect(GIVER.provider).toBe('claude')
    expect(start.provider).toBe('codex')
    // ⚑ D-042 · the pair it starts on there — the default's own — is §4's give, over the host.
  })

  it('🔴 682 · WHERE THE READINGS DIVERGE — the provider is the default’s for a chosen identity, and `419`’s for one nobody chose for (the control)', () => {
    expect(started(admitGive(ask(), BY_THE_GIVER, facts(TERRA_HIGH))).provider).toBe('codex')
    const nobody = started(admitGive(ask(), BY_THE_GIVER, facts(null)))
    expect(nobody.provider).toBe('claude')
    // ⚑ …and with no default, the provider stays `419`'s: the identity's, then the giver's.
    const own = started(
      admitGive(
        ask(),
        BY_THE_GIVER,
        facts(null, { itsProvider: () => ({ provider: 'codex', from: 'saved' }) }),
      ),
    )
    expect(own.provider).toBe('codex')
  })

  it('⛔ 682 · a default NOT IN FORCE — for another provider than the identity’s own, written before `R31b` — holds no provider', () => {
    // ⚑ `677`'s door never compared a choice with the identity's provider, so this pair can exist
    // in a database from before `682`; nothing can write it now (`R31b`).
    const contradicted = facts(TERRA_HIGH, {
      itsProvider: () => ({ provider: 'claude', from: 'saved' }),
    })
    expect(started(admitGive(ask(), BY_THE_GIVER, contradicted)).provider).toBe('claude')
    // ⚑ **D-042** — *"and the answer says so"* is gone with `677`'s sentence for it
    // (`aChoiceForAnotherProvider`): a default not in force is read by nothing, and the start
    // resolves R1's order as though it had none — §4's give measures that pair.
  })

  // ⚑ **D-042 · `682`'s EFFORT-only choice is no default** — a default is a model and the effort it
  // runs at (R1), so the type holds no such value, the wire refuses one (§4) and the fold reads an
  // old one as NULL (§5); §4's give measures a start past it.
})

describe('677 §1b · the launch SAYS what it runs on — `give_work`’s answer (D-042 · R4: *"the give’s answer says what it now runs"*)', () => {
  /** ⚑ D-042's `WhatItRunsOn`, whole — every field, so a test cannot pass on the half it named. */
  const runs = (over: Partial<WhatItRunsOn>): WhatItRunsOn => ({
    provider: 'claude',
    model: 'opus',
    effort: 'high',
    effortReported: false,
    how: 'started',
    from: 'its-default',
    named: { model: false, effort: false },
    ...over,
  })
  const said = (over: Partial<WhatItRunsOn>): string => whatItRunsOnSaid(runs(over))
  const NAMED_BOTH = { model: true, effort: true }

  it('⛔ nothing is added for a conversation that has named no pair yet — the answer is what it was', () => {
    expect(said({ model: null, effort: null, how: 'unchanged', from: null })).toBe('')
  })

  it('🔴 each arm says its own fact, rendered from what was sent', () => {
    // ⚑ A start says where its MODEL came from — R1's order, each source its own words.
    expect(said({})).toBe('It runs on “opus” at high effort (requested) — its default.')
    expect(said({ from: 'named', named: NAMED_BOTH })).toBe(
      'It runs on “opus” at high effort (requested) — as you named.',
    )
    expect(said({ from: 'named', named: { model: true, effort: false } })).toBe(
      'It runs on “opus” at high effort (requested) — the model you named.',
    )
    expect(said({ from: 'the-last-pick', named: { model: false, effort: true } })).toBe(
      'It runs on “opus” at high effort (requested) — the model a person last picked for Claude, at the effort you named.',
    )
    expect(said({ provider: 'codex', model: 'gpt-5.6-terra', from: 'the-providers-default' })).toBe(
      'It runs on “gpt-5.6-terra” at high effort (requested) — Codex’s default.',
    )
    // ⚑ **R5 — "(requested)" only until its provider REPORTS that very effort.**
    expect(said({ effortReported: true })).toBe('It runs on “opus” at high effort — its default.')
    // ⚑ A model whose row offers no effort is said as one, never as an effort it lacks.
    expect(said({ model: 'haiku', effort: null })).toBe(
      'It runs on “haiku”, which offers no effort levels — its default.',
    )
    // ⚑ A conversation it has: switched from this piece on, or left as it runs.
    expect(said({ how: 'switched', from: null, named: NAMED_BOTH })).toBe(
      'It now runs on “opus” at high effort (requested), from this piece on.',
    )
    expect(said({ how: 'unchanged', from: null })).toBe(
      'It runs on “opus” at high effort (requested).',
    )
    // ⚠️ …and a pair it LEFT may be a row from before D-042 that recorded no effort: no claim.
    expect(said({ how: 'unchanged', from: null, model: 'haiku', effort: null })).toBe(
      'It runs on “haiku”.',
    )
    // ⛔ **F1 — a person's pair is kept**, and the answer says which half of the give went unused.
    expect(said({ how: 'a-person-chose-it', from: null, named: NAMED_BOTH })).toBe(
      'It keeps running on “opus” at high effort (requested): a person chose that for this conversation, so the model and effort you named were not used.',
    )
    expect(
      said({ how: 'a-person-chose-it', from: null, named: { model: false, effort: true } }),
    ).toBe(
      'It keeps running on “opus” at high effort (requested): a person chose that for this conversation, so the effort you named was not used.',
    )
    // ⚑ …and a replacement on another provider, whose list never judged the choice.
    expect(
      said({
        provider: 'codex',
        model: 'gpt-5.6-terra',
        how: 'another-provider',
        from: null,
        named: { model: true, effort: false },
      }),
    ).toBe(
      'It runs on “gpt-5.6-terra” at high effort (requested): the conversation that took its place runs on Codex, so the model you named was not used.',
    )
  })
})

/* ────────────────────────────────────────────────────────────── §2 · the order ── */

describe('677 §2 · where the choice is read', () => {
  it('⛔ AFTER `no-such-profile` — and the target’s row is not read for a name that does not exist', () => {
    // ⛔ `a-rail-cannot-read-the-targets-row-before-the-existence-rail`: the choice is a fact about the
    // TARGET, so asking it first would tell a caller which identities exist.
    const world = facts(OPUS_HIGH)
    const out = admitGive(ask({ profile: 'ghost' }), BY_THE_GIVER, world)
    if (out.ok) throw new Error('gave work to a name with no identity')
    expect(out.refusal.rail).toBe('no-such-profile')
    expect(world.asked).toEqual([])
  })
})

/* ─────────────────────────────────────────────────────────────── §3 · the rule ── */

/**
 * Claude's catalogue, as the adapter maps the SDK's since D-042 — the `default` row marked the
 * provider's default, an alias carrying what it points at (`resolvedModel`), `high` the default
 * effort of every row that lists it (F3), and `haiku` left undescribed (measured, 106).
 */
const CLAUDE_ROWS: ModelChoice[] = [
  {
    id: 'default',
    label: 'Default (recommended)',
    efforts: levels('low', 'medium', 'high', 'xhigh', 'max'),
    defaultEffort: 'high',
    isDefault: true,
  },
  {
    id: 'opus',
    label: 'Opus',
    resolvesTo: 'claude-opus-5-5',
    efforts: levels('low', 'medium', 'high', 'xhigh', 'max'),
    defaultEffort: 'high',
  },
  { id: 'haiku', label: 'Haiku' },
]
/** Codex's shape: efforts per model, not the same list for every row, and its default row marked. */
const CODEX_ROWS: ModelChoice[] = [
  {
    id: 'gpt-5.6-terra',
    label: 'terra',
    efforts: levels('low', 'medium', 'high', 'ultra'),
    defaultEffort: 'medium',
    isDefault: true,
  },
  {
    id: 'gpt-5.6-luna',
    label: 'luna',
    efforts: levels('low', 'medium', 'high'),
    defaultEffort: 'medium',
  },
]
function levels(...ids: string[]): { id: string; label: string }[] {
  return ids.map((id) => ({ id, label: id }))
}

describe('677 §3 · the list’s verdict — what the provider listed, and nothing written here', () => {
  it('🔴 a model the list does not hold is refused; one it holds — by its id, or what its alias points at — is admitted', () => {
    expect(judgeAgainstTheList(CLAUDE_ROWS, { model: 'sonnet-9', effort: null })).toBe(
      'model-not-offered',
    )
    expect(judgeAgainstTheList(CLAUDE_ROWS, { model: 'opus', effort: 'high' })).toBeNull()
    // ⚑ **D-042 F5** — what an alias points at is that alias's row, and is sent as named.
    expect(judgeAgainstTheList(CLAUDE_ROWS, { model: 'claude-opus-5-5', effort: 'max' })).toBeNull()
  })

  it('🔴 an effort is judged against THAT model’s row — and an undescribed row offers none', () => {
    expect(judgeAgainstTheList(CLAUDE_ROWS, { model: 'opus', effort: 'max' })).toBeNull()
    // ⛔ `haiku` carries no `efforts`: *the provider did not say* is not *it takes anything*.
    expect(judgeAgainstTheList(CLAUDE_ROWS, { model: 'haiku', effort: 'high' })).toBe(
      'effort-not-offered',
    )
    // ⚑ THE PAIR — and with none named, it is admitted: there is nothing to name.
    expect(judgeAgainstTheList(CLAUDE_ROWS, { model: 'haiku', effort: null })).toBeNull()
    // 🔴 **D-042 · R1 — every call names its effort**: a model that offers efforts is never left
    // without one (`677`'s *leave it to the provider* is gone).
    expect(judgeAgainstTheList(CLAUDE_ROWS, { model: 'opus', effort: null })).toBe(
      'effort-not-offered',
    )
    // ⚑ Per model on Codex: `ultra` is terra's and not luna's.
    expect(judgeAgainstTheList(CODEX_ROWS, { model: 'gpt-5.6-terra', effort: 'ultra' })).toBeNull()
    expect(judgeAgainstTheList(CODEX_ROWS, { model: 'gpt-5.6-luna', effort: 'ultra' })).toBe(
      'effort-not-offered',
    )
  })

  it('⛔ with NO model named, an effort is judged against the model it would run on — the narrow reading, never the menu’s pool', () => {
    // ⚑ **D-042 · the agents' seam** (`model-rails.ts`) — `677`'s no-model intersection
    // (`effortsAChoiceMayName`) went with the effort-only choice; a give naming only an effort runs
    // it on the model that conversation would otherwise run, so THAT row judges it. ⚑ The renderer's
    // `effortsOffered` POOLS, which is right for a menu and wrong for a rail.
    const codex = { rows: theList(CODEX_ROWS, []), notAsked: null }
    const onLuna = judgeAnAgentsChoice(
      { effort: 'ultra' },
      'codex',
      codex,
      { model: 'gpt-5.6-luna', effort: 'high' },
      'give',
    )
    expect(onLuna).toMatchObject({
      ok: false,
      refusal: {
        rail: 'effort-not-offered',
        detail: { model: 'gpt-5.6-luna', effort: 'ultra', efforts: ['low', 'medium', 'high'] },
      },
    })
    expect(
      judgeAnAgentsChoice(
        { effort: 'ultra' },
        'codex',
        codex,
        { model: 'gpt-5.6-terra', effort: 'high' },
        'give',
      ),
    ).toEqual({ ok: true, chosen: { model: 'gpt-5.6-terra', effort: 'ultra' } })
    // …and with no model to run it on, no pool stands in for one: refused, and said.
    const nowhere = judgeAnAgentsChoice({ effort: 'high' }, 'codex', codex, null, 'give')
    expect(nowhere).toMatchObject({ ok: false, refusal: { rail: 'models-unavailable' } })
    // …and a row that describes nothing admits no effort at all.
    const plain = { rows: theList([{ id: 'x', label: 'x' }], []), notAsked: null }
    expect(
      judgeAnAgentsChoice(
        { effort: 'high' },
        'claude',
        plain,
        { model: 'x', effort: null },
        'give',
      ),
    ).toMatchObject({ ok: false, refusal: { rail: 'effort-not-offered', detail: { efforts: [] } } })
  })

  it('⚑ every refusal has a sentence, and each sentence is distinct', () => {
    const said = MODEL_CHOICE_RAILS.map((rail) =>
      MODEL_CHOICE_SAID[rail]({
        profileId: 'worker',
        provider: 'claude',
        model: 'opus',
        effort: 'max',
      }),
    )
    expect(new Set(said).size).toBe(MODEL_CHOICE_RAILS.length)
    for (const sentence of said) expect(sentence.length).toBeGreaterThan(40)
  })

  it('🔴 the sentence beside the control is rendered from the choice, and states every limit', () => {
    const reach = whatAModelChoiceReaches(OPUS_HIGH)
    expect(reach).toContain('on Claude')
    // ⚑ **D-042 · R2 — it is the agent's DEFAULT**: what its NEW conversations start on, whoever
    // starts them.
    expect(reach).toContain(
      'Its new conversations start on this, on Claude — the ones you start and the ones another agent starts for it',
    )
    // ⚑ **R2** — a conversation already open keeps its own: a person's change there stays with it.
    expect(reach).toContain('A conversation already open keeps its own until it is changed there')
    // 🔴 **D-042 · R4** — `682`'s *"cannot pick another provider or model"* is reversed for the
    // model: a giver may name one, for its one conversation.
    expect(reach).toContain(
      'an agent that gives it work may name another for that one conversation',
    )
    expect(reach).not.toContain('cannot pick another provider or model')
    // ⚑ **D-042** — no stand-in's verdict is said any more: no launch judges a default again.
    expect(reach).not.toContain('It was checked against')
    expect(whatAModelChoiceReaches(TERRA_HIGH)).toContain('on Codex')
  })
})

/* ─────────────────────────────────────────────────────────────── §4 · the door ── */

/** A provider whose catalogue is the one above, counted — a probe is a launch — and every START kept. */
class CatalogueDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly rows: () => ModelChoice[] | Error,
    private readonly counts: Record<string, number>,
    private readonly launched: { provider: Provider; options: StartOptions }[],
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
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    this.launched.push({ provider: this.provider, options })
    return super.start(options)
  }
}

class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}
class NobodyBehindIt implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

describe('677 §4 · the door — `setAgentModelAndEffort`, against the provider’s own list', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let folders: Set<string>
  let probes: Record<string, number>
  let refusing: boolean
  /** ⚑ Every `runtime:changed` the host announced — the door's own announcement lands here. */
  let announced: string[]
  /** ⚑ Every launch a provider was handed, with the options the HOST resolved for it. */
  let launched: { provider: Provider; options: StartOptions }[]
  const window = new Window('webContents:1')

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-677-door-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    folders = new Set(['brobot'])
    probes = {}
    refusing = false
    announced = []
    launched = []
    host = new RuntimeHost({
      store,
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
          launched,
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
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /** An identity row, and — unless it has never run — its folder. */
  const anAgent = (slug: string, hasRun = true, provider: Provider | null = null): void => {
    expect(
      store.createAgentIdentity({ slug, displayName: null, provider }, { by: 'a-person' }),
    ).not.toBeNull()
    if (hasRun) folders.add(slug)
  }

  const save = (
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

  it('🔴 THE POSITIVE · a listed model and effort are saved, read back, and read by the next start’s resolution', async () => {
    anAgent('worker')
    const saved = await save('worker', { provider: 'claude', model: 'opus', effort: 'max' })
    // ⚑ **D-042** — `682`'s `standIn` is gone from a choice: no launch judges a default again.
    expect(saved).toEqual({
      ok: true,
      choice: { provider: 'claude', model: 'opus', effort: 'max' },
    })
    expect(
      await executeRuntimeCommand(host, window, {
        kind: 'agentModelAndEffort',
        profileId: 'worker',
      }),
    ).toEqual({ provider: 'claude', model: 'opus', effort: 'max' })
    // ⚑ The column holds the one serialisation, and the fold reads it back whole.
    const stored = db
      .prepare(`SELECT model_choice FROM agent_identity WHERE slug = 'worker'`)
      .get() as {
      model_choice: string
    }
    expect(JSON.parse(stored.model_choice)).toEqual({
      provider: 'claude',
      model: 'opus',
      effort: 'max',
    })
    // ⚑ …and an identity is one NAME however it is spelled (187/238): the reader folds the slug.
    expect(store.modelChoiceOf('Worker')).toEqual({
      provider: 'claude',
      model: 'opus',
      effort: 'max',
    })
    // 🔴 **D-042 · R1 — the next start's fact**: a new conversation of this agent starts on it…
    const list = await executeRuntimeCommand(host, window, {
      kind: 'modelList',
      provider: 'claude',
      profileId: 'worker',
    })
    expect((list as { startsOn: unknown }).startsOn).toEqual({
      model: 'opus',
      effort: 'max',
      from: 'its-default',
    })
    // ⚑ …and **R2 — a person's Save is their last pick on that provider** too.
    expect(store.lastPicked('claude')).toEqual({ model: 'opus', effort: 'max' })
  })

  it('🔴 a model the provider did not list is REFUSED, and nothing is written', async () => {
    anAgent('worker')
    const out = await save('worker', { provider: 'claude', model: 'claude-9-imaginary' })
    expect(out).toMatchObject({ ok: false, rail: 'model-not-offered' })
    expect((out as { reason: string }).reason).toContain('“claude-9-imaginary”')
    expect(store.modelChoiceOf('worker')).toBeNull()
  })

  it('🔴 an effort the model does not list is REFUSED — and the refusal says what it does list', async () => {
    anAgent('worker')
    const luna = await save('worker', { provider: 'codex', model: 'gpt-5.6-luna', effort: 'ultra' })
    expect(luna).toMatchObject({ ok: false, rail: 'effort-not-offered' })
    expect((luna as { detail: { offered: string[] } }).detail.offered).toEqual([
      'low',
      'medium',
      'high',
    ])
    // ⛔ …and a model the provider left undescribed takes NO effort, however ordinary the word.
    const haiku = await save('worker', { provider: 'claude', model: 'haiku', effort: 'high' })
    expect(haiku).toMatchObject({ ok: false, rail: 'effort-not-offered' })
    // ⚑ D-042 · *leave it to the provider* is no longer a value: the act is to leave it out.
    expect((haiku as { reason: string }).reason).toMatch(/^Leave the effort out/)
    expect(store.modelChoiceOf('worker')).toBeNull()
    // ⚑ The pair: the same model with no effort is saved.
    expect(await save('worker', { provider: 'claude', model: 'haiku' })).toEqual({
      ok: true,
      choice: { provider: 'claude', model: 'haiku', effort: null },
    })
    // 🔴 **D-042 · R1** — and an effort left out of a model that OFFERS efforts is that model's own
    // default, NAMED here: never an absence a launch would send.
    expect(await save('worker', { provider: 'codex', model: 'gpt-5.6-luna' })).toEqual({
      ok: true,
      choice: { provider: 'codex', model: 'gpt-5.6-luna', effort: 'medium' },
    })
  })

  it('⛔ a name with no identity is refused BEFORE any provider is asked — a probe is a launch', async () => {
    // ⚑ **A FOLDER with no identity row**, which is the state that makes the order matter: the folder
    // check alone would let this through to a probe (review, round one).
    folders.add('ghost')
    const out = await save('ghost', { provider: 'claude', model: 'opus' })
    expect(out).toMatchObject({ ok: false, rail: 'no-such-agent' })
    expect(probes).toEqual({})
    expect(store.agentIdentities().map((one) => one.slug)).toEqual([])
    // …and a name with neither is the same one answer.
    expect(await save('nobody-made-this', { provider: 'claude', model: 'opus' })).toMatchObject({
      ok: false,
      rail: 'no-such-agent',
    })
  })

  it('🔴 682 · `R31d` — an identity that has NEVER RUN is judged against BroBot’s list, and its own folder is not made', async () => {
    // ⚑ `has-never-run` answered this until `682`. 🔴 **D-042 — and the save is no longer
    // provisional**: `682`'s `standIn` on the choice, and the first launch that judged it again,
    // are gone — a default is judged once, at the door, and every conversation keeps its own pair
    // (R2). ⚑ The stand-in is only WHERE the list was read (`modelList`'s `standIn`).
    anAgent('fresh', false)
    const out = await save('fresh', { provider: 'claude', model: 'opus' })
    expect(out).toEqual({
      ok: true,
      choice: { provider: 'claude', model: 'opus', effort: 'high' },
    })
    // ⚑ The stand-in's list WAS asked — in BroBot's home — and the identity's own folder was not made.
    expect(probes).toEqual({ claude: 1 })
    expect(existsSync(join(userData, 'provider-homes', 'brobot', 'claude'))).toBe(true)
    expect(existsSync(join(userData, 'provider-homes', 'fresh'))).toBe(false)
    expect(
      (
        (await executeRuntimeCommand(host, window, {
          kind: 'modelList',
          provider: 'claude',
          profileId: 'fresh',
        })) as { standIn: string | null }
      ).standIn,
    ).toBe('brobot')
    expect(existsSync(join(userData, 'provider-homes', 'fresh'))).toBe(false)
    // ⛔ …and the stand-in's list still refuses what it does not offer.
    expect(await save('fresh', { provider: 'claude', model: 'claude-9-imaginary' })).toMatchObject({
      ok: false,
      rail: 'model-not-offered',
    })
  })

  it('⚑ a provider that cannot be asked is `models-unavailable`, in the provider’s own words', async () => {
    anAgent('worker')
    refusing = true
    const out = await save('worker', { provider: 'claude', model: 'opus' })
    expect(out).toMatchObject({ ok: false, rail: 'models-unavailable' })
    expect((out as { reason: string }).reason).toContain('not signed in')
  })

  it('⚠️ a cached FAILURE is asked once more on the next Save — one blip does not refuse for the app’s life', async () => {
    anAgent('worker')
    refusing = true
    expect(await save('worker', { provider: 'claude', model: 'opus' })).toMatchObject({
      ok: false,
      rail: 'models-unavailable',
    })
    // ⚑ A failure this Save just met is NOT re-asked at once — a second child for a moment-old answer.
    expect(probes).toEqual({ claude: 1 })
    refusing = false
    // ⛔ …but the NEXT Save finds it cached, forgets it and asks once more.
    expect(await save('worker', { provider: 'claude', model: 'opus' })).toEqual({
      ok: true,
      choice: { provider: 'claude', model: 'opus', effort: 'high' },
    })
    expect(probes).toEqual({ claude: 2 })
    // ⚑ …and a cached SUCCESS is not asked again.
    await save('worker', { provider: 'claude', model: 'haiku' })
    expect(probes).toEqual({ claude: 2 })
  })

  it('⚑ the catalogue is the one-provider read’s: asked once, and under the FOLDER’s own spelling', async () => {
    // ⚑ The folder keeps the case it was made with (187); the identity's slug is folded. The memo is
    // keyed by the folder, so a Save must ask under the folder's spelling or it pays a second child.
    expect(
      store.createAgentIdentity(
        { slug: 'worker', displayName: null, provider: null },
        { by: 'a-person' },
      ),
    ).not.toBeNull()
    folders.add('Worker')
    await Promise.all([
      host.providerModels('Worker', 'claude'),
      host.providerModels('Worker', 'codex'),
    ])
    expect(probes).toEqual({ claude: 1, codex: 1 })
    expect(await save('worker', { provider: 'claude', model: 'opus' })).toMatchObject({ ok: true })
    expect(
      await save('worker', { provider: 'codex', model: 'gpt-5.6-terra', effort: 'high' }),
    ).toMatchObject({ ok: true })
    // ⛔ …and the door re-used both answers: no second child for either provider.
    expect(probes).toEqual({ claude: 1, codex: 1 })
  })

  it('⚑ a CLEAR needs no catalogue — a person can take a choice back while the provider is unreachable', async () => {
    anAgent('worker')
    // ⚑ The choice is written behind the door, so NO catalogue was ever asked or cached — the premise
    // the first version of this test only claimed (review, round one).
    expect(store.setModelChoice('worker', OPUS_HIGH)).toBe(true)
    refusing = true
    expect(await save('worker', { provider: null })).toEqual({ ok: true, choice: null })
    expect(probes).toEqual({})
    expect(store.modelChoiceOf('worker')).toBeNull()
    const stored = db.prepare(`SELECT model_choice FROM agent_identity WHERE slug = 'worker'`).get()
    expect(stored).toEqual({ model_choice: null })
  })

  it('⚑ a save and a clear are ANNOUNCED on `agents` — a second window stops drawing the old choice', async () => {
    anAgent('worker')
    await save('worker', { provider: 'claude', model: 'opus' })
    expect(announced).toEqual(['agents'])
    await save('worker', { provider: null })
    expect(announced).toEqual(['agents', 'agents'])
    // ⚑ …and a REFUSAL announces nothing: nothing moved.
    await save('worker', { provider: 'claude', model: 'not-a-model' })
    expect(announced).toEqual(['agents', 'agents'])
  })

  it('🔴 THE GATE · refused when nobody is behind the channel — and allowed on the window, at the same moment', async () => {
    anAgent('worker')
    const command = {
      kind: 'setAgentModelAndEffort',
      profileId: 'worker',
      provider: 'claude',
      model: 'opus',
      effort: null,
    }
    await expect(executeRuntimeCommand(host, new NobodyBehindIt('mcp:x'), command)).rejects.toThrow(
      noPersonBehindIt('setAgentModelAndEffort'),
    )
    expect(store.modelChoiceOf('worker')).toBeNull()
    await expect(executeRuntimeCommand(host, window, command)).resolves.toMatchObject({ ok: true })
    await expect(
      executeRuntimeCommand(host, new NobodyBehindIt('mcp:x'), {
        kind: 'agentModelAndEffort',
        profileId: 'worker',
      }),
    ).rejects.toThrow(noPersonBehindIt('agentModelAndEffort'))
  })

  it('⛔ a model or an effort with NO provider beside it is refused at the wire — and, D-042, a provider with NO model', async () => {
    anAgent('worker')
    await expect(save('worker', { provider: null, model: 'opus' })).rejects.toThrow(
      /a default is a model for a provider/,
    )
    await expect(save('worker', { provider: null, effort: 'high' })).rejects.toThrow(
      /a default is a model for a provider/,
    )
    // 🔴 **D-042 · R1 — `682`'s effort-only choice is no default**: a default is a model and the
    // effort it runs at, and the provider's own default is a model BY NAME, never an absence.
    await expect(save('worker', { provider: 'claude', effort: 'high' })).rejects.toThrow(
      /a default is a model for a provider/,
    )
    expect(store.modelChoiceOf('worker')).toBeNull()
  })

  /* ── §1 over this host · D-042 · R1 — what a give that names nothing starts on, and says ── */

  describe('§1 · D-042 · R1 — a give that names nothing starts on R1’s pair, and its answer says it', () => {
    /** ⚑ A giver a person opened on Claude, in a folder that exists. */
    const aGiver = async (): Promise<string> => {
      const { sessionId } = await host.createSession(
        { provider: 'claude', profileId: 'pm', cwd: userData },
        window,
      )
      return sessionId
    }
    /** ⚑ The give, naming nothing but the work — its answer's `runsOn`, and the launch it made. */
    const give = async (
      giver: string,
      profile: string,
    ): Promise<{ runsOn: WhatItRunsOn; options: StartOptions; provider: Provider }> => {
      const before = launched.length
      const outcome = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile,
          title: 'the work',
          brief: 'the work this is about',
        },
        { ownerId: agentCallerId(giver) },
      )
      if (!outcome.ok) throw new Error(outcome.refusal.reason)
      const launch = launched
        .slice(before)
        .find((one) => one.options.providerHome.includes(`${sep}${profile}${sep}`))
      if (launch === undefined) throw new Error(`the give to ${profile} started nothing`)
      return { runsOn: outcome.runsOn, options: launch.options, provider: launch.provider }
    }

    it('🔴 THE PAIR · a give naming nothing starts on the agent’s DEFAULT, and says so', async () => {
      anAgent('worker')
      expect(store.setModelChoice('worker', OPUS_HIGH)).toBe(true)
      const { runsOn, options } = await give(await aGiver(), 'worker')
      expect(options.model).toBe('opus')
      expect(options.reasoningEffort).toBe('high')
      expect(runsOn).toEqual({
        provider: 'claude',
        model: 'opus',
        effort: 'high',
        effortReported: false,
        how: 'started',
        from: 'its-default',
        named: { model: false, effort: false },
      })
    })

    it('🔴 WHERE THE READINGS DIVERGE · the identical give, for an identity nobody chose for, names the provider’s default BY NAME — then the last pick', async () => {
      // ⛔ **D-042 · R1 reverses `677`'s *"names NOTHING"***: nothing runs on an unnamed default, so
      // the control is the next entry in R1's order — Claude's own default, by its name.
      anAgent('worker')
      anAgent('plain')
      anAgent('later')
      expect(store.setModelChoice('worker', OPUS_HIGH)).toBe(true)
      const giver = await aGiver()
      expect((await give(giver, 'worker')).options.model).toBe('opus')
      const plain = await give(giver, 'plain')
      expect([plain.options.model, plain.options.reasoningEffort]).toEqual(['default', 'medium'])
      expect(plain.runsOn).toMatchObject({
        model: 'default',
        effort: 'medium',
        from: 'the-providers-default',
      })
      // ⚑ …and once a PERSON has picked on that provider (R2: a Save is their last pick), the same
      // give for another identity nobody chose for starts on that pick.
      expect(await save('worker', { provider: 'claude', model: 'haiku' })).toMatchObject({
        ok: true,
      })
      const later = await give(giver, 'later')
      expect([later.options.model, 'reasoningEffort' in later.options]).toEqual(['haiku', false])
      expect(later.runsOn).toMatchObject({ model: 'haiku', effort: null, from: 'the-last-pick' })
    })

    it('🔴 682 · `R31a` — a default for another provider than the giver’s starts THERE, on its own pair', async () => {
      anAgent('worker')
      expect(store.setModelChoice('worker', TERRA_HIGH)).toBe(true)
      const { runsOn, options, provider } = await give(await aGiver(), 'worker')
      expect(provider).toBe('codex')
      expect([options.model, options.reasoningEffort]).toEqual(['gpt-5.6-terra', 'high'])
      expect(runsOn).toMatchObject({
        provider: 'codex',
        model: 'gpt-5.6-terra',
        from: 'its-default',
      })
    })

    it('⛔ 682 · a default NOT IN FORCE is read by nothing — the start resolves as though it had none', async () => {
      anAgent('worker', true, 'claude')
      // ⚑ The store's own writer is below every door, so the pre-`682` contradiction can be planted.
      expect(store.setModelChoice('worker', TERRA_HIGH)).toBe(true)
      const { runsOn, options, provider } = await give(await aGiver(), 'worker')
      expect(provider).toBe('claude')
      expect([options.model, options.reasoningEffort]).toEqual(['default', 'medium'])
      expect(runsOn).toMatchObject({ from: 'the-providers-default' })
    })

    it('⛔ 682 · an EFFORT-only value from before D-042 is no default — the start runs past it on R1’s next pair', async () => {
      anAgent('worker')
      // ⚑ The one place `682`'s shape can still exist: the column, written before D-042.
      db.prepare(`UPDATE agent_identity SET model_choice = ? WHERE slug = 'worker'`).run(
        '{"provider":"claude","model":null,"effort":"max"}',
      )
      const { runsOn, options } = await give(await aGiver(), 'worker')
      expect([options.model, options.reasoningEffort]).toEqual(['default', 'medium'])
      expect(runsOn).toMatchObject({ effort: 'medium', from: 'the-providers-default' })
    })
  })
})

/* ───────────────────────────────────────────────────────────── §5 · the column ── */

describe('677 §5 · the fold that reads the column', () => {
  it('🔴 the fold: what it cannot read is NULL whole — never a model with a guessed provider', () => {
    expect(parseModelChoice(null)).toBeNull()
    expect(parseModelChoice('{not json')).toBeNull()
    expect(parseModelChoice('"opus"')).toBeNull()
    // ⛔ an unreadable provider takes the model with it — the one fold that could cross providers.
    expect(parseModelChoice('{"provider":"gemini","model":"opus","effort":null}')).toBeNull()
    expect(parseModelChoice('{"model":"opus","effort":"high"}')).toBeNull()
    // ⛔ a half that is not a string is not a choice.
    expect(parseModelChoice('{"provider":"claude","model":7,"effort":null}')).toBeNull()
    expect(parseModelChoice('{"provider":"claude","model":"opus","effort":7}')).toBeNull()
    // ⚑ a choice of nothing is no choice, and blanks are absent halves.
    expect(parseModelChoice('{"provider":"claude","model":null,"effort":null}')).toBeNull()
    expect(parseModelChoice('{"provider":"claude","model":" ","effort":""}')).toBeNull()
    // 🔴 **D-042 · a value naming no model is NULL whole** — `677`'s effort-only value names no model
    // a new conversation could start on (it read `{codex, null, high}` until D-042).
    expect(parseModelChoice('{"provider":"codex","model":"","effort":"high"}')).toBeNull()
    // ⚑ …and a blank EFFORT is a model that offers none.
    expect(parseModelChoice('{"provider":"claude","model":"haiku","effort":""}')).toEqual({
      provider: 'claude',
      model: 'haiku',
      effort: null,
    })
    // ⚑ The positive control: what the writer writes, the fold reads back whole.
    expect(parseModelChoice(modelChoiceWritten(OPUS_HIGH))).toEqual(OPUS_HIGH)
    // 🔴 **D-042 · `682`'s `standIn` key is not read** — no launch judges a default again — so a
    // value `682` wrote reads as the default it names, whatever its `standIn` held.
    expect(
      parseModelChoice('{"provider":"claude","model":"opus","effort":"high","standIn":"brobot"}'),
    ).toEqual(OPUS_HIGH)
    expect(
      parseModelChoice('{"provider":"claude","model":"opus","effort":"high","standIn":7}'),
    ).toEqual(OPUS_HIGH)
    // ⚑ …and the writer writes the three keys alone.
    expect(modelChoiceWritten(OPUS_HIGH)).toBe(
      '{"provider":"claude","model":"opus","effort":"high"}',
    )
    // ⚑ D-042 · `677`'s model-null value is no `AgentModelChoice` (the type requires a model), so its
    // write arm went with it; a clear is NULL.
    expect(modelChoiceWritten(null)).toBeNull()
  })
})
