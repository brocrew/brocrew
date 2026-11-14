import './provider-boundaries.test.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  LINE_LIMIT,
  compareKeys,
  compareSizes,
  depcruiseKeys,
  cloneBaseArgument,
  cloneFindings,
  classifyCloneFindings,
  knipKeys,
} from './gate.mjs'

const clone = (isNew, line = 10) => ({
  format: 'typescript',
  isNew,
  firstFile: { name: 'a.ts', start: line, end: line + 10 },
  secondFile: { name: 'b.ts', start: line + 40, end: line + 50 },
})
const report = (duplicates, newClones = duplicates.filter((d) => d.isNew === true).length) => ({
  duplicates,
  statistics: { total: { clones: duplicates.length, newClones, sources: 2 } },
})

test('clones use explicit full source reference; no parent or moving ref default', () => {
  const sha = 'a'.repeat(40)
  assert.equal(cloneBaseArgument(['--clone-base', sha]), sha)
  for (const args of [
    [],
    ['--clone-base'],
    ['--clone-base', 'main'],
    ['--clone-base', 'a'.repeat(8)],
    ['--clone-base', sha, '--clone-base', sha],
  ])
    assert.throws(() => cloneBaseArgument(args))
})

test('native multiplicity preserves every new record inside a known pair', () => {
  assert.deepEqual(cloneFindings(report([clone(false)])), [])
  const two = cloneFindings(report([clone(false), clone(true), clone(true)]))
  assert.equal(two.length, 2)
  assert.match(two[0], /^record 1:/)
  assert.match(two[1], /^record 2:/)
  // No file-pair Set or fingerprint deduplication can erase the second record.
  assert.equal(cloneFindings(report([clone(true, 200)])).length, 1)
})

test('missing markers/counts, malformed endpoints and inconsistent reports are errors', () => {
  const bad = [
    { duplicates: [] },
    report([clone(undefined)]),
    report([clone('false')]),
    report([clone(true)], 0),
    report([clone(false)], 1),
    report([], -1),
    { ...report([]), statistics: { total: { clones: 1, newClones: 0, sources: 2 } } },
    { ...report([]), statistics: { total: { clones: 0, newClones: 0, sources: 0 } } },
    report([{ ...clone(true), firstFile: { name: 'a.ts', start: 0, end: 5 } }]),
  ]
  for (const value of bad) assert.throws(() => cloneFindings(value))
})

function statementCase(first, second = first, options = {}) {
  const names = options.names ?? ['a.ts', 'b.ts']
  const endpoint = (name, text, [start, end]) => {
    const location = (position) => {
      const prefix = text.slice(0, position)
      const lines = prefix.split('\n')
      return {
        position: Buffer.byteLength(prefix),
        line: lines.length,
        column: Buffer.byteLength(lines.at(-1)),
      }
    }
    const startLoc = location(start)
    const endLoc = location(end)
    return { name, start: startLoc.line, end: endLoc.line, startLoc, endLoc }
  }
  const value = report([
    {
      ...clone(options.isNew ?? true),
      firstFile: endpoint(names[0], first, options.firstSpan ?? [0, first.length]),
      secondFile: endpoint(names[1], second, options.secondSpan ?? [0, second.length]),
    },
  ])
  const readSource = (name) => (name === names[0] ? first : second)
  return { value, result: classifyCloneFindings(value, readSource), readSource }
}

test('both static import spans are visible non-logic matches without changing native data', () => {
  const imports = [
    "import value from './default'",
    "import * as names from './namespace';",
    "import type { Shape } from './types'",
    "import {\n  value as renamed,\n  type Other,\n} from './named'",
    "import './side-effect'",
    "import data from './data.json' with { type: 'json' }",
  ].join('\n')
  const { value, result, readSource } = statementCase(imports)
  const original = JSON.stringify(value)
  assert.equal(result.nativeFindings.length, 1)
  assert.deepEqual(result.importOnlyRecords, result.nativeFindings)
  assert.deepEqual(result.countedFindings, [])
  assert.equal(result.summary, '1 native NEW; 1 import-only; 0 counted NEW')
  assert.equal(result.classifications[0].kind, 'import-only')
  classifyCloneFindings(value, readSource)
  assert.equal(JSON.stringify(value), original)
  assert.throws(() => classifyCloneFindings({ ...value, statistics: {} }, readSource))
})

