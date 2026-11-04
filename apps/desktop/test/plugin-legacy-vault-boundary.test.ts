import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PluginPackageVault } from './legacy-plugin-vault'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import {
  fictionalPublicKey,
  manifestFor,
  packageFixture,
  signed,
  tar,
} from './plugin-package-fixtures'

const roots: string[] = []
const target = { os: 'linux', cpu: 'x64' } as const
async function fixtureRoot() {
  const root = await mkdtemp(
    join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-legacy-vault-'),
  )
  roots.push(root)
  await mkdir(join(root, 'package-vault'), { mode: 0o700 })
  await writeFile(join(root, 'opaque-pairing'), 'fictional opaque pairing bytes', { mode: 0o600 })
  return root
}
async function snapshot(root: string): Promise<{ path: string; bytes?: string }[]> {
  const result: { path: string; bytes?: string }[] = []
  async function visit(path: string) {
    const entries = await readdir(join(root, path), { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path ? path + '/' + entry.name : entry.name
      if (entry.isDirectory()) {
        result.push({ path: child + '/' })
        await visit(child)
      } else
        result.push({ path: child, bytes: (await readFile(join(root, child))).toString('hex') })
    }
  }
  await visit('')
  return result
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it('refuses format 3 before publishing any historical vault cache', async () => {
  const root = await fixtureRoot()
  const files = new Map([
    ['main.cjs', Buffer.from('// Inert fictional runtime.')],
    ['tools.json', Buffer.from('{"tools":[]}')],
  ])
  const manifestBytes = Buffer.from(
    JSON.stringify({
      format: 3,
      id: 'fictional-mill',
      version: '1.0.0',
      name: 'Fictional mill',
      description: 'Count fictional grain.',
      authors: ['fictional-baker'],
      platforms: [target],
      permissions: { description: 'Read fictional grain.' },
      files: [...files].map(([path, bytes]) => ({
        path,
        bytes: bytes.length,
        sha256: pluginSha256(bytes),
      })),
      runtime: { kind: 'node', entry: 'main.cjs' },
      mcp: { transport: 'stdio' },
      tools: { source: 'mcp', inventory: 'tools.json' },
      lifecycle: { stop: { signal: 'SIGTERM' }, dataOnRemove: 'keep' },
      data: { schema: 1 },
    }),
  )
  const archive = tar([
    { path: 'plugin.json', body: manifestBytes },
    ...[...files].map(([path, body]) => ({ path, body })),
  ])
  const release = {
    id: 'fictional-mill',
    version: '1.0.0',
    authors: ['fictional-baker'],
    sourceCommit: 'a'.repeat(40),
    platforms: [target],
    archive: {
      url: 'https://plugins.example.invalid/mill.tar',
      size: archive.length,
      sha256: pluginSha256(archive),
      compression: 'tar' as const,
    },
    manifestSha256: pluginSha256(manifestBytes),
  }
  const catalogue = signed({ format: 2, entries: [release] })
  const before = await snapshot(root)
  const vault = new PluginPackageVault(root, fictionalPublicKey, target)
  await expect(vault.stage(release, archive, catalogue, [])).rejects.toThrow(
    'Historical fixture expects format 1 or 2',
  )
  expect(await snapshot(root)).toEqual(before)
  expect(await readdir(join(root, 'package-vault'))).toEqual([])
})

it.each([1, 2])(
  'keeps format %i manifest and payload bytes through stage and load',
  async (format) => {
    const root = await fixtureRoot()
    const manifest = manifestFor()
    if (format === 2)
      Object.assign(manifest, {
        format: 2,
        authors: ['fictional-baker'],
        executor: { kind: 'node', entry: 'dist/recipe.mjs' },
        hooks: [],
      })
    const f = packageFixture({ manifest })
    const vault = new PluginPackageVault(root, fictionalPublicKey, target)
    const staged = await vault.stage(f.release, f.archive, f, [])
    const loaded = await vault.load(f.release, [])
    for (const pkg of [staged, loaded]) {
      expect(pkg.manifest).toEqual(f.manifest)
      expect(pkg.readFile('plugin.json')).toEqual(Uint8Array.from(f.manifestBytes))
      for (const [path, bytes] of f.files)
        expect(pkg.readFile(path)).toEqual(Uint8Array.from(bytes))
    }
    expect(await readFile(join(root, 'opaque-pairing'), 'utf8')).toBe(
      'fictional opaque pairing bytes',
    )
  },
)

it('preserves a legacy digest failure without publishing a cache', async () => {
  const root = await fixtureRoot()
  const f = packageFixture()
  const corrupt = Buffer.from(f.archive)
  corrupt[512] = corrupt[512]! ^ 1
  const before = await snapshot(root)
  const vault = new PluginPackageVault(root, fictionalPublicKey, target)
  await expect(vault.stage(f.release, corrupt, f, [])).rejects.toMatchObject({ code: 'digest' })
  expect(await snapshot(root)).toEqual(before)
})
