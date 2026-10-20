import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseRepoPluginList, loadRepoPluginList } from '../src/main/plugins/catalogue/repo-list'
import { PLUGIN_LIST_URL } from '../src/main/plugins/catalogue/download'
import {
  createPluginVerifier,
  createRepoAwarePluginVerifier,
} from '../src/main/plugins/package-verifier'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { downloadPluginArchive } from '../src/main/plugins/lifecycle/download'
import { fixture, projection, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { packageFixture, fictionalPublicKey } from './plugin-package-fixtures'
import { PluginPackageVault } from '../src/main/plugins/lifecycle/vault'
import { repoListFor } from './plugin-repo-list-fixtures'
const target = { os: 'linux', cpu: 'x64' } as const
afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
})
describe('fixed repository plugin list, no signing key', () => {
  it('parses the list, selects OS/CPU and minimum app version, and retains the display name', () => {
    const list = repoListFor(packageFixture().release)
    const input = Buffer.from(JSON.stringify(list))
    const parsed = parseRepoPluginList(input, target, '1.2.3-beta.1')
    expect(parsed.entries[0]?.name).toBe('Fictional bakery')
    expect(parsed.releases).toHaveLength(1)
    list.entries[0]!.minAppVersion = '9.0.0'
    expect(
      parseRepoPluginList(Buffer.from(JSON.stringify(list)), target, '1.2.3').releases,
    ).toHaveLength(0)
  })
  it.each([
    'https://github.com/foreign/plugin/releases/download/v1/a.tar',
    'https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue.json',
    'https://github.com/brocrew/plugin/archive/main.tar.gz',
    'https://person:madeup@github.com/brocrew/plugin/releases/download/v1/a.tar',
  ])('refuses an archive outside the brocrew release-asset policy before any download', (url) => {
    const list = repoListFor(packageFixture().release)
    list.entries[0]!.targets[0]!.url = url
    expect(() => parseRepoPluginList(Buffer.from(JSON.stringify(list)), target, '1.0.0')).toThrow()
  })
  it('repo authority pins exact admitted bytes and never weakens the dormant signed verifier', () => {
    const bytes = packageFixture().bytes
    const verifier = createRepoAwarePluginVerifier({
      pinnedPublicKey: null,
      target,
      repoCatalogueSha256: pluginSha256(bytes),
    })
    expect(verifier.verifyCatalogue(bytes, Buffer.alloc(0)).entries).toHaveLength(1)
    expect(() => verifier.verifyCatalogue(Buffer.from('{}'), Buffer.alloc(0))).toThrow()
    expect(() =>
      createPluginVerifier({ pinnedPublicKey: fictionalPublicKey, target }).verifyCatalogue(
        bytes,
        Buffer.alloc(0),
      ),
    ).toThrow()
  })
})
describe.skipIf(process.platform === 'win32')(
  'one-press repository install through the lifecycle',
  () => {
    async function setup(tampered = false) {
      const f = await fixture()
      const list = repoListFor(f.pkg.release, 'Chrome')
      const archive = Buffer.from(f.pkg.archive)
      if (tampered) archive[0] = archive[0]! ^ 1
      const fetch = vi.fn(async (url) =>
        String(url) === PLUGIN_LIST_URL
          ? new Response(JSON.stringify(list))
          : new Response(new Uint8Array(archive)),
      )
      vi.stubGlobal('fetch', fetch)
      const loaded = await loadRepoPluginList({
        root: f.root,
        target: f.opts.target,
        appVersion: '1.0.0',
      })
      const controller = await PluginLifecycleController.open({
        ...f.opts,
        pinnedPublicKey: null,
        repoCatalogueSha256: loaded.sha256,
        catalogue: { bytes: loaded.bytes, signature: Buffer.alloc(0) },
        download: downloadPluginArchive,
      })
      const handle = await controller.attach(projection().sink)
      return { f, loaded, controller, handle, fetch }
    }
    it('reads only the fixed list and installs after one call with no key, signature or extra confirmation', async () => {
      const { f, controller, handle, fetch } = await setup()
      await expect(controller.install(handle, 'chrome')).resolves.toBeUndefined()
      expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
        PLUGIN_LIST_URL,
        'https://github.com/brocrew/brocrew-plugin-chrome/releases/download/v' +
          f.pkg.release.version +
          '/fictional.tar',
      ])
      expect(f.starts()).toBe(1)
      expect(f.state.exportActivation().entries[0]?.pluginId).toBe('chrome')
      expect(f.state.inspect().pending).toBeNull()
      expect((await controller.status()).cards[0]?.state).toBe('Running')
    })
    it('an installed archive remains bound to its installation pins when list metadata changes', async () => {
      const { f, loaded } = await setup()
      const release = loaded.releases[0]!
      const vault = new PluginPackageVault(f.root, null, f.opts.target, loaded.sha256)
      await vault.stage(
        release,
        f.pkg.archive,
        { bytes: loaded.bytes, signature: Buffer.alloc(0) },
        [],
      )
      const changed = repoListFor(f.pkg.release, 'Chrome')
      changed.entries[0]!.description = 'Fictional revised description.'
      const next = parseRepoPluginList(Buffer.from(JSON.stringify(changed)), f.opts.target, '1.0.0')
      expect(next.sha256).not.toBe(loaded.sha256)
      const reopened = new PluginPackageVault(f.root, null, f.opts.target, next.sha256)
      expect((await reopened.load(release, [])).manifest.id).toBe('chrome')
      await expect(
        reopened.load({ ...release, manifestSha256: '0'.repeat(64) }, []),
      ).rejects.toThrow()
    })
    it('a wrong archive hash never starts a run and leaves no active or half-finished install', async () => {
      const { f, controller, handle } = await setup(true)
      await expect(controller.install(handle, 'chrome')).rejects.toThrow(
        'Plugin unavailable. Try again.',
      )
      expect(f.starts()).toBe(0)
      expect(f.state.exportActivation().entries).toHaveLength(0)
      expect(f.state.inspect().pending).toBeNull()
    })
  },
)
