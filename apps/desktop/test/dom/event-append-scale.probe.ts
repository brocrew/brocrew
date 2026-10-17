import { expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref, toRaw } from 'vue'
import EventStream from '../../src/renderer/src/components/EventStream.vue'
import Baseline from './event-append-baseline.vue'
import { describeEvent } from '../../src/renderer/src/lib/describe-event'
import {
  appendLive,
  createWindow,
  WINDOW_MAX_EVENTS,
} from '../../src/renderer/src/lib/transcript-window'
import type { RuntimeEventMessage, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * 263 §2 · **What ONE arriving event costs the Events tab, at the cap.**
 *
 * ⛔ **`255` measured the wrong half and this is the other one.** `255` timed OPENING a full window
 * — 283-351 ms down to 56-63 — and every one of its 5,000-row cases is a STATIC mount. `259` lens C
 * finding 2 pointed at what that left unmeasured: the fold moved cost from open-once to
 * every-event, because every live event invalidates `rows`, which maps the whole window into a new
 * array, and the `v-for` then reconciles every row. ⚑ **The path carrying the repeated cost was
 * exactly the path nothing measured**, which is the finding, and this file is the answer to it.
 *
 * ⛔ **NOT part of `pnpm run ci`**, for the reason `vitest.probe.config.ts` states: a millisecond
 * threshold in the gate is a report about the machine that ran it. What the gate holds is the
 * MECHANISM — `event-append.dom.test.ts` asserts that an append reuses the rows it already derived,
 * with no clock in it at all. This file holds the numbers that mechanism was chosen on.
 *
 *     pnpm run probe:event-append
 *
 * ⚑ **It FAILS on purpose**, with the numbers and the budget verdict in the assertion message —
 * `255`'s convention, and for its reason: vitest hides `console` from a passing file.
 *
 * ⚠️ **`212`'s method throughout**: the app's own clock inside a real Chromium page, with
 * `document.visibilityState` reported beside every number. A hidden window throttles `setTimeout`
 * ~9× and fires no animation frames, so a timing without it is worthless.
 *
 * ⛔ **The two components are mounted ALTERNATELY**, before/after/before/after — `255`'s rule, and
 * the reason `event-append-baseline.vue` exists: a "before" measured in one process and an "after"
 * in another is a report about the laptop.
 *
 * ⚠️ **The append path is the REAL one.** `appendLive` on a `reactive` window, which is what
 * `session-record.ts:399` does to a `reactive(createSessionRecord(...))` — not a fresh corpus array
 * assigned over the prop, which is what `event-fold.dom.test.ts`'s 300-row growth cases do and is
 * why they could not see this.
 */

const AT = 1_700_000_000_000

/**
 * ⛔ **The budget, and it is a claim about the app rather than about this laptop.** One arriving
 * event may cost the Events tab at most half of a 60 Hz frame of main-thread time.
 *
 * ⚑ **Half, not all**, because the tab is not alone on that frame: the same event also folds into
 * the transcript (`applyEvent`) and re-renders the conversation beside it, and `054`/`212` both put
 * that half at the heavier end. A raw-debug tab that spent the whole frame would be taking the
 * budget of the surface a person is actually reading.
 */
const BUDGET_MS = 8.34

/** How many appends each burst measures. Enough for a p95 to mean something. */
const APPENDS = 60

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

const messageAt = (index: number): RuntimeEventMessage => ({
  sessionId: 'sess_a',
  ordinal: index,
  at: AT + index * 37,
  event: eventFor(index),
})

const corpus = (n: number): RuntimeEventMessage[] =>
  Array.from({ length: n }, (_unused, index) => messageAt(index))

/** Two frames, so a number includes a real paint rather than stopping at layout. */
const painted = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

const round = (ms: number): number => +ms.toFixed(2)

function stats(samples: number[]): Record<string, number> {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
  return {
    n: sorted.length,
    min: round(sorted[0] ?? 0),
    median: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted.at(-1) ?? 0),
  }
}

/**
 * ⚠️ **Two ticks, and the second one is not padding.** `useStickToBottom` awaits `nextTick()` INSIDE
 * its own watcher before writing `scrollTop`, so a followed list does its scroll one microtask after
 * the patch. Stopping at one tick would leave that write — and the layout it invalidates — out of
 * every number here, on the path that is by far the most common: a live stream nobody has scrolled.
 */
async function settle(node: HTMLElement): Promise<void> {
  await nextTick()
  await nextTick()
  node.getBoundingClientRect()
}

interface Burst extends Record<string, unknown> {
  what: string
  held: number
  appends: Record<string, number>
  releaseMs: number | null
  released: number
  inDom: number
  readable: number
  drawn: string
  visibility: string
}

