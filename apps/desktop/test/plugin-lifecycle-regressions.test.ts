import { afterEach, describe, expect, it, vi } from 'vitest'
import { readdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  fixture,
  projection,
  cleanupLifecycleFixtures,
  reopenLifecycleFixture,
} from './plugin-lifecycle-fixtures'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { LifecycleEffects } from '../src/main/plugins/lifecycle/files'
const deletion = vi.hoisted(() => ({ interrupt: false }))
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>()
  return {
    ...real,
    rm: async (path: Parameters<typeof real.rm>[0], options?: Parameters<typeof real.rm>[1]) => {
      if (deletion.interrupt && String(path).replaceAll('\\', '/').includes('/package-vault/')) {
        deletion.interrupt = false
        await real.unlink(join(String(path), 'archive'))
        throw Object.assign(new Error('fictional interrupted recursive removal'), { code: 'EIO' })
      }
      return real.rm(path, options)
    },
  }
})
afterEach(async () => {
  deletion.interrupt = false
  await cleanupLifecycleFixtures()
})
async function fictionalFixture(change?: Parameters<typeof fixture>[0]) {
  return fixture(change, false, 'fictional-bakery')
}
// Inert process peers and fictional disk state; no app or provider is started.
describe('plugin lifecycle regressions', () => {
  it('early authoritative uninstall rejects an unknown id without poisoning ownership, and removed retries are no-ops', async () => {
    const f = await fictionalFixture()
    await expect(f.controller.uninstall(f.handle, 'fictional-unknown')).rejects.toMatchObject({
      code: 'unavailable',
    })
    expect(f.controller.cleanForShutdown()).toBe(true)
    await f.controller.install(f.handle, 'fictional-bakery')
    await f.controller.uninstall(f.handle, 'fictional-bakery')
    const sequence = f.state.inspect().sequence
    await expect(f.controller.uninstall(f.handle, 'fictional-bakery')).resolves.toBeUndefined()
    expect(f.state.inspect().sequence).toBe(sequence)
    expect(f.controller.cleanForShutdown()).toBe(true)
  })
  it('interrupted vault retirement can reopen and finish without losing the selected operation', async () => {
    const f = await fictionalFixture()
    await f.controller.install(f.handle, 'fictional-bakery')
    deletion.interrupt = true
    await expect(f.controller.uninstall(f.handle, 'fictional-bakery')).rejects.toThrow()
    expect(deletion.interrupt).toBe(false)
    const state = reopenLifecycleFixture(f)
    const opening = PluginLifecycleController.open({ ...f.opts, state })
    await expect(opening).resolves.toBeDefined()
    const recovered = await opening
    expect(state.inspect().pending).toBeNull()
    expect(state.inspect().guards[0]?.phase).toBe('removed')
    expect((await recovered.status()).cards[0]?.state).toBe('Available')
    expect(await readdir(join(f.root, 'package-vault'))).toEqual([])
  })
  it('published cache tampering still refuses instead of entering retirement', async () => {
    const f = await fictionalFixture()
    await f.controller.install(f.handle, 'fictional-bakery')
    const published = join(f.root, 'package-vault', f.pkg.release.archive.sha256)
    await unlink(join(published, 'archive'))
    await expect(f.controller.uninstall(f.handle, 'fictional-bakery')).rejects.toThrow()
    expect(await readdir(join(f.root, 'package-vault'))).toEqual([f.pkg.release.archive.sha256])
    expect(f.state.inspect().pending).not.toBeNull()
  })
  it('a failed stop keeps the pending operation recoverable until the owned runtime can stop', async () => {
    const f = await fictionalFixture()
    f.local.failWrite()
    f.failStop()
    await expect(f.controller.install(f.handle, 'fictional-bakery')).rejects.toThrow()
    expect(f.state.inspect().pending).not.toBeNull()
    const state = reopenLifecycleFixture(f)
    f.failStop(false)
    const recovered = await PluginLifecycleController.open({ ...f.opts, state })
    expect(state.inspect().pending).toBeNull()
    expect(state.exportActivation().entries).toEqual([])
    expect((await recovered.status()).cards[0]?.state).toBe('Available')
  })
  it('a completion effect cannot skip resolving an interrupted snapshot operation', async () => {
    const f = await fictionalFixture({
      fault(point) {
        if (point === 'ready') throw new Error('fictional pending crash image')
      },
    })
    f.failStop()
    await expect(f.controller.install(f.handle, 'fictional-bakery')).rejects.toThrow()
    const operationId = f.state.inspect().pending!.request.operationId
    const effects = await LifecycleEffects.open(f.root, false)
    const effect = (await effects.read(operationId))!
    // Fixture image of the commit-marker-before-resolution crash window; no live process exists.
    await effects.write({ ...effect, phase: 'committed' })
    const state = reopenLifecycleFixture(f)
    f.failStop(false)
    const recovered = await PluginLifecycleController.open({ ...f.opts, state, fault: undefined })
    expect(state.inspect().pending).toBeNull()
    expect(state.exportActivation().entries).toEqual([])
    expect((await recovered.status()).cards[0]?.state).toBe('Available')
  })
  it('a completed install selects every live workspace switch atomically', async () => {
    const f = await fictionalFixture()
    const second = projection()
    await f.controller.attach(second.sink)
    await expect(f.controller.install(f.handle, 'fictional-bakery')).resolves.toBeUndefined()
    expect(f.state.projections(f.local.sink.workspaceId)).toHaveLength(1)
    expect(f.state.projections(second.sink.workspaceId)).toHaveLength(1)
    expect(f.state.inspect().pending).toBeNull()
  })
  it('a failed workspace write aborts installation and remains recoverable', async () => {
    const f = await fictionalFixture()
    f.local.failWrite()
    await expect(f.controller.install(f.handle, 'fictional-bakery')).rejects.toThrow()
    expect(f.state.inspect().guards[0]?.phase).toBe('removed')
    expect(f.state.exportActivation().entries).toEqual([])
    const state = reopenLifecycleFixture(f)
    const recovered = await PluginLifecycleController.open({ ...f.opts, state })
    expect(state.inspect().pending).toBeNull()
    expect((await recovered.status()).cards[0]?.state).toBe('Available')
  })
  it('leftover snapshot stages do not block installation or workspace selection', async () => {
    const f = await fictionalFixture()
    const second = projection()
    await f.controller.attach(second.sink)
    for (let i = 0; i < 8; i++)
      await writeFile(join(f.root, 'state', `.state-${randomUUID()}`), '', {
        mode: 0o600,
      })
    await expect(f.controller.install(f.handle, 'fictional-bakery')).resolves.toBeUndefined()
    expect(f.state.projections(second.sink.workspaceId)).toHaveLength(1)
  })
  it('repeated ordinary installs select one snapshot without exhausting historical operations', async () => {
    const f = await fictionalFixture()
    for (let index = 0; index < 12; index++) {
      await f.controller.install(f.handle, 'fictional-bakery')
      const selected = JSON.parse(
        await readFile(join(f.root, 'state', 'installed-state.json'), 'utf8'),
      )
      expect(selected.format).toBe(2)
      expect(selected.pending).toBeNull()
      expect(selected.active[0].pluginId).toBe('fictional-bakery')
      expect(f.state.projections(f.local.sink.workspaceId)).toHaveLength(1)
      await f.controller.uninstall(f.handle, 'fictional-bakery')
      expect(f.state.inspect().pending).toBeNull()
    }
    expect((await readdir(join(f.root, 'state'))).sort()).toEqual([
      'installed-state.json',
      'operations.sqlite',
      'writer-lock.sqlite',
    ])
    const state = reopenLifecycleFixture(f)
    const recovered = await PluginLifecycleController.open({ ...f.opts, state })
    expect((await recovered.status()).cards[0]?.state).toBe('Available')
    expect(state.exportActivation().entries).toEqual([])
  })
  it('a recovered first install is available without another owner restart', async () => {
    const f = await fictionalFixture({
      fault(point) {
        if (point === 'ready') throw new Error('fictional interruption')
      },
    })
    f.failStop()
    await expect(f.controller.install(f.handle, 'fictional-bakery')).rejects.toThrow()
    const state = reopenLifecycleFixture(f)
    f.failStop(false)
    const recovered = await PluginLifecycleController.open({ ...f.opts, state, fault: undefined })
    expect((await recovered.status()).cards[0]).toMatchObject({
      installed: false,
      state: 'Available',
    })
    const local = await recovered.attach(f.local.sink)
    await expect(recovered.install(local, 'fictional-bakery')).resolves.toBeUndefined()
  })
})
