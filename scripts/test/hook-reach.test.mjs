import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { WIDE_READ_MARK, builtHookViolations, hooksIn } from '../lib/tab-flow.mjs'

/**
 * 🔴 **The 097 walk, applied to the instrument that runs it** (345 §1, from 342 §0).
 *
 * ## ⛔ The two days nobody could have noticed
 *
 * `310` introduced `'[data-cy=' + cy + ']'` into `smoke:ui` step 31 — a hook the walk refuses by
 * design, so the step throws before its first assertion. **`pnpm run ci` went green.** The two tests
 * that already existed check the walk's LOGIC (`tab-flow.test.mjs`) and its hook table against the
 * `.vue` sources (`tab-flow.reach.test.mjs`); ⛔ **neither reads `ui-live-smoke.mjs`**. The step was
 * dead for two days and the thing that found it was `342`'s live batch — the first live run in
 * thirty-five dispatches.
 *
 * ⚠️ **And "run it more often" is not the repair.** `342`'s response doc prices the whole five-suite
 * batch at roughly two dollars and twenty minutes — cheap — but `smoke:ui` needs an on-screen window
 * for a good number of its steps, so it can go on no hook and no timer. (That price is recorded in
 * the dispatch, not in this repo; nothing here can check it.) ⚑ **A guard is only as live as its cheapest execution site**, and
 * what can be decided without a window has to move to where `ci` can reach it. This is that move.
 *
 * ## ⚑ Why the rule is IMPORTED rather than restated
 *
 * `builtHookViolations` runs `unreadableSelectorIn` — the walk's own predicate, unchanged. A second
 * spelling of "is this hook readable" would be free to disagree with the first about one selector,
 * and this repo has already paid for that shape once: `memory-bound.ts` and `confinement.ts` once
 * answered differently about one string and 256 KiB went to disk with no card.
 *
 * ⚠️ **What this file adds is not a rule but a TIME** — and, in `asEvaluated`, the one correction a
 * source-level reading needs: a node-side `${…}` hole is already filled when the walk sees it.
 */

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Read a script beside this test, by name. */
const script = (name) => readFileSync(join(SCRIPTS, name), 'utf8')

/**
 * **The instruments that run the walk, derived rather than listed** (345 §1).
 *
 * ⛔ **A hardcoded list is the defect one level up.** Step 7's event whitelist has now lagged the
 * app's vocabulary twice, and the remedy both times was *"remember to add it"*. So the guarded set
 * is whatever imports `assertTabFlow`: a fourth smoke that adopts the walk is covered by the run
 * that adopts it, and one that drops the walk stops being asked about a rule it no longer runs.
 *
 * ⛔ **It reads the IMPORT, not the NAME, and review is why.** A bare `/\bassertTabFlow\b/` over the
 * file was the first draft, and it pulled a probe into the set on the strength of a COMMENT
 * mentioning the function — a comment this same dispatch wrote, saying the probe was NOT covered.
 * The roster was then held in place by a sentence that was false, and deleting the sentence would
 * have silently un-guarded the file. A mention is not a call.
 *
 * ⚑ **Derived AND pinned, which is not a contradiction.** The derivation does the covering; the
 * exact-equality assertion below makes a file JOINING or LEAVING the set a red somebody has to
 * acknowledge in a diff, rather than a silent change in what this file checks.
 */
const IMPORTS_THE_WALK = /import \{[^}]*\bassertTabFlow\b[^}]*\} from '\.\/lib\/tab-flow\.mjs'/

const GUARDED = readdirSync(SCRIPTS)
  .filter((name) => name.endsWith('.mjs'))
  .filter((name) => IMPORTS_THE_WALK.test(script(name)))
  .sort()

