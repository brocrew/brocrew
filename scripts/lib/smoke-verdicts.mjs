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
 * A step whose subject the product no longer offers, or whose wait ran past its deadline.
 *
 * This differs from {@link notAsserted}: a blank step asked and the provider declined, which
 * nobody can act on. A NOT PERFORMED step never asked, because its gesture was removed from the
 * product or its wait ran out. That is a fact about us: either the surface comes back, or the rule
 * the step carried is no longer measured.
 *
 * An instrument may lose a step, but not silently. A step whose control was deleted has three
 * honest endings: drive it another way, move it to the surface that now carries it, or report it
 * here with the reason and file the capability as a finding. Never delete the step or return
 * early and leave the headline with its old denominator.
 *
 * It is not a `skip`: a skipped step was not selected for this run and might be green in the
 * next, while this one cannot be performed today and says so every run. `skip` moves the
 * denominator; this does not.
 *
 * @param {string} why — what could not be performed, and why. Name the surface or the deadline;
 *   "not reachable" alone is the silence this cell exists to break.
 * @param {{ deadlineMs?: number }} [bound] — for a wait that ran out. The deadline is printed with
 *   the row, because "not performed, deadline 90s" differs from "not performed, the control is
 *   gone".
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
 * A step's sub-claims are data, not English inside its result string: a claim carries what was
 * checked and the verdict is the type. Otherwise a step returning "1 ASSERTED, 2 ASSERTED,
 * 3 NOT ASSERTED" would be summed as one PASS. String-matching "NOT ASSERTED" is no alternative,
 * since several steps quote it about a sub-claim while asserting everything else they exist for.
 * Being data also makes the invariant checkable from outside (`scripts/test/smoke-claims.test.mjs`
 * reads the smoke's source for it).
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
 * What a step returns when it makes more than one claim.
 *
 * Throws on an empty list: a step whose claims collapsed to none (a `.filter` that matched
 * nothing, a branch that fell through) would otherwise look like an honest blank and count zero
 * in both columns.
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
function isClaims(value) {
  return typeof value === 'object' && value !== null && Boolean(value[CLAIMS])
}

/**
 * The verdict, the detail, and the claims for whatever a step's callback returned.
 *
 * A step that returns nothing is a PASS with no detail, so the absence of a return value must
 * never be confused with the absence of an assertion.
 *
 * Every outcome normalizes to a claim list: an ordinary step is one asserted claim, a
 * `notAsserted(…)` step is one unasserted claim, a `claims(…)` step is however many it makes. That
 * lets `summarize` count claims without knowing which shape a step used.
 *
 * A step with at least one asserted claim is a PASS: calling it blank would understate it as
 * badly as calling it clean would overstate it. The unreached claims are counted in their own
 * column.
 *
 * @param {unknown} outcome
 * @returns {{ verdict: 'PASS' | 'NOT ASSERTED' | 'NOT PERFORMED', detail: string | undefined, claims: Claim[] }}
 */
export function outcomeVerdict(outcome) {
  if (isClaims(outcome)) {
    const entries = outcome.entries
    return {
      verdict: entries.some((entry) => entry.verdict === 'ASSERTED') ? 'PASS' : 'NOT ASSERTED',
      // The per-step line still prints every claim and its verdict verbatim.
      detail: entries.map((entry) => `${entry.verdict}: ${entry.claim}`).join(' · '),
      claims: entries,
    }
  }
  if (isNotPerformed(outcome)) {
    // One unreached claim, as a blank step contributes one. The two cells are told apart at the step
    // level, where the difference is actionable.
    return { verdict: 'NOT PERFORMED', detail: outcome.why, claims: [unasserted(outcome.why)] }
  }
  if (isNotAsserted(outcome)) {
    return { verdict: 'NOT ASSERTED', detail: outcome.why, claims: [unasserted(outcome.why)] }
  }
  const detail = outcome === undefined || outcome === null ? undefined : String(outcome)
  return { verdict: 'PASS', detail, claims: [asserted(detail ?? 'what the step exists to check')] }
}

/**
 * The run's headline, with the verdicts kept apart.
 *
 * The denominator is every result, so nothing is hidden by renaming; `passed` does not absorb the
 * cells that asserted nothing. The failed cell is printed, and the claims are counted beside the
 * steps: both numbers are needed, since claims alone hide which step is in trouble and steps alone
 * hide unreached claims. `NOT PERFORMED` (the gesture is gone, or the wait ran out) and
 * `NOT REACHED` (an earlier step aborted the sequence) are printed too; neither is a `skip` or a
 * blank. A step past its own deadline is NOT PERFORMED, and a report is computed from the outcome,
 * not from the plan.
 *
 * `notReached` is the caller's number: `<the steps this instrument offers> − <the ones that
 * produced a row> − <the ones it skipped>`. Only the caller knows the first term, since a run that
 * aborts never calls `step()` again and the missing steps leave no trace in `results`.
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
    // Printed whenever there is one, and never folded into the blanks: a reader who cannot see the
    // number cannot tell a suite that got smaller from one that got greener.
    (unperformed > 0 ? ` · ⚑ ${unperformed} NOT PERFORMED` : '') +
    (notReached > 0 ? ` · ⚑ ${notReached} NOT REACHED` : '') +
    (claimsTotal > 0 ? ` · ${claimsAsserted}/${claimsTotal} claims asserted` : '') +
    (skipped > 0 ? ` · ${skipped} skipped` : '') +
    (failed > 0 ? ` · ⛔ ${failed} FAILED` : '') +
    (context.evidence ? ` · evidence in ${context.evidence}` : '')
  // Named individually: "four steps asserted nothing" is only actionable if you know which four,
  // and the reason is usually a fact about the provider worth reading.
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
    // Named individually for the same reason; unlike a blank, the answer is something somebody can
    // put back.
    unperformed: of('NOT PERFORMED').map((r) => r.line),
    blankClaims,
  }
}
