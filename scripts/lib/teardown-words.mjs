/**
 * What a `tearDownAndRemove` outcome could not establish, in the words a person reading a red line
 * needs. The gates add their own lead-in and what they did with the user-data directory.
 */

/** Which pids are left: still alive, still in the table on their way out, or unverifiable. */
export const pidsLeft = (outcome) =>
  `${outcome.remaining.length === 0 ? 'no pid is still alive' : `pid(s) ${outcome.remaining.join(', ')} are still alive`}` +
  // Still in the table on its way out is its own fact: folding it into `remaining` would send a
  // reader looking for a leak.
  (outcome.exiting.length > 0
    ? `, pid(s) ${outcome.exiting.join(', ')} are still in the process table on their way out`
    : '') +
  (outcome.unverifiable.length > 0
    ? `, and pid(s) ${outcome.unverifiable.join(', ')} could not be verified either way`
    : '')

/**
 * ⛔ **The third answer, in `352`'s words** (360). A teardown that could not establish what it owns
 * has not completed — and what it could not decide about is a sentence, not a pid, so it goes below
 * the pid lists rather than inside them.
 */
export const refusals = (outcome) =>
  outcome.refused.length === 0
    ? ''
    : `\n   ⛔ refused · ${String(outcome.refused.length)} thing(s) this teardown will not ` +
      `decide about:\n` +
      outcome.refused.map((why) => `      · ${why}`).join('\n')
