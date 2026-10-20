import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ALLOWED, BASELINE, leakCheck, mentionsIn, patternsFrom } from '../leak-check.mjs'

/**
 * ⚑ **Launch item 1c · what the leak guard READS** — `scripts/leak-check.mjs`, the half
 * `leak-check.test.mjs` leaves open: which files, which lines, which spellings, and which pattern
 * lines.
 *
 * ⛔ **This file names no real pattern.** Every pattern here is made up, every repo is a scratch
 * `git init` under the system temp folder, and every call is handed its `env` and a scratch `home`,
 * so the person's own `~/.config/brobot/leak-patterns` is never read.
 *
 * ⚠️ Two cases pin what the guard does NOT see — a mention broken across two lines, and a mention
 * in a file's NAME. They are limits of a line-by-line `git grep` over contents, stated so a reader
 * knows the scrub (not the guard) owns them; if the guard ever grows a name check, the name case
 * flips and should be rewritten, not deleted.
 */

const MADE_UP = ['acme-widgets', 'zork-co']

const made = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A scratch directory this test owns, removed after it. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'brobot2-leak-reads-'))
  made.push(dir)
  return dir
}

/** Run git in a scratch repo, quietly. */
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })

/**
 * A git repo whose tracked files are `files`, whose guard files are `baseline` and `allowed`
 * (written untracked, as lists of lines), and whose `untracked` files are written and never added.
 */
