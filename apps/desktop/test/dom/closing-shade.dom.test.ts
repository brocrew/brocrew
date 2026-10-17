import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import ClosingShade from '../../src/renderer/src/components/ClosingShade.vue'
import {
  mount,
  unmountAll,
  paintedBackground,
  contrast,
  parseColor,
  visible,
  show,
} from './harness'

/**
 * 🔴 **Does the closing shade actually stop the app underneath it?** (271 §2, from `270` finding 1)
 *
 * ⛔ **The SSR file cannot answer this and says so.** `closing-shade.render.test.ts` can read the
 * markup and drive the subscription; it has no layout, no cascade and no hit-testing, so it cannot
 * tell a `position: fixed; inset: 0` overlay from a `<div>` that renders in the corner and covers
 * nothing. What `270` experienced was a compositing fact — *"a dead-looking black app"* — and
 * 083 built this project for exactly the class of defect where the string is right and the pixels
 * are not.
 *
 * ⚑ **The claim under test is a hit-test, not a screenshot.** Between ⌘Q and the app being gone,
 * every control behind this shade is about to lose its database — `closeDatabase` runs while the
 * window is still up — so a press that reaches one gets better-sqlite3's own `The database
 * connection is not open`, which is what `270` saw in its first probe. The shade has to be the
 * thing the pointer lands on.
 */

/** The app, and then the shade over it — the composition `App.vue` renders. */
const Host = defineComponent({
  props: { closing: { type: Boolean, default: false } },
  setup(props) {
    const closing = ref(props.closing)
    return () => [
      h(
        'div',
        {
          'data-cy': 'pretend-app',
          // Sized to the whole box, so the centre of the viewport is over it. Without this the
          // hit-test below would be about an empty page rather than about an app.
          style: 'position:absolute;inset:0;background:#0f172a',
        },
        [h('button', { 'data-cy': 'pretend-control', style: 'width:100%;height:100%' }, 'Send')],
      ),
      closing.value ? h(ClosingShade as never) : null,
    ]
  },
})

afterEach(unmountAll)

/** What the pointer would hit at the middle of the viewport. */
function atTheCentre(): Element | null {
  return document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
}

describe('the closing shade, in a real engine', () => {
  it('covers the window and takes the press the app would have got', () => {
    const before = mount(Host, { closing: false })
    // ⚑ **The negative first, and it is what makes the positive mean something.** Without the shade
    // the app's own control is what the pointer lands on — so if the assertion below ever passed
    // for a shade that rendered nowhere, this line would have to have failed too.
    expect(before.q('pretend-control').contains(atTheCentre())).toBe(true)
    before.unmount()

    const during = mount(Host, { closing: true })
    const shade = during.q('closing-shade')
    expect(visible(shade)).toBe(true)

    const hit = atTheCentre()
    expect(hit, 'nothing is at the centre of the window at all').not.toBeNull()
    expect(
      shade.contains(hit),
      `the press reached ${hit?.getAttribute('data-cy') ?? hit?.tagName} instead of the shade`,
    ).toBe(true)
  })

  it('reaches every edge, not just the middle', () => {
    const during = mount(Host, { closing: true })
    const box = during.q('closing-shade').getBoundingClientRect()
    // `position: fixed; inset: 0` is the declaration; this is whether it RESOLVED to one. A shade
    // inside a positioned ancestor would be laid out against that ancestor and leave the titlebar
    // and the rail live — which is the whole reason it is mounted beside `RuntimeScreen`.
    expect(box.left).toBeLessThanOrEqual(0)
    expect(box.top).toBeLessThanOrEqual(0)
    expect(box.right).toBeGreaterThanOrEqual(window.innerWidth)
    expect(box.bottom).toBeGreaterThanOrEqual(window.innerHeight)
  })

  it('leaves the app visibly THERE rather than blanked out', () => {
    const during = mount(Host, { closing: true })
    const painted = paintedBackground(during.q('closing-shade'))
    // ⛔ `270`'s window went to solid black and that is the thing being ruled out: this shade is
    // translucent on purpose, so the app is still visible behind it and reads as busy rather than
    // gone. Pure black would be the defect wearing the fix's clothes.
    expect(
      painted[0] + painted[1] + painted[2],
      `the shade painted ${show(painted)}`,
    ).toBeGreaterThan(0)
    // …and the sentence on it is readable against whatever it composited to. WCAG AA for body text.
    const title = during.q('closing-shade').querySelector('.closing-title')!
    const ink = parseColor(getComputedStyle(title).color)!
    expect(contrast(ink, paintedBackground(title))).toBeGreaterThanOrEqual(4.5)
  })
})
