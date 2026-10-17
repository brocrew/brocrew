/**
 * Distinguish a step that ran without asserting its subject from a PASS, failure or skipped
 * step. A provider may decline to plan, compact or finish a phase; that observation is
 * NOT ASSERTED, not an app failure and not verified coverage. Count and print it separately.
 * Share the outcome fold so direct controls can exercise provider-dependent branches.
 */

const MARK = Symbol.for('brobot2.smoke.not-asserted')
const CLAIMS = Symbol.for('brobot2.smoke.claims')
const UNPERFORMED = Symbol.for('brobot2.smoke.not-performed')

/**
 * What a step returns when it ran and could not reach its claim.
 *
 * @param {string} why — what was not asserted, and what the step DID establish instead.
 */
export function notAsserted(why) {
  return { [MARK]: true, why }
}

/** @param {unknown} value */
export function isNotAsserted(value) {
  return typeof value === 'object' && value !== null && Boolean(value[MARK])
}

/**
 * ⛔ **The FIFTH cell: a step whose SUBJECT the product no longer offers** (420 §4, standing rule 13).
 *
 * ⚠️ **It is a different absence from {@link notAsserted} and conflating them would lose the one
 * that is actionable.** A blank step ASKED and the provider declined — the model chose not to plan,
 * nothing was behind the archive. Nobody can act on that; it is weather. A **NOT PERFORMED** step
 * never asked, because the gesture it exists to make has been taken out of the product or the wait
 * it needed ran past its deadline. ⚑ **That is a fact about US**, and somebody can act on it: either
 * the surface comes back, or the rule the step carried is a rule nothing measures any more.
 *
 * 🔴 **The rule it exists to enforce** (420 §4): *"An instrument may lose a step. It may not lose a
 * step silently."* ⛔ A step whose control was deleted has exactly three honest endings — drive it
 * another way, move it to the surface that now carries it, or report it here **with the reason** and
 * file the capability as a finding. ⚠️ **What must never happen is the fourth**: deleting the step,
 * or quietly returning early, and letting the headline keep its old denominator.
 *
 * ⚑ **And it is NOT a `skip`.** A skipped step was not selected for this run and might be green in
 * the next one; this one cannot be performed by anybody, today, and says so on every run until the
 * product changes. `skip` moves the denominator; this does not.
 *
 * @param {string} why — what could not be performed, and why. ⛔ Name the surface or the deadline;
 *   *"not reachable"* on its own is the silence this cell exists to break.
 * @param {{ deadlineMs?: number }} [bound] — for §13's other half: a wait that ran out. The
 *   deadline is printed with the row, because *"not performed, deadline 90s"* is a different fact
 *   from *"not performed, the control is gone"* and the reader has to be able to tell them apart.
 */
export function notPerformed(why, bound = {}) {
  if (typeof why !== 'string' || why.trim() === '') {
    throw new Error(
      'smoke-verdicts: notPerformed() needs a reason — an unexplained absence is the silence it exists to break',
    )
  }
  const said = bound.deadlineMs === undefined ? why : `${why} (deadline ${bound.deadlineMs}ms)`
  return { [UNPERFORMED]: true, why: said }
}

/** @param {unknown} value */
export function isNotPerformed(value) {
  return typeof value === 'object' && value !== null && Boolean(value[UNPERFORMED])
}

/**
 * ⛔ **A step's sub-claims were English inside its result string, and the headline summed the
 * step** (206 H1, from 193's class and one layer above 196 H1).
 *
 * `196` gave a STEP the fourth cell. It did not give one to a step's individual claims — and
 * several steps make three. `ui-live-smoke.mjs` step 58 returned, in one string,
 * *"1 ASSERTED, 2 ASSERTED (positive half), 3 NOT ASSERTED"*, and `record(true, …)` summed the
 * whole thing as one PASS. ⚠️ **That is not hypothetical**: dispatch `138` ran exactly that, and the
 * headline it produced was quoted onwards as evidence.
 *
 * ⛔ **String-matching the result was already ruled out, in this file's own test** (`142`): several
 * steps quote "NOT ASSERTED" about a SUB-claim while asserting everything else they exist for, so
 * sweeping on the words would understate the run in the other direction. The verdict has to be
 * DATA, per claim — which is what these three functions are.
 *
 * ⚑ **And the words leave the string.** A claim carries what was checked; the verdict is the type.
 * That is what makes the invariant checkable from outside (`scripts/test/smoke-claims.test.mjs`
 * reads the smoke's source for it) rather than a convention the next author has to remember.
 *
 * @typedef {{ claim: string, verdict: 'ASSERTED' | 'NOT ASSERTED' }} Claim
 */

