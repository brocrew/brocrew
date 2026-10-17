import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import { foldWindow } from '../../src/renderer/src/lib/transcript-window'
import type { TranscriptItem } from '../../src/renderer/src/lib/transcript'
import type { RuntimeEventMessage, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * # 🔴 504 · the bottom he has to find, and the plate that is not live
 *
 * > ⚑ *"autoscroll to the bottom in a conversation."*
 * > ⚑ *"if we could use the avatar here and see the status of the agent in realtime (like we have
 * > in all other places) that would be cool."*
 *
 * ## ⛔ The brief's premise for the first one was wrong, and the measurement is why
 *
 * ⚠️ **`504` §3 says *"nothing sticks the transcript to the bottom today — no `stickToBottom`, no
 * `autoScroll`"*.** ⛔ `useStickToBottom.ts` has existed since `088`, `TranscriptView` mounts it,
 * `299` §2 ordered it against `useOlderHistory`, and `297` finding 3 keyed it per conversation. The
 * rule the brief asks to have argued is the rule that composable already implements.
 *
 * 🔴 **What was actually missing is the FIRST anchor.** The follow had one trigger — a `watch`, which
 * fires when its signal CHANGES — so a panel that mounted with its content already present was
 * never scrolled at all. ⚑ Measured here in real Chromium before the repair: **60 rows,
 * `scrollHeight` 3 875, `clientHeight` 500, `scrollTop` 0** — the reader is dropped 3 375px from
 * the bottom, at the first line.
 *
 * ⛔ **And that is the population a person opens.** `ConversationPane` keys `TranscriptView` by
 * `sessionId`, so switching conversations builds a fresh one over a full transcript, and a reopen
 * awaits `store.resume()` before it shows the record. ⚠️ A conversation that was mid-turn hid it,
 * because the first delta moves the signal — so the ones that looked right were the busy ones.
 *
 * ## ⚑ Why it does not fight `useOlderHistory`, asserted rather than argued
 *
 * ⚠️ **`299` §2's whole subject is that the two wanted OPPOSITE things.** §1.3 drives the real
 * *Load earlier messages* button on the real composable and measures that the reader does not move
 * to the bottom — the release path (`releaseFollow`) is what makes that true, and it is unchanged.
 *
 * ## ⛔ The plate half went with the project room
 *
 * ⚠️ **§2 measured the avatar and the reading's age on the project room's rows**, and D-016 deleted
 * the room — so its cases went with it. The plate itself is measured wherever it is still drawn.
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

const fromBottom = (el: HTMLElement): number => el.scrollHeight - el.scrollTop - el.clientHeight

/** A transcript whose items are ALREADY THERE when the component is created. */
function opened(held: RuntimeEventMessage[], height = 500): Mounted {
  return mount(
    TranscriptView as Component,
    { items: foldWindow(held).items, mode: 'normal' },
    { width: 900, height },
  )
}

/** …and one that can page backwards, so the two writers of `scrollTop` meet. */
function paged(held: RuntimeEventMessage[]): {
  view: Mounted
  box: () => HTMLElement
  press: () => Promise<void>
  append: () => Promise<void>
} {
  const entries = ref<RuntimeEventMessage[]>(held)
  const items = ref<TranscriptItem[]>(foldWindow(held).items)
  const Host = defineComponent({
    name: 'PagedHost',
    setup() {
      return () =>
        h(TranscriptView as Component, {
          items: items.value,
          mode: 'normal',
          hasOlder: true,
          turnAligned: true,
          loadOlder: async () => {
            const first = entries.value[0]!.ordinal
            entries.value = [...run(first - 20, 20), ...entries.value]
            items.value = foldWindow(entries.value).items
          },
        })
    },
  })
  const view = mount(Host, {}, { width: 900, height: 500 })
  return {
    view,
    box: () => view.q('transcript'),
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
  }
}

afterEach(unmountAll)

