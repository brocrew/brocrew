import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ALLOWED,
  BASELINE,
  REQUIRED,
  SKIPPED,
  commitCheck,
  leakCheck,
  parseBaseline,
  mentionsIn,
  patternsFrom,
  shown,
  shrinkTheBaseline,
} from '../leak-check.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 🔴 **Launch item 1c · the leak guard** — `scripts/leak-check.mjs`.
 *
 * ⛔ **This file names no real pattern**: the guard's patterns are never in the tree. Its fixtures use
 * made-up ones, and the two checks on the real tree run only where the real ones are configured
 * (`BROBOT_LEAK_PATTERNS`, the file `BROBOT_LEAK_PATTERNS_FILE` names, or the config file) — on a
 * checkout without them they are skipped, as the guard itself is.
 */

const MADE_UP = ['acme-widgets', '/Users/someone', 'Someone-MBP']

const made = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A scratch directory this test owns, removed after it. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'brobot2-leak-guard-'))
  made.push(dir)
  return dir
}

/**
 * A git repo whose tracked files are `files`, and whose guard files are `baseline` and `allowed`
 * (written untracked, as lists of lines). `untracked` files are written and never added.
 */
function aRepo({ files = {}, baseline = [], allowed = [], untracked = {} } = {}) {
  const root = scratch()
  execFileSync('git', ['init', '-q', root])
  for (const [path, content] of Object.entries({ ...files, ...untracked })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  if (Object.keys(files).length > 0) {
    execFileSync('git', ['-C', root, 'add', '--', ...Object.keys(files)])
  }
  mkdirSync(join(root, 'scripts', 'leak-guard'), { recursive: true })
  writeFileSync(join(root, BASELINE), ['# header', ...baseline, ''].join('\n'))
  writeFileSync(join(root, ALLOWED), ['# header', ...allowed, ''].join('\n'))
  return root
}

/** The guard over a repo, with these patterns and a home that holds no config file. */
const check = (root, patterns = MADE_UP) =>
  leakCheck({ root, env: { BROBOT_LEAK_PATTERNS: patterns.join('\n') }, home: scratch() })

describe('leak:check · the guard over a repo', () => {
  it('passes a tree that carries no mention, and with no patterns configured says it skipped', () => {
    const root = aRepo({ files: { 'src/a.ts': 'const a = 1\n' } })
    expect(check(root)).toEqual({
      passed: true,
      text: 'leak guard: no mention in the tree (3 patterns from BROBOT_LEAK_PATTERNS)',
    })
    expect(leakCheck({ root, env: {}, home: scratch() })).toEqual({ passed: true, text: SKIPPED })
    expect(SKIPPED).toBe('leak guard skipped: no patterns configured')
  })

  it('⛔ fails on a fixture that adds a mention, in any case, naming file and line — never the text', () => {
    const root = aRepo({
      files: {
        'src/a.ts': 'const a = 1\n',
        'test/fixture.ts': "const where = 'ok'\nconst who = 'ACME-Widgets team'\n",
      },
    })
    const { passed, text } = check(root)
    expect(passed).toBe(false)
    expect(text).toContain('  test/fixture.ts:2')
    expect(text.toLowerCase()).not.toContain('acme')
    expect(text).toContain(ALLOWED)
  })

  it('⛔ fails when a baselined file carries more than its count, and passes at its count', () => {
    const files = { 'docs/old.md': 'line\nby acme-widgets\n' }
    const root = aRepo({ files, baseline: ['docs/old.md\t1'] })
    expect(check(root)).toEqual({
      passed: true,
      text: `leak guard: no new mention (3 patterns from BROBOT_LEAK_PATTERNS; 1 file still listed in ${BASELINE})`,
    })
    writeFileSync(join(root, 'docs/old.md'), 'line\nby acme-widgets\nand /Users/someone/x\n')
    const grown = check(root)
    expect(grown.passed).toBe(false)
    expect(grown.text).toContain('  docs/old.md:2,3 (the baseline allows 1, it now has 2)')
  })

  it('⚑ a file carrying fewer than its count fails until the baseline is lowered, and --shrink only lowers', () => {
    const root = aRepo({
      files: {
        'a.md': 'acme-widgets\n',
        'b.md': 'clean now\n',
        'c.md': 'acme-widgets\nacme-widgets\n',
      },
      baseline: ['a.md\t1', 'b.md\t2', 'c.md\t3'],
    })
    const before = check(root)
    expect(before.passed).toBe(false)
    expect(before.text).toContain('--shrink')
    expect(before.text).toContain('  b.md: 0 now, 2 listed')
    expect(before.text).toContain('  c.md: 2 now, 3 listed')
    const env = { BROBOT_LEAK_PATTERNS: MADE_UP.join('\n') }
    shrinkTheBaseline({ root, env, home: scratch() })
    const text = readFileSync(join(root, BASELINE), 'utf8')
    expect(text.startsWith('# header\n')).toBe(true)
    expect([...parseBaseline(text)]).toEqual([
      ['a.md', 1],
      ['c.md', 2],
    ])
    expect(check(root).passed).toBe(true)
    // ⛔ Never raised, and no file added: a new mention still fails after a shrink.
    writeFileSync(join(root, 'a.md'), 'acme-widgets\nacme-widgets\n')
    shrinkTheBaseline({ root, env, home: scratch() })
    expect(parseBaseline(readFileSync(join(root, BASELINE), 'utf8')).get('a.md')).toBe(1)
    expect(check(root).passed).toBe(false)
  })

  it('an allowed file passes whatever it carries; an exception that excuses nothing fails', () => {
    const root = aRepo({
      files: { 'NOTICE.md': 'acme-widgets\nacme-widgets\n', 'b.md': 'clean\n' },
      allowed: ['NOTICE.md\tthe one deliberate mention', 'b.md\tit used to carry one'],
    })
    const { passed, text } = check(root)
    expect(passed).toBe(false)
    expect(text).not.toContain('NOTICE.md')
    expect(text).toContain(`remove these lines from ${ALLOWED}`)
    expect(text).toContain('  b.md')
  })

  it('reads tracked text files only: a binary and an untracked file are not read', () => {
    const root = aRepo({
      files: { 'logo.bin': Buffer.from('\u0000\u0001acme-widgets\u0000') },
      untracked: { 'notes.txt': 'acme-widgets\n' },
    })
    expect(check(root).passed).toBe(true)
  })

  it('prints a path that carries a pattern without it, a longer pattern hidden whole', () => {
    const root = aRepo({ files: { 'acme-widgets-notes.md': 'by acme-widgets\n' } })
    const { text } = check(root)
    expect(text).toContain('  …-notes.md:1')
    expect(text.toLowerCase()).not.toContain('acme')
    expect(shown('docs/ACME-widgets.example.md', ['acme', 'acme-widgets.example'])).toBe(
      'docs/….md',
    )
    expect(shown('a/acme/b/Acme', ['acme'])).toBe('a/…/b/…')
  })

  it('takes each pattern as fixed text: one that starts with a dash, and one with a dot in it', () => {
    const root = aRepo({ files: { 'a.md': '--secret-flag\nfooXbar\nfoo.bar\n' } })
    expect([...mentionsIn(root, ['--secret-flag', 'foo.bar'])]).toEqual([['a.md', [1, 3]]])
  })

  it('⛔ a git failure is told without the patterns', () => {
    const missing = join(scratch(), 'not-a-repo-here')
    let said = ''
    try {
      mentionsIn(missing, ['acme-widgets'])
    } catch (error) {
      said = String(error)
    }
    expect(said).toContain('git grep failed (exit 128)')
    expect(said.toLowerCase().includes('acme')).toBe(false)
  })
})

describe('leak:check · file names, and a run that requires the patterns', () => {
  it('⛔ fails on a tracked file whose NAME carries a mention, printed with it hidden', () => {
    const root = aRepo({
      files: { 'src/a.ts': 'const a = 1\n', 'docs/acme-widgets-notes.md': 'nothing here\n' },
      untracked: { 'notes/Acme-Widgets-draft.md': 'nothing here\n' },
    })
    const { passed, text } = check(root)
    expect(passed).toBe(false)
    expect(text).toContain('leak guard: rename these files — their names carry a mention:')
    expect(text).toContain('  docs/…-notes.md')
    expect(text.toLowerCase()).not.toContain('acme')
    // ⚑ An untracked file is not the repo's.
    expect(text).not.toContain('draft')
  })

  it('⛔ with --require-patterns, no pattern configured fails instead of skipping', () => {
    const root = aRepo({ files: { 'src/a.ts': 'const a = 1\n' } })
    expect(leakCheck({ root, env: {}, home: scratch(), required: true })).toEqual({
      passed: false,
      text: REQUIRED,
    })
    expect(leakCheck({ root, env: {}, home: scratch() })).toEqual({ passed: true, text: SKIPPED })
    const commits = commitCheck(['HEAD'], { root, env: {}, home: scratch(), required: true })
    expect(commits.passed).toBe(false)
    expect(commits.text).toContain('requires the leak patterns (BROBOT_LEAK_PATTERNS)')
  })
})

describe('leak:check · where the patterns come from', () => {
  it('the variable, then the file it names, then the config file; none is none', () => {
    const home = scratch()
    const named = join(scratch(), 'patterns')
    writeFileSync(named, '# made-up\n\nacme-widgets\n  Someone-MBP  \n')
    expect(patternsFrom({ env: { BROBOT_LEAK_PATTERNS: 'a\nb\n' }, home })).toEqual({
      patterns: ['a', 'b'],
      from: 'BROBOT_LEAK_PATTERNS',
    })
    expect(patternsFrom({ env: { BROBOT_LEAK_PATTERNS_FILE: named }, home })?.patterns).toEqual([
      'acme-widgets',
      'Someone-MBP',
    ])
    expect(patternsFrom({ env: {}, home })).toBeNull()
    mkdirSync(join(home, '.config', 'brobot'), { recursive: true })
    writeFileSync(join(home, '.config', 'brobot', 'leak-patterns'), 'acme-widgets\n')
    expect(patternsFrom({ env: {}, home })).toEqual({
      patterns: ['acme-widgets'],
      from: '~/.config/brobot/leak-patterns',
    })
  })

  it('⚑ an empty variable is none (a fork’s CI hands a missing secret as ""); an empty file is refused', () => {
    const home = scratch()
    expect(patternsFrom({ env: { BROBOT_LEAK_PATTERNS: '' }, home })).toBeNull()
    expect(patternsFrom({ env: { BROBOT_LEAK_PATTERNS: '  \n' }, home })).toBeNull()
    const empty = join(scratch(), 'patterns')
    writeFileSync(empty, '# nothing yet\n')
    expect(() => patternsFrom({ env: { BROBOT_LEAK_PATTERNS_FILE: empty }, home })).toThrow(
      'holds no pattern',
    )
    expect(() =>
      patternsFrom({ env: { BROBOT_LEAK_PATTERNS_FILE: join(home, 'missing') }, home }),
    ).toThrow('does not exist')
  })
})

/**
 * ⚑ **The two acceptance checks, with the real patterns** — only where they are configured: today's
 * tree passes against the committed baseline, and a fixture that adds one fails.
 */
const configured = patternsFrom()

describe('leak:check · the real patterns, where they are configured', () => {
  it.skipIf(configured === null)('passes today’s tree against the committed baseline', () => {
    const { passed, text } = leakCheck({ root: ROOT })
    expect(text).not.toContain('leak guard: remove')
    expect(passed).toBe(true)
  })

  it.skipIf(configured === null)('⛔ fails on a fixture that adds a real pattern', () => {
    const patterns = configured?.patterns ?? []
    const root = aRepo({ files: { 'test/fixture.ts': `const where = '${patterns[0]}'\n` } })
    const { passed, text } = check(root, patterns)
    expect(passed).toBe(false)
    expect(text).toContain('  test/fixture.ts:1')
    // ⛔ Asserted as a boolean, so a failure here cannot print the pattern either.
    for (const pattern of patterns) {
      expect(text.toLowerCase().includes(pattern.toLowerCase())).toBe(false)
    }
  })
})