/** A claim this run reached. @param {string} what @returns {Claim} */
export function asserted(what) {
  return { claim: what, verdict: 'ASSERTED' }
}

/** A claim this run could NOT reach, and why. @param {string} what @returns {Claim} */
export function unasserted(what) {
  return { claim: what, verdict: 'NOT ASSERTED' }
}

/**
 * What a step returns when it makes MORE THAN ONE claim.
 *
 * ⛔ **Throws on an empty list rather than returning one.** A step whose claims collapsed to none —
 * a `.filter` that matched nothing, a branch that fell through — would otherwise report as a step
 * that ran and asserted nothing at all, indistinguishable from an honest blank, and would count
 * zero in both columns. That is `129`'s trap on the instrument that exists to close it.
 *
 * @param {...Claim} entries
 */
export function claims(...entries) {
  if (entries.length === 0) {
    throw new Error(
      'smoke-verdicts: claims() with no claims is a step reporting nothing — pass at least one',
    )
  }
  for (const entry of entries) {
    if (typeof entry?.claim !== 'string' || entry.claim === '') {
      throw new Error('smoke-verdicts: every claim needs to say what was checked')
    }
    if (entry.verdict !== 'ASSERTED' && entry.verdict !== 'NOT ASSERTED') {
      throw new Error(
        `smoke-verdicts: "${entry.claim}" has no verdict — use asserted()/unasserted()`,
      )
    }
  }
  return { [CLAIMS]: true, entries }
}

/** @param {unknown} value */
export function isClaims(value) {
  return typeof value === 'object' && value !== null && Boolean(value[CLAIMS])
}

/**
 * The verdict, the detail, and the CLAIMS for whatever a step's callback returned.
 *
 * ⚠️ A step that returns nothing is a PASS with no detail — the majority of them — so the absence
 * of a return value must never be confused with the absence of an assertion.
 *
 * ⛔ **Every outcome normalizes to a claim list**, including the two that existed before (206 H1).
 * An ordinary step is one claim, asserted; a `notAsserted(…)` step is one claim, not asserted; a
 * `claims(…)` step is however many it makes. That is what lets `summarize` count claims across a
 * run without knowing which shape any given step used.
 *
 * ⚑ **A step with at least one asserted claim is a PASS.** It checked something, and calling the
 * whole step blank would understate it exactly as badly as calling it a clean pass overstates it —
 * the two errors 142's test pins are the two directions of the same mistake. The unreached claims
 * are counted in their own column instead.
 *
 * @param {unknown} outcome
 * @returns {{ verdict: 'PASS' | 'NOT ASSERTED' | 'NOT PERFORMED', detail: string | undefined, claims: Claim[] }}
 */
export function outcomeVerdict(outcome) {
  if (isClaims(outcome)) {
    const entries = outcome.entries
    return {
      verdict: entries.some((entry) => entry.verdict === 'ASSERTED') ? 'PASS' : 'NOT ASSERTED',
      // The per-step LINE still prints every claim and its verdict verbatim — it always did, and
      // 206 H1 is about the aggregate above it, not about what a step says for itself.
      detail: entries.map((entry) => `${entry.verdict}: ${entry.claim}`).join(' · '),
      claims: entries,
    }
  }
  if (isNotPerformed(outcome)) {
    // ⚑ **One unreached claim, exactly as a blank step contributes one** — the step made no
    // assertion and the claim column must not pretend otherwise. ⚠️ The two cells are told apart at
    // the STEP level, which is where the difference is actionable; a claim that was never reached is
    // the same shape of nothing whichever way it got there.
    return { verdict: 'NOT PERFORMED', detail: outcome.why, claims: [unasserted(outcome.why)] }
  }
  if (isNotAsserted(outcome)) {
    return { verdict: 'NOT ASSERTED', detail: outcome.why, claims: [unasserted(outcome.why)] }
  }
  const detail = outcome === undefined || outcome === null ? undefined : String(outcome)
  return { verdict: 'PASS', detail, claims: [asserted(detail ?? 'what the step exists to check')] }
}

