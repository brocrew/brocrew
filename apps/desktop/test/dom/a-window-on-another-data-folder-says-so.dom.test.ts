import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, type Component, type PropType } from 'vue'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import { WINDOW_CONTROLS } from '../../src/shared/window-controls'
import { assertClippedButTold, assertDrawn, cutsOf, drawnReady, inkRects } from './drawn'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 730 · Draw 4 — a window on another data folder says so, however long the folder's name
 *
 * ⚑ **The draw, verbatim** (`730` §2 item 4): *"**The userData title** (`718` GAP-M1, now on the
 * wire from `724`): a window running on a non-default userData says so in its title and header."*
 *
 * ⛔ **What is NOT re-tested here as a red, because `main` already draws it.** `724` composes
 * `AppInfo.windowTitle` as `BroBot — <folder>` (`windowTitleFor`, `launch-presentation.ts`); the
 * bar draws it in its `<strong>` and `718` copies it into `document.title` —
 * `compact-now-and-what-main-now-carries.dom.test.ts` §4 pins both. ⚑ `724` F-5: *"`725`'s "the
 * userData title (after 724)" has nothing left to build but a photograph."*
 *
 * 🔴 **What `730` built is the one thing `main` gets wrong with that name: its LENGTH.** A folder's
 * last segment can be 255 characters (APFS), and `.window-title` was `nowrap` with no ceiling in the
 * bar's `auto` middle track. ⚑ Measured in this runner at the app's 1,180 px floor, with `main`'s
 * declarations (the `730` ones taken back off inline — §3 keeps that measurement as its premise):
 *
 * | folder | `main` | `730` |
 * |---|---|---|
 * | 255 characters | the title runs from −291 px to 1,471 px — its first words, *whose window this is*, off the left edge; `WindowControls` 0 px wide, each light squeezed from 11 px to 6 px; the sync cluster 155 px instead of 190.5 | the title is `50vw` (590 px) between the controls and the cluster, cut at its END with an ellipsis, and whole on the `title` of `.window-title` |
 * | 120 characters | the title (875 px) runs 17 px into the sync cluster, which gives up 35 px of its build line | the same 590 px box, nothing squeezed |
 * | `seat-fe` | drawn whole, centred | unchanged |
 *
 * | § | 🔴 subject (RED on `main`) | ⚑ control, one fact over (green on both) |
 * |---|---|---|
 * | 1 | a 255-character folder, and a 120-character one: the controls and the cluster keep the widths the short title leaves them, the title box lies between them, its first words are drawn inside the window, the name is cut and told | `seat-fe`: drawn whole, centred on the window, nothing squeezed |
 * | 2 | — | the hidden launch's `BroBot — test`, the pre-read `BroBot`, and a double with no `windowTitle` at all: drawn as before, and no `title` attribute where there is no name |
 * | 3 | — | ⚑ **THE PREMISE**: the same 255-character bar with the title's ceiling and cut undone inline takes the usage line's room and starts left of the window — so §1's fixture is long enough to fail without them |
 *
 * ⚑ **Mounted in the frame the app mounts it in.** The harness host is `display: flex`, where a bar
 * is a flex item sized to its CONTENT — a short title would measure a bar narrower than the window
 * and centre it on nothing. {@link TheAppFrame} is `RuntimeScreen.vue`'s `.app`, the bar's only
 * parent: a one-column grid, `100vw` wide and never under `--app-min-w`, so the bar is stretched to
 * the window as it is in the app. ⚠️ Those five declarations are COPIED — nothing mounts
 * `RuntimeScreen` — and each test asserts the bar really is the floor's width.
 *
 * ⚠️ `WindowControls`' root has no `data-cy`: it is reached as the parent of the three lights, and
 * asserted to be ONE parent. ⛔ `launch-presentation.ts` is not imported here (it imports `node:fs`);
 * the titles are its spellings, and `the-bar-says-test.render.test.ts` holds the composed one
 * against the real `windowTitleFor`.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const TITLE_BEFORE = document.title

