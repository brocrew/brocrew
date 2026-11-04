import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'
import AgentModelChoice from '../../src/renderer/src/components/AgentModelChoice.vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import { createModelLists, type ModelLists } from '../../src/renderer/src/lib/model-lists'
import {
  MODEL_CHOICE_SAID,
  judgeAgainstTheList,
  refuseModelChoice,
  theDefaultEffortOf,
  theEffortsOf,
  theList,
  theListedRow,
  type AgentModelChoice as Choice,
  type ModelChoiceSaved,
} from '../../src/shared/model-choice'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type {
  AgentIdentities,
  AgentIdentity,
  ModelCatalogue,
  ModelChoice,
  ModelList,
  Provider,
  RuntimeBridge,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * # 🔴 685 · the model and effort a person chooses for an agent — on a real screen
 *
 * ⚑ **`an-agents-model-on-screen.test.ts` drives the same words through the real host**; this file
 * is the drawing — a real engine, and since UI-012 the one model picker: a real press on its face,
 * a real click on a row and an effort, a real click on its Take (*Save as its default*).
 *
 * ⚠️ **The fake door below answers with the door's own rule** (`judgeAgainstTheList`,
 * `refuseModelChoice` — `shared/model-choice.ts`; D-042 moved it from `judgeModelChoice`), so a
 * refusal drawn here is the sentence the real door writes, and a test cannot pass on a sentence this
 * file made up.
 *
 * ⚑ **Every section plants a control in the same mount**, and every expected string is a literal.
 */

const levels = (...ids: string[]): { id: string; label: string }[] =>
  ids.map((id) => ({ id, label: id }))
/**
 * ⚑ **D-042 · the adapters' shape**, as the node twin's rows: Claude's `default` row marked
 * `isDefault` and `high` its rows' default effort; Codex's `isDefault` row — ⚠️ not its first — and
 * each row's own default effort.
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

/** ⚑ **D-042 · what the sheet's own sentence says beside a default IN FORCE on Claude** (R2). */
const REACHES_ON_CLAUDE =
  'Its new conversations start on this, on Claude — the ones you start and the ones another agent starts for it. A conversation already open keeps its own until it is changed there, and an agent that gives it work may name another for that one conversation.'

interface World {
  /** ⚑ **The agent's default, as the door holds it** — D-042 took `682`'s `standIn` off it. */
  held: Choice | null
  map: Record<Provider, ModelCatalogue>
  /** Every choice the Save door was sent, as it arrived. */
  sent: unknown[]
  /** ⚑ UI-012 · how many lists the picker asked for — a list read is a probe. */
  modelsAsked: number
  /** ⚑ A refusal the door will answer with instead of judging — `null` to judge. */
  refuseWith: ModelChoiceSaved | null
  readFails: boolean
  /** The agent's own provider column, as the roster answers it. */
  itsProvider: 'claude' | 'codex' | null
}

let world: World

const answered = (): Record<Provider, ModelCatalogue> => ({
  claude: { ok: true, models: CLAUDE_ROWS },
  codex: { ok: true, models: CODEX_ROWS },
})

const reset = (): void => {
  world = {
    held: null,
    map: answered(),
    sent: [],
    modelsAsked: 0,
    refuseWith: null,
    readFails: false,
    itsProvider: null,
  }
}

const ident = (slug: string): AgentIdentity =>
  ({
    id: `aid:${slug}`,
    slug,
    displayName: null,
    role: null,
    createdAt: 1_700_000_000_000,
    createdBy: null,
    provider: null,
    externalMcpServerIds: [],
    capabilities: DEFAULT_CAPABILITIES,
    chosen: Object.fromEntries(Object.keys(DEFAULT_CAPABILITIES).map((key) => [key, 'default'])),
  }) as unknown as AgentIdentity

