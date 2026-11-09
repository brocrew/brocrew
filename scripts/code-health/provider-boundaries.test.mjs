import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const cli = path.join(here, 'node_modules/dependency-cruiser/bin/dependency-cruise.mjs')

// Use the real resolver so package exports and re-exports cannot hide adapter edges.
for (const [name, importer, target, rule] of [
  [
    'package subpath',
    'apps/desktop/src/main/work.ts',
    'packages/runtime/src/claude.ts',
    'neutral-not-to-provider-adapters',
  ],
  [
    'neutral app',
    'apps/desktop/src/main/work.ts',
    'packages/runtime/src/claude.ts',
    'neutral-not-to-provider-adapters',
  ],
  [
    'window types',
    'apps/desktop/src/renderer/types.ts',
    'packages/runtime/src/codex.ts',
    'neutral-not-to-provider-adapters',
  ],
  [
    'runtime barrel',
    'packages/runtime/src/index.ts',
    'packages/runtime/src/claude/native.ts',
    'runtime-interface-not-to-provider-adapters',
  ],
  [
    'cross-provider',
    'packages/runtime/src/claude/native.ts',
    'packages/runtime/src/codex/native.ts',
    'claude-not-to-other-provider',
  ],
  [
    'portable layouts',
    'apps/desktop/src/main/providers/workspace-layout.mjs',
    'apps/desktop/src/main/providers/claude/layout.mjs',
    null,
  ],
  [
    'portable runtime leak',
    'apps/desktop/src/main/providers/workspace-layout.mjs',
    'packages/runtime/src/claude.ts',
    'portable-provider-data-only-layouts',
  ],
  [
    'registration',
    'apps/desktop/src/main/providers/index.ts',
    'packages/runtime/src/claude.ts',
    null,
  ],
  [
    'own adapter',
    'apps/desktop/src/main/providers/codex/native.ts',
    'packages/runtime/src/codex.ts',
    null,
  ],
  ['neutral interface', 'apps/desktop/src/main/work.ts', 'packages/runtime/src/index.ts', null],
]) {
  test(`provider import policy: ${name}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-boundary-'))
    const put = (file, text) => {
      const dest = path.join(dir, file)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, text)
    }
    try {
      const config = structuredClone(require('./depcruise.cjs'))
      config.options.tsConfig.fileName = path.join(dir, 'tsconfig.json')
      put(
        'tsconfig.json',
        JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler' } }),
      )
      put('depcruise.cjs', `module.exports = ${JSON.stringify(config)}`)
      put(
        target,
        name === 'window types'
          ? 'export interface Value { value: string }\n'
          : 'export const value = 1\n',
      )
      let relative = path.relative(path.dirname(importer), target).replaceAll(path.sep, '/')
      if (!relative.startsWith('.')) relative = './' + relative
      if (name === 'package subpath' || name === 'neutral interface') {
        put(
          'packages/runtime/package.json',
          JSON.stringify({
            name: '@brobot2/runtime',
            exports: { '.': './src/index.ts', './claude': './src/claude.ts' },
          }),
        )
        fs.mkdirSync(path.join(dir, 'node_modules/@brobot2'), { recursive: true })
        fs.symlinkSync(
          path.join(dir, 'packages/runtime'),
          path.join(dir, 'node_modules/@brobot2/runtime'),
          'junction',
        )
        relative = name === 'package subpath' ? '@brobot2/runtime/claude' : '@brobot2/runtime'
      }
      put(
        importer,
        name === 'window types'
          ? `import type { Value } from '${relative}'; export type Result = Value\n`
          : `export { value } from '${relative}'\n`,
      )
      const scan = spawnSync(
        process.execPath,
        [cli, importer, '--config', 'depcruise.cjs', '--output-type', 'json'],
        {
          cwd: dir,
          encoding: 'utf8',
        },
      )
      assert.equal(scan.error, undefined)
      const graph = JSON.parse(scan.stdout)
      const violations = graph.summary.violations.map((v) => v.rule.name)
      assert.deepEqual(violations, rule === null ? [] : [rule], scan.stderr)
      assert.equal(scan.status, rule === null ? 0 : 1)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
}
