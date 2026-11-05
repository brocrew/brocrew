import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { failureFor, printFailure, safeFailure } from '../gates/plugin-packaged/diagnostics.mjs'
import { stageProtocolDependencies } from '../gates/plugin-packaged/prepare.mjs'
import { digest } from '../gates/plugin-packaged/contract.mjs'
import { stageRelease } from '../gates/plugin-packaged/journey.mjs'
import {
  listFor,
  releaseSourcePlan,
  stageReleaseDependencies,
  cachePreparationSource,
} from '../gates/plugin-packaged/release.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const desktopRequire = createRequire(path.join(repository, 'apps/desktop/package.json'))
const { build } = createRequire(desktopRequire.resolve('electron-vite/package.json'))('esbuild')
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
// A real unsigned format3 tar, containing inert bytes only. No source, signing or runtime stand-in.
function candidateFixture(root) {
  fs.chmodSync(root, 0o700)
  fs.writeFileSync(path.join(root, 'fixture-owned'), 'packaged-plugin-gate\n', { mode: 0o600 })
  const files = new Map([
    ['server.mjs', Buffer.from('export const fictional = true\n')],
    ['tools.json', Buffer.from('[]')],
  ])
  const manifest = {
    format: 3,
    id: 'chrome',
    name: 'Fictional Chrome candidate',
    description: 'Inert cache verification',
    permissions: { description: 'Fictional inert bytes only' },
    authors: ['fictional'],
    version: '1.0.0',
    platforms: [{ os: 'darwin', cpu: 'arm64' }],
    sourceCommit: 'a'.repeat(40),
    runtime: { kind: 'node', entry: 'server.mjs' },
    mcp: { transport: 'stdio' },
    tools: { source: 'mcp', inventory: 'tools.json' },
    files: [...files].map(([name, body]) => ({
      path: name,
      bytes: body.length,
      sha256: digest(body),
    })),
    data: { schema: 1 },
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  files.set('plugin.json', manifestBytes)
  const blocks = []
  for (const [name, body] of files) {
    const header = Buffer.alloc(512)
    header.write(name, 0, 100)
    header.write('0000600\0', 100)
    header.write('0000000\0', 108)
    header.write('0000000\0', 116)
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124)
    header.write('00000000000\0', 136)
    header.fill(32, 148, 156)
    header[156] = 48
    header.write('ustar\0', 257)
    header.write('00', 263)
    header.write(
      [...header]
        .reduce((a, b) => a + b, 0)
        .toString(8)
        .padStart(6, '0') + '\0 ',
      148,
    )
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  const archive = gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
  const entry = {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    authors: manifest.authors,
    version: manifest.version,
    sourceCommit: manifest.sourceCommit,
    targets: [
      {
        os: 'darwin',
        cpu: 'arm64',
        url: 'https://github.com/brocrew/brocrew-plugin-chrome/releases/download/v1/chrome.tar.gz',
        sha256: digest(archive),
        bytes: archive.length,
        compression: 'tar.gz',
        manifestSha256: digest(manifestBytes),
      },
    ],
  }
  fs.mkdirSync(path.join(root, 'release'), { mode: 0o700 })
  fs.mkdirSync(path.join(root, 'a'), { mode: 0o700 })
  fs.mkdirSync(path.join(root, 'g'), { mode: 0o700 })
  fs.mkdirSync(path.join(root, 'proof'), { mode: 0o700 })
  fs.writeFileSync(path.join(root, 'release/catalogue.json'), JSON.stringify(listFor(entry)), {
    mode: 0o600,
  })
  fs.writeFileSync(path.join(root, 'release/chrome-darwin-arm64.tar.gz'), archive, { mode: 0o600 })
  return { archive, entry, manifest }
}

describe.skipIf(process.platform === 'win32')('release verifier module admission', () => {
  it('uses the real verifier and vault for alternate-source cache bytes, with no installed/run/profile effects or fetch', async () => {
    for (const tamper of [false, true]) {
      const root = scratch(),
        original = candidateFixture(root)
      stageRelease(root, path.join(root, 'a'), 'alternate')
      const cachedArchive = path.join(
        root,
        'a/repo-fixture/archives',
        digest(original.archive) + '.tar.gz',
      )
      if (tamper) {
        const bytes = fs.readFileSync(cachedArchive)
        bytes[bytes.length - 1] ^= 1
        fs.writeFileSync(cachedArchive, bytes)
      }
      const out = path.join(root, 'proof/cache.cjs')
      await build({
        stdin: { contents: cachePreparationSource(root), resolveDir: repository, loader: 'ts' },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: out,
        logLevel: 'silent',
      })
      const helper = createRequire(import.meta.url)(out)
      const previous = globalThis.fetch
      let fetched = 0
      globalThis.fetch = async () => {
        fetched++
        throw new Error('Unexpected network attempt')
      }
      try {
        if (tamper) {
          await expect(helper.prepareCandidateCache()).rejects.toMatchObject({ code: 'digest' })
          expect(fs.readdirSync(path.join(root, 'g'))).toEqual([])
          expect(fs.existsSync(path.join(root, 'proof/candidate-cache.json'))).toBe(false)
        } else {
          await helper.prepareCandidateCache()
          const proof = JSON.parse(fs.readFileSync(path.join(root, 'proof/candidate-cache.json')))
          expect(proof.manifest).toEqual(original.manifest)
          expect(proof.ref).toEqual({
            source: 'https://example.invalid/alternate-chrome.tar.gz',
            sha256: digest(original.archive),
            bytes: original.archive.length,
          })
          expect(proof.cacheVerified).toBe(true)
          expect(proof.pristine).toBe(true)
          expect(fs.readdirSync(path.join(root, 'g'))).toEqual(['package-vault'])
        }
        expect(fetched).toBe(0)
        for (const name of ['state', 'host', 'profile-apply'])
          expect(fs.existsSync(path.join(root, 'g', name))).toBe(false)
      } finally {
        globalThis.fetch = previous
      }
    }
  })
  it('preserves the complete author-bearing producer row in a format3 catalogue', () => {
    const entry = {
      id: 'fictional-plugin',
      authors: [{ name: 'Fictional author', url: 'https://example.invalid/author' }],
      version: '1.2.3',
      sourceCommit: 'a'.repeat(40),
      targets: [{ os: 'darwin', cpu: 'arm64', sha256: 'b'.repeat(64), bytes: 17 }],
      manifestSha256: 'c'.repeat(64),
    }
    expect(listFor(entry)).toEqual({ format: 3, entries: [entry] })
    expect(listFor(entry).entries[0]).toBe(entry)
  })
  it('plans the current producer and generated tests only after an actual canonical HTTPS origin', () => {
    const root = scratch(),
      node = path.join(root, 'node22/bin/node'),
      commit = 'a'.repeat(40)
    for (const origin of [
      'git@github-jidma:brocrew/brocrew.git',
      'git@github.com:brocrew/brocrew.git',
      repository,
      'https://example.invalid/brocrew/brocrew.git',
      'https://github.com/brocrew/brocrew.git/extra',
      '',
    ])
      expect(() => releaseSourcePlan(root, node, commit, origin)).toThrow('canonical HTTPS origin')
    for (const origin of [
      'https://github.com/brocrew/brocrew.git',
      'https://github.com/brocrew/brocrew',
    ]) {
      const plan = releaseSourcePlan(root, node, commit, origin)
      expect(plan.origin).toBe(origin)
      expect(plan.build).toEqual({
        program: node,
        args: ['scripts/build-plugin-release.mjs', 'chrome', path.join(root, 'release')],
        cwd: path.join(root, 'release-checkout'),
        env: {
          PATH: `${path.dirname(node)}:/usr/bin:/bin`,
          BROCREW_MONOREPO_ROOT: path.join(root, 'release-checkout'),
          BROCREW_PLUGIN_SOURCE_COMMIT: commit,
        },
      })
      expect(plan.tests.args).toEqual([
        'node_modules/vitest/vitest.mjs',
        'run',
        '--config',
        'vitest.release.config.mts',
      ])
      expect(plan.tests.cwd).toBe(path.join(root, 'chrome-source'))
      expect(plan.tests.env.BROCREW_PLUGIN_SOURCE_COMMIT).toBe(commit)
      expect(plan.tests.env.BROCREW_CHROME_TEST_ARTIFACT).toBe(path.join(root, 'release'))
      expect(JSON.stringify(plan)).not.toContain('scripts/release.mjs')
    }
    expect(() =>
      releaseSourcePlan(root, node, 'short', 'https://github.com/brocrew/brocrew.git'),
    ).toThrow('commit')
    // The unmodified production CLI remains the authority for missing, extra, changed or linked inputs.
    const producer = fs.readFileSync(
      path.join(repository, 'scripts/build-plugin-release.mjs'),
      'utf8',
    )
    expect(producer.match(/verifyPluginSource\(options\)/g)).toHaveLength(2)
    const verifier = fs.readFileSync(path.join(repository, 'scripts/plugin-source.mjs'), 'utf8')
    expect(verifier).toContain('The exported plugin file set differs from the canonical tree')
    expect(verifier).toContain('The exported plugin bytes differ from the canonical tree')
    const exporter = fs.readFileSync(
      path.join(repository, 'scripts/export-chrome-plugin.mjs'),
      'utf8',
    )
    expect(exporter).toContain('vitest.release.config.mts')
    expect(exporter).toContain('release-test/*.test.ts')
    expect(exporter).toContain('plugins/chrome/test/archive.test.ts')
  })
  it('copies the locked export install into the producer checkout without changing plugin source', () => {
    for (const mismatch of [false, true]) {
      const root = scratch(),
        exported = path.join(root, 'exported'),
        checkout = path.join(root, 'checkout')
      const plugin = path.join(checkout, 'plugins/chrome')
      fs.mkdirSync(plugin, { recursive: true })
      const declared = {
        dependencies: { 'playwright-core': '1.0.0' },
        devDependencies: { esbuild: '2.0.0' },
      }
      const bytes = JSON.stringify(declared)
      fs.writeFileSync(path.join(plugin, 'package.json'), bytes)
      fs.writeFileSync(path.join(plugin, 'source.ts'), 'export const fictional = true\n')
      const metadata = path.join(exported, 'plugins/chrome/node_modules')
      for (const [name, version] of Object.entries({
        ...declared.dependencies,
        ...declared.devDependencies,
      })) {
        const folder = path.join(metadata, name)
        fs.mkdirSync(folder, { recursive: true })
        fs.writeFileSync(
          path.join(folder, 'package.json'),
          JSON.stringify({
            name,
            version: mismatch && name === 'playwright-core' ? '9.0.0' : version,
            main: 'index.js',
          }),
        )
        fs.writeFileSync(path.join(folder, 'index.js'), 'module.exports = {}\n')
      }
      if (mismatch)
        expect(() => stageReleaseDependencies(exported, checkout)).toThrow('pin differs')
      else {
        stageReleaseDependencies(exported, checkout)
        for (const name of ['esbuild', 'playwright-core'])
          expect(fs.readFileSync(path.join(plugin, 'node_modules', name, 'index.js'), 'utf8')).toBe(
            'module.exports = {}\n',
          )
        expect(() => stageReleaseDependencies(exported, checkout)).toThrow(
          'Invalid release dependency staging',
        )
      }
      expect(fs.readFileSync(path.join(plugin, 'package.json'), 'utf8')).toBe(bytes)
      expect(fs.readFileSync(path.join(plugin, 'source.ts'), 'utf8')).toBe(
        'export const fictional = true\n',
      )
    }
  })
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