/** A new object every read, as the real door answers — so a roster re-read is a CHANGE. */
const roster = (): AgentIdentities =>
  ({
    identities: [{ ...ident('worker'), provider: world.itsProvider }],
    foldersWithoutARow: [],
    // ⚑ What the agent runs on, as the host folds it: its saved provider, and no conversation yet.
    use: [
      {
        slug: 'worker',
        conversations: 0,
        thisAppMintsIt: false,
        isLaunching: false,
        isStarting: false,
        runsOn:
          world.itsProvider === null
            ? { provider: null, from: 'nothing-yet' }
            : { provider: world.itsProvider, from: 'saved' },
      },
    ],
    spawningEnabled: true,
    defaultApprovalMode: 'ask',
  }) as unknown as AgentIdentities

/** ⚑ UI-012 · D-042's list door, answering from `world.map` as the host composes a list. */
const listOf = (provider: Provider): ModelList => {
  const catalogue = world.map[provider]
  return {
    provider,
    notAsked: catalogue.ok ? null : catalogue,
    standIn: catalogue.ok ? (catalogue.standIn ?? null) : null,
    models: theList(catalogue.ok ? catalogue.models : [], []),
    lastPicked: null,
    startsOn: null,
  }
}

function bridgeOver(): RuntimeBridge {
  return {
    agentIdentities: async () => roster(),
    profiles: async () => ['brobot', 'worker'],
    modelList: async ({ provider }: { provider: Provider }) => {
      world.modelsAsked += 1
      return listOf(provider)
    },
    agentModelAndEffort: async () => {
      if (world.readFails) throw new Error('the read failed')
      return world.held
    },
    setAgentModelAndEffort: async (input: {
      profileId: string
      provider: Choice['provider'] | null
      model: string | null
      effort: string | null
    }): Promise<ModelChoiceSaved> => {
      // ⚑ Cloned the way the real bridge clones — a Proxy on this wire is a red, not a repair.
      world.sent.push(structuredClone(input))
      if (world.refuseWith !== null) return world.refuseWith
      if (input.provider === null) {
        world.held = null
        return { ok: true, choice: null }
      }
      // ⚑ **D-042 · the wire's own refine**: a provider names a model.
      if (input.model === null) throw new Error('a default is a model for a provider')
      const catalogue = world.map[input.provider]
      if (!catalogue.ok)
        return refuseModelChoice('models-unavailable', { profileId: input.profileId })
      // ⚑ **D-042 · the real door's order** — the list's row, a blank effort named as the model's
      // own default, then `judgeAgainstTheList`.
      const row = theListedRow(catalogue.models, input.model)
      const pair = { model: input.model, effort: input.effort ?? theDefaultEffortOf(row) }
      const wrong = judgeAgainstTheList(catalogue.models, pair)
      if (wrong !== null) {
        return refuseModelChoice(wrong, {
          profileId: input.profileId,
          provider: input.provider,
          model: input.model,
          ...(input.effort === null ? {} : { effort: input.effort }),
          ...(wrong === 'effort-not-offered' ? { offered: theEffortsOf(row) } : {}),
        })
      }
      const saved: Choice = { provider: input.provider, ...pair }
      world.held = saved
      return { ok: true, choice: saved }
    },
  } as unknown as RuntimeBridge
}

/** ⚑ The store and the picker's lists, over ONE bridge — the window's two holders. */
function storeOver(): { store: AgentStore; lists: ModelLists } {
  const bridge = bridgeOver()
  return { store: createAgentStore(bridge), lists: createModelLists(() => bridge) }
}

afterEach(async () => {
  unmountAll()
  await page.viewport(1100, 900)
})

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

const words = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

async function control(
  runsOn: 'claude' | 'codex' = 'claude',
  itsProvider: 'claude' | 'codex' | null = null,
): Promise<{ m: Mounted; store: AgentStore }> {
  const { store, lists } = storeOver()
  await store.load()
  const m = mount(
    AgentModelChoice,
    { profileSlug: 'worker', runsOn, itsProvider, store, lists },
    { width: 620, height: 400 },
  )
  await settle()
  return { m, store }
}

async function press(m: Mounted, cy: string): Promise<void> {
  m.q(cy).click()
  await settle()
}

/* ── UI-012 · the picker's own gestures ── */

/** The face — what the control shows, and the press that opens its panel. */
const face = (m: Mounted): string => words(m.q('model-picker-face'))