async function measureAppends(
  which: 'before' | 'after',
  held: number,
  appends = APPENDS,
): Promise<Burst> {
  // ⛔ `reactive`, because that is what the app has: `session-store.ts:318` wraps the whole record,
  // so `record.window.entries` is a DEEP reactive array and every read of a message goes through a
  // proxy that tracks it. A plain object here would measure a component the app does not run.
  const win = reactive({ ...createWindow(), entries: corpus(held) })
  const m = mount(
    which === 'after' ? EventStream : (Baseline as never),
    { window: win },
    { width: 900, height: 700 },
  )
  const log = m.q('event-log')
  // Followed — the live case. A reader parked mid-history gets no live events in this window at all
  // (`liveDisposition` sends them to the control tail), so the tail is the state that pays.
  log.scrollTop = log.scrollHeight
  await painted()

  const samples: number[] = []
  let releaseMs: number | null = null
  let released = 0
  for (let i = 0; i < appends; i++) {
    const message = messageAt(held + i)
    const t = performance.now()
    const outcome = appendLive(win, message)
    await settle(log)
    const cost = performance.now() - t
    // ⚑ The release is reported on its own line rather than folded into the distribution: it happens
    // once per 1,251 events by construction (`WINDOW_RELEASE_CHUNK` is hysteresis), so averaging it
    // in would describe a frame that almost never happens and hide the one that always does.
    if (outcome.released > 0) {
      releaseMs = round(cost)
      released = outcome.released
    } else samples.push(cost)
  }

  const rows = log.querySelectorAll('li[data-type]')
  const burst: Burst = {
    what: which,
    held,
    appends: stats(samples),
    releaseMs,
    released,
    inDom: rows.length,
    // The number that must not move whatever the derivation does: `ledgerRows` reads exactly this.
    readable: [...rows].filter((li) => (li.querySelector('.rdetail')?.textContent ?? '').trim())
      .length,
    drawn: log.getAttribute('data-drawn') ?? 'n/a',
    visibility: document.visibilityState,
  }
  m.unmount()
  return burst
}

/**
 * ⛔ **What the reconcile costs with the derivation removed entirely** — the floor under any amount
 * of caching, and therefore the number that decides whether `259` lens C's real rework is warranted.
 *
 * ⚠️ **Same markup, zero derivation and near-zero reactivity**: the rows are a plain array that is
 * pushed to, behind one counter `ref`, and each `<li>` carries the same three data attributes and
 * the same drawn/folded split. Whatever this costs, no cache can take away — only putting fewer
 * `<li>`s in the DOM can, which is exactly the rework `255` refused and `263` §2 defers.
 *
 * ⛔ **It folds the same way, and that is not decoration.** `.raw-event.folded`'s
 * `content-visibility: hidden` is SCOPED to `EventStream`, so a bare list wearing the same class
 * names gets none of it — every one of its 5,000 rows would be laid out and painted, and the
 * "floor" would be measuring a component that does more work than the one it is a floor for. The
 * style below reproduces the containment; found by the adversarial pass over this diff.
 *
 * ⚠️ **What it still does NOT reproduce, said rather than glossed**: `h()` instead of a template (no
 * runtime compiler in a `.ts` probe, so no static-props hoisting), two data attributes instead of
 * three, and one child per row instead of the drawn row's four. Each of those makes this a little
 * cheaper than the real reconcile, so the number is a lower bound rather than an equal — which is
 * the direction that matters, because it is being used to say what a cache can never remove.
 */
