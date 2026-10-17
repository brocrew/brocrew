import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ALLOWED,
  BASELINE,
  SKIPPED,
  leakCheck,
  parseAllowed,
  parseBaseline,
  shown,
  shrinkTheBaseline,
} from '../leak-check.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
/** ⚠️ Its real path: the command runs only when `argv[1]` IS the module, symlinks resolved. */
const COMMAND = realpathSync(join(ROOT, 'scripts', 'leak-check.mjs'))

/**
 * ⚑ **Launch item 1c · what the leak guard SAYS, and how its baseline moves** — the half of
 * `scripts/leak-check.mjs` that `leak-check.test.mjs` leaves open: every list it prints hides the
 * patterns (not only the "new mention" one), `--shrink` never adds a file, an allow-list line
 * that excuses nothing is named, the two list files refuse a line they cannot read, and the
 * command itself exits 0 when skipped and 1 when it fails.
 *
 * ⛔ **This file names no real pattern.** Patterns are made up, repos are scratch `git init`s, and
 * every call — and every command started — is handed its own environment and a scratch home. The
 * two commands started below run the guard over THIS checkout read-only: one with no pattern, one
 * whose only pattern is the guard's own "skipped" sentence, which its own source carries.
 */

const MADE_UP = ['acme-widgets', 'zork-co']

const made = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A scratch directory this test owns, removed after it. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'brobot2-leak-says-'))
  made.push(dir)
  return dir
}

/**
 * A git repo whose tracked files are `files`, and whose guard files are `baseline` and `allowed`
 * (written untracked; `baseline` raw, so a test can plant comments and order).
 */
function aRepo({ files = {}, baseline = ['# header'], allowed = [] } = {}) {
  const root = scratch()
  execFileSync('git', ['init', '-q', root])
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  if (Object.keys(files).length > 0) {
    execFileSync('git', ['-C', root, 'add', '--', ...Object.keys(files)])
  }
  mkdirSync(join(root, 'scripts', 'leak-guard'), { recursive: true })
  writeFileSync(join(root, BASELINE), [...baseline, ''].join('\n'))
  writeFileSync(join(root, ALLOWED), ['# header', ...allowed, ''].join('\n'))
  return root
}

const env = { BROBOT_LEAK_PATTERNS: MADE_UP.join('\n') }

/** The guard over a repo, with the made-up patterns and a home that holds no config file. */
const check = (root) => leakCheck({ root, env, home: scratch() })
const shrink = (root) => shrinkTheBaseline({ root, env, home: scratch() })
const baselineOf = (root) => readFileSync(join(root, BASELINE), 'utf8')

/** ⛔ Asserted as a boolean, so a failure cannot print the pattern either. */
const namesAPattern = (text) => MADE_UP.some((one) => text.toLowerCase().includes(one))

describe('leak:check · nothing it prints names a pattern or a matched line', () => {
  it('⛔ the "new mention" list prints the file and line numbers, never the rest of the line', () => {
    const root = aRepo({ files: { 'src/a.ts': "const secretHolder = 'zork-co' // why\n" } })
    const { passed, text } = check(root)
    expect(passed).toBe(false)
    expect(text).toContain('  src/a.ts:1')
    expect(text).not.toContain('secretHolder')
    expect(text).not.toContain('// why')
    expect(namesAPattern(text)).toBe(false)
  })

  it('⛔ the "lower the baseline" list hides a pattern in a path', () => {
    const root = aRepo({
      files: { 'docs/acme-widgets-old.md': 'acme-widgets\nclean\n' },
      baseline: ['# header', 'docs/acme-widgets-old.md\t2'],
    })
    const { passed, text } = check(root)
    expect(passed).toBe(false)
    expect(text).toContain('  docs/…-old.md: 1 now, 2 listed')
    expect(namesAPattern(text)).toBe(false)
  })

  it('⛔ the "remove from the allow-list" list hides a pattern in a path', () => {
    const root = aRepo({
      files: { 'zork-co-notice.md': 'clean now\n' },
      allowed: ['zork-co-notice.md\tit used to name them'],
    })
    const { passed, text } = check(root)
    expect(passed).toBe(false)
    expect(text).toContain(`remove these lines from ${ALLOWED}`)
    expect(text).toContain('  …-notice.md')
    expect(namesAPattern(text)).toBe(false)
  })

  it('a pass says how many patterns and from where, and nothing of them', () => {
    const root = aRepo({
      files: { 'old.md': 'acme-widgets\n' },
      baseline: ['# header', 'old.md\t1'],
    })
    const { passed, text } = check(root)
    expect(passed).toBe(true)
    expect(text).toBe(
      `leak guard: no new mention (2 patterns from BROBOT_LEAK_PATTERNS; 1 file still listed in ${BASELINE})`,
    )
    expect(namesAPattern(text)).toBe(false)
  })

  it('overlapping matches are hidden whole, and two side by side are one …', () => {
    expect(shown('x-aaa-y', ['aa'])).toBe('x-…-y')
    expect(shown('acme-widgetsacme-widgets/x', ['acme-widgets'])).toBe('…/x')
    expect(shown('a/b', ['zork-co'])).toBe('a/b')
  })

  it('⚠️ a text whose lower case changes its length is hidden entirely, not by guessed position', () => {
    // 'İ' lower-cases to two code units, so no index in the lower text is an index in the text.
    expect(shown('İstanbul/zork-co.md', ['zork-co'])).toBe('…')
    expect(shown('İstanbul/clean.md', ['zork-co'])).toBe('…')
    // …and one fact over: the same path without that letter is shown, the pattern hidden.
    expect(shown('Istanbul/zork-co.md', ['zork-co'])).toBe('Istanbul/….md')
  })
})

