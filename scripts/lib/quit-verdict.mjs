/**
 * Give clean exit and last-resort stop distinct verdict tokens at the front of the line.
 * Both pass the gate: Electron can reach its quit phases yet need the detached closer, and
 * that bound doing its job must not become a failure.
 *
 * Keep `quit:check ✔` for clean exits so existing readers find them; STOPPED is separately
 * countable without reading a trailing caveat. This one line is the whole result.
 *
 * Do not use smoke-step aggregation here: a force-stopped quit can satisfy most shutdown
 * assertions yet must keep its stopped verdict. Direct controls exercise the load-dependent arm.
 */

/**
 * The app's own words, matched rather than inferred. `apps/desktop/src/main/last-resort-exit.ts`
 * bakes this sentence into the closer's program and prints it immediately before the SIGKILL, so
 * there is no stop without it. The two files cannot import each other: `quit-verdict.test.mjs`
 * derives its fixture from the closer's source and `one-app.test.ts` keeps the spellings in step.
 *
 * Its absence is meaningful only because the gate has already proved the app's shutdown report
 * arrived (`app-closes-check.mjs` goes red when it is missing), and that ordering is asserted.
 */
export const LAST_RESORT_SAID = 'is being stopped now'

/**
 * The two ways a quit ends; there is no third, and both are green. Every cell carries a mark,
 * a word and a reason. The reasons are a negation pair and neither contains the other:
 * `did not exit on its own` matches the stopped line only, which keeps existing greps correct
 * (asserted in `quit-verdict.test.mjs`).
 */
export const QUIT_VERDICTS = Object.freeze({
  exited: Object.freeze({
    mark: '✔',
    word: 'closed',
    because: 'Electron exited on its own',
  }),
  stopped: Object.freeze({
    mark: '⚠️',
    word: 'STOPPED',
    because: 'Electron did not exit on its own; the last resort stopped it',
  }),
})

/**
 * Which cell this run landed in, read from what the app itself wrote.
 *
 * A non-string is `exited`, the wrong-but-safe direction on purpose: the caller's file read
 * already answers `''` on failure, and a gate that announced a force-stop because its own read
 * threw would be an instrument reporting itself as the product. A lost report is caught by the
 * gate's shutdown-report assertion, which is red and runs first.
 *
 * @param {unknown} appOutput — everything the app wrote to its own stdout and stderr.
 * @returns {'exited' | 'stopped'}
 */
export function quitVerdict(appOutput) {
  return typeof appOutput === 'string' && appOutput.includes(LAST_RESORT_SAID)
    ? 'stopped'
    : 'exited'
}

/**
 * The verdict, its cell, and the head of the line `quit:check` prints. Only the head: the rest
 * (window, port, gate, teardown) is measurement the gate owns, and folding it in would put a
 * second copy of `since()` in the tree.
 *
 * @param {{ output: unknown, closedIn: string, budgetMs: number }} run
 * @returns {{ verdict: 'exited' | 'stopped', mark: string, word: string, because: string, head: string }}
 */
export function quitHeadline({ output, closedIn, budgetMs }) {
  const verdict = quitVerdict(output)
  const cell = QUIT_VERDICTS[verdict]
  return {
    verdict,
    ...cell,
    head:
      `quit:check ${cell.mark} ${cell.word} in ${closedIn} ` +
      `(budget ${String(budgetMs)}ms) — ${cell.because}`,
  }
}
