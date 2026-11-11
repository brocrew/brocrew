import { scrollLines as run } from './scroll-lines'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import type { RuntimeEventMessage } from '../../src/shared/runtime-ipc'
import type { TranscriptItem } from '../../src/renderer/src/lib/transcript'
import { foldWindow } from '../../src/renderer/src/lib/transcript-window'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import { mount, unmountAll } from './harness'

export function registerQuestionScrollCases(frames: (count: number) => Promise<void>) {
  interface Reader {
    box: () => HTMLElement
    /** The bar's button if it is on screen, or null — `q()` throws, and absence is the subject here. */
    jump: () => HTMLElement | null
    older: () => HTMLElement | null
    jumps: () => number
    loads: () => number
    /** Lines arrive below the reader. */
    grow: (count: number) => Promise<void>
  }

  /** How far the box's end is from the reader, in px. */
  const away = (box: HTMLElement): number => box.scrollHeight - box.scrollTop - box.clientHeight

  /**
   * A transcript over a window that holds the tail, as `eleven-hours` builds one — with the loads it
   * was asked for counted, and the lines it draws growable by the test.
   */
  function reader(options: { rows: number; hasOlder: boolean }): Reader {
    const events = ref<RuntimeEventMessage[]>(run(0, options.rows))
    const items = ref<TranscriptItem[]>(foldWindow(events.value).items)
    let jumps = 0
    let loads = 0
    const Host = defineComponent({
      name: 'ReaderHost',
      setup() {
        return () =>
          h(TranscriptView as Component, {
            items: items.value,

            hasOlder: options.hasOlder,
            turnAligned: true,
            loadOlder: options.hasOlder
              ? async () => {
                  loads += 1
                }
              : undefined,
            atTail: true,
            jumpToLatest: async () => {
              jumps += 1
            },
          })
      },
    })
    const view = mount(Host, {}, { width: 900, height: 400 })
    const one = (cy: string): HTMLElement | null => view.all(cy)[0] ?? null
    return {
      box: () => view.q('transcript'),
      jump: () => one('jump-to-latest'),
      older: () => one('load-older'),
      jumps: () => jumps,
      loads: () => loads,
      grow: async (count) => {
        events.value = run(0, events.value.length + count)
        items.value = foldWindow(events.value).items
        await nextTick()
      },
    }
  }

  /** The reader scrolls up to the first line, and the engine says so. */
  const scrollToTop = async (box: HTMLElement): Promise<void> => {
    box.scrollTop = 0
    box.dispatchEvent(new Event('scroll'))
    await nextTick()
  }

  /**
   * ⚑ **Eight rows in a 400px box**, measured on this engine: 223px of overflow with *Load earlier
   * messages* above them, so a reader pinned to the end sits 223px down — past the follow's 40px, and
   * inside the 400px band in which a scroll asks for older history.
   */
  const SHORT_PAGE = 8

  describe('Jump to latest is offered where the newest line is out of view', () => {
    it('🔴 a reader who scrolled up a window that still holds the tail is offered Jump to latest', async () => {
      const s = reader({ rows: 40, hasOlder: false })
      const box = s.box()
      // The premise, read on this mount: it overflows, and the newest line is on screen.
      expect(box.scrollHeight).toBeGreaterThan(box.clientHeight)
      expect(away(box)).toBeLessThanOrEqual(1)
      expect(s.jump(), 'the bar is offered over a newest line that is in view').toBeNull()

      // The reader scrolls up: the window still holds the tail, and the newest line is out of view.
      await scrollToTop(box)
      expect(s.jump(), 'a reader who scrolled up has no way back').not.toBeNull()
      expect(s.jump()!.textContent?.trim()).toBe('Jump to latest')

      s.jump()!.click()
      await nextTick()
      await frames(2)
      // The press ran, put the reader at the end again, and the bar went.
      expect(s.jumps()).toBe(1)
      expect(away(box)).toBeLessThanOrEqual(1)
      expect(s.jump(), 'the bar outlived a reader back at the end').toBeNull()
    })

    it('🔴 a short page does not page back on its own scroll while its newest line is in view', async () => {
      const s = reader({ rows: SHORT_PAGE, hasOlder: true })
      const box = s.box()
      await frames(2)
      // ⚑ The premise, read on this mount: the page overflows its box by more than the follow's
      // 40px, and by less than the 400px band in which a scroll asks for older history — so the
      // follow's own scroll is inside the band while the newest line is on screen.
      const overflow = box.scrollHeight - box.clientHeight
      expect(overflow, 'the page does not overflow the follow’s threshold').toBeGreaterThanOrEqual(
        60,
      )
      expect(overflow, 'the page is taller than the fetch band').toBeLessThanOrEqual(300)
      expect(away(box)).toBeLessThanOrEqual(1)
      expect(s.older(), 'a window with older history offers no way to ask for it').not.toBeNull()

      box.dispatchEvent(new Event('scroll'))
      await frames(2)
      expect(s.loads(), 'a scroll at the end asked for older history').toBe(0)

      // ⚑ The button still asks: a reader at the end who wants the beginning presses for it.
      s.older()!.click()
      await frames(2)
      expect(s.loads()).toBe(1)
      unmountAll()

      // One fact over: the same page, scrolled up to the top, is a reader asking for the beginning.
      const up = reader({ rows: SHORT_PAGE, hasOlder: true })
      await frames(2)
      expect(up.loads()).toBe(0)
      up.box().scrollTop = 0
      await frames(2)
      expect(up.loads()).toBe(1)
    })

    it('⚑ the pill appears when lines arrive below a reader who is no longer following', async () => {
      const s = reader({ rows: SHORT_PAGE, hasOlder: true })
      const box = s.box()
      await frames(2)
      expect(away(box)).toBeLessThanOrEqual(1)
      expect(s.jump(), 'the bar is offered over a newest line that is in view').toBeNull()

      // Pressing *Load earlier messages* is the reader saying they are not following the end; nothing
      // is prepended here, so the newest line is still in view.
      s.older()!.click()
      await frames(2)
      expect(s.loads()).toBe(1)
      expect(away(box)).toBeLessThanOrEqual(1)
      expect(s.jump()).toBeNull()

      // Lines arrive below them. No scroll event fires, and the end has left the view.
      await s.grow(4)
      await frames(2)
      expect(away(box)).toBeGreaterThan(40)
      expect(
        s.jump(),
        'lines arrived below a reader who is not following and no bar came',
      ).not.toBeNull()
      expect(s.jump()!.textContent?.trim()).toBe('Jump to latest')
      unmountAll()

      // One fact over: a reader who is following has the same lines arrive and stays pinned at the end.
      const following = reader({ rows: SHORT_PAGE, hasOlder: true })
      await frames(2)
      await following.grow(4)
      await frames(2)
      expect(away(following.box())).toBeLessThanOrEqual(1)
      expect(following.jump()).toBeNull()
    })
  })
}
