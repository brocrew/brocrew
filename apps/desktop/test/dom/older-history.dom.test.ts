import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import { foldWindow } from '../../src/renderer/src/lib/transcript-window'
import type { TranscriptItem } from '../../src/renderer/src/lib/transcript'
import type { RuntimeEventMessage, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * # 🔴 Paging back, in a box that really has layout (299 §2, from 297 findings 4 and 4b)
 *
 * ⛔ **`useOlderHistory` was imported by NO test in any project, and `test/dom/**` had no scroll
 * assertion on the transcript box at all.** 297: *"that absence is why it survived."* Everything
 * about paging back was pinned through `anchorAfterPrepend`, a pure function whose every fixture
 * number was hand-written for a prepend that inserts and deletes nothing.
 *
 * ## What this file drives, and what it models — said before any of it is read
 *
 * ⚑ **Real component, real Chromium, real scroll box.** `TranscriptView` mounts the composable, the
 * follow, the button and the rows; the items come out of the real {@link foldWindow}, so every row
 * carries the real `data-ordinal` the anchor keys on.
 *
 * ⚠️ **The RELEASE is modelled, and deliberately.** `prependPage` only releases above
 * `WINDOW_MAX_EVENTS` (5 000), and mounting five thousand entries into a headless browser to prove
 * a scroll offset is a test that measures the machine. That `prependPage` inserts at the top and
 * deletes from the bottom **in one patch** is already pinned, in event counts, by
 * `transcript-window.test.ts:107` — *"drops the NEWEST end when paging back past the cap, and leaves
 * the tail"*. What was never joined is that same patch reaching a container with layout, and that is
 * what these fixtures do: one `load` that prepends a page and drops the same number off the end.
 */

const AT = 1_700_000_000_000

function message(ordinal: number): RuntimeEventMessage {
  return {
    sessionId: 'sess_1',
    ordinal,
    at: AT + ordinal,
    event: {
      type: 'assistant_message',
      // ⚠️ **Fixed width on purpose.** Row height must not depend on the ordinal, or the fixture
      // measures text wrapping instead of the anchor: a 3-digit and a 4-digit ordinal can wrap
      // differently, and a page whose rows are a different height from the ones it displaces is a
      // fixture that cannot tell a correct anchor from an accidental one.
      text: `line ${String(ordinal).padStart(6, '0')} — ${'the quick brown fox jumps. '.repeat(3)}`,
    } as TranscriptEvent,
  } as RuntimeEventMessage
}

function run(from: number, count: number): RuntimeEventMessage[] {
  return Array.from({ length: count }, (_, index) => message(from + index))
}

interface Paged {
  view: Mounted
  box: () => HTMLElement
  rows: () => HTMLElement[]
  /** Press the real control, and wait for the composable's own two ticks. */
  press: () => Promise<void>
  /** A live message arrives at the end, as one really does. */
  append: () => Promise<void>
  /** How many times `load` was called — a guard against a button that does nothing. */
  loads: () => number
}

/**
 * A transcript over `held` entries, whose `load` prepends `insert` older ones and releases
 * `release` from the newest end — the two halves of one `prependPage`, in one patch.
 */
function paged(options: {
  held: RuntimeEventMessage[]
  insert: number
  release: number
  height?: number
}): Paged {
  const entries = ref<RuntimeEventMessage[]>(options.held)
  const items = ref<TranscriptItem[]>(foldWindow(options.held).items)
  let loads = 0
  const load = async (): Promise<void> => {
    loads += 1
    const first = entries.value[0]!.ordinal
    const older = run(first - options.insert, options.insert)
    const kept = entries.value.slice(0, entries.value.length - options.release)
    entries.value = [...older, ...kept]
    items.value = foldWindow(entries.value).items
  }
  const Host = defineComponent({
    name: 'PagedHost',
    setup() {
      return () =>
        h(TranscriptView as Component, {
          items: items.value,
          mode: 'normal',
          hasOlder: true,
          turnAligned: true,
          loadOlder: load,
        })
    },
  })
  const view = mount(Host, {}, { width: 900, height: options.height ?? 600 })
  const box = (): HTMLElement => view.q('transcript')
  return {
    view,
    box,
    rows: () => [...box().querySelectorAll<HTMLElement>('.entry[data-ordinal]')],
    press: async () => {
      view.q('load-older').click()
      await nextTick()
      await nextTick()
      await nextTick()
    },
    append: async () => {
      const last = entries.value[entries.value.length - 1]!.ordinal
      entries.value = [...entries.value, message(last + 1)]
      items.value = foldWindow(entries.value).items
      await nextTick()
      await nextTick()
    },
    loads: () => loads,
  }
}

/** Where a row sits relative to the top of the VIEWPORT — what the reader actually sees. */
function seen(box: HTMLElement, row: HTMLElement): number {
  return row.getBoundingClientRect().top - box.getBoundingClientRect().top
}

function atBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 40
}

