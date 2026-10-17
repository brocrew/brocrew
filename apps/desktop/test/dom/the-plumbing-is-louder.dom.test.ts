import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'
import { page } from 'vitest/browser'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import ToolEntry from '../../src/renderer/src/components/ToolEntry.vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import ToolRun from '../../src/renderer/src/components/ToolRun.vue'
import { createTranscript, applyEvent } from '../../src/renderer/src/lib/transcript'
import type { ToolItem } from '../../src/renderer/src/lib/transcript'
import { assertDrawn, cutsOf, drawnInFull, drawnReady, inkRects, titleRecovers } from './drawn'
import {
  contrast,
  mount,
  over,
  paintedBackground,
  paintedInk,
  paneProps,
  parseColor,
  record,
  show,
  unmountAll,
  type Rgba,
} from './harness'

/**
 * 🔴 **587 · what a person can SEE of a run of tool calls** — `EXT-013` §3.
 *
 * ## ⛔ Why every number here is a COMPARISON
 *
 * ⚠️ **`EXT-013` §3.1 does not give a size, it names a line**: *"the size and weight of
 * `thought · ~434 tokens`"*, and *"match it; do not invent a third weight."* ⛔ **A test that pinned
 * `9px` would go green the day the reference moved to 10 and the run did not** — which is the exact
 * failure the instruction is written against. ⚑ So the reference is MOUNTED beside the subject and
 * the assertion is that they agree.
 *
 * ## 🔴 The inversion, measured rather than asserted
 *
 * ⚠️ **`EXT-013` §3.2 is a claim about RELATIVE loudness** — *"the agent's words are the small quiet
 * part and the plumbing is the loud part"* — so §2 mounts the same seven calls twice, once as this
 * dispatch draws them and once as `ToolEntry` still draws a live one, and measures which way round
 * the two are. ⛔ **The control is what makes it a measurement**: without the old drawing beside it,
 * *the run is shorter than the message* is a fact about a fixture.
 *
 * ## ⚠️ What this file is NOT
 *
 * ⛔ **Not a snapshot, and never a class name** (`a-scoped-class-matches-nothing-in-another-component`).
 * Every assertion reads a computed property a person perceives — a size, a weight, an ink, a
 * painted background, a height, a tab stop.
 */

afterEach(unmountAll)

const PANE = { width: 992, height: 808 }

const call = (id: string, name = 'list_profiles', summary = '{}'): TranscriptEvent =>
  ({ type: 'tool_call', id, name, summary }) as TranscriptEvent
const back = (id: string, ok = true): TranscriptEvent =>
  ({ type: 'tool_result', id, summary: ok ? '{"profiles":[]}' : 'permission denied', ok }) as never

const REFUSED: TranscriptEvent = {
  type: 'tool_refused',
  tool: 'ask_question',
  rail: 'malformed-request',
  permanence: 'permanent',
  retryable: false,
} as TranscriptEvent

const WORDS = 'Let me look at who is available before I plan anything, because it matters.'

/** Ada's transcript: the agent's words, its reasoning, and seven calls around one refusal. */
const ADA: TranscriptEvent[] = [
  { type: 'assistant_message', text: WORDS } as TranscriptEvent,
  { type: 'thinking', tokens: 434, redacted: true } as TranscriptEvent,
  ...[1, 2, 3, 4, 5].flatMap((n) => [call(`t${n}`), back(`t${n}`)]),
  call('t6'),
  back('t6', false),
  call('t7'),
  back('t7'),
  REFUSED,
  call('t8'),
  back('t8'),
]

const paneOf = (events: TranscriptEvent[]) =>
  mount(ConversationPane, paneProps({ record: record(events), mode: 'normal' }), PANE)

/** The items the old drawing needs, folded exactly as the pane folds them. */
/**
 * `ToolEntry` mounted in the theme the transcript draws in, so the card and the line it is compared
 * with resolve the same tokens. The pane carries the scope on its own root.
 */
function cardInThePanesTheme(item: ToolItem): HTMLElement {
  const card = mount(ToolEntry, { item }, PANE)
  card.host.setAttribute('data-chat-theme', 'light')
  return card.q('tool-entry')
}

