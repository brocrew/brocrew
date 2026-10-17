import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ContextReading, RuntimeEvent } from '@brobot2/runtime'
import {
  barFraction,
  compactions,
  fractionOf,
  formatTokens,
  isRedline,
  percentText,
  reclaimed,
  REDLINE,
} from '../src/renderer/src/lib/context-meter'
import {
  applyEvent,
  createTranscript,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { attentionTraces, DRAWER_TABS, tracesOutsideDrawer } from '../src/renderer/src/lib/drawer'
import { isVisibleIn, visibleItems } from '../src/renderer/src/lib/transcript-mode'

/**
 * The context meter, as arithmetic and as a fold (087, designed in 086).
 *
 * Two of 086's rulings are the whole of this file: **never invent a number**, and **context
 * pressure is a different register from attention**. Both are stated here as things that cannot
 * happen rather than as things that currently do not.
 */

const fold = (state: TranscriptState, ...events: RuntimeEvent[]): TranscriptState => {
  for (const event of events) applyEvent(state, event, 1_700_000_000_000)
  return state
}

const reading = (r: ContextReading & { kind: 'tokens' | 'proportional' }): RuntimeEvent => ({
  type: 'context_reading',
  reading: r,
  source: 'test/reading',
})

const compaction = (over: Record<string, unknown> = {}): RuntimeEvent =>
  ({ type: 'compaction', source: 'test/compacted', ...over }) as RuntimeEvent

describe('a `tokens` reading can never produce a percentage (acceptance 3)', () => {
  /**
   * ⚠️ **The type is the guard and this file cannot prove it — the compiler does.**
   * `ContextReading`'s `tokens` arm has no `window` field at all, so `reading.used / reading.window`
   * does not compile. What these tests add is the RUNTIME half: every function that could produce a
   * proportion refuses to, so a cast or a JSON payload from an older build cannot slip past either.
   */
  const TOKENS: ContextReading = { kind: 'tokens', used: 46975 }
  const UNKNOWN: ContextReading = { kind: 'unknown' }
  const PROPORTIONAL: ContextReading = { kind: 'proportional', used: 128000, window: 258400 }

  it('every arithmetic entry point returns nothing for `tokens` and `unknown`', () => {
    for (const value of [TOKENS, UNKNOWN]) {
      expect(fractionOf(value), value.kind).toBeNull()
      expect(percentText(value), value.kind).toBeNull()
      expect(isRedline(value), value.kind).toBe(false)
      // Zero fill, and it is drawn as no bar at all — see the component. A gauge that filled to 0%
      // and a gauge that says "no reading" must not look alike.
      expect(barFraction(value), value.kind).toBe(0)
    }
  })

  it('…and a real one for `proportional` — so the refusals above are a choice, not a broken module', () => {
    // The pairing. Without this the block above would pass just as well against functions that
    // returned null for everything, which is the vacuity this repo keeps finding.
    expect(fractionOf(PROPORTIONAL)).toBeCloseTo(0.4954, 4)
    expect(percentText(PROPORTIONAL)).toBe('50')
    expect(isRedline(PROPORTIONAL)).toBe(false)
    expect(barFraction(PROPORTIONAL)).toBeCloseTo(0.4954, 4)
  })

  it('a fraction under half a percent reads `<1`, never `0`', () => {
    // `0%` is the one number this feature refuses to show, because it is how "we don't know" would
    // look if anyone ever rendered it. A real 0.4% must not be able to wear that costume.
    expect(percentText({ kind: 'proportional', used: 1000, window: 258400 })).toBe('<1')
    // A genuine zero is a measurement and IS shown as 0 — the distinction is `used > 0`.
    expect(percentText({ kind: 'proportional', used: 0, window: 258400 })).toBe('0')
  })

  it('the redline is `--danger` territory only, and only with a proportion', () => {
    expect(isRedline({ kind: 'proportional', used: 258400 * REDLINE, window: 258400 })).toBe(true)
    expect(isRedline({ kind: 'proportional', used: 258400 * REDLINE - 1, window: 258400 })).toBe(
      false,
    )
    // A huge token count with no window is NOT red: without a denominator there is no "nearly
    // full", and colouring it red would be the invented proportion wearing a colour.
    expect(isRedline({ kind: 'tokens', used: 10_000_000 })).toBe(false)
  })

  it('a reading over 100% is SHOWN as over 100, and the bar clamps', () => {
    // It should not happen — the Codex adapter reads `last`, which never exceeded the window in 198
    // measurements — but if it ever does, a visibly absurd number is a bug report and a quietly
    // clamped one is a lie. The bar clamps because a bar cannot outgrow its track.
    const over: ContextReading = { kind: 'proportional', used: 445780, window: 258400 }
    expect(percentText(over)).toBe('173')
    expect(barFraction(over)).toBe(1)
  })
})

describe('a session with no report shows `unknown`, never zero (acceptance 4)', () => {
  it('a FRESH transcript starts unknown, with no source and no time', () => {
    const state = createTranscript()
    expect(state.meter).toEqual({ reading: { kind: 'unknown' }, source: null, at: null })
  })

  it('a RESUMED session that has not spoken is still unknown', () => {
    // A resume replays session lifecycle and status; none of it is a reading.
    const state = fold(
      createTranscript(),
      {
        type: 'session',
        state: 'resumed',
        ref: { provider: 'codex', sessionId: 's1', cwd: '/tmp', rotation: 0 },
      },
      { type: 'status', state: 'idle' },
    )
    expect(state.meter.reading).toEqual({ kind: 'unknown' })
  })

  it('an IMPORTED read-only conversation with real content is still unknown', () => {
    // The case 043 made possible and the one most likely to look broken: a long imported thread
    // full of messages and tools, and not one usage frame — because the import carries what the
    // provider wrote to disk, which does not include the stream frames the meter reads.
    const state = fold(
      createTranscript(),
      { type: 'assistant_message', text: 'a long imported answer' },
      { type: 'tool_call', id: 't1', name: 'Bash', summary: 'ls' },
      { type: 'tool_result', id: 't1', summary: 'ok', ok: true },
      { type: 'turn', state: 'completed' },
    )
    expect(state.items.length).toBeGreaterThan(0) // the fixture really did fold content
    expect(state.meter.reading).toEqual({ kind: 'unknown' })
  })

  it('…and one reading is enough to leave it — so "unknown" is a state, not a stuck value', () => {
    const state = fold(createTranscript(), reading({ kind: 'tokens', used: 46975 }))
    expect(state.meter).toEqual({
      reading: { kind: 'tokens', used: 46975 },
      source: 'test/reading',
      at: 1_700_000_000_000,
    })
  })

  it('the latest reading WINS — the meter is a gauge, not a log', () => {
    // 078's whole point: the meter absorbs the stream so it never becomes transcript rows.
    const state = fold(
      createTranscript(),
      reading({ kind: 'tokens', used: 100 }),
      reading({ kind: 'tokens', used: 200 }),
      reading({ kind: 'proportional', used: 300, window: 1000 }),
    )
    expect(state.meter.reading).toEqual({ kind: 'proportional', used: 300, window: 1000 })
    // Three readings, zero items. The negative that matters, paired with a positive above showing
    // the fold does add items for other events.
    expect(state.items).toEqual([])
  })
})

describe('the context meter raises no attention trace (acceptance 5)', () => {
  /**
   * ⚠️ **All five of 080's traces, against every reading kind including the redline.**
   *
   * 063 exists because a question that fails to reach the user is a defect we paid to fix, and 080
   * built five traces so one can never hide. A full context window is not a question: if pressure
   * lit the same channel, the signal that must never be ignored would become the signal that is
   * always on.
   */
  const READINGS: ContextReading[] = [
    { kind: 'unknown' },
    { kind: 'tokens', used: 10_000_000 },
    { kind: 'proportional', used: 128000, window: 258400 },
    { kind: 'proportional', used: 258000, window: 258400 }, // the redline
  ]

  it('with nothing waiting, no trace is raised on ANY reading — sitting on the tab or not', () => {
    // ⚠️ **The reading is folded into a real state and the TAB LEVEL is read from it** (review
    // finding 6). The loop used to carry `value` only into an assertion MESSAGE — it was never
    // passed to anything, so "on ANY reading" was decoration and the block would have passed
    // identically with one reading or none. Now each reading actually reaches the code under test.
    for (const value of READINGS) {
      const state = createTranscript()
      if (value.kind !== 'unknown') applyEvent(state, reading(value))
      expect(state.meter.reading, value.kind).toEqual(value)
      for (const tab of DRAWER_TABS.map((entry) => entry.id)) {
        for (const drawerOpen of [true, false]) {
          const traces = attentionTraces({ waiting: 0, status: 'working', drawerOpen, tab })
          expect(Object.values(traces), `${value.kind} · ${tab} · open=${drawerOpen}`).toEqual([
            false,
            false,
            false,
            false,
            false,
          ])
          expect(tracesOutsideDrawer(traces)).toBe(0)
        }
      }
    }
    // Non-vacuity, and it is the assertion that makes the block above mean anything: the SAME
    // function does raise traces when something really is waiting. Without this line, a
    // `attentionTraces` that returned all-false unconditionally would satisfy every case above.
    const waiting = attentionTraces({
      waiting: 1,
      status: 'waiting_permission',
      drawerOpen: false,
      tab: 'open',
    })
    expect(waiting.badge).toBe(true)
    expect(tracesOutsideDrawer(waiting)).toBeGreaterThanOrEqual(1)
  })

  it('the reading is not an input to the attention model at all', () => {
    // ⚠️ Asserted against the SOURCE, not against a literal built two lines up (review finding 20).
    // The old version did `expect(Object.keys(input).sort()).toEqual([...])` on an object this test
    // had just written — a tautology that could not fail, and which would have gone on passing the
    // day someone added a `reading` field to `AttentionInput`. Reading the interface out of
    // `drawer.ts` is what makes it a claim about the app.
    const source = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/lib/drawer.ts', import.meta.url)),
      'utf8',
    )
    const body = /export interface AttentionInput \{([^}]*)\}/.exec(source)?.[1] ?? ''
    expect(body, 'AttentionInput not found in drawer.ts').not.toBe('')
    const fields = [...body.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort()
    expect(fields).toEqual(['drawerOpen', 'status', 'tab', 'waiting'])
    expect(
      Object.values(
        attentionTraces({ waiting: 0, status: 'idle', drawerOpen: true, tab: 'changes' }),
      ).some(Boolean),
    ).toBe(false)
  })
})