afterEach(unmountAll)

describe('a prepend that also releases (299 §2, finding 4)', () => {
  it('🔴 keeps the reader on the same row, though the container barely changed height', async () => {
    const page = paged({ held: run(1_000, 60), insert: 20, release: 20 })
    await nextTick()

    const box = page.box()
    // Non-vacuity, three ways: the box scrolls, the rows carry ordinals, and the reader is in the
    // middle of the conversation rather than at either end of it.
    expect(
      box.scrollHeight,
      'the transcript does not overflow — nothing here measures',
    ).toBeGreaterThan(box.clientHeight + 200)
    expect(page.rows().length).toBe(60)
    // ⚠️ **Two fixture constraints, and both are load-bearing.** The scroll sits OUTSIDE the fetch
    // band (`shouldLoadOlder` fires at `scrollTop <= 400`) or the scroll itself starts a load and
    // every number below is measured against a DOM that is already moving — the band's own
    // behaviour is the third test. And the reader sits ABOVE what the release takes, which is where
    // a real reader is: `keep` is 3 750 of ~5 700 entries and the release comes off the newest end,
    // while the person is at the top of the window they just paged into. A fixture that deletes the
    // rows the reader is on measures the browser's scroll clamp instead of the anchor.
    box.scrollTop = 500
    box.dispatchEvent(new Event('scroll'))
    await nextTick()

    // The row the reader is looking at, identified by the ledger's own number for it.
    const anchor = page.rows().find((row) => seen(box, row) >= 0)!
    const ordinal = anchor.dataset['ordinal']!
    const wasAt = seen(box, anchor)
    const heightBefore = box.scrollHeight
    const topBefore = box.scrollTop

    await page.press()
    expect(page.loads(), 'the button did not load anything').toBe(1)
    const after = page.box()
    // ⚠️ **The condition that makes this the FINDING and not a re-test of the pure prepend.** The
    // container grew by A at the top and shrank by R at the bottom in one patch, so its total
    // height barely moved — and the old arithmetic is `scrollTop + (afterHeight − beforeHeight)`,
    // which is therefore ≈ `scrollTop`: no movement at all.
    expect(
      Math.abs(after.scrollHeight - heightBefore),
      'the fixture did not release — this is a pure prepend and proves nothing new',
    ).toBeLessThan(200)

    const moved = after.querySelector<HTMLElement>(`.entry[data-ordinal="${ordinal}"]`)
    expect(
      moved,
      'the row the reader was on is gone — the fixture released the wrong end',
    ).not.toBeNull()
    // 🔴 The reader is looking at the same words, in the same place on screen.
    expect(Math.abs(seen(after, moved!) - wasAt)).toBeLessThan(4)
    // …and that took a real move: had the anchor done nothing, `scrollTop` would be where it was.
    expect(after.scrollTop).toBeGreaterThan(topBefore + 200)
  })

  it('⚠️ a PURE prepend is unchanged — the case that was already right', async () => {
    // The complement, and the reason it matters: the fix must not be "always move by a lot". A
    // prepend with no release is what the hand-written numbers in `transcript-window.test.ts:261`
    // describe, and it still lands on the same row.
    const page = paged({ held: run(1_000, 60), insert: 40, release: 0 })
    await nextTick()
    const box = page.box()
    box.scrollTop = 500
    box.dispatchEvent(new Event('scroll'))
    await nextTick()
    const anchor = page.rows().find((row) => seen(box, row) >= 0)!
    const ordinal = anchor.dataset['ordinal']!
    const wasAt = seen(box, anchor)
    const heightBefore = box.scrollHeight

    await page.press()

    const after = page.box()
    expect(after.scrollHeight, 'nothing was inserted').toBeGreaterThan(heightBefore + 200)
    const moved = after.querySelector<HTMLElement>(`.entry[data-ordinal="${ordinal}"]`)!
    expect(Math.abs(seen(after, moved) - wasAt)).toBeLessThan(4)
  })

  it('⛔ the reader does not land back inside the fetch band — the self-feeding walk', async () => {
    // `LOAD_OLDER_THRESHOLD_PX` is 400, and a reader left at their old offset after a release is
    // still inside it: the next scroll event fetches again, and the view walks backwards through
    // the conversation on its own, one quadratic re-fold per page. That is the cost of the anchor
    // returning ≈ nothing, and it is why the assertion above is about MOVEMENT and not only about
    // the row.
    const page = paged({ held: run(1_000, 60), insert: 20, release: 20 })
    await nextTick()
    const box = page.box()
    // The SCROLL is the trigger here, not the button — this is the loop the runaway lives in.
    box.scrollTop = 120
    box.dispatchEvent(new Event('scroll'))
    await nextTick()
    await nextTick()
    await nextTick()
    expect(page.loads(), 'the band did not fire — there is no loop to be in').toBe(1)
    expect(page.box().scrollTop).toBeGreaterThan(400)
  })
})

