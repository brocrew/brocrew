import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowReactive, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import {
  useWhoCalledWhom,
  type RailSays,
} from '../../src/renderer/src/composables/useWhoCalledWhom'
import {
  facetsOfState,
  recordFacets,
  standingOf,
  standingWord,
  stateHere,
  SIZES,
  STANDING_LABEL,
  type AgentFacets,
} from '../../src/renderer/src/lib/agent-state'
import { OPEN_THE_CONVERSATION } from '../../src/renderer/src/lib/taking-over'
import type { ForestView } from '../../src/renderer/src/lib/the-forest'
import { agentStateWords, type AgentState } from '../../src/shared/agent-state'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentity, TranscriptEvent } from '../../src/shared/runtime-ipc'
import type { ForestNode } from '../../src/shared/the-whole-forest'
import { assertClippedButTold, assertDrawn, drawnReady } from './drawn'
import { conv, forestDrawn, task, viewOf } from './forest-fixture'
import { META, mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * # ⚑ The graph draws what this window holds as the rail does, and opens only what opens
 *
 * The Graph tab shares the Team page’s Vue Flow forest (`TeamForest` and `ForestCard`).
 * Selecting a sub-agent changes the window’s selected agent while keeping the whole forest.
 * `the-main-panel-shows-the-conversation-or-its-graph` checks tabs and selection; this file
 * checks each card’s visible content and actions in the engine.
 *
 * The cases cover card plates and words from the rail or forest poll, missing readings, the
 * selected conversation’s accent outline, card and task-line presses, given work on its
 * holder’s card, panning a wide family with the selected conversation visible, Fit, one edge
 * per child, scrolling back to a right-panel selection, tab persistence across conversation
 * changes, and clipped text recoverable through titles.
 *
 * ## ⛔ What went, and what took it — the landing's twelve (3ed26356), ported onto the forest
 *
 * - 🔴 **LOST in 3d53e6af — not moved, and pinned nowhere**: *"a read that did not answer says so
 *   under the graph — and an answered read does not"*. The *This may not be current* line went with
 *   `ConversationGraph.vue` and nothing replaced it. The tab draws `cast.forest`, which
 *   `RuntimeScreen.readTheCast` keeps on a refusal (`if (grown !== null …) cast.forest.value =
 *   grown`), and `ForestView` carries no *answered*: the Graph tab draws the last forest it had and
 *   says NOTHING. ⛔ The Team page does the opposite on purpose — its `theForest` is *"NOT kept on a
 *   refusal"*, because *"a stale TREE reads as this is the shape of your work"* (641 §5.5).
 *   ⚠️ Neither neighbour covers it: the main-panel file's *"a forest not read yet draws one quiet
 *   line"* is a forest never read, and `the-forest-from-the-person-down`'s *"a read that could not
 *   look"* is a read that ANSWERED (`walk: 'no-ledger'`). 2005 M11's mutant is today's product.
 *   On refusal, drop the retained forest or disclose that it may be stale. This gap has no test
 *   here until the product defines which behavior it provides.
 * - ⚠️ *"each agent is drawn as its rail row draws it"* lost the rail's map, the dot and the rail's
 *   word (3d53e6af): a card draws the fold's plate and its STANDING word, and the screen hands the
 *   fold the rail's own derivation for what the window holds (`ForestViewInput.live`) — and for
 *   nothing else. 🔴 The landing's *"one the rail does not name draws the faceless plate"* (2005 M3)
 *   is gone with it: such an agent now draws the forest's recorded plate, pinned as it is now.
 * - ⚠️ *"…at the card size, and says the state the pane's own card says"* went in 3d53e6af — every
 *   card is `ForestCard`'s plate (the rail row's size since 2026-10-01) with the forest's word; *"it is not a control"* went in
 *   70aaa954 — its press selects its agent (UI-006), pinned in the main-panel file.
 * - ⚑ *"each node says Open …"* and *"a task line under a kid opens that kid's conversation"* went in
 *   70aaa954 and CAME BACK with UI-006: a press selects, which is opening.
 * - ⚠️ *"the agents it only gave work to draw after the ones it spawned"* — the ORDER went in 3d53e6af:
 *   the forest draws every agent where it was started.
 * - ⚠️ *"the kids scroll on their own row"* — the row's own scroller went in 2053fd25/3d53e6af: Vue
 *   Flow pans the whole drawing inside its box, and its *"the last is reachable"* is the *Fit*
 *   control now.
 * - ⚠️ *"the lines join the tiers, and the rail runs from the first kid's stub to the last"* — the
 *   hand-drawn tier lines and stubs went in 2053fd25/3d53e6af: one Vue Flow edge per child. The
 *   edge's two ends at the cards' CENTRES are `who-called-whom-as-generations`' §1.
 * - ⚠️ *"…pressing a node walks the graph"* went in 3d53e6af (the forest never re-roots), and the long
 *   WORD's clip with it (the forest's word is a standing label, and it wraps).
 *
 * ⛔ **Every negative here is paired with the same mount one fact over** — a record held and none,
 * a rail on screen and none, a screen above and none, a family that fits and one that does not —
 * because an absence read from a graph that drew nothing would pass.
 *
 * ⚠️ **Colours are read where a person sees them**: a probe painted with the token, appended INSIDE
 * the forest (the pane is `data-chat-theme="light"`, whose tokens differ from `:root`), and the two
 * `getComputedStyle` answers compared.
 */