/** Every model row the open panel lists, by its id. */
const rows = (m: Mounted): string[] =>
  m.all('model-picker-row').map((row) => row.dataset.model ?? '')

/** Every effort level the open panel offers for the drafted model. */
const efforts = (m: Mounted): string[] =>
  m.all('model-picker-effort').map((level) => level.dataset.effort ?? '')

/** The drafted model, or `null`. */
const drafted = (m: Mounted): string | null =>
  m.all('model-picker-row').find((row) => row.querySelector('input')?.checked)?.dataset.model ??
  null

/** The drafted effort, or `null`. */
const draftedEffort = (m: Mounted): string | null =>
  m.all('model-picker-effort').find((level) => level.querySelector('input')?.checked)?.dataset
    .effort ?? null

async function draft(m: Mounted, id: string): Promise<void> {
  const row = m.all('model-picker-row').find((one) => one.dataset.model === id)
  expect(row, `no row ${id}`).toBeDefined()
  row!.querySelector('input')!.click()
  await settle()
}

async function draftEffort(m: Mounted, id: string): Promise<void> {
  const level = m.all('model-picker-effort').find((one) => one.dataset.effort === id)
  expect(level, `no level ${id}`).toBeDefined()
  level!.querySelector('input')!.click()
  await settle()
}

const takeIsDead = (m: Mounted): boolean => (m.q('model-picker-take') as HTMLButtonElement).disabled

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('685 §1 · the control, idle — it asks no provider anything until a person presses', () => {
  it('🔴 nobody has chosen: the words, one press, and NO probe on mount', async () => {
    reset()
    const { m } = await control()
    expect(face(m)).toBe('Nobody has chosen')
    expect(m.all('agent-model-clear')).toHaveLength(0)
    expect(m.all('agent-model-reaches')).toHaveLength(0)
    // ⛔ A list read is a probe, and a probe is a launch.
    expect(world.modelsAsked).toBe(0)
    await press(m, 'model-picker-face')
    // ⚑ The control: the press is what asks.
    expect(world.modelsAsked).toBe(1)
  })

  it('🔴 a held choice is drawn as stored, with the sentence beside it', async () => {
    reset()
    world.held = { provider: 'claude', model: 'opus', effort: 'max' }
    const { m } = await control()
    expect(face(m)).toBe('opus · max')
    // ⚑ **D-042 · R2's sentence** — what the agent's NEW conversations start on.
    expect(words(m.q('agent-model-reaches'))).toBe(REACHES_ON_CLAUDE)
    expect(m.all('agent-model-clear')).toHaveLength(1)
    // ⚑ **696** · it is in force. ⚑ D-042 · the row names no list at all: `682`'s stand-in mark
    // went with the stand-in re-judge (the next case).
    expect(m.all('agent-model-not-in-force')).toHaveLength(0)
  })

  // ⚑ **D-042 · re-aimed: `682`'s PROVISIONAL row is gone with the stand-in re-judge** — no launch
  // judges a default again, so a default saved from BroBot's list is the verdict, and the clause
  // that promised a later check would be false. ⚑ What stands of `691`'s pin: whose list it is is
  // said ABOVE THE LIST, before a press, and the held row reads as any default.
  it('🔴 a default held for an agent with no list of its own is drawn as any other — its picker says whose list it is', async () => {
    reset()
    world.map = {
      claude: { ok: true, models: CLAUDE_ROWS, standIn: 'brobot' },
      codex: { ok: true, models: CODEX_ROWS, standIn: 'brobot' },
    }
    world.held = { provider: 'claude', model: 'opus', effort: 'max' }
    const { m } = await control()
    const idle = words(m.q('agent-model-reaches'))
    expect(idle).toBe(REACHES_ON_CLAUDE)
    await press(m, 'model-picker-face')
    // ⚑ **696** · the picker says whose list it is, NAMED — `agentName`, never the slug.
    expect(words(m.q('model-picker-note'))).toBe(
      'This is BroBot’s list: this agent has no list of its own to ask.',
    )
    // ⚑ …and with nothing changed, the words before Save are the held row's.
    expect(drafted(m)).toBe('opus')
    expect(words(m.q('model-picker-reaches'))).toBe(idle)
  })

  // ⚑ **D-042 · re-aimed: *an effort chosen alone* is gone** — a default is a model and its effort
  // (R1). What the row drew for a half nobody named stands for the one half that may be empty: a
  // model that offers no effort level — ⚑ UI-012 · the face names the model alone.
  it('⚑ a held model that offers no effort level says so, in the effort’s place', async () => {
    reset()
    world.held = { provider: 'claude', model: 'haiku', effort: null }
    const { m } = await control()
    expect(face(m)).toBe('haiku')
    expect(words(m.q('agent-model-reaches'))).toBe(REACHES_ON_CLAUDE)
    await press(m, 'model-picker-face')
    expect(efforts(m)).toEqual([])
    expect(words(m.q('model-picker-effort-none'))).toBe('“haiku” has no effort levels.')
  })
})