describe('the history count IS the number of boundary rows (acceptance 6)', () => {
  it('every compaction is one row, and `compactions()` reads those same rows', () => {
    const state = fold(
      createTranscript(),
      { type: 'assistant_message', text: 'before' },
      compaction({ before: 128000, after: 24000 }),
      { type: 'assistant_message', text: 'after' },
      compaction({ compactionId: 'c2' }),
    )
    // ⚠️ Asserted against what the TRANSCRIPT WOULD RENDER, not against the same filter written out
    // twice (review finding 28). `compactions(state) === state.items.filter(kind==='compaction')`
    // is true by construction and could not fail; the claim worth making is that the tally matches
    // the rows a reader actually sees, which is `visibleItems` in the mode they are reading in.
    const rendered = visibleItems('normal', state.items).filter((i) => i.kind === 'compaction')
    expect(compactions(state)).toEqual(rendered)
    expect(compactions(state)).toHaveLength(2)
    // Each row carries an item id, which is what a jump lands on.
    for (const row of compactions(state)) expect(row.id).toMatch(/^compaction_/)
  })

  it('a provider that announces one compaction TWICE draws one row', () => {
    // Codex announces its item on both `item/started` and `item/completed` with the same id. The
    // normalizer emits once; this is the second line of defence, and the one that covers a LEDGER
    // written before that fix — events are persisted, so the fold can be replaying an old stream.
    const state = fold(
      createTranscript(),
      compaction({ compactionId: 'dup' }),
      compaction({ compactionId: 'dup' }),
    )
    expect(compactions(state)).toHaveLength(1)
  })

  it('…but two compactions WITHOUT ids are two rows — absence is not identity', () => {
    // The pairing, and it is a real risk: collapsing on `undefined === undefined` would silently
    // merge every Codex compaction in a session into one, since Codex's notification path carries
    // no id at all.
    const state = fold(createTranscript(), compaction(), compaction())
    expect(compactions(state)).toHaveLength(2)
  })

  it('a boundary is never hidden by the reading view — in BOTH modes', () => {
    const state = fold(createTranscript(), compaction({ before: 1, after: 0 }))
    const row = compactions(state)[0]!
    expect(isVisibleIn('normal', row)).toBe(true)
    expect(isVisibleIn('debug', row)).toBe(true)
    // Paired with the item kind this one was deliberately NOT built as: an `info` notice IS hidden
    // in normal mode, which is exactly why a compaction is not one.
    const notice = fold(createTranscript(), { type: 'turn', state: 'completed' }).items.find(
      (item) => item.kind === 'notice',
    )!
    expect(isVisibleIn('normal', notice)).toBe(false)
  })

  it('`reclaimed` needs BOTH ends, and refuses a compaction that grew', () => {
    expect(
      reclaimed({ kind: 'compaction', id: 'x', before: 128000, after: 24000, source: 's' }),
    ).toBe(104000)
    // Codex's case: no numbers, so no claim.
    expect(reclaimed({ kind: 'compaction', id: 'x', source: 's' })).toBeNull()
    expect(reclaimed({ kind: 'compaction', id: 'x', before: 128000, source: 's' })).toBeNull()
    // A "compaction" that grew the context is not something to congratulate.
    expect(
      reclaimed({ kind: 'compaction', id: 'x', before: 10, after: 20, source: 's' }),
    ).toBeNull()
    expect(
      reclaimed({ kind: 'compaction', id: 'x', before: 10, after: 10, source: 's' }),
    ).toBeNull()
  })
})

