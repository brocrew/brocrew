import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as helper from '../../packages/runtime/smoke/probe-run-deadline.ts'
import { GATE_ANSWER_MS, GATE_POLL_MS, GATE_SOCKET_WAIT_MS } from '../lib/host-gate-witness.mjs'
import { typescriptAt } from '../lib/page-ipc-census.mjs'
import { valueIn } from '../lib/smoke-deadline-census.mjs'
import { budgetClock } from '../lib/step-budget.mjs'
import { stepWorstCase } from '../lib/step-wait-census.mjs'

/**
 * 🔴 **674 · R20 — step 82 budgeted by `042`'s rule: the worst case its waits can spend, times the
 * margin, and never one good run.**
 *
 * ⚑ Each step states its worst case as a literal beside its budget; `step-wait-census.mjs` recomputes
 * it from the step's own call sites, so a wait added without its sum fails here
 * (`a-bound-written-as-the-constant-cannot-pin-it`). The figures are then stated, old and new.
 */

// ⚑ The census parses and walks the 26,000-line smoke on first use: under the gate's parallel load
// that can outrun vitest's five-second default, which would be a red that measures the machine.
vi.setConfig({ testTimeout: 60_000 })

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const ts = typescriptAt(root)
const read = (file) => readFileSync(join(root, file), 'utf8')
const SMOKE = 'scripts/ui-live-smoke.mjs'
const source = read(SMOKE)
const value = (expression) => valueIn(ts, source, expression, helper, { name: SMOKE })
const units = value('PERMISSION_MATRIX_UNITS')
/**
 * ⚑ Computed on first use, inside a test — so a census that cannot count a step fails as the tests
 * that asked, by name, and not as a file that never loaded.
 */
const once = (compute) => {
  let computed
  return () => (computed ??= compute())
}
/**
 * ⚑ How each step is read: `withinLiveDeadline` is the step's OUTER race, not a wait — its arguments
 * are walked, it is not; and a read inside a poll's predicate is covered by that poll's bound.
 */
const COMMON = {
  name: SMOKE,
  transparent: ['withinLiveDeadline'],
  // ⚑ `ps -A` reads the process table and returns: the one untimed child the launch path makes
  // (`ourDescendants`). Any OTHER untimed synchronous child is refused as an unbounded wait.
  untimedChildren: ['ps'],
}
const matrixCensusWith = (active) =>
  stepWorstCase(ts, source, {
    ...COMMON,
    step: 'PERMISSION_MATRIX_STEP',
    roots: ['.', 'runCase', 'runCriterion17Retake', 'recoverFailedRow'],
    reads: ['queryMatrixDatabase', 'queryDatabase'],
    // ⚑ The step's own body runs the units through `attemptUnit`; they are charged as units.
    skip: ['attemptUnit'],
    // ⚑ A recovery closes each child it still finds once (`recoveredIds`), and every child is one
    // unit's give — so across all its passes it closes at most one child per unit.
    iterations: { active },
  })
const matrixCensus = once(() => matrixCensusWith(units.rows + units.criterion17))
const WITNESS = { witnessGate: GATE_SOCKET_WAIT_MS + GATE_POLL_MS + GATE_ANSWER_MS }
const launchCensus = once(() =>
  stepWorstCase(ts, source, { ...COMMON, roots: ['launchApp'], charged: WITNESS }),
)
/** `main()`'s own waits outside every step — the run's, not a step's — with the launch counted apart. */
const mainCensus = once(() =>
  stepWorstCase(ts, source, {
    ...COMMON,
    roots: ['main'],
    skip: ['step', 'launchApp'],
    charged: WITNESS,
    reads: ['queryDatabase'],
  }),
)
/** The `step()` wrapper's own failure path — spent on the run's clock, once, for the one selected step. */
const wrapperCensus = once(() =>
  stepWorstCase(ts, source, {
    ...COMMON,
    roots: ['step'],
    charged: WITNESS,
    reads: ['queryDatabase'],
  }),
)
const itemised = (census) => census.waits.map((one) => `${one.line} ${one.what} ${one.ms}`)