async function measureReconcileFloor(
  held: number,
  mode: 'settle' | 'paced' = 'settle',
  appends = APPENDS,
): Promise<Record<string, unknown>> {
  interface Row {
    ordinal: number
    eventType: string
    detail: string
  }
  const rows: Row[] = corpus(held).map((message) => ({
    ordinal: message.ordinal,
    eventType: message.event.type,
    detail: describeEvent(message.event),
  }))
  const version = ref(0)
  const drawnFrom = Math.max(0, held - 60)
  const Bare = defineComponent({
    setup: () => () => {
      void version.value
      return h(
        'ol',
        { class: 'floor-list', 'data-cy': 'event-log', style: 'height:700px;overflow:auto' },
        rows.map((row, index) =>
          h(
            'li',
            {
              key: row.ordinal,
              class: index >= drawnFrom ? 'floor-row' : 'floor-row folded',
              'data-type': row.eventType,
              'data-ordinal': row.ordinal,
            },
            h('span', { class: 'rdetail' }, row.detail),
          ),
        ),
      )
    },
  })
  // The unscoped twin of `EventStream`'s own `.raw-event.folded`, so the two lists contain the same
  // amount of layout. ⚑ **526 · 33 px is what a real row measures now** — it was 35.5 (255's
  // `--row-px` over `3 * --text-6xs`), and 526 rebuilt the row as two fixed 12 px line boxes with
  // 4 px of block padding.
  // ⚠️ **Only the HEIGHT was brought forward, and the rest of this rule is deliberately not the
  // real row**: the padding, the 10px/1.5 font and the two-column grid below are the pre-526
  // shape. ⛔ What a folded row contributes under `content-visibility: hidden` is its
  // `scrollHeight`, not its layout, so the height is the only term that has to track — and a
  // stale one would make the floor list SCROLL differently, not lay out more cheaply.
  const sheet = document.createElement('style')
  sheet.textContent =
    '.floor-row { display: grid; padding: 3px 8px; border-bottom: 1px solid #333; font: 10px/1.5 monospace; grid-template-columns: 46px minmax(0, 1fr) }' +
    '.floor-row.folded { height: 33px; content-visibility: hidden }'
  document.head.append(sheet)
  const m = mount(Bare, {}, { width: 900, height: 700 })
  const log = m.q('event-log')
  await painted()

  const push = (index: number): void => {
    const message = messageAt(index)
    rows.push({
      ordinal: message.ordinal,
      eventType: message.event.type,
      detail: describeEvent(message.event),
    })
    version.value += 1
  }

  const samples: number[] = []
  if (mode === 'settle') {
    for (let i = 0; i < appends; i++) {
      const t = performance.now()
      push(held + i)
      await settle(log)
      samples.push(performance.now() - t)
    }
  } else {
    let previous = performance.now()
    for (let i = 0; i < appends; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const now = performance.now()
      samples.push(now - previous)
      previous = now
      push(held + i)
    }
    samples.shift()
  }

  const inDom = log.querySelectorAll('li[data-type]')
  const out: Record<string, unknown> = {
    what: `reconcile floor — same markup, NO derivation, no deep reactivity · ${
      mode === 'paced' ? 'one push per animation frame (intervalMs)' : 'main-thread cost per push'
    }`,
    held,
    appends: stats(samples),
    ...(mode === 'paced' ? { over16_7: samples.filter((ms) => ms > 16.7).length } : {}),
    inDom: inDom.length,
    readable: [...inDom].filter((li) => (li.querySelector('.rdetail')?.textContent ?? '').trim())
      .length,
    // ⚑ The engine's own answer that the containment took, rather than a claim that it did — a
    // floor measured without the fold would be a floor for a different list.
    // ⚠️ **Asked of the CONTENTS, not of the `<li>`.** `content-visibility: hidden` skips an
    // element's descendants and leaves its own box rendered, so `checkVisibility()` on the row
    // itself answers `true` whether the rule applied or not — a sensor that could never say no.
    // `255`'s own dom test asks the `.rdetail` for exactly this reason; asking the row was a
    // mistake this probe made first and the adversarial pass caught.
    foldedShown: log.querySelector('li.folded .rdetail')?.checkVisibility() ?? 'no folded row',
    drawnShown:
      log.querySelector('li.floor-row:not(.folded) .rdetail')?.checkVisibility() ?? 'none drawn',
    foldedPx: log.querySelector('li.folded')?.getBoundingClientRect().height ?? 'no folded row',
    visibility: document.visibilityState,
  }
  m.unmount()
  sheet.remove()
  return out
}

/**
 * ⛔ **What is LEFT once the derivation is cached: the walk itself.**
 *
 * ⚠️ **`rows` still maps the whole window on every event** — it just no longer re-derives it — and
 * this is what that costs with the derivation reduced to a `WeakMap` hit. Two columns, because they
 * are two different prices: reading 5,000 entries through the store's DEEP reactive proxy (a `get`
 * trap and a `track` apiece), against reading the same 5,000 raw. The gap between them is the
 * ceiling on what any further reactivity work could buy, and it is measured rather than assumed.
 */
function measureWalk(held: number, rounds = 40): Record<string, unknown>[] {
  const win = reactive({ ...createWindow(), entries: corpus(held) })
  const rawEntries = toRaw(win.entries)
  // ⚠️ **Two caches, keyed the two different ways, and it is not tidiness.** Reading an entry
  // through the reactive array yields its PROXY; reading `toRaw` yields the object itself. One
  // `WeakMap` warmed with proxies would miss on every raw lookup, and the raw column would then be
  // timing 5,000 misses against 5,000 hits.
  const byProxy = new WeakMap<object, { ordinal: number }>()
  const byRaw = new WeakMap<object, { ordinal: number }>()
  // Warm, because a live window is in the steady state: every proxy already created and every row
  // already derived. Timing the first pass would time proxy CREATION rather than the walk.
  for (const message of win.entries) byProxy.set(message, { ordinal: message.ordinal })
  for (const message of rawEntries) byRaw.set(message, { ordinal: message.ordinal })

  let hits = 0
  const time = (fn: () => (object | undefined)[]): Record<string, number> => {
    const samples: number[] = []
    for (let r = 0; r < rounds; r++) {
      const t = performance.now()
      const out = fn()
      samples.push(performance.now() - t)
      hits += out.filter(Boolean).length
    }
    return stats(samples)
  }
  const viaProxy = time(() => win.entries.map((message) => byProxy.get(message)))
  const viaRaw = time(() => rawEntries.map((message) => byRaw.get(message)))
  return [
    { what: 'walk · 5,000 entries through the DEEP reactive proxy', held, ...viaProxy },
    { what: 'walk · the same 5,000, read raw', held, ...viaRaw, hits },
  ]
}