test('complete source identifies windows beginning or ending inside multiline imports', () => {
  const first = "import {\n  shared,\n  another,\n} from './fixture'\nimport { x } from './next'\n"
  const second =
    "import {\n  shared,\n  different,\n} from './fixture'\nimport { y } from './next'\n"
  const { result } = statementCase(first, second, {
    firstSpan: [first.indexOf('shared'), first.indexOf('another') + 4],
    secondSpan: [second.indexOf('shared'), second.indexOf('different') + 4],
  })
  assert.equal(result.importOnlyRecords.length, 1)
})

test('the first const token after imports keeps a mixed record counted on either endpoint', () => {
  const first =
    "import { x } from './same'\n\nconst here = dirname(fileURLToPath(import.meta.url))\n"
  const second = "import { x } from './same'\nimport { y } from './next'\n"
  for (const reverse of [false, true]) {
    const texts = reverse ? [second, first] : [first, second]
    const ends = reverse
      ? [second.indexOf('import', 1) + 6, first.indexOf('const') + 5]
      : [first.indexOf('const') + 5, second.indexOf('import', 1) + 6]
    const { result } = statementCase(...texts, {
      firstSpan: [0, ends[0]],
      secondSpan: [0, ends[1]],
    })
    assert.equal(result.countedFindings.length, 1)
    assert.equal(result.importOnlyRecords.length, 0)
  }
})

test('import headers cannot hide roster builders, mocks or copied executable bodies', () => {
  for (const body of [
    "const NOW = Date.now(); const roster = ['a', 'b'].map((name) => ({ name, NOW }));",
    "vi.mock('./module', () => ({ value: () => 1 }));",
    'export function copied(input) { return input.map((n) => n + 1); }',
  ]) {
    const { result } = statementCase("import { x } from './same'\n" + body)
    assert.equal(result.countedFindings.length, 1)
  }
})

test('comments alone are not import syntax, including inside multiline imports', () => {
  for (const comment of ['/* shared words */', '/** @type {Named} */', '// shared words']) {
    const text = `import {\n  ${comment}\n  value,\n} from './source'\n`
    const span = [text.indexOf(comment), text.indexOf(comment) + comment.length]
    const { result } = statementCase(text, text, { firstSpan: span, secondSpan: span })
    assert.equal(result.countedFindings.length, 1)
    assert.equal(result.importOnlyRecords.length, 0)
  }
  const text = "import { x } from './source'\n  \nconst value = 1\n"
  const span = [text.indexOf('\n') + 1, text.indexOf('const')]
  assert.equal(
    statementCase(text, text, { firstSpan: span, secondSpan: span }).result.countedFindings.length,
    1,
  )
})

test('UTF8 byte coordinates map to UTF16 syntax boundaries across Unicode and CRLF', () => {
  const text =
    "/* 🧭 café */\r\nimport {\r\n  /* é */ value,\r\n} from './é🧭'\r\nconst body = 1\r\n"
  const start = text.indexOf('import')
  const end = text.indexOf('const')
  assert.equal(
    statementCase(text, text, { firstSpan: [start, end], secondSpan: [start, end] }).result
      .importOnlyRecords.length,
    1,
  )
  assert.equal(
    statementCase(text, text, { firstSpan: [start, end + 1], secondSpan: [start, end] }).result
      .countedFindings.length,
    1,
  )
  const { value, readSource } = statementCase(text, text, {
    firstSpan: [start, end],
    secondSpan: [start, end],
  })
  const insideEmoji = Buffer.from(text).indexOf(Buffer.from('🧭')) + 3
  value.duplicates[0].firstFile.startLoc.position = insideEmoji
  value.duplicates[0].firstFile.startLoc.line = 1
  value.duplicates[0].firstFile.startLoc.column = insideEmoji
  value.duplicates[0].firstFile.start = 1
  assert.equal(classifyCloneFindings(value, readSource).countedFindings.length, 1)
})

test('dynamic imports, import.meta, require, exports and import-looking text remain counted', () => {
  for (const text of [
    "const value = import('./module')",
    'const value = import.meta.url',
    "const value = require('./module')",
    "import value = require('./module')",
    "export { value } from './module'",
    'const value = "import { fake } from \'./module\'"',
    "const value = `import { fake } from './module'`",
    "/* import { fake } from './module' */",
  ])
    assert.equal(statementCase(text).result.countedFindings.length, 1)
})