afterEach(async () => {
  unmountAll()
  document.title = TITLE_BEFORE
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/** ⚑ `--app-min-w` — the narrowest the app draws, and where a long title has the least room. */
const FLOOR = 1180
/** ⚑ The web contents' height (`main/index.ts`: `1200 × 840`, frameless). */
const WINDOW_H = 840

/** `PERSONS_TITLE`, `HIDDEN_TITLE` and `windowTitleFor`'s separator, as `launch-presentation.ts` spells them. */
const PERSONS_TITLE = 'BroCrew'
const HIDDEN_TITLE = 'BroCrew — test'
const SEPARATOR = ' — '

/** ⚑ A seat's own `--user-data-dir`, the name `718`'s test composes. */
const A_SHORT_FOLDER = 'seat-fe'

/**
 * ⚑ **A last segment as long as APFS allows** — 255 characters, ASCII so 255 bytes — spelled the way
 * a seat or a script names a throwaway data folder, rather than a run of one letter.
 */
const A_FOLDER_OF_255 = (
  'brobot2-seat-fe-730-userdata-' + 'isolated-run-2026-09-25T14-03-11Z-'.repeat(8)
).slice(0, 255)
const A_FOLDER_OF_120 = A_FOLDER_OF_255.slice(0, 120)

const titled = (folder: string): string => `${PERSONS_TITLE}${SEPARATOR}${folder}`

/** ⚑ `AppInfo` as the wire carries it since `724` — `windowTitle` is added per mount. */
const INFO = {
  name: 'BroCrew',
  version: '0.0.0',
  step: 'Step 0',
  build: { id: 'e76e7c6', commit: 'e76e7c6'.padEnd(40, '0'), dirty: false },
  db: { migrationsApplied: 24, providerSessionCount: 0 },
}

/**
 * ⚑ **`RuntimeScreen.vue`'s `.app`, around the bar** — its `display`, `width`, `height`,
 * `min-width` and `grid-template-rows`, copied (see the docblock above).
 */
const TheAppFrame = defineComponent({
  props: { info: { type: Object as PropType<Record<string, unknown> | null>, default: null } },
  setup(props) {
    return () =>
      h(
        'div',
        {
          style: {
            display: 'grid',
            width: '100vw',
            height: '100%',
            minWidth: 'var(--app-min-w)',
            gridTemplateRows: 'var(--titlebar-h) 1fr',
          },
        },
        [h(AppTitleBar as Component, { info: props.info, error: null })],
      )
  },
})

/** The bar at the floor, in the app's frame, measured once the face has loaded. */
async function theBar(info: Record<string, unknown> | null): Promise<Mounted> {
  const m = mount(TheAppFrame, { info }, { width: FLOOR, height: 32 })
  await nextTick()
  await drawnReady()
  return m
}

/** The `<strong>` the name is drawn in — asserted to exist, so a query cannot be vacuous. */
function theName(m: Mounted): HTMLElement {
  const name = m.q('window-title').querySelector<HTMLElement>('strong')
  expect(name, 'the title has no <strong>').not.toBeNull()
  return name!
}

interface Reading {
  readonly bar: DOMRect
  /** `WindowControls`' own box — the parent of the three lights. */
  readonly controls: DOMRect
  readonly lights: DOMRect[]
  /** `.window-title` — the box that is centred and, since `730`, capped. */
  readonly title: DOMRect
  readonly name: DOMRect
  /** The sync cluster: *Saved locally* and the build line (`app-info`). */
  readonly cluster: DOMRect
}

function reading(m: Mounted): Reading {
  const lights = WINDOW_CONTROLS.map((control) => m.q(`window-${control}`))
  const group = lights[0]!.parentElement!
  expect(
    lights.every((light) => light.parentElement === group),
    'the three lights are not one group',
  ).toBe(true)
  return {
    bar: m.q('app-titlebar').getBoundingClientRect(),
    controls: group.getBoundingClientRect(),
    lights: lights.map((light) => light.getBoundingClientRect()),
    title: m.q('window-title').getBoundingClientRect(),
    name: theName(m).getBoundingClientRect(),
    cluster: m.q('app-info').getBoundingClientRect(),
  }
}

const centreX = (box: DOMRect): number => box.x + box.width / 2

/** The span the three lights take, first left edge to last right edge. */
const spanOf = (lights: DOMRect[]): number => lights[lights.length - 1]!.right - lights[0]!.left

/** Where the name's ink begins — `drawn.ts`' own text geometry, never the element's box. */
const inkStartOf = (name: HTMLElement): number =>
  Math.min(...inkRects(name).map((rect) => rect.left))

/** ⚑ The premise every test states: the bar IS the window's width, at the floor. */
function isTheWindowsWidth(r: Reading): void {
  expect(
    Math.round(r.bar.width),
    'the bar is not the window’s width — the frame did not hold',
  ).toBe(FLOOR)
}

/* ================================================================ §1 · a long folder */

/**
 * 🔴 **One body for both lengths.** ⚑ The short bar is mounted FIRST, in the same engine, and left
 * above the long one: it is the one fact over (the folder's length) every width below is compared
 * with, rather than a number typed from `WindowControls.vue`.
 */
async function aLongFolderKeepsTheBar(folder: string): Promise<void> {
  await page.viewport(FLOOR, WINDOW_H)
  expect(getComputedStyle(document.documentElement).getPropertyValue('--app-min-w').trim()).toBe(
    `${FLOOR}px`,
  )

  const short = reading(await theBar({ ...INFO, windowTitle: titled(A_SHORT_FOLDER) }))
  const whole = titled(folder)
  const m = await theBar({ ...INFO, windowTitle: whole })
  const long = reading(m)
  const name = theName(m)
  isTheWindowsWidth(long)

  // ⚑ The name reaches both places whole — `718`'s fact, held while the draw is cut.
  expect(name.textContent).toBe(whole)
  expect(document.title).toBe(whole)

  // 🔴 **The controls are not squeezed.** Each light keeps its width, and their box keeps the room
  // the three of them take.
  long.lights.forEach((light, i) =>
    expect(
      Math.abs(light.width - short.lights[i]!.width),
      `${WINDOW_CONTROLS[i]} is ${light.width.toFixed(1)} px wide beside a long name, ${short.lights[i]!.width.toFixed(1)} px beside a short one`,
    ).toBeLessThan(0.5),
  )
  expect(
    long.controls.width,
    `WindowControls is ${long.controls.width.toFixed(1)} px wide; its three lights need ${spanOf(short.lights).toFixed(1)}`,
  ).toBeGreaterThanOrEqual(spanOf(short.lights) - 0.5)

  // 🔴 **Nor is the sync cluster** — the build line is what it would give up first.
  expect(
    Math.abs(long.cluster.width - short.cluster.width),
    `the sync cluster is ${long.cluster.width.toFixed(1)} px beside a long name, ${short.cluster.width.toFixed(1)} px beside a short one`,
  ).toBeLessThan(0.5)

  // 🔴 **The title box lies wholly between them.**
  expect(
    long.title.left,
    `the title starts at ${long.title.left.toFixed(1)} px, over the controls (${long.controls.right.toFixed(1)})`,
  ).toBeGreaterThanOrEqual(long.controls.right - 0.5)
  expect(
    long.title.right,
    `the title ends at ${long.title.right.toFixed(1)} px, over the sync cluster (${long.cluster.left.toFixed(1)})`,
  ).toBeLessThanOrEqual(long.cluster.left + 0.5)

  // 🔴 **Its first words — `BroBot — `, whose window this is — are drawn, inside the window.** The
  // ink starts inside the name's own box, so what is cut is the END; and the box shows at least as
  // many px as the whole short title takes, which is `BroBot — ` and more.
  const inkStarts = inkStartOf(name)
  expect(
    inkStarts,
    `the name starts at ${inkStarts.toFixed(1)} px, left of the window`,
  ).toBeGreaterThanOrEqual(0)
  expect(inkStarts, 'the name starts over the controls').toBeGreaterThanOrEqual(
    long.controls.right - 0.5,
  )
  expect(inkStarts, 'the name is cut at its START').toBeGreaterThanOrEqual(long.name.left - 0.5)
  expect(
    long.name.width,
    'fewer px of the long name are drawn than the whole short title takes',
  ).toBeGreaterThanOrEqual(short.name.width)
  expect(visible(name)).toBe(true)

  // 🔴 **Cut, and told.** The ellipsis says there is more; the `title` on `.window-title` holds all
  // of it — `drawn.ts`' `titleRecovers` reads an ancestor's title that contains the whole text.
  assertClippedButTold(name, `a ${folder.length}-character folder’s title`, m.host)
  expect(getComputedStyle(name).textOverflow, 'the cut is a hard edge, not an ellipsis').toBe(
    'ellipsis',
  )
  expect(m.q('window-title').getAttribute('title')).toBe(whole)
}

describe('§1 · a long data folder’s name, at the 1,180 px floor', () => {
  it('🔴 255 characters: the controls and the cluster keep their room, the title lies between them, its first words are drawn, and the name is cut but told', async () => {
    expect(A_FOLDER_OF_255).toHaveLength(255)
    await aLongFolderKeepsTheBar(A_FOLDER_OF_255)
  })

  it('🔴 120 characters: the same — nothing squeezed, the title between the controls and the cluster, cut but told', async () => {
    expect(A_FOLDER_OF_120).toHaveLength(120)
    await aLongFolderKeepsTheBar(A_FOLDER_OF_120)
  })

  it('⚑ THE CONTROL — a short folder (`seat-fe`) is drawn whole and centred on the window, nothing squeezed', async () => {
    await page.viewport(FLOOR, WINDOW_H)
    const whole = titled(A_SHORT_FOLDER)
    const m = await theBar({ ...INFO, windowTitle: whole })
    const r = reading(m)
    isTheWindowsWidth(r)
    const name = theName(m)

    expect(name.textContent).toBe(whole)
    expect(document.title).toBe(whole)
    assertDrawn(name, 'a short folder’s title', m.host)
    expect(cutsOf(name, m.host)).toEqual([])
    // ⚑ `389`'s centring, measured as `one-bar-one-shelf.dom.test.ts` measures it.
    const offset = centreX(r.title) - centreX(r.bar)
    expect(
      Math.abs(offset),
      `the title is ${offset.toFixed(1)} px off the window’s centre`,
    ).toBeLessThan(1)
    expect(spanOf(r.lights)).toBeLessThanOrEqual(r.controls.width + 0.5)
    expect(r.title.left).toBeGreaterThanOrEqual(r.controls.right)
    expect(r.title.right).toBeLessThanOrEqual(r.cluster.left)
  })
})

/* ================================================================ §2 · the names that are not a folder */

describe('§2 · the names that are not a folder are drawn as they were', () => {
  it('⚑ THE CONTROL — a hidden launch’s `BroCrew — test` is drawn whole, centred, and is the page’s title', async () => {
    await page.viewport(FLOOR, WINDOW_H)
    const m = await theBar({ ...INFO, windowTitle: HIDDEN_TITLE })
    const r = reading(m)
    isTheWindowsWidth(r)
    const name = theName(m)
    expect(name.textContent).toBe(HIDDEN_TITLE)
    expect(document.title).toBe(HIDDEN_TITLE)
    assertDrawn(name, 'the hidden launch’s title', m.host)
    expect(Math.abs(centreX(r.title) - centreX(r.bar))).toBeLessThan(1)
  })

  it('⚑ THE CONTROL — before the read lands the bar says `BroCrew`, the page keeps its title, and there is no `title` to hover', async () => {
    await page.viewport(FLOOR, WINDOW_H)
    document.title = PERSONS_TITLE
    const m = await theBar(null)
    const r = reading(m)
    isTheWindowsWidth(r)
    const name = theName(m)
    expect(name.textContent).toBe(PERSONS_TITLE)
    expect(document.title).toBe(PERSONS_TITLE)
    assertDrawn(name, 'the pre-read title', m.host)
    expect(Math.abs(centreX(r.title) - centreX(r.bar))).toBeLessThan(1)
    // ⚑ `:title` bound to a name that has not arrived renders no attribute — never `"undefined"`.
    expect(m.q('window-title').hasAttribute('title')).toBe(false)
  })

  it('⚑ THE CONTROL — a double that omits `windowTitle` (the shape `one-bar-one-shelf` mounts) still draws `BroCrew` and no `title`', async () => {
    await page.viewport(FLOOR, WINDOW_H)
    const m = await theBar({
      name: INFO.name,
      version: INFO.version,
      build: INFO.build,
      db: { migrationsApplied: INFO.db.migrationsApplied },
    })
    isTheWindowsWidth(reading(m))
    const name = theName(m)
    expect(name.textContent).toBe(PERSONS_TITLE)
    assertDrawn(name, 'the fallback title', m.host)
    expect(m.q('window-title').hasAttribute('title')).toBe(false)
  })
})

/* ================================================================ §3 · the premise */

describe('§3 · the premise — without `730`’s ceiling the same name breaks the bar', () => {
  /**
   * ⚑ **`730`'s three declarations, taken back off inline**: `.window-title`'s `max-width` and the
   * `<strong>`'s `overflow` and `text-overflow`. ⚠️ On `main` they are already absent,
   * so this arm measures the same bar on both trees — and says §1's 255 characters are enough to
   * lose the controls and the first words when nothing bounds them.
   */
  it('⚑ THE PREMISE — the 255-character bar with its ceiling and cut undone takes the usage line’s room and starts left of the window', async () => {
    await page.viewport(FLOOR, WINDOW_H)
    const shortBar = await theBar({ ...INFO, windowTitle: titled(A_SHORT_FOLDER) })
    const short = reading(shortBar)
    const shortUsage = shortBar.q('app-usage').getBoundingClientRect().width
    const m = await theBar({ ...INFO, windowTitle: titled(A_FOLDER_OF_255) })
    const title = m.q('window-title')
    const name = theName(m)
    title.style.maxWidth = 'none'
    name.style.overflow = 'visible'
    name.style.textOverflow = 'clip'
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const r = reading(m)
    isTheWindowsWidth(r)

    // ⚑ The controls keep their width in the left cluster whatever the title does; what gives way
    // there is the usage line beside them.
    expect(
      m.q('app-usage').getBoundingClientRect().width,
      'the unbounded title left the usage line its room — §1 measures nothing',
    ).toBeLessThan(shortUsage - 0.5)
    expect(inkStartOf(name), 'the unbounded title starts inside the window').toBeLessThan(0)
    expect(r.cluster.width).toBeLessThan(short.cluster.width - 0.5)
    expect(cutsOf(name, m.host)).toEqual([])
  })
})
