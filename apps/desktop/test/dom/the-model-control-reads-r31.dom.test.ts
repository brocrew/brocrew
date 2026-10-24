import { expandAgentCards } from './harness'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import AgentModelChoice from '../../src/renderer/src/components/AgentModelChoice.vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import { createModelLists, type ModelLists } from '../../src/renderer/src/lib/model-lists'
import { GO_AHEAD_MESSAGE } from '../../src/renderer/src/lib/plan-mode'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import {
  judgeAgainstTheList,
  theDefaultEffortOf,
  theList,
  theListedRow,
  type AgentModelChoice as Choice,
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
  TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * # 696 — what a person SEES of a model choice under R31, and `688` L1
 *
 * ⚑ `the-model-control-reads-r31.render.test.ts` drives the real host and pins what each sentence
 * SAYS; this file is the drawing: a real engine, a real press, a real `change`, and what a person
 * perceives — a line that is there or is not, a register, a word beside a value. ⛔ Never a class.
 *
 * | § | about | the control, planted in the same mount |
 * |---|---|---|
 * | 1 | the menus say whose list they are; the draft says what Save will leave | an agent with its own list |
 * | 2 | the held row says that it is not in force | no provider of its own |
 * | 3 | a no-provider agent's *Change…* opens its choice's provider | the same choice beside a provider of its own |
 * | 4 | the provider press says what it cleared; the note says *you start* | a press that cleared nothing |
 * | 5 | `688` L1 · *carry on* only while it can be done and nobody has | the same row, live and untouched |
 *
 * ⚑ **D-016** — §6 (`681` F-b, the Team card's *Works in* line saying *starting* rather than *no
 * project yet*) went with the line itself: the Team page names no project.
 *
 * ⚑ **D-042** — `682`'s stand-in mark on a HELD default is gone with the stand-in re-judge (no
 * launch judges a default again), so the held row names no list and no sentence calls a default
 * provisional; whose list the MENUS are is still said, above them (§1).
 */

afterEach(async () => {
  unmountAll()
  usePersonsQueue().forget()
  await page.viewport(1100, 900)
})

const words = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    await nextTick()
  }
}
const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent

const levels = (...ids: string[]): { id: string; label: string }[] =>
  ids.map((id) => ({ id, label: id }))
/**
 * ⚑ **D-042 · the adapters' shape**: Claude's `default` row marked `isDefault` and `high` its rows'
 * default effort; Codex's `isDefault` row — ⚠️ not its first — and each row's own default effort.
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

const ident = (slug: string, over: Partial<AgentIdentity> = {}): AgentIdentity =>
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
    ...over,
  }) as unknown as AgentIdentity

/** One fake door, answering with the real door's rules — `685`'s dom double, with the provider door. */
interface World {
  held: Choice | null
  map: Record<Provider, ModelCatalogue>
  itsProvider: 'claude' | 'codex' | null
  /** ⚑ What the provider door answers it cleared — the real door's rule is §4's node test. */
  clears: boolean
  /** The one identity the roster holds — `worker`, or BroBot's own for the front door's clause. */
  slug: string
}
let world: World
const reset = (over: Partial<World> = {}): void => {
  world = {
    held: null,
    map: {
      claude: { ok: true, models: CLAUDE_ROWS },
      codex: { ok: true, models: CODEX_ROWS },
    },
    itsProvider: null,
    clears: true,
    slug: 'worker',
    ...over,
  }
}

