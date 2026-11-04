import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import NoticeEntry from '../../src/renderer/src/components/NoticeEntry.vue'
import OwnInstructions from '../../src/renderer/src/components/OwnInstructions.vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import { createModelLists, type ModelLists } from '../../src/renderer/src/lib/model-lists'
import {
  whatAProviderPressWouldClear,
  whatTheProviderPressCleared,
} from '../../src/renderer/src/lib/agent-model-choice'
import { instructionAskedSentence } from '../../src/renderer/src/lib/instruction-asked'
import type { AConversationToReopen } from '../../src/renderer/src/lib/reopening'
import {
  applyEvent,
  createTranscript,
  type NoticeItem,
  type TranscriptItem,
} from '../../src/renderer/src/lib/transcript'
import {
  CAPABILITY_FIELDS,
  DEFAULT_CAPABILITIES,
  type AnyCapabilityField,
} from '../../src/shared/capabilities'
import {
  judgeAgainstTheList,
  theDefaultEffortOf,
  theList,
  theListedRow,
  type AgentModelChoice,
} from '../../src/shared/model-choice'
import type { AgentInstructionsReading } from '../../src/shared/own-instructions'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_LABEL,
  agentName,
  type AgentIdentities,
  type AgentIdentity,
  type ModelCatalogue,
  type ModelChoice,
  type ModelList,
  type Provider,
  type RuntimeBridge,
  type TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 712 — an identity NAMED where a person reads it, and a clear SAID before the press
 *
 * ⚑ Two of `712`'s draws, on a real engine: a real `CapabilitiesSheet` over a real `createAgentStore`
 * (one fake bridge, answering with main's rules), the real transcript fold, and what a person
 * perceives — a line that is there or is not, where it sits, the register it wears, the words.
 * ⛔ Never a class alone.
 *
 * | § | ordered by | the claim | the control, planted in the same mount |
 * |---|---|---|---|
 * | 1 | **R56** (`696` L2), draw 4 | the provider row says what a press WOULD clear, before it; the `696` after-press line is unchanged | nothing held; the held read refused; a press to *Nobody has said*; the sheet re-pointed |
 * | 2 | **R41** (`707` GAP-5), draw 8 | the notice, the ask line and the capabilities sheet NAME an identity (`agentName`) — ⚑ the proposal card went with proposals (D-016) | the same mount with no roster, or with no display name: the slug stands |
 *
 * ⚠️ **What this file leaves to the node writer, on purpose:** `attention.ts`' `nameOf` and
 * `agent-store.ts`' remove/create sentences (draw 8 d, e) — `RuntimeScreen` is too big to mount, and
 * those are pure functions a node test reaches whole. ⛔ Draws 5, 6 and 9 build nothing to draw.
 *
 * ⚑ **The fixture's names are chosen so a slug can never pass for a name**: `project-manager` is
 * *Ada* (a different first letter, so the glyph that keeps the slug is a measurement) and
 * `bookkeeper` is *Pam*.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/** ⚑ What a person reads: the engine's own `innerText`, whitespace folded as a reader folds it. */
const said = (el: HTMLElement): string => el.innerText.replace(/\s+/g, ' ').trim()
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    await nextTick()
  }
}
const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent

const ident = (slug: string, over: Partial<AgentIdentity> = {}): AgentIdentity =>
  ({
    id: `aid:${slug}`,
    slug,
    displayName: null,
    createdAt: 1_700_000_000_000,
    createdBy: null,
    provider: null,
    externalMcpServerIds: [],
    capabilities: DEFAULT_CAPABILITIES,
    chosen: Object.fromEntries(Object.keys(DEFAULT_CAPABILITIES).map((key) => [key, 'default'])),
    ...over,
  }) as unknown as AgentIdentity

/** ⚑ The roster §2 names by: *Ada* and *Pam*, beside two rows nobody has named. */
const NAMED = (): AgentIdentity[] => [
  ident('project-manager', { displayName: 'Ada' }),
  ident('bookkeeper', { displayName: 'Pam' }),
  ident('worker'),
  ident(DEFAULT_PROFILE_ID),
]
/** ⛔ The same four rows, and nobody has given any of them a name — the slug must stand. */
const UNNAMED = (): AgentIdentity[] => NAMED().map((one) => ({ ...one, displayName: null }))

/* ═══════════════════════════ the one fake bridge — main's rules ═══════════════════════════ */

const levels = (...ids: string[]): { id: string; label: string }[] =>
  ids.map((id) => ({ id, label: id }))
const CLAUDE_ROWS: ModelChoice[] = [
  { id: 'default', label: 'Default (recommended)', efforts: levels('low', 'medium', 'high') },
  { id: 'opus', label: 'Opus', efforts: levels('low', 'medium', 'high', 'max') },
]
const CODEX_ROWS: ModelChoice[] = [
  { id: 'gpt-5.6-terra', label: 'terra', efforts: levels('low', 'medium', 'high', 'ultra') },
]
const MAP: Record<Provider, ModelCatalogue> = {
  claude: { ok: true, models: CLAUDE_ROWS },
  codex: { ok: true, models: CODEX_ROWS },
}