describe('685 §2 · set — the list is the provider’s, and Save sends the choice', () => {
  it('🔴 pick a model and an effort, see what it will reach, Save — and the row is what the door read back', async () => {
    reset()
    const { m } = await control()
    await press(m, 'model-picker-face')
    // ⚑ UI-012 · the list, in the provider's order — and nothing drafted: nobody has chosen, so
    // Take waits for a pick.
    expect(rows(m)).toEqual(['default', 'opus', 'haiku'])
    expect(drafted(m)).toBeNull()
    expect(takeIsDead(m)).toBe(true)
    await draft(m, 'opus')
    expect(efforts(m)).toEqual(['low', 'medium', 'high', 'max'])
    // ⚑ D-042 · R1 — a model drafted alone runs at its own default effort, named.
    expect(draftedEffort(m)).toBe('high')
    await draftEffort(m, 'max')
    // 🔴 The sentence beside the control is rendered from the DRAFT before the press.
    expect(words(m.q('model-picker-reaches'))).toBe(REACHES_ON_CLAUDE)
    expect(takeIsDead(m)).toBe(false)
    await press(m, 'model-picker-take')
    expect(world.sent).toEqual([
      { profileId: 'worker', provider: 'claude', model: 'opus', effort: 'max' },
    ])
    expect(face(m)).toBe('opus · max')
    expect(m.all('model-picker-row')).toHaveLength(0)
    expect(m.all('model-picker-refusal')).toHaveLength(0)
  })

  // ⚑ **D-042 · re-aimed: there is no *no model named*** effort menu. What it pinned stands: the
  // levels are the MODEL's own, so `ultra` is not offered until a model that lists it is drafted.
  it('🔴 the effort levels are the drafted model’s own — `ultra` is not offered until a model lists it', async () => {
    reset()
    const { m } = await control('codex')
    await press(m, 'model-picker-face')
    expect(rows(m)).toEqual(['gpt-5.6-terra', 'gpt-5.6-luna'])
    await draft(m, 'gpt-5.6-luna')
    expect(efforts(m)).toEqual(['low', 'medium', 'high'])
    // ⚑ The control: the one model that lists `ultra` offers it once drafted.
    await draft(m, 'gpt-5.6-terra')
    expect(efforts(m)).toContain('ultra')
    // ⛔ …and moving to a model that does not list the drafted level drops it, for that model's own
    // default — the host's rule, so what the panel shows is what runs.
    await draftEffort(m, 'ultra')
    await draft(m, 'gpt-5.6-luna')
    expect(draftedEffort(m)).toBe('medium')
  })

  it('⚑ an undescribed row offers no effort level at all', async () => {
    reset()
    const { m } = await control()
    await press(m, 'model-picker-face')
    await draft(m, 'haiku')
    expect(efforts(m)).toEqual([])
    expect(takeIsDead(m)).toBe(false)
  })
})

