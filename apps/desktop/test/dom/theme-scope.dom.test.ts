import { afterEach, describe, expect, it } from 'vitest'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import {
  channelGap,
  firstGradientStop,
  mount,
  over,
  paintedBackground,
  paneProps,
  parseColor,
  show,
  unmountAll,
  type Mounted,
  type Rgba,
} from './harness'

/**
 * Two visual theme defects are checked as assertions.
 *
 * A gray header and dark drawer beside paper can pass all 2,043 SSR tests because SSR has no
 * layout, compositing, or computed styles. The engine must verify these visible properties.
 *
 * Both were the same fault — **the light scope was in the wrong place** — and neither was visible
 * to a test, because neither changed a single declaration. The header still said
 * `background: var(--surface-header-bg)`; the drawer still said `var(--drawer-bg)`. What changed
 * was what those tokens RESOLVED TO where those elements sat, and what was behind them once their
 * alpha was applied. That is one question, it has one answer, and only a real cascade gives it.
 *
 * ⚠️ **There is a structural test for this already and it is not enough.**
 * `conversation-chrome.render.test.ts` asserts `data-chat-theme` appears exactly ONCE and on the
 * pane. That is the right guard for the mechanism 080 happened to get wrong; it says nothing about
 * whether the result is legible, and it would pass unchanged if a light token were given a dark
 * value, if a new surface were mounted outside the pane, or if a band's alpha were raised until it
 * stopped belonging to the page. This file asserts the *outcome* rather than the *mechanism*, and
 * the two are complementary — neither replaces the other.
 */

afterEach(unmountAll)

/**
 * Compare each band to the reading column, which carries the running conversation. Comparing
 * it only to the pane could let a dark drawer agree with its dark backdrop and pass while
 * still conflicting with the paper conversation.
 */
const READING_SURFACE = 'reading-surface'

/** The translucent bands: each one's appearance is decided by what is behind it, not by its token. */
const BANDS = [
  { cy: 'session-header', what: 'the top bar' },
  { cy: 'session-drawer', what: 'the drawer' },
] as const

/** The composer has no `data-cy` of its own, so it is addressed by the class that paints it. */
const COMPOSER = '.composer-wrap'

/**
 * ⚠️ **The pre-fix state, rebuilt** — 080's split scope, which is what both escapes shipped from
 * and which was corrected before anything was committed. **There is therefore no revision to check
 * out**: the escape only ever existed in a working tree, so reproducing it means rebuilding its
 * shape. That is a weaker claim than `git checkout` and it is stated rather than glossed.
 *
 * 080 §7 records what the shape was: the light scope split across **the header and the reading
 * column**, with the pane itself — and so the drawer, and so the image viewer — outside both. The
 * pane carried no attribute at all, hence `removeAttribute` rather than setting it to `dark`.
 *
 * The paint moves with the scope, because in the split build it had to: `--chat-bg` is painted by
 * whichever element is the boundary, and a reconstruction that left the paper behind on an element
 * that had gone dark would be reproducing a state that never existed — the transcript really was
 * paper on the day, which is precisely why the drawer beside it looked wrong.
 */
function splitTheScope(m: Mounted): void {
  const pane = m.q('conversation-pane')
  const header = m.q('session-header')
  const column = m.q(READING_SURFACE)

  pane.removeAttribute('data-chat-theme')
  for (const el of [header, column]) el.setAttribute('data-chat-theme', 'light')
  column.style.background = 'var(--chat-bg)'
  // ⚑ **384 §1.3 · the wash travels with the paint, for the same reason the paint travels with the
  // scope.** `background` is a shorthand and resets `background-image`, so without this line the
  // reconstruction would put an UNWASHED column beside a washed page and the "the split moved the
  // reading column too" guard would fail on the reconstruction rather than on the split.
  column.style.backgroundImage = 'var(--paper-wash)'
}