test('unsupported formats, parse errors and uncertain native coordinates are never excluded', () => {
  const text = "import { x } from './module'"
  const unsupported = statementCase(text, text, { names: ['a.vue', 'b.vue'] }).result
  assert.equal(unsupported.countedFindings.length, 1)
  assert.deepEqual(unsupported.classifications[0].endpoints, [
    'unsupported format',
    'unsupported format',
  ])
  assert.equal(statementCase("import { broken from './module'").result.countedFindings.length, 1)
  for (const mutation of [
    (file) => delete file.startLoc,
    (file) => file.endLoc.position++,
    (file) => file.startLoc.column++,
    (file) => (file.endLoc.position = file.startLoc.position),
  ]) {
    const { value, readSource } = statementCase(text)
    mutation(value.duplicates[0].firstFile)
    assert.equal(classifyCloneFindings(value, readSource).countedFindings.length, 1)
  }
})

test('classification conserves multiplicity and reports empty NEW without reading source', () => {
  const imports = statementCase("import { x } from './module'")
  const bodyText = 'export const body = () => 1'
  const body = statementCase(bodyText, bodyText, { names: ['c.ts', 'd.ts'] })
  const value = report([
    imports.value.duplicates[0],
    imports.value.duplicates[0],
    body.value.duplicates[0],
  ])
  let read = 0
  const result = classifyCloneFindings(value, (file) => {
    read++
    return file === 'a.ts' || file === 'b.ts' ? "import { x } from './module'" : bodyText
  })
  assert.equal(result.nativeFindings.length, 3)
  assert.equal(result.importOnlyRecords.length, 2)
  assert.equal(result.countedFindings.length, 1)
  assert.equal(result.summary, '3 native NEW; 2 import-only; 1 counted NEW')
  assert.equal(read, 4)
  const empty = statementCase("import { x } from './module'", undefined, { isNew: false }).value
  assert.deepEqual(
    classifyCloneFindings(empty, () => assert.fail('no NEW source read')).classifications,
    [],
  )
})

test('a cycle gives the same keys whichever module it is reported from', () => {
  const graph = ([first, second]) => ({
    summary: {
      violations: [
        { rule: { name: 'no-circular' }, from: first, to: second },
        { rule: { name: 'shared-not-to-app-layers' }, from: 's.ts', to: 'm.ts' },
      ],
    },
    modules: [first, second].map((source, i) => ({
      source,
      dependencies: [{ resolved: i ? first : second, circular: true }],
    })),
  })
  const keys = (order) => compareKeys([], depcruiseKeys(graph(order))).added
  assert.deepEqual(keys(['a.ts', 'b.ts']), [
    'no-circular|a.ts|b.ts',
    'no-circular|b.ts|a.ts',
    'shared-not-to-app-layers|s.ts|m.ts',
  ])
  assert.deepEqual(keys(['b.ts', 'a.ts']), keys(['a.ts', 'b.ts']))
})

test('knip findings are keyed by type, file and symbol, not by line', () => {
  const report = (line) => ({
    issues: [
      {
        file: 'src/x.ts',
        exports: [{ name: 'unused', line }],
        enumMembers: [{ name: 'B', namespace: 'Letters', line }],
        files: [],
      },
    ],
  })
  assert.deepEqual(knipKeys(report(3)), [
    'exports|src/x.ts|unused',
    'enumMembers|src/x.ts|Letters.B',
  ])
  assert.deepEqual(knipKeys(report(90)), knipKeys(report(3)))
})

test('knip object-valued member categories retain their enum or class namespace', () => {
  const report = (line) => ({
    issues: [
      {
        file: 'src/x.ts',
        exports: [{ name: 'unused', line }],
        enumMembers: { Letters: [{ name: 'B', line }], Numbers: [{ name: 'Two', line }] },
        classMembers: { Example: [{ name: 'unusedMethod', line }] },
      },
    ],
  })
  assert.deepEqual(knipKeys(report(3)), [
    'exports|src/x.ts|unused',
    'enumMembers|src/x.ts|Letters.B',
    'enumMembers|src/x.ts|Numbers.Two',
    'classMembers|src/x.ts|Example.unusedMethod',
  ])
  assert.deepEqual(knipKeys(report(90)), knipKeys(report(3)))
})

test('knip rejects malformed member categories instead of dropping their findings', () => {
  const shapes = [{ Example: { name: 'unused' } }, { Example: [], Broken: null }, null, 'unused', 1]
  for (const type of ['enumMembers', 'classMembers']) {
    for (const items of shapes) {
      assert.throws(() => knipKeys({ issues: [{ file: 'src/x.ts', [type]: items }] }), {
        message: `knip: unexpected ${type} issue shape in src/x.ts`,
      })
    }
  }
})

