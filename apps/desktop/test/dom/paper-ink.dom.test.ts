import { afterEach, describe, expect, it } from 'vitest'
import { nextTick, type Component } from 'vue'
import ChildWorkViewer from '../../src/renderer/src/components/ChildWorkViewer.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import PlanEntry from '../../src/renderer/src/components/PlanEntry.vue'
import WorkflowEntry from '../../src/renderer/src/components/WorkflowEntry.vue'
import CanonicalDocumentViewer from '../../src/renderer/src/components/CanonicalDocumentViewer.vue'
import WorkflowOutputViewer from '../../src/renderer/src/components/WorkflowOutputViewer.vue'
import type { PlanItem, WorkflowRunCard } from '../../src/renderer/src/lib/transcript'
import type {
  ChildWorkResult,
  TranscriptEvent,
  WorkflowOutputResult,
} from '../../src/shared/runtime-ipc'
import {
  channelGap,
  contrast,
  luminance,
  mount,
  over,
  paintedBackground,
  paintedInk,
  paneProps,
  parseColor,
  record,
  show,
  unmountAll,
  type Mounted,
  type Rgba,
} from './harness'

/**
 * **129 · The rest of the ink** — the three contrast defects `126` measured on real surfaces and
 * correctly refused, because each of them is a change somewhere `126` was not.
 *
 * ⛔ **Every ratio in this file comes from {@link paintedInk} or from an explicit composite**, never
 * from `color` against `paintedBackground`. `126`'s own biggest finding was that its first sensor
 * was opacity-blind and reported `12.49:1` for ink Chromium painted at `2.86:1`, across 31 of 40
 * elements — and one of the three defects here IS that fade. A number taken with the blind sensor
 * would be worse than no number.
 *
 * ## What is asserted, and against which bar
 *
 *  - **{@link RING} = 3:1**, on the focus indicator, in both themes, on every surface
 *    `DocumentBody` draws. It is WCAG 2.2's minimum for a non-text UI indicator, and it is the
 *    line the shipped build failed by more than half: the ring resolved `--focus-ring-color` from
 *    the APP (a pale `rgba(125,187,255,.72)` tuned for near-black) and painted it on white at
 *    **1.64:1**. The same gesture measured **6.07:1** in light and **5.54:1** inside
 *    `ChildWorkViewer`'s paper, which is the one paper `126` did put in the island.
 *  - **{@link FADED} = 3:1**, on the prose above a compaction boundary — the same bar `126` set
 *    for ink on paper, and for the same reason: the correct light palette's own floor sits between
 *    3 and 4.5, so 4.5 is not available here without re-tuning a shipped value.
 *  - **{@link CHIP} = 4.5:1**, on a selected chip's label, which is body text on a solid fill.
 */

afterEach(unmountAll)

/** A focus indicator. WCAG 2.2 SC 1.4.11 / 2.4.11 — non-text contrast. */
const RING = 3

/** Prose that has been de-emphasised but is still meant to be read (087's own words). */
const FADED = 3

/** A label on a solid accent fill. WCAG AA body text. */
const CHIP = 4.5

/**
 * A document with a CODE BLOCK, because the scrollbar half of this ticket needs one.
 *
 * ⚠️ The line is long on purpose: `.md-doc pre` is `overflow-x: auto`, so without a line wider than
 * the paper there is no scroller, and the thumb assertions below would be measuring a colour no
 * scrollbar ever paints.
 */
const MD = `# A document

Some prose, so the walk has ordinary body text on it too.

\`\`\`
const wide = '${'x'.repeat(400)}'
\`\`\`
`

const CHILD_JOURNAL: ChildWorkResult = {
  ok: true,
  part: 'journal',
  name: 'journal.jsonl',
  runId: 'wf_1',
  taskId: 't1',
  text: MD,
  truncated: false,
  bytes: MD.length,
}

const OUTPUT: WorkflowOutputResult = {
  ok: true,
  name: 'answer.md',
  text: MD,
  truncated: false,
  bytes: MD.length,
}

const PLAN: PlanItem = {
  kind: 'plan',
  id: 'plan_1',
  steps: [{ text: 'Read the file', status: 'done' }],
  body: MD,
}

