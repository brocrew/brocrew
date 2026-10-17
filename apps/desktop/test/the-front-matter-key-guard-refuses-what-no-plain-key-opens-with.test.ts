import { describe, expect, it } from 'vitest'
import { resourceTitle } from '../src/main/resources/resources'
import { formOfName, type DocumentForm } from '../src/shared/documents'

/**
 * # F085 · the front-matter key guard: what it refuses, each beside its accepted twin, and linear
 *
 * `c8a1fda8` widened `YAML_KEY` (`resources.ts`) so a key may hold spaces, colons not followed by a
 * space, or be quoted. Its own tests (`a-front-matter-title-is-read-as-yaml-keys.test.ts`) pin a
 * spaced key against prose, a quoted key against an unclosed DOUBLE quote, a colon inside a key
 * against a `- ` list item, `key: v` against `key:v`, and 200,000 spaces with no colon. This file
 * pins the rest of what the guard says it refuses, each one fact from a line it accepts:
 *
 *  - **§1 · how a line may open** — `- ` and `? ` (a space or a tab after them) are refused, while
 *    `-key` and `?key` are plain keys; a leading `:` is refused; each YAML indicator
 *    (`[ ] { } , & * ! | > % @` and a backtick) is refused as the first character, and accepted
 *    inside the key.
 *  - **§2 · quoted keys** — `'…'` with `''` and `"…"` with `\"` are keys; the same quote left open
 *    is not; spaces between a closing quote and its colon are allowed, a word there is not.
 *  - **§3 · linear** — adversarial lines a backtracking regression would chew on (colon runs, escape
 *    runs, doubled-quote runs, spaces after a closed quote, tens of thousands of key lines), each in
 *    a doubling ladder that stops at the first step over its budget, so a quadratic regression fails
 *    in seconds instead of hanging.
 *
 * ⚑ Every row is read through `resourceTitle`, the one rule a kept file is titled by: an accepted
 * line leaves the front matter readable, so the file is titled `Named`; a refused one makes the
 * first `---` a rule, so it is titled by its heading. A pair whose two answers agree measures
 * nothing, and {@link pair} refuses it.
 *
 * ⚠️ `#` as a first character is refused by `YAML_KEY` too, but every line that opens with `#` is
 * passed as a YAML comment by the line before it in `frontMatterTitle`, so that refusal cannot be
 * seen through `resourceTitle` and is not pinned here.
 */

const NAME = 'doc.md'

const titled = (content: string): string =>
  resourceTitle({
    name: NAME,
    form: formOfName(NAME) as DocumentForm,
    bytes: Buffer.from(content, 'utf8'),
  })

/** A front matter whose first key line is `line`, then `title: Named`, over a body headed `Heading`. */
const withFirstLine = (line: string): string => `---\n${line}\ntitle: Named\n---\n# Heading\n`

const ACCEPTED = 'Named'
const REFUSED = 'Heading'

interface Pair {
  readonly what: string
  /** A line the guard must refuse: the file is titled by its heading. */
  readonly refused: string
  /** The line one fact over, which it must accept: the file is titled by its front matter. */
  readonly accepted: string
}