function foldedCalls(events: TranscriptEvent[]): ToolItem[] {
  const state = createTranscript()
  events.forEach((event, i) => applyEvent(state, event, 1_700_000_000_000 + i * 10, i + 1))
  return state.items.filter((item): item is ToolItem => item.kind === 'tool')
}

const ink = (el: Element): string => getComputedStyle(el).color

const CLEAR: Rgba = [0, 0, 0, 0]

/** How far a colour stands off what it is painted on, as contrast above 1:1, opacity included. */
const standsOff = (on: Element, colour: Rgba): number => {
  const { fg, bg } = paintedInk(on, colour)
  return contrast(fg, bg) - 1
}

/**
 * ⚑ **The ink a person sees**: every glyph run's area, every drawn edge and every fill that differs
 * from the ground under it, each weighted by how far it stands off that ground. A box that paints
 * nothing adds nothing, and a hairline adds little, where an area of boxes would count both in full.
 */
function seenInk(root: HTMLElement): number {
  let sum = 0
  const texts = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = texts.nextNode(); node; node = texts.nextNode()) {
    const host = node.parentElement
    const fg = host && node.textContent?.trim() ? parseColor(getComputedStyle(host).color) : null
    if (!host || !fg) continue
    const area = inkRects(node as Text).reduce((s, r) => s + r.width * r.height, 0)
    sum += area * standsOff(host, fg)
  }
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    const box = el.getBoundingClientRect()
    if (box.width === 0 || box.height === 0 || !el.parentElement) continue
    const style = getComputedStyle(el)
    for (const [side, run] of [
      ['Top', box.width],
      ['Bottom', box.width],
      ['Left', box.height],
      ['Right', box.height],
    ] as const) {
      const width = parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`))
      const edge = parseColor(style.getPropertyValue(`border-${side.toLowerCase()}-color`))
      if (
        width > 0 &&
        edge &&
        style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none'
      )
        sum += run * width * standsOff(el.parentElement, edge)
    }
    const fill = paintedInk(el, CLEAR).bg
    sum += box.width * box.height * standsOff(el.parentElement, fill)
  }
  return sum
}

/**
 * ⛔ **What a keyboard actually stops on**, rather than what carries a `tabindex`.
 * ⚠️ A `tabindex="-1"` is only a no-op where a host selector decides the order
 * (`a-custom-focus-trap-is-the-tab-order`); nothing overrides the document's order here, so this
 * reads the same set the browser would.
 */
const tabStops = (root: Element): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')]
    .filter((el) => el.getAttribute('tabindex') !== '-1')
    .filter((el) => !(el as HTMLButtonElement).disabled)

describe('§1 · the quiet line is the reference line, and its chrome is the card’s, no louder', () => {
  it('draws at the reasoning line’s own size, weight and ink — measured against it, not against a number', async () => {
    await page.viewport(1100, 900)
    const view = paneOf(ADA)
    await nextTick()

    const reference = view.q('thinking-pill')
    const run = view.all('tool-run')[0]!.querySelector<HTMLElement>('[data-cy="tool-run-toggle"]')!
    const a = getComputedStyle(reference)
    const b = getComputedStyle(run)

    // ⚑ **`EXT-013` §3.1's first row, as a comparison.** If the reference moves, this moves with it.
    expect(b.fontSize, `run ${b.fontSize} vs reference ${a.fontSize}`).toBe(a.fontSize)
    expect(b.fontWeight).toBe(a.fontWeight)
    expect(ink(run), `run ${ink(run)} vs reference ${ink(reference)}`).toBe(ink(reference))
    // ⚠️ And they start in the same column, or two quiet lines would read as two kinds of thing.
    const indent = (el: Element): number => el.getBoundingClientRect().left
    expect(Math.abs(indent(run) - indent(reference))).toBeLessThan(2)
  })

  it('wears the card ToolEntry wears and nothing louder — one shape for one fact, at a hairline', async () => {
    // ⛔ **The element that DECLARES the chrome, not the wrapper around it**: `.tool-run` carries
    // no border, so reading it would pass whatever `.head` drew.
    await page.viewport(1100, 900)
    const view = paneOf(ADA)
    await nextTick()
    const quiet = view
      .all('tool-run')[0]!
      .querySelector<HTMLElement>('[data-cy="tool-run-toggle"]')!

    // 🔴 **The control.** The same item drawn by `ToolEntry`, which still draws every live,
    // child-bearing and workflow-bearing call. A person who learned to read one must not meet a
    // second, heavier shape for the same fact.
    expect(
      quiet.closest('[data-chat-theme="light"]'),
      'the pane left its light scope',
    ).not.toBeNull()
    const card = cardInThePanesTheme(foldedCalls(ADA)[0]!)

    const chrome = (el: Element) => {
      const style = getComputedStyle(el)
      return {
        edge: style.borderTopWidth,
        edgeInk: style.borderTopColor,
        corner: style.borderTopLeftRadius,
        fill: style.backgroundColor,
      }
    }
    expect(chrome(card).edge, 'the card lost its edge, so this test measures nothing').not.toBe(
      '0px',
    )
    expect(chrome(quiet), 'the quiet line drew a different card').toEqual(chrome(card))

    // ⚠️ **Against ITS OWN ground**: the edge barely stands off the paper and the fill not at all,
    // so the card reads as a place for the line rather than as a second voice beside the words.
    const ground = paintedBackground(quiet.parentElement!)
    const edgeInk = over(parseColor(getComputedStyle(quiet).borderTopColor)!, ground)
    expect(
      contrast(edgeInk, ground),
      `the edge drew ${show(edgeInk)} on ${show(ground)}`,
    ).toBeLessThan(1.5)
    expect(
      contrast(paintedBackground(quiet), ground),
      `the quiet line painted ${show(paintedBackground(quiet))} over ${show(ground)}`,
    ).toBeLessThan(1.1)
    // ⚑ **And the sensor is not blind**: the line's own words stand off that same fill readably.
    const words = parseColor(getComputedStyle(quiet).color)!
    expect(contrast(words, paintedBackground(quiet))).toBeGreaterThan(4.5)
  })
})

describe('§2 · the inversion — the agent’s words outweigh the plumbing now, and did not', () => {
  it('draws less INK for eight calls than for one sentence the agent wrote, and the old drawing did the opposite', async () => {
    // ⛔ **Painted ink, not boxes.** A block's box includes the empty gutter beside it, and the
    // agent's `.entry` spans the stream's content box while the plumbing is capped at
    // `--measure-message`; a card's box is mostly a fill that barely differs from the paper.
    // ⚑ `seenInk` counts what is painted, weighted by how far it stands off its ground.
    await page.viewport(1100, 900)
    const view = paneOf(ADA)
    await drawnReady()

    const said = [...view.host.querySelectorAll<HTMLElement>('.entry')].find((el) =>
      el.textContent?.includes(WORDS),
    )
    expect(said, 'the agent’s own words are not on screen').toBeDefined()
    const words = seenInk(said!)
    const plumbing = view.all('tool-run').reduce((sum, row) => sum + seenInk(row), 0)

    expect(
      plumbing,
      `eight calls ink ${Math.round(plumbing)} and the sentence inks ${Math.round(words)}`,
    ).toBeLessThan(words)

    // ⛔ **The same eight calls, drawn the way they were** — one card each, so the comparison is
    // between two drawings of one fixture rather than between two fixtures.
    const items = foldedCalls(ADA)
    expect(items, 'the fixture is not the eight calls this test names').toHaveLength(8)
    const before = items.reduce((sum, item) => sum + seenInk(cardInThePanesTheme(item)), 0)
    expect(
      before,
      `the old drawing inked ${Math.round(before)} for the same calls`,
    ).toBeGreaterThan(words)
  })
})

describe('§3 · a refusal keeps its place, and its legibility', () => {
  it('sits between the runs rather than inside one, in ledger order', async () => {
    await page.viewport(1100, 900)
    const view = paneOf(ADA)
    await nextTick()

    const entries = [...view.host.querySelectorAll<HTMLElement>('.entry')]
    const at = (el: Element): number => entries.findIndex((entry) => entry.contains(el))
    const runs = view.all('tool-run')
    const notice = view.q('notice-warn')

    expect(runs, 'the refusal did not split the span').toHaveLength(2)
    expect(at(notice)).toBeGreaterThan(at(runs[0]!))
    expect(at(notice)).toBeLessThan(at(runs[1]!))
    // ⚑ Every clause the fold composes is on screen — including the one `EXT-013`'s example omits.
    expect(notice.textContent).toContain(
      'refused: ask_question · malformed-request · this exact call can never succeed · retrying will not help',
    )
  })

  it('and it is readable where it sits — the one row a person must not have to open anything for', async () => {
    await page.viewport(1100, 900)
    const view = paneOf(ADA)
    await nextTick()
    const notice = view.q('notice-warn')
    const fg = parseColor(getComputedStyle(notice).color)
    expect(fg, 'the refusal has no colour to measure').not.toBeNull()
    expect(contrast(fg!, paintedBackground(notice))).toBeGreaterThan(4.5)
  })
})

describe('§4 · what the line shouts about, and whether a person can see it', () => {
  it('marks the call that did not plainly succeed in a different ink from the rest of the line, and readably', async () => {
    await page.viewport(1100, 900)
    const view = paneOf(ADA)
    await nextTick()
    const row = view.all('tool-run')[0]!
    const amiss = row.querySelector<HTMLElement>('[data-cy="tool-run-amiss"]')
    const rest = row.querySelector<HTMLElement>('[data-cy="tool-run-head"]')!
    expect(amiss, 'the failed call left no mark on the line').not.toBeNull()

    // ⚠️ **A person perceives a DIFFERENCE, not a class.** The mark has to be told apart from the
    // line it sits on, and it has to be readable on the page it sits on.
    expect(ink(amiss!)).not.toBe(ink(rest))
    const fg = parseColor(getComputedStyle(amiss!).color)
    expect(fg).not.toBeNull()
    expect(contrast(fg!, paintedBackground(amiss!))).toBeGreaterThan(4.5)
  })

  it('says nothing in that ink when every call in the run is plainly done', async () => {
    // ⛔ The paired negative: without it, a mark drawn on every run would pass the test above.
    await page.viewport(1100, 900)
    const clean = [call('a'), back('a'), call('b'), back('b')]
    const view = paneOf(clean)
    await nextTick()
    expect(view.all('tool-run')).toHaveLength(1)
    expect(view.all('tool-run-amiss')).toHaveLength(0)
  })
})

describe('§5 · opened, it shows what was asked and what came back', () => {
  /**
   * ⛔ **Every call in `ADA` asks `{}` and answers the same JSON**, so nothing above could tell tab
   * 3 from tab 1 — found by the adversarial pass over this dispatch's diff, which noted that a
   * `shownCall` hard-wired to `calls[0]` passed the whole suite. ⚑ This fixture gives each call a
   * string of its own.
   */
  const NAMED: TranscriptEvent[] = [0, 1, 2, 3].flatMap((n) => [
    call(`n${n}`, `tool_${n}`, `{"which":${n}}`),
    { type: 'tool_result', id: `n${n}`, summary: `{"answered":${n}}`, ok: true } as TranscriptEvent,
  ])

  it('gives a tab per call and formats both halves', async () => {
    await page.viewport(1100, 900)
    const view = paneOf(ADA)
    await nextTick()
    const row = view.all('tool-run')[0]!
    row.querySelector<HTMLElement>('[data-cy="tool-run-toggle"]')!.click()
    await nextTick()

    const tabs = [...row.querySelectorAll<HTMLElement>('[role="tab"]')]
    expect(tabs).toHaveLength(7)
    expect(row.querySelector('[data-cy="tool-run-input"]')!.textContent).toContain('{}')
    // ⚑ **Formatted, and that is what the assertion reads**: the receipt is a JSON object on one
    // line in the ledger, and a formatted one is more than one line.
    const out = row.querySelector('[data-cy="tool-run-output"]')!.textContent ?? ''
    expect(out).toContain('profiles')
    expect(out.split('\n').length, `the output is still on one line:\n${out}`).toBeGreaterThan(1)
  })

  it('shows the call the selected tab NAMES, not the first one', async () => {
    await page.viewport(1100, 900)
    const view = paneOf(NAMED)
    await nextTick()
    const row = view.all('tool-run')[0]!
    row.querySelector<HTMLElement>('[data-cy="tool-run-toggle"]')!.click()
    await nextTick()
    const tabs = [...row.querySelectorAll<HTMLElement>('[role="tab"]')]
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      'tool_0',
      'tool_1',
      'tool_2',
      'tool_3',
    ])

    // ⚠️ **Every tab, not just one** — a panel that answered `calls[i % 2]` would pass a single
    // check on tab 3.
    for (const [index, tab] of tabs.entries()) {
      tab.click()
      await nextTick()
      expect(
        row.querySelector('[data-cy="tool-run-input"]')!.textContent,
        `tab ${index}`,
      ).toContain(`"which": ${index}`)
      expect(
        row.querySelector('[data-cy="tool-run-output"]')!.textContent,
        `tab ${index}`,
      ).toContain(`"answered": ${index}`)
    }
  })

  it('costs a keyboard ONE stop while closed, and the cards it replaces cost two each', async () => {
    // 🔴 **`587` §4.1, measured in both directions.** A transcript is long: what a keyboard does
    // through a run of collapsed tools is the question, and the answer is a comparison.
    await page.viewport(1100, 900)
    const view = paneOf(ADA)
    await nextTick()
    const row = view.all('tool-run')[0]!
    expect(tabStops(row)).toHaveLength(1)

    // ⛔ **`toBeGreaterThan(N)` is what the first draft asserted, and the title said *two each*** —
    // it passed when exactly ONE of eight cards offered a second stop
    // (`a-title-that-names-a-count-the-assertion-never-checks`, which this file's sibling declares
    // closed). ⚑ Two is what a settled card with an answer to show really costs: the fold toggle
    // and *Show the whole answer*.
    const items = foldedCalls(ADA)
    const cards = items.map((item) =>
      mount(ToolEntry, { item, canReadAnswer: true }, PANE).q('tool-entry'),
    )
    expect(cards.map((card) => tabStops(card).length)).toEqual(items.map(() => 2))
  })

  it('…and ONE each where the answer cannot be asked for, which is every replayed conversation', async () => {
    // ⚠️ **The *two each* above is conditional and the condition is `462` §2.2's whole subject.**
    // A conversation with no handle draws the sentence instead of the button, and a sentence is not
    // a tab stop — so the saving this dispatch claims is 2N→1 on a live conversation and N→1 on a
    // replayed one. Both are a saving; only one of them is the number in the title above.
    await page.viewport(1100, 900)
    const cards = foldedCalls(ADA).map((item) =>
      mount(ToolEntry, { item, canReadAnswer: false }, PANE).q('tool-entry'),
    )
    expect(cards.map((card) => tabStops(card).length)).toEqual(cards.map(() => 1))
  })

  it('opened, the tab strip is ONE stop and the arrows move inside it', async () => {
    await page.viewport(1100, 900)
    const view = paneOf(ADA)
    await nextTick()
    const row = view.all('tool-run')[0]!
    row.querySelector<HTMLElement>('[data-cy="tool-run-toggle"]')!.click()
    await nextTick()

    const strip = row.querySelector<HTMLElement>('[role="tablist"]')!
    expect(tabStops(strip), 'a seven-call run became seven tab stops').toHaveLength(1)

    const selected = (): number =>
      [...strip.querySelectorAll('[role="tab"]')].findIndex(
        (tab) => tab.getAttribute('aria-selected') === 'true',
      )
    expect(selected()).toBe(0)
    tabStops(strip)[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    )
    await nextTick()
    expect(selected()).toBe(1)
    tabStops(strip)[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    await nextTick()
    expect(selected()).toBe(6)
  })
})

describe('§6 · what a browser cuts off the quiet line, and what brings it back', () => {
  /**
   * ⛔ **At the pane's own FLOOR, not at a comfortable width.** `--app-min-w` is 1180 and
   * `--rail-w` is 208, so the narrowest pane this app can have is 972 px — which is where a line
   * that tallies tool names as long as `mcp__brobot__list_profiles` will cut if it ever does.
   *
   * ⚠️ **The dom runner draws OVERLAY scrollbars — 0 px here against 11 px in the Electron window**
   * (`the-dom-runner-draws-overlay-scrollbars`), so this is a LOWER bound on the cutting: the real
   * window has 11 fewer pixels than this mount does.
   */
  const FLOOR = 972

  /** ⚑ Six real tool names, long enough to fill the line, and one of them failed so there is a mark. */
  const LONG: TranscriptEvent[] = [1, 2, 3, 4, 5, 6].flatMap((n) => [
    call(`x${n}`, `mcp__brobot__a_tool_with_a_name_long_enough_to_fill_the_line_${n}`),
    back(`x${n}`, n !== 3),
  ])

  it('lets only the NAMES give way — the head and the mark fit their own boxes and the names do not', async () => {
    // 🔴 **`assertDrawn` on the head CANNOT FAIL here, and the first draft rested on it.** Nothing
    // in the chain `.label → .head → .tool-run` declares `overflow`, so `clipsOf` finds no clipper
    // and answers `[]` whatever the flex rules say (`a-positive-assertion-must-differ-from-the-default`).
    //
    // ⛔ **And the second draft could not fail either.** It compared the row at 520 px and at
    // 1600 px — and measured 615 px against 615 px, because `.tool-run` carries
    // `max-width: var(--measure-message)` **and** `margin: 0 auto`, and an auto cross-axis margin
    // disables the stretch that would have squeezed it. ⚑ **The row is 760 px at every width this
    // app can be**, which is also why `§6`'s FLOOR is ceremony rather than a bound.
    //
    // ⚑ **So the question is per-ELEMENT, not per-width**: did this box fit its own content? The
    // names are `min-width: 0` with an ellipsis and must NOT fit; the head and the mark are
    // `flex: 0 0 auto` and must.
    await page.viewport(FLOOR + 120, 900)
    const view = mount(ToolRun, { members: foldedCalls(LONG) }, { width: FLOOR, height: 808 })
    view.host.style.flexDirection = 'column'
    await drawnReady()
    const of = (cy: string): HTMLElement =>
      view.q('tool-run').querySelector<HTMLElement>(`[data-cy="${cy}"]`)!

    const names = of('tool-run-detail')
    // ⛔ **The non-vacuity half first** (`put-the-hazard-on-the-path-the-code-walks`): the line
    // really is over its room, or the two assertions after it are about a line with space to spare.
    expect(
      names.scrollWidth,
      `the planted names fit in ${names.clientWidth}px, so nothing below measures anything`,
    ).toBeGreaterThan(names.clientWidth)

    const head = of('tool-run-head')
    const mark = of('tool-run-amiss')
    expect(head.scrollWidth, 'the head gave way').toBeLessThanOrEqual(head.clientWidth)
    expect(mark.scrollWidth, 'the mark gave way').toBeLessThanOrEqual(mark.clientWidth)
  })

  it('and when the names DO cut, the row’s own title brings them back', async () => {
    // 🔴 **Planted, because the ordinary fixture does not cut** — and a clipping assertion that
    // never sees a clip is a test about nothing. The plant is a real tool name, not a filler
    // string: `put-the-hazard-on-the-path-the-code-walks`.
    await page.viewport(FLOOR + 120, 900)
    // ⚑ **Mounted DIRECTLY here, where the test above mounts it inside the pane.** The component's
    // own box is `max-width: var(--measure-message)` centred in whatever it is given, so both
    // mounts measure the same width — and measuring it alone means a clip this finds is the row's
    // own and not something the pane put in front of it.
    const view = mount(ToolRun, { members: foldedCalls(LONG) }, { width: FLOOR, height: 808 })
    await drawnReady()
    const row = view.q('tool-run')
    const detail = row.querySelector<HTMLElement>('[data-cy="tool-run-detail"]')!

    // ⚠️ **The control for the recovery below**: if this fixture stops cutting, the assertion after
    // it is vacuous and says so here rather than passing quietly.
    expect(
      drawnInFull(detail, row),
      'the planted names no longer cut, so the recovery below measures nothing',
    ).toBe(false)
    expect(cutsOf(detail, row).length).toBeGreaterThan(0)
    expect(titleRecovers(detail, row), 'the cut names are not on any title').toBe(true)
    // ⛔ And the head still is not what gave way.
    assertDrawn(row.querySelector<HTMLElement>('[data-cy="tool-run-head"]')!, 'the head', row)
  })
})

describe('§7 · a followed command that settles lets go of its follow', () => {
  /**
   * 🔴 **`587`'s own regression, caught by the adversarial pass over this dispatch's diff.**
   *
   * ⛔ **Before `587` a settled call kept its card**, so `watching` went `true → false` on a mounted
   * row and `ToolEntry`'s watcher raised the withdrawal. ⚠️ **Since `587` the row is REMOVED at the
   * moment it settles** — the fold drops it into the quiet run beside it — and the queued watcher
   * job is disposed with the instance. ⛔ `onBeforeUnmount` then read `watching`, which had already
   * recomputed to `false`, and withdrew nothing.
   *
   * 🔴 **What that costs is not cosmetic:** `ConversationPane` keeps the call id in `following` and
   * issues one `readCommandOutput` per second for the rest of the conversation, because
   * `stopFollowing` only fires when that set empties.
   *
   * ## ⚠️ Mounted on the REAL `TranscriptView`, and the first draft of this test was wrong
   *
   * ⛔ **A host that keeps the card mounted cannot reproduce it.** The first version set the result,
   * let Vue flush, and only then unmounted — so the watcher fired from a living component and the
   * test was GREEN against the defect. ⚑ **It is the SAME FLUSH that matters**: the fold has to be
   * the thing that removes the row, on the tick the receipt lands.
   */
  const following = (events: TranscriptEvent[]) => {
    const said: { callId: string; on: boolean }[] = []
    const state = createTranscript()
    events.forEach((event, i) => applyEvent(state, event, 1_700_000_000_000 + i * 10, i + 1))
    const items = reactive(state).items
    const view = mount(
      defineComponent({
        name: 'FollowHost',
        setup() {
          return () =>
            h(TranscriptView, {
              items,
              mode: 'normal',
              canWatchCommands: true,
              onWatchCommand: (callId: string, on: boolean) => said.push({ callId, on }),
            })
        },
      }),
      {},
      PANE,
    )
    return { said, items, view, state }
  }

  it('withdraws when the fold takes the row away, not when the row would still say it is watching', async () => {
    const { said, items, view } = following([call('t1', 'Bash', 'sleep 300')])
    await nextTick()
    // ⚑ Nothing is asked for while the card is folded, which is `300`'s own rule about cost.
    expect(said).toEqual([])
    const row = items[0] as ToolItem

    view.q(`tool-toggle-${row.id}`).click()
    await nextTick()
    expect(said, 'an open live card did not ask to be followed').toEqual([
      { callId: row.callId, on: true },
    ])

    // ⛔ **The receipt lands; the fold turns the row into a run member in the same flush.**
    row.result = { summary: 'done', ok: true }
    await nextTick()
    expect(
      view.all('tool-entry'),
      'the card is still a card, so this measures nothing',
    ).toHaveLength(0)

    expect(said.at(-1), 'the follow was never withdrawn — the pane polls it for ever').toEqual({
      callId: row.callId,
      on: false,
    })
  })

  it('and a card that never asked withdraws nothing when it goes', async () => {
    // ⛔ The paired negative: a withdrawal raised unconditionally would pass the test above and
    // would make the pane count withdrawals for follows nobody registered.
    const { said, items } = following([call('t1', 'Bash', 'sleep 300')])
    await nextTick()
    ;(items[0] as ToolItem).result = { summary: 'done', ok: true }
    await nextTick()
    expect(said).toEqual([])
  })
})