/**
 * ⛔ **The claim in `259` lens C, measured as stated**: *"at one IPC event per frame the Events
 * drawer spends most of a frame walking thousands of rows before anything paints."*
 *
 * ⚠️ **Frame INTERVALS, not main-thread time** — one append per animation frame, and what is
 * reported is how far apart the frames actually landed. A tab that fits inside its frame produces
 * ~16.7 ms intervals; one that does not stretches them, and that stretch is the thing a person sees.
 */
async function measurePacedBurst(
  which: 'before' | 'after',
  held: number,
  frames = 90,
): Promise<Record<string, unknown>> {
  const win = reactive({ ...createWindow(), entries: corpus(held) })
  const m = mount(
    which === 'after' ? EventStream : (Baseline as never),
    { window: win },
    { width: 900, height: 700 },
  )
  const log = m.q('event-log')
  log.scrollTop = log.scrollHeight
  await painted()

  const intervals: number[] = []
  let previous = performance.now()
  for (let i = 0; i < frames; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const now = performance.now()
    intervals.push(now - previous)
    previous = now
    appendLive(win, messageAt(held + i))
  }
  const out = {
    what: `${which} · one event per animation frame`,
    held,
    frames,
    intervalMs: stats(intervals.slice(1)),
    over16_7: intervals.slice(1).filter((ms) => ms > 16.7).length,
    visibility: document.visibilityState,
  }
  m.unmount()
  return out
}

it('EVENT APPEND · what one arriving event costs at the cap', async () => {
  const report: Record<string, unknown>[] = []

  // ⚑ **The machine's own calibration, in every run.** `255` measured this exact loop at 0.6-0.9 ms;
  // a run that reports something far from it is a run on a busy laptop, and every number below it
  // should be read that way. It is also the control for the claim `255` made and `263` relies on:
  // the per-row DESCRIBER is not what any of this costs.
  const FULL = corpus(WINDOW_MAX_EVENTS)
  let sink = 0
  const calibration = performance.now()
  for (const message of FULL) sink += describeEvent(message.event).length
  report.push({
    what: 'calibration · describeEvent × 5,000',
    ms: round(performance.now() - calibration),
    visibility: document.visibilityState,
  })

  // Warm both paths so the first real number is not a cold stylesheet.
  await measureAppends('after', 200, 3)
  await measureAppends('before', 200, 3)

  for (const pass of [1, 2, 3]) {
    report.push({ pass, ...(await measureAppends('before', WINDOW_MAX_EVENTS)) })
    report.push({ pass, ...(await measureAppends('after', WINDOW_MAX_EVENTS)) })
  }

  // ⛔ The control for *"it is the window size, not appending"*: the same component, the same append
  // path, a window a person could plausibly have open. If this is cheap and the one above is not,
  // the cost is the walk over the rows and nothing else.
  report.push(await measureAppends('before', 300))
  report.push(await measureAppends('after', 300))

  report.push(await measureReconcileFloor(WINDOW_MAX_EVENTS))
  report.push(...measureWalk(WINDOW_MAX_EVENTS))

  report.push(await measurePacedBurst('before', WINDOW_MAX_EVENTS))
  report.push(await measurePacedBurst('after', WINDOW_MAX_EVENTS))
  // ⛔ The one that answers `263` §2.3. If even a list with NO derivation and NO deep reactivity
  // cannot hold a frame at this row count, no cache can, and only drawing fewer `<li>`s will.
  report.push(await measureReconcileFloor(WINDOW_MAX_EVENTS, 'paced', 90))

  unmountAll()

  const after = report.filter(
    (row) => row['what'] === 'after' && row['held'] === WINDOW_MAX_EVENTS,
  ) as unknown as Burst[]
  const medians = after.map((row) => row.appends['median']!)
  const worst = Math.max(...medians)
  const verdict =
    worst <= BUDGET_MS
      ? `WITHIN BUDGET — worst median ${round(worst)} ms of ${BUDGET_MS} ms`
      : `OVER BUDGET — worst median ${round(worst)} ms of ${BUDGET_MS} ms`

  expect(sink).toBeGreaterThan(0)
  throw new Error(
    `EVENT APPEND REPORT · ${verdict}\n${report.map((row) => JSON.stringify(row)).join('\n')}`,
  )
}, 600_000)
