import './provider-boundaries.test.mjs'
import './plugin-policy.test.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LINE_LIMIT,
  compareKeys,
  compareSizes,
  depcruiseKeys,
  jscpdKeys,
  knipKeys,
} from './gate.mjs'

const clone = (first, second, line) => ({
  format: 'typescript',
  firstFile: { name: first, start: line },
  secondFile: { name: second, start: line + 40 },
})

test('a clone pair has one identity whatever its order or position', () => {
  const before = jscpdKeys({ duplicates: [clone('b.ts', 'a.ts', 10)] })
  const after = jscpdKeys({ duplicates: [clone('a.ts', 'b.ts', 200)] })
  assert.deepEqual(before, ['typescript|a.ts|b.ts'])
  assert.deepEqual(after, before)
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

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as a02Gate from './gate.mjs'

const a02Fixture = (run) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'a02-files-'))
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  const put = (file, bytes) => {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true })
    fs.writeFileSync(path.join(directory, file), bytes)
  }
  const commit = () => {
    git('add', '.')
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'fixture source',
    )
    return git('rev-parse', 'HEAD')
  }
  try {
    git('init', '-q')
    put('apps/sample/src/start.ts', 'export {}\n')
    commit()
    return run({
      directory,
      git,
      put,
      commit,
      measure: (options) => a02Gate.measureProductSize(directory, options),
    })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('A02 requested byte-LF metric is available', () => {
  assert.equal(typeof a02Gate.measureProductSize, 'function', 'requested A02 metric is absent')
  assert.equal(typeof a02Gate.readProductRelease, 'function')
  assert.equal(a02Gate.A02_PROFILE.threshold, 2000)
})

test('A02 counts raw LF boundaries independently of decoding and trailing fragments', () =>
  a02Fixture(({ put, measure }) => {
    const cases = [
      ['exact.json', Buffer.from('\n'.repeat(2000)), 2000],
      ['over.json', Buffer.from('\n'.repeat(2001)), 2001],
      ['fragment.json', Buffer.from('\n'.repeat(2000) + 'tail'), 2000],
      ['crlf.json', Buffer.from('\r\n'.repeat(2001)), 2001],
      ['mixed.json', Buffer.from('\r\n'.repeat(1000) + '\n'.repeat(1000) + 'tail'), 2000],
      [
        'invalid.json',
        Buffer.concat([Buffer.from([255, 0, 254]), Buffer.from('\n'.repeat(2001))]),
        2001,
      ],
      ['empty.json', Buffer.alloc(0), 0],
    ]
    for (const [file, bytes] of cases) put(`apps/sample/data/${file}`, bytes)
    const result = measure()
    assert.equal(result.count, 3)
    for (const [file, , lf] of cases) {
      const row = result.files.find((r) => r.path === `apps/sample/data/${file}`)
      assert.equal(row.lf, lf, file)
      assert.equal(row.tracked, false)
    }
  }))

test('A02 expands new packaging and recursive literal scripts with first regular match', () =>
  a02Fixture(({ put, measure }) => {
    put('apps/desktop/build/new-hook.cjs', "require('../../../scripts/a02-chain')\n")
    put('apps/desktop/build/new-installer.nsh', '\n'.repeat(2001))
    put(
      'scripts/a02-chain.ts',
      "import './a02-leaf'\nimport './a02-leaf'\nimport './a02-shared'\nimport './a02-shared'\n",
    )
    put('scripts/a02-shared.ts', '\n'.repeat(2001))
    put('scripts/a02-leaf', 'exact\n')
    put('scripts/a02-leaf.ts', '\n'.repeat(2001))
    put('scripts/a02-unused.ts', '\n'.repeat(2001))
    put('apps/sample/src/links.ts', "import '../../../scripts/a02-missing.js'\n")
    const result = measure()
    assert.equal(result.count, 2)
    assert.equal(result.files.filter((r) => r.path === 'scripts/a02-shared.ts').length, 1)
    assert.ok(
      result.files.some((r) => r.path === 'scripts/a02-leaf') === false,
      'extensionless exact match is diagnostic outside selected suffixes, not fallback to .ts',
    )
    assert.ok(!result.files.some((r) => r.path === 'scripts/a02-leaf.ts'))
    assert.ok(!result.files.some((r) => r.path === 'scripts/a02-unused.ts'))
    assert.equal(result.edges.filter((e) => e.to === 'scripts/a02-leaf').length, 2)
    assert.ok(result.edges.some((e) => e.status === 'unresolved lexical target'))
  }))

test('A02 uniform exclusions, generated view and committed regular-mode inventory', () =>
  a02Fixture(({ directory, git, put, commit, measure }) => {
    for (const file of [
      'apps/sample/test/large.json',
      'apps/sample/src/example.test.ts',
      'apps/sample/dist/large.json',
      'apps/sample/package-lock.json',
      'packages/runtime/src/codex/protocol/large.ts',
    ])
      put(file, '\n'.repeat(2001))
    put('apps/sample/src/generated.ts', '// AUTO-GENERATED\n' + '\n'.repeat(2001))
    put('apps/sample/src/instructions.md', '\n'.repeat(2001))
    put('apps/sample/readme.md', '\n'.repeat(2001))
    const oid = git('hash-object', '-w', '--stdin')
    git('update-index', '--add', '--cacheinfo', `120000,${oid},apps/sample/src/link.ts`)
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'link entry',
    )
    const source = commit()
    // Insert a Git symlink blob directly so the fixture does not need host symlink privileges.
    git('update-index', '--add', '--cacheinfo', `120000,${oid},apps/sample/src/link.ts`)
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'regular-mode boundary',
    )
    const withLink = git('rev-parse', 'HEAD')
    const result = measure({ source: withLink })
    assert.equal(result.count, 1)
    assert.ok(
      result.excluded.some(
        (r) => r.path.endsWith('/link.ts') && r.reason === 'nonregular Git entry',
      ),
    )
    assert.ok(result.excluded.some((r) => r.reason === 'explicit generated header'))
    put('apps/sample/data/new.json', '\n'.repeat(2001))
    assert.equal(measure({ source }).count, 1, 'committed release excludes new untracked path')
    // Remove the virtual index-only symlink before measuring working regular files.
    git('update-index', '--force-remove', 'apps/sample/src/link.ts')
    assert.equal(measure().count, 2)
    git('add', 'apps/sample/src/instructions.md')
    fs.rmSync(path.join(directory, 'apps/sample/src/instructions.md'))
    assert.throws(() => measure(), /selected file unreadable/)
  }))

