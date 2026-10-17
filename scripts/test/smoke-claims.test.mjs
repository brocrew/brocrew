import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ **The verdict is the TYPE, and this is what keeps it that way** (206 H1).
 *
 * `smoke-verdicts.mjs` gives a step's individual claims a typed verdict, so the run's headline can
 * say how many claims it reached rather than how many steps returned without throwing. ⚠️ **The
 * mechanism alone changes nothing**: the defect was a step writing *"3 NOT ASSERTED — …"* into the
 * string it returned, and nothing stops the next author doing exactly that again — the step would
 * still print the truth on its own line and still sum as one clean PASS.
 *
 * ⛔ **String-matching the RESULT is already ruled out** (`smoke-verdicts.test.mjs`, from 142): a
 * step that quotes the words about a sub-claim while asserting everything else it exists for would
 * be swept into the blank column, understating the run in the other direction. So the check moves
 * to where it can be exact — the SOURCE, at `pnpm run ci` time, where "a step wrote a verdict into
 * a sentence" is decidable and costs no live run to find out.
 *
 * ⚑ **This is the same seam `personal-home-guard.test.mjs` describes about itself**: a live smoke is
 * the one thing the gate cannot run, so what the gate CAN reach has to be the part that holds the
 * rule.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SMOKE = join(here, '../ui-live-smoke.mjs')

/** The file with its comment lines removed — a comment may say anything, and several must. */
function codeOf(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => {
      const trimmed = line.trim()
      return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))
    })
}

/**
 * The two lines that legitimately name the verdict: `record()` turning a flag into a word, and
 * `step()` reading that word back. Both are the harness, not a claim.
 */
/**
 * The two harness lines that legitimately carry the words, and nothing else may.
 *
 * ⚠️ **Both were re-spelled by `420`** and the exemptions moved with them rather than widening.
 * `record` now takes the verdict itself — there are five of them, and a boolean plus a `'blank'`
 * sentinel was already one cell past what that encoding could say — so `step()` hands
 * `outcomeVerdict`'s answer straight through. ⛔ The second pattern is the STRICTER of the two
 * possible spellings on purpose: `/record\(verdict\b/` would exempt any future `record(verdict…`
 * line, and the whole point of this list is that it names lines rather than shapes.
 */
const HARNESS = [
  /const verdict = typeof ok === 'string' \? ok : ok \? 'PASS' : 'FAIL'/,
  /record\(verdict, name, detail, claimed\)/,
]

describe('a live step may not write its own verdict into a sentence (206 H1)', () => {
  it('⛔ no step returns a string carrying ASSERTED or NOT ASSERTED', () => {
    const offenders = codeOf(SMOKE)
      // ⛔ **Both verdict words** (`420`). `196`'s rule is that a step may not write its own
      // verdict into a sentence, and `420` added a fifth verdict — so `NOT PERFORMED` is now
      // exactly as launderable as `NOT ASSERTED` was, and the headline's own
      // `⚑ N NOT PERFORMED` cell is the number a reader would be counting words against.
      .filter(({ line }) => /\bASSERTED\b|\bNOT PERFORMED\b/.test(line))
      .filter(({ line }) => !HARNESS.some((allowed) => allowed.test(line)))
      .map(({ number, line }) => `${number}: ${line.trim().slice(0, 90)}`)

    expect(
      offenders,
      'a claim whose verdict is English inside the result string is counted as one clean PASS — ' +
        'use asserted()/unasserted() inside claims(), where the verdict is data',
    ).toEqual([])
  })

  it('⚑ …and the paired positive: the typed form is actually in use', () => {
    // Without this, deleting every claim in the file would pass the test above. The numbers are
    // floors rather than exact counts — new steps make new claims, and that is the point.
    const source = readFileSync(SMOKE, 'utf8')
    expect(source.match(/\bclaims\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(source.match(/\basserted\(/g)?.length ?? 0).toBeGreaterThanOrEqual(8)
    expect(source.match(/\bunasserted\(/g)?.length ?? 0).toBeGreaterThanOrEqual(6)
    // The step's own claim list reaches `record`, or the headline counts nothing at all.
    // ⚑ …and since `420` the VERDICT does too, unflattened: five outcomes cannot travel as a
    // boolean, and a `NOT PERFORMED` folded into `'blank'` is the fourth cell's own defect again.
    expect(source).toMatch(/record\(verdict, name, detail, claimed\)/)
    expect(source).toMatch(/const verdict = typeof ok === 'string' \? ok : ok \? 'PASS' : 'FAIL'/)
  })

  it('⛔ the harness lines this test exempts are still THERE, and still only two', () => {
    // An exemption for a line that no longer exists is an exemption that quietly widens: the two
    // patterns would match nothing, and the test above would keep passing while the thing it
    // exempts had been replaced by something else entirely.
    const code = codeOf(SMOKE)
    for (const allowed of HARNESS) {
      expect(code.filter(({ line }) => allowed.test(line))).toHaveLength(1)
    }
  })
})
