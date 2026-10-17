import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import {
  appendLive,
  createWindow,
  WINDOW_MAX_EVENTS,
  WINDOW_RELEASE_CHUNK,
  type WindowState,
} from '../../src/renderer/src/lib/transcript-window'
import type { RuntimeEventMessage, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * 263 §2 · **An event that arrives does not re-derive the five thousand already here.**
 *
 * ⛔ **This is the MECHANISM half of `259` lens C finding 2, and it has no clock in it.** The
 * numbers live in `event-append-scale.probe.ts` and deliberately outside `pnpm run ci`, for the
 * reason `vitest.probe.config.ts` states: a millisecond threshold in the gate is a report about the
 * machine that ran it. What the gate can hold is the thing the numbers were caused BY — that one
 * append derives one row — and that is an exact integer, on any machine, forever.
 *
 * ⚠️ **`255`'s coverage could not see this and that is the finding, not an oversight to gloss.**
 * Every 5,000-row case in `event-fold.dom.test.ts` is a STATIC mount; its two growth cases are 300
 * rows and ASSIGN A FRESH CORPUS over the prop, which builds 301 new message objects and would
 * re-derive 301 rows in any implementation. ⛔ **So the tests here use `appendLive` on a `reactive`
 * window** — `session-record.ts:399` on a `reactive(createSessionRecord(...))`, which is the only
 * path a live event actually takes.
 *
 * ⚑ **The describer is counted rather than timed.** It is the per-row work `rowFor` does, so
 * counting its calls answers *"was the window re-derived"* with an integer instead of a threshold.
 */

const AT = 1_700_000_000_000

/** Where a `tool_call` with a recognisable name sits, deep enough that no viewport reaches it. */
const DEEP_TOOL_AT = 3_331

/**
 * ⚠️ **Counted through the REAL describer, never replaced by one.** A stub returning a constant
 * would make every assertion below about a component wired to a fixture: the rows would still be
 * counted, and `ledgerRows` would still find text, and none of it would be this app's text. The
 * wrapper delegates, so the DOM this file reads is the DOM the app draws.
 */
const spy = vi.hoisted(() => ({ calls: 0 }))

vi.mock('../../src/renderer/src/lib/describe-event', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/src/lib/describe-event')>()
  return {
    describeEvent: (event: TranscriptEvent): string => {
      spy.calls += 1
      return real.describeEvent(event)
    },
  }
})

// ⚠️ Imported after the mock is declared, following `drawer-acknowledge.dom.test.ts`: `vi.mock` is
// hoisted so this is not a race, but the import is written below it so a reader need not know that.
const { default: EventStream } = await import('../../src/renderer/src/components/EventStream.vue')

/**
 * ⛔ **`importActual`, and the distinction is load-bearing.** Every expectation below that compares a
 * row's text to *"what the describer says"* must ask the UNMOCKED describer. Asking the wrapper
 * would compare the component's output to the wrapper's output — so a wrapper that stopped
 * delegating and returned a constant would satisfy both sides at once, and the whole file would be
 * asserting that two copies of a fixture agree.
 */
const { describeEvent: realDescribe } = await vi.importActual<
  typeof import('../../src/renderer/src/lib/describe-event')
>('../../src/renderer/src/lib/describe-event')