afterEach(() => {
  unmountAll()
  const cast = useWhoCalledWhom()
  cast.reading.value = null
  cast.goTo.value = null
  // ⛔ **The channel is a window-level singleton**, so a rail or a choice left behind would be the
  // next test's premise.
  cast.railSays.value = null
  cast.forest.value = null
  cast.processMemory.value = new Map()
})

const NOW = Date.now()
const ID = META.sessionId

const identity = (slug: string, displayName: string): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName,
  createdAt: NOW,
  createdBy: null,
  provider: null,
  externalMcpServerIds: [],
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

const LONG_NAME = 'Bartholomew Maximilian Featherstonehaugh-Cholmondeley the Third'
const LONG_SLUG = 'a-very-long-profile-slug-that-no-node-could-hold-in-one-line'

const IDS = [
  identity('brobot', 'BroBot'),
  identity('project-manager', 'Ada'),
  identity('inspector', 'Ana'),
  identity('dev', 'Arjun'),
  identity('researcher', 'Rui'),
  identity(LONG_SLUG, LONG_NAME),
]

/**
 * ⚑ **The fixture**: Ada started this conversation (BroBot) and Rui; this one started Ana and
 * Arjun, gave W1.1 to Ana and W1.3 to Rui — whom it never started — and holds W1.0, which Ada gave
 * it. Arjun holds nothing.
 *
 * ⚠️ **Rui is `unwatched` and it is the point**: this app runs him and nothing has read what he is
 * doing, so his plate is the faceless one — where every `not-running` card draws the `idle` its
 * record says (D-017b), which the faceless plate is not.
 */
const ROWS = (): ForestNode[] => [
  conv('sess_boss', null, { identity: 'project-manager' }),
  conv(ID, 'sess_boss', { identity: 'brobot' }),
  conv('sess_ana', ID, { identity: 'inspector' }),
  conv('sess_arjun', ID, { identity: 'dev' }),
  conv('sess_rui', 'sess_boss', { identity: 'researcher', running: 'unwatched' }),
  heldBy(
    task(ID, 'work_0', 'W1.0', 'Ship the graph tab', 'sess_boss'),
    'brobot',
    'project-manager',
  ),
  heldBy(
    task('sess_ana', 'work_1', 'W1.1', 'Inspect the window states', ID),
    'inspector',
    'brobot',
  ),
  heldBy(task('sess_rui', 'work_3', 'W1.3', 'Survey the rail rows', ID), 'researcher', 'brobot'),
]

/**
 * ⛔ **A piece names its holder, and its giver, by their OWN slugs** — the shared fixture's `task`
 * spells both off the session id (`'ana'` for Ana, who is `inspector`), and `agentName` hands a
 * slug it does not know back as it is, lower-case. So a task line that named its holder again
 * drew *ana* under *Ana*, and the case-sensitive negative below could not see it: the port's review
 * drew the holder's name back on every line and this file stayed 11/11 green (F2).
 */
function heldBy(row: ForestNode, toIdentity: string, fromIdentity: string): ForestNode {
  if (row.node !== 'a-task') throw new Error('only a piece of work has a holder')
  return { ...row, work: { ...row.work, toIdentity, fromIdentity } }
}

const EVERYONE = ['sess_boss', ID, 'sess_ana', 'sess_arjun', 'sess_rui']

/** ⚑ The forest, folded as the screen folds it — `live` is the window's own record of what it holds. */
/** ⚑ The forest, folded as the screen folds it — with the rail's rows, where a rail is on screen. */
const FOREST = (said?: ReadonlyMap<string, RailSays> | null): ForestView =>
  viewOf(ROWS(), IDS, said)

const said = (text: string): TranscriptEvent =>
  ({ type: 'assistant_message', text }) as unknown as TranscriptEvent

/**
 * ⚑ **A conversation this window HOLDS — its rail row and its forest plate, each derived as the
 * product derives it**: `SideRail`'s row for a record it is fed is `recordFacets(record, …)` and
 * `standingWord` of `stateHere`, and `RuntimeScreen.foldTheForest`'s `live` is `recordFacets` of the
 * same record — two calls, one derivation (no waits are read here, so `theWaitIn`/`theWorkIn` add
 * nothing). ⛔ Never a host row (`facetsOfState`): that is how the rail draws a conversation it is
 * NOT fed, and those never reach `live`.
 */
function heldHere(
  conversation: string,
  events: TranscriptEvent[],
): { rail: RailSays; live: AgentFacets } {
  const held = record(events, conversation)
  held.meta = { ...META, sessionId: conversation }
  const facets = recordFacets(held)
  return {
    rail: { facets, word: standingWord(facets, stateHere(held, facets, null, [])) },
    live: recordFacets(held),
  }
}

/** ⚑ The host's word that a turn is being driven — `control.status`, which the plate reads. */
const WORKING = { type: 'status', state: 'working' } as unknown as TranscriptEvent

interface Shown {
  /** Every conversation a press opened, in order. */
  opened?: string[]
  /** What the rail says of each conversation, or no rail on screen. */
  rail?: ReadonlyMap<string, RailSays>
  /** The folded forest the screen hands the pane; {@link FOREST} when absent. */
  forest?: ForestView | null
}

async function show(over: Shown = {}): Promise<Mounted> {
  // ⚑ W4.183 · the drawer docks up to 560px now, so the graph needs this much room to sit at zoom 1.
  await page.viewport(1300, 808)
  const cast = useWhoCalledWhom()
  cast.railSays.value = over.rail ?? null
  const opened = over.opened ?? []
  cast.goTo.value = (conversation) => opened.push(conversation)
  const m = mount(
    ConversationPane,
    paneProps({
      record: record([said('Checking the rail now.')]),
      identities: IDS,
      drawerOpen: true,
      forest: over.forest === undefined ? FOREST() : over.forest,
    }),
    { width: 1300, height: 808 },
  )
  await nextTick()
  return m
}

