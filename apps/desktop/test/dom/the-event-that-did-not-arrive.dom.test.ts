import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import { acceptEvent, createSessionRecord } from '../../src/renderer/src/lib/session-record'
import type { RuntimeEventMessage } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'
import { assertClipped, assertDrawn, drawnReady, lineCount } from './drawn'

/**
 * 🔴 **623 · the sentence has to EXIST for the reader, and that is a measurement** (`HO-095` §2).
 *
 * ## ⛔ The trap this file is written against
 *
 * ⚠️ **`NoticeEntry.vue` drew a notice as ONE ellipsised row** — `white-space: nowrap`,
 * `overflow: hidden`, `text-overflow: ellipsis` — inside `--measure-message`, with two hairlines
 * either side taking what is left. ⛔ **So a sentence that was too long did not read as a long
 * sentence; it read as a short one that stops.** ⚑ **Since `672` a `warn` notice WRAPS** — which
 * is every sentence here — so a long one is drawn whole and the cut cannot happen; ⚠️ **what this
 * file now holds is the ONE-LINE budget itself**, as a line count (`lineCount`), because a sentence
 * past the measure would turn this hairline into a paragraph. 🔴 The PO's ruling is *"if it matters, say what it
 * means for them"*, and a reworded line whose second half is cut off fails that ruling exactly as
 * `expected 486, got 487` did — ⚑ better words, same defect.
 *
 * ## ⚑ Why it is measured and not read
 *
 * ⛔ **The first draft of this dispatch's sentence was 200 characters** and would have been cut at
 * roughly *"…is missing from what you are"*. ⚠️ Nothing in the node suite could see that: the string
 * is whole in `item.text` and whole in `textContent`, and the only place it is short is on the
 * screen — `530` F1's whole class.
 *
 * ## ⛔ Through `drawn.ts`, and not through a hand-rolled `scrollWidth`/`clientWidth` pair
 *
 * ⚠️ **The first version of this file rolled its own**, and `every-assertion-that-reads-clipped-text`
 * — the category census `531` left behind — went red on it within the gate. ⚑ **It was right to.**
 * The sensor separates three facts a bare pair conflates, and one of them bites here: `clientWidth`
 * is **0 on a non-replaced inline element**, and `.what` in `NoticeEntry.vue` IS a `<span>` — drawn
 * as a block only because it is a flex item, which is a property of its parent and not of itself.
 * ⛔ A measurement that would answer *not clipped* the day that flex parent changed is not the
 * measurement this file is for.
 */

afterEach(unmountAll)

const SESSION = 'sess_623_dom'

/** ⚠️ The reading measure is `--measure-message: 760px`; the box is wider so the token is the bound. */
const READING = { width: 900, height: 2000 }

/**
 * ⛔ **The PAGE has to be wider than the box, and the sensor is what taught me that** (`dom-project
 * -viewport-is-shared`). ⚠️ The dom runner's viewport is shared and narrower than `READING`, so the
 * mount host overflowed `<body>` — which is `overflow-x: hidden` — and `drawn.ts` correctly reported
 * every sentence cut at 210 px past the body. ⚑ A hand-rolled `scrollWidth`/`clientWidth` pair on the
 * row saw none of it, which is the second thing the shared sensor found that the pair could not.
 */
const widerThanTheBox = async (): Promise<void> => {
  await page.viewport(1_000, 760)
}

const message = (ordinal: number): RuntimeEventMessage => ({
  sessionId: SESSION,
  ordinal,
  at: 1_800_000_000_000 + ordinal * 1_000,
  event: { type: 'assistant_message', text: `reply ${ordinal}` },
})

/** A record fed a run of arrivals, so the notices are the fold's own and never hand-written. */
function after(...ordinals: readonly number[]) {
  const record = createSessionRecord(SESSION)
  for (const ordinal of ordinals) acceptEvent(record, message(ordinal))
  return record
}

/** Every notice row on screen, and the element the browser had to fit its sentence into. */
function rows(
  items: unknown[],
  mode: 'normal' | 'debug' = 'normal',
): { said: string; what: HTMLElement }[] {
  const view = mount(TranscriptView, { items, mode }, READING)
  return [...view.host.querySelectorAll<HTMLElement>('[data-cy^="notice-"] .what')].map((what) => ({
    said: (what.textContent ?? '').replace(/\s+/g, ' ').trim(),
    what,
  }))
}

