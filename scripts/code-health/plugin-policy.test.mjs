import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  emptyCounts,
  comparePluginCounts,
  collectPluginPolicy,
  valueImports,
  policyCoverageErrors,
  targetPluginCounts,
} from './plugin-policy.mjs'
import { depcruiseKeys } from './gate.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const require = createRequire(import.meta.url)
const host = 'apps/desktop/src/main/plugins/example.ts'
const barrel = 'packages/runtime/src/index.ts'
const sdk = 'node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts'
const graph = (rows) => ({
  summary: { violations: [] },
  modules: Object.entries(rows).map(([source, dependencies]) => ({ source, dependencies })),
})
const edge = (resolved, extra = {}) => ({ resolved, module: resolved, ...extra })
const measure = (rows, sources = {}) =>
  collectPluginPolicy(graph(rows), Object.keys(rows), {
    root,
    readSource: (file) => sources[file] ?? '',
  })

test('count-only policy accepts equal and replacement counts, and lowered ceilings for declines', () => {
  const before = emptyCounts()
  before['runtime-barrel-reach'].host = 1
  assert.deepEqual(comparePluginCounts(before, before, before).added, [])
  const replacement = measure({ [host]: [edge(barrel)], [barrel]: [] })
  assert.deepEqual(comparePluginCounts(replacement.counts, before, before).added, [])
  const zero = emptyCounts()
  assert.deepEqual(comparePluginCounts(zero, zero, before).added, [])
  assert.equal(comparePluginCounts(zero, before, before).added.length, 1)
  assert.equal(comparePluginCounts(before, before, zero).added.length, 1)
  assert.throws(() => comparePluginCounts({ ...zero, extra: {} }, zero, zero), /three rule1/)
  const bad = structuredClone(zero)
  bad['provider-sdk-reach'].host = -1
  assert.throws(() => comparePluginCounts(bad, zero, zero), /invalid integer/)
})

test('type-only imports and exports are legal; every value loader form is recorded', () => {
  const text = `import type { A } from '@brobot2/runtime'
import { type B } from '@brobot2/runtime'
export type { C } from '@brobot2/runtime'
export { type D } from '@brobot2/runtime'
import { E } from '@brobot2/runtime'
export { F } from '@brobot2/runtime'
const g = require('@brobot2/runtime')
const h = import('@brobot2/runtime')
const i = import(variable)
`
  const result = valueImports(text, host)
  assert.deepEqual(
    result.imports.map((one) => one.line),
    [5, 6, 7, 8],
  )
  assert.deepEqual(result.computed, [9])
  const measured = measure(
    {
      [host]: [edge(barrel, { preCompilationOnly: true, dependencyTypes: ['type-only'] })],
      [barrel]: [],
    },
    {
      [host]: `import type { A } from '@brobot2/runtime'`,
    },
  )
  assert.equal(measured.counts['runtime-barrel-reach'].host, 0)
  assert.equal(measured.counts['direct-value-barrel'].host, 0)
  assert.equal(measured.fullCounts['runtime-barrel-reach'].host, 1)
})

test('a syntactic value barrel import fails even when the compiler erases its use', () => {
  const measured = measure(
    { [host]: [edge(barrel, { preCompilationOnly: true })], [barrel]: [] },
    {
      [host]: `import { A } from '@brobot2/runtime'; export type B = A`,
    },
  )
  assert.equal(measured.counts['direct-value-barrel'].host, 1)
})

test('executable helper closure follows cycles once and counts one root-target pair', () => {
  const measured = measure({
    [host]: [edge('shared/a.ts'), edge('shared/b.ts')],
    'shared/a.ts': [edge('shared/b.ts'), edge(barrel)],
    'shared/b.ts': [edge('shared/a.ts'), edge(barrel)],
    [barrel]: [edge(sdk)],
    [sdk]: [],
  })
  assert.equal(measured.counts['runtime-barrel-reach'].host, 1)
  assert.equal(measured.counts['provider-sdk-reach'].host, 1)
  assert.equal(measured.counts['direct-value-barrel'].host, 0)
  assert.deepEqual(measured.witnesses.find((w) => w.rule === 'provider-sdk-reach').path, [
    host,
    'shared/a.ts',
    barrel,
    sdk,
  ])
})