describe('a compaction and the figure the meter shows', () => {
  const before = (): TranscriptState =>
    fold(createTranscript(), reading({ kind: 'tokens', used: 180_000 }))

  it('🔴 a compaction that gave no size clears the figure until the next reading', () => {
    const state = fold(before(), compaction({ compactionId: 'c1' }))
    expect(state.meter.reading).toEqual({ kind: 'unknown' })
    expect(state.meter.source).toBeNull()
    // The next reading overrides.
    fold(state, reading({ kind: 'tokens', used: 21_000 }))
    expect(state.meter.reading).toEqual({ kind: 'tokens', used: 21_000 })
  })

  it('⚑ a compaction that gave its size, then its reading, shows the new size', () => {
    const state = fold(
      before(),
      compaction({ before: 180_000, after: 24_000 }),
      reading({ kind: 'tokens', used: 24_000 }),
    )
    expect(state.meter.reading).toEqual({ kind: 'tokens', used: 24_000 })
    // A sized compaction alone does not blank the figure it is about to replace.
    const alone = fold(before(), compaction({ before: 180_000, after: 24_000 }))
    expect(alone.meter.reading).toEqual({ kind: 'tokens', used: 180_000 })
  })

  it('⛔ a sub-agent’s compaction leaves the conversation’s figure alone', () => {
    const state = fold(before(), compaction({ parentToolCallId: 'toolu_task' }))
    expect(state.meter.reading).toEqual({ kind: 'tokens', used: 180_000 })
  })

  it('⛔ a compaction announced again after the next reading does not clear it', () => {
    const state = fold(
      before(),
      compaction({ compactionId: 'dup' }),
      reading({ kind: 'tokens', used: 21_000 }),
      compaction({ compactionId: 'dup' }),
    )
    expect(state.meter.reading).toEqual({ kind: 'tokens', used: 21_000 })
  })
})

describe('formatting a token count', () => {
  it('is short enough for a gauge at every magnitude', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(947)).toBe('947')
    expect(formatTokens(8421)).toBe('8.4k')
    expect(formatTokens(128_000)).toBe('128k')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })

  it('never renders a non-number as one', () => {
    // The em-dash, not `NaN` — the same refusal the meter makes everywhere else.
    expect(formatTokens(Number.NaN)).toBe('—')
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe('—')
  })
})
