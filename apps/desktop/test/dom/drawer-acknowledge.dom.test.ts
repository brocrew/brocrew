import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import type { DrawerTab } from '../../src/renderer/src/lib/drawer'
import { drawerProps, mount, unmountAll } from './harness'

/**
 * 212 §3 · **The click is acknowledged in the flush that handles it.**
 *
 * 210 used the app for an hour and ranked this the friction it felt most often. ⛔ Its complaint was
 * NOT the wait: *"I clicked once, wondered whether the app had noticed, and had to resist clicking
 * again."* Those are two defects and the second one is cheap.
 *
 * ⚑ **§1 measured the wait and it is not the app's.** Over 84 drawer gestures the click handler cost
 * 0.1 ms and the selected state reached the DOM in 1-8 ms, every time. The 5-8 s belonged to a
 * driver waiting on timers and frames in a window the OS had marked hidden — where `setTimeout(100)`
 * costs a second and `requestAnimationFrame` never fires at all.
 *
 * ⚠️ **So what is asserted here is the SHAPE, not a clock.** A wall-clock assertion would be a flake
 * on a loaded machine and a thing no mutation table can pin. The claim is: the mark that says *this
 * tab is selected* lands in the flush that handles the click — it never needs a second one, and it
 * never waits on an `await`. ⛔ **That is the regression worth holding.** `drawerTab` is a
 * `usePersistentChoice` today, backed by synchronous `localStorage`; the day someone moves that
 * preference to IPC, the selected state starts arriving a round trip later and 210's sentence comes
 * back — for a reason nobody would look for in a storage change.
 *
 * ⚑ **The body is made deliberately expensive so the assertion cannot pass by being lucky.** It is
 * not a hypothetical cost: measured in this harness, the Events body mounts 5,000 rows — the real
 * ceiling, `WINDOW_MAX_EVENTS`, which is double `HISTORY_WINDOW_MAX_EVENTS` — in **148-171 ms**, and
 * 2,500 rows in 77 ms. That cost is paid in the same flush as the acknowledgement, which the second
 * test states out loud rather than leaving as folklore.
 */

/** A body that really is expensive to set up — the state the assertion has to survive. */
const SLOW_MS = 120
let slowMounts = 0
vi.mock('../../src/renderer/src/components/SessionChanges.vue', () => ({
  default: defineComponent({
    name: 'SlowChanges',
    setup() {
      slowMounts += 1
      const until = Date.now() + SLOW_MS
      // Deliberately synchronous: a mount that blocks the main thread is the only kind that can hold
      // a paint back, and an `await` here would not reproduce the shape at all.
      while (Date.now() < until) {
        /* burn the main thread, exactly as a 5,000-row body does */
      }
      return () => h('div', { 'data-cy': 'slow-changes-body' }, 'changes')
    },
  }),
}))

// ⚠️ Imported after the mock is declared. `vi.mock` is hoisted, so this is not a race — but the
// import is written below it so a reader does not have to know that to trust the file.
const { default: SessionDrawer } =
  await import('../../src/renderer/src/components/SessionDrawer.vue')

/**
 * The parent, because the drawer does not own its tab — it emits, and it is told.
 * ⛔ That round trip is the whole point: the acknowledgement has to survive a hop through a parent,
 * which is where an `await` would be introduced if one ever were.
 */
function host(initial: DrawerTab = 'open') {
  const tab = ref<DrawerTab>(initial)
  const DrawerHost = defineComponent({
    name: 'DrawerHost',
    setup() {
      // ⚠️ Loosely typed on purpose, exactly as `harness.mount` is: `drawerProps` is a
      // `Record<string, unknown>` fixture, and `h`'s strict overload cannot reconcile that with the
      // component's own prop types without restating all twenty of them here.
      return () =>
        h(SessionDrawer as Component, {
          ...drawerProps({ tab: tab.value }),
          'onUpdate:tab': (next: DrawerTab) => {
            tab.value = next
          },
        })
    },
  })
  return { tab, mounted: mount(DrawerHost, {}) }
}

afterEach(() => {
  unmountAll()
  slowMounts = 0
})

