import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import {
  DRAWER_W_MAX,
  DRAWER_W_MIN,
  TRANSCRIPT_COMFORT,
  TRANSCRIPT_MIN,
} from '../../src/renderer/src/lib/drawer'
import { mount, paneProps, unmountAll, type Mounted } from './harness'

/**
 * **The first frame, which is the only one that was ever wrong** (080 §10, finding 9).
 *
 * *"The ResizeObserver's first callback lands after paint, so a narrow window docked the drawer at
 * 380 for one frame and squeezed the transcript under its floor."* The fix was to measure
 * synchronously in `onMounted`, which runs before paint — and the source says so in a comment. A
 * comment is not a test, and neither is `indexOf('getBoundingClientRect')`: that would still pass
 * if the call were moved into the observer callback beside it, which is exactly the bug.
 *
 * ⚠️ **What is asserted is the FLOOR, not the attribute.** `data-fit` is the mechanism; the promise
 * 079 made is that the reading column never goes under `--transcript-min`. Asserting the promise
 * means a rewrite that keeps it by other means still passes, and one that keeps the attribute while
 * losing the column still fails.
 */

afterEach(unmountAll)

/**
 * **What the browser is about to paint for the first time.**
 *
 * ⚠️ **Reading straight after `mount()` was too early, and finding that out is half the value of
 * this file.** `onMounted` measures the box synchronously — that is 080's fix — but it assigns to a
 * ref, and Vue patches the attribute in a MICROTASK. So immediately after mount the DOM still says
 * `comfortable` while the decision is already `narrow`. The browser never shows that state:
 * microtasks drain before the rendering steps. Awaiting one tick is therefore not a fudge; it is
 * the moment the first frame is actually composed from.
 *
 * ⚠️ **The `requestAnimationFrame` flag is what keeps that honest.** rAF callbacks run in the
 * rendering steps, after the microtask checkpoint — so a flag still `false` here is the browser's
 * own answer to "have you painted yet". Without it this file would be asserting the settled state,
 * which was never broken, and would have passed against the bug it exists for.
 */
async function firstFrame<T>(open: () => Mounted, read: (m: Mounted) => T): Promise<T> {
  let painted = false
  requestAnimationFrame(() => {
    painted = true
  })
  const m = open()
  await nextTick()
  const seen = read(m)
  expect(painted, 'a frame was painted before the measurement — this is not the first frame').toBe(
    false,
  )

  // ⚠️ **The pairing, and review was right to demand it.** The assertion above cannot fail today —
  // rAF runs in the rendering steps, after the microtask checkpoint, so the event loop enforces it
  // for free. On its own that is a claim dressed as a check. This is what makes the sensor real:
  // the flag DOES flip once a frame actually happens, so "still false" above is a measurement of
  // where we are rather than of a constant. It also becomes a live tripwire the day someone puts a
  // macrotask `await` into this helper.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  expect(painted, 'the rAF sensor never fires — the guard above is measuring nothing').toBe(true)

  return seen
}

const widthOf = (el: Element): number => el.getBoundingClientRect().width

const measure = (m: Mounted) => ({
  fit: m.host.querySelector<HTMLElement>('.pane-body')?.dataset.fit,
  column: widthOf(m.q('reading-surface')),
  drawer: widthOf(m.q('session-drawer')),
})

describe('the reading column is already at its floor on the first frame', () => {
  it.each([
    // ⚑ **Fluid between 360 and 560, once the transcript is comfortable** — 1400 leaves
    // 592 past the transcript's comfortable 808, so the drawer stops at its ceiling; 1200 leaves
    // 392, which it takes whole; 1000 leaves less than its floor, so it keeps the floor and the
    // transcript gives way.
    { box: 1400, fit: 'docked', drawer: DRAWER_W_MAX },
    { box: 1200, fit: 'docked', drawer: 1200 - TRANSCRIPT_COMFORT },
    { box: 1000, fit: 'docked', drawer: DRAWER_W_MIN },
    // 920: exactly the floor's room (560 + 360). This is the narrowest docked window.
    { box: TRANSCRIPT_MIN + DRAWER_W_MIN, fit: 'docked', drawer: DRAWER_W_MIN },
  ])('$box px docks at $fit, with the column above its floor', async ({ box, fit, drawer }) => {
    const seen = await firstFrame(
      () => mount(ConversationPane, paneProps({ drawerOpen: true }), { width: box }),
      measure,
    )

    expect(seen.fit).toBe(fit)
    // The promise itself. Pre-fix at 900 this was 520 — the drawer took its comfortable 380 out of
    // a row that could not afford it, and the transcript paid for it below its own minimum.
    expect(
      seen.column,
      `the reading column is ${seen.column}px on the first frame, under its ${TRANSCRIPT_MIN}px floor`,
    ).toBeGreaterThanOrEqual(TRANSCRIPT_MIN)
    expect(seen.drawer).toBe(drawer)
    // Layout really happened: a column of 0 clears no floor, and every assertion above would be
    // about an element the engine never laid out.
    expect(seen.column + seen.drawer).toBe(box)
  })

  /**
   * The bottom of the squeeze. Below the narrow drawer's own room the column stops being squeezed
   * at all — the drawer floats over it — so the floor is kept by a different mechanism, and a file
   * that only ever saw the two docked cases would not notice if this branch stopped happening.
   */
  it('and under the narrow drawer’s room it floats instead of squeezing', async () => {
    const seen = await firstFrame(
      () => mount(ConversationPane, paneProps({ drawerOpen: true }), { width: 800 }),
      measure,
    )

    expect(seen.fit).toBe('overlay')
    // `toBe(800)` and nothing weaker beside it: an additional
    // `toBeGreaterThanOrEqual(TRANSCRIPT_MIN)` was here and could not fail independently of this
    // line, which is the definition of the vacuous assertion this repo tracks. Found in review.
    expect(seen.column).toBe(800)
  })
})