test('A02 equality, identity swaps and headroom remain count-only; legacy size stays separate', () =>
  a02Fixture(({ directory, put, measure }) => {
    put('apps/sample/data/first.json', '\n'.repeat(2001))
    const ceiling = measure().count
    fs.renameSync(
      path.join(directory, 'apps/sample/data/first.json'),
      path.join(directory, 'apps/sample/data/replaced.json'),
    )
    assert.equal(a02Gate.compareProductCount(measure().count, ceiling).excess, 0)
    put('apps/sample/data/replaced.json', '\n'.repeat(5000))
    assert.equal(a02Gate.compareProductCount(measure().count, ceiling).excess, 0)
    put('apps/sample/data/replaced.json', '')
    assert.equal(a02Gate.compareProductCount(measure().count, ceiling).headroom, 1)
    put('apps/sample/data/replaced.json', '\n'.repeat(2001))
    assert.equal(a02Gate.compareProductCount(measure().count, ceiling).excess, 0)
    assert.equal(a02Gate.compareProductCount(measure().count, 0).excess, 1)
    assert.equal(a02Gate.LINE_LIMIT, 1000)
    assert.equal(a02Gate.compareSizes({}, { 'new.ts': 2001 }).added.length, 1)
    for (const bad of [-1, 0.5, '1', null, Infinity])
      assert.throws(() => a02Gate.compareProductCount(bad, 1), /invalid count/)
  }))

