import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { loadPluginCatalogue } from '../src/main/plugins/catalogue/loader'
import { localPluginArchive } from '../src/main/plugins/catalogue/local'
import { downloadPluginBytes } from '../src/main/plugins/catalogue/download'
import { packageFixture, fictionalPublicKey, signed } from './plugin-package-fixtures'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.unstubAllGlobals()
})
const key = fictionalPublicKey.export({ format: 'der', type: 'spki' }).toString('base64')
const initial = 'https://github.com/brocrew/brocrew/releases/download/fictional-v1/'
describe('ordinary package transport', () => {
  it.each([
    'http://localhost:4567/fictional-package',
    'https://fictional.invalid:8443/package',
    'https://fictional.invalid/package?release=selected',
    'https://objects.githubusercontent.com/fictional-package',
  ])('passes the selected source to normal fetch: %s', async (url) => {
    const fetch = vi.fn(
      async () => new Response('abc', { headers: { 'content-encoding': 'gzip' } }),
    )
    expect(
      (await downloadPluginBytes({ url, maximum: Number.MAX_SAFE_INTEGER, fetch })).toString(),
    ).toBe('abc')
    expect(fetch).toHaveBeenCalledWith(url, { signal: undefined })
  })
  it('reports HTTP, transport, and declared byte failures', async () => {
    for (const response of [new Response('missing', { status: 404 }), new Response('abcd')]) {
      const fetch = vi.fn(async () => response)
      await expect(
        downloadPluginBytes({ url: 'http://localhost/fictional', maximum: 100, size: 3, fetch }),
      ).rejects.toThrow()
    }
    const fetch = vi.fn(async () => {
      throw new TypeError('fictional unsupported source')
    })
    await expect(
      downloadPluginBytes({ url: 'fictional:unsupported', maximum: 100, fetch }),
    ).rejects.toThrow('Could not download')
    expect(fetch).toHaveBeenCalledOnce()
  })
})
describe.skipIf(process.platform === 'win32')('reviewed local release adapter', () => {
  async function fixture() {
    const parent = await realpath(await mkdtemp('/tmp/fictional-local-release-'))
    roots.push(parent)
    const root = join(parent, 'global'),
      directory = join(parent, 'input')
    await mkdir(root, { mode: 0o700 })
    await mkdir(directory, { mode: 0o700 })
    await mkdir(join(directory, 'archives'), { mode: 0o700 })
    const pkg = packageFixture()
    await writeFile(join(directory, 'catalogue.json'), pkg.bytes, { mode: 0o600 })
    await writeFile(join(directory, 'catalogue.sig'), pkg.signature, { mode: 0o600 })
    await writeFile(join(directory, 'archives', pkg.release.archive.sha256 + '.tar'), pkg.archive, {
      mode: 0o600,
    })
    const fetch = vi.fn()
    return {
      parent,
      root,
      directory,
      pkg,
      fetch,
      options: {
        root,
        publicKey: key,
        target: { os: 'linux', cpu: 'x64' } as const,
        sources: [{ kind: 'local' as const, directory }],
        localEnabled: true,
        fetch,
      },
    }
  }
  it('verifies local signed bytes and resolves archive by digest without fetching its signed HTTPS URL', async () => {
    const f = await fixture()
    vi.stubGlobal('fetch', f.fetch)
    expect((await loadPluginCatalogue(f.options))?.source).toEqual({
      kind: 'local',
      directory: f.directory,
    })
    expect(await localPluginArchive(f.directory, f.pkg.release)).toEqual(f.pkg.archive)
    expect(f.fetch).not.toHaveBeenCalled()
  })
  it('is off in public builds and never falls back to HTTPS or cache when inputs disappear', async () => {
    const f = await fixture()
    await expect(loadPluginCatalogue({ ...f.options, localEnabled: false })).rejects.toThrow()
    await loadPluginCatalogue(f.options)
    await unlink(join(f.directory, 'catalogue.sig'))
    await expect(loadPluginCatalogue(f.options)).rejects.toThrow()
    expect(f.fetch).not.toHaveBeenCalled()
    await expect(
      loadPluginCatalogue({
        ...f.options,
        sources: [...f.options.sources, { kind: 'https', baseUrl: initial }],
      }),
    ).rejects.toThrow()
  })
  it('refuses linked folders/files, changed archive bytes and oversized snapshots', async () => {
    const f = await fixture()
    const file = join(f.directory, 'archives', f.pkg.release.archive.sha256 + '.tar')
    await unlink(file)
    await symlink(join(f.directory, 'catalogue.json'), file)
    await expect(localPluginArchive(f.directory, f.pkg.release)).rejects.toThrow()
    await unlink(file)
    await writeFile(file, Buffer.alloc(f.pkg.archive.length + 1), { mode: 0o600 })
    await expect(localPluginArchive(f.directory, f.pkg.release)).rejects.toThrow()
    const alias = join(f.parent, 'alias')
    await symlink(f.directory, alias)
    await expect(
      loadPluginCatalogue({ ...f.options, sources: [{ kind: 'local', directory: alias }] }),
    ).rejects.toThrow()
  })
  it('keeps immutable release pins even when a later signed catalogue omits that release', async () => {
    const f = await fixture()
    await loadPluginCatalogue(f.options)
    const different = { ...f.pkg.release, id: 'fictional-oven' }
    const pair = signed({ format: 1, entries: [different] })
    await writeFile(join(f.directory, 'catalogue.json'), pair.bytes)
    await writeFile(join(f.directory, 'catalogue.sig'), pair.signature)
    await loadPluginCatalogue(f.options)
    const changed = signed({
      format: 1,
      entries: [
        { ...f.pkg.release, archive: { ...f.pkg.release.archive, sha256: 'f'.repeat(64) } },
      ],
    })
    await writeFile(join(f.directory, 'catalogue.json'), changed.bytes)
    await writeFile(join(f.directory, 'catalogue.sig'), changed.signature)
    await expect(loadPluginCatalogue(f.options)).rejects.toThrow()
  })
})
