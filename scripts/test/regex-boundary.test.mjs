import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BACKSLASH_IS_REAL,
  regexBoundaryViolations,
  regexLiteralsIn,
} from '../lib/regex-boundary.mjs'

/**
 * The regex template-boundary guard.
 *
 * The mutation proof is the point of this file, not the sweep: the guard reports zero over the
 * real scripts, and a check that reports nothing looks like a check that does nothing. So both
 * historical defects are put back on the real file and the guard must catch each. If a mutation
 * stops applying, the test fails on that rather than asserting over an unchanged string.
 * Most cases below each pin one scanner defect that review found.
 */

const B = '\\'
const T = '`'
const HOLE = '$'

const read = new Map()
/**
 * One script's source, read once. Four tests take a pass over the same 1.07 MB file; the lexing,
 * the expensive half, is memoised in {@link scanned}.
 */
const script = (name) => {
  if (!read.has(name)) {
    read.set(name, readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8'))
  }
  return read.get(name)
}

const scanned = new Map()
/**
 * The violations for one unmutated script, lexed once.
 *
 * Memoised rather than given a longer timeout: `regexBoundaryViolations` is a full lexical pass
 * (~0.9 s on `ui-live-smoke.mjs`) and three tests want the answer for the identical source. The
 * two `HISTORY` cases mutate the text first and call the raw function.
 */
const violationsIn = (name) => {
  if (!scanned.has(name)) scanned.set(name, regexBoundaryViolations(script(name)))
  return scanned.get(name)
}

const literals = new Map()
/** The same, for the literal census — the other whole-file pass these tests take. */
const literalsIn = (name) => {
  if (!literals.has(name)) literals.set(name, regexLiteralsIn(script(name)))
  return literals.get(name)
}

/**
 * These tests lex a megabyte and vitest's default timeout is five seconds. `ui-live-smoke.mjs` is
 * 1.07 MB and one pass costs ~0.9 s. The memo above removes the duplicated work; this stays as a
 * floor for the pass that remains, since how loaded the machine is cannot be bounded here.
 */
const LEXES_A_WHOLE_SCRIPT = 30_000

/**
 * Every script that ships JavaScript into another process, and the library beside them.
 * `lib/regex-boundary.mjs` scans itself: its own message templates are subject to the rule.
 */
const GUARDED = [
  'ui-live-smoke.mjs',
  'resume-live-smoke.mjs',
  'packaged-smoke.mjs',
  'nav-order-probe.mjs',
  'lib/tab-flow.mjs',
  'lib/regex-boundary.mjs',
]

describe('the guard over the real scripts', () => {
  it.each(GUARDED)(
    '%s has no regex on the wrong side of the boundary',
    (name) => {
      expect(violationsIn(name)).toEqual([])
    },
    LEXES_A_WHOLE_SCRIPT,
  )

  /**
   * Per file, because a total hides a file the scanner gave up on: counts prove what the scanner
   * found, not what exists, but a file that suddenly finds none is visible blindness. The two live
   * smokes are where both historical defects lived and must show literals on both sides.
   */
  it.each([
    ['ui-live-smoke.mjs', 100, 40],
    ['resume-live-smoke.mjs', 6, 3],
    ['packaged-smoke.mjs', 10, 1],
  ])(
    '%s is really being read — at least %i literals, %i of them page-side',
    (name, all, page) => {
      const found = literalsIn(name)
      expect(found.length).toBeGreaterThanOrEqual(all)
      expect(found.filter((one) => one.depth > 0).length).toBeGreaterThanOrEqual(page)
      expect(found.filter((one) => one.depth === 0).length).toBeGreaterThan(0)
    },
    LEXES_A_WHOLE_SCRIPT,
  )

  it('⚑ two literals on ONE line are both seen — synthetic, since 420 removed the real pair', () => {
    // Synthetic on purpose: no real line carries two page-side regex literals today, so this cannot
    // be pointed at real source. The lexer really running over the real scripts is held by
    // {@link LITERAL_FLOORS} above. This asserts the first of two regexes on a line is seen when an
    // earlier line ends with an identifier (`innerText`) and the next starts with `return /re/`.
    const both = regexLiteralsIn(
      'const said = /own data directory/.test(text) ? ' +
        'text.match(/[^\\\\n]*own data directory[^\\\\n]*/)[0] : null',
    )
    expect(
      both,
      'the first literal on the line is invisible — `word` is accumulating again',
    ).toHaveLength(2)
    expect(both[0].text).toBe('/own data directory/')
  })
})

/**
 * The two defects, put back where they were.
 *
 * The mutation is applied to the REAL source, so a rewrite that moves or reformats either line
 * breaks this test loudly instead of turning it into a no-op.
 */
const HISTORY = [
  {
    // Re-pointed at a synthetic fixture: the original `ui-live-smoke.mjs` line,
    // `text.match(/[^\\n]*own data directory[^\\n]*/)`, was removed with its step. A removed anchor is
    // not a removed rule, since the boundary is still crossed many times in that file.
    //
    // The arriving fault here is different: `\\s` halved is `/s+/g`, a regex that quietly matches
    // the letter `s`. That is the worse half of the class, since the original blew up with a
    // `SyntaxError` where somebody had to look and this one would keep passing.
    what: '093 · a page-side escape halved — the boundary crossing, on a line that still exists',
    now: "replace(/\\\\s+/g, ' ')",
    then: "replace(/\\s+/g, ' ')",
    side: 'page',
    says: 'the escape is gone',
  },
  {
    what: '117 · step 57 — escaped TWICE outside one, so it demanded a literal backslash',
    now: '/^agent-.+\\.jsonl$/',
    then: '/^agent-.+\\\\.jsonl$/',
    side: 'node',
    says: 'LITERAL BACKSLASH',
  },
]

describe('⛔ proof it can fail: both historical defects, reintroduced', () => {
  it.each(HISTORY)(
    '$what',
    ({ now, then, side, says }) => {
      const source = script('ui-live-smoke.mjs')
      // The mutation has to actually apply, or everything below is a test of an unchanged file.
      expect(source, 'the line this mutation targets is no longer in the file').toContain(now)
      const mutated = source.replace(now, then)
      expect(mutated).not.toBe(source)

      const violations = regexBoundaryViolations(mutated)
      expect(violations).toHaveLength(1)
      expect(violations[0].side).toBe(side)
      // The message has to say what the far side actually gets, not just "wrong escaping" — that is
      // the difference between a report you can act on and one you have to re-derive.
      expect(violations[0].message).toContain(says)
    },
    LEXES_A_WHOLE_SCRIPT,
  )
})

describe('the escape set and the keyword set are pinned, member by member', () => {
  /**
   * Each escape-set member is its own case, in both directions, so no member goes unasserted.
   */
  const ESCAPES = [
    '.',
    'd',
    'D',
    'w',
    'W',
    's',
    'S',
    'b',
    'B',
    'n',
    'r',
    't',
    'f',
    'v',
    'x',
    'u',
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '+',
    '*',
    '?',
    '(',
    ')',
    '[',
    ']',
    '{',
    '}',
    '^',
    '$',
    '|',
  ]

  it.each(ESCAPES)('node-side `\\\\%s` is reported, and `\\%s` is not', (escape) => {
    // `[` needs a class to close, or the fixture is not a regex at all and the scanner is right to
    // find nothing.
    const tail = escape === '[' ? 'b]$' : '$'
    const wrong = `const re = /^a${B}${B}${escape}${tail}/`
    const right = `const re = /^a${B}${escape}${tail}/`
    // The scanner has to have seen a literal in each fixture, or "reported" and "not reported" are
    // both statements about an empty list.
    expect(regexLiteralsIn(wrong)).toHaveLength(1)
    expect(regexLiteralsIn(right)).toHaveLength(1)
    expect(regexBoundaryViolations(wrong)).toHaveLength(1)
    expect(regexBoundaryViolations(right)).toEqual([])
  })

  it.each(['return', 'typeof', 'case', 'in', 'of', 'new', 'do', 'else', 'yield', 'await', 'throw'])(
    'a regex directly after `%s` is seen',
    (keyword) => {
      // Each keyword is a real opening position and is its own case.
      expect(regexLiteralsIn(`${keyword} /^a${B}${B}.b$/`)).toHaveLength(1)
    },
  )
})

describe('which side of the boundary a literal is on', () => {
  it('a regex in ordinary code is node-side; the same one inside a template is not', () => {
    expect(regexLiteralsIn(`const a = /${B}d+/.test(x)`)[0]).toMatchObject({ depth: 0 })
    expect(regexLiteralsIn(`cdp.evaluate(${T}return /${B}${B}d+/.test(x)${T})`)[0]).toMatchObject({
      depth: 1,
    })
  })

  it('⚠️ a `${…}` hole is ordinary code, however deep the template around it', () => {
    // The hole is evaluated here and its value interpolated; nothing cooks a regex inside one, so it
    // is judged by the node-side rule. Getting this wrong would fail every correct interpolated read.
    const source = `cdp.evaluate(${T}x ${HOLE}{ /${B}d+/.exec(name)[0] } y${T})`
    expect(regexLiteralsIn(source)).toHaveLength(1)
    expect(regexLiteralsIn(source)[0]).toMatchObject({ depth: 0, text: `/${B}d+/` })
    expect(regexBoundaryViolations(source)).toEqual([])
  })

  it('⚑ a TAGGED template keeps the node-side rule, because String.raw cooks nothing', () => {
    // Judged page-side, both of these come out backwards: the correct one fails and the broken one
    // passes. `scripts/nav-order-probe.mjs` ships a whole program through String.raw.
    expect(
      regexBoundaryViolations(`const P = String.raw${T}return /^${B}d+$/.test(x)${T}`),
    ).toEqual([])
    expect(
      regexBoundaryViolations(`const P = String.raw${T}return /^${B}${B}d+$/.test(x)${T}`),
    ).toHaveLength(1)
    // …and the paired positive that the SAME text in a plain template is judged the other way.
    expect(regexBoundaryViolations(`const P = ${T}return /^${B}d+$/.test(x)${T}`)).toHaveLength(1)
  })
})

describe('what the scanner must not mistake for a regex', () => {
  it('division, in the shapes that actually occur', () => {
    expect(regexLiteralsIn('const rate = total / count')).toEqual([])
    expect(regexLiteralsIn('const s = ms / 1000 / 60')).toEqual([])
    expect(regexLiteralsIn('const p = list[0] / other[1]')).toEqual([])
  })

  it('comments, strings and paths', () => {
    expect(regexLiteralsIn(`const u = 'https://example.com/a/b'`)).toEqual([])
    expect(regexLiteralsIn(`// const bad = /${B}n/\nconst ok = 1`)).toEqual([])
    expect(regexLiteralsIn(`/* /${B}n/ */ const ok = 1`)).toEqual([])
    // …and the paired positive, so the three negatives above are not a scanner that reads nothing.
    expect(regexLiteralsIn(`const u = 'https://x/y'\nconst re = /${B}d/`)).toHaveLength(1)
  })

  it('a shebang is not a regex, and line 1 is not lost to one', () => {
    const found = regexLiteralsIn(`#!/usr/bin/env node\nconst re = /${B}d+/\n`)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ text: `/${B}d+/`, line: 2 })
  })

  it('⛔ an apostrophe in template PROSE does not swallow the template (review)', () => {
    // The cascade: an apostrophe opened a "string" that ran to end of line, ate the closing
    // backtick, and every later literal in the file reported the wrong side.
    const source =
      `const msg = ${T}this is 093's step 46, where the step could ${T} +\n` +
      `  'tail'\nconst re = /${B}${B}./`
    const found = regexLiteralsIn(source)
    expect(found).toHaveLength(1)
    expect(
      found[0],
      'the template leaked and the node-side regex was read as page-side',
    ).toMatchObject({ depth: 0 })
    // …and the paired positive: a real page-side string still closes and is still skipped.
    const real = `cdp.evaluate(${T}return document.querySelector('[data-cy=x]/y') ? 1 : 2${T})`
    expect(regexLiteralsIn(real)).toEqual([])

    // The same-line half, which the assertions above do not reach: bounding the template already
    // stops the cascade, but an apostrophe in prose would still open a "string" that runs to the
    // newline and takes the literal after it, inside a correctly bounded template.
    const sameLine = `cdp.evaluate(${T}\n  const a = /${B}${B}d+/ // it's here\n  return a\n${T})`
    expect(regexLiteralsIn(sameLine)).toHaveLength(1)
    const swallowed = `cdp.evaluate(${T}\n  const s = 'it's fine' + /${B}${B}w/.source\n${T})`
    expect(regexLiteralsIn(swallowed)).toHaveLength(1)
  })

  it('⛔ a `//` comment containing a hole does not spill into code (review)', () => {
    // Both halves: the first reported a violation against prose, whose suggested fix would edit a
    // comment; the second lost a real literal to the apostrophe.
    const prose = `cdp.evaluate(${T}\n  // ${HOLE}{MARK} the old check was: /${B}d+/ and it never matched\n  return 1\n${T})`
    expect(regexBoundaryViolations(prose)).toEqual([])
    const apostrophe = `cdp.evaluate(${T}\n  // ${HOLE}{MARK} 097's walk, so: /${B}d+/ stays\n  return 1\n${T})`
    expect(regexBoundaryViolations(apostrophe)).toEqual([])
  })

  it('⛔ a `}` inside a character class does not end the hole early (review)', () => {
    // The expression was dropped on the floor entirely — no literal, no violation, and the rest of
    // the template rescanned at the wrong depth.
    const source = `cdp.evaluate(${T}x ${HOLE}{ /^a${B}${B}.[}]b$/.test(n) } y${T})`
    expect(regexLiteralsIn(source)).toHaveLength(1)
    expect(regexBoundaryViolations(source)).toHaveLength(1)
    expect(regexBoundaryViolations(source)[0].side).toBe('node')
  })

  it('⛔ an escaped backtick in template text does not open a nested template (review)', () => {
    const source =
      `await cdp.evaluate(${T}\n  const t = ${B}${T}inline${B}${T};\n` +
      `  return document.body.innerText.replace(/${B}${B}s+/g, " ")\n${T})`
    expect(regexBoundaryViolations(source)).toEqual([])
    expect(regexLiteralsIn(source)[0]).toMatchObject({ depth: 1 })
  })
})