describe('the conversation reads as ONE page, in the engine that decides that', () => {
  /**
   * The rule, and it is the same rule in both modes: **a translucent band belongs to the page it
   * sits on.** The header, the composer and the drawer are all glass over the conversation, and
   * belonging is exactly what stops being true when the surface behind one of them is not the
   * surface the reader thinks they are looking at.
   *
   * 16 is a margin, not a measurement. The worst real gap is 8 — the header, in light — so this
   * fails at twice the distance the shipped design actually uses, and a token nudge will not trip
   * it. The numbers are in the failure message either way, so a future tightening is a reading
   * rather than a guess.
   */
  const BELONGS = 16

  /**
   * The page each mode is supposed to be: `--paper-bg` and `--bg`, measured off the shipped
   * tokens. Asserting the page IS one of these — rather than that it is far from the other — is
   * what makes the whole file non-vacuous, and getting that backwards is exactly what review
   * caught: the first version asserted the light page was FAR FROM DARK, which an unstyled white
   * page satisfies perfectly. With no stylesheet every element composites to the same white, every
   * gap is 0, and every assertion below passes over nothing.
   */
  // ⚑ BroCrew's frame background, `--bg` #14173a (was #182135).
  const DARK_PAGE = [20, 23, 58, 1] as const

  /**
   * 🔴 **384 §1.3 · the light page is a RANGE now, so this is derived rather than typed.**
   *
   * The light surfaces carry `--paper-wash` — two radial gradients over `--paper-bg` — and
   * `paintedBackground` models a gradient by its strongest stop on purpose (*"the worst case for
   * anything at the top of the card"*). So the page this file compares against is that stop
   * composited over the paper, read off the shipped stylesheet at run time.
   *
   * ⛔ **This is still "measured off the shipped tokens", which is the criterion the paragraph above
   * sets, and it is still non-vacuous**: an unstyled page composites to plain white, and white is 40
   * channels from the value below — further than the tolerance by a factor of twenty. What it stops
   * being is a LITERAL, which would have had to be re-typed every time an alpha moved.
   */
  function lightPage(scope: Element): Rgba {
    const style = getComputedStyle(scope)
    const paper = style.getPropertyValue('--paper-bg').trim()
    const wash = style.getPropertyValue('--paper-wash').trim()
    // ⛔ **The paper token, PARSED — never `paintedBackground(scope)`.** The scope element already
    // carries the wash, so compositing the stop over what that walk returns would apply the wash
    // twice and this function would predict a page the app never paints.
    const base = parseColor(paper)
    expect(base, `the paper token did not parse: "${paper}"`).not.toBeNull()
    // ⚑ BroCrew's wash is a picture of faint lines on a transparent ground, not a colour: the page
    // is the paper it is drawn over. A gradient wash, if one returns, is composited below.
    if (wash === 'none' || wash.startsWith('url(')) return base!
    // ⚠️ **The whole list, not a hand-split first item.** `firstGradientStop` walks TOP-LEVEL stops,
    // so it returns the first colour of the first gradient either way — and splitting a
    // custom property's token stream on commas is what a nested `rgba(…)` defeats.
    const stop = firstGradientStop(wash.replace(/\s+/g, ' ').trim())
    expect(stop, `the wash's first stop did not parse out of ${wash.slice(0, 60)}`).not.toBeNull()
    return over(stop!, base!)
  }

  /**
   * Set the theme on its carrier rather than passing a `chatLight` prop. The pane
   * unconditionally renders `data-chat-theme="light"`.
   *
   * ⛔ **Both rows are still worth running, and `dark` is not a mode the product ships.** The claim
   * this file makes is that no band declares a colour of its OWN: each one composites onto the page
   * behind it. Moving the ambient and watching every band follow is how that is proved, and it is
   * proved better by moving it somewhere the surface never goes. `[data-chat-theme='light']` and
   * `:root` are both live palettes — the second is the app frame, the rail and every overlay — so
   * `dark` here is a real ramp being asked a real question, not a dead branch kept for symmetry.
   */
  it.each([{ mode: 'light' as const }, { mode: 'dark' as const }])(
    '$mode: every chrome band belongs to the page behind it',
    ({ mode }) => {
      const m = mount(ConversationPane, paneProps({ drawerOpen: true }), { width: 1200 })
      m.q('conversation-pane').setAttribute('data-chat-theme', mode)
      const page = paintedBackground(m.q(READING_SURFACE))
      // ⚠️ **The wash is scoped to light**, so the dark page is still one flat token and the light one
      // is the wash's strongest stop over the paper. Both are read off the sheet, neither is typed.
      const expected =
        mode === 'dark' ? (DARK_PAGE as unknown as Rgba) : lightPage(m.q('conversation-pane'))

      expect(
        channelGap(page, expected),
        `the ${mode} page paints ${show(page)} — the stylesheet did not load, or the page is not the page`,
      ).toBeLessThanOrEqual(2)

      const composer = m.host.querySelector(COMPOSER)
      expect(composer, `no ${COMPOSER} — the composer band this asserts on is gone`).not.toBeNull()

      const bands: [string, Element][] = [
        ...BANDS.map((b) => [b.what, m.q(b.cy)] as [string, Element]),
        ['the composer', composer!],
      ]
      for (const [what, el] of bands) {
        const painted = paintedBackground(el)
        expect(
          channelGap(painted, page),
          `${what} paints ${show(painted)} on a page of ${show(page)}`,
        ).toBeLessThanOrEqual(BELONGS)
      }
    },
  )

  /**
   * ⚠️ **The check above is worthless without this one.** Both modes passing proves the rule holds;
   * it does not prove the rule can FAIL, and a `channelGap` that always returned 0 — a
   * `paintedBackground` reading one element twice, a stylesheet that never loaded — would satisfy
   * every assertion in this file. This is the reproduction of the known escape, and 083 named it
   * the criterion that matters most: *"a harness that cannot reproduce a known escape has not been
   * shown to work."*
   */
  it('⚠️ …and with 080’s scope split, the drawer goes dark and the opaque header holds', () => {
    const m = mount(ConversationPane, paneProps({ drawerOpen: true }), {
      width: 1200,
    })

    const read = () => ({
      header: paintedBackground(m.q('session-header')),
      drawer: paintedBackground(m.q('session-drawer')),
      page: paintedBackground(m.q(READING_SURFACE)),
    })

    const before = read()
    splitTheScope(m)
    const after = read()

    // The reading column is still paper — which is the point, and the reason the other two look
    // wrong rather than merely different. If this drifts, the reconstruction has stopped being the
    // reported state and the two assertions below are measuring something else.
    expect(channelGap(after.page, before.page), 'the split moved the reading column too').toBe(0)

    // The header band is an opaque fill now, so it no longer composites over whatever is behind
    // it and cannot grey out when the scope splits: it stays within the page's own bound.
    expect(
      channelGap(after.header, after.page),
      `the split header paints ${show(after.header)} beside a column of ${show(after.page)}`,
    ).toBeLessThanOrEqual(BELONGS)

    // *"a translucent dark column beside paper reads as unfinished, not as instrumentation"* — 080
    // §7. The drawer keeps its dark 40%-alpha fill with nothing light left behind it: L 0.003 at
    // the edge of a paper page, which is a gap of 239.
    expect(
      channelGap(after.drawer, after.page),
      `the split drawer paints ${show(after.drawer)} beside a column of ${show(after.page)}`,
    ).toBeGreaterThan(BELONGS * 2)

    // The pairing that makes both of those mean "this CHANGED" rather than "this was always so":
    // the same two elements, in the same mount, one attribute earlier.
    expect(channelGap(before.header, before.page)).toBeLessThanOrEqual(BELONGS)
    expect(channelGap(before.drawer, before.page)).toBeLessThanOrEqual(BELONGS)
  })
})
