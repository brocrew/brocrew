import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { EXPORTS, planCleanBase, REPORT_ORDER } from '../lib/clean-base.mjs'
import { trustedAnchor } from '../lib/safe-remove.mjs'
import { fixture, plantUserData, removeFixtures } from './fixtures/a-planted-user-data.mjs'

/**
 * # ⛔ 351 · M44 · `exports/` goes with `--drop-exports` — and the report has to say so
 *
 * ⚑ **The rule.** `--drop-exports` deletes the one folder of a userData that cannot be regenerated,
 * and a person reads the report to learn what came off. ⛔ The report prints a group only when its
 * reason is in `REPORT_ORDER`, and it adds a group's bytes and paths to the total inside the same
 * loop — so an `EXPORTS` that leaves the order is deleted, named in no section, and counted in no
 * total, while the code's own comment promises *"every name, never an elision"*.
 *
 * ⚠️ **Why this file exists.** The only test that saw it spawns the script
 * (`scripts/gate-only/clean-base.test.mjs`), which standing rule §6 lets run only inside the whole
 * gate, so `verify_row.py` refuses it and the row could not be re-verified RED. ⚑ Nothing here
 * starts a process: it asks the PLANNER what `--drop-exports` would remove, and asks the CLI's
 * source, read as text, how the report groups it. `clean-base-without-running-it.test.mjs` skips
 * `exports` in its own order check (its plan without the flag keeps that folder), which is the gap.
 */

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO = dirname(SCRIPTS)
/** ⚑ The CLI's source, READ — once, here, and never run. */
const CLI_SOURCE = readFileSync(join(SCRIPTS, 'clean-base.mjs'), 'utf8')

afterEach(removeFixtures)

function planFor(options) {
  const userData = plantUserData(fixture())
  const anchor = trustedAnchor(userData, { repoRoot: REPO, home: fixture(), env: {} })
  expect(anchor.kind, 'the fixture must be a directory the predicate trusts').toBe('trusted')
  return planCleanBase(anchor, options)
}

describe('M44 · a folder --drop-exports deletes is one the report prints and counts', () => {
  it('⛔ the planner removes exports/ under --drop-exports, and its reason is one the report prints', () => {
    const plan = planFor({ dropExports: true })

    const exportsAction = plan.actions.find((action) => action.rel === 'exports')
    expect(exportsAction, 'the flag must put exports/ in the plan, or this proves nothing').toEqual(
      {
        rel: 'exports',
        expect: 'dir',
        why: EXPORTS,
      },
    )
    expect(
      REPORT_ORDER,
      'exports/ is removed and its group is never printed, so it is in no section and no total',
    ).toContain(exportsAction.why)
    expect(plan.keeps.some((keep) => keep.rel === 'exports')).toBe(false)
  })

  it('⚑ …and no reason a plan can carry falls outside the order the report walks', () => {
    for (const options of [{ dropExports: true }, {}]) {
      const plan = planFor(options)
      expect(plan.actions.length, 'a plan of nothing would pass this').toBeGreaterThan(5)
      for (const action of plan.actions) {
        expect(
          REPORT_ORDER,
          `${action.rel} (${action.why}) is removed and never printed`,
        ).toContain(action.why)
      }
    }
  })

  it('⚑ the paired positive: without the flag exports/ is KEPT, so it is a keep and not a removal', () => {
    const plan = planFor({})
    expect(plan.actions.some((action) => action.rel === 'exports')).toBe(false)
    expect(plan.keeps.find((keep) => keep.rel === 'exports')?.flag).toBe('--drop-exports')
    // ⚑ The reason stays in the order regardless — it is the flag's plan that needs it, not this one.
    expect(REPORT_ORDER).toContain(EXPORTS)
  })

  it('⛔ the report prints a reason only by walking REPORT_ORDER, and there is no second way to print one', () => {
    // ⚑ This is what makes "in the order" the same thing as "named and counted": a group is read
    // out of the map in ONE loop over the order, and that loop is also where the totals grow.
    expect(CLI_SOURCE).toContain('for (const why of REPORT_ORDER) {')
    // ⚠️ `groups.get(action.why)` is the WRITER (it pushes onto a group); a reader is `get(<a reason>)`.
    expect(CLI_SOURCE.match(/groups\.get\(why\)/g)?.length, 'a second reader of the groups').toBe(1)
    const loop = CLI_SOURCE.slice(CLI_SOURCE.indexOf('for (const why of REPORT_ORDER) {'))
    expect(loop.slice(0, loop.indexOf('\n  }\n'))).toContain('totalPaths += count')
    expect(new Set(REPORT_ORDER).size, 'a reason twice would print its group twice').toBe(
      REPORT_ORDER.length,
    )
  })
})
