/**
 * Give clean exit and last-resort stop distinct verdict tokens at the front of the line.
 * Both outcomes pass the gate: Electron can reach its quit phases yet need the detached
 * closer, and that bound doing its job must not become a failure.
 *
 * Keep `quit:check ✔` for clean exits so existing readers continue to find them; STOPPED is
 * separately countable without reading a trailing caveat. This one line remains the readable
 * and machine-readable result, with no second channel or load threshold.
 *
 * Do not use smoke-step aggregation here: a force-stopped quit can satisfy most shutdown
 * assertions, yet must retain its stopped verdict. Direct controls exercise this otherwise
 * load-dependent arm without needing to create an engine hang.
 */

/**
 * ⛔ **The app's own words, matched rather than inferred.**
 *
 * `apps/desktop/src/main/last-resort-exit.ts` bakes this into the closer's program — *"BroBot2
 * asked Electron to exit 2000ms ago and is still running; everything of ours is closed, so it is
 * being stopped now"* — and the closer prints it immediately BEFORE `process.kill(target,
 * "SIGKILL")`, so there is no stop without the sentence. ⚠️ **The two files cannot import each
 * other**, so `quit-verdict.test.mjs` derives the fixture from the closer's source and
 * `one-app.test.ts` keeps the spellings in step, exactly as the `ipc.ts` refusal sentence is kept.
 *
 * ⚑ **And the absence of it is only meaningful because the gate has already proved the app's words
 * arrived.** `app-closes-check.mjs` goes red when the shutdown report is missing — *"the app closed
 * inside the budget but said NOTHING about where the time went"* — which is what stops `exited`
 * being the answer to a question nobody could hear. ⛔ That ordering is asserted, not assumed.
 */
export const LAST_RESORT_SAID = 'is being stopped now'

/**
 * 🔴 **The two ways a quit ends. There is no third, and both are green.**
 *
 * ⛔ **Every cell carries all three of its parts**, because the defect was a cell that carried only
 * a mark while the other carried a mark and a sentence. ⚠️ **The reasons are a negation pair on
 * purpose and neither contains the other**: `did not exit on its own` matches the stopped line and
 * only the stopped line, which keeps every brief that already greps for that phrase correct rather
 * than stale — asserted in `quit-verdict.test.mjs`, not hoped for.
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
 * ⚠️ **A non-string is `exited`, and that is the wrong-but-safe direction on purpose.** The caller
 * reads the app's output from a FILE whose read already answers `''` on failure, and a gate that
 * announced a force-stop because its own `readFileSync` threw would be `326` again — an instrument
 * reporting itself as the product. ⛔ The honest guard against a lost report is the gate's own
 * shutdown-report assertion, which is red rather than green and runs first.
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
 * The verdict, its cell, and the head of the line `quit:check` prints.
 *
 * ⛔ **The head, rather than the whole line, and the boundary is deliberate.** Everything after it
 * — window, port, gate, teardown — is measurement the gate owns and this module has no opinion
 * about; folding it in here would move six numbers into a file whose subject is one word, and would
 * put a second copy of `since()` in the tree.
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