describe('685 §2 · a choice held for ANOTHER provider', () => {
  // ⚠️ **696 · *another provider* means another than the AGENT's own** (`R31b`), so these mount the
  // agent's own provider: with none, a Claude choice is in force and the list is Claude's
  // (`696`'s own file, `the-model-control-reads-r31`).
  it('⚑ the picker opens on the provider the sheet resolves, not seeded from a choice it cannot hold', async () => {
    reset()
    world.held = { provider: 'claude', model: 'opus', effort: 'max' }
    const { m } = await control('codex', 'codex')
    // ⚑ The row says what is stored, and for which provider.
    expect(words(m.q('agent-model-held'))).toContain('“opus” at max effort on Claude')
    expect(face(m)).toBe('Nobody has chosen')
    await press(m, 'model-picker-face')
    // ⚑ Codex's list — never the Claude choice, which it cannot hold.
    expect(rows(m)).toEqual(['gpt-5.6-terra', 'gpt-5.6-luna'])
    expect(drafted(m)).toBeNull()
    // ⛔ **…and Save is never a silent clear** (`685`'s review): it sends the replacement the
    // row's own sentence promises (*"Its picker picks a Codex model in its place"*).
    await draft(m, 'gpt-5.6-luna')
    await press(m, 'model-picker-take')
    expect(world.sent).toEqual([
      { profileId: 'worker', provider: 'codex', model: 'gpt-5.6-luna', effort: 'medium' },
    ])
    expect(face(m)).toBe('gpt-5.6-luna · medium')

    // ⚑ THE CONTROL — a list with no rows leaves NO model to pick: Take is dead.
    unmountAll()
    reset()
    world.held = { provider: 'claude', model: 'opus', effort: 'max' }
    world.map = { ...answered(), codex: { ok: true, models: [] } }
    const empty = await control('codex', 'codex')
    await press(empty.m, 'model-picker-face')
    expect(rows(empty.m)).toEqual([])
    expect(takeIsDead(empty.m)).toBe(true)
    await press(empty.m, 'model-picker-take')
    expect(world.sent).toEqual([])
  })

  it('⚑ the row says a choice not in force is read by NOTHING — `R31b`, re-aimed by 696', async () => {
    reset()
    world.held = { provider: 'claude', model: 'opus', effort: 'max' }
    const { m } = await control('codex', 'codex')
    expect(words(m.q('agent-model-not-in-force'))).toBe('not in force')
    expect(words(m.q('agent-model-other-provider'))).toBe(
      'It is for Claude, and this agent runs on Codex, so no launch reads it: another agent that starts this one, or whose message starts it, does so as though nobody had chosen. Its picker picks a Codex model in its place, and Clear takes it away.',
    )
    // 🔴 **`691` · and no sentence claiming the choice holds its launches** — main reads nothing of
    // a choice not in force (`R31b`), so *"its new conversations start on this, on Claude"*
    // (D-042's words) would be false here.
    expect(m.all('agent-model-reaches')).toHaveLength(0)
    // ⚑ The control: an agent with no provider of its own can land on either — nothing to add, and
    // the choice holds, so the sentence is drawn.
    unmountAll()
    const none = await control('codex', null)
    expect(none.m.all('agent-model-other-provider')).toHaveLength(0)
    expect(none.m.all('agent-model-not-in-force')).toHaveLength(0)
    expect(words(none.m.q('agent-model-reaches'))).toBe(REACHES_ON_CLAUDE)
  })

  it('⚑ *Runs on* moving while the picker is open re-seeds it from a choice that is now its own', async () => {
    reset()
    world.held = { provider: 'claude', model: 'opus', effort: 'max' }
    const { store, lists } = storeOver()
    await store.load()
    // ⚠️ **696** · the sheet moves BOTH — `runsOn` is resolved from the agent's own provider — and
    // with no provider of its own the Claude choice would hold the list from the start.
    const runsOn = ref<'claude' | 'codex'>('codex')
    const m = mount(
      defineComponent({
        setup: () => () =>
          h(AgentModelChoice, {
            profileSlug: 'worker',
            runsOn: runsOn.value,
            itsProvider: runsOn.value,
            store,
            lists,
          }),
      }),
      {},
      { width: 620, height: 400 },
    )
    await settle()
    await press(m, 'model-picker-face')
    // ⚑ Codex's list — not seeded from the Claude choice, which it cannot hold.
    expect(rows(m)).toEqual(['gpt-5.6-terra', 'gpt-5.6-luna'])
    expect(drafted(m)).toBeNull()
    runsOn.value = 'claude'
    await settle()
    expect(drafted(m)).toBe('opus')
    expect(draftedEffort(m)).toBe('max')
  })
})

