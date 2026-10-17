import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { page } from 'vitest/browser'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { WorkReport } from '../../src/shared/tasks'
import type { ResourceReading, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'
import { drawnReady, inkRects, notDrawn, describeClip } from './drawn'
import { READ_THE_DOCUMENT_NAMED } from '../../src/renderer/src/lib/the-documents-a-reply-names'

/**
 * 🔴 **562 · a press that opens the document it names, on a real screen.**
 *
 * Conversation resources are visible, and transcript links open the named document.
 *
 * ## ⛔ Why this is a DOM file
 *
 * ⚠️ **A press is the point**, and SSR can see that markup exists but cannot click it. ⛔ **And so
 * is the fact that it is a WORD**: the control sits inside a sentence, and *does turning a
 * 40-character id into a control re-wrap the line it is in* is a question only a real stylesheet
 * and a real box can answer — which is `562` §4.3, asked with `531`'s sensor.
 *
 * ## ⚠️ The viewport is shared across this whole directory
 *
 * Captured before the first resize and restored after every test.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

/** ⚑ The id the app actually mints, in the shape `newResourceId` writes it (D-016: `res_<32 hex>`). */
const REAL = 'res_4d2c3b1a5e6f4a7b8c9d0e1f2a3b4c5d'
/** ⛔ Well formed, same shape, and no work report in this transcript ever carried it. */
const WISHED_FOR = 'res_999999995e6f4a7b8c9d0e1f2a3b4c5d'

const report = (over: Partial<WorkReport> = {}): WorkReport => ({
  piece: 'work_1',
  label: 'W1.4',
  owner: 'sess_worker',
  state: 'answered',
  outcome: 'done',
  ...over,
})

/**
 * ⛔ **The row that HANDS this transcript a file** — the parent's own ledger event, with the
 * field `510` put on it (`resources` since D-016) and the sentence `reply-rails.ts` composes
 * beside it.
 */
const handed = (resourceId: string): TranscriptEvent =>
  ({
    type: 'user_turn',
    attribution: 'app_authored',
    text: `W1.4 (work_1) was answered by sess_worker: done.\n\nIts resources: ${resourceId} (answer.md). Read one with read_document.`,
    work: report({ resources: [resourceId] }),
  }) as TranscriptEvent

/** What the agent then SAYS about it — model-authored prose, rendered as Markdown. */
const said = (text: string): TranscriptEvent => ({ type: 'assistant_message', text }) as never

/**
 * ⚑ **The door, ECHOING the id it was asked for** — `readResource`'s own contract: *"the id the row
 * named, echoed so the panel and the press cannot disagree about which"*. ⛔ A fake that answered
 * with a fixed id would be green over a press that sent the wrong one.
 */
const OPENS = async (resourceId: string): Promise<ResourceReading> => ({
  ok: true,
  form: 'markdown',
  resourceId,
  name: `${resourceId.slice(4, 8)}-response.md`,
  text: '# The answer\n\nIt is 42.',
  bytes: 24,
})

async function pane(
  events: TranscriptEvent[],
  over: Record<string, unknown> = {},
  box: { width: number; height: number } = { width: 1200, height: 808 },
): Promise<Mounted> {
  await page.viewport(box.width, box.height)
  const m = mount(
    ConversationPane,
    paneProps({ record: record(events), onReadResource: OPENS, ...over }),
    box,
  )
  await drawnReady()
  return m
}

/** ⚑ The paragraph the assistant's markdown was laid into — the box a wrap question is about. */
const paragraphOf = (m: Mounted): HTMLElement => {
  const p = m.q('assistant-markdown').querySelector('p')
  expect(p, 'the reply rendered no paragraph').not.toBeNull()
  return p as HTMLElement
}

/**
 * 🔴 **The wrap, as the engine laid it** — where each line of ink STARTS and ENDS, measured from
 * the paragraph's own left edge so two separate mounts can be compared without comparing page
 * coordinates.
 *
 * ## ⛔ Why not `lineCount`, and this was measured rather than assumed
 *
 * ⚠️ **A `<button>` contributes a rect of its own, one pixel above the text's.** Its inline box is
 * 18 px against the text's 14, so `lineCount` — distinct rounded tops — answered **2** for a
 * paragraph the engine laid on ONE line, and **3** for one it laid on two. ⛔ That is the sensor's
 * own stated limit (*"a superscript or a smaller sibling shifts a rect by a fraction"*) arriving
 * at a 1 px shift that rounding keeps apart, and an assertion built on it would have called a
 * correct layout a regression.
 *
 * ⚑ **So the rects are filtered to the MODAL height — the text's own line boxes — and no
 * tolerance is invented.** ⛔ Runs on one line are then merged to that line's extent, because the
 * control SPLITS a run that was one rect before it existed: `0→670` becomes `0→292`, `292→418`,
 * `418→670`, which is the same ink and a different segmentation. ⚠️ Comparing the segmentation
 * would have failed on a paragraph nothing moved in.
 */
const inkLinesOf = (el: HTMLElement): { y: number; from: number; to: number }[] => {
  const box = el.getBoundingClientRect()
  const rects = inkRects(el)
  const tally = new Map<number, number>()
  for (const r of rects) {
    const h = Math.round(r.height)
    tally.set(h, (tally.get(h) ?? 0) + 1)
  }
  const modal = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0]
  expect(modal, 'the paragraph laid no ink at all').not.toBeUndefined()
  const byLine = new Map<number, { from: number; to: number }>()
  for (const r of rects) {
    if (Math.round(r.height) !== modal) continue
    const y = Math.round(r.top - box.top)
    const from = Math.round(r.left - box.left)
    const to = Math.round(r.right - box.left)
    const seen = byLine.get(y)
    byLine.set(
      y,
      seen === undefined
        ? { from, to }
        : { from: Math.min(seen.from, from), to: Math.max(seen.to, to) },
    )
  }
  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([y, extent]) => ({ y, from: extent.from, to: extent.to }))
}

