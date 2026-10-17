import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ALLOWED, BASELINE, parseAllowed, parseBaseline } from '../leak-check.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8')

/**
 * ⚑ **Launch item 1c · where the leak guard runs, and what its two lists may hold** — asked of
 * this checkout WITHOUT patterns, so it runs on every machine and every fork.
 *
 * ⚠️ `gates-in-the-chain.test.ts` derives that every `*:check` is REACHED by `ci`; it does not
 * say where. ⚑ This holds `leak:check` second — after `engine:check` (which says the runtime is
 * wrong before anything runs on it) and ahead of `typecheck` and `test`, so a new mention fails a
 * commit in a second rather than after the suite. And it holds the CI workflow to the one secret,
 * handed to the one job that reads it.
 *
 * ⚑ The committed baseline is a ratchet the guard can only check where the patterns are; where
 * they are not, nothing would notice a line added to it. So its SHAPE is held here: every line a
 * tracked file, in the order `--shrink` writes, no file in both lists, and never more files than
 * the 71 it listed once launch item 8 moved the internal documents out (`5969e68a`).
 */

/** `pnpm run X && pnpm run Y …` as its steps. */
const stepsOf = (script) =>
  script.split('&&').map((part) => /^pnpm run ([\w:-]+)$/.exec(part.trim())?.[1] ?? part.trim())

/** ⚑ The guard runs second, and ahead of the two slow steps. */
const leakRunsSecond = (steps) =>
  steps[0] === 'engine:check' &&
  steps[1] === 'leak:check' &&
  steps.indexOf('leak:check') < steps.indexOf('typecheck') &&
  steps.indexOf('leak:check') < steps.indexOf('test')

const pkg = JSON.parse(read('package.json'))
const workflow = read('.github/workflows/ci.yml')

/** Every `secrets.<NAME>` the workflow reads. */
const secretsIn = (yaml) => [...yaml.matchAll(/\bsecrets\.(\w+)/g)].map((one) => one[1])

describe('leak:check · second in the chain', () => {
  it('⛔ `pnpm run ci` runs it right after engine:check, ahead of typecheck and test', () => {
    const steps = stepsOf(pkg.scripts.ci)
    expect(steps.slice(0, 3)).toEqual(['engine:check', 'leak:check', 'typecheck'])
    expect(leakRunsSecond(steps)).toBe(true)
    expect(pkg.scripts['leak:check']).toBe('node scripts/leak-check.mjs')
  })

  it('controls: a chain without it, with it last, or with it first are all caught', () => {
    const steps = stepsOf(pkg.scripts.ci)
    expect(leakRunsSecond(steps.filter((step) => step !== 'leak:check'))).toBe(false)
    expect(leakRunsSecond([...steps.filter((step) => step !== 'leak:check'), 'leak:check'])).toBe(
      false,
    )
    expect(leakRunsSecond(['leak:check', ...steps.filter((step) => step !== 'leak:check')])).toBe(
      false,
    )
  })

  it('⛔ CI runs it as its own job, and hands the one secret to that job alone', () => {
    const matrix = /check:\s*\[([^\]]*)\]/.exec(workflow)?.[1] ?? ''
    expect(matrix.split(',').map((one) => one.trim())).toContain('leak:check')
    expect(secretsIn(workflow)).toEqual(['BROBOT_LEAK_PATTERNS'])
    expect(workflow).toContain(
      "BROBOT_LEAK_PATTERNS: ${{ matrix.check == 'leak:check' && secrets.BROBOT_LEAK_PATTERNS || '' }}",
    )
    // ⚑ One fact over: the `secretsIn` reader does see a second secret when there is one.
    expect(secretsIn(`${workflow}\n  TOKEN: \${{ secrets.OTHER }}\n`)).toEqual([
      'BROBOT_LEAK_PATTERNS',
      'OTHER',
    ])
  })
})

describe('leak:check · the committed lists hold the tree', () => {
  const tracked = new Set(
    execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0'),
  )
  const baseline = parseBaseline(read(BASELINE))
  const allowed = parseAllowed(read(ALLOWED))

  it('both lists are tracked, and read without a line refused', () => {
    expect(tracked.has(BASELINE)).toBe(true)
    expect(tracked.has(ALLOWED)).toBe(true)
    // ⚑ Launch item 4's scrub emptied it, so the guard is absolute: a mention in any file fails.
    expect(baseline.size).toBe(0)
  })

  it('⛔ every baseline line names a tracked file and a count of at least one', () => {
    const notTracked = (paths) => paths.filter((path) => !tracked.has(path))
    expect(
      notTracked([...baseline.keys()]),
      'a renamed or removed file keeps its line: move or drop it',
    ).toEqual([])
    expect([...baseline.values()].every((count) => count >= 1)).toBe(true)
    // ⚑ One fact over: a line for a document moved out of the tree is caught.
    expect(notTracked([...baseline.keys(), 'docs/HO-000-moved-out.md'])).toEqual([
      'docs/HO-000-moved-out.md',
    ])
  })

  it('⚑ it is in the order --shrink writes, so a hand edit and a shrink do not fight', () => {
    const paths = [...baseline.keys()]
    const sorted = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    expect(paths).toEqual(sorted)
  })

  it('⛔ it only shrinks: never more files than it listed at launch item 8, and none also allowed', () => {
    expect(baseline.size).toBeLessThanOrEqual(71)
    expect([...allowed.keys()].filter((path) => baseline.has(path))).toEqual([])
    expect([...allowed.keys()].filter((path) => !tracked.has(path))).toEqual([])
  })
})