/**
 * ⚑ The choice §1 is about — a person's, for Claude, in force on a Claude agent. ⚑ **D-042 · the
 * agent's default, whole**: `682`'s `standIn` went with the stand-in re-judge.
 */
const OPUS_HIGH: AgentModelChoice = {
  provider: 'claude',
  model: 'opus',
  effort: 'high',
}

interface World {
  roster: AgentIdentity[]
  /** Each identity's held model choice, by slug — absent is *nobody chose*. */
  held: Record<string, AgentModelChoice | null>
  /** Identities whose held-choice read THROWS — *not known*. */
  readFails: Set<string>
  /** ⚠️ When set, every held-choice read waits on it — the re-read held back. */
  gate: Promise<void> | null
  /** What `agentInstructions` answers, or null for a refused read. */
  reading: AgentInstructionsReading | null
}
let world: World
const reset = (over: Partial<World> = {}): void => {
  world = {
    roster: [ident('worker', { provider: 'claude' }), ident('other', { provider: 'claude' })],
    held: {},
    readFails: new Set(),
    gate: null,
    reading: null,
    ...over,
  }
}

/**
 * ⚑ **A real `createAgentStore` over one fake bridge** — `the-model-control-reads-r31.dom.test.ts`
 * §4's double, keyed by identity. ⛔ `setAgentProvider` clears on MAIN's condition, read off
 * `session-store.ts`' `setAgentProviderTx`: a held choice goes exactly when the new provider is a
 * provider and not the choice's own.
 */
function storeOver(): { store: AgentStore; lists: ModelLists } {
  const bridge = {
    agentIdentities: async () =>
      ({
        identities: world.roster.map((one) => ({ ...one })),
        foldersWithoutARow: [],
        spawningEnabled: true,
        defaultApprovalMode: 'ask',
        use: [],
      }) as unknown as AgentIdentities,
    profiles: async () => world.roster.map((one) => one.slug),
    // ⚑ UI-012 · D-042's list door, answering from `MAP` as the host composes a list.
    modelList: async ({ provider }: { provider: Provider }): Promise<ModelList> => {
      const catalogue = MAP[provider]
      return {
        provider,
        notAsked: catalogue.ok ? null : catalogue,
        standIn: null,
        models: theList(catalogue.ok ? catalogue.models : [], []),
        lastPicked: null,
        startsOn: null,
      }
    },
    agentModelAndEffort: async (input: { profileId: string }) => {
      if (world.readFails.has(input.profileId)) throw new Error('the ledger could not be read')
      if (world.gate !== null) await world.gate
      return world.held[input.profileId] ?? null
    },
    setAgentModelAndEffort: async (input: {
      profileId: string
      provider: Provider | null
      model: string | null
      effort: string | null
    }) => {
      if (input.provider === null) {
        world.held[input.profileId] = null
        return { ok: true, choice: null }
      }
      // ⚑ **D-042 · the real door's rule**: a provider names a model (the wire's refine), a blank
      // effort is the model's own default, and the list judges the pair — `judgeAgainstTheList`.
      if (input.model === null) throw new Error('a default is a model for a provider')
      const catalogue = MAP[input.provider]
      if (!catalogue.ok) throw new Error('no catalogue in this fixture')
      const row = theListedRow(catalogue.models, input.model)
      const pair = { model: input.model, effort: input.effort ?? theDefaultEffortOf(row) }
      if (judgeAgainstTheList(catalogue.models, pair) !== null) throw new Error('refused')
      const saved: AgentModelChoice = { provider: input.provider, ...pair }
      world.held[input.profileId] = saved
      return { ok: true, choice: saved }
    },
    setAgentProvider: async (input: { profileId: string; provider: Provider | null }) => {
      const row = world.roster.find((one) => one.slug === input.profileId)
      if (row === undefined) return null
      const before = world.held[input.profileId] ?? null
      world.roster = world.roster.map((one) =>
        one.slug === input.profileId ? { ...one, provider: input.provider } : one,
      )
      const cleared =
        before !== null && input.provider !== null && before.provider !== input.provider
          ? { provider: before.provider, model: before.model, effort: before.effort }
          : null
      if (cleared !== null) world.held[input.profileId] = null
      return { ...row, provider: input.provider, modelChoiceCleared: cleared }
    },
    agentInstructions: async () => {
      if (world.reading === null) throw new Error('no reading in this fixture')
      return world.reading
    },
  } as unknown as RuntimeBridge
  return { store: createAgentStore(bridge), lists: createModelLists(() => bridge) }
}

interface Sheet extends Mounted {
  readonly store: AgentStore
  /** ⚑ Re-point the SAME mounted sheet at another identity — the `profileSlug` prop, changed. */
  point(slug: string): Promise<void>
}

