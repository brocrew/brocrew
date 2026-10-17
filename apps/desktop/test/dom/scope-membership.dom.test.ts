import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import {
  channelGap,
  luminance,
  mount,
  paintedBackground,
  paneProps,
  permission,
  record,
  show,
  unmountAll,
  type Mounted,
  type Rgba,
} from './harness'

/**
 * **What is inside the scope, enumerated rather than promised** (083 §3.4).
 *
 * 080's general lesson, from the defect nobody reported: *"two scopes meant two places for a future
 * column to be forgotten in, and something had already been forgotten in one of them"* — the image
 * viewer's own chrome, dark on paper, found by a review agent and not by any test.
 *
 * ⚠️ **The existing guard against that is a hand-written list.** `chat-theme.test.ts` checks its
 * tokens off `READING_SURFACE`, a literal array of component names, and its own comment says what
 * that is worth: *"a list of this kind is worth exactly what its completeness is worth."* 082 found
 * five components missing from it; 090 added one by hand. **A list is a promise. This is a
 * measurement** — it walks what the pane actually renders and asks the engine, per element, whether
 * the light scope reached it.
 *
 * The test is one sentence: **an element that paints chrome-dark in dark mode must not paint the
 * very same colour in light mode.** Something that changes is inside the scope. Something that goes
 * light is inside it. Something that stays *identically dark* while the page turns to paper is
 * stranded — and that is the whole of the image-viewer defect, with no list in it.
 *
 * ⚠️ **What this does NOT catch, established by mutation rather than by reasoning.** Deleting the
 * light `--drawer-bg` leaves this file GREEN: the drawer then paints dark 40%-alpha glass over a
 * paper page, which composites to `rgb(152, 154, 157)` — muddy, plainly wrong, and neither
 * identical to its dark-mode value nor dark enough to trip the threshold. That class is *a token
 * that forgot its light value*, and it belongs to two other tests, both of which do go red on it:
 * `chat-theme.test.ts` names the token, and `theme-scope.dom.test.ts` measures the mud. This file
 * owns the other class — **an element stranded by POSITION, whose tokens are perfectly good and
 * simply never reach it** — which is the one no token test can see.
 */

afterEach(unmountAll)

/** Below this, a surface is chrome rather than paper — `--bg` is L 0.003, `--panel` L 0.006. */
const CHROME = 0.2

interface Painted {
  el: HTMLElement
  bg: Rgba
}

/**
 * ⚠️ **The one exemption, and it declares itself.** `[data-on-white]` began as 082's agent plate: a
 * subtree that re-declares its own state colours because it is a white island on *every* surface,
 * dark chrome and paper alike. Its amber NEEDING badge is `#92400e` in both themes on purpose, and
 * it is dark enough to look exactly like a strand.
 *
 * This is a rule rather than a list of component names: a subtree that names its own scope has
 * opted out of the conversation's, and the day another one does the same it is exempt without
 * anybody remembering to edit this file. It is still a hole — something genuinely stranded INSIDE
 * the plate would not be reported — and `agent-state.test.ts` is what covers that subtree instead.
 *
 * ⚠️ **That day came twice, so "is 082's agent plate" is now a description of the FIRST carrier
 * rather than of the attribute.** 126 gave it to `ChildWorkViewer`'s paper and 129 to
 * `DocumentBody`'s, and each of those is genuinely a white island whose ink must not follow the
 * app. Measured, so the cost is a number rather than a shrug: on the fixtures this file mounts the
 * exemption removes **0** elements from the walk (5 are already inside the plate, and no paper is
 * rendered); on a pane that draws a plan document it would remove **7 of 72**, all of them on
 * white. `paper-ink.dom.test.ts` is what covers that subtree instead.
 */
const OWN_SCOPE = '[data-on-white]'

/** Every element under the pane, in document order, with what it actually paints. */
function paintOf(root: HTMLElement): Painted[] {
  return [root, ...root.querySelectorAll<HTMLElement>('*')]
    .filter((el) => !el.closest(OWN_SCOPE))
    .map((el) => ({ el, bg: paintedBackground(el) }))
}

/** A short, human name for an element, so a failure says WHERE rather than "an element". */
const name = (el: HTMLElement): string => {
  const cy = el.getAttribute('data-cy')
  if (cy) return `[data-cy=${cy}]`
  const cls =
    el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''
  const owner = el.closest('[data-cy]')?.getAttribute('data-cy')
  return `${el.tagName.toLowerCase()}${cls}${owner ? ` (inside [data-cy=${owner}])` : ''}`
}

/**
 * The detector. Read the same tree twice — once dark, once light — and return everything that never
 * noticed.
 *
 * ⚠️ **The tree is read twice from ONE mount, by flipping the attribute the prop drives.** Two
 * mounts would have to be compared by index, and the day the two trees differ by a single node that
 * comparison silently starts pairing unrelated elements. The fidelity of the flip is asserted
 * separately below, against a pane mounted the ordinary way.
 *
 * `scope` is a parameter for one reason: the test that proves this detector can FIRE needs to move
 * the boundary somewhere else, and a detector that could only ever look at the pane could not be
 * pointed at the state 080 shipped.
 */