function aRepo({ files = {}, baseline = [], allowed = [], untracked = {} } = {}) {
  const root = scratch()
  execFileSync('git', ['init', '-q', root])
  for (const [path, content] of Object.entries({ ...files, ...untracked })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  if (Object.keys(files).length > 0) git(root, 'add', '--', ...Object.keys(files))
  mkdirSync(join(root, 'scripts', 'leak-guard'), { recursive: true })
  writeFileSync(join(root, BASELINE), ['# header', ...baseline, ''].join('\n'))
  writeFileSync(join(root, ALLOWED), ['# header', ...allowed, ''].join('\n'))
  return root
}

/** The guard over a repo, with these patterns and a home that holds no config file. */
const check = (root, patterns = MADE_UP) =>
  leakCheck({ root, env: { BROBOT_LEAK_PATTERNS: patterns.join('\n') }, home: scratch() })

/** `mentionsIn` as plain pairs, so a comparison reads as the table it is. */
const found = (root, patterns = MADE_UP) => [...mentionsIn(root, patterns)]

describe('leak:check · any case, either way round', () => {
  it('a pattern written in capitals finds the text in lower case, and the reverse', () => {
    const root = aRepo({ files: { 'a.md': 'one\nby acme-widgets\n', 'b.md': 'AcMe-WiDgEtS\n' } })
    expect(found(root, ['ACME-WIDGETS'])).toEqual([
      ['a.md', [2]],
      ['b.md', [1]],
    ])
    expect(found(root, ['acme-widgets'])).toEqual([
      ['a.md', [2]],
      ['b.md', [1]],
    ])
  })

  it('…and it is still a fixed string: the same words spelled another way are not a mention', () => {
    const root = aRepo({ files: { 'a.md': 'acme widgets\nacme_widgets\nacmewidgets\n' } })
    expect(found(root)).toEqual([])
    expect(check(root).passed).toBe(true)
    writeFileSync(join(root, 'a.md'), 'acme widgets\nACME-widgets\n')
    expect(found(root)).toEqual([['a.md', [2]]])
  })
})

describe('leak:check · it counts LINES, one file at a time', () => {
  it('two patterns on one line, or one pattern twice, are one line against the baseline', () => {
    const root = aRepo({
      files: { 'docs/old.md': 'acme-widgets and zork-co and ACME-WIDGETS\nclean\n' },
      baseline: ['docs/old.md\t1'],
    })
    expect(found(root)).toEqual([['docs/old.md', [1]]])
    expect(check(root).passed).toBe(true)
    // ⚑ One fact over: the same words on a second line are a second line.
    writeFileSync(join(root, 'docs/old.md'), 'acme-widgets and zork-co\nzork-co\n')
    const grown = check(root)
    expect(grown.passed).toBe(false)
    expect(grown.text).toContain('  docs/old.md:1,2 (the baseline allows 1, it now has 2)')
  })

  it('⚠️ a mention broken across two lines is not seen — the scrub owns that, not the guard', () => {
    const root = aRepo({ files: { 'a.md': 'by acme-\nwidgets\n' } })
    expect(found(root)).toEqual([])
    expect(check(root).passed).toBe(true)
    writeFileSync(join(root, 'a.md'), 'by acme-widgets\n')
    expect(found(root)).toEqual([['a.md', [1]]])
    expect(check(root).passed).toBe(false)
  })

  it('⛔ it reads a file’s name as well as what it holds: a clean file named for a pattern fails', () => {
    const root = aRepo({ files: { 'notes/acme-widgets.md': 'nothing to see\n' } })
    expect(found(root)).toEqual([])
    const named = check(root)
    expect(named.passed).toBe(false)
    expect(named.text).toContain('their names carry a mention:\n  notes/….md')
    writeFileSync(join(root, 'notes/acme-widgets.md'), 'nothing to see\nzork-co\n')
    const { passed, text } = check(root)
    expect(passed).toBe(false)
    // …and a line it holds is named too, with the pattern hidden in the path.
    expect(text).toContain('  notes/….md:2')
  })

  it('a path with a space is read whole, and matched to its baseline line', () => {
    const root = aRepo({
      files: { 'my notes.md': 'clean\nacme-widgets\n' },
      baseline: ['my notes.md\t1'],
    })
    expect(found(root)).toEqual([['my notes.md', [2]]])
    expect(check(root).passed).toBe(true)
  })

  it.skipIf(process.platform === 'win32')(
    'a path with a colon is read whole, and matched to its baseline line',
    () => {
      const root = aRepo({
        files: { 'a:b.md': 'zork-co\n', 'my notes.md': 'clean\nacme-widgets\n' },
        baseline: ['a:b.md\t1', 'my notes.md\t1'],
      })
      expect(found(root)).toEqual([
        ['a:b.md', [1]],
        ['my notes.md', [2]],
      ])
      expect(check(root).passed).toBe(true)
    },
  ) // Windows cannot create a filename containing a colon; the space case above still runs.
})

describe('leak:check · tracked files, as they are in the working tree', () => {
  it('⛔ a tracked file is read as it is ON DISK: a mention not yet staged still fails', () => {
    const root = aRepo({ files: { 'src/a.ts': 'const a = 1\n' } })
    expect(check(root).passed).toBe(true)
    writeFileSync(join(root, 'src/a.ts'), "const a = 1\nconst who = 'zork-co'\n")
    expect(found(root)).toEqual([['src/a.ts', [2]]])
    const { passed, text } = check(root)
    expect(passed).toBe(false)
    expect(text).toContain('  src/a.ts:2')
  })

  it('a file taken out of the index is not read; the same file added back is', () => {
    const root = aRepo({ files: { 'kept.md': 'clean\n', 'draft.md': 'zork-co\n' } })
    expect(check(root).passed).toBe(false)
    git(root, 'rm', '-q', '--cached', '--', 'draft.md')
    expect(found(root)).toEqual([])
    expect(check(root).passed).toBe(true)
    git(root, 'add', '--', 'draft.md')
    expect(found(root)).toEqual([['draft.md', [1]]])
  })

  it('an ignored file is not read; the same file forced into the index is', () => {
    const root = aRepo({
      files: { '.gitignore': 'local/\n' },
      untracked: { 'local/notes.md': 'acme-widgets\n' },
    })
    expect(check(root).passed).toBe(true)
    git(root, 'add', '-f', '--', 'local/notes.md')
    expect(found(root)).toEqual([['local/notes.md', [1]]])
    expect(check(root).passed).toBe(false)
  })

  it('a binary listed in the baseline counts none, so its line has to go', () => {
    const root = aRepo({
      files: { 'logo.bin': Buffer.from('\u0000\u0001acme-widgets\u0000\n') },
      baseline: ['logo.bin\t1'],
    })
    expect(found(root)).toEqual([])
    const { passed, text } = check(root)
    expect(passed).toBe(false)
    expect(text).toContain('  logo.bin: 0 now, 1 listed')
  })
})

describe('leak:check · a pattern list is lines that say something', () => {
  it('# lines and blank lines are not patterns, wherever they sit and however indented', () => {
    const home = scratch()
    const env = {
      BROBOT_LEAK_PATTERNS: '# acme-widgets is not one\n\n   \n  zork-co  \n  # nor this\n',
    }
    expect(patternsFrom({ env, home })).toEqual({
      patterns: ['zork-co'],
      from: 'BROBOT_LEAK_PATTERNS',
    })
    // ⚑ So a file carrying the commented-out word passes, and one carrying the real one fails.
    const root = aRepo({ files: { 'a.md': 'acme-widgets\n' } })
    expect(leakCheck({ root, env, home })).toEqual({
      passed: true,
      text: 'leak guard: no mention in the tree (1 pattern from BROBOT_LEAK_PATTERNS)',
    })
    writeFileSync(join(root, 'a.md'), 'acme-widgets\nzork-co\n')
    const failed = leakCheck({ root, env, home })
    expect(failed.passed).toBe(false)
    expect(failed.text).toContain('  a.md:2')
  })

  it('a pattern file saved with Windows line endings reads the same patterns', () => {
    const home = scratch()
    const named = join(scratch(), 'patterns')
    writeFileSync(named, '# made-up\r\n\r\nacme-widgets\r\nzork-co\r\n')
    expect(patternsFrom({ env: { BROBOT_LEAK_PATTERNS_FILE: named }, home })).toEqual({
      patterns: ['acme-widgets', 'zork-co'],
      from: 'the file BROBOT_LEAK_PATTERNS_FILE names',
    })
    const root = aRepo({ files: { 'a.md': 'by zork-co\n' } })
    expect(found(root, ['acme-widgets', 'zork-co'])).toEqual([['a.md', [1]]])
  })

  it('the variable wins over a named file, even one that does not exist; a blank name is no name', () => {
    const home = scratch()
    const missing = join(scratch(), 'not-here')
    expect(
      patternsFrom({
        env: { BROBOT_LEAK_PATTERNS: 'zork-co', BROBOT_LEAK_PATTERNS_FILE: missing },
        home,
      }),
    ).toEqual({ patterns: ['zork-co'], from: 'BROBOT_LEAK_PATTERNS' })
    expect(() => patternsFrom({ env: { BROBOT_LEAK_PATTERNS_FILE: missing }, home })).toThrow(
      'does not exist',
    )
    // ⚑ A blank file name falls through to the config file, as an empty variable does.
    expect(patternsFrom({ env: { BROBOT_LEAK_PATTERNS_FILE: '   ' }, home })).toBeNull()
    mkdirSync(join(home, '.config', 'brobot'), { recursive: true })
    writeFileSync(join(home, '.config', 'brobot', 'leak-patterns'), 'acme-widgets\n')
    expect(patternsFrom({ env: { BROBOT_LEAK_PATTERNS_FILE: '   ' }, home })?.from).toBe(
      '~/.config/brobot/leak-patterns',
    )
  })

  it('⛔ a config file that is present and holds only comments is refused, not taken as none', () => {
    const home = scratch()
    mkdirSync(join(home, '.config', 'brobot'), { recursive: true })
    writeFileSync(join(home, '.config', 'brobot', 'leak-patterns'), '# to fill in\n\n')
    expect(() => patternsFrom({ env: {}, home })).toThrow(
      '~/.config/brobot/leak-patterns holds no pattern',
    )
    const root = aRepo({ files: { 'a.md': 'clean\n' } })
    expect(() => leakCheck({ root, env: {}, home })).toThrow('holds no pattern')
    // ⚑ One fact over: with no config file at all, the same tree is skipped and passes.
    expect(leakCheck({ root, env: {}, home: scratch() }).passed).toBe(true)
  })
})