/**
 * ⚑ **Mounted through a one-line host so `profileSlug` is a prop that can CHANGE** — `RuntimeScreen`
 * mounts this sheet with no `:key`, so a re-point is an update of the same instance, and that is the
 * path the sheet's reset is for.
 */
async function theSheet(
  slug: string,
  extra: {
    openAs?: readonly AConversationToReopen[]
    fields?: readonly AnyCapabilityField[]
    onReopen?: (sessionId: string) => void
  } = {},
): Promise<Sheet> {
  await page.viewport(720, 900)
  const { store, lists } = storeOver()
  await store.load()
  const pointed = ref(slug)
  const Host = defineComponent({
    setup: () => () =>
      h(CapabilitiesSheet as Component, {
        profileSlug: pointed.value,
        runsOn: 'claude',
        store,
        lists,
        ...extra,
      }),
  })
  const m = mount(Host, {}, { width: 700, height: 880 })
  await settle()
  return {
    ...m,
    store,
    point: async (next: string) => {
      pointed.value = next
      await settle()
    },
  }
}

async function pick(m: Mounted, cy: string, value: string): Promise<void> {
  const select = m.q(cy) as HTMLSelectElement
  select.value = value
  select.dispatchEvent(new Event('change'))
  await settle()
}

async function press(m: Mounted, cy: string): Promise<void> {
  m.q(cy).click()
  await settle()
}

/** ⚑ UI-012 · a row or an effort level in the model picker's open panel, clicked. */
async function choose(
  m: Mounted,
  cy: 'model-picker-row' | 'model-picker-effort',
  id: string,
): Promise<void> {
  const one = m.all(cy).find((el) => (el.dataset.model ?? el.dataset.effort) === id)
  expect(one, `no ${cy} ${id}`).toBeDefined()
  one!.querySelector('input')!.click()
  await settle()
}

/* ═════════════════ §1 · R56 — what a provider press WOULD clear, said before it ═════════════════ */

/**
 * ⚑ **Standing rule 5 — the sentence, pinned BY NAME once, beside the function that builds it.**
 * Every other assertion in §1 derives its words from `whatAProviderPressWouldClear`.
 */
const WILL_CLEAR_OPUS_HIGH =
  'Moving it to a provider other than Claude clears the model and effort chosen for it — “opus” at high effort on Claude: a choice is always for its own provider. Leaving no provider saved keeps it.'
/** ⚑ `696`'s after-press sentence, unchanged by `712` — pinned by name as the r31 file pins it. */
const CLEARED_OPUS_HIGH_NOW_CODEX =
  'The model and effort chosen for it — “opus” at high effort on Claude — were cleared: a choice is always for its own provider, and its provider is now Codex.'