describe('the follow, once a reader has paged back (299 §2, finding 4b)', () => {
  /**
   * ⚠️ **297 4b is REAL as a mechanism and I could not reproduce its consequence** — reported here
   * rather than in a response nobody reads next to the code.
   *
   * The mechanism is exactly as stated: `TranscriptView` hands one element to two composables and
   * both write `node.scrollTop` after their own `await nextTick()`, with nothing ordering them. What
   * does not follow is the harm. `stuck` is true only while the reader IS at the bottom, and the one
   * state where the button is clickable with `stuck` still true is a container whose content does
   * not fill it — where "the bottom" and "where the reader was" are the same place, because the
   * browser clamps `scrollTop` to `scrollHeight − clientHeight` either way. Measured: with the
   * follow left engaged and with it released, the resulting offset is identical.
   *
   * ⛔ **So the release is kept for what it DOES change**, which is the test below: after paging
   * back, a live message must not yank the reader to the newest line. That is the composable's own
   * stated purpose — *"stop the moment they scroll up to read something"* — and pressing Load
   * earlier is the plainest statement of that intent there is, arriving without a scroll.
   */
  it('🔴 a message arriving after Load earlier does not throw the reader to the newest line', async () => {
    const page = paged({ held: run(1_000, 3), insert: 40, release: 0, height: 900 })
    await nextTick()
    const box = page.box()
    // The state the finding needs: nothing has scrolled, and nothing CAN — the content does not
    // fill the box, so `stuck` has never had an opportunity to be released.
    expect(
      box.scrollHeight,
      'the fixture overflows — the follow could have been released by a scroll',
    ).toBeLessThanOrEqual(box.clientHeight + 40)

    await page.press()
    const paged_at = page.box().scrollTop
    expect(page.box().scrollHeight, 'the prepend did not make it scrollable').toBeGreaterThan(
      page.box().clientHeight + 200,
    )

    // A live message lands while the reader is reading history.
    await page.append()

    const after = page.box()
    expect(atBottom(after), 'a live event yanked a reader who had asked to go back').toBe(false)
    expect(Math.abs(after.scrollTop - paged_at), 'the view moved at all').toBeLessThan(4)
  })

  it('⚑ …and a transcript nobody paged back still follows its newest line', async () => {
    // The paired positive, and the one that catches "fix it by never following". The follow is
    // released by the GESTURE, not by the mount — a reader who has not asked for history still gets
    // the live behaviour the composable exists for.
    const page = paged({ held: run(1_000, 60), insert: 40, release: 0 })
    await nextTick()
    // ⚠️ **The mount does not scroll, and that is existing behaviour rather than part of this.**
    // `useStickToBottom` follows a CHANGE — the watcher fires on the signal, and nothing has
    // changed yet — so the first live message is what puts a fresh transcript on its newest line.
    await page.append()
    expect(atBottom(page.box()), 'a following transcript stopped following').toBe(true)
    await page.append()
    expect(atBottom(page.box()), 'and it goes on following').toBe(true)
  })
})
