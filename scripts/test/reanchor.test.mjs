import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * ⚑ **716 · `reanchor.py` — an anchor corrected where it stands, on planted tables** in all three
 * row shapes `table_contract` reads: `(label, [edits])`, `(label, project, [edits])` and
 * `(label, file, old, new)`. ⚑ Each correction is read back through the contract's own loader, and
 * every OTHER row must load exactly as it did. ⛔ Then the refusals, and each must leave EVERY
 * table's bytes as they were: a shared constant, an expression, an anchor that matches twice or not
 * at all, a row or an edit that does not exist, a replacement that equals its anchor — and a batch
 * with one bad spec, which writes nothing in any table.
 *
 * ⚠️ The planted tree is a throwaway directory; the tool is run with `--root` on it, and nothing here
 * writes inside the repository.
 */

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const TOOL = join(repo, 'scripts/mutations/reanchor.py')
const LIB = join(repo, 'scripts/mutations/lib')

// ⚑ The live file every row names. `// dup` twice is an anchor that cannot be placed.
const SUBJECT = [
  'export const answer = () => 42',
  'export const other = () => "x"',
  'export const third = () => 3',
  '// dup',
  '// dup',
  '',
].join('\n')

// ⚠️ M6's line carries an em dash BEFORE its anchor literal: `ast` columns are UTF-8 bytes, and a
// character offset would splice two bytes to the right of the literal.
const SHAPE_TWO = [
  '"""plant · (label, [edits])"""',
  'F = "app/subject.ts"',
  'SHARED = "export const other"',
  'OWN = "export const answer = () => 41"',
  'MUTATIONS = [',
  '    ("M1 · a literal anchor — killed by `x.test.mjs`", [(F, "export const answer = () => 41", "export const answer = () => 0")]),',
  '    ("M2 · a name only this row reads", [(F, OWN, "export const answer = () => 1")]),',
  '    ("M3 · a shared name", [(F, SHARED, "export const other2")]),',
  '    ("M4 · the shared name again", [(F, SHARED, "export const other3")]),',
  '    ("M5 · an expression", [(F, "export const " + "gone", "zzz")]),',
  '    ("M6 · — an em dash — before the anchor", [(F, "gone text", "zzz")]),',
  ']',
  '',
].join('\n')

const SHAPE_THREE = [
  '"""plant · (label, project, [edits])"""',
  'MUTATIONS = [',
  '    (',
  '        "M1 · two edits, the second corrected",',
  '        "desktop",',
  '        [',
  '            ("app/subject.ts", "export const third", "export const fourth"),',
  '            ("app/subject.ts", "gone", "zzz"),',
  '        ],',
  '    ),',
  ']',
  '',
].join('\n')

const SHAPE_FOUR = [
  '"""plant · (label, file, old, new)"""',
  'MUTATIONS = [',
  '    ("M1 · one edit, in the row itself", "app/subject.ts", "gone", "zzz"),',
  ']',
  '',
].join('\n')

// ⚠️ A literal written over TWO lines above another corrected row: the splice makes it one line, and
// the note for the row below must still land above that row (review of `716`).
const SHAPE_MULTILINE = [
  '"""plant · a two-line literal above another row"""',
  'MUTATIONS = [',
  '    ("M1 · over two lines", [("app/subject.ts", "gone "',
  '                                               "text", "zzz")]),',
  '    ("M2 · the row below it", [("app/subject.ts", "gone too", "zzz")]),',
  ']',
  '',
].join('\n')

// ⚠️ Two edits on ONE file: the contract applies them in order, so a second anchor the first edit
// removes does not apply — though it matches once in the untouched file.
const SHAPE_TWO_EDITS = [
  '"""plant · two edits, one file"""',
  'MUTATIONS = [',
  '    ("M1 · two edits", [("app/subject.ts", "export const answer = () => 42", "export const answer = () => 7"), ("app/subject.ts", "gone", "zzz")]),',
  ']',
  '',
].join('\n')

// ⚠️ Two edits on ONE line, both corrected, each with its note: a note inserted at the line's start
// between the two splices moved the left literal (round two of `716`'s review).
const SHAPE_ONE_LINE = [
  '"""plant · two edits on one line"""',
  'MUTATIONS = [',
  '    ("M1 · two edits on one line", [("app/subject.ts", "gone", "zzz"), ("app/subject.ts", "gone too", "zzz")]),',
  ']',
  '',
].join('\n')