const pair = (rows: readonly Pair[]): void => {
  for (const row of rows) {
    expect(row.refused, `${row.what}: the two lines differ`).not.toBe(row.accepted)
    expect(titled(withFirstLine(row.accepted)), `${row.what} · accepted: ${row.accepted}`).toBe(
      ACCEPTED,
    )
    expect(titled(withFirstLine(row.refused)), `${row.what} · refused: ${row.refused}`).toBe(
      REFUSED,
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · how a line may open
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('F085 · §1 · a key may not open the way a list item, a question mark or an indicator does', () => {
  it('`- ` and `? ` open no key, with a space or a tab after them; `-` and `?` before a word do', () => {
    pair([
      { what: 'a list item', refused: '- item', accepted: 'item: x' },
      { what: 'a list item holding a key', refused: '- key: x', accepted: '-key: x' },
      { what: 'a list item opened by a tab', refused: '-\tkey: x', accepted: '-key: x' },
      { what: 'a complex-key mark', refused: '? key: x', accepted: '?key: x' },
      { what: 'a complex-key mark opened by a tab', refused: '?\tkey: x', accepted: '?key: x' },
    ])
  })

  it('a line opening with `:` is no key; a colon inside a key, not followed by a space, is', () => {
    pair([
      { what: 'a leading colon then a key', refused: ':a: x', accepted: 'a:a: x' },
      { what: 'two leading colons', refused: ':: x', accepted: 'a:: x' },
    ])
  })

  it('each YAML indicator is refused as the first character of a key, and accepted inside one', () => {
    const indicators = ['[', ']', '{', '}', ',', '&', '*', '!', '|', '>', '%', '@', '`'] as const
    pair(
      indicators.map((mark) => ({
        what: `the indicator ${mark}`,
        refused: `${mark}key: x`,
        accepted: `k${mark}ey: x`,
      })),
    )
  })

  it('a key may hold spaces before its colon, and a tab after it; a colon with neither after it ends nothing', () => {
    pair([
      {
        what: 'spaces before the colon',
        refused: 'range checked   :x',
        accepted: 'range checked   : x',
      },
      { what: 'a tab after the colon', refused: 'range checked:x', accepted: 'range checked:\tx' },
      { what: 'a colon at the end of the line', refused: 'parent :x', accepted: 'parent :' },
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · quoted keys
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('F085 · §2 · a quoted key is closed by its own quote, and its escapes are read', () => {
  it("a single-quoted key closes, with `''` inside it; the same quote left open is refused", () => {
    pair([
      { what: 'a single-quoted key', refused: "'range checked: x", accepted: "'range checked': x" },
      { what: "a doubled '' inside it", refused: "'it''s: x", accepted: "'it''s': x" },
    ])
  })

  it('a double-quoted key may hold `\\"`; a key whose last quote is escaped never closes', () => {
    pair([
      {
        what: 'an escaped quote inside a double-quoted key',
        refused: '"say \\"hi\\": x',
        accepted: '"say \\"hi\\"": x',
      },
      {
        what: 'an escaped backslash before the closing quote',
        refused: '"a\\": x',
        accepted: '"a\\\\": x',
      },
    ])
  })

  it('blanks may stand between a closing quote and its colon; a word there may not', () => {
    pair([
      { what: 'spaces after a double quote', refused: '"key" word: x', accepted: '"key"   : x' },
      { what: 'a tab after a single quote', refused: "'key' word: x", accepted: "'key'\t: x" },
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · linear
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚑ **A doubling ladder with a budget per step.** Each step builds `make(n)` and titles it; the
 * first step over {@link STEP_BUDGET_MS} fails the test at once, so a quadratic regression stops at
 * the step where it first costs a second (a few seconds at most) and the ladder never reaches the
 * size where it would hang. The answer is checked at every step, so a guard that is fast because it
 * answers the wrong thing fails too.
 *
 * ⚠️ The budget is generous on purpose — the linear guard takes milliseconds at the top step — so it
 * never flakes on a slow runner; what it catches is a scan that grows with the square of the line.
 */
const STEP_BUDGET_MS = 1_000
const LADDER = [1_000, 4_000, 16_000, 64_000, 256_000] as const

const staysLinear = (what: string, make: (n: number) => string, answer: string): void => {
  for (const n of LADDER) {
    const text = make(n)
    const started = performance.now()
    const got = titled(text)
    const took = performance.now() - started
    expect(got, `${what} · n = ${String(n)}`).toBe(answer)
    expect(took, `${what} · n = ${String(n)} took ${took.toFixed(1)} ms`).toBeLessThan(
      STEP_BUDGET_MS,
    )
  }
}

describe('F085 · §3 · the guard stays linear on lines built to make a backtracking scan chew', () => {
  it('a long key of colons with no space after any of them is refused at once; the same with `: v` after it is a key', () => {
    staysLinear('colon run, refused', (n) => withFirstLine(`x${':y'.repeat(n / 2)}`), REFUSED)
    staysLinear('colon run, accepted', (n) => withFirstLine(`x${':y'.repeat(n / 2)}: v`), ACCEPTED)
  })

  it('a long run of spaces and colons mixed, with no `: ` in it, is refused at once', () => {
    staysLinear('spaces then colons', (n) => withFirstLine(`x${' :y'.repeat(n / 3)}`), REFUSED)
    staysLinear('tabs, no colon', (n) => withFirstLine(`x${'\t'.repeat(n)}`), REFUSED)
  })

  it('an unclosed double-quoted key full of escapes is refused at once; closed, it is a key', () => {
    staysLinear('escape run, unclosed', (n) => withFirstLine(`"${'\\"'.repeat(n / 2)}`), REFUSED)
    staysLinear('escape run, closed', (n) => withFirstLine(`"${'\\"'.repeat(n / 2)}": v`), ACCEPTED)
  })

  it("an unclosed single-quoted key full of doubled '' is refused at once; closed, it is a key", () => {
    staysLinear(
      'doubled-quote run, unclosed',
      (n) => withFirstLine(`'${"''".repeat(n / 2)}x`),
      REFUSED,
    )
    staysLinear(
      'doubled-quote run, closed',
      (n) => withFirstLine(`'${"''".repeat(n / 2)}x': v`),
      ACCEPTED,
    )
  })

  it('a closed quote followed by a long run of blanks and no colon is refused at once', () => {
    staysLinear('blanks after a quote', (n) => withFirstLine(`"k"${' \t'.repeat(n / 2)}x`), REFUSED)
  })

  it('tens of thousands of key lines are read in one pass; one prose line at their end still makes it no front matter', () => {
    const keys = (n: number): string => 'some key: some value\n'.repeat(Math.max(1, n / 20))
    staysLinear('many keys', (n) => `---\n${keys(n)}title: Named\n---\n# Heading\n`, ACCEPTED)
    staysLinear(
      'many keys, then prose',
      (n) => `---\n${keys(n)}title: Named\nand then a sentence\n---\n# Heading\n`,
      REFUSED,
    )
  })
})
