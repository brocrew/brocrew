import type { ToolItem } from './transcript'
import { BACKGROUND_WORD, backgroundState } from './background-work'

/**
 * 🔴 **587 · what became of one tool call, as a CLOSED set a test can walk.**
 *
 * ## ⛔ Why this left `ToolEntry.vue`
 *
 * ⚠️ **It was a `computed` in one component and `587` gave it a second reader.** A run of settled
 * calls now collapses to one quiet line (`EXT-013` §3.1), and that line has to say whether anything
 * in the run did not plainly succeed — which is the same question the row's own status dot asks.
 * ⛔ **Two derivations that agree today are `064`/`099`'s shape**, and the collapsed line is exactly
 * where a disagreement would be invisible: the card says `error` in a colour nobody expanded far
 * enough to see.
 *
 * ## 🔴 The hazard this file exists to close, by name
 *
 * ⛔ **`an-unenumerated-state-counts-as-success`.** ⚠️ A collapsed line that shouts about the
 * failures somebody remembered to list reports every other state as *it went fine*. ⚑ **So the
 * positive set is the closed one**: {@link TOOL_OUTCOMES_DONE} has two members and everything
 * settled outside it is called out. A state added tomorrow is loud by construction rather than by
 * somebody remembering to add it here.
 *
 * ⚑ **And the list is a LIST first, so it can be WALKED** — `353`'s idiom, the same reason
 * `RAIL_PERMANENCES` is one. A renderer claiming to draw every outcome is worth what the
 * enumeration behind it is worth.
 */
export const TOOL_OUTCOMES = [
  /** No result yet, and the thing that was running it is still there. */
  'running',
  /** The receipt landed, and the work it describes is still going — `backgroundState`'s `running`. */
  'background',
  /** The provider reported success. */
  'done',
  /** Detached work ran to its end — `BACKGROUND_WORD.completed`, *finished*. */
  'completed',
  /** The provider reported failure. */
  'error',
  /** Detached work reported failure. */
  'failed',
  /** Somebody stopped it. Not a failure; the outcome of a gesture. */
  'stopped',
  /** It ended and nobody said how. The absence of an outcome, never a verdict. */
  'unknown',
  /**
   * ⚠️ **We stopped watching, and it is reachable by TWO paths** — the foreground call whose session
   * went away (`074`), and detached work marked the same way. ⛔ **The argument for collapsing them
   * was `ToolEntry`'s, at `a69703c1`, on the computed this file replaced** — *"`unfinished`
   * deliberately collapses with the foreground word below: both mean 'we stopped watching', which
   * is one fact whichever side of the detachment it happened on"* — and it lives here now because
   * the code it annotated does. ⚑ Said in the past tense on purpose: a reader who greps that
   * sentence must not find only this one claiming it exists elsewhere.
   */
  'unfinished',
] as const

export type ToolOutcome = (typeof TOOL_OUTCOMES)[number]

/**
 * ⛔ **Still going, so it is not part of anything that can be collapsed** (587).
 *
 * ⚑ **`tool-runs.ts` reads this and `300` is why.** A live command carries the one control this app
 * has over it — *"the one control this app has over a running command must not be behind a
 * disclosure triangle"* — so a row in one of these states stays its own card and never joins a run.
 */
export const TOOL_OUTCOMES_IN_FLIGHT: readonly ToolOutcome[] = ['running', 'background']

/**
 * ⚑ **The POSITIVE set, and it is the only closed one anybody may reason from** (587).
 *
 * ⛔ **Never write the complement by hand.** {@link didNotPlainlySucceed} is the complement computed,
 * which is what makes a tenth outcome loud on the day it is added rather than silent.
 */
export const TOOL_OUTCOMES_DONE: readonly ToolOutcome[] = ['done', 'completed']

/**
 * ⛔ **Exactly `ToolEntry`'s own `status`, moved rather than copied** — the card imports this now.
 *
 * ⚠️ **A DETACHMENT outranks the receipt, and the order below is `248` rather than style.**
 * `result.ok` says *"did the provider succeed at what it was asked"*; for a backgrounded command it
 * succeeded at LEAVING, and `245` measured 24.5 seconds of green on exactly that row.
 */
export function toolOutcome(item: ToolItem): ToolOutcome {
  if (item.background !== undefined) {
    const state = backgroundState(item.background)
    return state === 'running' ? 'background' : state
  }
  if (item.result) return item.result.ok ? 'done' : 'error'
  return item.unfinished === true ? 'unfinished' : 'running'
}