/**
 * The three that run it today, and the floor of DISTINCT readable hooks each must still yield.
 *
 * ⛔ **The floors are the address, not the answer.** `builtHookViolations` returning `[]` is what a
 * clean file looks like AND what an unread file looks like — a path typo, a rename, a `readdirSync`
 * that matched nothing. These floors are the half that can only pass if the bytes really arrived.
 * Measured at 345, after this dispatch's own edits: 269 / 30 / 13.
 *
 * ⚠️ **Re-measured at 420: 251 / 29 / 15**, and the floors are deliberately NOT raised to match.
 * `420` took twenty-odd dead reads out of these files and the counts moved in both directions, so
 * a floor pinned to today's number would go red on the next honest removal while saying nothing
 * about whether the bytes arrived. ⛔ What the margin IS worth saying out loud:
 * `resume-live-smoke.mjs` now clears its floor by four, so a dispatch that removes reads from it
 * should re-measure rather than assume.
 */
const REACH = [
  ['ui-live-smoke.mjs', 200],
  ['resume-live-smoke.mjs', 25],
  ['packaged-smoke.mjs', 10],
]

describe('the walk reaches the instrument that runs it', () => {
  it('⛔ the guarded set is derived, non-empty, and is exactly the smokes that run the walk', () => {
    expect(GUARDED, 'no script imports assertTabFlow — the derivation found nothing').not.toEqual(
      [],
    )
    expect(GUARDED).toEqual(['packaged-smoke.mjs', 'resume-live-smoke.mjs', 'ui-live-smoke.mjs'])
  })

  /**
   * ⛔ **The derivation reads the import, and this is what says so.** Without it any file that so
   * much as names `assertTabFlow` in prose joins the set — which is how a probe got in, on the
   * strength of a comment saying it was not in. ⚠️ Planted since D-016: `project-sheet-probe.mjs`,
   * the real file that only mentioned the walk, went with projects.
   */
  it('⛔ a file that only MENTIONS the walk is not treated as running it', () => {
    const mentions = [
      '// ⚠️ This probe does not run `assertTabFlow`; its hooks are not covered by the walk.',
      "import { spawn } from 'node:child_process'",
    ].join('\n')
    expect(mentions).toMatch(/\bassertTabFlow\b/)
    expect(IMPORTS_THE_WALK.test(mentions)).toBe(false)
    // ⚑ One fact over: the import the three smokes really carry.
    expect(
      IMPORTS_THE_WALK.test("import { WIDE_READ_MARK, assertTabFlow } from './lib/tab-flow.mjs'"),
    ).toBe(true)
  })

  it.each(REACH)('%s is really being read — at least %i distinct hooks', (name, floor) => {
    expect(hooksIn(script(name)).length).toBeGreaterThanOrEqual(floor)
  })

  it.each(GUARDED)('%s builds no hook the walk cannot read', (name) => {
    expect(builtHookViolations(script(name))).toEqual([])
  })
})

