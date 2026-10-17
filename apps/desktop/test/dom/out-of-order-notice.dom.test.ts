import { afterEach, describe, expect, it } from 'vitest'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import {
  NOT_REACHED_THIS_WINDOW,
  acceptEvent,
  createSessionRecord,
} from '../../src/renderer/src/lib/session-record'
import type { RuntimeEventMessage } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * 🔴 **320 §5 · what the two notices actually LOOK like, in a browser** — the half of the ruling a
 * pure-function test cannot reach.
 *
 * ⚑ **The brief calls this the only design judgement in the dispatch**, and the judgement rests on
 * three claims that are about pixels rather than strings: that both sentences survive the reading
 * view, that they are drawn at the same severity as each other, and that the severity is the app's
 * amber and not its red. ⛔ Every one of those is a `<style scoped>` fact, and every one of them
 * would have been an assertion about my own reading of CSS if it stopped at `session-record.ts`.
 *
 * ⚠️ **And one of the three is a correction to the brief.** §1 shows the notices as *"two red lines"*.
 * They are not red: a non-fatal `error` event folds to a notice at level `warn` (`transcript.ts`),
 * and `NoticeEntry.vue` paints `warn` with `--waiting`, the amber it uses for waiting-on-you. The
 * app was already saying "off" rather than "failed"; what it was not doing was saying which.
 */

afterEach(unmountAll)

const SESSION = 'sess_ooo_dom'
const at = (ordinal: number): number => 1_800_000_000_000 + ordinal * 1_000

const message = (ordinal: number, event: RuntimeEventMessage['event']): RuntimeEventMessage => ({
  sessionId: SESSION,
  ordinal,
  at: at(ordinal),
  event,
})

/** The conversation at the moment of F6: a note at 182 arriving ahead of the turn's ending at 181. */
function afterTheReorder() {
  const record = createSessionRecord(SESSION)
  acceptEvent(record, message(0, { type: 'assistant_message', text: 'the reply' }))
  acceptEvent(record, message(2, { type: 'memory_note', notes: [{ path: '/n.md', text: 'Bob' }] }))
  acceptEvent(record, message(1, { type: 'status', state: 'idle' }))
  return record
}

describe('320 · the two notices, drawn', () => {
  it('shows both in the READING view, and neither is filtered out of it', () => {
    // ⛔ **`normal`, not `debug`.** A notice at `info` is dropped by the reading view
    // (`transcript-mode.ts`), so demoting the out-of-order case to `info` would have been softening
    // it out of existence rather than softening its words — which is the repair 320 §5 refuses. This
    // is the assertion that would have caught me doing it.
    const view = mount(
      TranscriptView,
      { items: afterTheReorder().control.items, mode: 'normal' },
      { width: 900, height: 2000 },
    )

    const said = [...view.host.querySelectorAll<HTMLElement>('[data-cy^="notice-"]')].map((el) =>
      (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    )
    expect(said).toHaveLength(2)
    // ⚑ **623 · the words are a person's now** (`HO-095` §2) — the LEVELS and the count are what
    // this file is about, and neither moved.
    expect(said[0]).toContain(`1 event of this conversation has ${NOT_REACHED_THIS_WINDOW}`)
    // The later sentence explicitly retracts the earlier hole claim. Saying only “this event
    // is not lost, only late” beside the claim leaves the person to infer that both describe
    // the same event.
    expect(said[1]).toContain('The missing part of this conversation has reached this window')
    // ⚑ The clause that carries the ruling has to be ON SCREEN, not merely in the string: the row was
    // one ellipsised line, so a sentence long enough to be truncated was a sentence whose second half
    // did not exist for the reader. ⚠️ **Since `672` a warning wraps**, and
    // ⛔ **`the-event-that-did-not-arrive.dom.test.ts` holds all four sentences to ONE line** (a line
    // count); this keeps the clause that carries this file's own ruling.
    expect(said[1]).toContain('nothing is missing from what you are reading')
  })

  it('draws both at the same severity, and it is amber rather than red', () => {
    const view = mount(
      TranscriptView,
      { items: afterTheReorder().control.items, mode: 'normal' },
      { width: 900, height: 2000 },
    )

    // ⛔ **The same level for both, deliberately.** 320's ruling is that the two are equally worth
    // saying and differ in WHAT they say; a quieter class for the second would be the softening the
    // brief rules out, and a louder one would be the false alarm it started as.
    expect(view.all('notice-warn')).toHaveLength(2)
    expect(view.all('notice-error')).toHaveLength(0)

    // ⚠️ **Measured off the painted element, not off the token file.** `--waiting` is `#f2b865`;
    // reading it out of `tokens.css` would only prove the file says what I read.
    const dot = view.host.querySelector<HTMLElement>('[data-cy="notice-warn"] .dot')
    expect(dot, 'the notice has no dot').not.toBeNull()
    const painted = getComputedStyle(dot!).backgroundColor
    expect(painted).not.toBe('')
    const [red, green] = (painted.match(/\d+/g) ?? []).map(Number)
    // Amber, not red: a real green channel. `--danger` (#ff7f8d) has green 127 against red 255;
    // `--waiting` (#f2b865) has 184 against 242. The assertion is the RELATION, so it survives a
    // palette that is retuned without changing what the two colours mean.
    expect(green!).toBeGreaterThan(150)
    expect(red! - green!).toBeLessThan(100)
  })

  it('says nothing at all when the stream is in order', () => {
    // 193's pairing for the two positives above: the notices are produced by the disorder and not by
    // the act of rendering a memory note.
    const record = createSessionRecord(SESSION)
    acceptEvent(record, message(0, { type: 'assistant_message', text: 'the reply' }))
    acceptEvent(record, message(1, { type: 'status', state: 'idle' }))
    acceptEvent(
      record,
      message(2, { type: 'memory_note', notes: [{ path: '/n.md', text: 'Bob' }] }),
    )

    const view = mount(
      TranscriptView,
      { items: record.control.items, mode: 'normal' },
      { width: 900, height: 2000 },
    )
    expect(view.host.querySelectorAll('[data-cy^="notice-"]')).toHaveLength(0)
    // ⚑ …and the card the whole thing is about is still on screen, so the silence is the stream
    // being in order rather than an empty page.
    expect(view.all('memory-note').length).toBeGreaterThan(0)
  })
})