describe('685 §3 · clear — all three `null`', () => {
  it('🔴 Clear sends the three nulls and the row says nobody has chosen', async () => {
    reset()
    world.held = { provider: 'claude', model: 'opus', effort: 'high' }
    const { m } = await control()
    await press(m, 'agent-model-clear')
    expect(world.sent).toEqual([{ profileId: 'worker', provider: null, model: null, effort: null }])
    expect(face(m)).toBe('Nobody has chosen')
    expect(m.all('agent-model-reaches')).toHaveLength(0)
  })
})

describe('685 §4 · a refusal — drawn with the door’s `reason`', () => {
  it('🔴 a refused Save draws the reason, verbatim, and leaves the picker open', async () => {
    reset()
    const { m } = await control()
    await press(m, 'model-picker-face')
    await draft(m, 'opus')
    // ⚑ The world moved between the list and the press — the provider stopped answering.
    world.refuseWith = refuseModelChoice('models-unavailable', {
      profileId: 'worker',
      provider: 'claude',
      why: 'not signed in',
    })
    await press(m, 'model-picker-take')
    const alert = m.q('model-picker-refusal')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(words(alert)).toBe(
      'Nothing was saved: Claude could not be asked which models it offers — not signed in.',
    )
    expect(rows(m)).toHaveLength(3)
    expect(face(m)).toBe('Nobody has chosen')
    // ⚑ The control: the same press once the door admits it draws no refusal.
    world.refuseWith = null
    await press(m, 'model-picker-take')
    expect(m.all('model-picker-refusal')).toHaveLength(0)
    expect(face(m)).toBe('opus · high')
  })

  it('🔴 a held model the provider no longer lists: kept, marked, and the door’s sentence on the press', async () => {
    reset()
    world.held = { provider: 'codex', model: 'gpt-5.4', effort: null }
    const { m } = await control('codex')
    await press(m, 'model-picker-face')
    const kept = m.all('model-picker-row').find((row) => row.dataset.model === 'gpt-5.4')
    expect(words(kept ?? null)).toMatch(/^gpt-5\.4/)
    expect(words(kept ?? null)).toContain('(no longer listed)')
    expect(drafted(m)).toBe('gpt-5.4')
    // ⚑ UI-012 · the door judges it, and its words are drawn verbatim in the open panel.
    await press(m, 'model-picker-take')
    expect(words(m.q('model-picker-refusal'))).toBe(
      MODEL_CHOICE_SAID['model-not-offered']({
        profileId: 'worker',
        provider: 'codex',
        model: 'gpt-5.4',
      }),
    )
    // ⚑ D-042's sentence: the list is the provider's rows and a person's own (R3).
    expect(words(m.q('model-picker-refusal'))).toBe(
      'Pick a model from the list: “gpt-5.4” is not in Codex’s list, nor one you added.',
    )
    // ⚑ The control: a listed model — saved, and the refusal goes.
    await draft(m, 'gpt-5.6-luna')
    await press(m, 'model-picker-take')
    expect(m.all('model-picker-refusal')).toHaveLength(0)
    expect(face(m)).toBe('gpt-5.6-luna · medium')
  })
})