test('service roots are covered; missing SDK endpoints and unresolved execution remain visible', () => {
  const service = 'apps/desktop/resources/plugin-host/entry.mjs'
  const measured = measure(
    { [service]: [edge('shared/helper.ts')], 'shared/helper.ts': [] },
    {
      'shared/helper.ts': `import { query } from '@anthropic-ai/claude-agent-sdk'; export const run = query`,
    },
  )
  assert.equal(measured.counts['provider-sdk-reach'].service, 1)
  assert.equal(measured.coverage.sdkEndpointGaps.length, 1)
  assert.equal(policyCoverageErrors(measured).length, 1)
  const unknown = measure({ [host]: [edge('missing', { couldNotResolve: true })] })
  assert.equal(policyCoverageErrors(unknown).length, 1)
  const missing = collectPluginPolicy(graph({}), [host], { root, readSource: () => '' })
  assert.deepEqual(missing.coverage.missing, [host])
})

test('generic dispatch and engine/UI vocabulary do not become runtime imports', () => {
  const text = `const selected = contributions.get(pluginId)
const PDF_VIEWER_ORIGIN = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai'
const navigation = url.protocol === 'chrome-extension:'
const decoration = ['chrome-text', 'chrome-selection']
`
  assert.deepEqual(measure({ [host]: [] }, { [host]: text }).counts, emptyCounts())
  assert.equal(
    measure(
      { [host]: [] },
      {
        [host]: text + `\nimport { E } from '@brobot2/runtime'`,
      },
    ).counts['direct-value-barrel'].host,
    1,
  )
})

test('new policy names and external endpoints do not enter the legacy identity baseline', () => {
  const report = graph({
    [host]: [edge(sdk, { circular: true })],
    [sdk]: [edge(host, { circular: true })],
  })
  report.summary.violations = [
    { rule: { name: 'plugin-policy/example' }, from: host, to: barrel },
    { rule: { name: 'not-to-unresolvable' }, from: host, to: sdk },
    { rule: { name: 'existing-rule' }, from: 'a.ts', to: 'b.ts' },
  ]
  assert.deepEqual(depcruiseKeys(report), ['existing-rule|a.ts|b.ts'])
})

