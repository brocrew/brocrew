import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import '../../src/renderer/src/assets/base.css'

/**
 * **338 · Below its own minimum the app is reachable, and the degrade is a scrollbar.**
 *
 * `335` proved the dispatch sheet is whole from `1440×1000` down to a `460px` viewport and then
 * reported what it had found one layer behind it: *"The sheet stays whole on top of an app whose
 * right-hand side is nowhere."* `.app` is `min-width: var(--app-min-w)` — 1180 px — the document
 * does not scroll, and `BrowserWindow` sets no minimum, so a window narrower than the frame cut the
 * frame and offered nothing to scroll to.
 *
 * ⛔ **Measured in a real window before the rule this file guards existed**: at a `1000px` viewport,
 * 23 elements carrying a `data-cy` were outside it and NOTHING on the page could be scrolled
 * sideways by any gesture — the titlebar's theme toggle and build strip (from `1165`), the send
 * button (`1114`, gone at `1086`), the attach button, the launcher column's right edge. And the
 * layout below 1180 does not respond at all: 46 of the 47 named elements sit at the same
 * coordinates at `900` as at `1180`, so it is the same picture with the right-hand pixels removed.
 * The one that moves is `@toast-stack`, which is `position: fixed` and therefore the window's.
 *
 * ⚑ **The fix is one layer in from the window on purpose.** A `minWidth` on the `BrowserWindow`
 * holds a drag and cannot see a zoom: with `setMinimumSize(1180, 700)` in force, one ⌘+ from this
 * app's own `View` menu still puts the viewport at `1095.45`. `#app` carries the reach instead, so
 * every road to a viewport under 1180 arrives at a scrollbar.
 *
 * ⚠️ **`page.viewport()` is the point of this file**, as it was of `335`'s: `100vh`, `100vw` and
 * `position: fixed` all resolve against the window, so a fixture in a sized `<div>` would answer
 * about the div. ⛔ **And the viewport is shared** — every other file in this directory measures
 * inside the same runner frame — so it is captured once and put back after every test.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

const live: HTMLElement[] = []

afterEach(async () => {
  while (live.length > 0) live.pop()!.remove()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/** The token the whole file is about, read from the real stylesheet rather than restated. */
function appMinWidth(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-min-w').trim()
  expect(raw, '--app-min-w is not declared in tokens.css').toMatch(/^\d+px$/)
  return Number.parseInt(raw, 10)
}

/**
 * The shell, as the document really builds it: `#app` from `base.css` — this is the element under
 * test, and giving it the id is how the real rule reaches the fixture — holding a frame that
 * carries `.app`'s own `min-width` and height.
 *
 * @param frameHeight `100%` is what `RuntimeScreen.vue` declares; `100vh` is the hazard it used to
 * be, and the test that puts a bottom edge past the scrollbar needs it on the path rather than
 * described in a comment.
 */
function shell(frameHeight: '100%' | '100vh' = '100%'): { host: HTMLElement; frame: HTMLElement } {
  const host = document.createElement('div')
  host.id = 'app'
  const frame = document.createElement('div')
  frame.dataset.cy = 'frame'
  frame.style.position = 'relative'
  frame.style.width = '100vw'
  frame.style.height = frameHeight
  frame.style.minWidth = 'var(--app-min-w)'
  host.append(frame)
  document.body.append(host)
  live.push(host)
  return { host, frame }
}

/**
 * The measured height of the shipped window's horizontal scrollbar. `scrollbar-width: thin` is a
 * CLASSIC bar in the Electron window — 11 px out of `#app`'s content box, the same at a 1000, 864
 * and 600 px viewport.
 */
const BAR = 11

/** A control at the frame's right edge — what a person is trying to reach. */
function atTheRightEdge(frame: HTMLElement): HTMLElement {
  const node = document.createElement('button')
  node.dataset.cy = 'right-edge-control'
  node.style.position = 'absolute'
  node.style.right = '0'
  node.style.top = '40px'
  node.style.width = '30px'
  node.style.height = '20px'
  frame.append(node)
  return node
}

/** Inside the viewport's right edge, to the pixel the browser is willing to answer with. */
function inside(node: Element): boolean {
  const r = node.getBoundingClientRect()
  const vw = window.visualViewport?.width ?? window.innerWidth
  return r.left >= -1 && r.right <= vw + 1
}