describe('685 §5 · an agent that has never run, and no list', () => {
  it('🔴 an agent that has never run HAS a list since `682` — BroBot’s own, said above it before the press', async () => {
    // ⚑ `691` · re-aimed from 677's `has-never-run` sentence, which `682` (`R31d`) retired: the list
    // door answers such an agent from BroBot's home and marks it `standIn`. ⚑ **D-042** · the saved
    // row does not say so: whose list it was is said where a person picks from it.
    reset()
    world.map = {
      claude: { ok: true, models: CLAUDE_ROWS, standIn: 'brobot' },
      codex: { ok: true, models: CODEX_ROWS, standIn: 'brobot' },
    }
    const { m } = await control()
    await press(m, 'model-picker-face')
    expect(words(m.q('model-picker-note'))).toBe(
      'This is BroBot’s list: this agent has no list of its own to ask.',
    )
    expect(rows(m)).toEqual(['default', 'opus', 'haiku'])
    await draft(m, 'opus')
    await press(m, 'model-picker-take')
    // ⚑ The picker names the model's own default effort (D-042 · R1), as the door would.
    expect(world.sent).toEqual([
      { profileId: 'worker', provider: 'claude', model: 'opus', effort: 'high' },
    ])
    expect(face(m)).toBe('opus · high')
    // 🔴 …and the saved row reads as §1's, whose own home answered: the same sentence, no clause.
    expect(words(m.q('agent-model-reaches'))).toBe(REACHES_ON_CLAUDE)
  })

  it('⚑ `no-profile` — no list, no Take, and Cancel', async () => {
    // ⚑ Since `682` this control meets `no-profile` only for a name with no identity row — an
    // agent removed while its sheet was open.
    reset()
    world.map = {
      claude: { ok: false, reason: 'no-profile' },
      codex: { ok: false, reason: 'no-profile' },
    }
    const { m } = await control()
    await press(m, 'model-picker-face')
    expect(m.all('model-picker-said')).toHaveLength(1)
    // ⚑ W4.78 · the words too: *nothing was asked* is not *it listed none* (685 M7).
    expect(words(m.q('model-picker-said'))).toBe(
      'The model list arrives once this profile exists — it is created when the conversation starts, not now.',
    )
    expect(rows(m)).toEqual([])
    expect(takeIsDead(m)).toBe(true)
    await press(m, 'model-picker-cancel')
    expect(m.all('model-picker-row')).toHaveLength(0)
    expect(face(m)).toBe('Nobody has chosen')
  })

  it('⚑ the list is for the provider the sheet resolves — Codex answered while Claude refused', async () => {
    reset()
    world.map = {
      claude: { ok: false, reason: 'refused', detail: 'not signed in' },
      codex: { ok: true, models: CODEX_ROWS },
    }
    const onClaude = await control('claude')
    await press(onClaude.m, 'model-picker-face')
    expect(words(onClaude.m.q('model-picker-said'))).toContain(
      "Claude isn't set up. Set it up in Settings → Providers.",
    )
    // ⚑ The control: the same answer, read for the other provider, is a list.
    const onCodex = await control('codex')
    await press(onCodex.m, 'model-picker-face')
    expect(rows(onCodex.m)).toEqual(['gpt-5.6-terra', 'gpt-5.6-luna'])
  })
})

describe('W4.78 · a model that offers efforts and names none — Take waits for a pick', () => {
  /**
   * ⚑ A row with levels and no default of its own, beside a list whose default effort it does not
   * offer: nothing names an effort, so the picker says the door's own sentence before the press and
   * Take stays dead until a level is picked (685 M3, M4, M16 — re-anchored on the picker by W4.78).
   */
  it('🔴 the door’s sentence names the model, Take is dead — and a picked level arms it', async () => {
    reset()
    world.map = {
      ...answered(),
      codex: {
        ok: true,
        models: [
          ...CODEX_ROWS,
          { id: 'gpt-5.6-astra', label: 'astra', efforts: levels('low', 'ultra') },
        ],
      },
    }
    const { m } = await control('codex')
    await press(m, 'model-picker-face')
    await draft(m, 'gpt-5.6-astra')
    expect(efforts(m)).toEqual(['low', 'ultra'])
    expect(draftedEffort(m)).toBeNull()
    expect(words(m.q('model-picker-effort-wanted'))).toBe(
      'Pick an effort “gpt-5.6-astra” offers: “low”, “ultra”.',
    )
    expect(takeIsDead(m), 'Take was alive with no effort named').toBe(true)
    // ⚑ The control: a level picked, the sentence goes and Take is armed.
    await draftEffort(m, 'ultra')
    expect(m.all('model-picker-effort-wanted')).toHaveLength(0)
    expect(takeIsDead(m)).toBe(false)
  })
})