test('A02 immutable nominated record binds shipment, versions and raw record bytes', () =>
  a02Fixture(({ directory, git, put, commit }) => {
    const sourceSha = git('rev-parse', 'HEAD')
    const sourceTree = git('rev-parse', 'HEAD^{tree}')
    const record = {
      schema: 1,
      release: { id: 7, tag: 'v0.0.7', source: sourceSha, tree: sourceTree },
      metrics: {
        'AUTO-A02': {
          definition: a02Gate.A02_PROFILE.definition,
          selector: a02Gate.A02_PROFILE.selector,
          profileSha256: a02Gate.a02ProfileHash(),
          count: 2,
          inventorySha256: 'a'.repeat(64),
          receiptSha256: 'b'.repeat(64),
        },
      },
    }
    const bytes = Buffer.from(JSON.stringify(record) + '\n')
    put(a02Gate.A02_RELEASE_FILE, bytes)
    const storageSha = commit()
    const tuple = {
      releaseId: 7,
      tag: 'v0.0.7',
      sourceSha,
      sourceTree,
      storageSha,
      path: a02Gate.A02_RELEASE_FILE,
      blobOid: git('rev-parse', `${storageSha}:${a02Gate.A02_RELEASE_FILE}`),
      recordSha256: createHash('sha256').update(bytes).digest('hex'),
    }
    const read = (value = tuple) => a02Gate.readProductRelease(directory, JSON.stringify(value))
    assert.equal(read().ceiling, 2)
    put(
      a02Gate.A02_RELEASE_FILE,
      JSON.stringify({ ...record, metrics: { 'AUTO-A02': { count: 999 } } }),
    )
    assert.equal(read().ceiling, 2, 'candidate copy cannot raise selected immutable ceiling')
    for (const change of [
      { sourceTree: 'd'.repeat(40) },
      { sourceSha: 'c'.repeat(40) },
      { storageSha: 'c'.repeat(40) },
      { blobOid: 'e'.repeat(40) },
      { recordSha256: 'f'.repeat(64) },
      { releaseId: 8 },
      { tag: 'v0.0.8' },
      { path: 'other.json' },
      { storageSha: sourceSha },
    ])
      assert.throws(() => read({ ...tuple, ...change }))
    for (const change of [
      { count: -1 },
      { count: '2' },
      { count: 0.2 },
      { definition: 'other' },
      { selector: 'other' },
      { profileSha256: 'd'.repeat(64) },
      { inventorySha256: undefined },
      { receiptSha256: undefined },
    ]) {
      const changed = structuredClone(record)
      Object.assign(changed.metrics['AUTO-A02'], change)
      const changedBytes = Buffer.from(JSON.stringify(changed))
      put(a02Gate.A02_RELEASE_FILE, changedBytes)
      const storage = commit()
      assert.throws(
        () =>
          read({
            ...tuple,
            storageSha: storage,
            blobOid: git('rev-parse', `${storage}:${a02Gate.A02_RELEASE_FILE}`),
            recordSha256: createHash('sha256').update(changedBytes).digest('hex'),
          }),
        /incompatible release metric/,
      )
    }
    for (const changed of [
      '{broken',
      { ...record, metrics: {} },
      { ...record, metrics: { ...record.metrics, unknown: { count: 0 } } },
      { ...record, release: { ...record.release, source: 'c'.repeat(40) } },
    ]) {
      const invalidBytes = Buffer.from(
        typeof changed === 'string' ? changed : JSON.stringify(changed),
      )
      put(a02Gate.A02_RELEASE_FILE, invalidBytes)
      const storage = commit()
      assert.throws(() =>
        read({
          ...tuple,
          storageSha: storage,
          blobOid: git('rev-parse', `${storage}:${a02Gate.A02_RELEASE_FILE}`),
          recordSha256: createHash('sha256').update(invalidBytes).digest('hex'),
        }),
      )
    }
    assert.throws(() => a02Gate.readProductRelease(directory, ''), /missing or malformed/)
    assert.throws(() => a02Gate.readProductRelease(directory, '{}'), /invalid shipment tuple/)
  }))

test('A02 ordinary CLI reports unavailable shipment tuple as execution error 2', () => {
  const env = { ...process.env, BROCREW_A02_LAST_SHIPPED: '' }
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./gate.mjs', import.meta.url))],
    { env, encoding: 'utf8' },
  )
  assert.equal(result.status, 2)
  assert.match(result.stderr, /execution error, not a finding/)
  assert.match(result.stderr, /BROCREW_A02_LAST_SHIPPED/)
})