function storeOver(): { store: AgentStore; lists: ModelLists } {
  const roster = (): AgentIdentities =>
    ({
      identities: [ident(world.slug, { provider: world.itsProvider })],
      foldersWithoutARow: [],
      spawningEnabled: true,
      defaultApprovalMode: 'ask',
      use: [],
    }) as unknown as AgentIdentities
  const bridge = {
    agentIdentities: async () => roster(),
    profiles: async () => ['brobot', 'worker'],
    // ⚑ UI-012 · D-042's list door, answering from `world.map` as the host composes a list.
    modelList: async ({ provider }: { provider: Provider }): Promise<ModelList> => {
      const catalogue = world.map[provider]
      return {
        provider,
        notAsked: catalogue.ok ? null : catalogue,
        standIn: catalogue.ok ? (catalogue.standIn ?? null) : null,
        models: theList(catalogue.ok ? catalogue.models : [], []),
        lastPicked: null,
        startsOn: null,
      }
    },
    agentModelAndEffort: async () => world.held,
    setAgentModelAndEffort: async (input: {
      profileId: string
      provider: 'claude' | 'codex' | null
      model: string | null
      effort: string | null
    }) => {
      if (input.provider === null) {
        world.held = null
        return { ok: true, choice: null }
      }
      // ⚑ **D-042 · the real door's rule**: a provider names a model (the wire's refine), a blank
      // effort is the model's own default, and the list judges the pair — `judgeAgainstTheList`.
      if (input.model === null) throw new Error('a default is a model for a provider')
      const catalogue = world.map[input.provider]
      if (!catalogue.ok) throw new Error('no catalogue in this fixture')
      const row = theListedRow(catalogue.models, input.model)
      const pair = { model: input.model, effort: input.effort ?? theDefaultEffortOf(row) }
      if (judgeAgainstTheList(catalogue.models, pair) !== null) throw new Error('refused')
      world.held = { provider: input.provider, ...pair }
      return { ok: true, choice: world.held }
    },
    setAgentProvider: async (input: { profileId: string; provider: 'claude' | 'codex' | null }) => {
      const before = world.held
      world.itsProvider = input.provider
      const cleared =
        world.clears &&
        before !== null &&
        input.provider !== null &&
        before.provider !== input.provider
          ? { provider: before.provider, model: before.model, effort: before.effort }
          : null
      if (cleared !== null) world.held = null
      return { ...ident(world.slug, { provider: input.provider }), modelChoiceCleared: cleared }
    },
  } as unknown as RuntimeBridge
  return { store: createAgentStore(bridge), lists: createModelLists(() => bridge) }
}

async function theControl(runsOn: 'claude' | 'codex'): Promise<Mounted> {
  const { store, lists } = storeOver()
  await store.load()
  const m = mount(
    AgentModelChoice,
    { profileSlug: 'worker', runsOn, itsProvider: world.itsProvider, store, lists },
    { width: 620, height: 420 },
  )
  await settle()
  return m
}

async function press(m: Mounted, cy: string): Promise<void> {
  m.q(cy).click()
  await settle()
}

async function pick(m: Mounted, cy: string, value: string): Promise<void> {
  const select = m.q(cy) as HTMLSelectElement
  select.value = value
  select.dispatchEvent(new Event('change'))
  await settle()
}

/* ── UI-012 · the model picker's own gestures ── */

const rows = (m: Mounted): string[] =>
  m.all('model-picker-row').map((row) => row.dataset.model ?? '')
const sections = (m: Mounted): string[] =>
  m.all('model-picker-provider').map((one) => one.dataset.provider ?? '')
const drafted = (m: Mounted): string | null =>
  m.all('model-picker-row').find((row) => row.querySelector('input')?.checked)?.dataset.model ??
  null
const draftedEffort = (m: Mounted): string | null =>
  m.all('model-picker-effort').find((level) => level.querySelector('input')?.checked)?.dataset
    .effort ?? null

async function draft(m: Mounted, id: string): Promise<void> {
  const row = m.all('model-picker-row').find((one) => one.dataset.model === id)
  expect(row, `no row ${id}`).toBeDefined()
  row!.querySelector('input')!.click()
  await settle()
}

/* ═════════════════ §1 · the menus say whose list they are ═════════════════ */

describe('696 §1 · a never-run agent’s menus say whose list they are, before a person picks', () => {
  // ⚑ **D-042 · re-aimed**: the draft no longer names the stand-in (no clause calls a default
  // provisional), so what stands is the note above the menus and `691` §8.1's rule — the draft's
  // sentence IS the one the saved row reads.
  it('🔴 BroBot’s list, said above the menus; the draft’s sentence is the one the saved row reads', async () => {
    reset({
      map: {
        claude: { ok: true, models: CLAUDE_ROWS, standIn: 'brobot' },
        codex: { ok: true, models: CODEX_ROWS, standIn: 'brobot' },
      },
    })
    const m = await theControl('codex')
    await press(m, 'model-picker-face')
    const note = m.q('model-picker-note')
    expect(visible(note)).toBe(true)
    expect(words(note)).toBe('This is BroBot’s list: this agent has no list of its own to ask.')
    await draft(m, 'gpt-5.6-terra')
    const before = words(m.q('model-picker-reaches'))
    expect(before).toMatch(/^Its new conversations start on this, on Codex — /)
    await press(m, 'model-picker-take')
    // ⚑ Saved: the row holds the default, and its sentence is the draft's, word for word.
    expect(words(m.q('model-picker-face'))).toBe('gpt-5.6-terra · medium')
    expect(words(m.q('agent-model-reaches'))).toBe(before)
  })

  it('⚑ THE CONTROL — an agent with its own list: no note, and the same words before and after', async () => {
    reset()
    const m = await theControl('codex')
    await press(m, 'model-picker-face')
    expect(m.all('model-picker-note')).toHaveLength(0)
    await draft(m, 'gpt-5.6-terra')
    const before = words(m.q('model-picker-reaches'))
    expect(before).toMatch(/^Its new conversations start on this, on Codex — /)
    await press(m, 'model-picker-take')
    expect(words(m.q('agent-model-reaches'))).toBe(before)
  })
})

