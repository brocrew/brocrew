import { describe, expect, it } from 'vitest'
import {
  asserted,
  claims,
  isNotAsserted,
  isNotPerformed,
  notAsserted,
  notPerformed,
  outcomeVerdict,
  summarize,
  unasserted,
} from '../lib/smoke-verdicts.mjs'

/**
 * ⛔ **196 H1, the live-smoke half: a step that ran and asserted nothing was counted as a pass.**
 *
 * `193` named four steps in `ui-live-smoke.mjs` that return a `NOT ASSERTED — …` sentence when the
 * provider declines to produce the thing under test. `step()` handed every ordinary return to
 * `record(true, …)`, so those sentences printed as `PASS` and were summed into the headline — and
 * the headline is the number this project has been reporting onwards.
 */
describe('the fourth outcome (196 H1)', () => {
  it('⛔ a not-asserted return is its own verdict, not a pass carrying a sad string', () => {
    const outcome = notAsserted('the provider ran no compaction for this window')
    expect(isNotAsserted(outcome)).toBe(true)
    // ⛔ The third field is 206 H1's: every outcome now normalizes to a claim list, so a run can
    // count claims as well as steps. Asserted in full rather than loosened to `toMatchObject` — a
    // shape that grew a field silently is how the last two verdict bugs got in.
    expect(outcomeVerdict(outcome)).toEqual({
      verdict: 'NOT ASSERTED',
      detail: 'the provider ran no compaction for this window',
      claims: [
        { claim: 'the provider ran no compaction for this window', verdict: 'NOT ASSERTED' },
      ],
    })
  })

  it('⚑ the paired positive — an ordinary return is still a PASS, and so is no return at all', () => {
    expect(outcomeVerdict('2500 frames archived')).toEqual({
      verdict: 'PASS',
      detail: '2500 frames archived',
      claims: [{ claim: '2500 frames archived', verdict: 'ASSERTED' }],
    })
    // The majority of steps return nothing. "Returned nothing" must never read as "asserted nothing".
    expect(outcomeVerdict(undefined)).toEqual({
      verdict: 'PASS',
      detail: undefined,
      // ⚑ …and it is still ONE asserted claim, so an ordinary step contributes to the ratio rather
      // than sitting outside it. A step with no claims would make the run's denominator a figure
      // about the steps that opted in.
      claims: [{ claim: 'what the step exists to check', verdict: 'ASSERTED' }],
    })
  })

  it('a step that merely PRINTS the words is not laundered into the fourth cell either', () => {
    // ⚠️ The four steps carried the sentence long before it carried a verdict, and several other
    // steps quote "NOT ASSERTED" about a SUB-claim while asserting everything else they exist for.
    // Matching on the string would have swept those into the blank column and understated the run.
    expect(isNotAsserted('NOT ASSERTED — the provider declined')).toBe(false)
    expect(outcomeVerdict('3 NOT ASSERTED — no prose row was ever SEEN').verdict).toBe('PASS')

    // ⛔ **CORRECTED, not deleted, and 206 H1 is what it was missing** (142's rule about this very
    // file). Both lines above are still right — string-matching a result would understate the run —
    // and what neither of them said is that such a step is nonetheless MIS-counted: it makes three
    // claims and the headline had a column for one. The right answer is not a better match on the
    // string, it is for the step to stop putting a verdict in one.
    expect(outcomeVerdict('3 NOT ASSERTED — no prose row was ever SEEN').claims).toEqual([
      { claim: '3 NOT ASSERTED — no prose row was ever SEEN', verdict: 'ASSERTED' },
    ])
    const typed = outcomeVerdict(
      claims(asserted('1 · the child tagged its rows'), unasserted('3 · no tool row to be after')),
    )
    expect(typed.verdict).toBe('PASS') // it DID check something — see below
    expect(typed.claims.filter((c) => c.verdict === 'NOT ASSERTED')).toHaveLength(1)
    // ⚠️ The source-level half of this rule — that no step writes the words into a sentence at all
    // — is `smoke-claims.test.mjs`, because it is the half a value can never enforce.
  })

  it('⛔ the headline keeps the three verdicts apart, over 193 exact numbers', () => {
    // `188` ran 86 results: 85 PASS + 1 SKIP. Four of the 85 were blanks nobody could see.
    const results = [
      ...Array.from({ length: 81 }, (_, i) => ({ verdict: 'PASS', line: `PASS ${i}` })),
      ...Array.from({ length: 4 }, (_, i) => ({
        verdict: 'NOT ASSERTED',
        line: `NOT ASSERTED ${i}`,
      })),
    ]
    const summary = summarize(results, { skipped: 1, evidence: '/tmp/evidence' })
    expect(summary).toMatchObject({ passed: 81, failed: 0, blank: 4 })
    expect(summary.line).toBe(
      '81/85 passed · ⚠️ 4 ran but asserted nothing · 1 skipped · evidence in /tmp/evidence',
    )
    // ⚑ The denominator is unchanged: nothing is hidden by being renamed. What is gone is the
    // sentence "85/85 passed" over a run in which 81 things were checked.
    expect(summary.line).not.toContain('85/85')
    // …and WHICH four, because a count nobody can act on is the defect one level up.
    expect(summary.blanks).toHaveLength(4)
  })

  it('⚑ a run with no blanks reads exactly as it always did', () => {
    const results = Array.from({ length: 12 }, (_, i) => ({ verdict: 'PASS', line: `PASS ${i}` }))
    expect(summarize(results).line).toBe('12/12 passed')
    expect(summarize(results).blanks).toEqual([])
  })

  it('a failure still counts as a failure, and is not softened into a blank', () => {
    const results = [
      { verdict: 'PASS', line: 'PASS 1' },
      { verdict: 'FAIL', line: 'FAIL 2 — the drawer never opened' },
      { verdict: 'NOT ASSERTED', line: 'NOT ASSERTED 3 — no plan arrived' },
    ]
    expect(summarize(results)).toMatchObject({ passed: 1, failed: 1, blank: 1 })
    // ⛔ **This line used to read `'1/3 passed · ⚠️ 1 ran but asserted nothing'`** — and it was
    // pinned that way, under a test whose own name says a failure is not softened. It was: in the
    // NUMBER, which nobody reads, and not in the sentence, which is what a run reports onwards.
    // 202 found it by having a step go red and the headline not say so.
    expect(summarize(results).line).toBe('1/3 passed · ⚠️ 1 ran but asserted nothing · ⛔ 1 FAILED')
  })

  it('⚑ …and a clean run still says nothing about failures', () => {
    // The pairing: the new cell must not appear when there is nothing to report, or every green run
    // grows a `⛔ 0 FAILED` and the marker stops meaning anything.
    const results = [{ verdict: 'PASS', line: 'PASS 1' }]
    expect(summarize(results).line).toBe('1/1 passed')
    expect(summarize(results).line).not.toContain('FAILED')
  })
})

