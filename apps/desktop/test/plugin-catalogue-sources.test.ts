import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { loadPluginCatalogue } from '../src/main/plugins/catalogue/loader'
import { localPluginArchive } from '../src/main/plugins/catalogue/local'
import { downloadPluginBytes, PLUGIN_LIST_URL } from '../src/main/plugins/catalogue/download'
import { packageFixture, fictionalPublicKey, signed } from './plugin-package-fixtures'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.unstubAllGlobals()
})
const key = fictionalPublicKey.export({ format: 'der', type: 'spki' }).toString('base64')
const initial = 'https://github.com/brocrew/brocrew/releases/download/fictional-v1/'
describe('bounded GitHub transport', () => {
  it.each(['release-assets.githubusercontent.com', 'objects.githubusercontent.com'])(
    'follows a brocrew release redirect to %s without credentials',
    async (host) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('', {
            status: 302,
            headers: { location: `https://${host}/fictional?id=public` },
          }),
        )
        .mockResolvedValueOnce(new Response('abc', { headers: { 'content-length': '3' } }))
      expect(
        (await downloadPluginBytes({ url: initial + 'archive.tar', maximum: 3, fetch })).toString(),
      ).toBe('abc')
      expect(fetch).toHaveBeenCalledTimes(2)
      for (const [, init] of fetch.mock.calls)
        expect(init).toMatchObject({
          redirect: 'manual',
          credentials: 'omit',
          headers: { 'Accept-Encoding': 'identity' },
        })
    },
  )
  it.each([
    'http://github.com/brocrew/brocrew/releases/download/a/x',
    'https://github.com:444/brocrew/brocrew/releases/download/a/x',
    'https://name:secret@github.com/brocrew/brocrew/releases/download/a/x',
    'https://github.com.evil.invalid/brocrew/brocrew/releases/download/a/x',
    'https://release-assets.githubusercontent.com/initial',
    'https://objects.githubusercontent.com/initial',
    'https://github.com/foreign/brocrew/releases/download/a/x',
  ])('refuses an unapproved initial URL before fetch', async (url) => {
    const fetch = vi.fn()
    await expect(downloadPluginBytes({ url, maximum: 3, fetch })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([
    'http://release-assets.githubusercontent.com/x',
    'https://foreign.invalid/x',
    'https://name:secret@release-assets.githubusercontent.com/x',
    'https://release-assets.githubusercontent.com:444/x',
    'https://release-assets.githubusercontent.com/x#fragment',
    'https://unknown.release-assets.githubusercontent.com/x',
    'https://unknown.objects.githubusercontent.com/x',
    PLUGIN_LIST_URL,
  ])('refuses a bad redirect before sending the next request', async (location) => {
    const fetch = vi.fn(async () => new Response('', { status: 302, headers: { location } }))
    await expect(downloadPluginBytes({ url: initial + 'x', maximum: 3, fetch })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledOnce()
  })
  it.each([
    'https://release-assets.githubusercontent.com/fictional',
    'https://objects.githubusercontent.com/fictional',
    initial + 'archive.tar',
    'https://raw.githubusercontent.com/brocrew/brocrew/main/other.json',
  ])('refuses a list redirect to %s before sending the next request', async (location) => {
    const fetch = vi.fn(async () => new Response('', { status: 302, headers: { location } }))
    await expect(downloadPluginBytes({ url: PLUGIN_LIST_URL, maximum: 3, fetch })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('refuses an asset hop back to a non-brocrew GitHub release', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', {
          status: 302,
          headers: { location: 'https://objects.githubusercontent.com/fictional' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('', {
          status: 302,
          headers: { location: 'https://github.com/foreign/fictional/releases/download/v1/x' },
        }),
      )
    await expect(downloadPluginBytes({ url: initial + 'x', maximum: 3, fetch })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('accepts exactly three release-chain hops', async () => {
    const fetch = vi.fn()
    for (const location of [
      'https://release-assets.githubusercontent.com/fictional',
      'https://objects.githubusercontent.com/fictional',
      initial + 'final.tar',
    ])
      fetch.mockResolvedValueOnce(new Response('', { status: 302, headers: { location } }))
    fetch.mockResolvedValueOnce(new Response('abc'))
    expect((await downloadPluginBytes({ url: initial + 'x', maximum: 3, fetch })).toString()).toBe(
      'abc',
    )
    expect(fetch).toHaveBeenCalledTimes(4)
  })
  it('refuses a fourth redirect and applies one deadline to a stalled body', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('', {
          status: 302,
          headers: { location: 'https://release-assets.githubusercontent.com/next' },
        }),
    )
    await expect(downloadPluginBytes({ url: initial + 'x', maximum: 3, fetch })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(4)
    const stalled = vi.fn(async () => new Response(new ReadableStream({ start() {}, cancel() {} })))
    await expect(
      downloadPluginBytes({ url: initial + 'x', maximum: 3, milliseconds: 20, fetch: stalled }),
    ).rejects.toThrow()
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