/* ═════════════════ §2 · where the held choice stands ═════════════════ */

describe('696 §2 · the held row says where the choice stands', () => {
  it('🔴 not in force — in the row, in the row’s own muted register, beside the sentence that says why', async () => {
    reset({
      itsProvider: 'codex',
      // ⚠️ Main never writes this pair — the provider door clears such a choice.
      held: { provider: 'claude', model: 'opus', effort: 'max' },
    })
    const m = await theControl('codex')
    const mark = m.q('agent-model-not-in-force')
    expect(visible(mark)).toBe(true)
    expect(words(mark)).toBe('not in force')
    // ⚑ A state of the value, not a warning: the row's muted ink, the same as its own label's.
    const label = [...m.q('agent-model').querySelectorAll('span')].find(
      (one) => words(one) === 'Model and effort',
    ) as Element
    expect(getComputedStyle(mark).color).toBe(getComputedStyle(label).color)
    expect(getComputedStyle(mark).fontStyle).toBe('italic')
    // ⚑ Same row: the mark and the choice it contradicts — named with its provider — on one line.
    expect(words(m.q('agent-model-held'))).toContain('“opus” at max effort on Claude')
    const provider = (
      m.q('agent-model-held').querySelector('strong') as Element
    ).getBoundingClientRect()
    const box = mark.getBoundingClientRect()
    expect(Math.abs(box.top - provider.top)).toBeLessThan(provider.height)
    expect(words(m.q('agent-model-other-provider'))).toContain('so no launch reads it')
    // ⚑ D-042 · *"no provenance for a choice nothing reads"* is retired with the provenance itself:
    // a held default carries no `standIn`, so the row has no list to draw for any choice.
  })

  it('⚑ THE CONTROL — the same choice on an agent with no provider of its own is in force: no mark', async () => {
    reset({ held: { provider: 'claude', model: 'opus', effort: 'max' } })
    const m = await theControl('codex')
    expect(m.all('agent-model-not-in-force')).toHaveLength(0)
    expect(m.all('agent-model-other-provider')).toHaveLength(0)
    expect(visible(m.q('agent-model-reaches'))).toBe(true)
  })
})

/* ═════════════════ §3 · a no-provider agent's menus ═════════════════ */