/**
 * ⛔ **206 H1 · one level down: a step's own sub-claims.**
 *
 * `196` gave a STEP the fourth cell. Several steps make three claims, and those were English inside
 * the result string — so `ui-live-smoke.mjs` step 58 returned *"1 ASSERTED, 2 ASSERTED (positive
 * half), 3 NOT ASSERTED"* and the run summed it as one clean PASS. Dispatch `138` ran exactly that,
 * and the headline was quoted onwards as evidence.
 */
describe('per-claim results (206 H1)', () => {
  it('⛔ a step with three claims counts as three, not as one pass', () => {
    const outcome = outcomeVerdict(
      claims(
        asserted('1 · [CHILD] rows on the card'),
        asserted('2 · the answer renders once'),
        unasserted('3 · the card held no tool row, so there is no boundary'),
      ),
    )

    expect(outcome.verdict).toBe('PASS')
    const summary = summarize([{ verdict: outcome.verdict, line: 'PASS 58', ...outcome }])
    expect(summary).toMatchObject({ passed: 1, claimsAsserted: 2, claimsTotal: 3 })
    // ⛔ The sentence 138's run could not say about itself.
    expect(summary.line).toBe('1/1 passed · 2/3 claims asserted')
    // …and WHICH claim, because a count nobody can act on is the defect one level up (196).
    expect(summary.blankClaims).toEqual([
      'PASS 58 → 3 · the card held no tool row, so there is no boundary',
    ])
  })

  it('⛔ a step whose EVERY claim went unreached is the fourth cell, not a pass', () => {
    const outcome = outcomeVerdict(
      claims(
        unasserted('the provider planned nothing'),
        unasserted('so there was no plan to open'),
      ),
    )

    expect(outcome.verdict).toBe('NOT ASSERTED')
    expect(
      summarize([{ verdict: outcome.verdict, line: 'NOT ASSERTED 16', ...outcome }]),
    ).toMatchObject({ passed: 0, blank: 1, claimsAsserted: 0, claimsTotal: 2 })
  })

  it('⚑ the two shapes that existed before still count as exactly one claim each', () => {
    // Every ordinary step is one claim, asserted — which is what makes the run's ratio a whole
    // number over a whole run rather than a figure about the three steps that opted in.
    expect(outcomeVerdict(undefined).claims).toEqual([
      { claim: 'what the step exists to check', verdict: 'ASSERTED' },
    ])
    expect(outcomeVerdict('2500 frames archived').claims).toEqual([
      { claim: '2500 frames archived', verdict: 'ASSERTED' },
    ])
    expect(outcomeVerdict(notAsserted('the provider ran no compaction')).claims).toEqual([
      { claim: 'the provider ran no compaction', verdict: 'NOT ASSERTED' },
    ])
  })

  it('⛔ a FAILED step contributes no claims, rather than an invented unreached one', () => {
    // `record` passes none for a throw: the step did not finish, so what it would have claimed is
    // unknown, and a number on something nobody measured is the shape this whole file exists about.
    const summary = summarize([
      { verdict: 'FAIL', line: 'FAIL 12 — the drawer never opened', claims: [] },
      { verdict: 'PASS', line: 'PASS 13', claims: [asserted('the drawer opened')] },
    ])
    expect(summary).toMatchObject({ failed: 1, claimsAsserted: 1, claimsTotal: 1 })
    expect(summary.line).toBe('1/2 passed · 1/1 claims asserted · ⛔ 1 FAILED')
  })

  it('⛔ refuses a claim list that collapsed to nothing, and one with no verdict', () => {
    // 129's trap on the instrument built to close it: a step whose claims filtered down to none
    // would report as an honest blank and count zero in both columns.
    expect(() => claims()).toThrow(/at least one/)
    expect(() => claims({ claim: 'something', verdict: 'PROBABLY' })).toThrow(/no verdict/)
    expect(() => claims({ verdict: 'ASSERTED' })).toThrow(/what was checked/)
  })

  it('⚑ a run with no claims at all reads exactly as it did before', () => {
    // The synthetic results in the block above carry none, and the cell must not appear for them —
    // the same pairing `⛔ 0 FAILED` gets.
    expect(summarize([{ verdict: 'PASS', line: 'PASS 1' }]).line).toBe('1/1 passed')
    expect(summarize([{ verdict: 'PASS', line: 'PASS 1' }]).line).not.toContain('claims')
  })
})