test('only identities missing from the baseline are new; vanished ones are resolved', () => {
  const result = compareKeys(['old', 'gone'], ['old', 'old', 'fresh'])
  assert.deepEqual(result, { added: ['fresh'], resolved: ['gone'] })
})

test('a listed giant may shrink but not grow, and no other file may pass the limit', () => {
  const baseline = { 'giant.ts': 5000 }
  assert.deepEqual(compareSizes(baseline, { 'giant.ts': 4990 }).added, [])
  assert.deepEqual(compareSizes(baseline, { 'giant.ts': 5001 }).added, [
    'max-lines|giant.ts|5001 lines, allowed 5000',
  ])
  assert.deepEqual(compareSizes(baseline, { 'giant.ts': 5000, 'new.ts': LINE_LIMIT + 1 }).added, [
    `max-lines|new.ts|${LINE_LIMIT + 1} lines, allowed ${LINE_LIMIT}`,
  ])
  assert.deepEqual(compareSizes(baseline, {}).resolved, ['max-lines|giant.ts'])
})

// These fixtures use the installed pinned native detector, never a second clone engine.
const here = path.dirname(fileURLToPath(import.meta.url))
const detector = path.join(here, 'node_modules', '.bin', 'jscpd')
const config = path.join(here, 'jscpd.json')
const block = (seed) =>
  [
    `export function calculate${seed}(input) {`,
    ...Array.from({ length: 24 }, (_, n) => `  const value${seed}_${n} = input + ${seed + n};`),
    `  return value${seed}_0 + value${seed}_23;`,
    '}',
    '',
  ].join('\n')