describe('the rule, in both directions', () => {
  it('page-side: a lone backslash is eaten, however innocent it looks', () => {
    // The silent half of the class: `\d` inside a template reaches the far side as a bare `d`, with
    // no SyntaxError, and a check that quietly matches something else.
    const [one] = regexBoundaryViolations(`cdp.evaluate(${T}return /^${B}d+$/.test(x)${T})`)
    expect(one.side).toBe('page')
    expect(one.message).toContain('is left standing alone')
    expect(regexBoundaryViolations(`cdp.evaluate(${T}return /^${B}${B}d+$/.test(x)${T})`)).toEqual(
      [],
    )
  })

  it('node-side: a doubled backslash before an escape is the mirror image', () => {
    const [one] = regexBoundaryViolations(`const re = /^a${B}${B}.b$/`)
    expect(one.side).toBe('node')
    expect(regexBoundaryViolations(`const re = /^a${B}.b$/`)).toEqual([])
  })

  it('⛔ FOUR backslashes are caught on both sides (review)', () => {
    // Parity alone called these clean. Page-side, four survive the crossing as two; node-side, four
    // are two literal backslashes.
    const page = regexBoundaryViolations(
      `cdp.evaluate(${T}return /^a${B.repeat(4)}.b$/.test(n)${T})`,
    )
    expect(page).toHaveLength(1)
    expect(page[0].side).toBe('page')
    expect(page[0].message).toContain('over-escaped')
    expect(regexBoundaryViolations(`const re = /^a${B.repeat(4)}.b$/`)).toHaveLength(1)
  })

  it("⚑ matching a real backslash is allowed — it is not 'any doubled backslash'", () => {
    // A `\\` inside a character class is the ordinary way to write a backslash, and an EVEN run on
    // the page side is exactly how one is meant to be written.
    expect(regexBoundaryViolations(`const re = /[/${B}${B}]+/g`)).toEqual([])
    expect(regexBoundaryViolations(`const sep = /[${B}${B}.]/.test(x)`)).toEqual([])
    expect(
      regexBoundaryViolations(`cdp.evaluate(${T}return /${B}${B}${B}${B}/.test(x)${T})`),
    ).toEqual([])
  })

  it('⛔ …and where it cannot tell, the marker says so — in the source, in the diff', () => {
    // `/\\./g` (strip escape sequences) and `/\\n/` (a two-character `\n` in a JSONL line) are
    // correct node-side regexes this rule reports. A guard that fails correct code gets switched off,
    // so the author says the backslash is real and it is believed.
    const strip = `const bare = s.replace(/${B}${B}./g, '')`
    expect(regexBoundaryViolations(strip)).toHaveLength(1)
    expect(regexBoundaryViolations(`// ${BACKSLASH_IS_REAL} — a real backslash\n${strip}`)).toEqual(
      [],
    )
    expect(regexBoundaryViolations(`${strip} // ${BACKSLASH_IS_REAL}`)).toEqual([])
    // Not a blanket off-switch: the line above and the line itself, and nothing further.
    expect(regexBoundaryViolations(`// ${BACKSLASH_IS_REAL}\nconst a = 1\n${strip}`)).toHaveLength(
      1,
    )
  })
})