/**
 * ⛔ **Every surface `DocumentBody` renders on**, which is the dispatch's acceptance 3 and is SIX
 * rather than the five the brief counted. Grepped for `<DocumentBody` and checked one by one; the
 * two the brief did not name are the plan document inside the transcript and a child's journal or
 * script, both of which take the paper whole.
 *
 * ⚠️ **This list is worth exactly its completeness**, which is the lesson `chat-theme.test.ts`'s
 * `READING_SURFACE` learned three times over. A seventh caller added without a line here would be
 * a surface with an unmeasured focus ring, and nothing else in the repo would notice.
 *
 * 🔴 **510 added the seventh and this sentence is why it is here rather than missing.** ⛔ The
 * prediction was exact: `510`'s viewer mounts `DocumentBody`, the whole suite stayed green, and
 * the only thing that put a line here was a person reading this paragraph. ⚠️ **The list is
 * STILL not derived**, and it is now behind the tree in the other direction too — `grep -c
 * '<DocumentBody' src/renderer/src/components` counts more mount SITES than this counts surfaces,
 * because `SessionInstructions.vue` draws four of them. That is reported rather than fixed: a
 * derivation would have to decide what a *surface* is, which is a different dispatch.
 *
 * ⚑ **D-016 deleted three of the seven** — the document drawer, the dispatch preview and the recruit
 * confirmation, the seed-only overlays — so the list is FOUR, and the cases that were measured on
 * one of them are re-hosted on a surface that remains (each says which, and why).
 */
const SURFACES = [
  {
    what: 'the plan document in the transcript',
    component: PlanEntry as Component,
    props: { item: PLAN },
  },
  {
    what: "the workflow run's output",
    component: WorkflowOutputViewer as Component,
    props: { result: OUTPUT, workflow: 'find-flaky-tests' },
  },
  {
    what: "a child's journal",
    component: ChildWorkViewer as Component,
    props: { result: CHILD_JOURNAL, label: 'agent · judge' },
  },
  // 🔴 **510 · the seventh**, and the one the paragraph above predicted. A canonical document is
  // read on the same paper as every other document in this app, so it inherits the same focus
  // ring and the same island — and now the same measurement.
  {
    what: 'a canonical document, opened from a work report',
    component: CanonicalDocumentViewer as Component,
    props: {
      result: {
        ok: true,
        documentId: 'doc:default:4:response',
        name: '004-response.md',
        // ⚑ **635 · the FORM, and this surface is a REPORT** — `CanonicalDocumentViewer` hides the
        // Markdown chip for a form that is not Markdown, so a fixture without one would measure a
        // paper that has no chip to focus. ⛔ Which is exactly how the gate found this line.
        form: 'markdown',
        text: MD,
        bytes: 128,
      },
    },
  },
] as const

const THEMES = ['dark', 'light'] as const

type PaperSurface = (typeof SURFACES)[number]

/** A surface by its name — the list's order is not something a case should lean on. */
function surfaceNamed<W extends PaperSurface['what']>(what: W): Extract<PaperSurface, { what: W }> {
  const found = SURFACES.find((s) => s.what === what)
  expect(found, `no surface is called ${what}`).toBeDefined()
  return found as Extract<PaperSurface, { what: W }>
}

const CASES = SURFACES.flatMap((s) =>
  THEMES.map((theme) => ({ ...s, theme, name: `${s.what} · ${theme}` })),
)

function open(surface: (typeof SURFACES)[number], theme: string): Mounted {
  const view = mount(surface.component, { ...surface.props }, { width: 900, height: 900 })
  view.host.setAttribute('data-chat-theme', theme)
  return view
}

/**
 * The paper, asserted to be exactly one.
 *
 * ⚠️ A viewer renders a paper AND a pile of chrome around it (the recruit and dispatch sheets did,
 * until D-016); a surface that silently rendered two (or none, because a prop shape drifted) would
 * make every measurement below about the wrong element or about nothing.
 */
function paperOf(view: Mounted, what: string): HTMLElement {
  const papers = view.all('document-body')
  expect(papers.length, `${what}: expected exactly one paper, found ${papers.length}`).toBe(1)
  return papers[0]!
}

