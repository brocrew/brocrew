import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { constantFrom, providerRoster } from '../lib/app-source.mjs'
import {
  CENSUS,
  DEPARTED,
  EVER_AT_LEAST,
  EXPOSED,
  EXPOSED_EVER,
  GUARDED,
  RETIRED,
  WITHDRAWN,
  censusLine,
  censusNumbers,
  riskOf,
  stepTokensIn,
} from '../lib/step-census.mjs'

/**
 * ⛔ **The census is a judgement, and this is what keeps it honest** (224 §5).
 *
 * `step-census.mjs` states what a red from each live step can MEAN. Nothing about that is derivable
 * from the source — whether a step's subject needs a provider to VOLUNTEER is a fact about the
 * subject, not about the syntax — so what a test can hold is the two edges where a judgement rots:
 *
 * - **Coverage.** A step that joins the run unclassified would quietly raise the number the census
 *   exists to state. The list has to name exactly the steps the smoke offers, no more and no fewer.
 * - **Contradiction.** A step that reports a claim it could not reach is, by definition, a step with
 *   something it cannot always assert; leaving it in the `app` default would overstate the
 *   instrument. That direction is checkable from the source, and it is checked both ways.
 *
 * ⚑ **The same seam `smoke-claims.test.mjs` and `personal-home-guard.test.mjs` describe**: a live
 * smoke is the one thing `pnpm run ci` cannot run, so what the gate CAN reach has to hold the rule.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SMOKE = join(here, '../ui-live-smoke.mjs')
const SOURCE = readFileSync(SMOKE, 'utf8')

describe('fatal page deadlines (264 E5)', () => {
  it('⛔ poisons the run and rethrows before reset or any later step can mutate the page', () => {
    expect(SOURCE).toMatch(/fatalPageStall \?\?= new Error\(/)
    expect(SOURCE).toMatch(/throw fatalPageStall/)
    const stepBody = SOURCE.slice(
      SOURCE.indexOf('async function step(name, fn) {'),
      SOURCE.indexOf('/** Not run, and counted as such'),
    )
    expect(stepBody).toMatch(
      /const outcome = await fn\(\)[\s\S]*if \(fatalPageStall\) throw fatalPageStall/,
    )
    const failureRecord = stepBody.indexOf('record(false, name')
    const fatalRethrow = stepBody.indexOf('if (fatalPageStall) throw fatalPageStall', failureRecord)
    const reset = stepBody.indexOf('await resetAfterFailure()', failureRecord)
    expect(fatalRethrow).toBeGreaterThan(failureRecord)
    expect(fatalRethrow).toBeLessThan(reset)
  })

  it('⛔ reports a live-run deadline as NOT PERFORMED', () => {
    expect(SOURCE).toMatch(
      /class LiveRunDeadline[\s\S]*if \(error instanceof LiveRunDeadline\)[\s\S]*notPerformed\(error\.message, \{ deadlineMs: error\.deadlineMs \}\)/,
    )
  })

  it('⛔ gives the 480 matrix its own launch-to-result bound and owned-app stop', () => {
    const matrix = bodiesOf(SOURCE).get('82').join('\n')
    expect(matrix).toMatch(
      /withinLiveDeadline\([\s\S]*\.\.\.matrixDeadline[\s\S]*onDeadline: stopPermissionMatrixRun/,
    )
    expect(SOURCE).toMatch(
      /const stopPermissionMatrixRun = \(\) => \{\s*mainCdp\?\.close\(\)\s*launched\?\.stop\(\)/,
    )
    expect(SOURCE).toMatch(
      /permissionMatrixRunTimer = setTimeout\([\s\S]*reportPermissionMatrixDeadline\([\s\S]*new LiveRunDeadline\([\s\S]*stopPermissionMatrixRun/,
    )
    expect(matrix).toMatch(
      /if \(permissionMatrixRunTimer\) \{\s*clearTimeout\(permissionMatrixRunTimer\)/,
    )
  })
})

describe('660 · step 82’s bound is DERIVED from the roster it prices, never typed', () => {
  // ⛔ `495` retyped this pin 32 → 50 beside a smoke retyped 29 → 47: a census that mirrors a typed
  // figure pins nothing (`a-bound-written-as-the-constant-cannot-pin-it`). So the census pins the
  // DERIVATION, counts the units itself from the rosters step 82 asserts, and states the result as
  // literals on their own lines.
  // ⚠️ **739 (review round 2, #12) — the roster the budget PRICES, not only what the step runs.**
  // `739` added *Always allow* to the row outcomes, and its two rows (one per provider) are recorded
  // NOT PERFORMED and spawn nothing (`ROWS_NOT_BUILT_YET`, the step's own reason) — so the budget
  // prices ten rows and the step runs eight: an over-count of a bound, never an under-count. The
  // titles below say so, and the not-built rows are named as unrun, read off the step.
  const squash = (text) => text.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')')
  it('⛔ 674 · R20: the step budget is the margin over every unit’s worst case AND a recovery; the run adds the launch', () => {
    // ⛔ `660`'s shape — the controller plus one allowance per unit — sized the units from an
    // allocation, and `669` F-e from one good run; `674` R20 charges each what its waits can spend
    // (`step-budgets.test.mjs` recomputes each figure from the code). Anchored at BOTH ends: a term
    // appended to the expression is still a typed figure.
    expect(squash(SOURCE)).toContain(
      squash(`const PERMISSION_MATRIX_STEP_BUDGET_MS = Math.ceil(
        STEP_BUDGET_MARGIN *
          (PERMISSION_MATRIX_WORST_MS.setup +
            PERMISSION_MATRIX_UNITS.rows *
              (PERMISSION_MATRIX_WORST_MS.row + PERMISSION_MATRIX_WORST_MS.recovery) +
            PERMISSION_MATRIX_UNITS.criterion17 *
              (PERMISSION_MATRIX_WORST_MS.criterion17 + PERMISSION_MATRIX_WORST_MS.recovery)),
      )
      const PERMISSION_MATRIX_RUN_BUDGET_MS = PERMISSION_MATRIX_STEP_BUDGET_MS + LAUNCH_BUDGET_MS
      //`),
    )
    expect(SOURCE.match(/const PERMISSION_MATRIX_(STEP|RUN)_BUDGET_MS = \d/g)).toBeNull()
  })

  it('⛔ and the two derived figures are the ones the two deadlines are armed with', () => {
    // ⚑ Review of 660: a derivation nothing reads pins a declaration, not a bound.
    expect(SOURCE).toContain(
      'const localStepDeadline = Date.now() + PERMISSION_MATRIX_STEP_BUDGET_MS',
    )
    expect(SOURCE).toContain('deadlineAt: Date.now() + PERMISSION_MATRIX_RUN_BUDGET_MS,')
    expect(SOURCE).toContain('deadlineMs: PERMISSION_MATRIX_RUN_BUDGET_MS,')
  })

  it('🔴 the units it counts are the roster step 82 prices — counted here from the same sources, the not-built rows named as recorded, not run', () => {
    const units = SOURCE.match(
      /const PERMISSION_MATRIX_UNITS = \{ rows: (\d+) \* (\d+), criterion17: (\d+), criterion20: (\d+) \}/,
    )
    expect(units).not.toBeNull()
    const [, rowProviders, rowOutcomes, criterion17, criterion20] = units.map(Number)

    // ⚑ The providers and outcomes, read from the product as step 82 reads them.
    const providers = providerRoster()
    const offer = readFileSync(
      join(here, '../../apps/desktop/src/renderer/src/lib/permission-offer.ts'),
      'utf8',
    )
    const outcomes = [
      ...offer.match(/const PLACE:[^{]+\{([\s\S]*?)\n\}/)[1].matchAll(/^\s*(\w+):\s*\d+,?$/gm),
    ]
    expect(rowProviders).toBe(providers.length)
    expect(rowOutcomes).toBe(outcomes.length)

    const matrix = bodiesOf(SOURCE).get('82').join('\n')
    // ⚑ 739 · the priced rows the step does NOT run — named in its own map, each a row outcome, and
    // recorded not performed (never attempted) by the row loop.
    const notBuilt = matrix.match(/const ROWS_NOT_BUILT_YET = new Map\(\[\s*\[\s*'(\w+)',/)
    expect(notBuilt, 'step 82 names no row it records as not built').not.toBeNull()
    expect(outcomes.map((one) => one[1])).toContain(notBuilt[1])
    expect(squash(matrix)).toContain(
      squash(`const notBuilt = ROWS_NOT_BUILT_YET.get(outcome)
              if (notBuilt !== undefined) {`),
    )
    expect(squash(matrix)).toContain(
      squash(`performed: false,
                  classification: 'not-performed',`),
    )
    // ⚑ 665 · F6: C17 runs through the rows' own catch, so it is counted where it is attempted.
    expect(criterion17).toBe(
      matrix.match(/await attemptUnit\(\s*'codex',\s*'criterion-17',\s*runCriterion17Retake,/g)
        ?.length ?? 0,
    )
    // ⛔ Criterion 20 is one Cancel retake per surface in the Codex rows' surface map.
    const surfaces = matrix.match(/const criterion20Surface =[\s\S]*?\{([\s\S]*?)\}\[outcome\]/)
    expect(surfaces).not.toBeNull()
    expect(criterion20).toBe([...surfaces[1].matchAll(/^\s*\w+: '[\w-]+',?$/gm)].length)
  })

  it('⛔ and step 82 refuses at run time to meet a roster its budget did not price', () => {
    const matrix = bodiesOf(SOURCE).get('82').join('\n')
    expect(matrix).toContain(
      'if (providers.length * outcomes.length !== PERMISSION_MATRIX_UNITS.rows) {',
    )
    expect(matrix).toContain('criterion20Retakes.length === PERMISSION_MATRIX_UNITS.criterion20 &&')
    expect(squash(matrix)).toContain(
      squash(`retakes.filter((result) => result.kind === 'criterion-17-undisplayable-command')
        .length === PERMISSION_MATRIX_UNITS.criterion17 &&`),
    )
  })

  it('⚑ 669 · F-e → 674 · R20: 665’s clocks stay pinned — as the TYPICAL cost beside the budget, never its input', () => {
    // ⚑ `665`'s run `2026-09-23T16-15-26-733Z-68166` measured criterion 17 at 36,488 ms and the eight
    // rows at 21,347–50,154 ms, each criterion-20 retake (11–12 s) inside its row. `669` F-e sized the
    // budget from the longest; `674` R20 keeps it only as the typical cost the step prints beside it.
    const longest = SOURCE.match(/const PERMISSION_MATRIX_LONGEST_UNIT_MS = ([\d_]+)\n/)
    expect(longest).not.toBeNull()
    expect(Number(longest[1].replaceAll('_', ''))).toBe(
      Math.max(36_488, 50_154, 39_785, 40_148, 25_043, 36_770, 30_815, 31_563, 21_347),
    )
    const budgets = SOURCE.slice(
      SOURCE.indexOf('const PERMISSION_MATRIX_STEP_BUDGET_MS ='),
      SOURCE.indexOf('const PERMISSION_MATRIX_ELECTRON_ARGS'),
    )
    expect(budgets).not.toContain('PERMISSION_MATRIX_LONGEST_UNIT_MS')
    expect(bodiesOf(SOURCE).get('82').join('\n')).toContain(
      '`${PERMISSION_MATRIX_LONGEST_UNIT_MS}ms; ` +',
    )
  })
})

/** The body of each step, so a claim can be attributed to the step that makes it. */
function bodiesOf(source) {
  const lines = source.split('\n')
  const steps = stepTokensIn(source)
  return new Map(
    steps.map((step, index) => [
      step.token,
      lines.slice(
        step.line - 1,
        index + 1 < steps.length ? steps[index + 1].line - 1 : lines.length,
      ),
    ]),
  )
}