describe('674 · R20 — each step states the worst case its own code can spend', () => {
  it('⛔ step 82: setup, a row, criterion 17 and a recovery — each the sum of its call sites', () => {
    const matrix = matrixCensus()
    const stated = value('PERMISSION_MATRIX_WORST_MS')
    expect(stated.setup, itemised(matrix['.']).join('\n')).toBe(matrix['.'].ms)
    expect(stated.row, itemised(matrix.runCase).join('\n')).toBe(matrix.runCase.ms)
    expect(stated.criterion17, itemised(matrix.runCriterion17Retake).join('\n')).toBe(
      matrix.runCriterion17Retake.ms,
    )
    expect(stated.recovery, itemised(matrix.recoverFailedRow).join('\n')).toBe(
      matrix.recoverFailedRow.ms,
    )
    // ⚑ A read outside a poll is charged where it is made — the review's finding, now a pin.
    expect(matrix.runCase.waits.map((one) => one.what)).toContain('decisionsFor')
  })

  it('⚑ outside the step: `launchApp` — handoff, attach, both readiness waits, the gate — and `main()`’s own', () => {
    const stated = value('LAUNCH_WORST_MS')
    expect(stated.isolatedLaunch, itemised(launchCensus().launchApp).join('\n')).toBe(
      launchCensus().launchApp.ms,
    )
    expect(stated.outsideSteps, itemised(mainCensus().main).join('\n')).toBe(mainCensus().main.ms)
    expect(stated.stepWrapper, itemised(wrapperCensus().step).join('\n')).toBe(
      wrapperCensus().step.ms,
    )
    expect(wrapperCensus().step.waits.map((one) => one.what)).toEqual(['resetAfterFailure'])
    expect(launchCensus().launchApp.waits.map((one) => one.what)).toEqual([
      'claimOwnedLauncher → setTimeout (timeoutMs) default',
      'waitFor',
      'Cdp.attach',
      'waitFor',
      'witnessGate',
    ])
  })
})