/**
 * 🔴 **420 §4 · the fifth and sixth cells: a step the instrument is no longer performing.**
 *
 * ⛔ **`417` removed three launcher controls and fifty-four steps across three live instruments lost
 * the only gesture they had.** The vocabulary available to say so was `FAIL` — which reads as a
 * broken app and teaches people to ignore reds — or a deletion, which is silence. The rule 420 was
 * given is one sentence: *"An instrument may lose a step. It may not lose a step silently."*
 *
 * ⚠️ **Two absences, and they are not the same absence.**
 *
 *  - **NOT PERFORMED** — the step was reached and could not be done: the surface is gone, or a
 *    bounded wait ran out (standing rule 13). It is a fact about US and somebody can act on it.
 *  - **NOT REACHED** — the run never got to the step, because something earlier aborted the
 *    sequence. ⛔ It leaves no trace in `results` at all, which is why the count is the caller's.
 *
 * ⚑ **And both are apart from `skip`**, which means *not selected for this run* and might be green
 * in the next one.
 */
describe('the fifth and sixth cells (420 §4)', () => {
  it('⛔ a not-performed return is its own verdict — not a FAIL, not a blank, not a pass', () => {
    const outcome = notPerformed(
      'the launcher has no provider control since 417 (HO-022 §2), so Claude cannot be asked for',
    )
    expect(isNotPerformed(outcome)).toBe(true)
    expect(outcomeVerdict(outcome)).toEqual({
      verdict: 'NOT PERFORMED',
      detail:
        'the launcher has no provider control since 417 (HO-022 §2), so Claude cannot be asked for',
      claims: [
        {
          claim:
            'the launcher has no provider control since 417 (HO-022 §2), so Claude cannot be asked for',
          verdict: 'NOT ASSERTED',
        },
      ],
    })
  })

  it('⛔ …and the two absences do not answer each other’s predicate', () => {
    // ⚠️ **The control the fourth cell needed too.** Both are `Symbol.for` marks on a plain object,
    // so a shared brand — or one predicate written as `typeof value === 'object'` — would make
    // every blank step report as unperformed and the count that matters would be noise.
    expect(isNotAsserted(notPerformed('the control is gone'))).toBe(false)
    expect(isNotPerformed(notAsserted('the provider ran no compaction'))).toBe(false)
    // …and the words alone launder nothing, for the fourth cell's own reason: several steps quote
    // this phrase about a sub-claim while performing everything else they exist for.
    expect(isNotPerformed('NOT PERFORMED — the launcher has no provider control')).toBe(false)
    expect(outcomeVerdict('NOT PERFORMED — the launcher has no provider control').verdict).toBe(
      'PASS',
    )
  })

  it('⛔ refuses an unexplained absence — the silence it exists to break', () => {
    // 🔴 **The whole cell is the REASON.** A row reading `NOT PERFORMED 13` with nothing after it
    // is a step that vanished with extra steps, and the next reader has to re-derive why. The
    // constructor is where that can be made impossible.
    expect(() => notPerformed('')).toThrow(/needs a reason/)
    expect(() => notPerformed('   ')).toThrow(/needs a reason/)
    expect(() => notPerformed(undefined)).toThrow(/needs a reason/)
  })

  it('⚑ …and §13’s other half — a wait that ran out carries its deadline into the row', () => {
    // ⛔ *"A table row that says 'not performed, deadline 90s' is worth more than a run that is
    // still going."* The two reasons must be tellable apart by a reader of the log alone: a control
    // that is gone comes back when somebody builds it; a deadline comes back on a quieter machine.
    expect(notPerformed('the provider never answered', { deadlineMs: 90_000 }).why).toBe(
      'the provider never answered (deadline 90000ms)',
    )
    expect(notPerformed('the provider never answered').why).toBe('the provider never answered')
  })

  it('⛔ the headline keeps all six cells apart, and names which steps went where', () => {
    const results = [
      ...Array.from({ length: 40 }, (_, i) => ({ verdict: 'PASS', line: `PASS ${i}` })),
      { verdict: 'NOT ASSERTED', line: 'NOT ASSERTED 16 — the model planned nothing today' },
      { verdict: 'NOT PERFORMED', line: 'NOT PERFORMED 13 — the launcher has no provider control' },
      { verdict: 'NOT PERFORMED', line: 'NOT PERFORMED 46 — the cwd field was deleted by 417' },
      { verdict: 'FAIL', line: 'FAIL 9 — the drawer never opened' },
    ]
    const summary = summarize(results, {
      skipped: 3,
      notReached: 2,
      evidence: '/tmp/evidence',
    })
    expect(summary).toMatchObject({
      passed: 40,
      failed: 1,
      blank: 1,
      notPerformed: 2,
      notReached: 2,
    })
    expect(summary.line).toBe(
      '40/44 passed · ⚠️ 1 ran but asserted nothing · ⚑ 2 NOT PERFORMED · ⚑ 2 NOT REACHED · ' +
        '3 skipped · ⛔ 1 FAILED · evidence in /tmp/evidence',
    )
    // ⛔ **The denominator still counts them**, for the fourth cell's reason: a run that stopped
    // performing two steps must not read as a smaller, greener run.
    expect(summary.line).not.toContain('40/40')
    expect(summary.line).not.toContain('40/42')
    // …and WHICH two, because a capability nobody can name is a capability nobody puts back.
    expect(summary.unperformed).toEqual([
      'NOT PERFORMED 13 — the launcher has no provider control',
      'NOT PERFORMED 46 — the cwd field was deleted by 417',
    ])
  })

  it('⚑ a run with neither cell reads exactly as it did before 420', () => {
    // The pairing every new cell owes: it must be invisible when there is nothing to report, or
    // `⚑ 0 NOT PERFORMED` joins every green run and the marker stops meaning anything.
    const results = Array.from({ length: 7 }, (_, i) => ({ verdict: 'PASS', line: `PASS ${i}` }))
    expect(summarize(results).line).toBe('7/7 passed')
    expect(summarize(results)).toMatchObject({ notPerformed: 0, notReached: 0 })
    expect(summarize(results).unperformed).toEqual([])
    expect(summarize(results).line).not.toContain('NOT PERFORMED')
    expect(summarize(results).line).not.toContain('NOT REACHED')
  })

  it('⛔ NOT REACHED is the CALLER’s number — results alone cannot see a step that never ran', () => {
    // 🔴 **The reason this parameter exists rather than being derived here.** A run that aborts
    // never calls `step()` again, so the tokens it skipped past leave nothing behind to count. Only
    // the instrument knows its own census. Passing 0 must therefore be a real claim of "none", and
    // omitting it must not invent one.
    const results = [{ verdict: 'PASS', line: 'PASS 1' }]
    expect(summarize(results, { notReached: 61 }).line).toBe('1/1 passed · ⚑ 61 NOT REACHED')
    expect(summarize(results, { notReached: 0 }).line).toBe('1/1 passed')
    expect(summarize(results).notReached).toBe(0)
  })
})
