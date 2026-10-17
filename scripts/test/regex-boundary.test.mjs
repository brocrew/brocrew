import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BACKSLASH_IS_REAL,
  regexBoundaryViolations,
  regexLiteralsIn,
} from '../lib/regex-boundary.mjs'

/**
 * 118 · The regex template-boundary guard (117 §7.1).
 *
 * ⚠️ **The mutation proof is the point of this file, not the sweep.** `117` swept
 * `ui-live-smoke.mjs` by hand and found no third instance, so the guard reports zero over the real
 * scripts today and will keep doing so until someone writes the next one. A check that reports
 * nothing is exactly the shape of a check that does nothing — which is the failure class this whole
 * item exists to remove — so both historical defects are put back, on the real file, and the guard
 * is required to catch each. If either mutation stops applying, the test fails on that rather than
 * quietly asserting over an unchanged string.
 *
 * ⛔ **Almost every case below was written by review, not by the author.** The first version of this
 * file passed while the guard had eight defects: an identifier accumulating across whitespace hid
 * one of the two literals on the very line the 093 mutation targets, four-backslash over-escaping
 * was called clean on both sides, `x`/`u`/`\1` were missing from the escape set, a tagged template
 * inverted the rule, a `}` in a character class dropped an expression, and an apostrophe in prose
 * desynchronised an entire file. Each has a case here, with the input that found it.
 */

const B = '\\'
const T = '`'
const HOLE = '$'

const read = new Map()
/**
 * One script's source, READ ONCE.
 *
 * ⚠️ Four tests below take a pass over the same 1.07 MB file; re-reading it for each was the cheap
 * half of the cost. The lexing is the expensive half and is memoised beside it in {@link scanned}.
 */