describe('…and the guard can actually go red', () => {
  /**
   * ⛔ **310's line, verbatim.** This is the plant-and-find half: it proves the DETECTOR, and on its
   * own it would prove nothing about whether the real file is ever opened — which is what the
   * `REACH` floors above are for.
   */
  it('🔴 reports the exact selector 310 shipped, with its line number', () => {
    const planted = [
      'const pick = (cy, value) => {',
      "  const el = document.querySelector('[data-cy=' + cy + ']')",
      '}',
    ].join('\n')
    expect(builtHookViolations(planted)).toEqual([
      {
        line: 2,
        text: "[data-cy=' + cy + ']')",
        code: "const el = document.querySelector('[data-cy=' + cy + ']')",
      },
    ])
  })

  /**
   * ⛔ **727 · step 37's line, as it stood from `105` to `722`** — a JSON-quoted id inside a quoted
   * selector. Its quotes end the attribute at run time, so the live walk refuses it; filled with a
   * bare `x` it read as a hook here, and the step was red on the first run ever to reach it.
   */
  it('🔴 reports a JSON-quoted hole inside a quoted selector, as the live walk does', () => {
    const planted =
      "            `return (document.querySelector('[data-cy=\"library-outcome-' + ${JSON.stringify(target.id)} + '\"]') || {}).textContent ?? ''`,"
    expect(builtHookViolations(planted)).toHaveLength(1)
  })

  /** 113's shape — a name whose literal head DOES belong to an owned family. */
  it('🔴 reports a built name whose prefix could be a drawer hook', () => {
    const planted = `const rows = (section) => document.querySelectorAll('[data-cy=' + section + ']')`
    expect(builtHookViolations(planted)).toHaveLength(1)
  })

  /**
   * ⚠️ **The negative half, and each of these WOULD be reported without one specific rule.** Review
   * checked that claim by removing each rule in turn and re-running every fixture; two of the
   * original eight passed under every removal, including the guard deleted outright, and are gone or
   * rewritten. A guard that waves everything through is green on a broken tree, so every legitimate
   * spelling in the guarded files is named here rather than left to the whole-file assertion above.
   */
  it.each([
    ['a node-side hole, quoted', `const el = document.querySelector('[data-cy="${'${cy}'}"]')`],
    ['a node-side hole, bare', `const el = document.querySelector('[data-cy=${'${cy}'}]')`],
    [
      'a page-side build whose head is provably outside the drawer',
      `document.querySelector('[data-cy=open-session-' + ${'${JSON.stringify(id)}'} + ']')`,
    ],
    // ⛔ A scan whose value is ALSO built, so the scan rule is what excuses it. Review measured the
    // first version — a plain `[data-cy^=drawer-tab-]` — passing under every rule removal there is,
    // including the guard deleted outright: it asserted nothing.
    [
      'a prefix scan, whose value is built as well',
      `document.querySelectorAll('[data-cy^=' + p + ']')`,
    ],
    ['a literal hook', `document.querySelector('[data-cy=event-log]')`],
    // ⛔ **The nested hole is written under an OWNED prefix on purpose.** The first version of this
    // fixture used an ordinary one, and the brace-counting mutation survived it: with `injected-`
    // absent, the leftover `x.a }` fails `HOOK_NAME` and is then waved through by the prefix rule,
    // so both readings give the same answer and the comparison measured nothing.
    [
      'a nested node-side hole, under a prefix a drawer hook could own',
      `document.querySelector('[data-cy=injected-${'${ {a: 1}.a }'}]')`,
    ],
    [
      'a nested node-side hole, ordinary prefix',
      `document.querySelector('[data-cy="${'${a ? b : { c: 1 }.c}'}"]')`,
    ],
  ])('⚑ does not report %s', (_what, line) => {
    expect(builtHookViolations(line)).toEqual([])
  })

  /**
   * ⚑ **A documented BLIND SPOT, not a rule.** The smokes hand a whole selector to a page-side
   * helper at eight-odd sites and say at each why. ⛔ The live walk cannot see those either — it is
   * handed the same string — so this is the same blind spot rather than a new one, and it is here to
   * be found when somebody asks what the guard's zero means.
   */
  it('⚠️ cannot see a whole selector passed as a parameter — the walk cannot either', () => {
    expect(builtHookViolations(`const el = (sel) => document.querySelector(sel)`)).toEqual([])
  })

  it('⚑ does not report the repo prose that quotes the defect', () => {
    const planted = `      // used to build them — \`'[data-cy=' + section + ']'\` — behind a little helper,`
    expect(builtHookViolations(planted)).toEqual([])
  })

  /**
   * ⛔ **There is no exemption, and this is the assertion that keeps it that way** (345 review).
   *
   * A first draft carried a `BUILT_HOOK_MARK`, and measuring it is what removed it: a mark honoured
   * HERE and not by `assertTabFlow` gives `pnpm run ci` green with the live step still dead — `310`'s
   * state exactly, reached by following the guard's own instruction. ⚠️ **`WIDE_READ_MARK` is the
   * one mark this module has, it exempts a read that crosses tabs, and it does not and must not
   * excuse a hook the walk cannot read** — the live walk checks the unreadable rule first and only
   * lets the mark past it, so a wide-marked built hook still throws at run time.
   */
  it('⛔ no mark in this module stands a built hook down', () => {
    const built = `document.querySelector('[data-cy=' + cy + ']')`
    expect(builtHookViolations(built)).toHaveLength(1)
    for (const marked of [`${built} // ${WIDE_READ_MARK}`, `// ${WIDE_READ_MARK}\n${built}`]) {
      expect(builtHookViolations(marked), marked).toHaveLength(1)
    }
  })
})
