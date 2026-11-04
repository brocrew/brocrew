import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { packageFixture, fictionalPublicKey, signed } from './plugin-package-fixtures'
import { loadPluginCatalogue } from '../src/main/plugins/catalogue/loader'
import { pluginPersonCapability } from '../src/main/plugins/catalogue/capability'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const publicKey = fictionalPublicKey.export({ format: 'der', type: 'spki' }).toString('base64')
const target = { os: 'linux', cpu: 'x64' } as const
async function fixture() {
  const parent = await realpath(await mkdtemp('/tmp/fictional-plugin-catalogue-'))
  roots.push(parent)
  const root = join(parent, 'global')
  await mkdir(root, { mode: 0o700 })
  const pkg = packageFixture()
  const fetch = vi.fn(async (url: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    void init
    return new Response(
      String(url).endsWith('.sig') ? new Uint8Array(pkg.signature) : new Uint8Array(pkg.bytes),
    )
  })
  const options = {
    root,
    publicKey,
    target,
    sources: [
      {
        kind: 'https' as const,
        baseUrl: 'https://github.com/brocrew/brocrew/releases/download/fictional-v1/',
      },
    ],
    fetch: fetch as typeof globalThis.fetch,
  }
  return { root, pkg, fetch, options }
}
describe.skipIf(process.platform === 'win32')(
  'verified catalogue loader and private person capability',
  () => {
    it('no pinned key means no fetch or filesystem access, even with an invalid root', async () => {
      const fetch = vi.fn()
      await expect(
        loadPluginCatalogue({
          root: '/nonexistent/fictional',
          publicKey: '',
          target,
          sources: [],
          fetch,
        }),
      ).resolves.toBeNull()
      expect(fetch).not.toHaveBeenCalled()
    })
    it('verifies exact bytes, publishes the pair atomically and reverifies offline cache', async () => {
      const f = await fixture()
      const loaded = await loadPluginCatalogue(f.options)
      expect(loaded?.entries[0]?.id).toBe('fictional-bakery')
      expect(await readFile(loaded!.catalogue)).toEqual(f.pkg.bytes)
      expect(await readFile(loaded!.signature)).toEqual(f.pkg.signature)
      f.fetch.mockRejectedValue(new Error('fictional offline'))
      const cached = await loadPluginCatalogue(f.options)
      expect(cached?.catalogue).toBe(loaded?.catalogue)
    })
    it('refuses fetched tampering, preserving rather than silently substituting the verified cache', async () => {
      const f = await fixture()
      const prior = await loadPluginCatalogue(f.options)
      f.fetch.mockImplementation(
        async (url) =>
          new Response(String(url).endsWith('.sig') ? new Uint8Array(f.pkg.signature) : '{}'),
      )
      await expect(loadPluginCatalogue(f.options)).rejects.toThrow('Plugin unavailable. Try again.')
      f.fetch.mockRejectedValue(new Error('fictional offline'))
      expect((await loadPluginCatalogue(f.options))?.catalogue).toBe(prior?.catalogue)
    })
    it('refuses corrupt cache and never resets it from the network', async () => {
      const f = await fixture()
      const prior = await loadPluginCatalogue(f.options)
      await chmod(prior!.catalogue, 0o600)
      await writeFile(prior!.catalogue, Buffer.from('{}'))
      f.fetch.mockClear()
      await expect(loadPluginCatalogue(f.options)).rejects.toThrow()
      expect(f.fetch).not.toHaveBeenCalled()
    })
    it('publishes and reverifies exact catalogue bytes through an ordinary cache directory alias', async () => {
      const f = await fixture()
      await mkdir(join(f.root, 'foreign'), { mode: 0o700 })
      await symlink(join(f.root, 'foreign'), join(f.root, 'catalogue-cache'))
      const loaded = await loadPluginCatalogue(f.options)
      expect(loaded?.entries[0]?.id).toBe('fictional-bakery')
      expect(await readFile(loaded!.catalogue)).toEqual(f.pkg.bytes)
      expect(await readFile(loaded!.signature)).toEqual(f.pkg.signature)
      expect(await realpath(loaded!.catalogue)).toBe(
        loaded!.catalogue.replace('/catalogue-cache/', '/foreign/'),
      )
      expect(f.fetch).toHaveBeenCalledTimes(2)
      f.fetch.mockRejectedValue(new Error('fictional offline'))
      expect((await loadPluginCatalogue(f.options))?.bytes).toEqual(f.pkg.bytes)
      expect(await readlink(join(f.root, 'catalogue-cache'))).toBe(join(f.root, 'foreign'))
    })
    it('delegates HTTP and credential-bearing source handling to normal transport', async () => {
      const f = await fixture()
      for (const baseUrl of [
        'http://fictional.invalid/',
        'https://name:secret@fictional.invalid/',
      ]) {
        f.fetch.mockClear()
        const loaded = await loadPluginCatalogue({
          ...f.options,
          sources: [{ kind: 'https', baseUrl }],
        })
        expect(loaded?.bytes).toEqual(f.pkg.bytes)
        expect(loaded?.signatureBytes).toEqual(f.pkg.signature)
        expect(f.fetch.mock.calls.map(([url]) => String(url))).toEqual([
          new URL('catalogue.json', baseUrl).href,
          new URL('catalogue.sig', baseUrl).href,
        ])
        expect(f.fetch.mock.calls.every(([, init]) => init?.redirect === undefined)).toBe(true)
      }
    })
    it('refuses empty signed catalogues and changed pins for an already cached release', async () => {
      const f = await fixture()
      await loadPluginCatalogue(f.options)
      const value = JSON.parse(f.pkg.bytes.toString())
      value.entries[0].archive.sha256 = 'f'.repeat(64)
      for (const one of [signed({ format: 1, entries: [] }), signed(value)]) {
        f.fetch.mockImplementation(
          async (url) =>
            new Response(new Uint8Array(String(url).endsWith('.sig') ? one.signature : one.bytes)),
        )
        await expect(loadPluginCatalogue(f.options)).rejects.toThrow()
      }
    })
    it('reports ordinary HTTP and malformed archive response failures', async () => {
      const f = await fixture()
      for (const response of [
        new Response('', { status: 302, headers: { location: 'https://foreign.invalid/' } }),
        new Response('x', { headers: { 'content-length': '99999999' } }),
        new Response(new Uint8Array(1024 * 1024 + 1)),
      ]) {
        const body = await response.arrayBuffer()
        f.fetch.mockImplementation(
          async () => new Response(body, { status: response.status, headers: response.headers }),
        )
        await expect(loadPluginCatalogue(f.options)).rejects.toThrow()
      }
      expect(f.fetch.mock.calls.every(([, init]) => init?.redirect === undefined)).toBe(true)
    })
    it('concurrent app copies share one capability through ordinary file aliases and report malformed material', async () => {
      const f = await fixture()
      const values = await Promise.all(
        Array.from({ length: 4 }, () => pluginPersonCapability(f.root)),
      )
      expect(new Set(values).size).toBe(1)
      expect(values[0]).toMatch(/^[a-f0-9]{64}$/)
      expect(await pluginPersonCapability(f.root)).toBe(values[0])
      const { readdir } = await import('node:fs/promises')
      const kept = (await readdir(join(f.root, 'capabilities'))).find((n) =>
        /^[a-f0-9]{64}$/.test(n),
      )!
      const path = join(f.root, 'capabilities', kept, 'person')
      await rm(path)
      await writeFile(join(f.root, 'decoy'), values[0]!, { mode: 0o400 })
      await symlink(join(f.root, 'decoy'), path)
      expect(await pluginPersonCapability(f.root)).toBe(values[0])
      expect(await readlink(path)).toBe(join(f.root, 'decoy'))
      await chmod(join(f.root, 'decoy'), 0o600)
      await writeFile(join(f.root, 'decoy'), 'fictional malformed material')
      await expect(pluginPersonCapability(f.root)).rejects.toThrow()
      expect(await readFile(join(f.root, 'decoy'), 'utf8')).toBe('fictional malformed material')
      expect(await readlink(path)).toBe(join(f.root, 'decoy'))
    })
  },
)