describe('leak:check · --shrink only lowers', () => {
  it('⛔ a file that carries a new mention is never added to the baseline, and still fails', () => {
    const root = aRepo({
      files: { 'old.md': 'acme-widgets\nacme-widgets\n', 'new.md': 'zork-co\n' },
      baseline: ['# header', 'old.md\t3'],
    })
    expect(shrink(root)).toBe(`leak guard: ${BASELINE} lowered to the tree; 1 file listed`)
    expect([...parseBaseline(baselineOf(root))]).toEqual([['old.md', 2]])
    const { passed, text } = check(root)
    expect(passed).toBe(false)
    expect(text).toContain('  new.md:1')
  })

  it('an empty baseline stays empty over a tree full of mentions', () => {
    const root = aRepo({ files: { 'a.md': 'zork-co\n', 'b.md': 'acme-widgets\n' } })
    expect(shrink(root)).toBe(`leak guard: ${BASELINE} lowered to the tree; 0 files listed`)
    expect(baselineOf(root)).toBe('# header\n')
    expect(check(root).passed).toBe(false)
  })

  it('it writes the comments first and the files in order, whatever order it found them in', () => {
    const root = aRepo({
      files: { 'b.md': 'zork-co\n', 'a.md': 'zork-co\n', 'c.md': 'clean\n' },
      baseline: ['# one', 'c.md\t1', 'b.md\t1', '# two', 'a.md\t1'],
    })
    shrink(root)
    expect(baselineOf(root)).toBe('# one\n# two\na.md\t1\nb.md\t1\n')
  })

  it('⛔ with no patterns it refuses, and the baseline is left exactly as it was', () => {
    const root = aRepo({
      files: { 'a.md': 'clean\n' },
      baseline: ['# header', 'a.md\t1'],
    })
    const before = baselineOf(root)
    expect(() => shrinkTheBaseline({ root, env: {}, home: scratch() })).toThrow(
      'no patterns configured',
    )
    expect(baselineOf(root)).toBe(before)
    // ⚑ One fact over: with patterns, the same call lowers it.
    shrink(root)
    expect(baselineOf(root)).toBe('# header\n')
  })
})

describe('leak:check · the allow-list', () => {
  it('⛔ an exception whose file is gone from the tree excuses nothing, and is named', () => {
    const root = aRepo({
      files: { 'kept.md': 'acme-widgets\n' },
      allowed: ['kept.md\tthe one deliberate mention', 'deleted.md\twas a notice'],
    })
    const { passed, text } = check(root)
    expect(passed).toBe(false)
    expect(text).toContain('  deleted.md')
    expect(text).not.toContain('kept.md')
  })

  it('an allowed file is held to no count: carrying fewer than its baseline line is not a failure', () => {
    const root = aRepo({
      files: { 'NOTICE.md': 'acme-widgets\n' },
      baseline: ['# header', 'NOTICE.md\t3'],
      allowed: ['NOTICE.md\tthe one deliberate mention'],
    })
    expect(check(root).passed).toBe(true)
  })

  it('⛔ a line with no reason is refused; a reason after several tabs is read', () => {
    expect(() => parseAllowed('NOTICE.md\n')).toThrow('each line is a path, a tab and the reason')
    expect(() => parseAllowed('NOTICE.md\t   \n')).toThrow('a path, a tab and the reason')
    expect([...parseAllowed('# c\nNOTICE.md\t\t the reason \n')]).toEqual([
      ['NOTICE.md', 'the reason'],
    ])
  })

  it('⛔ a baseline line it cannot read is refused, never guessed at', () => {
    expect(() => parseBaseline('a.md 2\n')).toThrow('a line this guard cannot read')
    expect(() => parseBaseline('a.md\t-1\n')).toThrow('a line this guard cannot read')
    expect(() => parseBaseline('a.md\ttwo\n')).toThrow('a line this guard cannot read')
    expect([...parseBaseline('# c\n\nmy notes.md\t2\n')]).toEqual([['my notes.md', 2]])
  })
})

describe('leak:check · the command', () => {
  /** The command over this checkout, with only these variables and a scratch home. */
  const command = (vars) => {
    const home = scratch()
    return spawnSync(process.execPath, [COMMAND], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home, ...vars },
    })
  }

  it('⚑ with no patterns configured it says it skipped, and exits 0', () => {
    const run = command({})
    expect(run.stdout).toBe(`${SKIPPED}\n`)
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    // ⚑ An empty variable — a fork's CI without the secret — is the same.
    const fork = command({ BROBOT_LEAK_PATTERNS: '' })
    expect(fork.stdout).toBe(`${SKIPPED}\n`)
    expect(fork.status).toBe(0)
  })

  it('⛔ a named pattern file that is not there fails, exit 1, on stderr', () => {
    const run = command({ BROBOT_LEAK_PATTERNS_FILE: join(scratch(), 'not-here') })
    expect(run.status).toBe(1)
    expect(run.stdout).toBe('')
    expect(run.stderr).toContain(
      'leak guard: BROBOT_LEAK_PATTERNS_FILE names a file that does not exist',
    )
  })

  it('⛔ a mention in the tree fails, exit 1, on stderr — naming the file and never the pattern', () => {
    // ⚑ The guard's own source carries its "skipped" sentence and no baseline lists it.
    const run = command({ BROBOT_LEAK_PATTERNS: SKIPPED })
    expect(run.status).toBe(1)
    expect(run.stdout).toBe('')
    // ⚠️ As booleans: this stderr also lists every baseline file, and a failure need not print it.
    expect(run.stderr.includes('  scripts/leak-check.mjs:')).toBe(true)
    expect(run.stderr.includes('no patterns configured')).toBe(false)
  })
})