function eventFor(index: number): TranscriptEvent {
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

const messageAt = (index: number): RuntimeEventMessage => ({
  sessionId: 'sess_a',
  ordinal: index,
  at: AT + index * 37,
  event: eventFor(index),
})

const corpus = (n: number): RuntimeEventMessage[] =>
  Array.from({ length: n }, (_unused, index) => messageAt(index))

/**
 * ⛔ **A `reactive` window, because that is what the component is handed.** `session-store.ts:318`
 * wraps the whole record, so `record.window` is a deep reactive object and `appendLive` mutating its
 * `entries` is what makes the tab re-render. A plain object here would mount fine and never update,
 * and every assertion about an append would pass over nothing.
 */
function live(
  held: number,
  over: Partial<WindowState> = {},
): { win: WindowState; log: HTMLElement } {
  const win = reactive({ ...createWindow(), entries: corpus(held), ...over }) as WindowState
  const m = mount(EventStream, { window: win }, { width: 900, height: 700 })
  return { win, log: m.q('event-log') }
}

/** Three ticks: the patch, `useStickToBottom`'s own awaited tick, and the post-flush re-slice. */
async function settle(): Promise<void> {
  await nextTick()
  await nextTick()
  await nextTick()
}

const rowsIn = (log: Element): HTMLLIElement[] => [
  ...log.querySelectorAll<HTMLLIElement>('li[data-type]'),
]

/** How many times the describer ran since this was called. */
function counting(): () => number {
  const from = spy.calls
  return () => spy.calls - from
}

afterEach(() => {
  unmountAll()
})

describe('one event in, one row derived (263 §2)', () => {
  // ⚠️ One short of the cap, so this test is about the APPEND and nothing else — landing exactly on
  // `WINDOW_MAX_EVENTS` releases 1,251 in the same call, which is the case two tests down.
  it('⛔ appending to a nearly-full window derives exactly ONE row', async () => {
    const mounting = counting()
    const { win, log } = live(WINDOW_MAX_EVENTS - 1)
    // ⚑ **The paired positive** (193): the counter is wired to the component and the component
    // really does derive every row it is given. Without this, the assertion below would pass just as
    // happily against a describer nothing calls at all.
    expect(mounting()).toBe(WINDOW_MAX_EVENTS - 1)
    expect(rowsIn(log)).toHaveLength(WINDOW_MAX_EVENTS - 1)

    const appending = counting()
    appendLive(win, messageAt(WINDOW_MAX_EVENTS - 1))
    await settle()

    expect(appending()).toBe(1)
    expect(rowsIn(log)).toHaveLength(WINDOW_MAX_EVENTS)
  })

  it('⛔ …and so does the twentieth, on a window that never stops growing', async () => {
    const { win, log } = live(WINDOW_MAX_EVENTS - 20)
    const appending = counting()
    for (let i = 0; i < 20; i++) {
      appendLive(win, messageAt(WINDOW_MAX_EVENTS - 20 + i))
      await settle()
    }
    // ⛔ 20, not 20 × 5,000. This is the whole of `259` lens C finding 2 as an integer.
    expect(appending()).toBe(20)
    expect(rowsIn(log)).toHaveLength(WINDOW_MAX_EVENTS)
  })

  /**
   * ⚠️ **The release is the case a cache is most likely to get wrong**, because `appendLive` does
   * not push here — it REPLACES `window.entries` with a slice. A cache keyed on the array, or on an
   * index, would miss on all 3,749 survivors and re-derive the window at exactly the moment it is
   * already paying for a re-fold.
   */
  it('⛔ a release re-derives nothing — the survivors are the same events', async () => {
    const { win, log } = live(WINDOW_MAX_EVENTS)
    const releasing = counting()
    const outcome = appendLive(win, messageAt(WINDOW_MAX_EVENTS))
    await settle()

    expect(outcome.released).toBe(WINDOW_RELEASE_CHUNK + 1)
    expect(releasing()).toBe(1)
    expect(rowsIn(log)).toHaveLength(WINDOW_MAX_EVENTS - WINDOW_RELEASE_CHUNK)
    // The window now begins later in the ledger and says so — the fold did not eat the release.
    expect(log.dataset.from).toBe(String(WINDOW_RELEASE_CHUNK + 1))
  })

  /**
   * ⛔ **A cached row must still BE the row.** `093`'s `ledgerRows`, `235`'s erasure marker and
   * `ledgerReach` all read the `<li>` and its `.rdetail`; a cache that handed back a stale or shared
   * object would leave those instruments reading one event's text under another's `data-type`.
   */
  it('⚑ every row still carries its own describer answer after 40 appends', async () => {
    const { win, log } = live(WINDOW_MAX_EVENTS)
    for (let i = 0; i < 40; i++) appendLive(win, messageAt(WINDOW_MAX_EVENTS + i))
    await settle()

    const rows = rowsIn(log)
    const deep = rows.find((li) => li.dataset.ordinal === String(DEEP_TOOL_AT))
    expect(deep, 'the deep tool_call is no longer in the window').toBeTruthy()
    expect(deep!.dataset.type).toBe('tool_call')
    expect(deep!.querySelector('.rdetail')?.textContent).toBe(realDescribe(eventFor(DEEP_TOOL_AT)))

    // ⚑ Spot-checked across the whole window rather than at one row: a cache that returned the FIRST
    // row for everything would satisfy a single lookup and fail here.
    for (const ordinal of [1_260, 2_500, 3_800, 4_999, 5_020]) {
      const row = rows.find((li) => li.dataset.ordinal === String(ordinal))
      expect(row, `ordinal ${ordinal} is missing`).toBeTruthy()
      expect(row!.dataset.type).toBe(eventFor(ordinal).type)
      expect(row!.querySelector('.rdetail')?.textContent).toBe(realDescribe(eventFor(ordinal)))
    }
  })

  /**
   * ⛔ **The case `event-fold.dom.test.ts` could only fake.** Its followed-list test replaces the
   * whole entries array; this one appends the way the app does, and asserts the arriving row is
   * DECORATED — a followed stream whose newest line came in folded would look like one that stopped.
   */
  it('⚑ a followed list still lands on its newest row, decorated, through the real append', async () => {
    const { win, log } = live(400)
    log.scrollTop = log.scrollHeight
    await settle()

    appendLive(win, messageAt(400))
    await settle()

    const rows = rowsIn(log)
    expect(rows).toHaveLength(401)
    const newest = rows.at(-1)!
    expect(newest.dataset.ordinal).toBe('400')
    expect(newest.classList.contains('folded')).toBe(false)
    expect(newest.querySelector('.rtype')?.textContent).toBe(eventFor(400).type)
    expect(newest.querySelector('.rdetail')?.textContent).toBe(realDescribe(eventFor(400)))
    expect(log.scrollHeight - log.scrollTop - log.clientHeight).toBeLessThan(2)
  })

  /**
   * ⚠️ **The negative that keeps the one above honest.** If every row were drawn, the assertion that
   * the newest is decorated would say nothing at all — so the same mount is asserted to be folding.
   */
  it('⛔ …while the rows nobody is looking at stay folded', async () => {
    const { win, log } = live(400)
    log.scrollTop = log.scrollHeight
    appendLive(win, messageAt(400))
    await settle()

    const rows = rowsIn(log)
    const folded = rows.filter((li) => li.classList.contains('folded'))
    expect(folded.length).toBeGreaterThan(300)
    expect(Number(log.dataset.drawn)).toBeLessThan(200)
    // ⛔ Folded is not gone: the row still says what it is and still reads back its own detail.
    // ⚠️ **Compared to the describer's answer rather than `not.toBe('')`.** An ABSENT `.rdetail`
    // makes `?.textContent` `undefined`, which satisfies `not.toBe('')` — a fold that had stopped
    // emitting the detail would pass. That exact shape was found in `255`'s adversarial pass and
    // written again here; `toBe(realDescribe(…))` fails on the absence and on the wrong text alike.
    const ordinal = Number(folded[0]!.dataset.ordinal)
    expect(folded[0]!.dataset.type).toBe(eventFor(ordinal).type)
    expect(folded[0]!.querySelector('.rdetail')?.textContent).toBe(realDescribe(eventFor(ordinal)))
  })
})
