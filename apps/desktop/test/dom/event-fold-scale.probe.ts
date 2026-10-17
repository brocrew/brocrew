import { expect, it } from 'vitest'
import EventStream from '../../src/renderer/src/components/EventStream.vue'
import Baseline from './event-fold-baseline.vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import { clockTime } from '../../src/shared/clock'
import { describeEvent } from '../../src/renderer/src/lib/describe-event'
import { createWindow, WINDOW_MAX_EVENTS } from '../../src/renderer/src/lib/transcript-window'
import type { RuntimeEventMessage, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * 255 · **What the Events tab costs, before and after, on the same machine in the same run.**
 *
 * ⛔ **NOT part of `pnpm run ci`, deliberately.** A millisecond threshold in the gate is a report
 * about the machine that ran it, not a claim about the app — `175` and `212` are both about the
 * ways that goes wrong. What the gate holds is the MECHANISM (`event-fold.dom.test.ts`: the row
 * count, the fold, the engine's own `checkVisibility`, the scrollbar); this file holds the numbers
 * those mechanisms were chosen on, so nobody has to take them from a response document.
 *
 *     pnpm run probe:event-fold
 *
 * ⚑ **It FAILS on purpose**, with the numbers in the assertion message. Vitest hides `console` from
 * a passing file, and a probe whose whole job is to report is useless if its report is swallowed —
 * the same reason `vitest.smoke.config.ts` sets `disableConsoleIntercept`.
 *
 * ⚠️ **`212`'s method**: the app's own clock (`performance.now()` inside the page), in real
 * Chromium, with `document.visibilityState` reported beside every number — a hidden window
 * throttles `setTimeout` ~9× and fires no animation frames, so a timing without it is worthless.
 *
 * ⛔ **The two components are mounted ALTERNATELY**, before/after/before/after, so both columns see
 * the same machine under the same load. Measuring "before" in one process and "after" in another is
 * how a laptop's spare capacity gets published as an improvement.
 */

const AT = 1_700_000_000_000

function eventFor(index: number): TranscriptEvent {
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

const corpus = (n: number): RuntimeEventMessage[] =>
  Array.from({ length: n }, (_unused, index) => ({
    sessionId: 'sess_a',
    ordinal: index,
    at: AT + index * 37,
    event: eventFor(index),
  }))

/** Two frames, so the number includes a real paint rather than stopping at layout. */
const painted = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

async function measureStream(
  entries: RuntimeEventMessage[],
  which: 'before' | 'after',
): Promise<Record<string, unknown>> {
  const t0 = performance.now()
  const m = mount(
    which === 'after' ? EventStream : (Baseline as never),
    { window: { ...createWindow(), entries } },
    { width: 900, height: 700 },
  )
  const created = performance.now() - t0
  const log = m.q('event-log')
  log.getBoundingClientRect()
  const laidOut = performance.now() - t0
  await painted()
  const done = performance.now() - t0
  const rows = log.querySelectorAll('li[data-type]')
  const out = {
    what: which,
    created: +created.toFixed(1),
    laidOut: +laidOut.toFixed(1),
    painted: +done.toFixed(1),
    inDom: rows.length,
    // The number that had to not move: `ledgerRows` reads exactly this.
    readable: [...rows].filter(
      (li) => (li.querySelector('.rdetail')?.textContent ?? '').trim() !== '',
    ).length,
    drawn: log.getAttribute('data-drawn') ?? 'n/a',
    scrollHeight: log.scrollHeight,
    visibility: document.visibilityState,
  }
  m.unmount()
  return out
}

it('EVENT FOLD · before and after', async () => {
  const report: Record<string, unknown>[] = []
  const FULL = corpus(WINDOW_MAX_EVENTS)

  // Warm both paths so the first real number is not a cold stylesheet.
  await measureStream(corpus(50), 'after')
  await measureStream(corpus(50), 'before')

  // ⛔ The per-row string builders, with no DOM at all — this is where 97% of `212`'s number was.
  const time = (label: string, fn: () => void): void => {
    const t = performance.now()
    fn()
    report.push({ what: label, ms: +(performance.now() - t).toFixed(1) })
  }
  let sink = 0
  time('describeEvent × 5,000', () => {
    for (const m of FULL) sink += describeEvent(m.event).length
  })
  time('clockTime × 5,000 (memoised)', () => {
    for (const m of FULL) sink += clockTime(m.at).length
  })
  time('toLocaleTimeString × 5,000 (pre-255)', () => {
    for (const m of FULL)
      sink += new Date(m.at).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }).length
  })

  for (const pass of [1, 2, 3]) {
    report.push({ pass, ...(await measureStream(FULL, 'before')) })
    report.push({ pass, ...(await measureStream(FULL, 'after')) })
  }

  // ⚠️ §3's *"what this does NOT fix"*, measured rather than asserted: the OTHER reader of the same
  // bounded window draws every item, unfolded. 255 does not touch it.
  const state = createTranscript()
  const foldStart = performance.now()
  for (const message of FULL) applyEvent(state, message.event)
  report.push({
    what: 'folding 5,000 events into items (054)',
    ms: +(performance.now() - foldStart).toFixed(1),
    items: state.items.length,
  })

  const t0 = performance.now()
  const view = mount(
    TranscriptView,
    { items: state.items, mode: 'normal', who: 'claude' },
    { width: 900, height: 700 },
  )
  const created = performance.now() - t0
  view.host.getBoundingClientRect()
  const laidOut = performance.now() - t0
  await painted()
  report.push({
    what: 'TranscriptView over the same window — UNFOLDED, not fixed by 255',
    items: state.items.length,
    created: +created.toFixed(1),
    laidOut: +laidOut.toFixed(1),
    painted: +(performance.now() - t0).toFixed(1),
  })
  view.unmount()
  unmountAll()

  expect(sink).toBeGreaterThan(0)
  throw new Error(`EVENT FOLD REPORT\n${report.map((row) => JSON.stringify(row)).join('\n')}`)
}, 240_000)
