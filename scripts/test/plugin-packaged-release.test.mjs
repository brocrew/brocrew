import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { failureFor, printFailure, safeFailure } from '../gates/plugin-packaged/diagnostics.mjs'
import { stageProtocolDependencies } from '../gates/plugin-packaged/prepare.mjs'
import { listFor, projectFixtureManifest } from '../gates/plugin-packaged/release.mjs'
import { exportChromePlugin } from '../export-chrome-plugin.mjs'
import { createRepoAwarePluginVerifier } from '../../apps/desktop/src/main/plugins/package-verifier.ts'
import {
  parseRepoPluginList,
  loadRepoPluginList,
} from '../../apps/desktop/src/main/plugins/catalogue/repo-list.ts'
import { localPluginArchive } from '../../apps/desktop/src/main/plugins/catalogue/local.ts'
import { assemblePluginRelease } from '../build-plugin-release.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function scratch() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-release-load-')))
  fs.chmodSync(root, 0o700)
  roots.push(root)
  return root
}

describe.skipIf(process.platform === 'win32')('release verifier module admission', () => {
  it.each([1, 2])(
    'verifies the format %s export before rebuilding through the v1 fixture route',
    async (format) => {
      const root = scratch(),
        exported = path.join(root, 'exported')
      exportChromePlugin(exported)
      const plugin = path.join(exported, 'plugins/chrome')
      fs.symlinkSync(
        path.join(repository, 'plugins/chrome/node_modules'),
        path.join(plugin, 'node_modules'),
      )
      const template = path.join(plugin, 'manifest-template.json')
      const originalTemplate = fs.readFileSync(template, 'utf8')
      const sourceEntry = path.join(plugin, 'src/index.ts')
      const originalEntry = fs.readFileSync(sourceEntry)
      expect(JSON.parse(originalTemplate).format).toBe(2)
      if (format === 1) fs.writeFileSync(template, projectFixtureManifest(originalTemplate))
      const { buildChromePackage } = await import(
        pathToFileURL(path.join(plugin, 'build.mjs')).href
      )
      const original = path.join(root, 'original'),
        fixture = path.join(root, 'fixture')
      const build = (out) =>
        assemblePluginRelease({
          id: 'chrome',
          out,
          sourceCommit: 'a'.repeat(40),
          targets: [{ os: 'darwin', cpu: 'arm64' }],
          buildPackage: buildChromePackage,
        })
      const release = await build(original)
      const originalArchive = path.join(original, 'chrome-darwin-arm64.tar.gz')
      const originalBytes = fs.readFileSync(originalArchive)
      const parsed = parseRepoPluginList(
        Buffer.from(JSON.stringify(listFor(release))),
        { os: 'darwin', cpu: 'arm64' },
        '999.0.0',
      )
      const verifier = createRepoAwarePluginVerifier({ target: { os: 'darwin', cpu: 'arm64' } })
      const checked = verifier
        .verifyCatalogue(parsed.bytes)
        .verifyPackage(release.id, release.version, originalBytes)
      expect(checked.manifest.format).toBe(format)
      fs.writeFileSync(template, projectFixtureManifest(fs.readFileSync(template, 'utf8')))
      const projected = await build(fixture)
      fs.writeFileSync(path.join(fixture, 'catalogue.json'), JSON.stringify(listFor(projected)))
      fs.mkdirSync(path.join(fixture, 'archives'), { mode: 0o700 })
      fs.copyFileSync(
        path.join(fixture, 'chrome-darwin-arm64.tar.gz'),
        path.join(fixture, 'archives', projected.targets[0].sha256 + '.tar.gz'),
      )
      const state = path.join(root, 'state')
      fs.mkdirSync(state, { mode: 0o700 })
      const loaded = await loadRepoPluginList({
        root: state,
        fixtureSource: fixture,
        target: { os: 'darwin', cpu: 'arm64' },
        appVersion: '999.0.0',
      })
      expect(loaded.format).toBe(1)
      const fixtureBytes = await localPluginArchive(fixture, loaded.releases[0])
      const accepted = verifier
        .verifyCatalogue(loaded.bytes)
        .verifyPackage(projected.id, projected.version, fixtureBytes)
      expect(listFor(projected).format).toBe(1)
      expect(accepted.manifest.format).toBe(1)
      for (const field of ['authors', 'executor', 'hooks', 'sharedData'])
        expect(accepted.manifest).not.toHaveProperty(field)
      expect(accepted.manifest.hostApi.requiredFeatures).not.toContain('shared-data-v1')
      expect(accepted.manifest.server).toEqual(checked.manifest.server)
      expect(accepted.manifest.ui).toEqual(checked.manifest.ui)
      expect(accepted.filePaths).toEqual(checked.filePaths)
      for (const name of checked.filePaths) {
        if (name === 'plugin.json' || name === checked.manifest.server.entry) continue
        expect(
          Buffer.from(accepted.readFile(name)).equals(Buffer.from(checked.readFile(name))),
        ).toBe(true)
      }
      expect(fs.readFileSync(sourceEntry).equals(originalEntry)).toBe(true)
      expect(projected.targets[0].sha256 === release.targets[0].sha256).toBe(format === 1)
      expect(projected.targets[0].manifestSha256 === release.targets[0].manifestSha256).toBe(
        format === 1,
      )
      expect(fs.readFileSync(originalArchive).equals(originalBytes)).toBe(true)
      expect(
        fs.readFileSync(path.join(repository, 'plugins/chrome/manifest-template.json'), 'utf8'),
      ).toBe(originalTemplate)
    },
  )

  it('reuses the exact release dependency files for protocol controls and refuses stale or linked destinations', () => {
    const root = scratch()
    fs.writeFileSync(path.join(root, 'fixture-owned'), 'packaged-plugin-gate\n')
    const source = path.join(root, 'chrome-source/plugins/chrome/node_modules/playwright-core')
    fs.mkdirSync(source, { recursive: true })
    fs.mkdirSync(path.join(root, 'repo/plugins/chrome'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'repo/plugins/chrome/package.json'),
      '{"dependencies":{"playwright-core":"1.0.0"}}',
    )
    const metadata = '{"name":"fictional-protocol","version":"1.0.0"}'
    fs.writeFileSync(path.join(source, 'package.json'), metadata)
    const target = stageProtocolDependencies(root)
    expect(fs.readFileSync(path.join(target, 'playwright-core/package.json'), 'utf8')).toBe(
      metadata,
    )
    expect(() => stageProtocolDependencies(root)).toThrow('Invalid protocol')
    fs.rmSync(target, { recursive: true })
    const outside = scratch()
    fs.symlinkSync(outside, target)
    expect(() => stageProtocolDependencies(root)).toThrow('Invalid protocol')
    expect(fs.readdirSync(outside)).toEqual([])
  })
  it('loads the verifier bundler from its locked plugin package in plain Node without NODE_PATH', () => {
    const root = scratch(),
      exported = path.join(root, 'exported'),
      app = path.join(root, 'repo/apps/desktop')
    fs.mkdirSync(app, { recursive: true })
    fs.writeFileSync(path.join(app, 'package.json'), '{"name":"fictional-app"}')
    const plugin = path.join(exported, 'plugins/chrome')
    fs.mkdirSync(path.join(plugin, 'node_modules/esbuild'), { recursive: true })
    fs.writeFileSync(
      path.join(plugin, 'package.json'),
      '{"name":"fictional-plugin","devDependencies":{"esbuild":"0.0.0"}}',
    )
    fs.writeFileSync(
      path.join(plugin, 'node_modules/esbuild/index.js'),
      'module.exports={fixture:true,build:()=>true}',
    )
    let expression = `(await import(${JSON.stringify(pathToFileURL(path.join(repository, 'scripts/gates/plugin-packaged/release.mjs')).href)})).releaseBundler(exported)`
    if (process.env.PLUGIN_GATE_EXPORT_OLD === '2c53bc18c') {
      const old = execFileSync(
        '/usr/bin/git',
        ['show', '2c53bc18c:scripts/gates/plugin-packaged/release.mjs'],
        { cwd: repository, encoding: 'utf8' },
      )
      expression = old.match(
        /const \{ build \} = (createRequire\(path\.join\(repository, 'apps\/desktop\/package\.json'\)\)\('esbuild'\))/,
      )[1]
    }
    const script = path.join(root, 'load.mjs')
    fs.writeFileSync(
      script,
      `import {createRequire} from 'node:module'; import path from 'node:path'; const repository=${JSON.stringify(path.join(root, 'repo'))}; const exported=${JSON.stringify(exported)}; try { const module=${expression}; console.log(JSON.stringify({loaded:typeof module.build==='function'&&module.fixture===true,clean:process.env.NODE_PATH===undefined})); } catch(error) {console.log(JSON.stringify({loaded:false,clean:process.env.NODE_PATH===undefined,missing:error.code==='MODULE_NOT_FOUND'}));}`,
    )
    const result = JSON.parse(
      execFileSync(process.execPath, [script], {
        env: { HOME: root, PATH: '/usr/bin:/bin' },
        cwd: root,
        encoding: 'utf8',
        timeout: 5000,
      }),
    )
    expect(result).toEqual({ loaded: true, clean: true })
  })
  it('classifies actual missing filesystem and spawn operations without retaining their paths', () => {
    const root = scratch(),
      missing = path.join(root, 'missing'),
      failures = []
    try {
      fs.readFileSync(missing)
    } catch (error) {
      failures.push(failureFor('release-export', error))
    }
    try {
      execFileSync(missing, [], { env: { HOME: root, PATH: '/usr/bin:/bin' }, timeout: 1000 })
    } catch (error) {
      failures.push(failureFor('release-export', error))
    }
    expect(failures.map((value) => value.errorClass)).toEqual(['fs-enoent', 'spawn-enoent'])
    for (const failure of failures) {
      expect(safeFailure(failure)).toBe(true)
      const lines = []
      printFailure(failure, (line) => lines.push(line))
      expect(lines.join('') + JSON.stringify(failure)).not.toContain(root)
      expect(lines.join('')).not.toMatch(/HOME|argv|path|requireStack/)
    }
  })
  it('classifies denied scratch files and executables without changing permissions to make them work', () => {
    const root = scratch(),
      file = path.join(root, 'closed'),
      failures = []
    fs.writeFileSync(file, '#!/usr/bin/false\n', { mode: 0o600 })
    try {
      execFileSync(file, [], { env: { HOME: root, PATH: '/usr/bin:/bin' }, timeout: 1000 })
    } catch (error) {
      failures.push(failureFor('release-export', error).errorClass)
    }
    expect(failures).toEqual(['spawn-eacces'])
    if (process.getuid() !== 0) {
      fs.chmodSync(file, 0)
      try {
        fs.readFileSync(file)
      } catch (error) {
        failures.push(failureFor('release-export', error).errorClass)
      } finally {
        fs.chmodSync(file, 0o600)
      }
      expect(failures).toEqual(['spawn-eacces', 'fs-eacces'])
    }
  })
})
