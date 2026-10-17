import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { appMenuTemplate, rolesIn } from '../src/main/app-menu'

/**
 * **338 · Where the app's own width is decided, and where it is deliberately not.**
 *
 * `.app` is `min-width: var(--app-min-w)` and the window it lives in has no minimum, so a window
 * narrower than the frame used to cut the frame with nothing to scroll to. The reach that fixes
 * that is one CSS rule on `#app`; what this file pins is the half of the decision that computed
 * style cannot answer — the declarations that must NOT be there, and the menu item that is the
 * reason the fix is not on the `BrowserWindow`.
 *
 * The behaviour itself is `test/dom/app-frame-reachable.dom.test.ts`, in real Chromium.
 */

const src = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8')

/**
 * ⚠️ **Comments come out first, and a `}` in one is why.** This file's subject is what a rule
 * DECLARES, and the rules it is about carry long comments — one of which contains `{@link #app}`.
 * A block reader that counts braces over the raw text stops inside the prose. Stripping also keeps
 * the negatives honest: a `scrollbar-color` named in a comment explaining why it is absent must not
 * make "this rule does not declare one" fail.
 */
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

const BASE_CSS = withoutComments(src('renderer/src/assets/base.css'))
const TOKENS_CSS = src('renderer/src/assets/tokens.css')
const RUNTIME_SCREEN = withoutComments(src('renderer/src/components/RuntimeScreen.vue'))

/** One rule's declaration block, by selector — the braces, not the comment above them. */
function block(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`)
  expect(at, `${selector} is not a rule in this stylesheet`).toBeGreaterThan(-1)
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  expect(close).toBeGreaterThan(open)
  return css.slice(open + 1, close)
}

describe('the app frame', () => {
  it('is 1180 wide, and says so in one place', () => {
    expect(TOKENS_CSS).toMatch(/--app-min-w:\s*1180px/)
    expect(block(RUNTIME_SCREEN, '.app')).toMatch(/min-width:\s*var\(--app-min-w\)/)
  })

  it('takes its height from its container, never from the window', () => {
    const app = block(RUNTIME_SCREEN, '.app')
    expect(app).toMatch(/height:\s*100%/)
    // ⛔ The declaration this replaced. With a horizontal scrollbar in `#app`, a frame keyed to the
    // window overflows its own container by the bar's height and `overflow-y: hidden` eats the
    // strip — the composer's row. The dom file puts that on the path; this keeps it from coming
    // back as a one-word edit.
    expect(app).not.toMatch(/height:\s*100vh/)
  })
})

/**
 * 🔴 **384 §1.3 · the sheet tucks into the chrome, and it costs nothing to.**
 *
 * v2.3's workspace is `border-radius: 22px 0 0 0` — rounded against the rail and the titlebar and
 * square against the window's edges — and that corner is the whole geometry this dispatch moved.
 * ⛔ **Every other shape v2.3 uses for the same effect costs horizontal pixels**, and horizontal
 * pixels are what `drawerFit` measures its two thresholds on: a gutter of any size would have
 * dropped the drawer from `--drawer-w` to `--drawer-w-narrow` at the app's own opening width, as a
 * side effect of a background change nobody asked to change the drawer.
 *
 * ⚠️ **The negatives are the point of putting this in a SOURCE file.** *No padding, no border, no
 * transform* cannot be read off computed style without a mount of the whole shell, and two of them
 * are hazards rather than preferences: `transform`, `filter`, `backdrop-filter`, `perspective`,
 * `contain` and `will-change` each make an element a containing block for `position: fixed`, which
 * is the escape `app-frame-reachable.dom.test.ts` reproduces on purpose — every overlay in the app
 * would start scrolling with `#app`.
 */