/**
 * ⚑ **The Graph tab, drawn and placed** — Vue Flow draws its cards a frame after the mount, then
 * fits (or centres) the view once they are measured; two more frames let that land.
 */
async function toGraph(m: Mounted): Promise<void> {
  m.q('main-tab-graph').click()
  await forestDrawn()
  await forestDrawn()
}

const card = (m: Mounted, id: string): HTMLElement => m.q(`forest-row-${id}`)

/** ⚑ Press a card's head, as a person would. */
async function press(m: Mounted, id: string): Promise<void> {
  card(m, id).querySelector<HTMLButtonElement>('[data-cy="forest-open"]')!.click()
  await nextTick()
}

const words = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

const nameOf = (el: Element): string => words(el.querySelector('[data-cy="forest-name"]'))

const saysOf = (el: Element): string => words(el.querySelector('[data-cy="forest-says"]'))

const plateOf = (el: Element): HTMLElement => {
  const plate = el.querySelector<HTMLElement>('[data-cy="agent-state"]')
  expect(plate, 'no plate on this card').not.toBeNull()
  return plate!
}

const tasksOn = (el: Element): string[] =>
  [...el.querySelectorAll('[data-cy="forest-task-number"]')].map((one) => words(one))

/* ------------------------------------------------------------------ colour, read where it is drawn */

/**
 * ⚑ **A probe painted with a token, read back** — appended inside `within`, so it sits in the same
 * cascade as the box it is compared with, and removed before anything else runs.
 */
function probe<T>(within: HTMLElement, css: string, reading: (style: CSSStyleDeclaration) => T): T {
  const one = document.createElement('div')
  one.style.cssText = css
  within.append(one)
  try {
    return reading(getComputedStyle(one))
  } finally {
    one.remove()
  }
}

const TRANSPARENT = 'rgba(0, 0, 0, 0)'

/** The colour a token paints a border — and it has to paint one, or two unpainted things agree. */
function borderOf(within: HTMLElement, token: string): string {
  const colour = probe(within, `border: 1px solid var(${token})`, (style) => style.borderTopColor)
  expect(colour, `${token} painted nothing, so it cannot be compared with`).not.toBe(TRANSPARENT)
  return colour
}