const script = (name) => {
  if (!read.has(name)) {
    read.set(name, readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8'))
  }
  return read.get(name)
}

const scanned = new Map()
/**
 * ⛔ **The violations for one UNMUTATED script, lexed once** (254, from the review).
 *
 * ⚑ **Memoised rather than merely given a longer timeout.** `regexBoundaryViolations` is a full
 * lexical pass — ~0.9 s on `ui-live-smoke.mjs` — and three of the tests below wanted the answer for
 * the identical source. ⚠️ The two `HISTORY` cases genuinely need their own pass, over text they
 * mutated first, and they call the raw function.
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
 * ⛔ **These tests lex a MEGABYTE, and vitest's default is five seconds** (254, found by this
 * dispatch's own diff).
 *
 * ⚠️ **`ui-live-smoke.mjs` is 1.07 MB and one pass over it costs ~0.9 s.** ⛔ **It went red on the
 * run that added step `76`**, which is not a defect in the guard and not a defect in the step: it is
 * a whole-file lexer wearing a unit test's timeout, and it was going to happen to whoever wrote the
 * next step.
 *
 * ⚑ **The fix is the memo above, not this number** (review). Three of the four passes were over the
 * IDENTICAL unmutated source, so the work was duplicated rather than large; a timeout alone would
 * have removed the only implicit backstop on the lexer's cost while leaving the waste in place. ⚠️
 * This stays as a floor for the one pass that remains, because how much of a machine the rest of the
 * suite is using is not something this file can bound.
 */
const LEXES_A_WHOLE_SCRIPT = 30_000

/**
 * Every script that ships JavaScript into another process, and the library beside them.
 *
 * ⚠️ `lib/regex-boundary.mjs` scans ITSELF. It is not exempt from a rule it enforces — and it was
 * the file whose own message templates exposed the apostrophe cascade.
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
   * ⛔ **Per file, because a total hides a file the scanner gave up on.** Review's exact objection:
   * the counts prove what the scanner FOUND, not what exists, so they cannot detect blindness on
   * their own — but a file that suddenly finds none is blindness anyone can see. The two live smokes
   * are the files both historical defects were in and both must show literals on both sides.
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
    // ⛔ **This is the assertion that stops the proof below being luck.** Until review, `word`
    // accumulated across whitespace, so `document.body.innerText` on one line and `return /re/`
    // on the next produced `innerTextreturn` and the FIRST of two regexes on a line was invisible.
    // The 093 mutation still passed — because the defect happens to live in the second.
    //
    // 🔴 **The real line it was written against is gone** (`420`). It was `ui-live-smoke.mjs` step
    // 46's, and `417` deleted the `cwd-input` field the whole step was about, so `420` reported
    // the step NOT PERFORMED and its body with it. ⚠️ **There is no second candidate**: a sweep of
    // the file finds ZERO lines carrying two page-side regex literals, so this cannot be
    // re-pointed at real source the way the fixtures below are.
    //
    // ⚑ **So it is synthetic, and says so** — and the property it was ALSO buying (that the lexer
    // really runs over the real scripts) is not lost: {@link LITERAL_FLOORS} above holds it, over
    // every guarded file, and would go red on a lexer that stopped seeing anything.
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
    // 🔴 **`420` re-pointed this fixture, and did NOT retire it.** Its original target was
    // `ui-live-smoke.mjs` step 46's `text.match(/[^\\n]*own data directory[^\\n]*/)` — `093`'s
    // actual defect, where a lone backslash was eaten by the template and the page received a raw
    // newline, a `SyntaxError`, a step that could never have passed. `417` deleted the `cwd-input`
    // field step 46 existed for, so `420` reported the step NOT PERFORMED and the line went with
    // it. ⛔ **A removed anchor is not a removed rule** — the boundary is still crossed 76 times in
    // that file, so the proof is re-aimed at one of them rather than deleted.
    //
    // ⚠️ **The arriving fault is a different one and the row says so.** `\\s` halved is not a
    // `SyntaxError`; it is `/s+/g`, a regex that quietly matches the letter `s`. ⚑ That is the
    // WORSE half of `093`'s class and the half a `SyntaxError` would never have reached: the
    // original blew up where somebody had to look, this one would have gone on passing.
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
   * ⛔ **Review shrank the escape set from 26 members to one and nothing failed.** Twenty-five of
   * them were asserted by nothing at all, which is a table that exists rather than a table that
   * works. Each member is now its own case, in both directions.
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
    // ⚠️ `[` needs a class to close, or the fixture is not a regex at all and the scanner is right
    // to find nothing — which is a fact about the test, not about the rule.
    const tail = escape === '[' ? 'b]$' : '$'
    const wrong = `const re = /^a${B}${B}${escape}${tail}/`
    const right = `const re = /^a${B}${escape}${tail}/`
    // ⛔ **The scanner has to have SEEN a literal in each fixture**, or "reported" and "not
    // reported" are both statements about an empty list. This is the non-vacuity guard, and it is
    // the right one: the guard reads text, so whether the engine would accept the expression is a
    // question about the fixture rather than about the rule.
    expect(regexLiteralsIn(wrong)).toHaveLength(1)
    expect(regexLiteralsIn(right)).toHaveLength(1)
    expect(regexBoundaryViolations(wrong)).toHaveLength(1)
    expect(regexBoundaryViolations(right)).toEqual([])
  })

  it.each(['return', 'typeof', 'case', 'in', 'of', 'new', 'do', 'else', 'yield', 'await', 'throw'])(
    'a regex directly after `%s` is seen',
    (keyword) => {
      // Emptying this set left both sweeps and both HISTORY mutations green in review — it was held
      // up by one assertion. Each keyword is a real opening position and each is now its own case.
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
    // The hole is evaluated HERE and its value interpolated; nothing cooks a regex inside one, so
    // it must be judged by the node-side rule. Getting this wrong would fail every correct
    // interpolated read in the smoke.
    const source = `cdp.evaluate(${T}x ${HOLE}{ /${B}d+/.exec(name)[0] } y${T})`
    expect(regexLiteralsIn(source)).toHaveLength(1)
    expect(regexLiteralsIn(source)[0]).toMatchObject({ depth: 0, text: `/${B}d+/` })
    expect(regexBoundaryViolations(source)).toEqual([])
  })

  it('⚑ a TAGGED template keeps the node-side rule, because String.raw cooks nothing', () => {
    // ⛔ Judged page-side, both of these come out backwards: the correct one is failed and the
    // broken one passes. `scripts/nav-order-probe.mjs` ships a whole program through String.raw.
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
    // The cascade: `093's` opened a "string" that ran to end of line, ate the closing backtick, and
    // every literal in the rest of the file then reported the wrong side. Measured on this module's
    // own message templates, from line 236 onwards.
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

    // ⛔ **And the SAME-LINE half, which the two assertions above do not reach.** Bounding the
    // template already stops the cascade, so reverting the quote rule alone left this file green —
    // the mutation check caught that, which is what a mutation check is for. What the rule protects
    // is the rest of the line: an apostrophe in prose would otherwise open a "string" that runs to
    // the newline and takes the literal sitting after it, silently, inside a template that is
    // still correctly bounded.
    const sameLine = `cdp.evaluate(${T}\n  const a = /${B}${B}d+/ // it's here\n  return a\n${T})`
    expect(regexLiteralsIn(sameLine)).toHaveLength(1)
    const swallowed = `cdp.evaluate(${T}\n  const s = 'it's fine' + /${B}${B}w/.source\n${T})`
    expect(regexLiteralsIn(swallowed)).toHaveLength(1)
  })

  it('⛔ a `//` comment containing a hole does not spill into code (review)', () => {
    // Both halves were live: the first reported a violation against PROSE, whose suggested fix
    // would have edited a comment; the second lost a real literal to the apostrophe in `097's`.
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
    // ⚠️ **The silent half of 093's class.** `\d` inside a template reaches the far side as a bare
    // `d` — no SyntaxError, no complaint, and a check that quietly matches something else.
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
    // Parity alone called these clean. Page-side, four survive the crossing as two — 117's defect
    // delivered intact; node-side, four are two literal backslashes.
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
    // Review produced six correct node-side regexes this rule reports. `/\\./g` — strip escape
    // sequences — is the canonical one, and `/\\n/` finds a two-character `\n` in a JSONL line,
    // which is a real thing to do in a repo that reads provider transcripts. A guard that fails
    // correct code gets switched off, so the author says the backslash is real and it is believed.
    const strip = `const bare = s.replace(/${B}${B}./g, '')`
    expect(regexBoundaryViolations(strip)).toHaveLength(1)
    expect(regexBoundaryViolations(`// ${BACKSLASH_IS_REAL} — a real backslash\n${strip}`)).toEqual(
      [],
    )
    expect(regexBoundaryViolations(`${strip} // ${BACKSLASH_IS_REAL}`)).toEqual([])
    // ⚠️ It is not a blanket off-switch: the line above and the line itself, and nothing further.
    expect(regexBoundaryViolations(`// ${BACKSLASH_IS_REAL}\nconst a = 1\n${strip}`)).toHaveLength(
      1,
    )
  })
})
