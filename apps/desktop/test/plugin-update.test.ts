import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  fixture,
  cleanupLifecycleFixtures,
  reopenLifecycleFixture,
  projection,
} from './plugin-lifecycle-fixtures'
import { packageFixture } from './plugin-package-fixtures'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { newerPluginVersion } from '../src/main/plugins/catalogue/newer-version'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import { LifecycleEffects } from '../src/main/plugins/lifecycle/files'
import { PluginProfileLedger } from '../src/main/plugins/lifecycle/profile-ledger'

afterEach(async () => {
  await cleanupLifecycleFixtures()
  vi.unstubAllGlobals()
})
async function setup(repo = false) {
  const f = await fixture({}, false, 'whatsapp')
  const old = packageFixture({ manifest: { ...f.pkg.manifest, version: '0.1.0' } })
  const next = packageFixture({ manifest: { ...f.pkg.manifest, version: '0.1.3' } })
  let offered = old
  const catalogueFor = (pkg: typeof old) => ({
    bytes: pkg.bytes,
    signature: repo ? Buffer.alloc(0) : pkg.signature,
  })
  f.opts.catalogue = catalogueFor(old)
  if (repo) {
    f.opts.pinnedPublicKey = null
    f.opts.repoCatalogueSha256 = pluginSha256(old.bytes)
  }
  const controller = repo ? await PluginLifecycleController.open(f.opts) : f.controller
  const local = repo ? projection(f.events) : f.local
  const handle = repo ? await controller.attach(local.sink) : f.handle
  f.opts.download = async (release) =>
    release.version === old.release.version ? old.archive : next.archive
  f.opts.refreshCatalogue = async () => ({
    catalogue: catalogueFor(offered),
    repoCatalogueSha256: repo ? pluginSha256(offered.bytes) : undefined,
    names: f.opts.names,
  })
  await controller.install(handle, 'whatsapp')
  const data = join(f.root, 'data', 'whatsapp')
  await mkdir(data, { recursive: true })
  await writeFile(join(data, 'login'), 'fictional-paired-phone')
  await writeFile(join(data, 'settings'), '{"fictionalGroup":true}')
  f.opts.runtime.removeData = async () => {
    throw new Error('Update must never delete data')
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Update must never log out')
    }),
  )
  return {
    ...f,
    controller,
    handle,
    local,
    old,
    next,
    data,
    offer: async () => {
      offered = next
      await controller.refreshCatalogue(pluginSha256(next.bytes))
    },
  }
}
describe.skipIf(process.platform === 'win32')(
  'journaled plugin update with fictional data and inert runs',
  () => {
    it('keeps the login, settings, installation and other workspace; stops before starting the verified replacement', async () => {
      const f = await setup()
      const before = f.state.exportActivation().entries[0]!
      const ledger = new PluginProfileLedger(f.root)
      const revision = await ledger.reserve(before.installId, 0, {
        action: 'set-read',
        enabled: true,
      })
      const other = projection(f.events)
      await f.controller.attach(other.sink)
      await f.offer()
      expect((await f.controller.status()).cards[0]).toMatchObject({
        installedVersion: '0.1.0',
        updateVersion: '0.1.3',
        uninstallDeletesData: true,
      })
      f.events.length = 0
      const operationId = randomUUID()
      await f.controller.update(f.handle, 'whatsapp', operationId)
      const after = f.state.exportActivation().entries[0]!
      expect(after).toMatchObject({
        installId: before.installId,
        configRevision: before.configRevision,
        releaseRevision: before.releaseRevision + 1,
        release: { version: '0.1.3' },
      })
      expect(after.incarnation).not.toBe(before.incarnation)
      expect(await readFile(join(f.data, 'login'), 'utf8')).toBe('fictional-paired-phone')
      expect(await readFile(join(f.data, 'settings'), 'utf8')).toBe('{"fictionalGroup":true}')
      expect(await ledger.revision(after.installId)).toBe(revision)
      expect(f.events.indexOf('stop')).toBeGreaterThanOrEqual(0)
      expect(f.events.indexOf('stop')).toBeLessThan(f.events.indexOf('start'))
      expect(f.starts()).toBe(2)
      expect(f.events).not.toContain('remove-code')
      expect(fetch).not.toHaveBeenCalled()
      expect(f.controller.admitted(f.handle, 'whatsapp', before.installId)).toBe(true)
      expect(f.state.projections(other.sink.workspaceId)[0]).toMatchObject({
        incarnation: after.incarnation,
      })
      expect((await f.controller.status()).cards[0]?.updateVersion).toBeUndefined()
      const starts = f.starts()
      await f.controller.update(f.handle, 'whatsapp', operationId)
      expect(f.starts()).toBe(starts)
      await expect(f.controller.update(f.handle, 'whatsapp')).rejects.toThrow()
    })
    it.each(['staged', 'prepared', 'ready', 'receipted', 'activated'] as const)(
      'recovers after %s to one complete version without touching login or settings',
      async (point) => {
        const f = await setup()
        await f.offer()
        const before = f.state.exportActivation().entries[0]!
        f.opts.fault = (at) => {
          if (at === point) throw new Error('fictional interruption')
        }
        await f.controller.update(f.handle, 'whatsapp').catch(() => {})
        if (point !== 'staged' && point !== 'activated')
          expect((await f.controller.status()).cards[0]).toMatchObject({
            installed: true,
            state: 'Unavailable',
          })
        const state = reopenLifecycleFixture(f)
        const recovered = await PluginLifecycleController.open({
          ...f.opts,
          state,
          fault: undefined,
          download: async () => {
            throw new Error('Recovery must not download')
          },
        })
        const local = projection()
        const handle = await recovered.attach(local.sink)
        expect(state.inspect().pending).toBeNull()
        expect(state.exportActivation().entries).toHaveLength(1)
        const current = state.exportActivation().entries[0]!
        expect(current).toMatchObject({
          installId: before.installId,
          configRevision: before.configRevision,
          release: { version: point === 'staged' ? '0.1.0' : '0.1.3' },
        })
        expect(state.matchesProjection(local.rows.get('whatsapp'), local.sink.workspaceId)).toBe(
          true,
        )
        expect(recovered.admitted(handle, 'whatsapp', before.installId)).toBe(true)
        expect(await readFile(join(f.data, 'login'), 'utf8')).toBe('fictional-paired-phone')
        expect(await readFile(join(f.data, 'settings'), 'utf8')).toBe('{"fictionalGroup":true}')
        expect(fetch).not.toHaveBeenCalled()
      },
    )
    it.each(['missing', 'committed'] as const)(
      'recovers the reserved update with a %s effect marker',
      async (marker) => {
        const f = await setup()
        await f.offer()
        const operationId = randomUUID()
        f.opts.fault = (point) => {
          if (point === 'prepared') throw new Error('fictional interruption')
        }
        await expect(f.controller.update(f.handle, 'whatsapp', operationId)).rejects.toThrow()
        const effects = await LifecycleEffects.open(f.root, false)
        if (marker === 'missing') await unlink(join(effects.folder, operationId + '.json'))
        else await effects.write({ ...(await effects.read(operationId))!, phase: 'committed' })
        const state = reopenLifecycleFixture(f)
        await PluginLifecycleController.open({
          ...f.opts,
          state,
          fault: undefined,
          download: async () => {
            throw new Error('Recovery must not download')
          },
        })
        expect(state.inspect().pending).toBeNull()
        expect(state.exportActivation().entries[0]?.release.version).toBe('0.1.3')
        expect(await readFile(join(f.data, 'login'), 'utf8')).toBe('fictional-paired-phone')
      },
    )
    it('refuses corrupt replacement bytes before stopping the old version', async () => {
      const f = await setup()
      await f.offer()
      f.opts.download = async () => Buffer.from('fictional corrupt archive')
      f.events.length = 0
      await expect(f.controller.update(f.handle, 'whatsapp')).rejects.toThrow()
      expect(f.events).not.toContain('stop')
      expect(f.state.exportActivation().entries[0]?.release.version).toBe('0.1.0')
      expect(f.state.inspect().pending).toBeNull()
    })
    it('person control refreshes the trusted source and updates while revoking a stale screen', async () => {
      const f = await setup(true)
      await f.controller.detach(f.handle)
      let offered = f.old
      f.opts.refreshCatalogue = async () => ({
        catalogue: { bytes: offered.bytes, signature: Buffer.alloc(0) },
        repoCatalogueSha256: pluginSha256(offered.bytes),
        names: f.opts.names,
      })
      const bridge = await servePersonPluginControl({
        root: f.root,
        key: 'a'.repeat(64),
        controller: sharedLifecycleWorkspaces(f.controller),
        read: async () => null,
      })
      const client = await connectPluginSettings({
        path: bridge.path,
        personKey: 'a'.repeat(64),
        root: f.root,
        pinnedPublicKey: f.opts.pinnedPublicKey,
        target: f.opts.target,
        repoCatalogueSha256: pluginSha256(f.old.bytes),
        catalogue: { bytes: f.old.bytes, signature: Buffer.alloc(0) },
        projection: projection().sink,
        propose() {},
      })
      try {
        const screen = await client.screen('whatsapp')
        expect(screen.current(screen.binding)).toBe(true)
        offered = f.next
        await expect(client.refreshCatalogue!('0'.repeat(64))).rejects.toThrow()
        expect((await client.catalogue())[0]?.updateVersion).toBeUndefined()
        await client.refreshCatalogue!(pluginSha256(f.next.bytes))
        expect((await client.catalogue())[0]?.updateVersion).toBe('0.1.3')
        await client.update!('whatsapp')
        expect(screen.current(screen.binding)).toBe(false)
        const nextScreen = await client.screen('whatsapp')
        expect(nextScreen.verified.manifest.version).toBe('0.1.3')
        expect(await readFile(join(f.data, 'login'), 'utf8')).toBe('fictional-paired-phone')
      } finally {
        await client.close()
        await bridge.close()
      }
    })
  },
)
it.each([
  ['0.1.3', '0.1.0', true],
  ['0.1.0', '0.1.3', false],
  ['0.1.3', '0.1.3', false],
  ['0.10.0', '0.2.0', true],
  ['1.0.0', '1.0.0-beta.2', true],
  ['1.0.0-beta.10', '1.0.0-beta.2', true],
  ['fictional', '0.1.0', false],
] as const)('offers only a newer version (%s compared with %s)', (next, old, expected) =>
  expect(newerPluginVersion(next, old)).toBe(expected),
)