describe('the graph draws each conversation as the rail does, and opens only what opens', () => {
  /**
   * ⚑ **As the screen folds it** — `foldTheForest` hands the forest the rail's rows
   * (`cast.railSays`), so every card is its rail row: Ana, held here, wears the row the rail derives
   * from her record ({@link heldHere}), and says the rail's word. 🔴 **UI-004** — until it, the forest
   * took nothing from the rail (3d53e6af) and a card said the forest's own `STANDING_LABEL`
   * (*Working* where the rail said *working* and the app's word table *active*).
   *
   * ⚑ **Arjun is the agent the rail does not name AND this window does not hold** — the landing's
   * premise here (2005 M3). With the rail's rows he draws the faceless plate and no word, where the
   * poll drew the `idle` he recorded.
   */
  it('🔴 each agent wears its rail row — Ana, held, the plate and word the rail derives from her record; Rui and Arjun, whom the rail does not name, the faceless plate and no word', async () => {
    const held = heldHere('sess_ana', [said('Inspecting the window states.'), WORKING])
    const rail = new Map([['sess_ana', held.rail]])
    const m = await show({ rail, forest: FOREST(rail) })
    await toGraph(m)
    const ana = card(m, 'sess_ana')
    const rui = card(m, 'sess_rui')
    const arjun = card(m, 'sess_arjun')

    // ⚑ The premise: Ana's record says she is working — and the poll alone draws her `idle` (the
    // control below), so a node that says working can only have it from the rail's row.
    expect(held.live.doing).toBe('working')
    expect(held.rail.facets.doing).toBe('working')

    // ⚑ Ana: the rail's plate, with a face, and the rail's word — never the forest's own table.
    expect(nameOf(ana)).toBe('Ana')
    expect(plateOf(ana).dataset.doing).toBe(held.rail.facets.doing)
    expect(ana.querySelector('[data-cy="agent-avatar"]'), 'Ana drew no face').not.toBeNull()
    expect(ana.querySelector('[data-cy="agent-unknown"]')).toBeNull()
    expect(saysOf(ana)).toBe(held.rail.word)
    expect(saysOf(ana)).not.toBe(STANDING_LABEL[standingOf(held.live)])

    // ⛔ Rui and Arjun: the rail names neither — the faceless plate, and no word at all.
    for (const [one, name] of [
      [rui, 'Rui'],
      [arjun, 'Arjun'],
    ] as const) {
      expect(nameOf(one)).toBe(name)
      expect(plateOf(one).dataset.doing, `${name}'s plate`).toBe('unknown')
      expect(one.querySelector('[data-cy="agent-unknown"]'), `${name} drew a face`).not.toBeNull()
      expect(one.querySelector('[data-cy="agent-avatar"]')).toBeNull()
      expect(one.querySelector('[data-cy="forest-says"]'), `${name} said a word`).toBeNull()
    }
    expect(useWhoCalledWhom().railSays.value?.has('sess_arjun')).toBe(false)
  })

  it('🔴 a push the rail hears moves the card on the same mount — the forest is not read again', async () => {
    const held = heldHere('sess_ana', [said('Inspecting the window states.'), WORKING])
    const cast = useWhoCalledWhom()
    cast.railSays.value = new Map([['sess_ana', held.rail]])
    cast.goTo.value = () => undefined
    await page.viewport(1200, 808)
    // ⚑ The forest as it was read, ONCE — only the rail's rows move below, as a push moves them.
    const rows = ROWS()
    const base = paneProps({ record: record([said('Checking the rail now.')]), identities: IDS })
    const Screen = defineComponent({
      setup: () => () =>
        h(ConversationPane as Component, {
          ...base,
          forest: viewOf(rows, IDS, cast.railSays.value),
        }),
    })
    const m = mount(Screen, {}, { width: 1200, height: 808 })
    await nextTick()
    await toGraph(m)
    const ana = card(m, 'sess_ana')
    expect(plateOf(ana).dataset.doing).toBe('working')
    expect(saysOf(ana)).toBe(held.rail.word)
    // ⚑ The rail hears Ana go idle.
    cast.railSays.value = new Map([
      ['sess_ana', { facets: { doing: 'idle', being: 'live' }, word: 'idle' } satisfies RailSays],
    ])
    await nextTick()
    await forestDrawn()
    expect(card(m, 'sess_ana')).toBe(ana)
    expect(plateOf(ana).dataset.doing).toBe('idle')
    expect(saysOf(ana)).toBe('idle')
    // ⛔ …and Arjun, still unnamed, still faceless.
    expect(plateOf(card(m, 'sess_arjun')).dataset.doing).toBe('unknown')
  })

  it('🔴 a card wears the rail row WHOLE — the scheduled clock and the terminal marks, and the word with its details; an idle row neither', async () => {
    const due = Date.now() + 3 * 60_000
    const scheduled: AgentState = { is: 'scheduled', dueAt: due }
    const background: AgentState = { is: 'in-the-background', what: 'npm run build' }
    const idle: AgentState = { is: 'idle' }
    const row = (state: AgentState): RailSays => ({
      facets: facetsOfState(state),
      word: agentStateWords(state),
    })
    const rail = new Map([
      ['sess_ana', row(scheduled)],
      ['sess_rui', row(background)],
      ['sess_arjun', row(idle)],
    ])
    const m = await show({ rail, forest: FOREST(rail) })
    await toGraph(m)
    const markOf = (id: string): string | null =>
      card(m, id).querySelector('.work-mark')?.getAttribute('data-mark') ?? null
    // ⚑ The words carry what no plate can: the clock time, and the command.
    expect(saysOf(card(m, 'sess_ana'))).toBe(agentStateWords(scheduled))
    expect(saysOf(card(m, 'sess_ana'))).toContain('·')
    expect(saysOf(card(m, 'sess_rui'))).toBe(agentStateWords(background))
    expect(saysOf(card(m, 'sess_rui'))).toContain('npm run build')
    // ⚑ …and the plate is the rail's whole plate: its clock and its terminal.
    expect(markOf('sess_ana')).toBe('scheduled')
    expect(markOf('sess_rui')).toBe('background')
    // ⛔ The pair on the same mount: an idle row wears no mark and says only *idle*.
    expect(saysOf(card(m, 'sess_arjun'))).toBe('idle')
    expect(markOf('sess_arjun')).toBeNull()
  })

  it('⛔ THE CONTROL — with no rail and no record held, a conversation nothing runs draws the idle it recorded', async () => {
    const m = await show()
    await toGraph(m)
    // ⚑ Ada, Ana and Arjun are `not-running` and recorded `idle` — Ana one fact over the test above
    // (no record held), and Arjun too (no rail on screen), where he draws the same `idle`.
    for (const id of ['sess_boss', 'sess_ana', 'sess_arjun']) {
      const one = card(m, id)
      expect(plateOf(one).dataset.doing, `${nameOf(one)}'s plate`).toBe('idle')
      expect(saysOf(one), `${nameOf(one)}'s word`).toBe(STANDING_LABEL.idle)
      expect(
        one.querySelector('[data-cy="agent-avatar"]'),
        `${nameOf(one)} drew no face`,
      ).not.toBeNull()
    }
    // ⚑ Rui is still faceless: `unwatched`, and no reading names him.
    expect(plateOf(card(m, 'sess_rui')).dataset.doing).toBe('unknown')
    expect(saysOf(card(m, 'sess_rui'))).toBe(STANDING_LABEL.unknown)
  })

  /**
   * Measure each graph card’s plate at the rail row’s avatar size in the engine.
   */
  it('🔴 every card’s avatar is drawn at the rail row’s size, measured where the engine drew it', async () => {
    const m = await show()
    await toGraph(m)
    // The graph fits itself to its box, so a tall forest is drawn zoomed out: the plate is laid out
    // at the row's size and painted at that size times the zoom its node is drawn under.
    const node = card(m, EVERYONE[0]!).closest<HTMLElement>('.vue-flow__node')!
    const zoom = node.getBoundingClientRect().width / node.offsetWidth
    expect(zoom, 'the graph is zoomed to nothing').toBeGreaterThan(0)
    expect(zoom, 'the graph is zoomed in past its own size').toBeLessThanOrEqual(1)
    for (const id of EVERYONE) {
      const plate = plateOf(card(m, id))
      expect(plate.dataset.size, `${nameOf(card(m, id))}'s plate`).toBe(String(SIZES.row))
      expect(plate.offsetWidth, `${nameOf(card(m, id))}'s plate, as laid out`).toBe(SIZES.row)
      expect(plate.getBoundingClientRect().width).toBeCloseTo(SIZES.row * zoom, 0)
    }
  })

  /**
   * ⚠️ **8e6f0b47 fixed a stray rule that outlined EVERY card**, and a `data-current` attribute
   * cannot see that: the outline is read here as the engine painted it.
   */
  it('🔴 this conversation is the one outlined — in the accent, where every other card wears the hairline', async () => {
    const m = await show()
    await toGraph(m)
    const forest = m.q('team-forest')
    const accent = borderOf(forest, '--accent')
    const line = borderOf(forest, '--line')
    expect(accent).not.toBe(line)

    const self = card(m, ID)
    expect(nameOf(self)).toBe('BroBot')
    expect(self.dataset.current).toBe('true')
    expect(getComputedStyle(self).borderTopColor).toBe(accent)
    expect(getComputedStyle(self).borderTopStyle).toBe('solid')
    expect(getComputedStyle(self).boxShadow).not.toBe('none')
    // ⛔ Every other card: the ordinary hairline, and no glow.
    for (const id of EVERYONE.filter((one) => one !== ID)) {
      const other = card(m, id)
      expect(other.dataset.current, `${nameOf(other)} is current`).toBe('false')
      expect(getComputedStyle(other).borderTopColor, `${nameOf(other)}'s outline`).toBe(line)
      expect(getComputedStyle(other).boxShadow, `${nameOf(other)}'s glow`).toBe('none')
    }
  })

  /**
   * ⚑ **UI-006 · a press SELECTS the agent** (F045) — the one door, `cast.goTo`, which opens its
   * conversation; the task lines on a card are words, and a click on one is a click on the card.
   */
  it('🔴 every node says its press opens its conversation, and a task line is words and presses its card', async () => {
    const opened: string[] = []
    const m = await show({ opened })
    await toGraph(m)
    const presses = m.all('forest-open')
    expect(presses).toHaveLength(EVERYONE.length)
    for (const one of presses) {
      const whose = nameOf(one.closest('[data-kind="a-conversation"]')!)
      expect(one.tagName, `${whose}'s press`).toBe('BUTTON')
      expect(one.getAttribute('title'), `${whose}'s press`).toBe(OPEN_THE_CONVERSATION)
    }

    // ⚑ The task line under Ana: text, inside no button of its own — ⚑ **UI-005** (F043) a click on
    // it is a click on HER card, which selects her. ⛔ It used to do nothing at all.
    const line = card(m, 'sess_ana').querySelector<HTMLElement>('[data-cy="forest-task"]')!
    expect(words(line)).toContain('Inspect the window states')
    expect(line.tagName).toBe('SPAN')
    expect(line.closest('button')).toBeNull()
    expect(opened).toEqual([])
    line.click()
    await nextTick()
    expect(opened).toEqual(['sess_ana'])
    // ⚑ THE CONTROL — the card's head presses too.
    await press(m, 'sess_arjun')
    expect(opened).toEqual(['sess_ana', 'sess_arjun'])
  })

  it('🔴 an agent it only gave work to is drawn where it was started, holding that work — and no task line names its holder again', async () => {
    const m = await show()
    await toGraph(m)
    const self = card(m, ID)
    const rui = card(m, 'sess_rui')
    // ⚑ Rui was started by Ada, not by this conversation: he hangs under her, beside it.
    expect(nameOf(rui)).toBe('Rui')
    expect(rui.dataset.parent).toBe('sess_boss')
    expect(self.dataset.parent).toBe('sess_boss')
    expect(card(m, 'sess_ana').dataset.parent).toBe(ID)
    // ⚑ …with the work this conversation gave him ON his card.
    const given = rui.querySelector<HTMLElement>('[data-cy="forest-row-work_3"]')
    expect(given, 'Rui holds no W1.3').not.toBeNull()
    expect(words(given!.querySelector('[data-cy="forest-task-number"]'))).toBe('W1.3')
    expect(words(given!.querySelector('[data-cy="forest-task-said"]'))).toBe('Survey the rail rows')
    // ⛔ …and never on the giver's: this card holds what IT was given, and only that.
    expect(self.querySelector('[data-cy="forest-row-work_3"]')).toBeNull()
    expect(self.querySelector('[data-cy="forest-row-work_1"]')).toBeNull()
    expect(tasksOn(self)).toEqual(['W1.0'])
    expect(tasksOn(card(m, 'sess_ana'))).toEqual(['W1.1'])
    // ⛔ Arjun was given nothing, and draws no list at all — Ana's list is there to be seen.
    expect(card(m, 'sess_arjun').querySelector('ul')).toBeNull()
    expect(words(card(m, 'sess_ana').querySelector('ul'))).toContain('Inspect the window states')

    // ⚑ THE CONTROL — the fold DOES name each piece's holder, on the piece's own row, in the words
    // her card's head draws: the name is there to be drawn, so the negative below is about the
    // DRAWING and not about a name nobody could spell ({@link heldBy}).
    const fold = FOREST()
    const holderOf = (piece: string): string => fold.rows.find((row) => row.key === piece)!.name
    expect(['work_0', 'work_1', 'work_3'].map(holderOf)).toEqual(['BroBot', 'Ana', 'Rui'])
    expect(holderOf('work_1')).toBe(nameOf(card(m, 'sess_ana')))

    // ⛔ The card names its holder once, at its head, so no task line under it names it again.
    for (const id of EVERYONE) {
      const one = card(m, id)
      const name = nameOf(one)
      expect(name.length, `${id} has no name`).toBeGreaterThan(0)
      expect(words(one.querySelector('[data-cy="forest-open"]'))).toContain(name)
      expect(one.querySelectorAll('[data-cy="forest-name"]')).toHaveLength(1)
      for (const task of one.querySelectorAll('[data-cy="forest-task"]'))
        expect(words(task), `${name}'s task line`).not.toContain(name)
    }
  })

  /**
   * ⚑ **Vue Flow pans the whole drawing inside the tab** (2053fd25/3d53e6af), and the first view is
   * centred on the conversation a person is in when the forest is too wide to read whole.
   * ⚠️ **This conversation is the FIRST of nine siblings**, so a view merely fitted to the middle of
   * the family would leave it off the box's left edge — the landing's *"the first stays
   * reachable"*, as it is now. ⚑ **And the landing's *"the last is reachable"***: the row's own
   * scroller is gone, and the tab's *Fit* control is what brings every card into the box — measured
   * from a first view that left some of them outside it.
   */
  it('🔴 a family too big for the tab is panned inside it — this conversation is in view, Fit brings in the rest, and the page never scrolls sideways', async () => {
    const kids = Array.from({ length: 8 }, (_, i) => `sess_kid_${String(i)}`)
    const m = await show({
      forest: viewOf(
        [
          conv('sess_boss', null, { identity: 'project-manager' }),
          conv(ID, 'sess_boss', { identity: 'brobot' }),
          ...kids.map((kid) => conv(kid, 'sess_boss', { identity: 'inspector' })),
        ],
        IDS,
      ),
    })
    await toGraph(m)
    await drawnReady()
    const graph = m.q('conversation-graph')
    const drawing = m.q('forest-rows').getBoundingClientRect()
    // The nine siblings stack left to right's other way: down. Together they are taller than the
    // tab, which is what makes this a family the view has to pan over.
    const row = [ID, ...kids].map((id) => card(m, id).getBoundingClientRect())
    expect(
      Math.max(...row.map((one) => one.bottom)) - Math.min(...row.map((one) => one.top)),
      'the nine fit the tab, so nothing here overflowed',
    ).toBeGreaterThan(drawing.height)
    // ⚑ This conversation is inside the drawing's box, and its name is drawn.
    const self = card(m, ID).getBoundingClientRect()
    expect(self.left).toBeGreaterThanOrEqual(drawing.left - 0.5)
    expect(self.right).toBeLessThanOrEqual(drawing.right + 0.5)
    expect(self.top).toBeGreaterThanOrEqual(drawing.top - 0.5)
    expect(self.bottom).toBeLessThanOrEqual(drawing.bottom + 0.5)
    assertDrawn(
      card(m, ID).querySelector<HTMLElement>('[data-cy="forest-name"]')!,
      'this conversation’s name',
      m.q('team-forest'),
    )
    // ⛔ And neither the tab nor the page scrolls sideways.
    expect(graph.scrollWidth).toBeLessThanOrEqual(graph.clientWidth)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    )

    // ⚑ **The last is reachable** — the premise first: the first view left a card off the box, or
    // *Fit* below would have nothing to bring in.
    const family = ['sess_boss', ID, ...kids]
    expect(m.host.querySelectorAll('[data-kind="a-conversation"]')).toHaveLength(family.length)
    const outside = (box: DOMRect, one: DOMRect): boolean =>
      one.left < box.left - 0.5 ||
      one.right > box.right + 0.5 ||
      one.top < box.top - 0.5 ||
      one.bottom > box.bottom + 0.5
    expect(
      family.filter((id) => outside(drawing, card(m, id).getBoundingClientRect())).length,
      'every card was in view before Fit, so Fit had nothing to bring in',
    ).toBeGreaterThan(0)
    // ⚑ …then *Fit*, as a person presses it: every card of the family inside the box.
    m.q('forest-fit').click()
    await forestDrawn()
    const fitted = m.q('forest-rows').getBoundingClientRect()
    for (const id of family)
      expect(outside(fitted, card(m, id).getBoundingClientRect()), `${id} after Fit`).toBe(false)
    expect(graph.scrollWidth).toBeLessThanOrEqual(graph.clientWidth)
    unmountAll()

    // ⚑ THE CONTROL — the fixture's five fit the column: every card inside the box.
    const few = await show()
    await toGraph(few)
    const inner = few.q('forest-rows').getBoundingClientRect()
    for (const id of EVERYONE) {
      const one = card(few, id).getBoundingClientRect()
      expect(one.left, id).toBeGreaterThanOrEqual(inner.left - 0.5)
      expect(one.right, id).toBeLessThanOrEqual(inner.right + 0.5)
    }
    expect(nameOf(card(few, 'sess_rui'))).toBe('Rui')
  })

  /**
   * ⚑ **Vue Flow's edges** (2053fd25/3d53e6af), one per conversation that has a parent in the
   * drawing. ⚠️ Where each end meets its card's CENTRE is `who-called-whom-as-generations`' §1; here,
   * that the tiers are joined — the graph runs left to right, so each line leaves its parent's
   * right side and reaches its child's left side — and the hairline it is drawn in.
   */
  it('🔴 one line joins each conversation to the one that started it, in the strong hairline — and a root draws none', async () => {
    const m = await show()
    await toGraph(m)
    const graph = m.q('conversation-graph')
    const edges = [...graph.querySelectorAll<SVGGElement>('[data-id^="forest-edge-"]')]
    expect(edges.map((edge) => edge.dataset.id).sort()).toEqual(
      [ID, 'sess_ana', 'sess_arjun', 'sess_rui'].map((id) => `forest-edge-${id}`).sort(),
    )
    const forest = m.q('team-forest')
    const strong = borderOf(forest, '--line-strong')
    expect(strong).not.toBe(borderOf(forest, '--line'))
    for (const edge of edges) {
      const child = edge.dataset.id!.replace('forest-edge-', '')
      const parent = card(m, child).dataset.parent!
      const path = edge.querySelector<SVGPathElement>('path.vue-flow__edge-path')!
      expect(getComputedStyle(path).stroke, `${child}'s line`).toBe(strong)
      expect(getComputedStyle(path).strokeWidth, `${child}'s line`).toBe('1.5px')
      const ctm = path.getScreenCTM()!
      const at = (length: number): DOMPoint => {
        const point = path.getPointAtLength(length)
        return new DOMPoint(point.x, point.y).matrixTransform(ctm)
      }
      const leaves = card(m, parent).getBoundingClientRect().right
      const reaches = card(m, child).getBoundingClientRect().left
      expect(Math.abs(at(0).x - leaves), `${child}'s line leaves its parent`).toBeLessThan(2)
      expect(
        Math.abs(at(path.getTotalLength()).x - reaches),
        `${child}'s line reaches it`,
      ).toBeLessThan(2)
    }
    // ⛔ Ada is a root: no line runs into her.
    expect(nameOf(card(m, 'sess_boss'))).toBe('Ada')
    expect(graph.querySelector('[data-id="forest-edge-sess_boss"]')).toBeNull()
    unmountAll()

    // ⚑ THE CONTROL — a forest of one conversation draws its card, and no line at all.
    const alone = await show({ forest: viewOf([conv(ID, null, { identity: 'brobot' })], IDS) })
    await toGraph(alone)
    expect(nameOf(card(alone, ID))).toBe('BroBot')
    expect(
      alone.q('conversation-graph').querySelectorAll('[data-id^="forest-edge-"]'),
    ).toHaveLength(0)
  })

  /**
   * 🔴 **UI-004 · a line is dashed while the parent waits on the child** (F042) — while the child holds
   * an open piece its parent gave it, read as the engine painted the line. ⚑ BroBot holds W1.0 from
   * Ada, and Ana W1.1 from BroBot: both dashed. ⛔ Arjun holds nothing, and Rui holds W1.3 from
   * BroBot, who is not his parent: both solid.
   */
  it('🔴 a line is dashed while its parent holds an open piece it gave that child — solid otherwise, and once the piece is answered', async () => {
    const dashOf = (m: Mounted, child: string): string => {
      const edge = m.q('conversation-graph').querySelector(`[data-id="forest-edge-${child}"]`)
      expect(edge, `no line into ${child}`).not.toBeNull()
      return getComputedStyle(edge!.querySelector('path.vue-flow__edge-path')!).strokeDasharray
    }
    const m = await show()
    await toGraph(m)
    expect(dashOf(m, ID)).not.toBe('none')
    expect(dashOf(m, 'sess_ana')).not.toBe('none')
    expect(dashOf(m, 'sess_arjun')).toBe('none')
    expect(dashOf(m, 'sess_rui')).toBe('none')
    unmountAll()
    // ⚑ The pair, one fact over: W1.1 answered, and Ana's line is solid; BroBot's still dashed.
    const answered = ROWS().map((row) =>
      row.node === 'a-task' && row.work.piece === 'work_1'
        ? ({ ...row, work: { ...row.work, state: 'answered' } } as ForestNode)
        : row,
    )
    const done = await show({ forest: viewOf(answered, IDS) })
    await toGraph(done)
    expect(dashOf(done, 'sess_ana')).toBe('none')
    expect(dashOf(done, ID)).not.toBe('none')
    unmountAll()
    // ⛔ **Whatever either is doing**: Arjun mid-turn with nothing open from BroBot is solid, and Ana
    // at rest with BroBot's W1.1 open is dashed — the old *child is busy* rule would draw the reverse.
    const busy = heldHere('sess_arjun', [said('Fixing the rail row.'), WORKING])
    const resting = heldHere('sess_ana', [said('Waiting for the answer.')])
    const rail = new Map([
      ['sess_arjun', busy.rail],
      ['sess_ana', resting.rail],
    ])
    const doing = await show({ rail, forest: FOREST(rail) })
    await toGraph(doing)
    expect(plateOf(card(doing, 'sess_arjun')).dataset.doing).toBe('working')
    expect(plateOf(card(doing, 'sess_ana')).dataset.doing).toBe('idle')
    expect(dashOf(doing, 'sess_arjun')).toBe('none')
    expect(dashOf(doing, 'sess_ana')).not.toBe('none')
  })

  it('🔴 a row shown from the right panel is scrolled to once the conversation is drawn again, and at once when it already is', async () => {
    const calls: { item: string | undefined; drawn: boolean }[] = []
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>
    const had = Object.prototype.hasOwnProperty.call(proto, 'scrollIntoView')
    const original = proto.scrollIntoView
    proto.scrollIntoView = function (this: HTMLElement): void {
      calls.push({ item: this.dataset.item, drawn: visible(this) })
    }
    try {
      const m = await show()
      const row = m.host.querySelector<HTMLElement>('.entry[data-item]')!
      const item = row.dataset.item!
      const focus = m.vm.focus as (itemId: string) => boolean
      const forItem = (): { item: string | undefined; drawn: boolean }[] =>
        calls.filter((call) => call.item === item)

      // ⚑ THE CONTROL — on the conversation tab already: one scroll, and the row is drawn.
      expect(focus(item)).toBe(true)
      expect(forItem()).toEqual([{ item, drawn: true }])
      calls.length = 0
      expect(focus('nope')).toBe(false)
      expect(calls).toHaveLength(0)

      // ⚑ On the Graph tab the first scroll finds a hidden row; the one that lands comes a frame
      // later, once the conversation is drawn again.
      await toGraph(m)
      expect(card(m, ID).dataset.current).toBe('true')
      expect(visible(m.q('main-conversation'))).toBe(false)
      expect(focus(item)).toBe(true)
      await nextTick()
      await nextTick()
      expect(m.q('main-tab-conversation').getAttribute('aria-selected')).toBe('true')
      expect(visible(m.q('main-conversation'))).toBe(true)
      const seen = forItem()
      expect(seen.length).toBeGreaterThanOrEqual(2)
      expect(seen[0]!.drawn).toBe(false)
      expect(seen.some((call) => call.drawn)).toBe(true)
    } finally {
      if (had) proto.scrollIntoView = original
      else delete proto.scrollIntoView
    }
  })

  /**
   * A conversation change, through the rail or graph, retains the tab and whole forest and
   * moves only the selected outline.
   */
  it('🔴 the chosen tab stays when the conversation changes — the outline moves to the new one, over the same whole forest', async () => {
    const state = shallowReactive(
      paneProps({
        record: record([said('one')]),
        identities: IDS,
        drawerOpen: true,
        forest: FOREST(),
      }),
    )
    const Wrapper = defineComponent({ setup: () => () => h(ConversationPane, state as never) })
    await page.viewport(1200, 808)
    useWhoCalledWhom().goTo.value = () => undefined
    const m = mount(Wrapper, {}, { width: 1200, height: 808 })
    await nextTick()
    await toGraph(m)
    expect(m.q('main-tab-graph').getAttribute('aria-selected')).toBe('true')
    expect(card(m, ID).dataset.current).toBe('true')
    expect(card(m, 'sess_ana').dataset.current).toBe('false')

    // ⚑ Another conversation comes on screen: Ana's.
    const next = record([said('two')], 'sess_ana')
    next.meta = { ...META, sessionId: 'sess_ana' }
    state.record = next
    await forestDrawn()

    expect(m.q('main-tab-graph').getAttribute('aria-selected')).toBe('true')
    expect(visible(m.q('conversation-graph'))).toBe(true)
    expect(visible(m.q('main-conversation'))).toBe(false)
    // ⚑ The outline moved with it…
    expect(card(m, 'sess_ana').dataset.current).toBe('true')
    expect(card(m, ID).dataset.current).toBe('false')
    // ⛔ …and nothing re-rooted: the same five, with Ada still the one nobody started.
    expect(
      m
        .all('forest-open')
        .map((one) => nameOf(one.closest('[data-kind="a-conversation"]')!))
        .sort(),
    ).toEqual(['Ada', 'Ana', 'Arjun', 'BroBot', 'Rui'])
    expect(card(m, 'sess_boss').dataset.parent ?? '').toBe('')
    // ⚑ The tab strip says so too: the chosen one underlined in the accent, the other not.
    const strip = m.q('main-tabs')
    const underline = probe(
      strip,
      'border-bottom: 2px solid var(--accent)',
      (s) => s.borderBottomColor,
    )
    expect(underline).not.toBe(TRANSPARENT)
    expect(getComputedStyle(m.q('main-tab-graph')).borderBottomColor).toBe(underline)
    expect(getComputedStyle(m.q('main-tab-conversation')).borderBottomColor).toBe(TRANSPARENT)
  })

  it('🔴 a card with more to say than it has room for clips it and carries the whole text on its title', async () => {
    const m = await show({
      forest: viewOf(
        [
          conv('sess_boss', null, { identity: 'project-manager' }),
          conv(ID, 'sess_boss', { identity: 'brobot' }),
          conv('sess_long', ID, { identity: LONG_SLUG }),
          conv('sess_ana', ID, { identity: 'inspector' }),
        ],
        IDS,
      ),
    })
    await toGraph(m)
    await drawnReady()
    const forest = m.q('team-forest')
    const long = card(m, 'sess_long')
    const nameEl = long.querySelector<HTMLElement>('[data-cy="forest-name"]')!
    const slugEl = long.querySelector<HTMLElement>('[data-cy="forest-slug"]')!
    expect(nameEl.textContent?.trim()).toBe(LONG_NAME)
    expect(slugEl.textContent?.trim()).toBe(LONG_SLUG)
    assertClippedButTold(nameEl, 'the long name', forest)
    assertClippedButTold(slugEl, 'the long slug', forest)
    expect(nameEl.title).toBe(LONG_NAME)
    expect(slugEl.title).toBe(LONG_SLUG)
    // ⚑ This conversation's own name carries itself on its title too.
    const selfName = card(m, ID).querySelector<HTMLElement>('[data-cy="forest-name"]')!
    expect(selfName.title).toBe(selfName.textContent?.trim())
    expect(selfName.title).toBe('BroBot')
    // ⚑ THE CONTROL — a short name and slug are drawn in full, so the sensor above can say no.
    const ana = card(m, 'sess_ana')
    assertDrawn(ana.querySelector<HTMLElement>('[data-cy="forest-name"]')!, 'Ana’s name', forest)
    assertDrawn(ana.querySelector<HTMLElement>('[data-cy="forest-slug"]')!, 'Ana’s slug', forest)
  })
})