/** A step that reports a claim it could not reach — the source-side half of the census. */
function reportsAnUnreachedClaim(body) {
  return body.some(
    (line) =>
      /\b(unasserted|notAsserted)\(/.test(line) &&
      !line.trim().startsWith('//') &&
      !line.trim().startsWith('*'),
  )
}

describe('stepTokensIn — every step the smoke offers, and it refuses what it cannot read', () => {
  it('reads a name written straight into the call', () => {
    expect(stepTokensIn(`await step('12 two conversations at once', async () => {})`)).toEqual([
      { token: '12', title: '12 two conversations at once', line: 1 },
    ])
  })

  it('reads a name on the line after the call', () => {
    const source = [
      '  await step(',
      "    '19 plan mode — the plan is a document (030)',",
      '  )',
    ].join('\n')
    expect(stepTokensIn(source)).toEqual([
      { token: '19', title: '19 plan mode — the plan is a document (030)', line: 1 },
    ])
  })

  it('resolves a name bound to a constant, on its own line or the next', () => {
    const source = [
      "  const WATCHDOG_STEP = '26 the memory watchdog fires (052/053)'",
      '  const SWEEP_STEP =',
      "    '20 the archive sweep runs without freezing the window (046)'",
      '  await step(WATCHDOG_STEP, async () => {})',
      '  await step(SWEEP_STEP, async () => {})',
    ].join('\n')
    expect(stepTokensIn(source).map((s) => s.token)).toEqual(['26', '20'])
  })

  // ⚠️ The half that stops the guard from passing over holes: an unreadable name is an error, never
  // a step quietly left out of the census.
  it('⛔ refuses a step whose name it cannot resolve', () => {
    expect(() => stepTokensIn(`await step(nameFor(thing), async () => {})`)).toThrow(
      /names itself in a way this parser cannot read/,
    )
    expect(() => stepTokensIn(`await step(UNDECLARED_STEP, async () => {})`)).toThrow(
      /names itself in a way this parser cannot read/,
    )
  })

  /**
   * ⛔ **Two different defences, and the second one had no teeth until this test named it.**
   *
   * The call pattern is narrow — `await step(` or `step(` opening a statement — which handles the
   * `${steps.length} step(s)` in a template literal and the declaration of `step` itself. ⚠️ **It
   * does NOT handle a comment that SHOWS the call**, which is the shape documentation naturally
   * takes, and the blanking is what does. The mutation table found this the honest way: `M8`
   * disarmed the blanking and SURVIVED, because the file under test happened to contain no such
   * comment — the guard was real and nothing could tell.
   */
  it('is not fooled by the word "step" in prose, in a comment that SHOWS the call, or by the declaration', () => {
    const source = [
      'async function step(name, fn) {',
      '  // a step() that is only mentioned is not a step',
      '  if (steps.length < 2) throw new Error(`a multi-step task produced ${steps.length} step(s)`)',
      '}',
      "// the shape every step uses: await step('99 not a real step', async () => {})",
      ' * @example await step(FAKE_STEP, async () => {})',
      "await step('1 app is up', async () => {})",
    ].join('\n')
    expect(stepTokensIn(source).map((s) => s.token)).toEqual(['1'])
  })
})

describe('the census covers the smoke, exactly (224 §5)', () => {
  it('⛔ every step that launches its own app belongs to the own-app tier', () => {
    const declaration = SOURCE.match(/const OWN_APP_STEPS = new Set\(\[([\s\S]*?)\]\)/)?.[1]
    expect(declaration, 'OWN_APP_STEPS declaration disappeared').toBeDefined()
    const owned = new Set([...declaration.matchAll(/'([^']+)'/g)].map((match) => match[1]))
    const launchers = [...bodiesOf(SOURCE)]
      .filter(([, body]) =>
        body.some(
          (line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line) && /\bawait\s+launchApp\s*\(/.test(line),
        ),
      )
      .map(([token]) => token)
    expect(
      launchers.filter((token) => !owned.has(token)),
      'a launch-owning step runs in fast and is skipped by own-app',
    ).toEqual([])
    expect(launchers).toContain('38b')
    expect(launchers).toContain('44b')
    expect(owned.has('82'), 'the nine-provider-session 480 matrix slipped into fast').toBe(true)
  })

  it('⛔ names every step the smoke offers, and nothing it does not', () => {
    // ⚠️ Parsed INSIDE the test, not in the describe body. `stepTokensIn` refuses a file it cannot
    // read, and a throw during collection is a suite that never ran — which a mutation table reads
    // as `NO-TESTS` or `INVALID` rather than as the kill it is.
    const found = stepTokensIn(SOURCE).map((step) => step.token)
    expect(
      new Set(found),
      'a step the census does not name is a step whose reds mean nothing stated',
    ).toEqual(new Set(CENSUS))
    // …and the paired positive, so a census of one token could not satisfy the set comparison above
    // against a parser that had stopped finding steps.
    expect(found).toHaveLength(CENSUS.length)
    expect(found.length).toBeGreaterThan(90)
  })

  it('⛔ names each step once', () => {
    expect(new Set(CENSUS).size).toBe(CENSUS.length)
  })

  it('⛔ no step is both guarded and exposed', () => {
    const both = Object.keys(GUARDED).filter((token) => Object.hasOwn(EXPOSED, token))
    expect(both).toEqual([])
  })

  /**
   * ⛔ **A classification for a step that is not in the census** (237 §2).
   *
   * ⚠️ **This was already caught, by a TypeError.** `bodiesOf` has no entry for a token the smoke
   * does not offer, so `reportsAnUnreachedClaim(undefined)` threw *"Cannot read properties of
   * undefined"* two tests below — a crash that names neither the census nor the token, on the exact
   * shape a half-finished rename leaves behind. ⚑ `riskOf` makes it matter: it answers `'exposed'`
   * BEFORE it checks census membership, so a stale entry is never counted and never complained
   * about — the inventory shrinks by one and the headline improves.
   */
  it('⛔ every classified step is one the smoke still offers', () => {
    const roster = new Set(CENSUS)
    const orphans = [...Object.keys(GUARDED), ...Object.keys(EXPOSED)].filter(
      (token) => !roster.has(token),
    )
    expect(
      orphans,
      'a GUARDED/EXPOSED entry for a step the census does not name is never counted and never ' +
        'read — rename it with the step, or retire it in RETIRED and say where the coverage went',
    ).toEqual([])
  })

  it('⛔ every guarded and exposed step says why, and what kind of thing it is waiting on', () => {
    for (const [token, entry] of [...Object.entries(GUARDED), ...Object.entries(EXPOSED)]) {
      expect(['provider', 'reach'], `${token}`).toContain(entry.cause)
      // A sentence, not a shrug: "flaky" would satisfy any check shorter than this one.
      expect(entry.why.length, `${token} says nothing about why: "${entry.why}"`).toBeGreaterThan(
        30,
      )
    }
  })

  // ⛔ 224 §4 asks for the list of steps that could NOT be reclassified for want of a control, and
  // an entry with no answer to that question would silently join the half that could.
  it('⛔ every exposed step says whether a control exists to reclassify it later', () => {
    for (const [token, entry] of Object.entries(EXPOSED)) {
      expect(['available', 'none'], `${token} does not say`).toContain(entry.control)
    }
  })
})

describe('the census and the code cannot contradict each other (224 §4)', () => {
  it('⛔ step 76 reports provider OCR as unasserted instead of an app-defect RED', () => {
    const body = bodiesOf(SOURCE).get('76').join('\n')
    expect(body).toMatch(/said === null[\s\S]*unasserted\([\s\S]*OCR is provider work/)
    expect(GUARDED[76].cause).toBe('provider')
  })

  it('⛔ a step that reports an unreached claim is never left in the app default', () => {
    // ⚠️ **Since `420` there are TWO reasons a step reports an unreached claim, and only one of
    // them is a provider's.** The other is that the product withdrew the gesture, which is
    // `WITHDRAWN` — a step there is not overstating the instrument by sitting in the app default,
    // because `censusNumbers` already takes it out of `appDefectOnly` by that route. ⛔ The
    // exemption is the MAP and not a list written here, so a step cannot be quietly excused: it
    // has to be written down beside the surface that was removed and the dispatch that removed it.
    const bodies = bodiesOf(SOURCE)
    const contradicting = [...bodies]
      .filter(
        ([token, body]) =>
          reportsAnUnreachedClaim(body) &&
          riskOf(token) === 'app' &&
          !Object.hasOwn(WITHDRAWN, token),
      )
      .map(([token]) => token)
    expect(
      contradicting,
      'these steps answer unasserted()/notAsserted() for something they could not reach, and the ' +
        'census counts them as steps that can only go red for an app defect — which overstates ' +
        'the instrument by exactly the number of them',
    ).toEqual([])
  })

  it('⚑ …and a guarded step really does report it, rather than merely claiming to here', () => {
    const bodies = bodiesOf(SOURCE)
    const empty = Object.keys(GUARDED).filter(
      (token) => !reportsAnUnreachedClaim(bodies.get(token)),
    )
    expect(
      empty,
      'a GUARDED entry for a step that still throws is the census describing an intention — the ' +
        'step goes red for a provider’s choice exactly as before, and the headline says it does not',
    ).toEqual([])
  })

  it('⛔ an EXPOSED step is one that still throws, not one that quietly grew a guard', () => {
    // ⚠️ **`420`'s partial withdrawals are the one shape this predicate cannot tell apart.** `30`
    // and `31` each lost a LAUNCHER half and kept a provider half: they now carry an
    // `unasserted(…)` for the half that left the product, and still throw for the half a provider
    // can decline. ⛔ Both facts are true of the same step, so the exemption is precise — it is
    // the `WITHDRAWN` map, which names the surface and the dispatch, and not a list here.
    const bodies = bodiesOf(SOURCE)
    const guarded = Object.keys(EXPOSED).filter(
      (token) => reportsAnUnreachedClaim(bodies.get(token)) && !Object.hasOwn(WITHDRAWN, token),
    )
    expect(
      guarded,
      'these are named in the response doc as steps that still go red for a provider’s choice, ' +
        'and they no longer do — move them to GUARDED so the number stops being wrong',
    ).toEqual([])
  })

  /**
   * ⛔ **The census with no reader is a file nobody has to keep true** (224 §5).
   *
   * `223 §5` built this shape for a rule with five consumers and one of them out of step. The same
   * trap is here in miniature: everything above could hold perfectly while the run printed nothing,
   * and the number §5 exists to state would live only in a response doc — which is where the last
   * three numbers this project quoted went stale.
   */
  /**
   * ⛔ **The three reclassified steps keep the CONTROL that earns them the blank** (224 §4).
   *
   * ⚠️ **224 §4 is explicit that this is the whole difficulty**: *"the subject never appeared" and
   * "the app is broken" can look IDENTICAL from the outside*, and *"a change that lets a real defect
   * hide is worse than the reds it removes."* Everything else in this file would go on passing if
   * the controls were deleted — the steps would still answer `unasserted(...)`, the census would
   * still call them guarded, and the blank would have become a hiding place.
   *
   * ⚠️ **Written as three named checks rather than as a rule, and that is a limit, not a shortcut.**
   * "This step carries a positive control" is not a syntactic property; what a test can hold is that
   * the specific discriminators this dispatch reasoned about are still there. A fourth step
   * reclassified later needs its own line here, which is the cost of the guard being real.
   */
  it('⛔ the reclassified steps still separate "the provider declined" from "the app is broken"', () => {
    // 68 — the app must have ingested a turn; the two surfaces must agree; a row that did not
    // finish, or a call in the LEDGER with no row on screen, is the app failing, not the model.
    expect(SOURCE).toContain(
      "assertCountersVisible(after68, 'what the planning turn actually produced')",
    )
    expect(SOURCE).toContain('if (settleable.length > 0 && seen.finished.length === 0) {')
    // …and the exclusion that keeps that control from being a false red: a call waiting on a human
    // has no outcome to draw, and each is named (⚑ `736` · R98: `EnterPlanMode` no longer asks).
    //
    // ⚠️ **Declared AND applied, because the mutation table found that half of this was enough.**
    // `M33` dropped the `.filter` and survived: the set was still declared, the control still read
    // `settleable`, and every assertion here held while the step reddened on a healthy app.
    expect(SOURCE).toContain(
      "const USER_INPUT_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])",
    )
    expect(SOURCE).toContain(
      'const settleable = called.filter((name) => !USER_INPUT_TOOLS.has(name))',
    )
    expect(SOURCE).toContain('if (!ran && searchRows.length > 0) {')
    expect(SOURCE).toContain('} else if (bashRows.length > 0) {')
    expect(SOURCE).toContain("called.includes('Bash')")
    // 19 — an ExitPlanMode the app recorded and never rendered is 030 failing, and stays red. The
    // counters guard comes first, or the ledger would be read off an unmounted drawer (093).
    expect(SOURCE).toContain("called.includes('ExitPlanMode')")
    expect(SOURCE).toContain(
      "assertCountersVisible(now, 'what the plan-mode turn actually produced')",
    )
    expect(SOURCE).toContain('if (after68.events === 0 || (after68.messages === 0')
    expect(SOURCE).toContain('if (now.events === 0 || (now.messages === 0 && now.tools === 0)) {')
    // …and a plan turn PARKED on a card nobody could answer is 055, not a quiet model.
    expect(SOURCE).toContain(
      "if (now.status === 'waiting_permission' || stuck > 0 || now.openCards.length > 0) {",
    )
    // …and both blanks are only ever reached from the wait's own TIMEOUT: the approval-cap throw
    // beside step 19's is 031's re-prompting pathology, and a lost CDP reply is the harness dying.
    expect(
      SOURCE.match(/if \(!\/\^timed out waiting for \/\.test\(error\.message\)\) throw error/g),
    ).toHaveLength(2)
    // 12 — a pill the screen cannot open is RED unless Codex itself sent no words (727, read off its
    // own rollout AND the app's ledger: both wordless); reasoning in the ledger with no entry on
    // screen at all is the renderer dropping it. Both of those stay red.
    expect(SOURCE).toContain('codexThinkingPill.length > 0')
    expect(SOURCE).toContain('codexThinkingEvents > 0')
    // ⚑ 727 · …and the pill is the PROVIDER's only when BOTH say no words: the ledger and the rollout.
    expect(SOURCE).toContain("AND coalesce(json_extract(payload, '$.text'), '') != ''")
    expect(SOURCE).toContain('summarised.worded !== 0')
    expect(SOURCE).toContain('        worded !== 0 ||')
    // …and the PROVIDER is named only once this run has shown the flip working (round 2).
    expect(SOURCE).toContain(
      "codexWordless = codexWordedThinking(null) > 0 ? 'the-provider' : 'unproven'",
    )
    // ⚑ …and "no thinking entry at all" means exactly that — a drawn pill is an entry.
    expect(SOURCE).toContain('codexThinkingPill.length === 0 &&\n      codexThinkingEvents > 0')
    // 57 (727) — ONE tree per Workflow CALL the ledger holds, never more, each on its own row, and
    // each a different RUN.
    expect(SOURCE).toContain('entries.trees > (workflowCalls ?? 1)')
    expect(SOURCE).toContain('if (entries.onTree !== entries.trees) {')
    expect(SOURCE).toContain('const doubled = oneTreePerRun(entries.runs)')
    // …and the second surface itself, which all three of the ledger checks above are read from —
    // asked by BOTH steps that blank on an absence, because a control read off one surface is the
    // thing 224 §4 forbids.
    expect(SOURCE).toMatch(/async function ledgerRows\(cdp, type\)/)
    expect(SOURCE.match(/const called = await toolCallsRecorded\(cdp\)/g)).toHaveLength(2)
    // ⚠️ **Counted, not merely present** — 237 §4 gave step 7 a second copy of this exact line, so a
    // bare `toContain` would go on passing if step 12's were deleted and its control never fired.
    expect(SOURCE.match(/await ledgerRows\(cdp, 'thinking'\)/g)).toHaveLength(2)
  })

  /**
   * ⛔ **The second surface is the first surface, so it needed two more controls** (237 §1/§5).
   *
   * ⚠️ **`230` H1 took the independence out of 224 §4's whole design.** `ledgerRows`, the transcript
   * rows and `SNAPSHOT`'s counters are three reads of ONE bounded array (`record.window.entries`),
   * so *"both surfaces agree nothing arrived"* was one surface counted twice — and it inherits the
   * array's bound and its off-tail freeze. ⛔ Two facts the tool list cannot supply now stand beside
   * every absence conclusion, and they are pinned per STEP rather than against the whole file: moved
   * into a dead branch or another step, the census would go on claiming these steps make them.
   */
  it('⛔ every step that reads a model’s quiet asks whether the list was WHOLE and UNERASED', () => {
    const bodies = bodiesOf(SOURCE)
    // The helpers themselves. ⛔ The completeness verdict is DERIVED from the two facts it is made
    // of rather than trusted off the attribute, so a single lost binding cannot refuse four steps
    // with a message saying the window is fine.
    expect(SOURCE).toMatch(/async function refuseIfLedgerWindowed\(cdp, what\)/)
    expect(SOURCE).toContain("whole: reach.hasOlder === 'false' && reach.atTail === 'true'")
    expect(SOURCE).toContain("if ((reach.whole === 'true') !== read.whole) {")
    // …and the empty state is an `<li>` too, so the rows are counted by what makes them rows.
    expect(SOURCE).toContain("log.querySelectorAll('li[data-type]').length")
    /**
     * ⛔ **`255` folded the RENDER of that list and left every row in the DOM** — so the read above
     * still answers about the WINDOW rather than about the viewport, and that is a claim about a
     * component this file cannot import.
     *
     * ⚠️ **An EQUALITY, not a `toContain`, and the first draft got that wrong.** The draft pinned
     * three fragments of the query with `toContain`; `li.dataset.type === ` occurs five times in the
     * smoke and six in the dom test, so rewriting the ONE occurrence that matters left both
     * assertions green. The adversarial pass over `255`'s diff found it by mutating exactly that.
     *
     * ⚑ **So the two reads are extracted and compared to each other.** `event-fold.dom.test.ts` runs
     * `ledgerRows` verbatim against a real 5,000-row `EventStream`; the only licensed difference is
     * that the smoke interpolates the type into a CDP template literal where the dom copy takes a
     * parameter. Either side moving alone is now a red, which is the whole point: a smoke that
     * changed would leave the dom test certifying a query nobody makes, and a dom test that changed
     * would leave the smoke unproven.
     */
    const FOLD_TEST = readFileSync(
      join(here, '../../apps/desktop/test/dom/event-fold.dom.test.ts'),
      'utf8',
    )
    const LEDGER_READ = /\[\.\.\.log\.querySelectorAll\('li'\)\][\s\S]*?\.trim\(\)\)/g
    const smokeRead = SOURCE.match(LEDGER_READ)
    const domRead = FOLD_TEST.match(LEDGER_READ)
    // Exactly one each, or "the two agree" would be a claim about whichever copy matched first.
    expect(smokeRead, 'the smoke no longer reads the ledger off the list itself').toHaveLength(1)
    expect(domRead, "the dom test no longer mirrors the smoke's ledger read").toHaveLength(1)
    const tighten = (text) => text.replace(/\s+/g, ' ').replace('${JSON.stringify(type)}', 'type')
    expect(
      tighten(domRead[0]),
      'the live smoke and the dom test that certifies it read the ledger differently',
    ).toBe(tighten(smokeRead[0]))
    // …and the dom test really is about the FOLDED list, not some other five thousand rows.
    expect(FOLD_TEST).toContain("'li.folded'")
    expect(SOURCE).toMatch(/async function framesErased\(cdp, type\)/)
    // ⛔ …anchored on the reserved marker, and an erasure that lost its own NAME still counts — that
    // is the shape a `tool_call` whose `type` was dropped arrives in, and matching only the typed
    // form would miss precisely the frames a damaged adapter produces.
    expect(SOURCE).toContain("const marker = ' · degraded:'")
    expect(SOURCE).toContain('detail.endsWith(`${marker}<unnamed>`)')
    // ⛔ …and every step that concludes from an absence asks BOTH. 7 was added by 237 §4 — it now
    // reports "no reasoning this session" rather than throwing — so it is a fourth site, not three.
    for (const token of ['7', '12', '19', '68']) {
      const body = bodies.get(token)?.join('\n') ?? ''
      expect(body, `step ${token} is registered and readable`).not.toBe('')
      expect(
        body,
        `step ${token} concludes from an absence without asking if the list was whole`,
      ).toContain('refuseIfLedgerWindowed(cdp')
    }
    // The erasure question is asked about the frame type each step's silence is ABOUT — a `tool_call`
    // guard on a step whose blank is about reasoning would be a control over the wrong absence.
    expect(bodies.get('19').join('\n')).toContain('refuseIfFramesErased(cdp')
    expect(bodies.get('68').join('\n')).toContain('refuseIfFramesErased(cdp')
    expect(bodies.get('12').join('\n')).toContain("framesErased(cdp, 'thinking')")
    expect(bodies.get('7').join('\n')).toContain(
      "refuseIfFramesErased(cdp, 'concluding that Claude returned no reasoning', 'thinking')",
    )
  })

  /**
   * ⛔ **The ban 237 §4 removed, and the assertions that replaced it** (237 §3/§4).
   *
   * ⚠️ **Only the SOURCE can hold this**, and that is exactly why the ban survived so long: the
   * assertion lived in a file `pnpm run ci` cannot run, and every live run it saw was one where it
   * could not fire. ⛔ `claude/normalize.ts` emits `thinking` as a redacted COUNT and never a text,
   * so `hasText` is false for every Claude entry and the banned toggle could not render at all —
   * the ban read as a passing renderer assertion while asserting nothing, and would have reddened
   * the CORRECT renderer behaviour the day the adapter grew a text path.
   */
  it('⛔ step 7 asserts the reasoning shape on screen rather than banning one of them', () => {
    const body = bodiesOf(SOURCE).get('7')?.join('\n') ?? ''
    expect(body, 'step 7 is registered and readable').not.toBe('')
    // The ban itself, by the words it printed.
    expect(body, 'the 237 §4 ban is back').not.toContain(
      'is offering to expand thinking TEXT it does not have',
    )
    // …and what stands in its place: the two branches are v-if/v-else, so exactly one per entry…
    expect(body).toContain('const bothOrNeither = thinking.filter(')
    // …a disclosure is OPENED and read rather than forbidden. ⚠️ Counted: the step clicks TWICE —
    // once to open and once to put the conversation back the way it found it — so a bare
    // `toContain` stays green when the OPEN is deleted and only the restore is left.
    expect(body.match(/\[data-cy=thinking-toggle\]'\)\?\.click\(\)/g)).toHaveLength(2)
    expect(body).toContain("const body = entry?.querySelector('[data-cy=thinking-text]')")
    expect(body).toContain('a thinking disclosure opened onto an empty body')
    // …and 027's other half, hooked rather than read off a CSS class.
    expect(body).toContain('[data-cy=thinking-caption]')
    // ⛔ **Three reasoning states, three branches.** `withText` is empty both when Claude reasoned in
    // a pill and when it did not reason at all, so collapsing the first case into the second printed
    // "no reasoning this session" and "reasoning without words this run" in the same report.
    expect(body, 'the third reasoning state lost its own branch').toContain(
      'thinking.length === 0\n        ? unasserted(',
    )
    expect(SOURCE, 'the caption is read off a presentational class again').not.toContain(
      "querySelector('.caption')",
    )
  })

  /**
   * ⛔ **The erasure marker is a SECOND COPY, and this is the thing that keeps it in step** (237 §5).
   *
   * ⚠️ `ui-live-smoke.mjs` imports only from `scripts/lib/`, so `DEGRADED_LABEL_PREFIX` — which is
   * exported, and which `packages/runtime/src/events.ts` itself warns about having two carriers of —
   * reaches it as a hand-typed string. ⛔ A rename there and nothing here would leave the control
   * silently matching nothing, which is a control that reports an all-clear it never checked.
   */
  it('⛔ the smoke’s degraded marker is the one the runtime writes', () => {
    const events = readFileSync(join(here, '../../packages/runtime/src/events.ts'), 'utf8')
    const prefix = events.match(/export const DEGRADED_LABEL_PREFIX = '([^']+)'/)?.[1]
    const unnamed = events.match(
      /export const DEGRADED_UNNAMED = `\$\{DEGRADED_LABEL_PREFIX}([^`]+)`/,
    )?.[1]
    // The paired positive first: a regex that stopped matching would make every check below vacuous.
    expect(prefix, 'DEGRADED_LABEL_PREFIX is no longer readable from events.ts').toBe('degraded:')
    expect(unnamed, 'DEGRADED_UNNAMED is no longer readable from events.ts').toBe('<unnamed>')
    expect(SOURCE, 'the smoke matches a marker the runtime does not write').toContain(
      `const marker = ' · ${prefix}'`,
    )
    expect(SOURCE).toContain(`detail.endsWith(\`\${marker}${unnamed}\`)`)
    // ⛔ …and note 4's type-less form really answers "was anything of ours erased at all". Without
    // the branch it filters on the string `undefined` and hands back a silent all-clear.
    expect(SOURCE, "235's note 4 form matches nothing").toContain(
      'type === undefined ? detail.includes(marker) :',
    )
  })

  /**
   * ⛔ **Step 17 stopped asserting a silence the provider does not keep** (226 §1).
   *
   * ⚠️ **The assertion it replaces was built on a measured-false claim** — *"Codex reports no
   * outcome for a child (its answer goes to the parent MODEL, never down this connection), so
   * `ended` is the honest end state and a claimed success would be the bug"* — and it would now
   * throw on a perfectly healthy run, because a Codex child DOES send its own `turn/completed`.
   *
   * ⚑ **And what replaced it is two CLAIMS, not two assertions, which is 224's grammar.** Whether a
   * child gets far enough to report anything is the provider's business on the day; a step that
   * reddened because a child died young would be a red for a mood. What stays hard is the
   * vocabulary: a status outside the provider's own union is still a fabrication.
   */
  it('⛔ step 17 checks the outcome VOCABULARY and claims the rest (226)', () => {
    // ⛔ **Attributed to step 17, not matched against the whole file.** A bare `SOURCE.toContain`
    // stays green if the claims are moved into another step, or left behind in a dead branch while
    // 17 reverts to a bare pass — and `step-census.mjs` would go on asserting that step 17 makes
    // them. `bodiesOf` is why this file has a step parser at all.
    const body = bodiesOf(SOURCE).get('17')?.join('\n') ?? ''
    expect(body, 'step 17 is registered and readable').not.toBe('')
    expect(body).toContain(
      "if (!['unreported', 'interrupted', 'completed', 'failed'].includes(status)) {",
    )
    // The claims themselves, so a later edit cannot quietly drop back to a bare pass.
    expect(body).toContain('const outcomeClaim =')
    expect(body).toContain('const usageClaim =')
    // …and they must REACH the verdict. 206 H1's whole subject is a claim that exists in the step
    // and never reaches the headline, and `claims(...)` is the only thing that carries one there.
    expect(body).toMatch(/collabClaim,\s*outcomeClaim,\s*usageClaim,/)
    // ⛔ **And the exemption that became a hole is gone** (226). Post-226 every Codex card is
    // announced, so a `parentUnknown` card is the adapter dropping a birth again — it must FAIL the
    // step rather than be excused from the naming check.
    expect(body).toContain('const nested = cards.filter((c) => c.parentUnknown)')
    expect(body).toContain('if (nested.length > 0) {')
    expect(body, 'the old exemption must not come back').not.toContain('!c.parentUnknown')
    // The snapshot fields both claims are read from — a card that reports usage and one the app
    // admits it has none for are different DOM nodes, and reading only the first would make an
    // absent measurement indistinguishable from an absent card. ⚠️ Scoped with `mine()`, or a
    // grandchild's usage reads as its parent's (035).
    expect(SOURCE).toContain("usage: mine(el, '[data-cy=subagent-usage]')")
    expect(SOURCE).toContain(
      "usageUnreported: mine(el, '[data-cy=subagent-usage-unreported]') !== null",
    )
  })

  it('⛔ the run actually PRINTS the census line', () => {
    // ⚑ **`stepTokensIn` travels with it since `420`**: the run now computes NOT REACHED from the
    // census (what the file OFFERS) minus what `step()` registered, which is the only place that
    // difference can be seen — a run that aborts never calls `step()` again.
    expect(SOURCE).toContain("import { censusLine, stepTokensIn } from './lib/step-census.mjs'")
    expect(SOURCE).toMatch(/console\.log\(`\s*\$\{censusLine\(\)}`\)/)
  })
})

/**
 * ⛔ **The census can read stronger while covering less** (237 §2, from `230` H2).
 *
 * ⚠️ **Everything above this point is a same-instant consistency check between two representations
 * of TODAY.** Every expectation re-derives itself from `Object.keys(EXPOSED)`, `riskOf` falls
 * through to `'app'` for a token in neither list, and `app` and `exposed` have the SAME source-side
 * predicate — the contrapositive of *"a step that blanks is never left in the app default"* is
 * *"an app step does not blank"*, which is what the exposed guard asserts. ⛔ So the axis
 * `appDefectOnly` is computed on was unfalsifiable: **deleting all thirty EXPOSED entries left the
 * suite green and the run reporting `97/97 step(s) can go red ONLY for an app defect`**, with no
 * live step changed. Measured, not reasoned — `230` H2 found one instance of it and the general
 * statement is that the whole axis was unguarded.
 *
 * ⚑ **The missing property is temporal, so the fix is a memory and it is one-way.** Joining the
 * exposed list stays free; leaving it costs a written entry naming the control that earned the
 * departure — and the control has to be IN the step.
 */
describe('the exposed inventory may not shrink in silence (237 §2)', () => {
  it('⛔ every step that has left the published list says where it went', () => {
    expect(
      censusNumbers().unexplained,
      'these were EXPOSED when 224 published "66 of 96 … 30 … 17" and are not any more, and ' +
        'nothing says why — a step that stopped being able to go red for a provider’s choice ' +
        'either grew a control (say which) or stopped existing (retire it)',
    ).toEqual([])
  })

  it('⛔ …and a departure names a control that is really in that step', () => {
    const bodies = bodiesOf(SOURCE)
    for (const [token, entry] of Object.entries(DEPARTED)) {
      expect(['guarded', 'app', 'retired'], `${token} does not say where it went`).toContain(
        entry.to,
      )
      expect(entry.why.length, `${token} says nothing about why: "${entry.why}"`).toBeGreaterThan(
        30,
      )
      if (entry.to === 'retired') {
        expect(RETIRED, `${token} left the smoke and is not retired`).toHaveProperty(token)
        continue
      }
      // ⛔ **The ledger has to describe where the step ACTUALLY is** (found by an adversarial pass
      // over this dispatch's own diff). Without this, deleting `GUARDED['7']` later would drop step
      // 7 into the `app` default, improve `appDefectOnly`, and leave `DEPARTED` still saying
      // `to: 'guarded'` — the silent improvement this whole block exists to stop, one field over.
      if (entry.to === 'guarded') {
        expect(GUARDED, `${token} says it went to GUARDED and is not there`).toHaveProperty(token)
      } else {
        expect(riskOf(token), `${token} says it went to the app default`).toBe('app')
      }
      // ⛔ **224 §4's positive control, generalized.** The test below names the controls for 12, 19
      // and 68 by hand and its own docstring says *"a fourth step reclassified later needs its own
      // line here"*. This is that line, and it needs no editing: the control travels with the
      // departure, and a reclassification that moved the label and built nothing goes red.
      const body = bodies.get(token)
      expect(body, `${token} departed but the smoke no longer offers it`).toBeDefined()
      expect(
        body.join('\n'),
        `${token} left the exposed list on a control that is not in the step`,
      ).toContain(entry.control)
    }
  })

  /**
   * ⛔ **A baseline that could be edited to match today is not a baseline** — and pinning its SIZE is
   * not pinning it (found by an adversarial pass over this dispatch's own diff).
   *
   * ⚠️ **Cardinality was bypassable in one edit.** Move a step to `GUARDED`, drop its token from the
   * baseline and append one that is in `EXPOSED` but not yet frozen: length unchanged, uniqueness
   * unchanged, `departed` unchanged, `unexplained` empty — and `appDefectOnly` improves. ⚑ So the
   * baseline is pinned by CONTENT, as a second independent copy: two lists that must agree, which is
   * the only shape a frozen artefact can take in a repository where one file is always editable.
   */
  it('⛔ …and the frozen list is pinned by its contents, not its size', () => {
    expect(EXPOSED_EVER).toEqual([
      // 224's thirty, in the order it published them.
      '3',
      '4',
      '4b',
      '5',
      '5b',
      '6',
      '6b',
      '7',
      '7e',
      '11d',
      '18',
      '22',
      '23',
      '29',
      '30',
      '31',
      '32',
      '34',
      '35',
      '36',
      '41',
      '45',
      '51',
      '52',
      '53',
      '60',
      '61',
      '66',
      '67',
      '69',
      // …and every exposed step added since, dated in `step-census.mjs`.
      '56',
    ])
    expect(new Set(EXPOSED_EVER).size).toBe(EXPOSED_EVER.length)
    // ⛔ **…and the frozen list keeps up with the live one, or it freezes less every dispatch.** A
    // step added to EXPOSED and not to the baseline is one that can leave again for free — which is
    // `230` H2 with a smaller number on it, and is how a ratchet quietly stops ratcheting. ⚑ This is
    // the direction that costs nothing to get right and everything to notice later.
    const unfrozen = Object.keys(EXPOSED).filter((token) => !EXPOSED_EVER.includes(token))
    expect(
      unfrozen,
      'these are EXPOSED today and in no baseline, so nothing would notice them leaving — add ' +
        'them to EXPOSED_EVER, dated, on the day they join EXPOSED',
    ).toEqual([])
    // 224's own three numbers were computed over 96 steps with the first thirty of these exposed.
    expect(96 - 30).toBe(66)
    // ⛔ …and every frozen token is one the smoke still offers, or retired. A baseline naming a step
    // nobody can find is a baseline that has quietly stopped constraining anything.
    const unknown = EXPOSED_EVER.filter(
      (token) => !CENSUS.includes(token) && !Object.hasOwn(RETIRED, token),
    )
    expect(unknown, 'frozen tokens that are neither in the census nor retired').toEqual([])
  })

  /**
   * ⛔ **The same shape one level up: a step that leaves the ROSTER takes its coverage with it.**
   *
   * `CENSUS` follows the smoke wherever it goes — the set comparison holds because both sides shrink
   * together — so deleting a step entirely made the ratio read better with nothing to object. The
   * floor it replaces (`toBeGreaterThan(90)`) had six deletions of slack in it.
   */
  it('⛔ a step may not leave the census without being retired', () => {
    const ever = new Set([...CENSUS, ...Object.keys(RETIRED)])
    expect(
      ever.size,
      `this census has held ${EVER_AT_LEAST} steps and now accounts for ${ever.size} — a step was ` +
        'removed and nothing says where its coverage went. Add it to RETIRED with the dispatch ' +
        'that removed it and why, or lower EVER_AT_LEAST and say so in the response doc',
    ).toBeGreaterThanOrEqual(EVER_AT_LEAST)
    // Retiring a step it still offers would be a way to buy slack without deleting anything.
    const both = Object.keys(RETIRED).filter((token) => CENSUS.includes(token))
    expect(both, 'a retired step the smoke still offers is not retired').toEqual([])
  })
})

describe('the three numbers (224 §5)', () => {
  it('⛔ refuses a token nobody has classified rather than defaulting it to app-only', () => {
    // ⚠️ **A token no step can ever answer to, rather than the next free number.** This read `'73'`
    // until 246 wrote step 73, at which point the test for "a token nobody has classified" was
    // asserting about a step that had just been classified — a guard whose subject the next
    // dispatch keeps taking away from it.
    expect(() => riskOf('no-such-step')).toThrow(/is not in the census/)
  })

  it('counts a guarded step towards the instrument’s strength and an exposed one against it', () => {
    const n = censusNumbers()
    expect(n.total).toBe(CENSUS.length)
    // ⛔ **Minus the withdrawn ones too** (`420`). They can go red for nobody, so counting them
    // towards *"can go red ONLY for an app defect"* would make the number grow by exactly the
    // steps that stopped measuring anything.
    expect(n.appDefectOnly).toBe(CENSUS.length - n.exposed.length - n.withdrawn.length)
    // Sets, because the numbers come back in CENSUS order and an object hands back its integer-like
    // keys first whatever order they were written in — a difference about JS, not about the census.
    //
    // ⚠️ **Minus the wholly-withdrawn ones** (`420`). `riskOf` answers `'withdrawn'` before it
    // looks at either map, so a step whose subject left the product stops counting as exposed
    // even though its entry stays — deliberately, because the exposure is unchanged and the entry
    // will be right again the day the surface comes back (HO-022 §4, `417` §11.2). ⛔ Deleting
    // those entries instead would lose the reason with them.
    // 🔴 **PINNED, because every other expectation here re-derives itself from `WITHDRAWN`.**
    //
    // ⛔ **Found at `427`, by running a row that should have been red and was not.** Flipping one
    // entry's `partial` from `false` to `true` moves this file's expectation and the instrument's
    // answer together — `stillRuns` reads the same object `riskOf` reads — so the arithmetic below
    // stayed self-consistent and the misclassification passed
    // (`a-fixture-built-with-the-helper-under-test-proves-nothing`, in a census's own test).
    //
    // ⚑ **Derived AND pinned, which is not a contradiction** (`hook-reach`'s ruling): the
    // derivation does the covering, and this equality makes a step joining or leaving the
    // can-go-red-for-nobody set a red somebody acknowledges in a diff.
    expect(
      [...censusNumbers().withdrawn].sort(),
      'a step that can go red for nobody joined or left the set without anybody saying so',
    ).toEqual(['45', '46', '56', '69b', '72'])
    // ⛔ **Every entry says which kind it is, because the two readers disagree about silence.**
    // `riskOf` treats an absent `partial` as WHOLLY withdrawn (`partial !== true`) and the
    // `stillRuns` below treats it as PARTIAL (`partial !== false`) — so an entry that omits the
    // field is classified one way by the instrument and counted the other way here, and the
    // arithmetic two lines down goes red for a reason that has nothing to do with the census.
    // ⚑ Found at `427`, on the first entry added after the field was introduced.
    expect(
      Object.entries(WITHDRAWN).filter(([, row]) => typeof row.partial !== 'boolean'),
      'a WITHDRAWN entry must say whether the step still runs',
    ).toEqual([])
    const stillRuns = (token) => WITHDRAWN[token]?.partial !== false
    expect(new Set(n.guarded)).toEqual(new Set(Object.keys(GUARDED).filter(stillRuns)))
    expect(new Set(n.exposed)).toEqual(new Set(Object.keys(EXPOSED).filter(stillRuns)))
    expect(n.withdrawn).toHaveLength(
      Object.keys(WITHDRAWN).filter((token) => !stillRuns(token)).length,
    )
    // Model-dependence is the census's own word, not a count of everything unreachable: a claim out
    // of a live step's REACH is a limit of the instrument and is named as one.
    expect(new Set(n.modelDependent)).toEqual(
      new Set(
        [...Object.keys(GUARDED), ...Object.keys(EXPOSED)]
          .filter(stillRuns)
          .filter((token) => (EXPOSED[token] ?? GUARDED[token]).cause === 'provider'),
      ),
    )
  })

  it('⛔ names the exposed steps individually — a count of dangerous steps is not actionable', () => {
    const line = censusLine()
    for (const token of Object.keys(EXPOSED)) expect(line).toContain(token)
    expect(line).toContain(`${censusNumbers().appDefectOnly}/${CENSUS.length}`)
  })

  /**
   * ⛔ **A synthetic classification, so the arithmetic has teeth whatever the real census holds.**
   *
   * Read off `EXPOSED` alone, every assertion about an exposed step being counted AGAINST the
   * instrument would quietly stop testing anything on the day a dispatch guards the last of them —
   * the tests would keep passing, over nothing, which is the vacuity class this project hunts.
   */
  const SYNTHETIC = {
    census: ['a', 'b', 'c', 'd'],
    guarded: { b: { cause: 'provider', why: 'the provider may decline the thing b is about' } },
    exposed: {
      c: { cause: 'provider', control: 'none', why: 'c still throws when the provider declines' },
      d: {
        cause: 'provider',
        control: 'available',
        why: 'd still throws, but it already asserts something that would tell the two apart',
      },
    },
  }

  it('⛔ an exposed step is counted against the instrument and a guarded one is not', () => {
    const n = censusNumbers(SYNTHETIC.census, SYNTHETIC)
    expect(n.total).toBe(4)
    expect(n.appDefectOnly).toBe(2) // a and b — c and d can still go red for a provider's choice
    expect(n.guarded).toEqual(['b'])
    expect(n.exposed).toEqual(['c', 'd'])
    expect(n.modelDependent).toEqual(['b', 'c', 'd'])
    // ⛔ 224 §4's two halves, kept apart: one could be reclassified, one has nothing to reclassify
    // it with, and collapsing them would turn a finding into an excuse.
    expect(n.reclassifiable).toEqual(['d'])
    expect(n.blind).toEqual(['c'])
  })

  it('⚑ the line moves with the census, rather than reading the same whatever it holds', () => {
    const line = censusLine(SYNTHETIC.census, SYNTHETIC)
    expect(line).toContain('2/4 step(s) can go red ONLY for an app defect')
    expect(line).toContain('⛔ 2 still go')
    expect(line).toContain('(c, d)')
    expect(line).toContain('1 of them with no control')
    // …and the other side of the same function: a census with nothing exposed says so instead.
    const clean = censusLine(['a', 'b'], SYNTHETIC)
    expect(clean).toContain('2/2 step(s)')
    expect(clean).not.toContain('⛔')
  })

  /**
   * ⛔ **The departure arithmetic, on a census where a step really has left** (237 §2).
   *
   * ⚠️ Read off the real one alone, `unexplained` is `[]` because today it is `[]` — the assertion
   * would pass over nothing on the day the ledger stopped working, which is the vacuity class this
   * file exists to hunt one level down.
   */
  it('⛔ a step that left the published list is counted, and only a ledger entry explains it', () => {
    const left = { ...SYNTHETIC, published: ['c', 'd', 'e'], departed: {} }
    // `e` was exposed when the number was published and is in neither list now; `c` and `d` still
    // are. Nothing explains `e`, so it is unexplained as well as departed.
    expect(censusNumbers(SYNTHETIC.census, left).departed).toEqual(['e'])
    expect(censusNumbers(SYNTHETIC.census, left).unexplained).toEqual(['e'])
    // ⛔ **A caller describing a DIFFERENT census is not measured against this module's history.**
    // ⚠️ Found by 237's own mutation table, which is the only thing that could have: the fix landed
    // and nothing covered it, because every test that exercises the departure arithmetic hands in
    // `published` explicitly and so never reaches the default. Without this, a synthetic
    // classification reports all thirty-one frozen tokens as departed and every arithmetic test in
    // this file starts measuring the real repository instead of its own fixture.
    expect(censusNumbers(SYNTHETIC.census, SYNTHETIC).departed).toEqual([])
    expect(censusNumbers(SYNTHETIC.census, SYNTHETIC).unexplained).toEqual([])
    expect(censusLine(SYNTHETIC.census, SYNTHETIC)).toContain('0 step(s) have left')
    // …and a ledger entry moves it out of `unexplained` WITHOUT moving it out of `departed`: the
    // count in the headline is what left, not what left unexplained.
    const explained = { ...left, departed: { e: { at: '999', to: 'app', control: 'x', why: 'y' } } }
    expect(censusNumbers(SYNTHETIC.census, explained).departed).toEqual(['e'])
    expect(censusNumbers(SYNTHETIC.census, explained).unexplained).toEqual([])
    // …and the line says so, or the number lives only in a response doc.
    expect(censusLine(SYNTHETIC.census, explained)).toContain('1 step(s) have left')
    expect(censusLine(SYNTHETIC.census, explained)).toContain('(e)')
  })

  it('⚑ a cause of "reach" is not counted as model-dependent', () => {
    const limits = {
      census: ['a', 'b'],
      guarded: { b: { cause: 'reach', why: 'b asks for something no live step can produce' } },
      exposed: {},
    }
    expect(censusNumbers(limits.census, limits).modelDependent).toEqual([])
    expect(censusNumbers(limits.census, limits).guarded).toEqual(['b'])
  })
})

describe('665 · R15 — the `default` a live smoke creates holds the one default set, and is granted nothing', () => {
  // ⚑ DERIVED from the step bodies, never listed: a step "creates `default`" when it opens a
  // conversation as it — by the literal, or through step 82's `matrixController`.
  const createsDefault =
    /profileId: (?:'default'|matrixController|\$\{JSON\.stringify\(matrixController\)\})/
  const creating = [...bodiesOf(SOURCE)].filter(([, bodies]) =>
    createsDefault.test(bodies.join('\n')),
  )

  it('⚑ every step that creates `default` runs it on the one default set, with no grant (D-014)', () => {
    const tokens = creating.map(([token]) => token)
    // ⚑ Only step 82 creates one: its matrix controller.
    expect(tokens).toEqual(['82'])
    for (const [token, bodies] of creating) {
      const body = bodies.join('\n')
      // ⚑ Positive control: the step really does place a turn, so the absence below is not vacuous.
      expect(body, `step ${token}`).toMatch(/await (?:placeSession\(cdp, \{|send\()/)
      expect(body, `step ${token}`).not.toContain('grantExactly(')
      expect(body, `step ${token}`).not.toContain('setCapabilities')
    }
  })

  it('⛔ no other live smoke opens a conversation as `default` — since `592` that is not BroBot', () => {
    const root = join(dirname(SMOKE), '..')
    const smokes = [
      ...readdirSync(join(root, 'scripts'))
        .filter((name) => name.endsWith('.mjs') && name !== 'ui-live-smoke.mjs')
        .map((name) => join(root, 'scripts', name)),
      ...readdirSync(join(root, 'apps/desktop/smoke'))
        .filter((name) => name.endsWith('.ts'))
        .map((name) => join(root, 'apps/desktop/smoke', name)),
    ]
    expect(smokes.length).toBeGreaterThan(10)
    for (const file of smokes) {
      const code = readFileSync(file, 'utf8').replace(/^\s*(?:\/\/|\*).*$/gm, '')
      expect(code, file).not.toMatch(/profileId: 'default'/)
    }
  })

  it('⛔ 665: a smoke that names the FRONT DOOR’s profile reads it from the app', () => {
    const root = join(dirname(SMOKE), '..')
    const resume = readFileSync(join(root, 'scripts/resume-live-smoke.mjs'), 'utf8')
    expect(resume).toContain("const PROFILE = constantFrom('DEFAULT_PROFILE_ID')")
    expect(SOURCE).toContain("const BROBOT_PROFILE_ID = constantFrom('DEFAULT_PROFILE_ID')")
    // ⚑ 722 · step 35's image lives in the home of the Codex identity it PLACES — BroBot's home
    // only while it went through the front door (`717` F-3) — named by the variable the placement
    // used, never spelled; step 64's negative names BroBot's home.
    const thirtyFive = bodiesOf(SOURCE).get('35').join('\n')
    expect(thirtyFive).toContain(
      "'provider-homes',\n        'default',\n        worker,\n        'codex',",
    )
    expect(thirtyFive).toContain('profileId: worker,')
    expect(bodiesOf(SOURCE).get('64').join('\n')).toContain(
      'if (said.home.includes(`/${BROBOT_PROFILE_ID}/claude`)) {',
    )
  })
})

describe('669 · F-c and F-d — no selected run exits 0 by itself, and step 42 plants into BroBot’s home', () => {
  it('⛔ F-c: no selected-run reporter anywhere exits 0 by itself', () => {
    const code = SOURCE.replace(/^\s*(?:\/\/|\*).*$/gm, '')
    expect(code.match(/process\.exit\(0\)/g)).toBeNull()
  })

  it('⚑ F-d: step 42 plants into BroBot’s own home, in the layout the app derives', () => {
    const plant = bodiesOf(SOURCE).get('42').join('\n')
    expect(plant).toContain(
      'const planted = join(\n        userData,\n        PROVIDER_HOMES_DIRNAME,\n        HOME_FOLDER,\n' +
        "        BROBOT_PROFILE_ID,\n        'claude',\n        'projects',",
    )
    expect(plant).not.toMatch(/'default',\s*'default'/)
    expect(SOURCE).toContain(
      "const PROVIDER_HOMES_DIRNAME = constantFrom('PROVIDER_HOMES_DIRNAME')",
    )
    expect(SOURCE).toContain("const HOME_FOLDER = constantFrom('HOME_FOLDER')")
    // ⛔ …and each RESOLVES — a declared home that names the wrong file throws only on a live run.
    expect(constantFrom('PROVIDER_HOMES_DIRNAME')).toBe('provider-homes')
    expect(constantFrom('HOME_FOLDER')).toBe('default')
    // ⚑ The layout the three are joined in is the app's own: root, the one home folder (D-016),
    // profile, provider.
    const homes = readFileSync(
      join(here, '../../apps/desktop/src/main/runtime/provider-homes.ts'),
      'utf8',
    ).replace(/^\s*(?:\/\/|\*).*$/gm, '')
    expect(homes.replace(/\s+/g, ' ')).toContain(
      'return join(providerHomesRoot(userData), HOME_FOLDER, identity.profileId, identity.provider)',
    )
    expect(homes).toContain('return join(userData, PROVIDER_HOMES_DIRNAME)')
  })
})