describe('the paper sheet', () => {
  it('tucks at exactly one corner, the one against the chrome', () => {
    const main = block(RUNTIME_SCREEN, '.main')
    expect(main).toMatch(/border-top-left-radius:\s*var\(--surface-tuck\)/)
    expect(TOKENS_CSS).toMatch(/--surface-tuck:\s*\d+px/)
    // ⛔ One corner and not four: the other three meet the window's own edges, where a radius would
    // be a floating card rather than a sheet laid into a frame.
    for (const corner of ['top-right', 'bottom-right', 'bottom-left']) {
      expect(main, `${corner} is rounded too`).not.toMatch(new RegExp(`border-${corner}-radius`))
    }
    expect(main, 'a shorthand radius would round all four').not.toMatch(/\n\s*border-radius:/)
  })

  it('⛔ costs the surface column no horizontal pixels', () => {
    const main = block(RUNTIME_SCREEN, '.main')
    for (const property of ['padding', 'border', 'margin', 'gap', 'max-width', 'width']) {
      expect(main, `.main declares ${property}, which narrows what drawerFit measures`).not.toMatch(
        new RegExp(`(^|\\s)${property}(-[a-z]+)?:`),
      )
    }
    // ⚑ The hairline is an INSET SHADOW for exactly that reason — a border is part of the box.
    expect(main).toMatch(/box-shadow:\s*inset[^;]*var\(--surface-edge\)/)
    expect(TOKENS_CSS).toMatch(/--surface-edge:/)
  })

  it('🔴 …and does not become a containing block for the app’s fixed overlays', () => {
    const main = block(RUNTIME_SCREEN, '.main')
    for (const property of [
      'transform',
      'filter',
      'backdrop-filter',
      'perspective',
      'contain',
      'will-change',
    ]) {
      expect(
        main,
        `.main declares ${property} — every fixed overlay would scroll with #app`,
      ).not.toMatch(new RegExp(`(^|\\s)${property}:`))
    }
    // ⚠️ The control: this reader really can see a declaration on this rule, so the six negatives
    // above are a measurement rather than a regex that matches nothing.
    expect(main).toMatch(/(^|\s)position:\s*relative/)
    expect(main).toMatch(/(^|\s)overflow:\s*hidden/)
  })
})

describe('the reach', () => {
  it('is on #app, in both axes deliberately', () => {
    const app = block(BASE_CSS, '#app')
    expect(app).toMatch(/overflow-x:\s*auto/)
    expect(app).toMatch(/overflow-y:\s*hidden/)
    expect(app).toMatch(/scrollbar-width:\s*thin/)
  })

  it('does not declare a scrollbar colour, which is the one of the pair that inherits', () => {
    // Every scroll container in this app pairs `scrollbar-width` with `scrollbar-color`. ⛔ This one
    // may not: `scrollbar-color` inherits as an already-substituted value (`DocumentBody.vue`
    // carries that measurement), so a colour on the element every surface descends from lands on
    // the paper islands too. Measured in the real window: 122 elements resolve an explicit
    // `scrollbar-color` today, 307 with one line here.
    expect(block(BASE_CSS, '#app')).not.toMatch(/scrollbar-color/)
  })

  it('leaves the document itself fixed', () => {
    // The shell does not rubber-band: the reach is the app frame's and the document's overflow is
    // still what propagates to the viewport.
    expect(block(BASE_CSS, 'html,\nbody')).toMatch(/overflow:\s*hidden/)
  })
})

describe('why the reach is not a window minimum', () => {
  it('is that the app offers a gesture a window minimum cannot see', () => {
    // 🔴 One ⌘+ at the shipped 1200 × 840 puts the CSS viewport at 1095.45 — measured with
    // `setMinimumSize(1180, 700)` in force, because a zoom does not change the window. If this
    // item ever leaves the menu, 338's rejection of `minWidth` is worth re-reading rather than
    // simply still true.
    const roles = rolesIn(appMenuTemplate({ appName: 'BroBot2', devTools: false }))
    expect(roles).toContain('zoomIn')
    expect(roles).toContain('resetZoom')
  })

  it('and that the window remembers nothing, so there is no stored width to reconcile', () => {
    // Every launch is the literal 1200 × 840 below; nothing reads or writes a geometry.
    const main = src('main/index.ts')
    expect(main).toMatch(/new BrowserWindow\(\{\s*\n\s*width: 1200,\s*\n\s*height: 840,/)
    expect(main).not.toMatch(/\.setBounds\(|\.getBounds\(|\.setSize\(/)
  })
})