describe('§1 · the first anchor, and the rule it must not break', () => {
  /**
   * 🔴 **The defect, and it is a number.** ⛔ Before `504` this box read `scrollTop === 0` over a
   * `scrollHeight` of nearly 4 000 — the reader lands on the first line of a conversation they
   * opened to see the end of.
   *
   * ⚠️ **Three non-vacuity guards**: the box really overflows, the rows really rendered, and the
   * distance asserted is zero rather than merely small.
   */
  it('🔴 a conversation whose transcript is already there opens at its newest line', async () => {
    const view = opened(run(1, 60))
    await nextTick()
    const box = view.q('transcript')
    expect(box.scrollHeight, 'the box does not overflow — nothing here measures').toBeGreaterThan(
      box.clientHeight + 1_000,
    )
    expect(view.host.querySelectorAll('.entry[data-item]').length).toBe(60)
    expect(fromBottom(box), 'the reader was left above the newest line').toBe(0)
    expect(box.scrollTop, 'the box never scrolled at all').toBeGreaterThan(0)
  })

  /**
   * ⛔ **The rule, unchanged: a reader who has scrolled away is never moved.**
   *
   * ⚑ **This is the half the brief asked to have argued**, and it was already true — `stuck` is
   * released by the scroll and `504` adds no second writer that ignores it. ⚠️ The paired positive
   * is the same fixture with no scroll: the arriving line IS followed, so the negative is about a
   * difference and not about a follow that stopped working.
   */
  it('⛔ a reader who scrolled up stays put when a new line arrives, and one at the end follows', async () => {
    const away = paged(run(1_000, 60))
    await nextTick()
    const box = away.box()
    box.scrollTop = 600
    box.dispatchEvent(new Event('scroll'))
    await nextTick()
    await away.append()
    expect(away.box().scrollTop, 'the reader was yanked to the newest line').toBe(600)

    const following = paged(run(1_000, 60))
    await nextTick()
    await following.append()
    expect(fromBottom(following.box()), 'the follow stopped following').toBe(0)
  })

  /**
   * 🔴 **It does not fight `useOlderHistory`** — `299` §2's measured conflict, re-asked now that the
   * follow has a second trigger.
   *
   * ⛔ **The mount anchor puts the reader AT the bottom, which is `stuck === true`** — so without
   * `releaseFollow` the prepend's own signal change would fire the watcher and throw them back to
   * the newest line on the one gesture whose whole purpose is to go the other way. ⚑ That release
   * is unchanged and this is what proves `504` did not undo it.
   *
   * ⚠️ **The press is the real control on the real composable**, not a call to `loadOlder`.
   */
  it('🔴 asking for older messages is not undone by the anchor that just ran', async () => {
    const page = paged(run(1_000, 60))
    await nextTick()
    const box = page.box()
    expect(fromBottom(box), 'the fixture did not anchor, so there is no conflict to measure').toBe(
      0,
    )
    // ⚠️ **Scrolled to the fetch band by hand**, because the button is what this drives and the
    // reader has to be somewhere a person paging back would be.
    box.scrollTop = 0
    box.dispatchEvent(new Event('scroll'))
    await nextTick()
    await page.press()
    const after = page.box()
    expect(after.querySelectorAll('.entry[data-ordinal]').length).toBe(80)
    expect(
      fromBottom(after),
      'the prepend threw the reader to the newest line — the release is gone',
    ).toBeGreaterThan(1_000)
  })

  /**
   * ⚑ **A panel with nothing to scroll is not a panel that throws** — `106`'s shape applied to a
   * measurement: the anchor runs on every mount, including the ones where it can do nothing.
   */
  it('⚑ a transcript that does not overflow is left exactly where it is', async () => {
    const view = opened(run(1, 1), 800)
    await nextTick()
    const box = view.q('transcript')
    expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight)
    expect(box.scrollTop).toBe(0)
  })
})
