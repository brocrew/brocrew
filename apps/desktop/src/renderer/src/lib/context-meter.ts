import type { ContextReading } from '../../../shared/runtime-ipc'
import type { CompactionItem, TranscriptItem, TranscriptState } from './transcript'

/**
 * The context meter, as arithmetic (087, designed in 086).
 *
 * Pure on purpose, and for the reason `drawer.ts` gives at length: a meter is chrome, and the rules
 * that decide what a gauge says are the part of chrome a test can hold. What is deliberately NOT
 * here is anything that turns a `tokens` reading into a proportion — see {@link percentOf}.
 */

/**
 * Where the gauge goes red — a fraction, not a percent, so the comparison is against the same
 * quantity the division produces and nobody has to remember which side is scaled.
 *
 * ⚠️ **`--danger`, never `--waiting`.** Red here is a fuel-gauge reading: it says the tank is
 * nearly empty, not that something is waiting for an answer. Amber is 063/080's attention channel
 * and appears nowhere in this feature — see `SessionContext.vue`, which asserts it.
 *
 * 0.9 rather than a measured number, and it is a threshold for a WARNING rather than for a
 * behaviour: neither provider tells us where it will actually compact. Claude's SDK carries an
 * `autoCompactThreshold` on a control request we do not make, and Codex says nothing at all. So this
 * is the point at which the meter starts saying "soon", and the copy beside it says "likely" rather
 * than naming a moment we were never told.
 */
export const REDLINE = 0.9

/**
 * How full, as a fraction — **and `null` for every reading that is not proportional.**
 *
 * ⚠️ **This function is the guard, and its signature is the whole design.** `ContextReading` is
 * discriminated by `kind`, and only the `proportional` arm has a `window` field at all: a caller who
 * wanted to divide a `tokens` reading would have nothing to divide by and would not compile. That is
 * why the reading kind lives on the wire (`events.ts`) rather than being derived from
 * `window !== undefined` somewhere down here, where one optional-chain would undo it.
 */
export function fractionOf(reading: ContextReading): number | null {
  return reading.kind === 'proportional' ? reading.used / reading.window : null
}

/** True only when there is a proportion AND it is at the redline. Unknown is never red. */
export function isRedline(reading: ContextReading): boolean {
  const fraction = fractionOf(reading)
  return fraction !== null && fraction >= REDLINE
}

/**
 * The percentage as it is WRITTEN — `null` when there is no proportion to write.
 *
 * ⚠️ **`<1%` rather than `0%`.** A reading of 0.4% is a real measurement, and rounding it to `0%`
 * would put the one number this whole feature refuses to show — the zero that means "we don't know"
 * — on the screen for a case where we do know. The two must not be able to look alike.
 *
 * Not clamped: a reading above 100% would be shown as what it is. That should not happen (the Codex
 * adapter reads `last`, which never exceeded the window in 198 measurements, precisely because
 * `total` did), and if it ever does, a visibly absurd number is a bug report and a quietly clamped
 * one is a lie. The BAR clamps — see {@link barFraction} — because a bar cannot overflow its track.
 */
export function percentText(reading: ContextReading): string | null {
  const fraction = fractionOf(reading)
  if (fraction === null) return null
  const rounded = Math.round(fraction * 100)
  return rounded === 0 && fraction > 0 ? '<1' : String(rounded)
}

/** How much of the track to paint, 0…1. Clamped, because a bar cannot be longer than its track. */
export function barFraction(reading: ContextReading): number {
  const fraction = fractionOf(reading)
  if (fraction === null) return 0
  return Math.min(1, Math.max(0, fraction))
}

/**
 * A token count, short enough for a gauge — `947`, `8.4k`, `128k`, `1.2M`.
 *
 * ⚠️ **It rounds, and the copy around it never claims otherwise.** Everywhere a rounded count is
 * shown next to a claim about a magnitude the surface writes `≈`. The exact number is not hidden —
 * the meter's caption spells `used of window` in full — this is only the figure.
 */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count)) return '—'
  const n = Math.max(0, Math.round(count))
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** The full count, grouped — `1,000,000`. What the caption spells out beside the short figure. */
export function groupTokens(count: number): string {
  return Math.max(0, Math.round(count)).toLocaleString('en-US')
}

/**
 * Every compaction this session, oldest first — **read off the transcript items themselves**.
 *
 * ⚠️ **This is what makes 086's "the history count === the number of boundary rows" true by
 * construction rather than by two lists agreeing.** The alternative — accumulating a separate array
 * in {@link TranscriptState} — would be a second answer to the same question, and the one that
 * drifted would be the one nobody was looking at. The tally is `compactions(state).length` and the
 * rows are the same objects, so they cannot disagree.
 */
export function compactions(state: TranscriptState): (CompactionItem & { at?: number })[] {
  return state.items.filter(isCompaction)
}

function isCompaction(item: TranscriptItem): item is CompactionItem & { at?: number } {
  return item.kind === 'compaction'
}

/**
 * How much room the newest compaction gave back — `null` unless the provider reported **both** ends.
 *
 * Codex reports neither, so this is null for every Codex session and the note simply does not
 * appear. That is the correct outcome and not a degradation: the boundary row still says a
 * compaction happened. `before <= after` also returns null — a "compaction" that grew the context is
 * not something to congratulate, and the honest response to a number that makes no sense is to say
 * nothing rather than to render a negative saving.
 */
export function reclaimed(item: CompactionItem): number | null {
  if (item.before === undefined || item.after === undefined) return null
  return item.before > item.after ? item.before - item.after : null
}