function stranded(m: Mounted, scope: HTMLElement = m.q('conversation-pane')): string[] {
  const pane = m.q('conversation-pane')

  scope.setAttribute('data-chat-theme', 'dark')
  const dark = paintOf(pane)
  scope.setAttribute('data-chat-theme', 'light')
  const light = paintOf(pane)

  expect(light).toHaveLength(dark.length)
  return dark
    .map((d, i) => ({ d, l: light[i]! }))
    .filter(({ d, l }) => luminance(d.bg) < CHROME && channelGap(d.bg, l.bg) === 0)
    .map(({ d }) => `${name(d.el)} paints ${show(d.bg)} in BOTH themes`)
}

/** A pane with a permission card AND a generated image, so the drawer and the viewer both exist. */
const busy = () =>
  paneProps({
    drawerOpen: true,
    record: record([
      permission('req_1'),
      { type: 'status', state: 'waiting_permission' } as never,
      // ⚠️ `path` is not decoration: `sessionPanel` indexes an image as an asset only if it has
      // one, so without it the drawer lists nothing and the viewer cannot be opened at all.
      { type: 'image', imageId: 'exec-297ad8c6', path: '/work/out/chart.png' } as TranscriptEvent,
    ]),
  })

describe('nothing inside the pane is left behind when the light comes on', () => {
  it('the pane, the drawer and everything in them', () => {
    const m = mount(ConversationPane, busy(), { width: 1200 })
    const found = stranded(m)
    expect(found, `stranded on paper:\n  ${found.join('\n  ')}`).toEqual([])
  })

  /**
   * ⚠️ **The image viewer specifically, because it is the one that was actually forgotten.** It
   * only exists once an asset is open, so a walk of the resting pane would report a clean sweep
   * having never looked at it — the exact shape of a vacuous pass. Opening it is the difference
   * between this test covering the historical defect and merely claiming to.
   */
  it('…including the image viewer, which is the one that was forgotten', async () => {
    const m = mount(ConversationPane, busy(), { width: 1200 })
    const asset = m.all('panel-asset')[0]
    expect(
      asset,
      'no [data-cy=panel-asset] — the viewer cannot be opened, so this proves nothing',
    ).toBeDefined()

    asset!.click()
    await nextTick()

    // The viewer is really on screen: without this the walk below runs over the resting pane again
    // and passes for the same reason a missing element always passes.
    expect(
      m.host.querySelector('[data-cy="image-viewer"]'),
      'the viewer did not open',
    ).not.toBeNull()

    const found = stranded(m)
    expect(found, `stranded on paper:\n  ${found.join('\n  ')}`).toEqual([])
  })

  /**
   * ⚠️ **The pairing, and without it every assertion above passes over nothing.** `toEqual([])` is
   * satisfied by a detector that can never fire — a walk that finds no elements, a `paintedBackground`
   * that returns white for everything, a stylesheet that failed to load. So: strand something on
   * purpose, in the shape 080 actually shipped, and require the detector to name it.
   */
  it('⚠️ …and the detector FINDS a strand when there is one', () => {
    const m = mount(ConversationPane, busy(), { width: 1200 })
    const clean = stranded(m)
    expect(clean).toEqual([])

    // 080's split scope: the boundary moves off the pane and onto the reading column alone, so the
    // drawer — a sibling of that column, not a child — stops being inside anything. The paint moves
    // with the boundary, as it did in the build that shipped: the transcript really was paper, and
    // that is why the column beside it looked wrong rather than merely dark.
    const column = m.q('reading-surface')
    column.style.background = 'var(--chat-bg)'
    m.q('conversation-pane').removeAttribute('data-chat-theme')

    const found = stranded(m, column)
    expect(found.join('\n'), 'the drawer was stranded and the detector did not say so').toContain(
      'data-cy=session-drawer',
    )
    // …and it is not simply reporting everything: the reading column is inside the scope and must
    // NOT be in the list, or the detector is a constant rather than a test.
    expect(found.join('\n')).not.toContain('data-cy=reading-surface')
  })

  /**
   * The flip is only a faithful stand-in for the shipped rendering if it produces the same pixels.
   * Asserted against a pane mounted the ordinary way, because the whole detector rests on it.
   *
   * ⚠️ **It compared the flip against a `chatLight` prop until 344**, which no longer exists — the
   * pane renders `data-chat-theme="light"` unconditionally. So the fixed point moves: what mounts
   * IS light, and `dark` is the value that now has to be reached for by hand.
   */
  it('flipping the attribute reproduces what the pane actually ships', () => {
    const shipped = mount(ConversationPane, busy(), { width: 1200 })
    const asShipped = paintedBackground(shipped.q('session-drawer'))

    const flipped = mount(ConversationPane, busy(), { width: 1200 })
    flipped.q('conversation-pane').setAttribute('data-chat-theme', 'light')
    expect(channelGap(asShipped, paintedBackground(flipped.q('session-drawer')))).toBe(0)

    // The pairing: dark really is a different colour, so the equality above is agreement rather
    // than two reads of one unchanging thing.
    const dark = mount(ConversationPane, busy(), { width: 1200 })
    dark.q('conversation-pane').setAttribute('data-chat-theme', 'dark')
    expect(channelGap(asShipped, paintedBackground(dark.q('session-drawer')))).toBeGreaterThan(100)
  })
})