describe('696 §3 · *Change…* on a no-provider agent opens its CHOICE’s provider', () => {
  it('🔴 a Claude choice, on an agent that resolves to Codex for a launch you start: Claude’s menus, seeded', async () => {
    reset({ held: { provider: 'claude', model: 'opus', effort: 'max' } })
    const m = await theControl('codex')
    await press(m, 'model-picker-face')
    expect(sections(m)).toEqual(['claude'])
    // ⚑ The ROWS are Claude's — not Codex's under a Claude heading, with the choice kept as
    // *(no longer listed)* (`696`'s own row M14 found this gap). ⚑ D-042 · the provider's default
    // is a row, by name.
    expect(rows(m)).toEqual(['default', 'opus'])
    expect(drafted(m)).toBe('opus')
    expect(draftedEffort(m)).toBe('max')
  })

  // ⚑ **D-042 · re-aimed**: this pinned a stand-in's verdict held against menus from the agent's
  // OWN list, where the held row's words and the menus' would differ. ⚑ The stand-in mark is gone
  // (no launch judges a default again), so they cannot differ by provenance; what stands is the
  // rule beside it — a draft that IS the held default says what the held row says, with Save dead.
  it('🔴 the picker with nothing changed says what the held row says — and a draft that differs says its own', async () => {
    reset({
      itsProvider: 'codex',
      held: { provider: 'codex', model: 'gpt-5.6-luna', effort: 'medium' },
    })
    const m = await theControl('codex')
    const idle = words(m.q('agent-model-reaches'))
    expect(idle).toMatch(/^Its new conversations start on this, on Codex — /)
    await press(m, 'model-picker-face')
    expect(m.all('model-picker-note')).toHaveLength(0)
    expect(drafted(m)).toBe('gpt-5.6-luna')
    expect(words(m.q('model-picker-reaches'))).toBe(idle)
    // ⚑ THE CONTROL: a draft that differs is a save the door would admit, and Take is alive.
    await draft(m, 'gpt-5.6-terra')
    expect(m.all('model-picker-refusal')).toHaveLength(0)
    expect((m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(false)
  })

  it('⚑ THE CONTROL — beside a provider of its own (Codex) the same choice is not in force: Codex’s menus, not seeded from it', async () => {
    reset({
      itsProvider: 'codex',
      held: { provider: 'claude', model: 'opus', effort: 'max' },
    })
    const m = await theControl('codex')
    await press(m, 'model-picker-face')
    expect(sections(m)).toEqual(['codex'])
    // ⚑ UI-012 · nothing drafted — never the Claude choice, which this list cannot hold.
    expect(rows(m)).toEqual(['gpt-5.6-terra', 'gpt-5.6-luna'])
    expect(drafted(m)).toBeNull()
  })
})

/* ═════════════════ §4 · the provider press ═════════════════ */

async function theSheet(): Promise<Mounted> {
  await page.viewport(720, 900)
  const { store, lists } = storeOver()
  await store.load()
  const m = mount(
    CapabilitiesSheet,
    { profileSlug: world.slug, runsOn: world.itsProvider ?? 'codex', store, lists },
    { width: 700, height: 880 },
  )
  await settle()
  return m
}

describe('696 §4 · the provider press says what the same act cleared', () => {
  it('🔴 Claude → Codex clears a Claude choice, and the sheet says so, under the control that did it', async () => {
    reset({
      itsProvider: 'claude',
      held: { provider: 'claude', model: 'opus', effort: 'high' },
    })
    const m = await theSheet()
    expect(m.all('capabilities-provider-cleared')).toHaveLength(0)
    await pick(m, 'capabilities-provider-select', 'codex')
    const cleared = m.q('capabilities-provider-cleared')
    expect(visible(cleared)).toBe(true)
    expect(words(cleared)).toBe(
      'The model and effort chosen for it — “opus” at high effort on Claude — were cleared: a choice is always for its own provider, and its provider is now Codex.',
    )
    // ⚑ In the provider block, after the select that did it.
    const select = m.q('capabilities-provider-select')
    expect(m.q('capabilities-provider').contains(cleared)).toBe(true)
    expect(select.compareDocumentPosition(cleared) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // ⚑ …and the control below agrees: the choice is gone.
    expect(words(m.q('model-picker-face'))).toBe('Nobody has chosen')
    // ⚑ It reports the LAST press: the next one, which clears nothing, takes the line away.
    await pick(m, 'capabilities-provider-select', '')
    expect(m.all('capabilities-provider-cleared')).toHaveLength(0)
  })

  it('⚑ THE CONTROL — a press that cleared nothing says nothing; and the note is about a launch YOU start', async () => {
    reset({
      itsProvider: 'claude',
      held: { provider: 'claude', model: 'opus', effort: 'high' },
      clears: false,
    })
    const m = await theSheet()
    expect(words(m.q('capabilities-provider-note'))).toMatch(
      /^The default for a new conversation as this identity is Claude\. /,
    )
    // ⛔ No door that starts `worker` asks for a provider, so the note promises no such choice.
    expect(words(m.q('capabilities-provider-note'))).not.toContain('unless you choose')
    await pick(m, 'capabilities-provider-select', '')
    expect(m.all('capabilities-provider-cleared')).toHaveLength(0)
    expect(words(m.q('model-picker-face'))).toBe('opus · high')
  })
})

describe('696 §4b · BroBot’s own sheet names the front door’s provider menu', () => {
  it('🔴 *unless you choose another provider where you start it* — BroBot’s identity, which the front door starts and asks about', async () => {
    reset({ slug: 'brobot', itsProvider: 'codex' })
    const m = await theSheet()
    expect(words(m.q('capabilities-provider-note'))).toMatch(
      /^The default for a new conversation as this identity is Codex, unless you choose another provider where you start it\. /,
    )
  })
})

/* ═════════════════ §5 · `688` L1 — carry on, only while it can be done ═════════════════ */

const A_TAKEN_BACK_GO_AHEAD = [
  ev({ type: 'user_turn', text: 'Plan the rebuild of the orders index.' }),
  ev({ type: 'status', state: 'running' }),
  ev({
    type: 'message_queued',
    messageId: 'msg_go',
    kind: 'work',
    text: GO_AHEAD_MESSAGE,
    attribution: 'app_authored',
  }),
  ev({ type: 'message_unqueued', messageId: 'msg_go', reason: 'cancelled' }),
  ev({ type: 'turn', state: 'completed' }),
  ev({ type: 'status', state: 'idle' }),
]

async function thePane(
  events: TranscriptEvent[],
  /** ⚑ A fact about the record the events do not carry — its phase, or where the page is. */
  adjust: (r: ReturnType<typeof record>) => void = () => {},
): Promise<Mounted> {
  await page.viewport(1100, 800)
  const r = record(events)
  adjust(r)
  const m = mount(ConversationPane, paneProps({ record: r }), {
    width: 1080,
    height: 780,
  })
  await settle()
  return expandAgentCards(m)
}

describe('696 §5 · `688` L1 — the taken-back row says *carry on* only while it can be done and nobody has', () => {
  it('⚑ THE CONTROL — live, idle, nothing after it: the whole sentence, and the composer it points at is there', async () => {
    const m = await thePane(A_TAKEN_BACK_GO_AHEAD)
    expect(words(m.q('queued-go-ahead-taken-back'))).toBe(
      'the plan was released but the go-ahead was not sent — type your next message to carry on',
    )
    expect((m.q('prompt-input') as HTMLTextAreaElement).disabled).toBe(false)
  })

  // ⚑ **D-017b · a stop ends nothing** — a conversation whose provider stopped takes the next
  // message, which continues it, so *carry on* is still something a person can do there: the whole
  // sentence, and the box it names. ⛔ It measured the clause gone and the box locked (*ended*).
  it('🔴 the conversation STOPPED — a message still carries it on: the whole sentence, and the box it names is there', async () => {
    const m = await thePane([...A_TAKEN_BACK_GO_AHEAD, ev({ type: 'status', state: 'ended' })])
    expect(words(m.q('queued-go-ahead-taken-back'))).toBe(
      'the plan was released but the go-ahead was not sent — type your next message to carry on',
    )
    expect((m.q('prompt-input') as HTMLTextAreaElement).disabled).toBe(false)
  })

  it('🔴 the person has TYPED since — only the fact about the past', async () => {
    const m = await thePane([
      ...A_TAKEN_BACK_GO_AHEAD,
      ev({ type: 'user_turn', text: 'just do the first step' }),
    ])
    expect(words(m.q('queued-go-ahead-taken-back'))).toBe(
      'the plan was released but the go-ahead was not sent',
    )
  })

  it('🔴 the go-ahead pressed AGAIN and sent since — only the fact about the past', async () => {
    const m = await thePane([
      ...A_TAKEN_BACK_GO_AHEAD,
      ev({ type: 'user_turn', text: GO_AHEAD_MESSAGE, attribution: 'app_authored' }),
    ])
    // ⚑ The premise: it went, as BroBot's continuation, not as a held row.
    expect(m.all('queued-go-ahead-taken-back')).toHaveLength(1)
    expect(words(m.q('queued-go-ahead-taken-back'))).toBe(
      'the plan was released but the go-ahead was not sent',
    )
  })

  it('🔴 a message of the person’s own HELD since — only the fact about the past', async () => {
    const m = await thePane([
      ...A_TAKEN_BACK_GO_AHEAD,
      // ⚠️ No turn of theirs before it — or that alone would be *the person has typed*.
      ev({ type: 'status', state: 'running' }),
      ev({ type: 'message_queued', messageId: 'msg_mine', kind: 'work', text: 'and then this' }),
    ])
    expect(m.all('user-message')).toHaveLength(1)
    expect(words(m.q('queued-go-ahead-taken-back'))).toBe(
      'the plan was released but the go-ahead was not sent',
    )
  })

  it('🔴 the conversation is CLOSING — only the fact; the composer refuses a send', async () => {
    const m = await thePane(A_TAKEN_BACK_GO_AHEAD, (r) => {
      r.phase = 'closing'
    })
    expect(words(m.q('queued-go-ahead-taken-back'))).toBe(
      'the plan was released but the go-ahead was not sent',
    )
  })

  it('🔴 its sign-in was SUPERSEDED — only the fact; no message can go out on it until it is reopened', async () => {
    const m = await thePane(A_TAKEN_BACK_GO_AHEAD, (r) => {
      if (r.meta === null) throw new Error('no meta')
      r.meta = { ...r.meta, liveness: { ...r.meta.liveness, signInSuperseded: true } }
    })
    expect(words(m.q('queued-go-ahead-taken-back'))).toBe(
      'the plan was released but the go-ahead was not sent',
    )
  })

  it('🔴 the reader has scrolled back off the end — only the fact; what came after is not on this page', async () => {
    const m = await thePane(A_TAKEN_BACK_GO_AHEAD, (r) => {
      r.window.atTail = false
    })
    expect(words(m.q('queued-go-ahead-taken-back'))).toBe(
      'the plan was released but the go-ahead was not sent',
    )
  })

  it('⚑ THE CONTROL — a message of the person’s they CANCELLED since is not carrying on: the whole sentence', async () => {
    const m = await thePane([
      ...A_TAKEN_BACK_GO_AHEAD,
      ev({ type: 'status', state: 'running' }),
      ev({ type: 'message_queued', messageId: 'msg_mine', kind: 'work', text: 'and then this' }),
      ev({ type: 'message_unqueued', messageId: 'msg_mine', reason: 'cancelled' }),
      ev({ type: 'turn', state: 'completed' }),
      ev({ type: 'status', state: 'idle' }),
    ])
    expect(words(m.q('queued-go-ahead-taken-back'))).toBe(
      'the plan was released but the go-ahead was not sent — type your next message to carry on',
    )
  })

  it('⚑ THE CONTROL — messages held since that are not the person’s (a relay, a report, the app’s notice): the whole sentence', async () => {
    const m = await thePane([
      ...A_TAKEN_BACK_GO_AHEAD,
      ev({ type: 'status', state: 'running' }),
      ev({
        type: 'message_queued',
        messageId: 'msg_relay',
        kind: 'question',
        text: 'the child asks',
        attribution: 'app_authored',
        relayedFrom: 'sess_ada',
        relayedFromProfile: 'ada',
      }),
      ev({
        type: 'message_queued',
        messageId: 'msg_report',
        kind: 'work',
        text: 'the work is done',
        attribution: 'app_authored',
        work: { piece: 'work_2', label: 'W1.3', state: 'answered', outcome: 'done' },
      }),
      ev({
        type: 'message_queued',
        messageId: 'msg_notice',
        kind: 'work',
        text: 'a person answered',
        attribution: 'app_authored',
        appNotice: 'an-answer-to-a-question',
      }),
    ])
    // ⚑ The premise: three rows are held after it, and none is the go-ahead or the person's.
    expect(m.all('queued-entry')).toHaveLength(4)
    expect(words(m.q('queued-go-ahead-taken-back'))).toBe(
      'the plan was released but the go-ahead was not sent — type your next message to carry on',
    )
  })

  it('⚑ THE CONTROL — an agent’s message since is not the person carrying on: the whole sentence', async () => {
    const m = await thePane([
      ...A_TAKEN_BACK_GO_AHEAD,
      ev({
        type: 'user_turn',
        text: 'the child reports in',
        attribution: 'app_authored',
        relayedFrom: 'sess_ada',
        relayedFromProfile: 'ada',
      }),
      ev({ type: 'turn', state: 'completed' }),
      ev({ type: 'status', state: 'idle' }),
    ])
    // ⚑ The premise: the agent's message is drawn, after the row, as the agent's.
    expect(m.all('relayed')).toHaveLength(1)
    expect(words(m.q('queued-go-ahead-taken-back'))).toBe(
      'the plan was released but the go-ahead was not sent — type your next message to carry on',
    )
  })
})