function nativeCase(change) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'code-health-native-'))
  const source = path.join(temporary, 'source')
  fs.mkdirSync(source)
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Gate fixture',
    GIT_AUTHOR_EMAIL: 'gate-fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Gate fixture',
    GIT_COMMITTER_EMAIL: 'gate-fixture@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
  }
  const git = (...args) => execFileSync('git', args, { cwd: source, env, encoding: 'utf8' }).trim()
  const write = (file, text) => fs.writeFileSync(path.join(source, file), text)
  const scan = (base, name) => {
    const output = path.join(temporary, name)
    const args = [
      source,
      '--absolute',
      '--config',
      config,
      '--output',
      output,
      '--reporters',
      'json,sarif',
      '--baseline-from-ref',
      base,
      '--fail-on-empty',
    ]
    const keep = Boolean(process.env.CODE_HEALTH_NATIVE_EVIDENCE)
    let stdout
    let stderr
    let outcome = { status: null, signal: null }
    try {
      if (keep) {
        fs.mkdirSync(output, { recursive: true })
        fs.writeFileSync(
          path.join(output, 'native.argv.json'),
          JSON.stringify(
            {
              executable: detector,
              args,
              fixtureBase: base,
              source,
              config,
            },
            null,
            2,
          ) + '\n',
        )
        fs.copyFileSync(config, path.join(output, 'native.config.json'))
        stdout = fs.openSync(path.join(output, 'native.stdout'), 'wx')
        stderr = fs.openSync(path.join(output, 'native.stderr'), 'wx')
      }
      execFileSync(detector, args, {
        cwd: source,
        env,
        stdio: keep ? ['ignore', stdout, stderr] : 'pipe',
      })
      outcome = { status: 0, signal: null }
    } catch (error) {
      outcome = {
        status: error.status ?? null,
        signal: error.signal ?? null,
        message: error.message,
      }
      throw error
    } finally {
      if (stdout !== undefined) fs.closeSync(stdout)
      if (stderr !== undefined) fs.closeSync(stderr)
      if (keep)
        fs.writeFileSync(path.join(output, 'native.exit.json'), JSON.stringify(outcome) + '\n')
    }
    const value = JSON.parse(fs.readFileSync(path.join(output, 'jscpd-report.json'), 'utf8'))
    cloneFindings(value)
    return value
  }
  try {
    if (process.env.CODE_HEALTH_NATIVE_EVIDENCE) {
      fs.writeFileSync(
        path.join(temporary, 'fixture-input.json'),
        JSON.stringify(
          {
            changeSource: change.toString(),
            detector,
            config,
          },
          null,
          2,
        ) + '\n',
      )
    }
    git('init', '--template=')
    for (const file of ['a.ts', 'b.ts']) write(file, block(100))
    for (const file of ['c.ts', 'd.ts']) write(file, block(1000))
    git('add', '.')
    git('-c', 'core.hooksPath=' + os.devNull, 'commit', '-m', 'Native fixture base')
    const base = git('rev-parse', 'HEAD')
    const before = scan(base, 'before')
    assert.equal(before.statistics.total.newClones, 0)
    assert.ok(before.duplicates.length > 0)
    change({ source, write })
    const after = scan(base, 'after')
    return { before, after, classification: classifyCloneFindings(after) }
  } finally {
    const captureRoot = process.env.CODE_HEALTH_NATIVE_EVIDENCE
    if (captureRoot) {
      fs.mkdirSync(path.resolve(captureRoot), { recursive: true })
      fs.cpSync(temporary, path.join(path.resolve(captureRoot), path.basename(temporary)), {
        recursive: true,
        errorOnExist: true,
        force: false,
      })
    }
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

test(
  'native eligible movement/deletion does not manufacture a new copy',
  { timeout: 120000 },
  () => {
    const { after } = nativeCase(({ source }) => {
      fs.renameSync(path.join(source, 'b.ts'), path.join(source, 'renamed.ts'))
      fs.unlinkSync(path.join(source, 'd.ts'))
    })
    assert.equal(after.statistics.total.newClones, 0)
  },
)

test(
  'native copy growth inside an old pair fails despite unrelated debt removal',
  { timeout: 120000 },
  () => {
    const { before, after, classification } = nativeCase(({ source, write }) => {
      for (const file of ['a.ts', 'b.ts']) write(file, block(100) + block(9000))
      for (const file of ['c.ts', 'd.ts']) fs.unlinkSync(path.join(source, file))
    })
    const pairs = (value) =>
      new Set(
        value.duplicates.map((d) =>
          [path.basename(d.firstFile.name), path.basename(d.secondFile.name)].sort().join('|'),
        ),
      )
    const old = pairs(before)
    assert.equal([...pairs(after)].filter((key) => !old.has(key)).length, 0)
    assert.ok(after.statistics.total.newClones > 0)
    assert.ok(cloneFindings(after).length > 0)
    assert.ok(classification.countedFindings.length > 0)
  },
)

const importBlock =
  Array.from({ length: 12 }, (_, n) => `import { item${n} } from './dependency${n}'`).join('\n') +
  '\n'

test(
  'native import-only matches stay visible while copied logic after imports still fails',
  { timeout: 120000 },
  () => {
    const { after, classification } = nativeCase(({ source, write }) => {
      for (const file of ['a.ts', 'b.ts']) write(file, importBlock + block(100) + block(9000))
      for (const file of ['c.ts', 'd.ts']) fs.unlinkSync(path.join(source, file))
    })
    assert.ok(after.statistics.total.newClones > 0)
    assert.ok(classification.countedFindings.length > 0)
    assert.equal(classification.nativeFindings.length, after.statistics.total.newClones)
  },
)

test(
  'native import-only NEW records retain raw NEW markers and have zero counted logic',
  { timeout: 120000 },
  () => {
    const { after, classification } = nativeCase(({ source, write }) => {
      for (const file of ['a.ts', 'b.ts']) write(file, importBlock)
      for (const file of ['c.ts', 'd.ts']) fs.unlinkSync(path.join(source, file))
    })
    assert.ok(after.statistics.total.newClones > 0)
    assert.ok(classification.importOnlyRecords.length > 0)
    assert.equal(classification.nativeFindings.length, after.statistics.total.newClones)
    assert.equal(classification.countedFindings.length, 0)
  },
)

test('missing reference objects and stale native output are execution errors', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'code-health-errors-'))
  const gate = path.join(here, 'gate.mjs')
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: here, encoding: 'utf8' }).trim()
  try {
    const missing = spawnSync(
      process.execPath,
      [gate, '--clone-base', '0'.repeat(40), '--out', path.join(temporary, 'missing')],
      { encoding: 'utf8' },
    )
    assert.equal(missing.status, 2)
    assert.match(missing.stderr, /execution error, not a finding/)
    const stale = path.join(temporary, 'stale')
    fs.mkdirSync(path.join(stale, 'jscpd'), { recursive: true })
    const oldReport = path.join(stale, 'jscpd', 'jscpd-report.json')
    fs.writeFileSync(oldReport, 'previous report stays intact')
    const result = spawnSync(process.execPath, [gate, '--clone-base', head, '--out', stale], {
      encoding: 'utf8',
    })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /execution error, not a finding/)
    assert.equal(fs.readFileSync(oldReport, 'utf8'), 'previous report stays intact')
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})