describe('212 §3 · the drawer says it noticed, in the flush that handles the click', () => {
  it('⛔ one flush after the click the tab is marked — with a body that blocks for 120 ms', async () => {
    const { mounted } = host('open')
    const strip = (): string | null => mounted.q('session-drawer').getAttribute('data-tab')
    const marked = (): string | null => mounted.q('drawer-tab-changes').getAttribute('data-active')

    // ⛔ The negative control. Without it the assertions below would also pass on a drawer that
    // marked every tab selected, which is not a state anyone would notice in a green run.
    expect(strip(), 'the drawer starts on the Open tab').toBe('open')
    expect(marked(), 'and Changes is not the selected tab yet').toBe('false')
    expect(
      mounted.q('drawer-tab-changes').querySelector('.tab-label'),
      'an unselected tab carries no label (088)',
    ).toBeNull()
    // What a tab nobody has pressed reads as, taken from the engine before anything moves.
    const quietInk = getComputedStyle(mounted.q('drawer-tab-changes')).color

    mounted.q('drawer-tab-changes').click()
    await nextTick()
    const pressedInk = getComputedStyle(mounted.q('drawer-tab-changes')).color

    // ⛔ **The acknowledgement, in all three places a reader could see it.** The label IS the active
    // marker since 088 — there is no underline any more — so a test that checked only `data-active`
    // would be asserting over an attribute nobody looks at.
    expect(marked(), 'the tab was not marked selected in the flush that handled the click').toBe(
      'true',
    )
    expect(strip(), 'the drawer did not say which tab it is on').toBe('changes')
    expect(
      mounted.q('drawer-tab-changes').querySelector('.tab-label')?.textContent,
      'the active tab is the one that carries a label (088), so this IS the visible mark',
    ).toBe('Changes')

    // Assert the active tab’s ink as well as its label. `M4` changed `:class="{ active: … }"`
    // to hard `false`, yet all three projects and 4,361 tests stayed green. With no
    // underline, the label and full text color against muted gray are the two active markers.
    // Compare Chromium’s computed color from the real stylesheet; a class-name assertion
    // would miss the mutation because the class remains in the source.
    expect(
      pressedInk,
      'the tab you pressed reads no differently from the ones you did not',
    ).not.toBe(quietInk)
    expect(
      getComputedStyle(mounted.q('drawer-tab-changes')).color,
      'the pressed tab did not take the active ink',
    ).not.toBe(quietInk)
    expect(
      getComputedStyle(mounted.q('drawer-tab-events')).color,
      'a tab nobody pressed took the active ink too, so the mark says nothing',
    ).toBe(quietInk)
  })

  it('⚠️ and the body is built in that same flush — the coupling, stated rather than assumed', async () => {
    // ⛔ **This test exists to be RED the day someone defers the body, and that is deliberate.**
    // Deferring the mount to a later task would let the strip paint first, and on the 5,000-row
    // Events body that is worth 148-171 ms. It would also open a window in which the strip names one
    // tab while the body still shows another — measured at up to a second in a window the OS has
    // marked hidden, because a deferral has to be a TASK to yield a paint and background tasks are
    // throttled there. ⚑ That is a design call with an instrument cost, so it belongs to the PM and
    // not to a "while I'm here"; what belongs here is that the app cannot drift into either
    // behaviour without a test saying so.
    const { mounted } = host('open')
    expect(slowMounts, 'nothing has been built for a tab nobody has selected').toBe(0)

    mounted.q('drawer-tab-changes').click()
    await nextTick()

    expect(
      mounted.all('slow-changes-body'),
      'the body arrived with the acknowledgement',
    ).toHaveLength(1)
    expect(slowMounts, 'and its cost was paid in that same flush').toBe(1)
  })

  it('the tab a fast double-click passes THROUGH is never built', async () => {
    // ⚠️ 210's own words were *"I had to resist clicking again."* Someone who does not resist lands
    // here, and the cost of the tab they passed over should be nothing at all.
    const { mounted } = host('open')
    mounted.q('drawer-tab-changes').click()
    mounted.q('drawer-tab-events').click()
    await nextTick()

    expect(
      mounted.q('session-drawer').getAttribute('data-tab'),
      'the strip settled on the tab pressed LAST',
    ).toBe('events')
    expect(mounted.all('event-stream'), 'and that tab is the body on screen').toHaveLength(1)
    expect(mounted.all('slow-changes-body'), 'the tab passed through was never built').toHaveLength(
      0,
    )
    expect(slowMounts, 'so a tab nobody stayed on cost nothing').toBe(0)
  })

  it('the tab already on screen at mount renders its body once, not twice', async () => {
    const { mounted } = host('changes')
    await nextTick()
    expect(
      mounted.all('slow-changes-body'),
      'the initial tab renders its body at once',
    ).toHaveLength(1)
    expect(slowMounts, 'and pays for it exactly once').toBe(1)
  })
})