/** ⚑ Over, whichever way it went — the gate on joining a collapsible run. */
export function toolSettled(item: ToolItem): boolean {
  return !TOOL_OUTCOMES_IN_FLIGHT.includes(toolOutcome(item))
}

/**
 * 🔴 **Settled, and NOT in the positive set** — the phrase a collapsed line is allowed to shout on.
 *
 * ⚠️ **In flight is not a complaint.** A run holds no live rows at all (see {@link toolSettled}), so
 * this only ever answers about something that is over; the guard is here so a caller that widens
 * what a run may hold cannot accidentally call a running command a problem.
 */
export function didNotPlainlySucceed(item: ToolItem): boolean {
  const outcome = toolOutcome(item)
  return !TOOL_OUTCOMES_IN_FLIGHT.includes(outcome) && !TOOL_OUTCOMES_DONE.includes(outcome)
}

/**
 * ⛔ **The one pair that deliberately shares a word, declared rather than discovered** (587).
 *
 * ⚠️ **`error` is the provider saying the CALL failed; `failed` is detached work reporting that IT
 * failed.** They are two facts — and the card has painted them the same colour since `248`
 * (`.status-dot.error, .status-dot.failed`, one rule, written as a selector list precisely so the
 * two cannot drift apart). ⚑ **A person reading a collapsed line wants *how many went wrong*, not
 * which side of a detachment they were on**, so the line collapses them too, exactly as
 * {@link TOOL_OUTCOMES}' `unfinished` collapses its own two producers.
 *
 * 🔴 **It is here so that the NEXT collision is a failure rather than a coincidence.** A table of
 * nine words is one careless edit away from two states reading as one, and on this line that is a
 * count a person cannot check.
 */
export const SAME_WORD: readonly (readonly ToolOutcome[])[] = [['error', 'failed']]

/**
 * ⚑ **The word for an outcome, from the ONE vocabulary the card already reads** (222 §4).
 *
 * ⛔ **Six of the nine are `BACKGROUND_WORD`'s and are taken from it rather than respelled**, which
 * is why *did not finish* and *ended, outcome not reported* say on a collapsed line exactly what
 * they say on the card. ⚠️ The three that are not detached work — `running`, `done`, `error` — have
 * never had a word of their own on the row (the dot's colour was the whole statement), so they get
 * one here and this is its only spelling.
 */
export const TOOL_OUTCOME_WORD: Readonly<Record<ToolOutcome, string>> = {
  running: 'running',
  background: BACKGROUND_WORD.running,
  done: 'done',
  completed: BACKGROUND_WORD.completed,
  error: 'failed',
  failed: BACKGROUND_WORD.failed,
  stopped: BACKGROUND_WORD.stopped,
  unknown: BACKGROUND_WORD.unknown,
  unfinished: BACKGROUND_WORD.unfinished,
}

/**
 * **How long it took, measured between the two envelopes** — moved out of `ToolEntry` with
 * {@link toolOutcome}, for the same reason and with its rules intact.
 *
 * ⚑ **The provider's own number wins, when there is one** (327) — it timed the call itself, where
 * the subtraction below spans two `RuntimeHost` delivery stamps and so also counts transport.
 *
 * ⛔ **`background` is checked FIRST and that is `248`, not tidiness.** A detached call's receipt
 * arrives while the work is still running — 6 102 ms for a command that ran to 36 150 ms — so a
 * provider duration read here would print *"4 ms"* beside *"still running"*.
 *
 * ⚠️ **`at` is the CALL's stamp and is not on {@link ToolItem}** — it is `TranscriptItem`'s, which
 * is why this takes it as a second argument rather than reading it off the item. Absent whenever
 * either end is missing, because the alternative is a number that looks measured and is not.
 */
export function toolTook(item: ToolItem, at: number | undefined): string | null {
  if (item.background === undefined) {
    const reported = item.result?.durationMs
    if (reported !== undefined && Number.isFinite(reported) && reported >= 0) return said(reported)
  }
  const to = item.background ? item.background.endedAt : item.result?.at
  if (at === undefined || to === undefined) return null
  const ms = to - at
  if (!Number.isFinite(ms) || ms < 0) return null
  return said(ms)
}

function said(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}