describe('562 · a press that opens the document it names', () => {
  beforeAll(() => {
    expect(ORIGINAL.width).toBeGreaterThan(0)
  })

  afterEach(async () => {
    unmountAll()
    await page.viewport(ORIGINAL.width, ORIGINAL.height)
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the control, and what pressing it does
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · an id this transcript was handed becomes a press', () => {
    it('🔴 the headline: the id in a reply is a control, and pressing it opens the document', async () => {
      const m = await pane([handed(REAL), said(`I have written it up in ${REAL} for you.`)])

      const press = m.q('open-the-document')
      expect(press.getAttribute('data-document')).toBe(REAL)
      expect(press.textContent).toBe(REAL)
      expect(press.getAttribute('title')).toBe(READ_THE_DOCUMENT_NAMED)
      expect(visible(press)).toBe(true)

      expect(m.all('canonical-document-viewer')).toHaveLength(0)
      press.click()
      await nextTick()
      await nextTick()
      const viewer = m.q('canonical-document-viewer')
      expect(visible(viewer)).toBe(true)
      // ⛔ **The id the panel echoes is the one the PRESS sent**, because the fake door echoes what
      // it was asked for — a fixture that answered with a constant would pass over a press that
      // carried the wrong string.
      expect(m.q('canonical-document-id').textContent).toContain(REAL)
      expect(m.q('canonical-document-name').textContent?.trim()).toBe('4d2c-response.md')
      // ⛔ **The conversation is still underneath** — the panel is an overlay inside the pane and
      // the reply that named the document has not moved.
      expect(m.q('assistant-markdown').textContent).toContain(REAL)
    })

    it('⛔ the id inside a code span is a control too, and keeps the code chip it had', async () => {
      const m = await pane([handed(REAL), said(`It is in \`${REAL}\`, have a look.`)])
      const press = m.q('open-the-document')
      expect(press.closest('code'), 'the control left its code span').not.toBeNull()
      expect(press.textContent).toBe(REAL)
      // ⚑ The chip is the `<code>`'s and the underline is the control's — both are drawn.
      expect(getComputedStyle(press).textDecorationLine).toContain('underline')
      expect(getComputedStyle(press.closest('code') as HTMLElement).fontFamily).not.toBe('')
    })

    it('⚠️ clicking the words around it does nothing, and the delegation is live', async () => {
      const m = await pane([handed(REAL), said(`I have written it up in ${REAL} for you.`)])
      m.q('assistant-markdown').click()
      await nextTick()
      expect(m.all('canonical-document-viewer')).toHaveLength(0)
      // ⚑ **Paired positive**: the same mount opens when the press itself is clicked, so the
      // absence above is about WHERE the click landed.
      m.q('open-the-document').click()
      await nextTick()
      await nextTick()
      expect(m.all('canonical-document-viewer')).toHaveLength(1)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what a reply cannot conjure
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the affordance is derived, and a model cannot write one', () => {
    it('🔴 a well-formed id this transcript was never handed stays plain text', async () => {
      const m = await pane([
        handed(REAL),
        said(`The answer is in ${REAL}; I will put the next one in ${WISHED_FOR}.`),
      ])
      // 🔴 **Both ids in one sentence, one roster, one control.** ⛔ The shape is identical and
      // only the roster tells them apart, which is the middle case of the three.
      expect(m.all('open-the-document')).toHaveLength(1)
      expect(m.q('open-the-document').getAttribute('data-document')).toBe(REAL)
      expect(m.q('assistant-markdown').textContent).toContain(WISHED_FOR)
    })

    it('⛔ a reply that names one with NO report behind it draws nothing at all', async () => {
      const m = await pane([said(`I have written it up in ${REAL} for you.`)])
      expect(m.all('open-the-document')).toHaveLength(0)
      expect(m.q('assistant-markdown').textContent).toContain(REAL)
      // ⚑ **Paired positive, one event over**: the identical reply with the report that hands the
      // id over does draw one.
      const other = await pane([handed(REAL), said(`I have written it up in ${REAL} for you.`)])
      expect(other.all('open-the-document')).toHaveLength(1)
    })

    it('⚑ an id quoted first and then named in the prose after it are BOTH controls', async () => {
      // ⛔ **The two patterns are two `RegExp` objects on purpose.** Both are stepped with `exec`,
      // so one shared instance would carry its `lastIndex` out of the code span and miss every
      // occurrence after it — measured here rather than argued, because the failure is silent.
      const m = await pane([
        handed(REAL),
        said(`It is in \`${REAL}\`. Read ${REAL} when you have a moment.`),
      ])
      const found = m.all('open-the-document')
      expect(found).toHaveLength(2)
      expect(found[0]?.closest('code'), 'the first is not in a code span').not.toBeNull()
      expect(found[1]?.closest('code'), 'the second is in a code span').toBeNull()
    })

    it('⚠️ markup a reply writes is still text, which is the invariant this sits on top of', async () => {
      const m = await pane([
        handed(REAL),
        said(`<button data-cy="open-the-document" data-document="${REAL}">fake</button>`),
      ])
      // ⛔ `renderChatMarkdown` runs with `html: false`, so the reply's own markup is escaped and
      // the only control is the one this app made out of the escaped text.
      const found = m.all('open-the-document')
      expect(found).toHaveLength(1)
      expect(found[0]?.textContent).toBe(REAL)
      expect(m.q('assistant-markdown').textContent).toContain('<button')
    })

    it('⛔ a surface with no reader behind it draws no control, and the words are still there', async () => {
      const m = await pane([handed(REAL), said(`I have written it up in ${REAL} for you.`)], {
        onReadResource: undefined,
      })
      expect(m.all('open-the-document')).toHaveLength(0)
      // ⛔ The row's own press is gone for the same reason — ONE decision about when.
      expect(m.all('work-report-document')).toHaveLength(0)
      expect(m.q('assistant-markdown').textContent).toContain(REAL)
    })

    it('🔴 a streaming block draws no control, because it is still being written', async () => {
      const m = await pane([
        handed(REAL),
        { type: 'assistant_delta', text: `I have written it up in ${REAL}` } as never,
      ])
      expect(m.all('open-the-document')).toHaveLength(0)
      expect(m.q('assistant-message').textContent).toContain(REAL)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §3 · §4.3 · measured ink — does the control move the line it is in
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the ink, with the roster and without it', () => {
    /**
     * ⛔ **The same sentence, twice, differing only in whether the transcript was handed the id.**
     * ⚑ `562` §4.3: *"A `doc:` id is 30+ characters inside a transcript line; if turning it into a
     * control changes how the line wraps, show it."*
     */
    const SENTENCE = `I have written the whole thing up and the answer is in ${REAL} with the numbers and the derivation beside it.`

    interface Laid {
      readonly lines: { y: number; from: number; to: number }[]
      readonly height: number
      /** ⚑ Kept so a reading can say what the sensor saw, not only that two readings agreed. */
      readonly rects: number
    }

    const laid = async (width: number, roster: boolean): Promise<Laid> => {
      const events = roster ? [handed(REAL), said(SENTENCE)] : [said(SENTENCE)]
      const m = await pane(events, {}, { width, height: 808 })
      expect(m.all('open-the-document')).toHaveLength(roster ? 1 : 0)
      const p = paragraphOf(m)
      expect(p.textContent, 'the id is not in the sentence').toContain(REAL)
      const out: Laid = {
        lines: inkLinesOf(p),
        height: Math.round(p.getBoundingClientRect().height),
        rects: inkRects(p).length,
      }
      m.unmount()
      return out
    }

    // At 14px `--text-reading`, `--measure-message` caps the column so this sentence spans
    // two lines at both widths. The first line ends at 681px and 628px respectively,
    // producing distinct wraps for testing whether the control moves.
    for (const [width, expected] of [
      [1200, 2],
      [760, 2],
    ] as const) {
      it(`🔴 ${String(width)}px · every line of ink starts and ends where it did without the control`, async (ctx) => {
        // ⚠️ **darwin only** (T-001): it measures where the Mac's fonts break a line; Linux draws other fonts.
        // CI runs on Linux and skips it; the Mac's own gate runs it. (A browser has no `process`.)
        ctx.skip(!/mac/i.test(navigator.platform))
        const withRoster = await laid(width, true)
        const without = await laid(width, false)
        // ⚑ **The sensor saw what it was pointed at**: the control really did split a run, so
        // "they agree" is about the ink and not about two identical readings of nothing.
        expect(withRoster.rects).toBeGreaterThan(without.rects)
        expect(without.lines, 'the sentence did not lay the lines this width is for').toHaveLength(
          expected,
        )
        expect(JSON.stringify(withRoster.lines)).toBe(JSON.stringify(without.lines))
        expect(withRoster.height).toBe(without.height)
      })
    }

    it('⛔ …and the control is drawn WHOLE, at the app’s minimum width', async () => {
      // ⚠️ `530`'s class: `textContent` is identical whether the engine drew a string or clipped
      // it, and this is a 40-character token inside a measured column.
      const m = await pane([handed(REAL), said(SENTENCE)], {}, { width: 1180, height: 808 })
      const press = m.q('open-the-document')
      expect(notDrawn(press, m.host).map(describeClip), 'the id is cut').toEqual([])
      expect(press.textContent).toBe(REAL)
    })

    it('⚑ the control is a WORD, measured against a plain button in the same trap', async () => {
      // 🔴 **A PLANTED CONTROL, trapped the way the subject is** (`439`'s own correction). ⛔ An
      // assertion against the paragraph alone is true of any in-flow child; the comparison is the
      // DIFFERENCE between the two.
      const m = await pane([handed(REAL), said(`The answer is in ${REAL}.`)])
      const press = m.q('open-the-document')
      const paragraph = paragraphOf(m)
      const plain = document.createElement('button')
      plain.textContent = REAL
      paragraph.append(plain)
      const mine = getComputedStyle(press)
      const theirs = getComputedStyle(plain)

      expect(theirs.paddingLeft, 'the control really is padded').not.toBe('0px')
      expect(mine.paddingLeft).toBe('0px')
      expect(theirs.borderTopWidth, 'the control really has a border').not.toBe('0px')
      expect(mine.borderTopWidth).toBe('0px')
      expect(mine.backgroundColor).not.toBe(theirs.backgroundColor)
      // ⛔ **The affordance is the underline**, which is the one thing it has that prose does not.
      expect(mine.textDecorationLine).toContain('underline')
      // 🔴 **And it is `inline-block`, which is the ENGINE's and not ours** — a `<button>` cannot
      // be made `display: inline` here, measured at `562`. ⚑ It is recorded rather than asserted
      // as a property of this stylesheet, and §3 above is why it costs nothing.
      expect(mine.display).toBe('inline-block')
      expect(theirs.display).toBe('inline-block')
      plain.remove()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §4 · §3.3 · what a person sees when it is NOT pressable
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · a pressable id and one that is not, in the same sentence', () => {
    it('🔴 they do NOT look identical: the pressable one is underlined and the other is not', async () => {
      // ⛔ **`562` §3.3 asks whether `530`'s family arrives by design here.** ⚑ It does not, and
      // this is the measurement rather than the claim: both ids are in one paragraph, under one
      // cascade, and only one of them carries ink a person can see the difference in.
      const m = await pane([
        handed(REAL),
        said(`It is in ${REAL}, and I will put the next one in ${WISHED_FOR}.`),
      ])
      const press = m.q('open-the-document')
      expect(press.textContent).toBe(REAL)
      expect(getComputedStyle(press).textDecorationLine).toContain('underline')
      expect(getComputedStyle(press).cursor).toBe('pointer')

      // ⚑ **The unpressable id, read off the same paragraph**: it is a text node with no element
      // of its own, so the paragraph's own computed style is what a reader sees on it.
      const paragraph = paragraphOf(m)
      expect(paragraph.textContent).toContain(WISHED_FOR)
      expect(getComputedStyle(paragraph).textDecorationLine).toBe('none')
      expect(getComputedStyle(paragraph).cursor).not.toBe('pointer')
      // ⛔ **And nothing else in the paragraph is a control**, so the one underline belongs to the
      // one id the app can actually open.
      expect(paragraph.querySelectorAll('button')).toHaveLength(1)
    })

    it('⚠️ …and the difference is not colour alone, which a person may not be able to see', async () => {
      const m = await pane([handed(REAL), said(`It is in ${REAL}.`)])
      const press = m.q('open-the-document')
      const paragraph = paragraphOf(m)
      // ⛔ **`font: inherit` and `color: inherit`**: the control takes the sentence's own ink, so
      // the affordance is the underline and never a hue somebody has to distinguish.
      expect(getComputedStyle(press).color).toBe(getComputedStyle(paragraph).color)
      expect(getComputedStyle(press).fontSize).toBe(getComputedStyle(paragraph).fontSize)
    })
  })
})
