import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
// ⚑ **A namespace import, on purpose.** A NAMED import of a constant `main` does not export fails
// this whole file at link time in a real engine — every ⚑ control with it, for a reason that is not
// a drawing. Through the namespace, `main` reads `undefined` and each 🔴 arm is red for what it
// draws.
import * as transcriptLib from '../../src/renderer/src/lib/transcript'
import { ASKED_TO_STOP, stoppedBy } from '../../src/shared/how-work-stopped'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { assertDrawn, drawnReady } from './drawn'
import { mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 725 · Draw 3 — R71, on a real screen: the app’s own ending, read where a person reads it
 *
 * ⚑ **The ruling, verbatim** (`709` F-1): *"a stop the app forces is recorded as the app's act
 * (`wordOf: 'this-app'`), never as the provider's."* ⚑ Drawn since `725` as the receipt plus
 * `THE_APPS_OWN_WORD` — *turn interrupted — this app’s word, not the provider’s*.
 *
 * | | 🔴 the subject | ⚑ the control, one fact over, on the same page |
 * |---|---|---|
 * | §1 | a pane holding a person's Stop whose ending this app wrote: the ask, then the receipt WITH the clause | the same three events with the ending unmarked: the ask, then *turn interrupted* exactly |
 * | §2 | the clause is DRAWN whole — a `warn` notice wraps (`672`), and the sensor says so at a wide and a narrow pane | — the sensor's own positive control is `drawn.ts`' (every entry point refuses without the font) |
 *
 * ⚠️ **Each pane is read by `textContent` of `[data-cy="what-the-notice-says"]`** and counted by
 * `[data-cy^="notice-"]` — the clause is in the notice's own text, so it is ONE notice, never a
 * second row a person could read as a second event. The node half — the host path over the Fake
 * runtime, the Events tab and the export — is `test/the-apps-own-ending-is-drawn.test.ts`.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent

const said = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

const noticesIn = (m: Mounted): string[] => m.all('what-the-notice-says').map((el) => said(el))

const countOfNotices = (m: Mounted): number =>
  m.host.querySelectorAll('[data-cy^="notice-"]').length

/** A person's Stop, as a Claude conversation records it: the ask, then the ending. */
const aStopped = (ending: Record<string, unknown>): TranscriptEvent[] => [
  ev({ type: 'user_turn', text: 'Refactor the parser, and keep the tests green.' }),
  ev({ type: 'work_interrupted', by: 'a-person' }),
  ev({ type: 'turn', state: 'interrupted', ...ending }),
]

async function aPane(
  events: TranscriptEvent[],
  sessionId: string,
  width: number,
): Promise<Mounted> {
  const m = mount(ConversationPane, paneProps({ record: record(events, sessionId) }), {
    width,
    height: 900,
  })
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    await nextTick()
  }
  return m
}

const ASK = `${ASKED_TO_STOP} by ${stoppedBy('a-person', null)}`

describe('§1 · R71 — the ending under a person’s Stop says it is this app’s word', () => {
  it('🔴 the marked ending draws the receipt AND the clause — and the unmarked one beside it does not', async () => {
    await page.viewport(1200, 900)
    const marked = await aPane(aStopped({ wordOf: 'this-app' }), 'sess_marked', 1000)
    const unmarked = await aPane(aStopped({}), 'sess_unmarked', 1000)

    expect(noticesIn(marked)).toEqual([
      ASK,
      `turn interrupted — ${transcriptLib.THE_APPS_OWN_WORD}`,
    ])
    // ⚑ One notice for the ending, never two: the clause is the receipt's own words.
    expect(countOfNotices(marked)).toBe(2)
    expect(marked.all('notice-warn')).toHaveLength(2)

    // ⚑ THE CONTROL, one fact over, on the same page: no mark, today's bytes exactly.
    expect(noticesIn(unmarked)).toEqual([ASK, 'turn interrupted'])
    expect(countOfNotices(unmarked)).toBe(2)
  })

  it('⚑ THE CONTROL alone — an unmarked ending draws the bare receipt and nothing about whose it is', async () => {
    await page.viewport(1200, 900)
    const m = await aPane(aStopped({}), 'sess_plain', 1000)
    expect(noticesIn(m)).toEqual([ASK, 'turn interrupted'])
    // ⛔ …and is not labelled the PROVIDER's either: an unmarked row is only the provider's word
    // from `720` on, so it gains nothing.
    for (const notice of noticesIn(m)) {
      expect(notice).not.toContain('provider’s')
      expect(notice).not.toContain('this app’s word')
    }
  })

  it('⚑ a cast foreign value on a replayed row draws nothing new', async () => {
    await page.viewport(1200, 900)
    const m = await aPane(aStopped({ wordOf: 'the-provider' }), 'sess_foreign', 1000)
    expect(noticesIn(m)).toEqual([ASK, 'turn interrupted'])
  })
})

describe('§2 · R71 — the clause is DRAWN, not only held', () => {
  for (const width of [1000, 520]) {
    it(`🔴 at a ${String(width)} px pane the marked receipt is on screen and drawn whole`, async () => {
      await page.viewport(1200, 900)
      const m = await aPane(aStopped({ wordOf: 'this-app' }), `sess_w${String(width)}`, width)
      const receipt = m.all('what-the-notice-says').at(-1)
      expect(receipt, 'the ending drew no notice').toBeDefined()
      expect(said(receipt)).toBe(`turn interrupted — ${transcriptLib.THE_APPS_OWN_WORD}`)
      expect(visible(receipt!)).toBe(true)
      await drawnReady()
      assertDrawn(receipt!, `the marked receipt at a ${String(width)} px pane`, m.host)
    })
  }
})