describe('623 · every sentence this instrument can write fits on its row', () => {
  /**
   * 🔴 **All four arms, DERIVED from the fold rather than listed** — a hand-written list of
   * sentences is a guard that expires the day a fifth is added (rule 27.1).
   *
   * ⛔ **Each run below is a real arrival sequence** and the sentences are whatever the fold chose:
   * a hole opening, a hole narrowing, a hole closing, and an arrival that closed nothing.
   */
  const RUNS: readonly { what: string; ordinals: readonly number[] }[] = [
    { what: 'a hole opens, one event wide', ordinals: [0, 2] },
    { what: 'a hole opens three wide, then narrows', ordinals: [0, 4, 1] },
    { what: 'the last hole closes', ordinals: [0, 2, 1] },
    { what: 'a wide hole, counted rather than listed', ordinals: [0, 5_000] },
  ]

  it('🔴 every one of them is drawn whole, on ONE line at the reading measure', async () => {
    await widerThanTheBox()
    await drawnReady()
    const seen: string[] = []
    for (const run of RUNS) {
      for (const row of rows(after(...run.ordinals).control.items)) {
        seen.push(row.said)
        // ⛔ **The sensor, which names WHICH box did the cutting when one did** — a bare boolean
        // would leave the failure saying only that something, somewhere, was short.
        assertDrawn(row.what, `${run.what} — ${row.said}`)
        // 🔴 **672 · and on ONE line** — a warning wraps since `672`, so `assertDrawn` alone can no
        // longer fail on length (the review measured a 150-character pad staying green). ⚑ The
        // budget `session-record.ts` states is a line count now, and the control below makes it fire.
        expect(lineCount(row.what), `${run.what} — ${row.said}`).toBe(1)
      }
      unmountAll()
    }
    // ⚑ **The sweep really read something**, and more than one thing: four runs, and every arm of
    // the fold is among them.
    expect(seen.length).toBeGreaterThanOrEqual(6)
    expect(seen.some((said) => said.includes('not reached this window'))).toBe(true)
    expect(seen.some((said) => said.includes('still missing'))).toBe(true)
    expect(seen.some((said) => said.includes('nothing is missing'))).toBe(true)
  })

  it('⚑ …and the CONTROL: this measurement CAN see a sentence that is too long', async () => {
    await widerThanTheBox()
    await drawnReady()
    // ⛔ **Without it, *nothing was cut off* is satisfiable by a measurement that never fires** —
    // `a-negative-is-only-as-strong-as-the-search-shape`, and the exact reason `620`'s two checks
    // were dark. ⚠️ The planted string is the shape this dispatch's own first draft had.
    const tooLong =
      'Part of this conversation has not reached this window: 1 event is missing from what you ' +
      'are reading. It may still arrive — this will say so if it does. Reopening this ' +
      'conversation loads it again from the record.'
    const planted = (level: 'warn' | 'info') => ({
      kind: 'notice',
      id: `notice-${level}`,
      level,
      text: tooLong,
      at: 1_800_000_000_000,
    })
    // 🔴 **672 · a `warn` notice WRAPS now**, so this first draft is drawn whole — the repair that
    // made every warning's instruction readable (`NoticeEntry.vue`) — ⚑ **and the subject's
    // measurement FIRES on it at the subject's own level**: it takes more than one line, which is
    // what the line count above refuses.
    const [warned] = rows([planted('warn')])
    expect(warned?.said, 'the planted notice never rendered').toContain('Part of this conversation')
    assertDrawn(warned!.what, 'the 200-character first draft, as a warning')
    expect(lineCount(warned!.what), 'the first draft fits on one line after all').toBeGreaterThan(1)
    unmountAll()
    // ⚑ **The same sentence as an `info` notice is still a one-line hairline**, and the sensor
    // still sees it cut — on the x axis and by the row's own box — so `assertDrawn` above is a
    // sensor that CAN fire, at the level where cutting is still what happens.
    const [hairline] = rows([planted('info')], 'debug')
    expect(hairline?.said, 'the planted notice never rendered').toContain(
      'Part of this conversation',
    )
    const cut = assertClipped(hairline!.what, 'the 200-character first draft, as an info notice')
    expect(cut.axis).toBe('x')
  })
})

describe('623 · the severity did not move', () => {
  it('⛔ every arm is amber and in the READING view — §3.1 refuses the quieter repair', async () => {
    await widerThanTheBox()
    // ⚠️ **A notice at `info` is DROPPED by the reading view** (`transcript-mode.ts`), so demoting
    // this instrument would have softened it out of existence rather than softening its words —
    // which is what `320` §5 refused and what `HO-095` §2 explicitly does not ask for.
    const view = mount(
      TranscriptView,
      { items: after(0, 4, 1, 2, 3).control.items, mode: 'normal' },
      READING,
    )
    expect(view.all('notice-warn')).toHaveLength(4)
    expect(view.all('notice-error')).toHaveLength(0)
  })
})
