import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import EventStream from '../../src/renderer/src/components/EventStream.vue'
import { describeEvent } from '../../src/renderer/src/lib/describe-event'
import {
  createWindow,
  WINDOW_MAX_EVENTS,
  type WindowState,
} from '../../src/renderer/src/lib/transcript-window'
import type { RuntimeEventMessage, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * 255 · **Five thousand rows, and only the ones you can see are drawn.**
 *
 * ⛔ **Virtualization is a `dom` question and `251` §0 is why this file is not an SSR test.** The
 * whole claim is about layout, containment, a scrollbar and a scroll position — `renderToString`
 * has none of those, and a component that folded nothing at all would pass every string assertion
 * in `raw-stream.render.test.ts` (which is why that file now asserts the fold's *markup* and this
 * one asserts its *behaviour*).
 *
 * ⚠️ **The two halves are asserted TOGETHER on the same mount, deliberately.** *"The render is
 * folded"* and *"every row is still readable"* are each other's control: a fold that took the rows
 * out of the DOM would pass the first and fail the second, and a change that quietly stopped
 * folding would pass the second and fail the first. Neither number means anything alone.
 */

const AT = 1_700_000_000_000

/** Where the planted `235`-style erasure sits — far below anything the viewport can reach. */
const ERASED_AT = 4_000

/** Where a `tool_call` with a recognisable name sits, likewise deep. */
const DEEP_TOOL_AT = 3_331

function eventFor(index: number): TranscriptEvent {
  if (index === ERASED_AT) {
    // ⚑ The shape `235`'s `degradeEvent` writes and `framesErased` looks for: an `unknown` whose
    // label carries the reserved ` · degraded:` marker and the type the frame used to be.
    return {
      type: 'unknown',
      provider: 'claude',
      category: 'unrecognized',
      label: 'degraded:tool_call',
      raw: {},
    } as never
  }
  if (index === DEEP_TOOL_AT) {
    return { type: 'tool_call', name: 'Bash', id: 'deep_call', input: {} } as never
  }
  switch (index % 8) {
    case 0:
      return { type: 'turn', state: 'started' } as never
    case 1:
      return { type: 'tool_call', name: 'Read', id: `t_${index}`, input: {} } as never
    case 2:
      return { type: 'tool_result', id: `t_${index - 1}`, ok: true } as never
    case 3:
      return {
        type: 'unknown',
        provider: 'codex',
        category: 'reasoning',
        label: 'item/plan/delta',
        raw: {},
      } as never
    case 4:
      return { type: 'assistant_delta', text: 'x'.repeat(40) } as never
    case 5:
      return { type: 'thinking', phase: 'delta', text: 'why', tokens: 12 } as never
    case 6:
      return { type: 'error', fatal: false, cause: 'rate_limit', message: 'slow down' } as never
    default:
      return { type: 'turn', state: 'completed' } as never
  }
}

function corpus(n: number): RuntimeEventMessage[] {
  return Array.from({ length: n }, (_unused, index) => ({
    sessionId: 'sess_a',
    ordinal: index,
    at: AT + index * 37,
    event: eventFor(index),
  }))
}

const FULL = corpus(WINDOW_MAX_EVENTS)

function open(entries: RuntimeEventMessage[], over: Partial<WindowState> = {}): HTMLElement {
  const m = mount(
    EventStream,
    { window: { ...createWindow(), entries, ...over } },
    { width: 900, height: 700 },
  )
  return m.q('event-log')
}

/**
 * ⛔ **`ledgerRows`, verbatim** — the live smoke's own read, run here against a real folded list.
 *
 * ⚠️ **A copy, and the copy is the point.** `scripts/ui-live-smoke.mjs` cannot import from the app
 * and this file cannot import from it, so `scripts/test/step-census.test.mjs` pins the three lines
 * below against the smoke's source. ⛔ If they ever go out of step that census reddens — which is
 * what stops this test certifying a query the instrument no longer makes.
 */
function ledgerRows(log: Element, type: string): string[] {
  return [...log.querySelectorAll('li')]
    .filter((li) => li.dataset.type === type)
    .map((li) => (li.querySelector('.rdetail')?.textContent ?? '').trim())
}

/** `framesErased`, likewise — the one read that can see a frame the wire had to erase (235). */
function framesErased(log: Element, type: string): string[] {
  const marker = ' · degraded:'
  return ledgerRows(log, 'unknown').filter(
    (detail) => detail.endsWith(`${marker}<unnamed>`) || detail.endsWith(`${marker}${type}`),
  )
}

const rowsIn = (log: Element): HTMLLIElement[] => [
  ...log.querySelectorAll<HTMLLIElement>('li[data-type]'),
]
const foldedIn = (log: Element): HTMLLIElement[] => [
  ...log.querySelectorAll<HTMLLIElement>('li.folded'),
]

/** The `<li>` the reader's eye lands on: whatever is under the top edge of the scroll box. */
function rowAtViewportTop(log: Element): HTMLLIElement | null {
  const box = log.getBoundingClientRect()
  const hit = document.elementFromPoint(box.left + 100, box.top + 4)
  return hit?.closest('li') ?? null
}

async function scrollTo(log: HTMLElement, top: number): Promise<void> {
  log.scrollTop = top
  log.dispatchEvent(new Event('scroll'))
  await nextTick()
  await nextTick()
}

afterEach(unmountAll)

describe('the whole window is in the DOM (255 §2)', () => {
  it('⛔ five thousand rows, five thousand readable details, one attribute each', () => {
    const log = open(FULL)
    const rows = rowsIn(log)

    expect(rows).toHaveLength(WINDOW_MAX_EVENTS)
    const readable = rows.filter(
      (li) => (li.querySelector('.rdetail')?.textContent ?? '').trim() !== '',
    )
    expect(readable).toHaveLength(WINDOW_MAX_EVENTS)

    // ⚑ …and a row far below anything drawn says exactly what the shared describer says it says —
    // not merely "something", which is what a `length` check alone would accept.
    const deep = rows[ERASED_AT - 137]!
    expect(deep.dataset.ordinal).toBe(String(ERASED_AT - 137))
    expect(deep.querySelector('.rdetail')?.textContent).toBe(
      describeEvent(FULL[ERASED_AT - 137]!.event),
    )
    expect(deep.classList.contains('folded')).toBe(true)
  })

  it('⛔ `ledgerRows` still answers about the WINDOW rather than the viewport', () => {
    const log = open(FULL)

    const calls = ledgerRows(log, 'tool_call')
    // Every `tool_call` in the corpus, including the one 3,331 rows down that no viewport reaches.
    const expected = FULL.filter((m) => m.event.type === 'tool_call')
    expect(calls).toHaveLength(expected.length)
    expect(expected.length).toBeGreaterThan(500)
    expect(calls).toContain('Bash · deep_call')
    // ⚑ The negative, from the same read, so the filter is doing work: nothing in this corpus is a
    // permission request, and the query says so rather than returning everything.
    expect(ledgerRows(log, 'permission_request')).toEqual([])
  })

  it('⛔ 235’s erasure marker is found four thousand rows below the fold', () => {
    const log = open(FULL)

    expect(framesErased(log, 'tool_call')).toEqual(['claude · degraded:tool_call'])
    // The paired negative: a corpus with nothing erased answers empty through the same helper.
    expect(framesErased(open(corpus(200)), 'tool_call')).toEqual([])
  })
})

describe('…and only the rows you can see are drawn (255 §2)', () => {
  it('⛔ a hundred rows are decorated, four thousand nine hundred are folded', () => {
    const log = open(FULL)

    const drawn = Number(log.dataset.drawn)
    expect(drawn).toBeGreaterThan(20)
    expect(drawn).toBeLessThan(300)
    expect(foldedIn(log).length).toBe(WINDOW_MAX_EVENTS - drawn)

    // ⛔ The ENGINE's answer, not the class name's. A drawn row's detail is rendered; a folded
    // row's is in the DOM and is not — which is the whole of what `content-visibility: hidden`
    // buys, and the one thing a class attribute could claim without delivering.
    const drawnRow = rowsIn(log)[0]!
    const foldedRow = foldedIn(log)[0]!
    expect(drawnRow.classList.contains('folded')).toBe(false)
    expect(drawnRow.querySelector('.rdetail')!.checkVisibility()).toBe(true)
    expect(foldedRow.querySelector('.rdetail')!.checkVisibility()).toBe(false)
    // …and the text is still THERE while not being rendered, which is the pair that matters.
    expect(foldedRow.querySelector('.rdetail')!.textContent).not.toBe('')
  })

  it('⚑ a window shorter than the fold folds nothing at all', () => {
    // Non-vacuity for the count above: `folded` is not a number that is always large.
    const log = open(corpus(20))
    expect(rowsIn(log)).toHaveLength(20)
    expect(foldedIn(log)).toHaveLength(0)
    expect(log.dataset.drawn).toBe('20')
  })

  it('⛔ a folded row keeps the two attributes an instrument reads it by', () => {
    const log = open(FULL)
    // 211 §4's category and the type, on a row nothing is drawing — the pair that would vanish if
    // the fold had been a filter.
    const folded = foldedIn(log).find((li) => li.dataset.type === 'unknown')!
    expect(folded.dataset.category).toBe('reasoning')
    // ⚠️ The CONCRETE ordinal, not `not.toBe('')`: a missing `data-ordinal` reads back as
    // `undefined`, which is not `''`, so the weaker form could not fail for its stated reason.
    // Found by the adversarial pass over 255's diff.
    expect(folded.dataset.ordinal).toBe(String(rowsIn(log).indexOf(folded)))
  })

  /**
   * ⚠️ **What a folded row's `textContent` IS, pinned rather than left incidental.**
   *
   * ⛔ **`scripts/ui-live-smoke.mjs` reads the log SEVEN times and TWO of those read row text** —
   * `ledgerRows`, which filters on `dataset.type` and then maps each row's `.rdetail`, and step 3's
   * `user_command` breadcrumbs, which take the whole `<li>`'s `textContent` and grep it for
   * *"changed approval mode"* and the mode it moved to. Every string either of them wants is in the
   * detail, so the fold does not reach them; what it does take away is the two-token prefix a DRAWN
   * row carries, the clock time and the type. ⚑ The type is still `data-type`, which is how the
   * other five ask for it. This test is here so that narrowing is a decision somebody made rather
   * than something a future step discovers.
   */
  it('⚠️ a folded row reads as its DETAIL — the clock and the type chip are for eyes', () => {
    const log = open(FULL)
    const rows = rowsIn(log)
    const drawnRow = rows[0]!
    const foldedRow = rows[2_000]!

    expect(foldedRow.classList.contains('folded')).toBe(true)
    expect(foldedRow.textContent).toBe(describeEvent(FULL[2_000]!.event))
    // …and the drawn one still carries all three, which is what makes the sentence above a contrast.
    expect(drawnRow.textContent).toContain(describeEvent(FULL[0]!.event))
    expect(drawnRow.textContent).toContain(FULL[0]!.event.type)
    expect(drawnRow.querySelector('.rts')?.textContent).toMatch(/\d/)
  })

  it('⚑ the colour key survives the fold, on drawn rows and folded ones alike', () => {
    // `kindOf` is how a raw row is dimmed or lit, and nothing in the suite read it before 255 — so
    // moving it into the row derivation would have been a silent place to lose it.
    const log = open(FULL)
    const rows = rowsIn(log)
    const tool = rows.find((li) => li.dataset.type === 'tool_call')!
    const lifecycle = rows.find((li) => li.dataset.type === 'turn')!
    const unknown = rows.find((li) => li.dataset.type === 'unknown')!

    expect(tool.classList.contains('k-tool')).toBe(true)
    expect(lifecycle.classList.contains('k-lifecycle')).toBe(true)
    expect(unknown.classList.contains('k-unknown')).toBe(true)
    // ⚑ …and on a row past the fold, where the class is the only thing left of the styling.
    const deepTool = rows.slice(2_000).find((li) => li.dataset.type === 'tool_call')!
    expect(deepTool.classList.contains('folded')).toBe(true)
    expect(deepTool.classList.contains('k-tool')).toBe(true)
  })
})

describe('the scroll geometry (255 §2)', () => {
  it('⛔ the scrollbar measures the whole window, not the drawn part of it', () => {
    const log = open(FULL)
    const rowPx = rowsIn(log)[0]!.getBoundingClientRect().height

    expect(rowPx).toBeGreaterThan(0)
    // Within a pixel over five thousand rows: a folded row is exactly as tall as the row it stands
    // in for. Half a pixel of drift here is 2,466 px at the bottom of the list.
    expect(Math.abs(log.scrollHeight - rowPx * WINDOW_MAX_EVENTS)).toBeLessThan(1)
  })

  it('⛔ scrolling into the middle draws the rows you scrolled TO', async () => {
    const log = open(FULL)
    const rowPx = rowsIn(log)[0]!.getBoundingClientRect().height
    const target = Math.round(rowPx * 2_600)

    await scrollTo(log, target)

    const top = rowAtViewportTop(log)
    expect(top, 'nothing is under the top edge of the list').not.toBeNull()
    expect(top!.classList.contains('folded')).toBe(false)
    expect(Number(top!.dataset.ordinal)).toBeGreaterThan(2_590)
    expect(Number(top!.dataset.ordinal)).toBeLessThan(2_610)
    // ⚑ …and the row that WAS drawn at the top of the list has been given back.
    expect(rowsIn(log)[0]!.classList.contains('folded')).toBe(true)
  })

  it('⛔ …and the last row in the window is drawn when you reach it', async () => {
    const log = open(FULL)

    await scrollTo(log, log.scrollHeight)

    const rows = rowsIn(log)
    expect(rows.at(-1)!.classList.contains('folded')).toBe(false)
    expect(rows.at(-1)!.dataset.ordinal).toBe(String(WINDOW_MAX_EVENTS - 1))
    // `toMatch`, not `not.toBe('')`: an optional-chained miss is `undefined`, and `undefined` is
    // not `''`. `toMatch` throws on it, which is what makes this an assertion about the clock.
    expect(rows.at(-1)!.querySelector('.rts')?.textContent).toMatch(/\d/)
  })

  /**
   * ⛔ **The stylesheet's own answer is already right, and that is worth a pixel of the mount.**
   *
   * `.raw-event.folded` is sized from `--row-px`, declared in the same block as a `calc()` over the
   * tokens the drawn row is built from. When that agrees with what the engine measures — the
   * ordinary case — `measureRow` writes nothing, and the list is spared a second full layout of
   * five thousand rows (~25 ms, measured). A `calc()` that drifted from the row would be corrected
   * at runtime and would cost that every time the tab is opened, silently.
   */
  it('⛔ the token arithmetic matches the engine, so nothing has to be written back', () => {
    const log = open(FULL)
    expect(log.style.getPropertyValue('--row-px')).toBe('')
  })

  it('⚑ …and when it does NOT match, the measured value is written back', () => {
    // The paired positive: `measureRow`'s write is reachable, so the assertion above is about the
    // arithmetic being right rather than about a branch that can never fire.
    const style = document.createElement('style')
    style.textContent = '.raw-event.folded { height: 99px !important; }'
    document.head.append(style)
    try {
      const log = open(FULL)
      expect(log.style.getPropertyValue('--row-px')).not.toBe('')
    } finally {
      style.remove()
    }
  })

  /**
   * 🔴 **526 · and it is written back WITH ITS FRACTION, which is the half that stopped being
   * measurable.**
   *
   * ⛔ **`526` made the row 33 px — a whole number — and that quietly disarmed `255 M5`.** That
   * row swaps `getBoundingClientRect().height` for `offsetHeight`, and `offsetHeight` is an
   * integer: at 35.5 px it rounded to 36 and the scrollbar test caught 2,466 px of accumulated
   * lie, but at 33 px the two readings AGREE and the mutation became a no-op. ⚠️ *A comparison
   * tested where both sides agree measures nothing* — three of `341`'s rows survived for exactly
   * this reason, and standing rule 3 asks for the reading where the two DIVERGE.
   *
   * ⚑ **So the divergence is planted rather than waited for.** A drawn row with fractional block
   * padding is the one state in which the two calls answer differently, and the assertion is that
   * the written-back value KEEPS the fraction. ⛔ Under `M5` it comes back whole and this reddens.
   *
   * ⚠️ **The shipped row being whole is a property of four token values and one padding step**, so
   * this is not a hypothetical the code has outgrown — it is the case the next edit to any of them
   * walks back into, with `measureRow`'s 0.25 px tolerance too loose to notice.
   */
  it('🔴 a fractional row keeps its fraction — the reading where the two calls DIVERGE', () => {
    const style = document.createElement('style')
    // ⚑ The DRAWN row only: the folded one keeps `--row-px`'s whole 33, so the two disagree by
    // half a pixel and `measureRow` has something to correct.
    style.textContent = '.raw-event:not(.folded) { padding-block: 4.25px !important; }'
    document.head.append(style)
    try {
      const log = open(FULL)
      const drawn = log.querySelector<HTMLElement>('.raw-event:not(.folded)')!
      const measured = drawn.getBoundingClientRect().height

      // The premise: this really is a fractional row, or the assertion below is about nothing.
      expect(measured % 1, `the planted row came out whole at ${measured}px`).not.toBe(0)

      const written = log.style.getPropertyValue('--row-px')
      expect(written, 'nothing was written back at all').not.toBe('')
      expect(Number.parseFloat(written)).toBe(measured)
      // ⛔ The claim, stated as the thing an integer read cannot satisfy.
      expect(
        Number.parseFloat(written) % 1,
        `--row-px came back whole (${written}) — the row height was rounded`,
      ).not.toBe(0)
    } finally {
      style.remove()
    }
  })

  /**
   * ⛔ **The band moves rarely, and that is the difference between one 10 ms patch per ~1,584 px
   * and one per frame.** (⚑ 526 · `48 × 33`; it read ~1,700 while the row was 35.5.) Vue re-runs the `v-for` over all five thousand rows whenever `first`/`last`
   * change, so a `syncSlice` without hysteresis would re-render the whole window on every scroll
   * event — which is a scroll that stutters instead of an open that freezes.
   */
  it('⛔ a small scroll inside the drawn band re-slices nothing', async () => {
    const log = open(FULL)
    const rowPx = rowsIn(log)[0]!.getBoundingClientRect().height
    await scrollTo(log, Math.round(rowPx * 1_000))

    const before = {
      drawn: log.dataset.drawn,
      firstDrawn: rowsIn(log).find((li) => !li.classList.contains('folded'))!.dataset.ordinal,
    }
    // Two whole rows further down — enough to move the viewport, nowhere near the overscan.
    await scrollTo(log, Math.round(rowPx * 1_002))

    expect(log.dataset.drawn).toBe(before.drawn)
    expect(rowsIn(log).find((li) => !li.classList.contains('folded'))!.dataset.ordinal).toBe(
      before.firstDrawn,
    )

    // ⚑ …and the band DOES move when the viewport leaves it, or the assertion above would be
    // satisfied by a component that had stopped slicing altogether.
    await scrollTo(log, Math.round(rowPx * 1_200))
    expect(rowsIn(log).find((li) => !li.classList.contains('folded'))!.dataset.ordinal).not.toBe(
      before.firstDrawn,
    )
  })

  it('⚑ the reader’s position survives the re-slice it causes', async () => {
    const log = open(FULL)
    const rowPx = rowsIn(log)[0]!.getBoundingClientRect().height
    const target = Math.round(rowPx * 1_200)

    await scrollTo(log, target)
    const settled = log.scrollTop
    await nextTick()
    await nextTick()

    // ⛔ 230 named an off-tail state and 255 §2 forbids making it worse. Re-rendering a hundred rows
    // under a reader who has scrolled back must not move them.
    expect(log.scrollTop).toBe(settled)
    expect(Math.abs(settled - target)).toBeLessThan(1)
  })
})

describe('what the fold does not touch (255 §2)', () => {
  it('⚑ a followed list still goes to its newest row', async () => {
    const entries = ref(corpus(300))
    const Live = defineComponent({
      setup: () => () =>
        h(EventStream as never, { window: { ...createWindow(), entries: entries.value } }),
    })
    const m = mount(Live, {}, { width: 900, height: 700 })
    const log = m.q('event-log')

    await scrollTo(log, log.scrollHeight)
    entries.value = corpus(301)
    await nextTick()
    await nextTick()
    await nextTick()

    const rows = rowsIn(log)
    expect(rows).toHaveLength(301)
    // Pinned to the newest line, and that line is DRAWN — a followed list that scrolled to a folded
    // row would show a stream that had gone blank.
    expect(log.scrollHeight - log.scrollTop - log.clientHeight).toBeLessThan(2)
    expect(rows.at(-1)!.classList.contains('folded')).toBe(false)
    expect(rows.at(-1)!.dataset.ordinal).toBe('300')
    // ⚑ Decorated, not merely present: the arriving row has its type chip and its detail, both read
    // back off the shared describer rather than off a literal this test also chose.
    expect(rows.at(-1)!.querySelector('.rtype')?.textContent).toBe(eventFor(300).type)
    expect(rows.at(-1)!.querySelector('.rdetail')?.textContent).toBe(describeEvent(eventFor(300)))
  })

  /**
   * ⛔ **A reader who has scrolled up is not followed** — `useStickToBottom`'s whole contract, and
   * `255` §2's *"do not make the off-tail state worse"*. The fold routes `scroll` through its own
   * handler now, so the release of the follow is one function call away from being dropped.
   */
  it('⛔ …but a reader who has scrolled UP is left where they are', async () => {
    const entries = ref(corpus(300))
    const Live = defineComponent({
      setup: () => () =>
        h(EventStream as never, { window: { ...createWindow(), entries: entries.value } }),
    })
    const m = mount(Live, {}, { width: 900, height: 700 })
    const log = m.q('event-log')

    await scrollTo(log, log.scrollHeight)
    await scrollTo(log, Math.round(log.scrollHeight / 3))
    const parked = log.scrollTop
    expect(parked).toBeGreaterThan(0)

    entries.value = corpus(340)
    await nextTick()
    await nextTick()
    await nextTick()

    expect(rowsIn(log)).toHaveLength(340)
    expect(log.scrollTop).toBe(parked)
  })

  it('⚠️ off the tail, the tab still says exactly what 237 made it say', () => {
    const log = open(FULL, { atTail: false, behind: 12, from: 1_251, hasOlder: true })

    expect(log.dataset.whole).toBe('false')
    expect(log.dataset.atTail).toBe('false')
    expect(log.dataset.behind).toBe('12')
    expect(log.dataset.from).toBe('1251')
    // ⛔ …and the fold has not cost the completeness read its subject: every row is still countable.
    expect(rowsIn(log)).toHaveLength(WINDOW_MAX_EVENTS)
  })

  it('⚠️ an empty window draws its one sentence and claims no rows', () => {
    const log = open([])
    expect(rowsIn(log)).toHaveLength(0)
    expect(log.dataset.drawn).toBe('0')
    expect(log.textContent).toContain('nothing yet')
  })
})
