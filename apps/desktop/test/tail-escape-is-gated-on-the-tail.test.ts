import type { TranscriptEvent } from '../src/shared/conversation-events'
import { describe, expect, it } from 'vitest'
import {
  appendLive,
  createWindow,
  openAt,
  prependPage,
  WINDOW_MAX_EVENTS,
  WINDOW_RELEASE_CHUNK,
} from '../src/renderer/src/lib/transcript-window'
import {
  HISTORY_WINDOW_MAX_EVENTS,
  type HistoryWindow,
  type RuntimeEventMessage,
} from '../src/shared/runtime-ipc'

/**
 * # 🔴 Eleven hours you cannot scroll to (313 — friction log F3)
 *
 * ## The defect, in one sentence
 *
 * `TranscriptView` rendered the only way back to the tail under `v-if="props.behind > 0"`, and
 * `behind` counts **live events that arrived while you were reading back**. On an idle session
 * nothing ever arrives, so it stays 0 for ever — and a window that had let go of the end had no
 * control, no hint, and no way back. ⛔ The store never agreed with the view: `session-store`'s own
 * `jumpToLatest` has always returned early on `record.window.atTail`, never on `behind`, and
 * `transcript-window.ts` says the split out loud — *"`session-store.jumpToLatest` is that escape,
 * and `behind` is what tells the reader to take it."* **The nudge had been wired as the gate.**
 *
 * ## What this file is, and why it is not the dom test
 *
 * Two rules, both about the same sentence, neither of which needs a browser:
 *
 *  Reach the non-tail state through one gesture using the real `openAt`, `appendLive`, and
 *  `prependPage` functions and measured counts, rather than hand-setting `atTail: false`.
 *  Derive every escape-offering caller from `.vue` sources and require it to pass the gating
 *  fact, so future transcript surfaces join the census automatically.
 *
 * The gesture itself — the button rendering, its label, the click, the scroll — is
 * `test/dom/eleven-hours.dom.test.ts`, in real Chromium, because the defect is that an element was
 * absent and only a real render can answer that honestly (`193`).
 */

const AT = 1_700_000_000_000

const event = (ordinal: number): TranscriptEvent =>
  ({ type: 'assistant_message', text: `line ${ordinal}` }) as TranscriptEvent

const persisted = (from: number, count: number): HistoryWindow['entries'] =>
  Array.from({ length: count }, (_, index) => ({
    ordinal: from + index,
    at: AT + from + index,
    event: event(from + index),
  }))

const live = (from: number, count: number): RuntimeEventMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    sessionId: 'sess_1',
    ordinal: from + index,
    at: AT + from + index,
    event: event(from + index),
  })) as RuntimeEventMessage[]

const page = (from: number, count: number, rest: Partial<HistoryWindow> = {}): HistoryWindow => ({
  entries: persisted(from, count),
  from,
  hasOlder: from > 0,
  turnAligned: true,
  ...rest,
})

/**
 * Replay a measured session shape with 5,015 events, ordinals 0…5014, and 13 turns.
 *
 * Read from his ledger with a read-only `sqlite3` snapshot while his app was closed, and every
 * number here is one of his:
 *
 * | | |
 * |---|---|
 * | `session/resumed` | ordinal **4083**, 23:37:15 — the reopen really happened |
 * | reopen page | the host's NEWEST 2,500 (`turnWindow` defaults `before` to `max(ordinal)+1`) |
 * | live after it | ordinals 4084…5014 — turns 7 to 12, up to 23:55:13 |
 * | one gesture back | the 1,584 events below the page, which is all that remained |
 *
 * ⛔ **The reopen did NOT load the oldest page.** `openAt` sets `atTail = true` over a page the host
 * windows backwards from the end; the stranding is entirely on the way back.
 */
function aPersonSession(): { window: ReturnType<typeof createWindow>; released: number } {
  const window = createWindow()
  // 23:37:15 — `session/resumed`. `ResumedSession.history` is `historyWindow(id, {})`, the newest
  // page, so this opens at ordinals 1584…4083 with `atTail` true.
  openAt(window, page(1584, HISTORY_WINDOW_MAX_EVENTS, { hasOlder: true }), 'sess_1')
  // 23:37 → 23:55 — turns 7 to 12 stream in and are folded, because the window holds the tail.
  for (const message of live(4084, 931)) appendLive(window, message)
  // ONE backward gesture. There are only 1,584 events below the page, so this is also the last one.
  const { released } = prependPage(window, page(0, 1584, { hasOlder: false }), 'sess_1')
  return { window, released }
}

describe('the state a reader gets stranded in (313 §3.3)', () => {
  it('🔴 one gesture takes the window off the tail, and `behind` never moves', () => {
    const { window, released } = aPersonSession()

    // ⛔ The retained slab is `max(page, WINDOW_MAX_EVENTS − WINDOW_RELEASE_CHUNK)` from the OLDEST
    // end — 3,750 events, ordinals 0…3749. That is the window he was looking at.
    expect(window.entries.length).toBe(WINDOW_MAX_EVENTS - WINDOW_RELEASE_CHUNK)
    expect(window.from).toBe(0)
    expect(window.entries.at(-1)?.ordinal).toBe(3749)
    // …and 1,265 events — turns 5 to 12, 23:29 to 23:55 — went out of the window in one patch.
    expect(released).toBe(1_265)

    // 🔴 THE DEFECT. Both are true at once, and the affordance used to read the second one.
    expect(window.atTail).toBe(false)
    expect(window.behind).toBe(0)

    // ⛔ **And the other edge went dark in the same patch.** `hasOlder` comes from the page, the page
    // reached ordinal 0, so *Load earlier messages* is correctly hidden — leaving a window with no
    // control at either end. That is why the bar is not a nicety.
    expect(window.hasOlder).toBe(false)
  })

  it('⚑ …and it is the FIRST gesture, because live events had already grown the window', () => {
    // The control (106): a window that only ever held the host's page does NOT strand on one
    // prepend — 2,500 + 1,584 is under the 5,000 cap, nothing is released, `atTail` stays true.
    // It is the 931 live events between the reopen and 23:55 that push the union over it. Without
    // this, the assertion above would read as "paging back strands you", which is not what happened.
    const quiet = createWindow()
    openAt(quiet, page(1584, HISTORY_WINDOW_MAX_EVENTS, { hasOlder: true }), 'sess_1')
    const { released } = prependPage(quiet, page(0, 1584, { hasOlder: false }), 'sess_1')
    expect(released).toBe(0)
    expect(quiet.atTail).toBe(true)
    expect(quiet.entries.length).toBe(HISTORY_WINDOW_MAX_EVENTS + 1584)
  })
})
