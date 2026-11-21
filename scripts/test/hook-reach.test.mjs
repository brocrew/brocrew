import { describe, expect, it } from 'vitest'
import { WIDE_READ_MARK, builtHookViolations } from '../lib/tab-flow.mjs'

describe('…and the guard can actually go red', () => {
  /**
   * The exact selector that once shipped, verbatim. This is the plant-and-find half: it proves the
   * detector, and says nothing about whether the real file is opened, which the `REACH` floors
   * above cover.
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
   * A JSON-quoted id inside a quoted selector. Its quotes end the attribute at run time, so the
   * live walk refuses it; filled with a bare `x` it read as a hook here, and the live step went red
   * on the first run to reach it.
   */
  it('🔴 reports a JSON-quoted hole inside a quoted selector, as the live walk does', () => {
    const planted =
      "            `return (document.querySelector('[data-cy=\"library-outcome-' + ${JSON.stringify(target.id)} + '\"]') || {}).textContent ?? ''`,"
    expect(builtHookViolations(planted)).toHaveLength(1)
  })

  /** A name whose literal head does belong to an owned family. */
  it('🔴 reports a built name whose prefix could be a drawer hook', () => {
    const planted = `const rows = (section) => document.querySelectorAll('[data-cy=' + section + ']')`
    expect(builtHookViolations(planted)).toHaveLength(1)
  })

  /**
   * The negative half. Each of these would be reported without one specific rule; that was checked
   * by removing each rule in turn and re-running every fixture, and fixtures that passed under every
   * removal were dropped or rewritten. A guard that waves everything through is green on a broken
   * tree, so every legitimate spelling in the guarded files is named here.
   */
  it.each([
    ['a node-side hole, quoted', `const el = document.querySelector('[data-cy="${'${cy}'}"]')`],
    ['a node-side hole, bare', `const el = document.querySelector('[data-cy=${'${cy}'}]')`],
    [
      'a page-side build whose head is provably outside the drawer',
      `document.querySelector('[data-cy=open-session-' + ${'${JSON.stringify(id)}'} + ']')`,
    ],
    // A scan whose value is also built, so the scan rule is what excuses it. A plain
    // `[data-cy^=drawer-tab-]` passed under every rule removal, including the guard deleted outright.
    [
      'a prefix scan, whose value is built as well',
      `document.querySelectorAll('[data-cy^=' + p + ']')`,
    ],
    ['a literal hook', `document.querySelector('[data-cy=session-info]')`],
    // The nested hole is written under an owned prefix on purpose: with an ordinary one, the
    // brace-counting mutation survived, since with `injected-` absent the leftover `x.a }` fails
    // `HOOK_NAME` and is then waved through by the prefix rule, so both readings agree.
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
   * A documented blind spot, not a rule. The smokes hand a whole selector to a page-side helper at
   * eight-odd sites and say at each why. The live walk cannot see those either, so this is the same
   * blind spot, recorded for whoever asks what the guard's zero means.
   */
  it('⚠️ cannot see a whole selector passed as a parameter — the walk cannot either', () => {
    expect(builtHookViolations(`const el = (sel) => document.querySelector(sel)`)).toEqual([])
  })

  it('⚑ does not report the repo prose that quotes the defect', () => {
    const planted = `      // used to build them — \`'[data-cy=' + section + ']'\` — behind a little helper,`
    expect(builtHookViolations(planted)).toEqual([])
  })

  /**
   * There is no exemption, and this assertion keeps it that way. A mark honoured here and not by
   * `assertTabFlow` gives `pnpm run ci` green with the live step still dead. `WIDE_READ_MARK` is
   * the one mark this module has: it exempts a read that crosses tabs, and must not excuse a hook
   * the walk cannot read, since the live walk checks the unreadable rule first and only lets the
   * mark past it.
   */
  it('⛔ no mark in this module stands a built hook down', () => {
    const built = `document.querySelector('[data-cy=' + cy + ']')`
    expect(builtHookViolations(built)).toHaveLength(1)
    for (const marked of [`${built} // ${WIDE_READ_MARK}`, `// ${WIDE_READ_MARK}\n${built}`]) {
      expect(builtHookViolations(marked), marked).toHaveLength(1)
    }
  })
})