describe('685 §6 · re-read when the roster is — `runtime:changed agents` reaches this sheet', () => {
  it('🔴 a choice made in another window is drawn on the next roster read — and not under an open draft', async () => {
    reset()
    const { m, store } = await control()
    expect(face(m)).toBe('Nobody has chosen')
    // ⚑ Another window saved; the door announced `agents`; this window re-read the roster.
    world.held = { provider: 'claude', model: 'haiku', effort: null }
    await store.load()
    await settle()
    expect(face(m)).toBe('haiku')
    // ⛔ …and a person mid-edit keeps their draft — a re-read moves the held choice, never the draft.
    await press(m, 'model-picker-face')
    await draft(m, 'opus')
    world.held = { provider: 'claude', model: 'default', effort: 'high' }
    await store.load()
    await settle()
    expect(drafted(m)).toBe('opus')
  })

  it('⛔ a read that fails says so — it is not *nobody has chosen*', async () => {
    reset()
    world.readFails = true
    const { m } = await control()
    expect(words(m.q('agent-model-unreadable'))).toBe(
      'This app could not read the model chosen for this agent. Close and open this again.',
    )
    // ⛔ …and the row claims nothing it never learned (`685`'s review): no *Nobody has chosen*, and
    // no picker over a choice this window could not read.
    expect(words(m.q('agent-model-unknown'))).toBe('Not known')
    expect(m.all('model-picker-face')).toHaveLength(0)
    // ⚑ The control: a read that answers draws no such line.
    reset()
    const again = await control()
    expect(again.m.all('agent-model-unreadable')).toHaveLength(0)
  })
})

describe('685 §7 · where it is — beside the provider choice on the agent’s sheet', () => {
  it('⚑ the sheet hands the control the agent’s OWN provider — so a choice for another says so', async () => {
    reset()
    world.itsProvider = 'codex'
    world.held = { provider: 'claude', model: 'opus', effort: 'high' }
    await page.viewport(700, 900)
    const { store, lists } = storeOver()
    await store.load()
    const m = mount(
      CapabilitiesSheet,
      { profileSlug: 'worker', runsOn: 'codex', store, lists },
      { width: 680, height: 880 },
    )
    await settle()
    expect(words(m.q('agent-model-other-provider'))).toBe(
      'It is for Claude, and this agent runs on Codex, so no launch reads it: another agent that starts this one, or whose message starts it, does so as though nobody had chosen. Its picker picks a Codex model in its place, and Clear takes it away.',
    )
    // ⛔ `691` · …and the sheet draws no sentence claiming it holds (see §2's pair).
    expect(m.all('agent-model-reaches')).toHaveLength(0)
  })

  it('🔴 between *Runs on* and the agent’s own instructions, inside the sheet’s width', async () => {
    reset()
    await page.viewport(700, 900)
    // ⚑ A label longer than the sheet — so the fit below is a claim that could fail (`685`'s review).
    world.map = {
      ...answered(),
      codex: {
        ok: true,
        models: [
          ...CODEX_ROWS,
          {
            id: 'gpt-long',
            label: `A model whose label is ${'very '.repeat(40)}long`,
            efforts: [],
          },
        ],
      },
    }
    const { store, lists } = storeOver()
    await store.load()
    const m = mount(
      CapabilitiesSheet,
      { profileSlug: 'worker', runsOn: 'codex', store, lists },
      { width: 680, height: 880 },
    )
    await settle()
    const provider = m.q('capabilities-provider')
    const model = m.q('agent-model')
    const own = m.q('own-instructions')
    expect(provider.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(model.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // ⚑ The sheet's resolved provider is the one the picker lists.
    await press(m, 'model-picker-face')
    expect(m.all('model-picker-provider').map((one) => one.dataset.provider)).toEqual(['codex'])
    // ⛔ Nothing pushes the sheet sideways.
    const body = m.q('capabilities-provider').parentElement as HTMLElement
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth)
  })
})