/**
 * The run's headline, with the four verdicts kept apart.
 *
 * ⛔ **The denominator is still every result**, so nothing is hidden by being renamed; what changed
 * is that `passed` no longer absorbs the cells that asserted nothing.
 *
 * ⛔ **And since 202, the failed cell is PRINTED.** This function has computed `failed` since 196
 * and never put it in the line: a run with one red step read `86/88 passed · ⚠️ 1 ran but asserted
 * nothing · 1 skipped`, and the only trace of the failure in the headline was two missing from the
 * denominator. ⚑ That is 196's own subject — *every green is a claim* — one layer up from where 196
 * fixed it, and it was found by a 202 step going red and the summary not saying so.
 *
 * ⛔ **And the CLAIMS are counted beside the steps** (206 H1). A run of 90 steps in which three
 * steps each left one of three sub-claims unreached used to read `90/90 passed`; it now says how
 * many claims those 90 steps actually reached. ⚠️ **Both numbers, never one**: claims alone would
 * hide which step is in trouble, and steps alone is the defect.
 *
 * ⛔ **And since 420, the fifth and sixth cells are printed too** — `NOT PERFORMED` (a step whose
 * gesture the product no longer offers, or whose wait ran out) and `NOT REACHED` (a step the run
 * never got to, because an earlier one aborted the sequence). ⚠️ **Neither is a `skip` and neither
 * is a blank**, and `417` is why they are now separate cells: it removed three launcher controls,
 * every step that drove them died, and the words available to say so were *"FAIL"* — which reads
 * as a broken app — or silence. 🔴 **Standing rule 13**: *"a step past its own deadline is NOT
 * PERFORMED"*, and *"a report is computed from the outcome, not from the plan."*
 *
 * ⚑ **`notReached` is the caller's number, not this function's, and it has to be.** It is
 * `<the steps this instrument offers> − <the ones that produced a row> − <the ones it skipped>`,
 * and only the caller knows the first term: a run that aborts never calls `step()` again, so the
 * missing tokens leave no trace in `results` at all. ⛔ A summary computed from `results` alone
 * cannot see the steps that never happened — which is exactly the absence this cell is for.
 *
 * @param {readonly { verdict: string, line: string, name?: string, claims?: Claim[] }[]} results
 * @param {{ skipped?: number, notReached?: number, evidence?: string }} [context]
 * @returns {{ passed: number, failed: number, blank: number, notPerformed: number, notReached: number, claimsAsserted: number, claimsTotal: number, line: string, blanks: string[], unperformed: string[], blankClaims: string[] }}
 */
export function summarize(results, context = {}) {
  const of = (verdict) => results.filter((r) => r.verdict === verdict)
  const passed = of('PASS').length
  const failed = of('FAIL').length
  const blank = of('NOT ASSERTED').length
  const unperformed = of('NOT PERFORMED').length
  const notReached = context.notReached ?? 0
  const skipped = context.skipped ?? 0
  const everyClaim = results.flatMap((r) => r.claims ?? [])
  const claimsAsserted = everyClaim.filter((c) => c.verdict === 'ASSERTED').length
  const claimsTotal = everyClaim.length
  const line =
    `${passed}/${results.length} passed` +
    (blank > 0 ? ` · ⚠️ ${blank} ran but asserted nothing` : '') +
    // ⛔ **Printed whenever there is one, and never folded into the blanks.** These are the steps
    // this instrument is no longer performing at all, and a reader who cannot see the number cannot
    // tell a suite that got smaller from a suite that got greener (420 §4).
    (unperformed > 0 ? ` · ⚑ ${unperformed} NOT PERFORMED` : '') +
    (notReached > 0 ? ` · ⚑ ${notReached} NOT REACHED` : '') +
    (claimsTotal > 0 ? ` · ${claimsAsserted}/${claimsTotal} claims asserted` : '') +
    (skipped > 0 ? ` · ${skipped} skipped` : '') +
    (failed > 0 ? ` · ⛔ ${failed} FAILED` : '') +
    (context.evidence ? ` · evidence in ${context.evidence}` : '')
  // Named individually: "four steps asserted nothing" is only actionable if you know WHICH four,
  // and the reason is usually a fact about the provider worth reading. ⚑ The same rule one level
  // down: a claim nobody can name is a number nobody can act on.
  const blankClaims = results.flatMap((r) =>
    (r.claims ?? [])
      .filter((c) => c.verdict === 'NOT ASSERTED')
      .map((c) => `${r.name ?? r.line} → ${c.claim}`),
  )
  return {
    passed,
    failed,
    blank,
    notPerformed: unperformed,
    notReached,
    claimsAsserted,
    claimsTotal,
    line,
    blanks: of('NOT ASSERTED').map((r) => r.line),
    // ⚑ **Named individually, for the blanks' own reason one cell over.** *"Two steps were not
    // performed"* is only actionable if you know which two and what took them away — and unlike a
    // blank, the answer is a thing somebody can put back.
    unperformed: of('NOT PERFORMED').map((r) => r.line),
    blankClaims,
  }
}