let root
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'reanchor-plant-'))
  const write = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  write('app/subject.ts', SUBJECT)
  write('scripts/mutations/900/mutations.py', SHAPE_TWO)
  write('scripts/mutations/901/mutations.py', SHAPE_THREE)
  write('scripts/mutations/902/mutations.py', SHAPE_FOUR)
  write('scripts/mutations/903/mutations.py', SHAPE_MULTILINE)
  write('scripts/mutations/904/mutations.py', SHAPE_TWO_EDITS)
  write('scripts/mutations/905/mutations.py', SHAPE_ONE_LINE)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const table = (id) => readFileSync(join(root, `scripts/mutations/${id}/mutations.py`), 'utf8')
const tables = () => ['900', '901', '902', '903', '904', '905'].map(table)

const reanchor = (specs, ...flags) => {
  const path = join(root, 'specs.json')
  writeFileSync(path, JSON.stringify(specs))
  const result = spawnSync('python3', [TOOL, path, '--by', '716', '--root', root, ...flags], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 60_000,
  })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

/** Every row of a table as the contract's own loader reads it: `{ M1: [[file, old, new], …] }`. */
const loaded = (id) => {
  const script = [
    'import json, pathlib, sys',
    `sys.path.insert(0, ${JSON.stringify(LIB)})`,
    'import table_contract as tc',
    `rows = tc.load(pathlib.Path(${JSON.stringify(join(root, `scripts/mutations/${id}/mutations.py`))}))`,
    'print(json.dumps({tc.row_id(r[0]): [list(e) for e in tc.edits_of(r)] for r in rows}))',
  ].join('\n')
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

const NOTE = '⚑ **716 · re-anchored in place, not retired** —'
// The mutation tooling opens files race-safely with POSIX-only flags; mutation runs are Linux-only.
const itOnPosix = process.platform === 'win32' ? it.skip : it

// ⚠️ Each arm runs Python several times; a loaded machine takes seconds per run.
describe(
  '716 · reanchor.py — an anchor corrected in place, in every row shape',
  { timeout: 120_000 },
  () => {
    itOnPosix(
      '🔴 corrects a literal in each of the three shapes, notes it above, and moves no other row',
      () => {
        const before = { 900: loaded('900'), 901: loaded('901'), 902: loaded('902') }
        const { status, out } = reanchor([
          {
            table: '900',
            row: 'M1',
            anchor: 'export const answer = () => 42',
            note: 'the answer moved',
          },
          {
            table: '900',
            row: 'M6',
            anchor: 'export const third = () => 3',
            note: 'after an em dash',
          },
          { table: '901', row: 'M1', edit: 1, anchor: '// dup\n// dup', note: 'the second edit' },
          { table: '902', row: 'M1', anchor: 'export const other = () => "x"', note: 'shape four' },
        ])
        expect(status, out).toBe(0)
        expect(out).toContain('CORRECTED · 4 anchors in 3 tables')

        const two = loaded('900')
        expect(two.M1).toEqual([
          ['app/subject.ts', 'export const answer = () => 42', 'export const answer = () => 0'],
        ])
        expect(two.M6).toEqual([['app/subject.ts', 'export const third = () => 3', 'zzz']])
        // ⛔ Every row nobody asked about loads exactly as it did.
        for (const rid of ['M2', 'M3', 'M4', 'M5']) expect(two[rid]).toEqual(before[900][rid])

        const three = loaded('901')
        expect(three.M1[0]).toEqual(before[901].M1[0])
        expect(three.M1[1]).toEqual(['app/subject.ts', '// dup\n// dup', 'zzz'])
        expect(loaded('902').M1).toEqual([
          ['app/subject.ts', 'export const other = () => "x"', 'zzz'],
        ])

        // ⚑ The note sits on the line above the literal it explains, at that line's indent.
        const lines = table('900').split('\n')
        const m6 = lines.findIndex((line) => line.includes('an em dash — before the anchor'))
        expect(lines[m6 - 1]).toBe(`    # ${NOTE} after an em dash`)
        expect(table('901')).toContain(
          `            # ${NOTE} the second edit\n            ("app/subject.ts", "// dup\\n// dup", "zzz"),`,
        )
        expect(table('902')).toContain(`    # ${NOTE} shape four\n`)
      },
    )

    itOnPosix(
      '🔴 corrects a name only its own row reads AT ITS BINDING, and a replacement when one is given',
      () => {
        const { status, out } = reanchor([
          {
            table: '900',
            row: 'M2',
            anchor: 'export const answer = () => 42',
            note: 'its own constant',
          },
          {
            table: '902',
            row: 'M1',
            anchor: 'export const third = () => 3',
            replacement: 'export const third = () => 4',
            note: 'and its replacement',
          },
        ])
        expect(status, out).toBe(0)
        expect(table('900')).toContain(
          `# ${NOTE} its own constant\nOWN = "export const answer = () => 42"`,
        )
        expect(loaded('900').M2).toEqual([
          ['app/subject.ts', 'export const answer = () => 42', 'export const answer = () => 1'],
        ])
        expect(loaded('902').M1).toEqual([
          ['app/subject.ts', 'export const third = () => 3', 'export const third = () => 4'],
        ])
      },
    )

    itOnPosix(
      '🔴 corrects a SHARED constant once, for every row that reads it — when each is listed',
      () => {
        const { status, out } = reanchor([
          {
            table: '900',
            row: 'M3',
            anchor: 'export const third',
            note: 'both moved',
            shared: true,
          },
          {
            table: '900',
            row: 'M4',
            anchor: 'export const third',
            note: 'both moved',
            shared: true,
          },
        ])
        expect(status, out).toBe(0)
        const two = loaded('900')
        expect(two.M3).toEqual([['app/subject.ts', 'export const third', 'export const other2']])
        expect(two.M4).toEqual([['app/subject.ts', 'export const third', 'export const other3']])
        // ⚑ one binding rewritten, one note above it
        expect(table('900')).toContain(`# ${NOTE} both moved\nSHARED = "export const third"`)
        expect(table('900').split(NOTE)).toHaveLength(2)
      },
    )

    itOnPosix(
      '🔴 a note lands above ITS row, though a literal above it shrank from two lines to one',
      () => {
        const { status, out } = reanchor([
          { table: '903', row: 'M1', anchor: 'export const answer = () => 42', note: 'first' },
          { table: '903', row: 'M2', anchor: 'export const third = () => 3', note: 'second' },
        ])
        expect(status, out).toBe(0)
        const lines = table('903').split('\n')
        const m1 = lines.findIndex((line) => line.includes('M1 · over two lines'))
        const m2 = lines.findIndex((line) => line.includes('M2 · the row below it'))
        expect(lines[m1 - 1]).toBe(`    # ${NOTE} first`)
        expect(lines[m2 - 1]).toBe(`    # ${NOTE} second`)
        expect(loaded('903').M2).toEqual([
          ['app/subject.ts', 'export const third = () => 3', 'zzz'],
        ])
      },
    )

    itOnPosix('🔴 two literals on one line are both corrected, each note above the line', () => {
      const { status, out } = reanchor([
        {
          table: '905',
          row: 'M1',
          edit: 0,
          anchor: 'export const answer = () => 42',
          note: 'left',
        },
        { table: '905', row: 'M1', edit: 1, anchor: 'export const third = () => 3', note: 'right' },
      ])
      expect(status, out).toBe(0)
      expect(loaded('905').M1).toEqual([
        ['app/subject.ts', 'export const answer = () => 42', 'zzz'],
        ['app/subject.ts', 'export const third = () => 3', 'zzz'],
      ])
      const lines = table('905').split('\n')
      const row = lines.findIndex((line) => line.includes('M1 · two edits on one line'))
      expect(lines.slice(row - 2, row).sort()).toEqual([
        `    # ${NOTE} left`,
        `    # ${NOTE} right`,
      ])
    })

    it('⛔ refuses a shared constant whose readers are all listed but not marked "shared"', () => {
      const before = tables()
      const { status, out } = reanchor([
        { table: '900', row: 'M3', anchor: 'export const third', note: 'x' },
        { table: '900', row: 'M4', anchor: 'export const third', note: 'x' },
      ])
      expect(status, out).toBe(2)
      expect(out).toContain('"shared": true')
      expect(tables()).toEqual(before)
    })

    itOnPosix(
      '⛔ a row whose corrected edit does not apply AFTER its first one is written back — exit 3',
      () => {
        const before = tables()
        const { status, out } = reanchor([
          { table: '902', row: 'M1', anchor: 'export const third = () => 3', note: 'fine alone' },
          { table: '904', row: 'M1', edit: 1, anchor: 'export const answer = () => 42', note: 'x' },
        ])
        expect(status, out).toBe(3)
        expect(out).toContain('M1 does not apply')
        // ⚑ all or nothing: the table that read back fine is put back too
        expect(tables()).toEqual(before)
      },
    )

    it('⛔ refuses a shared constant corrected for only one of its readers, or to two texts', () => {
      const before = tables()
      const one = reanchor([
        { table: '900', row: 'M3', anchor: 'export const third', note: 'x', shared: true },
      ])
      expect(one.status, one.out).toBe(2)
      expect(one.out).toContain('SHARED is read in 2 places and 1 specs correct it')
      const two = reanchor([
        { table: '900', row: 'M3', anchor: 'export const third', note: 'x', shared: true },
        {
          table: '900',
          row: 'M4',
          anchor: 'export const answer = () => 42',
          note: 'x',
          shared: true,
        },
      ])
      expect(two.status, two.out).toBe(2)
      expect(two.out).toContain('the specs correct the shared SHARED to different text')
      expect(tables()).toEqual(before)
    })

    it('🔴 --dry-run plans and writes nothing', () => {
      const before = tables()
      const { status, out } = reanchor(
        [{ table: '902', row: 'M1', anchor: 'export const third = () => 3', note: 'planned only' }],
        '--dry-run',
      )
      expect(status, out).toBe(0)
      expect(out).toContain('DRY RUN · 1 anchors in 1 tables')
      expect(tables()).toEqual(before)
    })

    const REFUSALS = [
      [
        'a name another row reads',
        { table: '900', row: 'M3', anchor: 'export const third', note: 'x' },
        'SHARED, which 2 places',
      ],
      [
        'an expression',
        { table: '900', row: 'M5', anchor: 'export const third', note: 'x' },
        'BinOp expression',
      ],
      [
        'an anchor that matches twice',
        { table: '902', row: 'M1', anchor: '// dup', note: 'x' },
        'matches 2 times',
      ],
      [
        'an anchor that matches nothing',
        { table: '902', row: 'M1', anchor: 'not in the file', note: 'x' },
        'matches 0 times',
      ],
      [
        'a row that does not exist',
        { table: '900', row: 'M9', anchor: 'export const third', note: 'x' },
        '0 rows have that id',
      ],
      [
        'an edit that does not exist',
        { table: '901', row: 'M1', edit: 2, anchor: 'export const third', note: 'x' },
        'there is no edit 2',
      ],
      [
        'edit 1 of a one-edit row',
        { table: '902', row: 'M1', edit: 1, anchor: 'export const third', note: 'x' },
        'there is no edit 1',
      ],
      [
        'a replacement that is its anchor',
        {
          table: '902',
          row: 'M1',
          anchor: 'export const third',
          replacement: 'export const third',
          note: 'x',
        },
        'would change nothing',
      ],
      [
        'a spec with no note',
        { table: '902', row: 'M1', anchor: 'export const third' },
        'missing note',
      ],
    ]
    it.each(REFUSALS)('⛔ refuses %s, and writes nothing in any table', (_what, spec, why) => {
      const before = tables()
      const { status, out } = reanchor([spec])
      expect(status, out).toBe(2)
      expect(out).toContain('REFUSED · ')
      expect(out).toContain(why)
      expect(tables()).toEqual(before)
    })

    it('⛔ a batch with one bad spec writes nothing — not even the good spec’s table', () => {
      const before = tables()
      const { status, out } = reanchor([
        { table: '902', row: 'M1', anchor: 'export const third = () => 3', note: 'good' },
        { table: '900', row: 'M3', anchor: 'export const third', note: 'shared' },
      ])
      expect(status, out).toBe(2)
      expect(tables()).toEqual(before)
    })
  },
)
