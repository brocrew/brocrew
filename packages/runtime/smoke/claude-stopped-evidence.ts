/**
 * ⚑ **709 · what `probe:claude-stopped-word` concludes, as pure functions a cheap gate can pin.**
 *
 * ⛔ R43 records the provider's word, and on Claude that word for a stopped turn is not a subtype —
 * `error_during_execution` is also a real execution error and a startup failure — but the result's
 * `terminal_reason`: `aborted_streaming` for a turn stopped mid-stream, `aborted_tools` for one
 * stopped in a tool or cancelled at its card (measured on CLI 2.1.281). `claudeResultOutcome` reads
 * it. ⚠️ **The answer moves with a CLI bump**, so the probe re-measures it and this decides; the
 * fixture every `ci` test of the mapping reads (`test/fixtures/claude-stopped-results.json`) is
 * written by the same run. `test/claude-stopped-evidence.test.ts` holds this to planted arms.
 */

/** The probe's arms — one turn each. */
export const STOP_ARMS = [
  'finishes',
  'stopped-streaming',
  'stopped-in-tool',
  'cancelled-card',
] as const
export type StopArm = (typeof STOP_ARMS)[number]

/** One arm, as the probe saw it. */
export interface StopSeen {
  readonly arm: StopArm
  /** Claude's own `result` frame for the turn — its subtype and `terminal_reason` — or `null`. */
  readonly result: { readonly subtype: string; readonly terminalReason: string | null } | null
  /** Every `turn` word the product published for the arm, in order. */
  readonly productWords: readonly string[]
  /** How many `error` events the product published for the arm. */
  readonly productErrors: number
  /**
   * ⛔ **The arm's premise** — when the stop was asked, the product's turn had not ended, and (in a
   * tool) the tool's result had not gone back to the model yet. `null` on the control, which nobody
   * stops. A stop asked of a turn already over does nothing, so its `result` measures no stop.
   */
  readonly openAtStop: boolean | null
  /**
   * ⚠️ **Whose word the product recorded** — `true` when the product published its ending BEFORE
   * Claude's `result` arrived: its own forced `interrupted` (`074`'s `forceEnd`, after the ack),
   * with Claude's result absorbed unread. Only a `false` arm tests `claudeResultOutcome` live.
   */
  readonly endedBeforeClaudesResult: boolean
}

/** ⚑ Claude's own word for a stopped turn, per arm — the measurement this probe keeps honest. */
const CLAUDE_SAYS: Readonly<Record<StopArm, string>> = {
  finishes: 'completed',
  'stopped-streaming': 'aborted_streaming',
  'stopped-in-tool': 'aborted_tools',
  'cancelled-card': 'aborted_tools',
}

/**
 * ⚑ **Does the product record Claude's own word for a stopped turn?**
 *
 * - ⛔ `not-performed` — an arm is missing, or its turn has no `result` from Claude, or no word from
 *   the product: nothing to compare; or a stop asked of a turn that was no longer running (its
 *   premise), so nothing was stopped;
 * - 🔴 `moved` — a CLI bump: Claude no longer closes an arm with the `terminal_reason` measured on
 *   2.1.281. `claudeResultOutcome`'s set must be re-measured, and the fixture regenerated;
 * - 🔴 `misread` — Claude said it, and the product recorded something else: a finished turn not
 *   `completed`, a stopped one not `interrupted`, or a Cancel drawn as a fault (an `error` beside it);
 * - ⚑ `the-providers-word` — every arm recorded as Claude said it. ⚠️ It names the arms whose word
 *   was READ off Claude's result (`read`) apart from the arms the product had already ended in its
 *   own forced `interrupted` before Claude's result came (`endedFirst`): there Claude's word agreed,
 *   and nothing read it. ⛔ A run where no STOPPED arm was read is `not-performed` — the mapping of a
 *   stop was never exercised live (the `ci` tests of it read the fixture this run writes).
 */
export type StoppedWordVerdict =
  | {
      readonly verdict: 'the-providers-word'
      readonly read: readonly StopArm[]
      readonly endedFirst: readonly StopArm[]
    }
  | { readonly verdict: 'moved'; readonly because: string }
  | { readonly verdict: 'misread'; readonly arms: readonly string[] }
  | { readonly verdict: 'not-performed'; readonly because: string }

export function stoppedWordVerdict(seen: readonly StopSeen[]): StoppedWordVerdict {
  const missing = STOP_ARMS.filter((arm) => !seen.some((one) => one.arm === arm))
  if (missing.length > 0) {
    return { verdict: 'not-performed', because: `no arm measured for ${missing.join(', ')}` }
  }
  for (const one of seen) {
    if (one.result === null) {
      return { verdict: 'not-performed', because: `Claude wrote no result for ${one.arm}` }
    }
    if (one.productWords.length === 0) {
      return { verdict: 'not-performed', because: `the product recorded no ending for ${one.arm}` }
    }
    if (one.arm !== 'finishes' && one.openAtStop !== true) {
      return { verdict: 'not-performed', because: `${one.arm} was no longer running at its stop` }
    }
  }
  const moved = seen.filter((one) => one.result?.terminalReason !== CLAUDE_SAYS[one.arm])
  if (moved.length > 0) {
    return {
      verdict: 'moved',
      because: moved
        .map(
          (one) => `${one.arm}: ${String(one.result?.terminalReason)}, not ${CLAUDE_SAYS[one.arm]}`,
        )
        .join('; '),
    }
  }
  const misread = seen
    .filter((one) => {
      const expected = one.arm === 'finishes' ? 'completed' : 'interrupted'
      return one.productWords.join(',') !== expected || one.productErrors > 0
    })
    .map(
      (one) =>
        `${one.arm}: ${one.productWords.join(',')} with ${String(one.productErrors)} error(s)`,
    )
  if (misread.length > 0) return { verdict: 'misread', arms: misread }
  const read = seen.filter((one) => !one.endedBeforeClaudesResult).map((one) => one.arm)
  if (!read.some((arm) => arm !== 'finishes')) {
    return {
      verdict: 'not-performed',
      because: 'no stopped arm’s word was read off Claude’s result — each was ended first',
    }
  }
  const endedFirst = seen.filter((one) => one.endedBeforeClaudesResult).map((one) => one.arm)
  return { verdict: 'the-providers-word', read, endedFirst }
}