describe('the app frame below its own minimum', () => {
  it('carries the reach on #app, and leaves the document fixed', async () => {
    await page.viewport(1000, 800)
    const { host } = shell()

    // The rule really is the stylesheet's, on the element the app really mounts into.
    const style = getComputedStyle(host)
    expect(style.overflowX).toBe('auto')
    expect(style.overflowY).toBe('hidden')
    expect(style.scrollbarWidth).toBe('thin')

    // ⛔ The hazard, asserted before anything is claimed about it: the frame really is wider than
    // the window. Without this the reachability below would be a statement about a frame that fits.
    expect(appMinWidth()).toBe(1180)
    expect(host.clientWidth).toBe(1000)
    expect(host.scrollWidth).toBe(1180)
    expect(host.scrollWidth).toBeGreaterThan(host.clientWidth)

    // ⚑ And the DOCUMENT is still where it was: the reach is `#app`'s and only `#app`'s.
    const de = document.documentElement
    expect(getComputedStyle(de).overflowX).toBe('hidden')
    expect(de.scrollWidth).toBe(de.clientWidth)
  })

  it('brings a control at the frame’s right edge into the window, and says so only because it can see one that stays out', async () => {
    await page.viewport(1000, 800)
    const { host, frame } = shell()
    const control = atTheRightEdge(frame)

    // Before the gesture it is off-screen — the state this whole dispatch is about.
    expect(frame.getBoundingClientRect().right).toBeCloseTo(1180, 0)
    expect(inside(control)).toBe(false)

    host.scrollLeft = host.scrollWidth
    expect(host.scrollLeft).toBe(180)
    expect(inside(control)).toBe(true)

    // ⛔ The instrument's own control. `inside()` returning true above is worth exactly what
    // `inside()` is worth, so here is a node NO scroll can reach: it is fixed to the viewport, 40 px
    // past its right edge, and it must still read as out.
    const unreachable = document.createElement('div')
    unreachable.style.position = 'fixed'
    unreachable.style.top = '60px'
    unreachable.style.left = 'calc(100vw + 40px)'
    unreachable.style.width = '30px'
    unreachable.style.height = '12px'
    document.body.append(unreachable)
    live.push(unreachable)
    expect(inside(unreachable)).toBe(false)
    host.scrollLeft = host.scrollWidth
    expect(inside(unreachable)).toBe(false)
  })

  it('changes nothing at or above the frame’s own minimum', async () => {
    await page.viewport(1280, 800)
    const { host, frame } = shell()
    const control = atTheRightEdge(frame)

    expect(host.clientWidth).toBe(1280)
    expect(host.scrollWidth).toBe(host.clientWidth)
    // No overflow means no bar: the frame keeps every pixel of its own height.
    expect(host.offsetHeight - host.clientHeight).toBe(0)
    expect(inside(control)).toBe(true)

    host.scrollLeft = 9999
    expect(host.scrollLeft).toBe(0)
  })

  it('sizes the frame for the scrollbar rather than for the window', async () => {
    await page.viewport(1000, 800)

    // ⚠️ **The bar is STOOD IN FOR here, and that is the fixture rather than a cheat.** This
    // runner's Chromium draws overlay scrollbars, which take no layout space, and neither
    // `scrollbar-width` nor a `::-webkit-scrollbar` rule changes that — measured: `bar` is 0 in
    // this frame either way, and both branches below would be a comparison of two identical
    // numbers. What the fix depends on is not the bar, it is `#app`'s CONTENT BOX being shorter
    // than the window; a bottom border shortens it by exactly the same arithmetic, and
    // `offsetHeight - clientHeight` reads the same {@link BAR} the shipped window reports.
    const { host, frame } = shell('100%')
    host.style.borderBottom = `${BAR}px solid transparent`

    const bar = host.offsetHeight - host.clientHeight
    // ⚠️ **The literal, not {@link BAR}.** `BAR` is what the fixture's border was set to, so
    // `toBe(BAR)` would re-read the value this test just wrote and move with it. 11 is what the
    // shipped window measured.
    expect(bar).toBe(11)
    expect(host.offsetHeight).toBe(window.innerHeight)

    const contentBottom = host.getBoundingClientRect().top + host.clientHeight
    expect(frame.getBoundingClientRect().bottom).toBeLessThanOrEqual(contentBottom + 0.5)

    // ⛔ The same fixture keyed to the WINDOW, which is what `.app` said before 338: it overflows
    // `#app` by exactly the bar, and `overflow-y: hidden` beside the reach eats that strip.
    const viewportKeyed = shell('100vh')
    viewportKeyed.host.style.borderBottom = `${BAR}px solid transparent`
    const overflow =
      viewportKeyed.frame.getBoundingClientRect().bottom -
      (viewportKeyed.host.getBoundingClientRect().top + viewportKeyed.host.clientHeight)
    expect(overflow).toBeCloseTo(bar, 0)
  })

  it('declares no scrollbar colour, because that one inherits', async () => {
    await page.viewport(1000, 800)
    const { host, frame } = shell()

    // What the rule must NOT say. `scrollbar-width` is safe at the root of the tree and
    // `scrollbar-color` is not, and the difference is only visible one element down.
    expect(getComputedStyle(host).scrollbarColor).toBe('auto')
    expect(getComputedStyle(frame).scrollbarColor).toBe('auto')

    // ⚑ The mechanism, on the path: a colour declared here reaches a descendant that never asked
    // for one — which is how a dark thumb would land on the white paper surfaces. Measured in the
    // real app: 122 elements resolve an explicit `scrollbar-color`, 307 with one line on `#app`.
    host.style.scrollbarColor = 'rgb(255, 0, 0) transparent'
    // `transparent` serialises as `rgba(0, 0, 0, 0)` in a computed value.
    expect(getComputedStyle(frame).scrollbarColor).toBe('rgb(255, 0, 0) rgba(0, 0, 0, 0)')
  })

  it('leaves a fixed overlay anchored to the window while the frame is scrolled', async () => {
    await page.viewport(1000, 800)
    const { host } = shell()

    // 335's guarantee, re-measured against the new scroll container: `OverlayHost` is
    // `position: fixed; inset: 0`, and an ancestor with `overflow` is NOT a containing block for
    // fixed descendants. If it ever became one, the dispatch sheet would ride the app frame and the
    // reference's clip would be back.
    const overlay = document.createElement('div')
    overlay.style.position = 'fixed'
    overlay.style.inset = '0'
    document.body.append(overlay)
    live.push(overlay)

    host.scrollLeft = host.scrollWidth
    expect(host.scrollLeft).toBe(180)
    const r = overlay.getBoundingClientRect()
    expect(r.left).toBe(0)
    expect(r.width).toBeCloseTo(window.innerWidth, 0)
  })
})