describe('674 · R20 — the budgets are `042`’s rule over those sums, and the figures are stated', () => {
  it('⛔ the margin is `probe-run-deadline.ts`’s own, held equal because the smoke may not import it', () => {
    expect(value('STEP_BUDGET_MARGIN')).toBe(helper.RUN_BUDGET_MARGIN)
  })

  it('⚑ old → new, stated', () => {
    const margin = helper.RUN_BUDGET_MARGIN
    const outside = value('LAUNCH_WORST_MS')
    const launch = Math.ceil(
      margin * (outside.isolatedLaunch + outside.outsideSteps + outside.stepWrapper),
    )
    const worst = value('PERMISSION_MATRIX_WORST_MS')
    const matrixStep = Math.ceil(
      margin *
        (worst.setup +
          units.rows * (worst.row + worst.recovery) +
          units.criterion17 * (worst.criterion17 + worst.recovery)),
    )
    expect(value('LAUNCH_BUDGET_MS')).toBe(launch)
    expect(value('PERMISSION_MATRIX_STEP_BUDGET_MS')).toBe(matrixStep)
    expect(value('PERMISSION_MATRIX_RUN_BUDGET_MS')).toBe(matrixStep + launch)
    // ⚑ Stated. Outside the step: 887,400 ms (was a typed 180,000, below its own 591.6 s of waits).
    expect(launch).toBe(887_400)
    // ⚑ Step 82: 45,294,000 ms — 12 h 35 min — for the step (was 1,202,772: `669` F-e's one good
    // run × 1.5), and 46,181,400 ms for the run (was 1,382,772). ⚑ 739 · 56,931,000 ms — 15 h 49
    // min — and 57,818,400 ms: ten rows (2 × 5, *Always allow* added) and eleven recoveries' worth.
    // ⚑ 738 · 57,081,000 ms and 57,968,400 ms: a row's worst case grew by the model-bytes branch's two
    // ledger reads (its `file_change`, and Codex's own echo), 5,000 ms each, over ten rows × 1.5.
    // ⚑ D-016 · 52,791,000 ms — 14 h 40 min — and 53,678,400 ms: a unit's child is one give where it
    // was a spawn and then a handoff, so a row's worst case fell by 260,000 ms and criterion 17's
    // by the same, × 1.5.
    expect(matrixStep).toBe(52_791_000)
    expect(matrixStep + launch).toBe(53_678_400)
  })

  it('⛔ no step or run budget is a typed figure, and each deadline is armed with its own', () => {
    for (const name of [
      'PERMISSION_MATRIX_STEP_BUDGET_MS',
      'PERMISSION_MATRIX_RUN_BUDGET_MS',
      'LAUNCH_BUDGET_MS',
    ]) {
      expect(source, name).not.toMatch(new RegExp(`const ${name} = \\d`))
    }
    expect(source).toContain(
      'const localStepDeadline = Date.now() + PERMISSION_MATRIX_STEP_BUDGET_MS',
    )
    expect(source).toContain('deadlineAt: Date.now() + PERMISSION_MATRIX_RUN_BUDGET_MS,')
  })

  it('⛔ the step hands its waits out of the ONE clock the model below spends', () => {
    expect(source.match(/const budget = budgetClock\(\{/g)).toHaveLength(1)
    expect(source).not.toMatch(/const budget = \(wanted\) =>/)
  })
})

describe('674 · the clock the step spends', () => {
  it('⛔ hands out the smaller of the wish and what is left, and throws the step’s own expiry at zero', () => {
    let now = 1_000
    const budget = budgetClock({
      deadlineAt: 5_000,
      expire: () => new Error('the step deadline'),
      now: () => now,
    })
    expect(budget(10_000)).toBe(4_000)
    expect(budget(1_000)).toBe(1_000)
    now = 5_000
    expect(() => budget(1)).toThrow('the step deadline')
  })
})

describe('674 · the step-wait census, on planted steps (rule 12)', () => {
  const plant = (unit, extra = '') => `
    async function waitFor(what, predicate, timeoutMs = 30_000, pollMs = 200) {}
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const SETTLE_MS = 40
    function readRow(sql, timeoutMs = 700) {
      return execFileSync('sqlite3', [sql], { timeout: timeoutMs })
    }
    class Tab {
      static async open(port) {
        await waitFor('the tab', async () => true, 600)
      }
    }
    async function main() {
      await step(PLANTED, async () => {
        const budget = (wanted) => wanted
        const helper = async () => {
          await waitFor('helper', async () => true, budget(100))
          await sleep(SETTLE_MS)
        }
        ${extra}
        const unit = async () => {
          ${unit}
        }
      })
      await step(OTHER, async () => {
        const helper = async () => {
          await sleep(9_999)
        }
      })
    }
  `
  const worst = (text, options = {}) =>
    stepWorstCase(ts, text, { step: 'PLANTED', roots: ['unit'], ...options }).unit.ms

  it('⚑ charges a helper per call, both branches, a default bound and a named one', () => {
    // ⚑ The control — and `helper` resolves to THIS step's, never the other step's 9,999 ms one.
    expect(worst(plant('await helper()'))).toBe(140)
    expect(worst(plant('await helper()\n          await helper()'))).toBe(280)
    expect(
      worst(plant("if (x) await helper()\n          else await waitFor('y', async () => true)")),
    ).toBe(140 + 30_000)
    expect(worst(plant("await waitFor('z', async () => true, SETTLE_MS)"))).toBe(40)
    // ⚑ A bound handed in as a parameter is charged where the caller made it — `budget(…)`, a
    // literal, or the parameter's own default when the call passes nothing (the review's finding).
    const waitsFor =
      "const waitsFor = async (ms = 250) => { await waitFor('p', async () => true, ms) }"
    expect(worst(plant('await waitsFor(budget(500))', waitsFor))).toBe(500)
    expect(worst(plant('await waitsFor(90_000)', waitsFor))).toBe(90_000)
    expect(worst(plant('await waitsFor()', waitsFor))).toBe(250)
    // ⚑ A static method through its class; a synchronous child's `timeout`; a timer that settles an
    // awaited promise — and, the control, a watchdog timer that settles nothing is not a wait.
    expect(worst(plant('await Tab.open(1)'))).toBe(600)
    expect(worst(plant("readRow('x')\n          readRow('y', 50)"))).toBe(750)
    expect(
      worst(plant('await new Promise((resolve, reject) => { setTimeout(reject, SETTLE_MS) })')),
    ).toBe(40)
    expect(worst(plant('const watchdog = setTimeout(() => stop(), deadlineAt - Date.now())'))).toBe(
      0,
    )
  })

  it('⛔ round 2 · a loop’s OWN counter, a budget spent per loop, an untimed child, a recursion', () => {
    // ⚑ The bound on the loop's own counter, not the leftmost `<` of its condition.
    expect(worst(plant('for (let pass = 0; q < 3 && pass < 8; pass += 1) await sleep(100)'))).toBe(
      800,
    )
    // ⚑ A `budget(…)` handed to a helper that loops over it is spent once per loop.
    const tries = 'const tries = async (ms) => { for (let i = 0; i < 3; i += 1) await sleep(ms) }'
    expect(worst(plant('await tries(budget(1_000))', tries))).toBe(3_000)
    expect(worst(plant('await tries(1_000)', tries))).toBe(3_000)
    // ⛔ An untimed synchronous child is an unbounded wait — unless its caller names it.
    expect(() => worst(plant("execFileSync('ps', ['-A'], { encoding: 'utf8' })"))).toThrow(
      /untimed `execFileSync\('ps'/,
    )
    expect(
      worst(plant("execFileSync('ps', ['-A'], { encoding: 'utf8' })"), { untimedChildren: ['ps'] }),
    ).toBe(0)
    // ⛔ A function that calls itself is a recursion, never charged once.
    expect(() =>
      worst(
        plant(
          'await retry(5)',
          'const retry = async (n) => { await sleep(1_000); if (n > 0) await retry(n - 1) }',
        ),
      ),
    ).toThrow(/calls itself/)
  })

  it('⛔ a read is charged outside a poll, and covered by the poll’s own bound inside one', () => {
    const polled = "await waitFor('r', async () => readRow('x') !== null, 1_000)"
    expect(worst(plant(`readRow('x')\n          ${polled}`), { reads: ['readRow'] })).toBe(1_700)
    // ⛔ …and a read NOT named as one is a wait inside a predicate, refused rather than hidden.
    expect(() => worst(plant(polled))).toThrow(/inside a `waitFor` predicate/)
  })

  it('⛔ a loop multiplies by its literal bound, and a stated total replaces the loops outside it', () => {
    expect(worst(plant('for (let i = 0; i < 3 && go; i += 1) await helper()'))).toBe(420)
    expect(
      worst(plant('for (let i = 0; i < 8; i += 1) { for (const one of found) await helper() }'), {
        iterations: { found: 2 },
      }),
    ).toBe(280)
    // ⛔ …but never the loops INSIDE it (the review's finding): three tries of each of two.
    expect(
      worst(plant('for (const one of found) { for (let i = 0; i < 3; i += 1) await helper() }'), {
        iterations: { found: 2 },
      }),
    ).toBe(840)
  })

  it('⛔ what it cannot count, it refuses to count as zero', () => {
    expect(() => worst(plant('for (const one of found) await helper()'))).toThrow(
      /no literal bound/,
    )
    expect(() => worst(plant('while (go) await helper()'))).toThrow(/no literal bound/)
    expect(() =>
      worst(plant("await waitFor('q', async () => { await helper(); return true }, budget(5))")),
    ).toThrow(/inside a `waitFor` predicate/)
    expect(() => worst(plant('await Promise.all([1, 2].map(async () => helper()))'))).toThrow(
      /`\.map` callback/,
    )
    expect(() => worst(plant("await waitFor('r', async () => true, readMs())"))).toThrow(
      /cannot evaluate the bound/,
    )
    expect(() => worst(plant('await helper()'), { roots: ['nobody'] })).toThrow(
      /no unit function `nobody`/,
    )
    // ⛔ A bound that is an anonymous callback's argument, and a root that waits on its own.
    expect(() =>
      worst(plant("await each(async (ms) => { await waitFor('c', async () => true, ms) })")),
    ).toThrow(/argument of a callback/)
    expect(() =>
      stepWorstCase(
        ts,
        plant('await helper()', 'const takes = async (ms) => { await sleep(ms) }'),
        {
          step: 'PLANTED',
          roots: ['takes'],
        },
      ),
    ).toThrow(/waits on its own argument `ms`/)
  })
})

describe('674 · R20 — a fake-timer model of step 82: four stalled rows, and the matrix finishes', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // ⚑ `665`'s measured clocks, in the order step 82 runs them: criterion 17, then the Codex rows,
  // then the Claude rows (`providerRunOrder`), each over allow, allow for session, deny, cancel —
  // ⚑ 739 · *Always allow*'s rows are recorded NOT PERFORMED and spawn nothing, so they add no clock.
  const TYPICAL = {
    'codex/criterion-17': 36_488,
    'codex/allow': 50_154,
    'codex/allow_for_session': 39_785,
    'codex/deny': 40_148,
    'codex/cancel': 25_043,
    'claude/allow': 36_770,
    'claude/allow_for_session': 30_815,
    'claude/deny': 31_563,
    'claude/cancel': 21_347,
  }
  const STALLED = ['codex/allow', 'codex/allow_for_session', 'codex/deny', 'codex/cancel']
  /** `669` F-e's step budget: one good run's longest unit × 1.5, over twelve units, plus five minutes. */
  const ONE_GOOD_RUN_STEP_MS = 5 * 60_000 + 12 * Math.ceil(50_154 * 1.5)

  /**
   * The step's timeline, spent out of the step's OWN clock. ⚠️ A model of `attemptUnit`'s loop, not
   * the loop: a healthy unit spends its measured clock; a stalled one spends `stall(unit)` and fails,
   * and then its recovery at the worst case; the step's own setup runs at its worst case first.
   */
  const run = (stepBudgetMs, stall, recovery = () => matrixCensus().recoverFailedRow.waits) => {
    vi.useFakeTimers()
    const budget = budgetClock({
      deadlineAt: Date.now() + stepBudgetMs,
      expire: () => new Error('the step deadline'),
    })
    const spend = (ms) => vi.advanceTimersByTime(budget(ms))
    const failed = []
    const passed = []
    try {
      for (const one of matrixCensus()['.'].waits) spend(one.ms)
      for (const [unit, typical] of Object.entries(TYPICAL)) {
        try {
          if (!STALLED.includes(unit)) {
            spend(typical)
            passed.push(unit)
            continue
          }
          for (const ms of stall(unit)) spend(ms)
          throw new Error(`${unit} stalled`)
        } catch (error) {
          if (error.message === 'the step deadline') throw error
          failed.push(unit)
          for (const one of recovery()) spend(one.ms)
        }
      }
      return { finished: true, failed, passed }
    } catch (error) {
      if (error.message !== 'the step deadline') throw error
      return { finished: false, failed, passed }
    }
  }
  // ⚑ `669`'s Inbox 1 stall: the row's usual work, then ONE 180 s wait that expires.
  const oneWait = (unit) => [TYPICAL[unit], 180_000]
  // ⚑ No stall at all — the row's usual work, then it fails: the control for the stall itself.
  const noWait = (unit) => [TYPICAL[unit]]
  // ⛔ The harshest stall: every wait the row can make, each to its whole bound.
  const everyWait = () => matrixCensus().runCase.waits.map((one) => one.ms)
  // ⚑ A recovery that finds no stray child: its controller and its own child only (the review).
  const cleanCensus = once(() => matrixCensusWith(0))
  const cleanRecovery = () => cleanCensus().recoverFailedRow.waits

  it('🔴 the control: `669`’s one-good-run budget, and four rows stalled at one wait, ends the matrix', () => {
    expect(ONE_GOOD_RUN_STEP_MS).toBe(1_202_772)
    // ⚑ Four rows that fail WITHOUT stalling fit it — so what ends the matrix below is the stalls.
    expect(run(ONE_GOOD_RUN_STEP_MS, noWait, cleanRecovery).finished).toBe(true)
    const outcome = run(ONE_GOOD_RUN_STEP_MS, oneWait, cleanRecovery)
    expect(outcome.finished).toBe(false)
    // ⚑ `669`'s "about four": the deadline lands in the FOURTH stalled row's recovery, and no Claude
    // row runs at all.
    expect(outcome.failed).toEqual(STALLED)
    expect(outcome.passed).toEqual(['codex/criterion-17'])
  })

  // ⚠️ This one and the next hold by construction whenever the census is right — the budget IS the
  // worst case × 1.5; what they add is the step's own clock spending it. The control is the evidence.
  it('⛔ R20’s budget finishes the matrix and names each stalled row', () => {
    const outcome = run(value('PERMISSION_MATRIX_STEP_BUDGET_MS'), oneWait, cleanRecovery)
    expect(outcome).toEqual({
      finished: true,
      failed: STALLED,
      passed: Object.keys(TYPICAL).filter((unit) => !STALLED.includes(unit)),
    })
  })

  it('⛔ …and so it does when each stalled row spends every wait it has, to its bound', () => {
    const outcome = run(value('PERMISSION_MATRIX_STEP_BUDGET_MS'), everyWait)
    expect(outcome.finished).toBe(true)
    expect(outcome.failed).toEqual(STALLED)
  })
})