describe('712 §1 · R56 — the provider row says what a press would clear, BEFORE the press', () => {
  it('🔴 a held Claude choice: the line is there before any press, after the select, in the note’s register — and a press to Codex takes it and says what it took', async () => {
    reset({ held: { worker: { ...OPUS_HIGH } } })
    expect(whatAProviderPressWouldClear(OPUS_HIGH)).toBe(WILL_CLEAR_OPUS_HIGH)
    const m = await theSheet('worker')
    // ⚑ The premise: the control below has read the choice this line is about.
    expect(said(m.q('model-picker-face'))).toBe('opus · high')

    const line = m.q('capabilities-provider-will-clear')
    expect(visible(line)).toBe(true)
    expect(line.innerText).toBe(whatAProviderPressWouldClear(OPUS_HIGH))
    // ⚑ Beside the control it is about: inside the provider block, and after its select.
    const select = m.q('capabilities-provider-select')
    expect(m.q('capabilities-provider').contains(line)).toBe(true)
    expect(select.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // ⚑ The note's register — a sentence about the control, not an alarm.
    const note = m.q('capabilities-provider-note')
    expect(getComputedStyle(line).color).toBe(getComputedStyle(note).color)
    expect(getComputedStyle(line).fontSize).toBe(getComputedStyle(note).fontSize)
    // ⛔ Nothing has been pressed, so nothing says it was cleared.
    expect(m.all('capabilities-provider-cleared')).toHaveLength(0)

    await pick(m, 'capabilities-provider-select', 'codex')
    // 🔴 After the door answered: the warning is gone with the choice, and the 696 line says what went.
    expect(m.all('capabilities-provider-will-clear')).toHaveLength(0)
    const cleared = m.q('capabilities-provider-cleared')
    expect(visible(cleared)).toBe(true)
    expect(said(cleared)).toBe(
      whatTheProviderPressCleared({ provider: 'claude', model: 'opus', effort: 'high' }, 'codex'),
    )
    expect(said(cleared)).toBe(CLEARED_OPUS_HIGH_NOW_CODEX)
    expect(said(m.q('model-picker-face'))).toBe('Nobody has chosen')
    expect(m.all('agent-model-held')).toHaveLength(0)
  })

  it('🔴 the DOOR’s answer alone takes the warning — with the re-read held back, the line is already gone', async () => {
    reset({ held: { worker: { ...OPUS_HIGH } } })
    const m = await theSheet('worker')
    expect(line(m)).toBe(WILL_CLEAR_OPUS_HIGH)
    let release: () => void = () => {}
    world.gate = new Promise<void>((resolve) => (release = resolve))
    try {
      await pick(m, 'capabilities-provider-select', 'codex')
      // ⚑ The premise: the control below has NOT re-read — it still draws the choice it last knew —
      // so the line's absence is the door's answer and nothing else.
      expect(said(m.q('model-picker-face'))).toBe('opus · high')
      expect(said(m.q('capabilities-provider-cleared'))).toBe(CLEARED_OPUS_HIGH_NOW_CODEX)
      expect(m.all('capabilities-provider-will-clear')).toHaveLength(0)
    } finally {
      world.gate = null
      release()
    }
    await settle()
    expect(said(m.q('model-picker-face'))).toBe('Nobody has chosen')
    expect(m.all('capabilities-provider-will-clear')).toHaveLength(0)
  })

  it('⚑ THE CONTROL (a) — nothing held: no line before a press, and none after one', async () => {
    reset()
    const m = await theSheet('worker')
    // ⚑ The premise: the read ANSWERED — *nobody chose* is known, not missing.
    expect(said(m.q('model-picker-face'))).toBe('Nobody has chosen')
    expect(m.all('capabilities-provider-will-clear')).toHaveLength(0)
    await pick(m, 'capabilities-provider-select', 'codex')
    expect(m.all('capabilities-provider-will-clear')).toHaveLength(0)
    expect(m.all('capabilities-provider-cleared')).toHaveLength(0)
  })

  it('🔴 the control’s OWN Save and Clear move the line — its door’s answer, with no roster re-read between', async () => {
    reset()
    const m = await theSheet('worker')
    expect(m.all('capabilities-provider-will-clear')).toHaveLength(0)
    // ⚑ A person chooses Opus at high effort in the control below the provider row.
    await press(m, 'model-picker-face')
    await choose(m, 'model-picker-row', 'opus')
    await choose(m, 'model-picker-effort', 'high')
    await press(m, 'model-picker-take')
    expect(said(m.q('model-picker-face'))).toBe('opus · high')
    expect(line(m)).toBe(WILL_CLEAR_OPUS_HIGH)
    // ⚑ …and Clear takes it away again, on the same row.
    await press(m, 'agent-model-clear')
    expect(said(m.q('model-picker-face'))).toBe('Nobody has chosen')
    expect(m.all('capabilities-provider-will-clear')).toHaveLength(0)
  })

  it('⚑ THE CONTROL (b) — the held read REFUSED: no line (not known is not nothing); once the read answers, the same mount draws it', async () => {
    reset({ held: { worker: { ...OPUS_HIGH } }, readFails: new Set(['worker']) })
    const m = await theSheet('worker')
    // ⚑ The premise: the control says it does not know — it does not say *nobody chose*.
    expect(said(m.q('agent-model-unknown'))).toBe('Not known')
    expect(m.all('capabilities-provider-will-clear')).toHaveLength(0)

    // ⚑ One fact over, same mount: the read answers.
    world.readFails.delete('worker')
    await m.store.load()
    await settle()
    expect(line(m)).toBe(WILL_CLEAR_OPUS_HIGH)

    // ⚑ And a LATER refused read keeps the last good answer — here and in the control, which agree.
    world.readFails.add('worker')
    await m.store.load()
    await settle()
    expect(m.all('agent-model-unreadable')).toHaveLength(1)
    expect(said(m.q('model-picker-face'))).toBe('opus · high')
    expect(line(m)).toBe(WILL_CLEAR_OPUS_HIGH)
  })

  it('⚑ THE CONTROL (c) — a press to “Nobody has said”, or to the choice’s own provider, clears nothing: the line stays', async () => {
    reset({ held: { worker: { ...OPUS_HIGH } } })
    const m = await theSheet('worker')
    expect(line(m)).toBe(WILL_CLEAR_OPUS_HIGH)

    await pick(m, 'capabilities-provider-select', '')
    // ⚑ The premise: the door kept it — main's rule, and the sentence's own last clause.
    expect(world.held.worker).toEqual(OPUS_HIGH)
    expect(m.all('capabilities-provider-cleared')).toHaveLength(0)
    expect(said(m.q('model-picker-face'))).toBe('opus · high')
    expect(line(m)).toBe(WILL_CLEAR_OPUS_HIGH)

    // ⚑ Back to Claude — the one provider the sentence says keeps it.
    await pick(m, 'capabilities-provider-select', 'claude')
    expect(world.held.worker).toEqual(OPUS_HIGH)
    expect(m.all('capabilities-provider-cleared')).toHaveLength(0)
    expect(line(m)).toBe(WILL_CLEAR_OPUS_HIGH)
  })

  it('⚑ THE CONTROL (d) — the sheet re-pointed at another identity: its line is that one’s, never the last one’s', async () => {
    reset({ held: { worker: { ...OPUS_HIGH } } })
    const m = await theSheet('worker')
    expect(line(m)).toBe(WILL_CLEAR_OPUS_HIGH)

    // ⚑ An identity nobody chose for: the line goes.
    await m.point('other')
    expect(said(m.q('capabilities-slug'))).toBe('other')
    expect(said(m.q('model-picker-face'))).toBe('Nobody has chosen')
    expect(m.all('capabilities-provider-will-clear')).toHaveLength(0)

    // ⚑ Back to `worker`: the line is back, from its own read.
    await m.point('worker')
    expect(line(m)).toBe(WILL_CLEAR_OPUS_HIGH)

    // 🔴 An identity whose read is REFUSED: nothing this sheet learned about `worker` is warned
    // about on its row — the reset on re-point, since no read of `other` ever answers.
    world.readFails.add('other')
    await m.point('other')
    expect(said(m.q('capabilities-slug'))).toBe('other')
    expect(m.all('capabilities-provider-will-clear')).toHaveLength(0)
  })
})

/** The will-clear line's words, asserted present and visible first. */
function line(m: Mounted): string {
  const el = m.q('capabilities-provider-will-clear')
  expect(visible(el)).toBe(true)
  return el.innerText
}

/* ═════════════════ §2 · R41 — every identity a person reads is NAMED ═════════════════ */

const RULES = 'Always run the gate before reporting.'
const AT = 1_700_000_200_000

/**
 * ⚑ **Standing rule 5 — the notice's sentences, pinned BY NAME** beside `instructionAskedSentence`.
 * ⛔ `PROPOSED_BY_SLUG` is what `main` printed for every reader, and what the fold still writes as
 * `text` for a reader with no roster.
 */
const PROPOSED_NAMED =
  'Ada proposed rules for Pam — 37 characters. Nothing is written until you approve it on that agent.'
const RELAYED_NAMED =
  'Ada set rules for Pam — 37 characters. It said you had given it this rule, so it was written.'
const PROPOSED_BY_SLUG =
  'project-manager proposed rules for bookkeeper — 37 characters. Nothing is written until you approve it on that agent.'

const asking = (ask: 'propose' | 'relay'): TranscriptEvent =>
  ev({
    type: 'instruction_proposed',
    askId: 'iprop_1',
    ask,
    about: 'bookkeeper',
    proposedBy: 'project-manager',
    text: RULES,
    why: 'three dispatches reported green without one',
  })

type Notice = NoticeItem & Pick<TranscriptItem, 'at'>

/** ⚑ The item the REAL fold makes of one ask. */
function foldedNotice(ask: 'propose' | 'relay'): Notice {
  const state = createTranscript()
  applyEvent(state, asking(ask), AT)
  const notices = state.items.filter((one) => one.kind === 'notice')
  expect(notices).toHaveLength(1)
  return notices[0] as Notice
}

describe('712 §2a · R41 — the notice about an identity’s rules names both identities', () => {
  it('🔴 the fold’s item, drawn with the roster: “Ada proposed rules for Pam” — and without one, the slugs', async () => {
    await page.viewport(900, 600)
    expect(RULES.length).toBe(37)
    const item = foldedNotice('propose')
    // ⚑ The premise: the fold carries the FACTS, and its own text is the roster-less sentence — so
    // a surface that drew `text` would draw the slugs, and the named sentence cannot be that fallback.
    expect(item.instructionAsked).toEqual({
      proposedBy: 'project-manager',
      about: 'bookkeeper',
      ask: 'propose',
      characters: 37,
    })
    expect(item.text).toBe(PROPOSED_BY_SLUG)
    expect(instructionAskedSentence(item.instructionAsked!, NAMED())).toBe(PROPOSED_NAMED)

    const named = mount(NoticeEntry, { item, identities: NAMED() }, { width: 860 })
    const what = named.q('what-the-notice-says')
    expect(visible(what)).toBe(true)
    expect(said(what)).toBe(PROPOSED_NAMED)
    expect(said(what).startsWith('Ada proposed rules for Pam — ')).toBe(true)
    expect(said(named.host)).not.toContain('project-manager')
    expect(what.title).toBe(PROPOSED_NAMED)

    // ⛔ THE CONTROL, the same item one fact over: no roster has landed — the slug stands.
    const bare = mount(NoticeEntry, { item, identities: null }, { width: 860 })
    expect(said(bare.q('what-the-notice-says'))).toBe(PROPOSED_BY_SLUG)
    // ⛔ …and a roster with no display names is the same answer.
    const unnamed = mount(NoticeEntry, { item, identities: UNNAMED() }, { width: 860 })
    expect(said(unnamed.q('what-the-notice-says'))).toBe(PROPOSED_BY_SLUG)
  })

  it('🔴 a relayed ask: “Ada set rules for Pam”', async () => {
    await page.viewport(900, 600)
    const item = foldedNotice('relay')
    const m = mount(NoticeEntry, { item, identities: NAMED() }, { width: 860 })
    expect(said(m.q('what-the-notice-says'))).toBe(RELAYED_NAMED)
    expect(said(m.q('what-the-notice-says'))).toBe(
      instructionAskedSentence(item.instructionAsked!, NAMED()),
    )
  })

  it('🔴 through the TRANSCRIPT: its roster reaches the notice; the notice beside it does not move', async () => {
    await page.viewport(900, 1400)
    const state = createTranscript()
    applyEvent(state, asking('propose'), AT)
    // ⚑ The control row — a notice with no identity in it, whose words must not change.
    applyEvent(state, ev({ type: 'turn', state: 'interrupted' }), AT + 2)
    const control = state.items.filter((one) => one.kind === 'notice').map((one) => one.text)
    expect(control).toHaveLength(2)
    const aside = control[1]!

    const noticesOf = (m: Mounted): string[] => m.all('what-the-notice-says').map(said)

    const named = mount(
      TranscriptView,
      { items: state.items, mode: 'normal', ownAgent: null, identities: NAMED() },
      { width: 860, height: 1300 },
    )
    await settle()
    expect(noticesOf(named)).toEqual([PROPOSED_NAMED, aside])

    const bare = mount(
      TranscriptView,
      { items: state.items, mode: 'normal', ownAgent: null, identities: null },
      { width: 860, height: 1300 },
    )
    await settle()
    expect(noticesOf(bare)).toEqual([PROPOSED_BY_SLUG, aside])
  })
})

/* ─────────────── §2c · the ask line on an identity's own rules ─────────────── */

const ASKED: AgentInstructionsReading = {
  own: { identity: 'bookkeeper', versions: [] },
  waiting: [
    {
      asked: {
        type: 'instruction_proposed',
        askId: 'iprop_1',
        ask: 'propose',
        about: 'bookkeeper',
        proposedBy: 'project-manager',
        text: RULES,
        why: 'three dispatches reported green without one',
      },
      conversation: 'sess_2',
      at: AT,
    },
  ],
  readAt: AT + 100_000,
}

/** ⚑ The line's words for a name — built the way the component builds it, date in the reader's locale. */
const askLine = (name: string): string =>
  `${name} asked to set these rules · ${new Date(AT).toLocaleString()}`

describe('712 §2c · R41 — the ask on an identity’s own rules names the agent that asked', () => {
  /** ⚑ `own-instructions.dom.test.ts`' double — with a roster ref, or (its own shape) with none. */
  const storeWith = (roster: AgentIdentity[] | null | 'no-field'): AgentStore => {
    const identities =
      roster === 'no-field'
        ? {}
        : {
            identities: ref(
              roster === null
                ? null
                : ({
                    identities: roster,
                    foldersWithoutARow: [],
                    spawningEnabled: true,
                    defaultApprovalMode: 'ask',
                    use: [],
                  } as unknown as AgentIdentities),
            ),
          }
    return {
      instructionsFor: async () => ASKED,
      instruct: async () => null,
      decideInstruction: async () => null,
      ...identities,
    } as unknown as AgentStore
  }

  const opened = async (store: AgentStore): Promise<Mounted> => {
    await page.viewport(760, 900)
    const m = mount(
      OwnInstructions,
      { profileSlug: 'bookkeeper', store },
      { width: 760, height: 900 },
    )
    await nextTick()
    await nextTick()
    return m
  }
  const who = (m: Mounted): string =>
    said(m.q('own-instructions-ask-iprop_1').querySelector('.ask-who') as HTMLElement)

  it('🔴 a store holding the roster: “Ada asked to set these rules”', async () => {
    const m = await opened(storeWith(NAMED()))
    expect(visible(m.q('own-instructions-ask-iprop_1'))).toBe(true)
    expect(who(m)).toBe(askLine('Ada'))
  })

  it('⚑ THE CONTROL — a double with NO roster field at all (the old double’s shape): no throw, the slug', async () => {
    const m = await opened(storeWith('no-field'))
    expect(who(m)).toBe(askLine('project-manager'))
  })

  it('⚑ THE CONTROL, same mount one fact over — the roster lands after the ask is drawn, and the line follows it', async () => {
    const store = storeWith(null)
    const m = await opened(store)
    expect(who(m)).toBe(askLine('project-manager'))
    ;(store.identities as unknown as { value: unknown }).value = {
      identities: NAMED(),
      foldersWithoutARow: [],
      spawningEnabled: true,
      defaultApprovalMode: 'ask',
      use: [],
    }
    await nextTick()
    expect(who(m)).toBe(askLine('Ada'))
  })

  it('🔴 inside the capabilities sheet, over the REAL store: the ask names Ada, on Pam’s sheet; unnamed, the slug', async () => {
    reset({ roster: NAMED(), reading: ASKED })
    const m = await theSheet('bookkeeper')
    expect(said(m.q('capabilities-title'))).toBe('Pam')
    expect(who(m)).toBe(askLine('Ada'))
    // ⛔ One fact over, same mount: the names taken away and the roster re-read.
    world.roster = UNNAMED()
    await m.store.load()
    await settle()
    expect(said(m.q('capabilities-title'))).toBe('bookkeeper')
    expect(who(m)).toBe(askLine('project-manager'))
  })
})

/* ─────────────── §2d · the capabilities sheet, named ─────────────── */

/**
 * ⚑ **Standing rule 5 — the sheet's sentences, pinned BY NAME for Ada** beside the builders the
 * controls below use; a builder that drifted from the component fails here first.
 */
const OWNER_ADA =
  'This is Ada’s own row: every grant below is stored on it and read when a conversation is running as Ada. Any agent may start a conversation as Ada, and that conversation holds these grants.'
const SERVERS_ADA =
  'A server registered as everyone’s is used by Ada with nothing to tick. Tick a restricted one to give Ada that one; it writes Ada’s row and changes nothing about any other identity.'
const REOPEN_ADA = 'Open as Ada in this window. Reopening one gives it what this row says now.'

// ⚠️ **D-014 · the owner line's second sentence changed** — the one about *any other identity
// named among them* was about the grant picker, which is gone; the new one says any agent may start
// a conversation as this identity and hold these grants.
const ownerSays = (name: string): string =>
  `This is ${name}’s own row: every grant below is stored on it and read when a conversation is running as ${name}. Any agent may start a conversation as ${name}, and that conversation holds these grants.`
const serversSay = (name: string): string =>
  `A server registered as everyone’s is used by ${name} with nothing to tick. Tick a restricted one to give ${name} that one; it writes ${name}’s row and changes nothing about any other identity.`
const reopenSays = (name: string): string =>
  `Open as ${name} in this window. Reopening one gives it what this row says now.`

// The real editable message rail gets fixture-only launch metadata to exercise the generic offer.
// This does not claim that the shipped message control has a Reopen offer.
const R41_FIELDS = CAPABILITY_FIELDS.map((field) =>
  field.key === 'canMessage'
    ? { ...field, whenItTakesEffect: 'Fixture-only launch disclosure for the naming contract.' }
    : field,
)
const LAUNCH_TIME = R41_FIELDS.filter((field) => field.key === 'canMessage')
const OPEN: readonly AConversationToReopen[] = [
  { sessionId: 'sess_1', where: '/work', heldBy: null, busy: false },
]

/** Every sentence §2d reads that names the identity, off one mount. */
function namedSentences(m: Mounted): Record<string, string> {
  const out: Record<string, string> = {
    title: said(m.q('capabilities-title')),
    owner: said(m.q('capabilities-owner')),
    servers: said(m.q('external-mcp-direction')),
  }
  for (const field of LAUNCH_TIME) {
    out[`${field.key}-open`] = said(
      m.q(`grant-${field.key}-open-now`).querySelector('.identity-note') as HTMLElement,
    )
  }
  return out
}
function sentencesFor(name: string): Record<string, string> {
  const out: Record<string, string> = {
    title: name,
    owner: ownerSays(name),
    servers: serversSay(name),
  }
  for (const field of LAUNCH_TIME) out[`${field.key}-open`] = reopenSays(name)
  return out
}

describe('712 §2d · R41 — the capabilities sheet names the identity it is about; the KEY stays a slug', () => {
  it('the shipped message rail stays editable without offering a launch-only Reopen', async () => {
    reset({ roster: NAMED() })
    const m = await theSheet('project-manager', { openAs: OPEN })
    expect(
      CAPABILITY_FIELDS.find((field) => field.key === 'canMessage')?.whenItTakesEffect,
    ).toBeNull()
    expect(visible(m.q('capability-canMessage-select'))).toBe(true)
    expect(m.all('grant-canMessage-open-now')).toHaveLength(0)
    expect(m.all('capability-canWriteRules')).toHaveLength(0)
    await pick(m, 'capability-canMessage-select', 'none')
    expect((m.q('capability-canMessage-select') as HTMLSelectElement).value).toBe('none')
    expect(m.all('grant-canMessage-open-now')).toHaveLength(0)
  })

  it('🔴 project-manager named Ada: title, owner, servers and the reopen offer say Ada — the glyph and the Slug row keep the key', async () => {
    // ⚑ The builders agree with the words pinned by name.
    expect(ownerSays('Ada')).toBe(OWNER_ADA)
    expect(serversSay('Ada')).toBe(SERVERS_ADA)
    expect(reopenSays('Ada')).toBe(REOPEN_ADA)
    expect(LAUNCH_TIME.length).toBeGreaterThan(0)
    expect(LAUNCH_TIME.map((field) => field.key)).toEqual(['canMessage'])

    reset({ roster: NAMED() })
    const reopened: string[] = []
    const m = await theSheet('project-manager', {
      openAs: OPEN,
      fields: R41_FIELDS,
      onReopen: (id) => reopened.push(id),
    })
    expect(visible(m.q('capabilities-title'))).toBe(true)
    expect(said(m.q('capabilities-owner')).startsWith('This is Ada’s own row:')).toBe(true)
    expect(said(m.q('capabilities-owner'))).toContain('running as Ada.')
    expect(namedSentences(m)).toEqual(sentencesFor('Ada'))
    // ⛔ The header a person reads first prints no slug at all…
    const header = m.q('capabilities-title').closest('.sheet-header') as HTMLElement
    expect(said(header)).not.toContain('project-manager')
    // ⚑ …except where the slug is the KEY: the glyph (one derivation with StartAsAgent's —
    // a-name-the-app-mints-for-itself.dom.test.ts) and the Slug row.
    const glyph = m.host.querySelector('.sheet-glyph') as HTMLElement
    expect(visible(glyph)).toBe(true)
    expect(said(glyph)).toBe('P')
    expect('Ada'.slice(0, 1)).not.toBe('P')
    expect(said(m.q('capabilities-slug'))).toBe('project-manager')
    expect(m.all('capability-canWriteRules')).toHaveLength(0)
    const reopen = m.q('grant-canMessage-reopen-sess_1') as HTMLButtonElement
    expect(reopen.disabled).toBe(false)
    await pick(m, 'capability-canMessage-select', 'none')
    expect(reopen.disabled).toBe(true)
    reopen.click()
    expect(reopened).toEqual([])
    expect(said(m.q('grant-canMessage-cost-sess_1'))).toContain('Save first')
    await press(m, 'capability-canMessage-use-default')
    expect(reopen.disabled).toBe(false)
    reopen.click()
    expect(reopened).toEqual(['sess_1'])
  })

  it('⚑ THE CONTROL, same mount one fact over — the display name taken away: every one of those sentences carries the slug', async () => {
    reset({ roster: NAMED() })
    const m = await theSheet('project-manager', { openAs: OPEN, fields: R41_FIELDS })
    expect(namedSentences(m)).toEqual(sentencesFor('Ada'))
    world.roster = UNNAMED()
    await m.store.load()
    await settle()
    expect(namedSentences(m)).toEqual(sentencesFor('project-manager'))
    expect(said(m.host.querySelector('.sheet-glyph') as HTMLElement)).toBe('P')
  })

  it('⚑ THE CONTROL — re-pointed at `worker`, nobody named it: “worker”; at BroBot’s own row, unnamed: agentName’s label, “BroBot”', async () => {
    reset({ roster: NAMED() })
    const m = await theSheet('project-manager', { openAs: OPEN, fields: R41_FIELDS })
    expect(said(m.q('capabilities-title'))).toBe('Ada')

    await m.point('worker')
    expect(namedSentences(m)).toEqual(sentencesFor('worker'))
    expect(said(m.q('capabilities-owner')).startsWith('This is worker’s own row')).toBe(true)
    expect(said(m.host.querySelector('.sheet-glyph') as HTMLElement)).toBe('W')

    await m.point(DEFAULT_PROFILE_ID)
    // ⚠️ The old inline rule — `identity?.displayName ?? profileSlug` — said `brobot` here: the one
    // place it parted from `agentName`, which answers the product's label for BroBot's slug.
    expect(DEFAULT_PROFILE_LABEL).toBe('BroBot')
    expect(agentName(DEFAULT_PROFILE_ID, UNNAMED())).toBe('BroBot')
    expect(namedSentences(m)).toEqual(sentencesFor('BroBot'))
    expect(said(m.q('capabilities-title'))).not.toBe(DEFAULT_PROFILE_ID)
    expect(said(m.q('capabilities-slug'))).toBe(DEFAULT_PROFILE_ID)
    expect(said(m.host.querySelector('.sheet-glyph') as HTMLElement)).toBe('B')
  })

  it('⚑ KEPT a slug — no row for BroBot’s slug: the title is its name, the sentence saying there is no such identity says the slug that was asked for', async () => {
    reset({ roster: NAMED().filter((one) => one.slug !== DEFAULT_PROFILE_ID) })
    const m = await theSheet(DEFAULT_PROFILE_ID)
    expect(said(m.q('capabilities-title'))).toBe('BroBot')
    const none = m.q('capabilities-no-row')
    expect(visible(none)).toBe(true)
    // ⚑ The slug, in the `<code>` it has always sat in — and the name nowhere in that sentence.
    // ⚠️ Read off the element rather than the sentence's punctuation: `.sheet-state` lays its
    // parts out as flex items, so `innerText` puts a break between the slug and its comma.
    expect(said(none).startsWith(`There is no agent identity called ${DEFAULT_PROFILE_ID}`)).toBe(
      true,
    )
    expect(said(none.querySelector('code') as HTMLElement)).toBe(DEFAULT_PROFILE_ID)
    expect(said(none)).not.toContain(DEFAULT_PROFILE_LABEL)
    expect(m.all('capabilities-owner')).toHaveLength(0)
  })
})