/** What a token RESOLVES TO where an element sits — the engine, asked at a position. */
function resolvedAt(el: Element, token: string): string {
  const probe = document.createElement('span')
  probe.style.color = `var(${token})`
  el.appendChild(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return value
}

/**
 * What the focus ring actually reads at, on the surface it is drawn over.
 *
 * ⚠️ **`outline-offset` is 2px, so the ring sits OUTSIDE the button** — over `.seg-group`'s own
 * `--paper-seg-bg`, not over the chip. Compositing it against the button's own fill would measure a
 * ring nobody draws there and would have reported the shipped defect as fine.
 */
function ringOn(seg: HTMLElement): { ratio: number; colour: string; behind: Rgba } {
  seg.focus()
  // Non-vacuity: `button:focus-visible` is what carries the rule (base.css). If Chromium's
  // heuristic ever stops matching a programmatic focus, `outlineColor` falls back to the initial
  // value and every ratio below would be measuring a ring that is not on the screen.
  expect(seg.matches(':focus-visible'), 'the focused chip does not match :focus-visible').toBe(true)
  const style = getComputedStyle(seg)
  expect(style.outlineStyle, 'the focus rule did not apply').toBe('solid')
  expect(style.outlineWidth).toBe('2px')
  const colour = parseColor(style.outlineColor)
  expect(colour, `unparseable outline colour "${style.outlineColor}"`).not.toBeNull()
  const behind = paintedBackground(seg.parentElement!)
  return { ratio: contrast(over(colour!, behind), behind), colour: style.outlineColor, behind }
}

describe('129 §1 · the focus ring on every paper', () => {
  it.each(CASES)('$name: the ring clears 3:1', (surface) => {
    const view = open(surface, surface.theme)
    const paper = paperOf(view, surface.name)
    expect(getComputedStyle(paper).colorScheme, 'a white page declaring a dark colour scheme').toBe(
      'light',
    )
    const seg = paper.querySelector<HTMLElement>('[data-cy=doc-view-markdown]')
    expect(seg, 'the paper has no Markdown chip to focus').not.toBeNull()
    const ring = ringOn(seg!)
    expect(
      ring.ratio,
      `${surface.name}: the ring paints ${ring.colour} on ${show(ring.behind)} — ${ring.ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(RING)
  })

  /**
   * ⛔ **The escape, reproduced** — and it is what makes the ring cases above a measurement rather
   * than readings of a constant. Nothing changes but the scope: the paper keeps `--paper-bg`,
   * the button keeps its rule, and the only thing that moves is which `--focus-ring-color` the
   * cascade hands it.
   *
   * ⚠️ **Dark only, and the asymmetry IS the reason this shipped.** In light the ambient ramp is
   * already the paper ramp, so removing the scope changes nothing there — and the theme it was
   * broken in was the app's default at the time (`RuntimeScreen` started `chatLight` false until
   * 344 retired the toggle; the dark ramp is now the chrome's, and a document sheet is chrome).
   */
  it('⚠️ take the scope off the paper and the ring goes back to 1.84:1', () => {
    // ⚑ D-016: measured on the drawer until it was deleted; the workflow output is a whole-page
    // paper like it, and the ring and the scope are the paper's own, whoever hosts it.
    const view = open(surfaceNamed("the workflow run's output"), 'dark')
    const paper = paperOf(view, 'the output')
    const seg = paper.querySelector<HTMLElement>('[data-cy=doc-view-markdown]')!
    expect(ringOn(seg).ratio).toBeGreaterThanOrEqual(RING)

    paper.removeAttribute('data-on-white')

    const broken = ringOn(seg)
    // The number 126 measured, to two decimals, rather than "less than the bar".
    // ⚠️ **RE-MEASURED at 391, not relaxed.** It read [1.6, 1.7] while `--focus-ring-color` was
    // `rgba(125, 187, 255, .72)`; the accent is the mock's navy-side blue now, so the same
    // 72%-alpha ring over the same paper composites to 1.59:1. The window keeps its 0.1 width.
    // ⚠️ **RE-MEASURED for BroCrew, not relaxed**: the frame's ring is crew orange at 72%, which
    // composites to 1.84:1 over the paper. The window keeps its 0.1 width.
    expect(broken.ratio, `the shipped ring measured ${broken.ratio.toFixed(2)}:1`).toBeLessThan(
      1.89,
    )
    expect(broken.ratio).toBeGreaterThan(1.79)
    // ⚑ And the paper itself did not move: this is about the ring, not about the page going dark.
    expect(channelGap(paintedBackground(paper), [251, 250, 247, 1])).toBe(0)
  })
})

describe('129 §1 · the scrollbar thumb on a white code block', () => {
  /**
   * ⛔ **The other half of `126`'s §1**, and the half a colour scheme alone cannot fix.
   * `scrollbar-color` inherits as an ALREADY-SUBSTITUTED value: `.drawer-body` writes
   * `var(--scrollbar-thumb)`, the var resolves there, and the paper inherits
   * `rgba(255, 255, 255, 0.12)` — white at 12% — whatever scope the paper is in. So the assertion is
   * a pair: what the paper paints now, and what it WOULD have inherited, both composited onto the
   * code block they sit on.
   *
   * ⚠️ **The dark row carries all of this test's discriminating power.** Measured by mutation:
   * deleting the paper's own `scrollbar-color` reddens dark and leaves light green, because in light
   * the drawer's thumb is already ink and inheriting it is harmless. The light row is a regression
   * pin, and saying so is better than letting it read as a second independent check.
   *
   * ⚑ **D-016 deleted the drawer that hosted this measurement**, and the defect did not go with it:
   * every paper that remains is drawn inside a scroll container writing the app's thumb — the plan
   * document inside the transcript's scroller, the Info and Instructions papers inside the session
   * drawer's own `.drawer-body`. So the ancestor is PLANTED, with that very declaration, on the box
   * the plan document is mounted in, rather than borrowed from a component this file would have to
   * build a whole conversation to reach.
   */
  it.each(THEMES)('%s: the thumb is ink on the code block, not white on white', (theme) => {
    const view = open(surfaceNamed('the plan document in the transcript'), theme)
    view.host.style.setProperty('scrollbar-color', 'var(--scrollbar-thumb) transparent')
    const paper = paperOf(view, 'the plan')
    const pre = paper.querySelector<HTMLElement>('pre')
    expect(
      pre,
      'the fixture has no code block — the thumb has nothing to be invisible on',
    ).not.toBeNull()
    // ⛔ **THERE IS A SCROLLBAR, asserted (131, from 130's §6.2).** 129 measured a thumb colour and
    // never established that anything scrolls: removing `overflow-x: auto` from `.md-doc pre` would
    // have deleted the wide-code scroller and left every committed assertion green — a colour test
    // for a bar that is not on the screen. Both halves are needed, because `auto` on content that
    // fits paints nothing either. Measured here: 2720px of code in a 145px box.
    expect(getComputedStyle(pre!).overflowX, 'the code block is not a scroller').toBe('auto')
    expect(
      pre!.scrollWidth,
      'the code fits — this fixture produces no scrollbar to be invisible',
    ).toBeGreaterThan(pre!.clientWidth)
    const block = paintedBackground(pre!)

    const thumb = parseColor(getComputedStyle(pre!).scrollbarColor.split(') ')[0] + ')')
    expect(
      thumb,
      `unparseable scrollbar-color "${getComputedStyle(pre!).scrollbarColor}"`,
    ).not.toBeNull()
    const painted = over(thumb!, block)
    expect(
      luminance(painted),
      `the thumb (${show(painted)}) is lighter than the code block (${show(block)})`,
    ).toBeLessThan(luminance(block))
    expect(
      channelGap(painted, block),
      `the thumb is ${channelGap(painted, block)} away from the block it sits on`,
    ).toBeGreaterThan(25)
    // ⚑ And it got here BY INHERITANCE from the paper, which is the whole mechanism: the `pre` has
    // no declaration of its own, so a fix written on `.doc-paper` either reaches the scroller or it
    // does nothing. (Its sibling `scrollbar-width` does NOT inherit, which is why the paper does not
    // declare one — measured, and stated in the component beside the rule.)
    expect(getComputedStyle(pre!).scrollbarColor).toBe(getComputedStyle(paper).scrollbarColor)

    // ⛔ …and the value the paper WOULD have inherited, composited onto the same block. This is the
    // defect as a number rather than as a claim about the fix, and it is not optional: a null here
    // would mean the planted host declares no thumb at all, which is a different world.
    expect(
      view.host.contains(paper),
      'the paper is not inside the planted host — the inheritance is not being read',
    ).toBe(true)
    const inherited = parseColor(getComputedStyle(view.host).scrollbarColor.split(') ')[0] + ')')
    expect(inherited, 'the host declares no thumb of its own').not.toBeNull()
    const wouldBe = over(inherited!, block)
    if (theme === 'dark') {
      expect(
        channelGap(wouldBe, block),
        `the inherited thumb reads ${show(wouldBe)} on ${show(block)} — that was the defect`,
      ).toBeLessThan(4)
    } else {
      // In light the inherited thumb is already ink; the defect was dark-only, and saying so here
      // stops this branch quietly asserting nothing.
      expect(channelGap(wouldBe, block)).toBeGreaterThan(25)
    }
  })

  /**
   * ⛔ **The OTHER scroller, which 129 never touched** (131, from 130's §6.2). A compact paper caps
   * `.doc-content` at 320px and scrolls it, so a compact surface has a vertical scrollbar on the
   * page itself and not only inside a code block. Measured: the recruit confirmation was the one
   * whose fixture was taller than the cap — the dispatch preview and the plan document are compact
   * too, and their content fits, so a test written on either of them would be asserting against a
   * bar that never appears.
   *
   * ⚑ **D-016 deleted the recruit confirmation** (and the dispatch preview), so the plan document
   * is the compact surface left, handed a plan TALLER than the cap — the premise is asserted below,
   * so a plan that fits would fail here rather than pass over a bar that is not there.
   */
  it.each(THEMES)('%s: the compact page scroller takes the paper’s thumb too', (theme) => {
    const plan = surfaceNamed('the plan document in the transcript')
    const tall = { ...PLAN, body: MD + '\nA paragraph of the plan, one of many.\n'.repeat(40) }
    const view = open({ ...plan, props: { item: tall } }, theme)
    const paper = paperOf(view, 'the plan')
    expect(paper.classList.contains('compact'), 'this surface is not a compact paper').toBe(true)
    const content = paper.querySelector<HTMLElement>('.doc-content')!
    expect(getComputedStyle(content).overflowY, 'the compact cap is gone').toBe('auto')
    expect(
      content.scrollHeight,
      'the compact fixture fits — there is no page scrollbar here to colour',
    ).toBeGreaterThan(content.clientHeight)
    // The same mechanism as the code block: no declaration of its own, so it takes whatever the
    // paper resolved. A fix written on `.doc-paper` either reaches both scrollers or neither.
    expect(getComputedStyle(content).scrollbarColor).toBe(getComputedStyle(paper).scrollbarColor)
    const thumb = parseColor(getComputedStyle(content).scrollbarColor.split(') ')[0] + ')')
    const page = paintedBackground(content)
    expect(thumb, 'the compact scroller declares no thumb').not.toBeNull()
    expect(
      channelGap(over(thumb!, page), page),
      `the page thumb reads ${show(over(thumb!, page))} on ${show(page)}`,
    ).toBeGreaterThan(25)
  })
})

describe('129 §1 · what the island costs, property by property (126’s practice)', () => {
  /**
   * ⚑ **`126` measured its own blast radius and found exactly one property moved.** This is the same
   * measurement for the paper: every non-custom computed property of every element under
   * `.doc-paper`, read with the scope and again without it.
   *
   * ⚠️ **Custom properties are excluded and that is not a dodge.** ~80 of them re-resolve on all
   * twelve elements — that is what a scope IS, and counting them would drown the question, which is
   * *what does the user see differently*. Only what the engine actually paints is diffed.
   *
   * Measured, dark, on every host: **`2 × elements + 19` property readings move, and they are
   * four facts** — `color-scheme` (the truthful value on a white page), `scrollbar-color` (the
   * thumb above), the paper's own `box-shadow` (the soft ink-tinted light-ramp shadow rather than
   * the heavy black one the dark frame uses), and ONE element that paints differently: the
   * selected view chip, from the dark accent `#a7b7ff` with near-black ink to the paper's own
   * `#5958fa` with white ink. Every border/caret/outline/decoration entry on that element is
   * `currentColor` following its `color`, i.e. the same fact counted sixteen more times. For the
   * workflow output that is **43** — see `PER_ELEMENT` for the arithmetic.
   *
   * ⚠️ **What this sensor CANNOT see, said rather than left implied: pseudo-elements.**
   * `getComputedStyle(el)` with no second argument reports the element, so `::selection` and the
   * scrollbar's own parts are outside the diff. One thing does move there and it is checked by
   * hand: `--selection-bg` goes from the app's pale `rgba(125,187,255,.28)` to the paper's
   * `rgba(37,99,235,.22)` — a highlight tuned for near-black replaced by one tuned for white, on a
   * page that is white. Named here so the "four facts" above is a claim about element
   * paint and not a claim about everything.
   */
  const snapshot = (root: Element): Map<string, string> => {
    const out = new Map<string, string>()
    const els = [root, ...root.querySelectorAll('*')]
    els.forEach((el, i) => {
      const style = getComputedStyle(el)
      for (let p = 0; p < style.length; p++) {
        const name = style.item(p)
        if (name.startsWith('--')) continue
        out.set(
          `${i}:${el.getAttribute('data-cy') ?? el.tagName.toLowerCase()}|${name}`,
          style.getPropertyValue(name),
        )
      }
    })
    return out
  }

  /**
   * ⛔ **Every host, not one** (131, from 130's §6.3). 129 ran this on the workflow output alone and
   * quoted its numbers as if they described the change; 130 pointed out that they were REPORTED and
   * never asserted, and that one host is not six. Both halves are fixed here: the walk runs on every
   * host in {@link SURFACES}, and the counts below are pinned.
   */
  const radius = (
    surface: (typeof SURFACES)[number],
    theme: string,
  ): { moved: string[]; reads: number; elements: number; chip: string } => {
    const view = open(surface, theme)
    const paper = paperOf(view, surface.what)
    const elements = 1 + paper.querySelectorAll('*').length
    const chip = paper.querySelector<HTMLElement>('.seg.on')?.getAttribute('data-cy') ?? '(none)'
    const before = snapshot(paper)
    paper.removeAttribute('data-on-white')
    const after = snapshot(paper)
    const moved = [...before]
      .filter(([k, v]) => after.get(k) !== v)
      .map(([k, v]) => `${k}: ${v} → ${after.get(k)}`)
    view.unmount()
    return { moved, reads: before.size, elements, chip }
  }

  const named = (m: string): string => m.split('|')[0]!.replace(/^\d+:/, '')
  const prop = (m: string): string => m.split('|')[1]!.split(':')[0]!

  /**
   * ⚠️ **`475` is Chromium's longhand count per element**, and the only reason a per-element figure
   * can be a constant at all. `moved` is not a free number either — it is
   * `2 × elements + 19`: `color-scheme` and `scrollbar-color` both INHERIT, so each moves on every
   * element in the subtree, one is the paper's `box-shadow`, and the eighteen are the one chip that
   * repaints (`color`, `background-color`, and sixteen border/caret/outline/decoration entries
   * following `currentColor` — the same fact counted sixteen more times).
   *
   * ⛔ For the workflow output that is 12 + 12 + 1 + 18 = 43. A number here that no longer matches
   * is a re-measurement, never a relaxation.
   */
  const PER_ELEMENT = 475
  const CHIP_PROPS = 18
  const SHADOW_PROPS = 1

  it.each(SURFACES.map((s) => [s.what, s] as const))(
    'dark · %s: colour-scheme, the scrollbar, and ONE painted element — counted',
    (_what, surface) => {
      const { moved, reads, elements, chip } = radius(surface, 'dark')

      // The walk itself, pinned: a snapshot that quietly started reading half the tree would make
      // every count below smaller and every one of them would still "pass" a `> 2000`.
      expect(reads, `${elements} elements × ${PER_ELEMENT}`).toBe(elements * PER_ELEMENT)
      expect(moved.length, `moved on ${elements} elements`).toBe(
        2 * elements + SHADOW_PROPS + CHIP_PROPS,
      )

      // …and what those readings ARE. Both inherited properties reach every element:
      expect(moved.filter((m) => prop(m) === 'color-scheme')).toHaveLength(elements)
      expect(moved.filter((m) => prop(m) === 'scrollbar-color')).toHaveLength(elements)

      // ⛔ Outside the scheme and the scrollbar, the paper card's shadow and exactly ONE other
      // element paint differently — and that one is the SELECTED view chip, which is `doc-view-raw` on a child's journal and `doc-view-markdown`
      // everywhere else. Asserting the identity rather than the string is what makes this one claim
      // instead of six.
      //
      // ⚠️ **Identified by `data-cy`, with the walk index stripped.** The index has to be in the Map
      // key or two `<p>`s would collide, but an assertion naming `4:` would fail — loudly and for
      // the wrong reason — the day the toolbar grew a node before the chip.
      const painted = [
        ...new Set(
          moved.filter((m) => !/^(color-scheme|scrollbar-color)$/.test(prop(m))).map(named),
        ),
      ]
      expect(painted, `elements whose paint moved:\n${moved.join('\n')}`).toEqual([
        'document-body',
        chip,
      ])
      expect(moved.filter((m) => named(m) === 'document-body' && prop(m) === 'box-shadow')).toEqual(
        [
          expect.stringContaining(
            'rgba(23, 26, 58, 0.25) 0px 16px 40px -8px → rgba(0, 0, 0, 0.35) 0px 2px 14px 0px',
          ),
        ],
      )
      const chipMoves = moved.filter((m) => named(m) === chip).map((m) => m.split('|')[1]!)
      expect(chipMoves).toHaveLength(CHIP_PROPS + 2) // …plus its own two inherited readings
      // …and what it moved TO — the paper's accent pair rather than the app's pale one.
      // ⚑ BroCrew's pairs: the paper's orange and white ink, the frame's crew orange and indigo ink.
      expect(chipMoves).toContain('background-color: rgb(207, 71, 25) → rgb(255, 138, 92)')
      expect(chipMoves).toContain('color: rgb(255, 255, 255) → rgb(20, 23, 58)')
    },
  )

  it.each(SURFACES.map((s) => [s.what, s] as const))(
    '⚑ light · %s: the island is a NO-OP, because the ambient ramp already is the paper ramp',
    (_what, surface) => {
      // The strongest statement available about a scope: in light it changes nothing at all, so
      // everything the twelve ring cases measure in light was already true before 129.
      const { moved, reads, elements } = radius(surface, 'light')
      expect(reads, 'the walk read nothing — a no-op over an empty subtree is not a no-op').toBe(
        elements * PER_ELEMENT,
      )
      expect(moved).toEqual([])
    },
  )

  /**
   * ⛔ **The one thing the diff above structurally cannot see, asked of the PSEUDO-ELEMENT ITSELF
   * (131, from 130's §6.1).**
   *
   * ⚠️ **129 wrote this test and it did not test this.** It called `resolvedAt`, which appends an
   * ordinary `<span>`, sets `color: var(--selection-bg)` on it and reads its normal computed colour
   * — so it proved the token RESOLVES and nothing about whether anything consumes it. Deleting
   * `::selection { background: var(--selection-bg) }` from `base.css` left it green, which directly
   * refutes 129's own *"now asserted"*.
   *
   * `getComputedStyle(el, '::selection')` answers here, measured: it returns the rule's substituted
   * value and follows the scope. So the production selector is in the assertion, and removing the
   * rule turns this red.
   */
  const selectionBand = (el: Element): string => getComputedStyle(el, '::selection').backgroundColor

  it('the text-selection band moves to the paper’s — read off ::selection, not off the token', () => {
    const view = open(surfaceNamed("the workflow run's output"), 'dark')
    const paper = paperOf(view, 'the output')
    const prose = paper.querySelector<HTMLElement>('p')
    expect(prose, 'the fixture has no prose to select').not.toBeNull()

    const withScope = selectionBand(prose!)
    paper.removeAttribute('data-on-white')
    const without = selectionBand(prose!)

    expect(withScope, 'the paper is selecting with the app’s pale band').not.toBe(without)
    // ⚑ BroCrew's two bands: the paper's orange, the frame's crew orange (were indigo-blue).
    expect(withScope).toBe('rgba(232, 87, 42, 0.2)')
    expect(without).toBe('rgba(255, 138, 92, 0.28)')
    // ⛔ **And the rule is what put it there**, not the token happening to resolve. The token is
    // read the old way on purpose and the two are asserted EQUAL: if `::selection` stopped
    // consuming `--selection-bg`, the band would fall back to the UA highlight while the token went
    // on resolving perfectly, and only this line would notice.
    paper.setAttribute('data-on-white', '')
    expect(
      selectionBand(prose!),
      '::selection no longer paints --selection-bg — the rule is gone or renamed',
    ).toBe(resolvedAt(prose!, '--selection-bg'))
  })
})

describe('129 §2 · the running phase chip, on the token that means ink on accent', () => {
  const RUN: WorkflowRunCard = {
    taskId: 'wq1demo',
    toolUseId: 'toolu_wf',
    name: 'demo-panel',
    description: 'Three drafters, then a judge',
    phases: [
      { index: 1, title: 'Draft' },
      { index: 2, title: 'Judge' },
    ],
    agents: [
      { agentId: 'a1', label: 'drafter', phaseIndex: 1, state: 'done', tokens: 1, toolCalls: 0 },
      { agentId: 'a2', label: 'judge', phaseIndex: 2, state: 'running' },
    ],
    usage: { tokens: 1, toolCalls: 1, ms: 1 },
    running: true,
  }

  /**
   * ⚠️ **`await nextTick()`, or every assertion below reads the COLLAPSED markup** — the tree does
   * not exist until the fold opens, and Vue batches. `workflow-tree.dom.test.ts` documents the same
   * guard; without it `chips.length` is 0 and this file says so rather than passing over nothing.
   */
  const runningChip = async (theme: string): Promise<{ view: Mounted; chip: HTMLElement }> => {
    const view = mount(WorkflowEntry, { run: RUN }, { width: 720 })
    view.host.setAttribute('data-chat-theme', theme)
    view.q('workflow-head').click()
    await nextTick()
    const chips = [...view.host.querySelectorAll<HTMLElement>('.wf-chip.running')]
    // The tree only exists after the click; a fixture whose running phase stopped being running
    // would leave this empty and every assertion below would be about nothing.
    expect(chips.length, 'no running phase chip in the open tree').toBe(1)
    return { view, chip: chips[0]! }
  }

  /**
   * ⛔ **Acceptance 4, in the shape `126` used for `.seg.on`** — computed `color` AND
   * `background-color`, read off the engine, against the two tokens resolved at the chip's own
   * position rather than against a constant this file would have to keep in step with the palette.
   */
  it.each(THEMES)('%s: the chip is --accent-ink on --accent', async (theme) => {
    const { chip } = await runningChip(theme)
    const style = getComputedStyle(chip)
    expect(style.backgroundColor, 'the chip is not painted --accent').toBe(
      resolvedAt(chip, '--accent'),
    )
    expect(style.color, `the chip paints ${style.color}`).toBe(resolvedAt(chip, '--accent-ink'))
    const ratio = contrast(parseColor(style.color)!, paintedBackground(chip))
    expect(ratio, `the running chip reads ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(CHIP)
  })

  /**
   * ⛔ **The defect, as the number the ticket names.** `--badge-ink` is `#ffffff` in both themes —
   * the agent plate's own white disc — and on dark's pale `--accent` that is white on pale blue.
   * Asserting what the WRONG token would read at is what stops this test passing on a palette where
   * both tokens happen to agree.
   */
  it('⚠️ the token it used to name still reads 2.32:1 on this chip, in dark', async () => {
    const { chip } = await runningChip('dark')
    const wrong = parseColor(resolvedAt(chip, '--badge-ink'))!
    const ratio = contrast(wrong, paintedBackground(chip))
    // ⚑ Re-measured for BroCrew: white on crew orange is 2.32:1. The window keeps its 0.2 width.
    expect(ratio, `--badge-ink on this chip reads ${ratio.toFixed(2)}:1`).toBeLessThan(2.42)
    expect(ratio).toBeGreaterThan(2.22)
    // …and the two tokens are genuinely different here, or the line above measures a coincidence.
    expect(resolvedAt(chip, '--accent-ink')).not.toBe(resolvedAt(chip, '--badge-ink'))
  })
})

describe('129 §3 · a faded row that can still be read', () => {
  const EVENTS: TranscriptEvent[] = [
    { type: 'assistant_message', text: 'Older prose above the line.' },
    { type: 'compaction', source: 'compact_boundary', before: 100, after: 10 },
    { type: 'assistant_message', text: 'Newer prose below the line.' },
  ]

  interface Row {
    dimmed: boolean
    ratio: number
    fg: Rgba
    bg: Rgba
    says: string
    el: HTMLElement
  }

  /**
   * Every paragraph in the pane, with what it reads at — through {@link paintedInk}, which is the
   * only sensor in this repo that folds an ancestor's `opacity` into the answer.
   */
  function rows(pane: HTMLElement): Row[] {
    const out: Row[] = []
    for (const entry of pane.querySelectorAll<HTMLElement>('.entry')) {
      for (const el of entry.querySelectorAll<HTMLElement>('p')) {
        const says = (el.textContent ?? '').trim()
        if (!says) continue
        const colour = parseColor(getComputedStyle(el).color)
        expect(colour, `unparseable colour "${getComputedStyle(el).color}"`).not.toBeNull()
        const { fg, bg } = paintedInk(el, colour!)
        out.push({
          dimmed: entry.classList.contains('summarised-out'),
          ratio: contrast(fg, bg),
          fg,
          bg,
          says,
          el,
        })
      }
    }
    return out
  }

  const pane = (theme: string): HTMLElement => {
    const view = mount(ConversationPane, paneProps({ record: record(EVENTS) }), {
      width: 1200,
      height: 900,
    })
    // ⚠️ Set on the carrier since 344 — the pane ships `light` and takes no prop. Both rows still
    // run: the fade is a ratio against whatever page it sits on, and `:root`'s dark ramp is still
    // the app frame's.
    const root = view.q('conversation-pane')
    root.setAttribute('data-chat-theme', theme)
    return root
  }

  it.each(THEMES)('%s: the summarised prose clears 3:1', (theme) => {
    const all = rows(pane(theme))
    const dim = all.filter((r) => r.dimmed)
    // The fixture has to actually produce a faded row, or this passes over an empty list.
    expect(dim.length, 'nothing above the boundary is marked summarised-out').toBe(1)
    expect(dim[0]!.says).toContain('Older prose')
    expect(
      dim[0]!.ratio,
      `${theme}: the faded prose reads ${dim[0]!.ratio.toFixed(2)}:1 (${show(dim[0]!.fg)} on ${show(dim[0]!.bg)})`,
    ).toBeGreaterThanOrEqual(FADED)

    // ⛔ **The paired positive, and it is what stops "delete the fade" being a fix.** The row must
    // still be measurably quieter than the conversation under it.
    const live = all.find((r) => !r.dimmed && r.says.includes('Newer prose'))
    expect(live, 'the un-faded message is not in the walk').toBeDefined()
    expect(
      dim[0]!.ratio,
      `faded ${dim[0]!.ratio.toFixed(2)}:1 vs live ${live!.ratio.toFixed(2)}:1 — the fade did nothing`,
    ).toBeLessThan(live!.ratio - 1)
  })

  /**
   * ⚑ **The ladder, which is the constraint that decided the number.** The compaction boundary's own
   * sub-line is `--faint` and is NOT in the faded region, so it is the ceiling a de-emphasised row
   * has to stay under: on paper it reads 4.34:1, and a fade of 0.66 would put the summarised prose
   * at 4.42 — past it, and 087's ladder stops being a ladder. 0.62 reads 3.94.
   */
  it('the faded prose stays quieter than the boundary note that is not faded', () => {
    const surface = pane('light')
    const all = rows(surface)
    const dim = all.find((r) => r.dimmed)!
    const note = [...surface.querySelectorAll<HTMLElement>('.cb-sub')]
      .map((el) => {
        const colour = parseColor(getComputedStyle(el).color)!
        const { fg, bg } = paintedInk(el, colour)
        return contrast(fg, bg)
      })
      .sort((a, b) => a - b)[0]
    expect(note, 'the compaction boundary drew no sub-line to compare against').toBeDefined()
    expect(
      dim.ratio,
      `faded prose ${dim.ratio.toFixed(2)}:1 vs the boundary note ${note!.toFixed(2)}:1`,
    ).toBeLessThan(note!)
  })

  /**
   * ⛔ **The sensor's own escape, kept from `126`.** A walk built on `color` and
   * `paintedBackground` reads none of a group fade — it reported `12.49:1` for ink Chromium painted
   * at `2.86:1`. The number above is only a measurement of the FADE if the blind sensor is still
   * blind, so both halves are asserted here.
   */
  it('⚠️ paintedBackground is still blind to the fade — that is what makes the number above real', () => {
    const surface = pane('light')
    const dim = rows(surface).find((r) => r.dimmed)!
    const blind = contrast(parseColor(getComputedStyle(dim.el).color)!, paintedBackground(dim.el))
    expect(
      blind,
      `paintedBackground started seeing opacity — 080/083/091 read it too (${blind.toFixed(2)}:1)`,
      // The blind sensor reads the row's full ink, 7.6:1 with the paper ink `#2d3753`. If it ever
      // started seeing `opacity`, this would collapse toward `dim.ratio`, held well beneath it below.
    ).toBeGreaterThan(7)
    expect(dim.ratio, 'the two sensors agree, so one of them is not doing its job').toBeLessThan(
      blind - 4,
    )
  })
})
