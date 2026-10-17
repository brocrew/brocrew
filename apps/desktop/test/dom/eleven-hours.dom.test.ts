import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import { foldWindow } from '../../src/renderer/src/lib/transcript-window'
import type { TranscriptItem } from '../../src/renderer/src/lib/transcript'
import type { RuntimeEventMessage, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * # 🔴 The way back, on a conversation that has stopped talking (313 — friction log F3)
 *
 * ⛔ **The defect was an element that was not there**, so this file lives here and not in the node
 * project: `193`'s rule is that a `not.toContain` passes over nothing, and the only honest way to
 * ask "is there a control on this screen" is to render the screen and look. Real component, real
 * Chromium, real scroll box, real click.
 *
 * ## What was wrong
 *
 * The bar carrying *jump to latest* was gated `v-if="props.behind > 0 && props.jumpToLatest"`.
 * `behind` counts **live events that arrive while you are reading back** — so on an idle session it
 * is 0 for ever, the bar never rendered, and a window that had let go of the end had no way back to
 * it. Measured on a real 5,015-event conversation: **one** backward gesture left the window on
 * ordinals 0…3749 with `atTail === false`, `behind === 0` and `hasOlder === false` — no control at
 * either end, and eleven hours of the conversation unreachable while sitting on disk.
 *
 * `test/tail-escape-is-gated-on-the-tail.test.ts` pins that state with the real window functions.
 * This file is the half that needs a browser: what a person can actually press.
 *
 * ## ⚠️ What is modelled here, said before it is read
 *
 * Use a small window: the real one has 3,750 entries, but mounting thousands in a headless
 * browser would measure machine capacity rather than scroll behavior
 * (`older-history.dom.test.ts`). This file tests the flags produced by `prependPage`; the
 * node test separately checks the arithmetic against measured counts.
 */

const AT = 1_700_000_000_000

function message(ordinal: number): RuntimeEventMessage {
  return {
    sessionId: 'sess_1',
    ordinal,
    at: AT + ordinal,
    event: {
      type: 'assistant_message',
      text: `line ${String(ordinal).padStart(6, '0')} — ${'the quick brown fox jumps. '.repeat(3)}`,
    } as TranscriptEvent,
  } as RuntimeEventMessage
}

const run = (from: number, count: number): RuntimeEventMessage[] =>
  Array.from({ length: count }, (_, index) => message(from + index))

interface Stranded {
  view: Mounted
  box: () => HTMLElement
  rows: () => HTMLElement[]
  /** The bar's button if it is on screen, or null — `q()` throws, and absence is the subject here. */
  jump: () => HTMLElement | null
  older: () => HTMLElement | null
  press: () => Promise<void>
  /** Press without waiting, so a second press can land inside the first. */
  click: () => void
  disabled: () => boolean | null
  jumps: () => number
  setTail: (value: boolean) => Promise<void>
}

/**
 * A transcript over an OLD slab, whose `jumpToLatest` puts the newest rows back and re-takes the
 * tail — which is what `session-store.jumpToLatest` → `reopenAtLatest` → `openAt` does.
 */
function stranded(options: {
  atTail: boolean
  hasOlder: boolean
  /** Model `session-store.jumpToLatest` returning without touching the window (a refused IPC). */
  jumpDoesNothing?: boolean
  /** Model the bridge round trip, so a second press has something to race. */
  hold?: Promise<void>
}): Stranded {
  const OLD = run(0, 40)
  const NEWEST = run(200, 40)
  const entries = ref<RuntimeEventMessage[]>(OLD)
  const items = ref<TranscriptItem[]>(foldWindow(OLD).items)
  const atTail = ref(options.atTail)
  let jumps = 0
  const jumpToLatest = async (): Promise<void> => {
    jumps += 1
    if (options.hold) await options.hold
    // ⛔ `session-store.jumpToLatest` returns `Promise<void>` and swallows its own outcome: a
    // refused IPC during a quit resolves exactly like a success, having changed nothing.
    if (options.jumpDoesNothing) return
    entries.value = NEWEST
    items.value = foldWindow(NEWEST).items
    // `openAt` sets it, and the bar has to go when it does.
    atTail.value = true
  }
  const Host = defineComponent({
    name: 'StrandedHost',
    setup() {
      return () =>
        h(TranscriptView as Component, {
          items: items.value,
          mode: 'normal',
          hasOlder: options.hasOlder,
          turnAligned: true,
          loadOlder: options.hasOlder ? async () => {} : undefined,
          atTail: atTail.value,
          jumpToLatest,
        })
    },
  })
  const view = mount(Host, {}, { width: 900, height: 400 })
  const box = (): HTMLElement => view.q('transcript')
  const one = (cy: string): HTMLElement | null => view.all(cy)[0] ?? null
  return {
    view,
    box,
    rows: () => [...box().querySelectorAll<HTMLElement>('.entry[data-ordinal]')],
    jump: () => one('jump-to-latest'),
    older: () => one('load-older'),
    press: async () => {
      one('jump-to-latest')!.click()
      await nextTick()
      await nextTick()
      await nextTick()
    },
    click: () => one('jump-to-latest')!.click(),
    disabled: () => (one('jump-to-latest') as HTMLButtonElement | null)?.disabled ?? null,
    jumps: () => jumps,
    setTail: async (value) => {
      atTail.value = value
      await nextTick()
    },
  }
}

afterEach(unmountAll)

describe('a window that has left the tail offers a way back (313 §1)', () => {
  it('🔴 renders the escape with NOTHING new — the exact state an idle session strands in', async () => {
    const s = stranded({ atTail: false, hasOlder: false })

    // ⛔ THE ASSERTION THIS DISPATCH EXISTS FOR. Before 313 this element did not exist on this
    // screen, because `behind` was 0 and always would be.
    expect(s.jump(), 'a window off the tail has no way back to it').not.toBeNull()
    // ⚑ And the label works without a count — it is a control, not a notification.
    expect(s.jump()!.textContent?.trim()).toBe('Jump to latest')

    // ⚠️ The paired POSITIVE for the negative below (193): the same element, in the same mount,
    // proven present a line ago — so "absent at the tail" is a statement about a control that
    // really can be there, not about a selector that never matched anything.
    await s.setTail(true)
    expect(s.jump(), 'the bar is still offered on a window that holds the end').toBeNull()
    await s.setTail(false)
    expect(s.jump()).not.toBeNull()
  })

  it('⛔ the press re-takes the tail: the newest rows come back and the bar goes', async () => {
    const s = stranded({ atTail: false, hasOlder: false })
    expect(s.rows().at(0)?.dataset['ordinal']).toBe('0')
    expect(s.rows().at(-1)?.dataset['ordinal']).toBe('39')

    await s.press()

    // The store's escape really ran — a button that renders and does nothing is the same defect
    // wearing a different coat.
    expect(s.jumps()).toBe(1)
    expect(s.rows().at(0)?.dataset['ordinal']).toBe('200')
    expect(s.rows().at(-1)?.dataset['ordinal']).toBe('239')
    expect(s.jump(), 'the bar outlived the jump it performed').toBeNull()

    // …and it lands at the BOTTOM of the page it just fetched, which is the thing the reader asked
    // for. `jumpBack` writes `scrollTop = scrollHeight`; the browser clamps it to the real maximum.
    const box = s.box()
    expect(box.scrollHeight).toBeGreaterThan(box.clientHeight)
    expect(box.scrollHeight - box.scrollTop - box.clientHeight).toBeLessThanOrEqual(1)
  })

  it('⛔ a surface that does not say defaults to holding the end, and offers nothing', async () => {
    // ⚠️ **The default is load-bearing and `313 M6` measured that nothing covered it.** `ReadingPane`
    // and `ChildWorkViewer` mount this component over surfaces with no live tail; if `atTail` fell
    // back to `false` they would grow a *Jump to latest* bar the moment either was given a callback.
    // `createWindow()` opens at `atTail: true`, and the prop agrees with it.
    const bare = mount(
      defineComponent({
        name: 'BareHost',
        setup() {
          return () =>
            h(TranscriptView as Component, {
              items: foldWindow(run(0, 6)).items,
              mode: 'normal',
              // No `atTail` at all — and a real callback, so only the default can decide this.
              jumpToLatest: async () => {},
            })
        },
      }),
      {},
      { width: 900, height: 400 },
    )
    expect(
      bare.all('jump-to-latest')[0] ?? null,
      'the default stopped meaning "we hold the end"',
    ).toBeNull()
    // …paired with the positive, so it is not a selector that never matches (193).
    expect(stranded({ atTail: false, hasOlder: false }).jump()).not.toBeNull()
  })

  it('⚑ says *Jump to latest* and no count — the window counts events, not messages (UI-010)', async () => {
    // 🔴 **UI-010 · F053.** This said *"N new messages — jump to latest"* from `window.behind`,
    // which counts every live EVENT — thinking deltas, status, activity — so it read *"36 new
    // messages"* and climbed as an agent thought. ⚑ The view is no longer handed that count, and the
    // label is the control's name and nothing else.
    const s = stranded({ atTail: false, hasOlder: false })
    expect(s.jump()!.textContent?.trim()).toBe('Jump to latest')
  })
})

/**
 * ⚠️ **§3.2 — the same question pointed UP, measured rather than reasoned about.**
 *
 * The dispatch asked whether the top edge has the same defect: can a window have older events with
 * no way to ask for them? It does not, and the reason is that this control was already gated on the
 * STATE (`hasOlder`) rather than on a gesture or an arrival — which is exactly the shape §1 asks for
 * at the bottom. These mount it in a box with no scrolling at all, because a scroll handler is the
 * one thing that would NOT fire in the stranded state.
 */
describe('…and the escape behaves like a control (313, from the adversarial pass)', () => {
  it('⛔ a jump that changed nothing leaves the reader where they were', async () => {
    // 🔴 **Found by reviewing this dispatch's own diff.** `session-store.jumpToLatest` returns
    // `Promise<void>` and discards its outcome — a refused IPC during a quit resolves like a
    // success — and `jumpBack` used to scroll unconditionally. That threw the reader to the bottom
    // of the STALE window: not where they were reading, not the latest, with the bar still there
    // because `atTail` never moved. `atTail` is the receipt, and it was already a prop.
    const s = stranded({ atTail: false, hasOlder: false, jumpDoesNothing: true })
    const box = s.box()
    box.scrollTop = 120
    const before = box.scrollTop
    await s.press()

    expect(s.jumps(), 'the escape was not even attempted').toBe(1)
    expect(box.scrollTop, 'a failed jump moved the reader anyway').toBe(before)
    expect(s.rows().at(0)?.dataset['ordinal'], 'the window changed on a jump that failed').toBe('0')
    // …and the bar is still there, because they are still off the tail. That is the honest state.
    expect(s.jump()).not.toBeNull()
  })

  it('⛔ a second press during the read does not start a second read', async () => {
    // 🔴 Also from the diff review, and CONFIRMED: the store's guard is
    // `if (!record || record.window.atTail) return`, read BEFORE it awaits the bridge — so it
    // cannot dedupe. Two presses meant two 2,500-event reads and two quadratic re-folds, and this
    // bar is a permanent fixture on an idle session since 313 rather than a transient one.
    let release = (): void => {}
    const hold = new Promise<void>((resolve) => {
      release = () => resolve()
    })
    const s = stranded({ atTail: false, hasOlder: false, hold })

    s.click()
    await nextTick()
    expect(s.disabled(), 'the control stays pressable while it is working').toBe(true)
    s.click()
    s.click()
    await nextTick()
    expect(s.jumps(), 'a second press started a second read').toBe(1)

    release()
    await nextTick()
    await nextTick()
    await nextTick()
    expect(s.jumps()).toBe(1)
    // …and once it has landed the control is gone, because the window holds the end again.
    expect(s.jump()).toBeNull()
  })

  it('⚑ …and the guard is released, so a LATER press still works', async () => {
    // The paired positive (193): a latch that never opens would pass the test above and break the
    // control for ever.
    const s = stranded({ atTail: false, hasOlder: false, jumpDoesNothing: true })
    await s.press()
    expect(s.disabled(), 'the in-flight guard never let go').toBe(false)
    await s.press()
    expect(s.jumps(), 'the second press was swallowed by a stuck latch').toBe(2)
  })
})

describe('the top edge, and it was already right (313 §3.2)', () => {
  it('⚑ offers *Load earlier messages* with no scroll GESTURE ever having happened', async () => {
    const s = stranded({ atTail: false, hasOlder: true })
    // 🔴 **504 · this read `scrollTop === 0` and the panel now anchors itself at mount.** ⛔ The
    // subject is unchanged and is sharper for it: nobody has scrolled, the view has put itself at
    // the NEWEST line — the furthest point in the box from the control below — and the control is
    // offered anyway, because it is gated on `hasOlder` and not on a gesture or an arrival.
    const box = s.box()
    expect(box.scrollTop, 'the view did not anchor at the newest line').toBe(
      box.scrollHeight - box.clientHeight,
    )
    expect(box.scrollTop, 'this box does not scroll, so it measures nothing').toBeGreaterThan(0)
    expect(s.older(), 'a window with older events on disk cannot ask for them').not.toBeNull()
    expect(s.older()!.textContent?.trim()).toBe('Load earlier messages')
    expect((s.older() as HTMLButtonElement).disabled).toBe(false)
  })

  it('🔴 …and both edges really can go dark at once, which is what happened to him', async () => {
    // The measured state: one prepend reached ordinal 0, so `hasOlder` went false in the same patch
    // that took `atTail` false. Before 313 this screen had NO control at either end.
    const s = stranded({ atTail: false, hasOlder: false })
    expect(s.older(), 'nothing older exists, so this is correctly absent').toBeNull()
    // …and the paired positive, so the line above is not passing over a selector that never matches.
    expect(stranded({ atTail: true, hasOlder: true }).older()).not.toBeNull()
    // The bar is now the only thing standing between the reader and a conversation that looks
    // finished eleven hours before it is.
    expect(s.jump()).not.toBeNull()
  })
})
