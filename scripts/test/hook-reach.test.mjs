import { describe, expect, it } from 'vitest'
import { WIDE_READ_MARK, builtHookViolations } from '../lib/tab-flow.mjs'

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
    ['a literal hook', `document.querySelector('[data-cy=session-info]')`],
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