test('target ceilings need a readable ordinary Git target; bootstrap never activates implicitly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-target-'))
  try {
    execFileSync('git', ['init', '-q', dir])
    fs.writeFileSync(path.join(dir, 'file'), 'test\n')
    execFileSync('git', ['-C', dir, 'add', 'file'])
    execFileSync('git', [
      '-C',
      dir,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'fixture',
    ])
    assert.throws(() => targetPluginCounts(dir, 'HEAD'))
    assert.throws(() => targetPluginCounts(dir, 'HEAD', true), /reviewed a42/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('pinned native collector: actual incident VALUE import, SDK-only helper, legal types and neutral leaves', () => {
  assert.equal(require('./node_modules/dependency-cruiser/package.json').version, '17.3.8')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-native-'))
  const put = (file, text) => {
    const target = path.join(dir, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
  }
  const selected = ['apps/desktop/src/main/plugins/startup-failure.ts']
  const entry = selected[0]
  const cli = path.join(here, 'node_modules/dependency-cruiser/bin/dependency-cruise.mjs')
  const config = structuredClone(require('./depcruise.cjs'))
  config.options.tsConfig.fileName = path.join(dir, 'tsconfig.json')
  put(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' },
    }),
  )
  put('package.json', '{"type":"module"}')
  put('depcruise.cjs', 'module.exports = ' + JSON.stringify(config))
  put(
    'packages/runtime/package.json',
    JSON.stringify({
      name: '@brobot2/runtime',
      exports: {
        '.': './src/index.ts',
        './plugin-failure': './src/managed-plugin-failure.ts',
        './provider-home': './src/internal/provider-home.ts',
      },
    }),
  )
  for (const file of ['managed-plugin-failure.ts', 'internal/provider-home.ts'])
    put(
      'packages/runtime/src/' + file,
      fs.readFileSync(path.join(root, 'packages/runtime/src', file), 'utf8'),
    )
  put(
    'packages/runtime/src/index.ts',
    `export * from './managed-plugin-failure'; import { query } from '@anthropic-ai/claude-agent-sdk'; export const runtime = query`,
  )
  fs.mkdirSync(path.join(dir, 'node_modules/@brobot2'), { recursive: true })
  fs.symlinkSync(
    path.join(dir, 'packages/runtime'),
    path.join(dir, 'node_modules/@brobot2/runtime'),
    'junction',
  )
  put(
    'node_modules/@anthropic-ai/claude-agent-sdk/package.json',
    '{"name":"@anthropic-ai/claude-agent-sdk","types":"sdk.d.ts"}',
  )
  put(
    'node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts',
    'export declare const query: () => void\n',
  )
  const native = (label, expected) => {
    const report = path.join(dir, 'graph.json')
    const command = [
      cli,
      ...selected,
      '--config',
      path.join(dir, 'depcruise.cjs'),
      '--output-type',
      'json',
      '--output-to',
      report,
    ]
    const scan = spawnSync(process.execPath, command, { cwd: dir, encoding: 'utf8' })
    assert.equal(scan.error, undefined)
    assert.equal(scan.status, 0, scan.stderr)
    const raw = JSON.parse(fs.readFileSync(report, 'utf8'))
    const result = collectPluginPolicy(raw, selected, { root: dir })
    const evaluate = `import fs from 'node:fs'; import { collectPluginPolicy, comparePluginCounts, emptyCounts, policyCoverageErrors } from ${JSON.stringify(pathToModule())}; const g=JSON.parse(fs.readFileSync(process.argv[1])); const p=collectPluginPolicy(g,${JSON.stringify(selected)},{root:process.argv[2]}); const errors=policyCoverageErrors(p); const diff=comparePluginCounts(p.counts,emptyCounts(),emptyCounts()); console.log(JSON.stringify({counts:p.counts,witnesses:p.witnesses,coverage:p.coverage,errors,diff})); process.exit(errors.length?2:diff.added.length?1:0);`
    const check = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', evaluate, report, dir],
      { encoding: 'utf8' },
    )
    assert.equal(check.status, expected, check.stderr + check.stdout)
    console.log(
      'POLICY_CONTROL ' +
        JSON.stringify({
          label,
          nativeExit: scan.status,
          policyExit: check.status,
          counts: result.counts,
          witnesses: result.witnesses,
        }),
    )
    return { result, raw }
  }
  const neutral = `import { managedPluginFailure, ManagedPluginFailure } from '@brobot2/runtime/plugin-failure'\nexport const check = (error: unknown) => error instanceof ManagedPluginFailure ? error : managedPluginFailure(error, 'plugin-settings')\n`
  try {
    put(entry, neutral)
    native('neutral GREEN', 0)
    put(entry, neutral.replace("from '@brobot2/runtime/plugin-failure'", "from '@brobot2/runtime'"))
    const planted = native('actual 1d044b08 VALUE import RED', 1)
    assert.equal(planted.result.counts['provider-sdk-reach'].host, 1)
    assert.ok(planted.result.witnesses.some((w) => w.path.includes(barrel)))
    put(entry, neutral)
    native('incident restored GREEN', 0)
    put(entry, `export { run } from '../../../../../shared/helper'`)
    put(
      'shared/helper.ts',
      `import { query } from '@anthropic-ai/claude-agent-sdk'; export const run = query`,
    )
    const helper = native('helper to SDK without barrel RED', 1)
    assert.equal(helper.result.counts['runtime-barrel-reach'].host, 0)
    assert.equal(helper.result.counts['provider-sdk-reach'].host, 1)
    assert.ok(helper.raw.modules.some((m) => m.source.includes('/@anthropic-ai/claude-agent-sdk/')))
    assert.ok(
      helper.raw.modules
        .filter((m) => m.source.includes('/@anthropic-ai/claude-agent-sdk/'))
        .every((m) => m.dependencies.length === 0),
    )
    put('shared/helper.ts', 'export const run = 1')
    native('helper restored GREEN', 0)
    put(
      entry,
      `import type { ManagedPluginFailure } from '@brobot2/runtime'; export type Failure = ManagedPluginFailure`,
    )
    const erased = native('explicit type-only barrel GREEN', 0)
    assert.equal(erased.result.fullCounts['runtime-barrel-reach'].host, 1)
    put(
      entry,
      `import * as homes from '@brobot2/runtime/provider-home'; export const neutral = homes`,
    )
    native('builtin-only neutral provider-home GREEN', 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function pathToModule() {
  return new URL('./plugin-policy.mjs', import.meta.url).href
}
