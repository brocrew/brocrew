import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  fixture,
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
      if (deletion.interrupt && String(path).includes('/package-vault/')) {
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
// Inert process peers; the POSIX storage backend alone is under test. No app/provider is started.
describe.skipIf(process.platform === 'win32')('plugin lifecycle regressions', () => {
  it('early authoritative uninstall rejects an unknown id without poisoning ownership, and removed retries are no-ops', async () => {
    const f = await fixture()
    await expect(f.controller.uninstall(f.handle, 'fictional-unknown')).rejects.toMatchObject({
      code: 'unavailable',
    })
    expect(f.controller.cleanForShutdown()).toBe(true)
    await f.controller.install(f.handle, 'chrome')
    await f.controller.uninstall(f.handle, 'chrome')
    const sequence = f.state.inspect().sequence
    await expect(f.controller.uninstall(f.handle, 'chrome')).resolves.toBeUndefined()
    expect(f.state.inspect().sequence).toBe(sequence)
    expect(f.controller.cleanForShutdown()).toBe(true)
  })
  it('P1: interrupted vault retirement can reopen and finish, without a poisoned published cache', async () => {
    const f = await fixture()
    await f.controller.install(f.handle, 'chrome')
    deletion.interrupt = true
    await expect(f.controller.uninstall(f.handle, 'chrome')).rejects.toThrow()
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
    const f = await fixture()
    await f.controller.install(f.handle, 'chrome')
    const published = join(f.root, 'package-vault', f.pkg.release.archive.sha256)
    await unlink(join(published, 'archive'))
    await expect(f.controller.uninstall(f.handle, 'chrome')).rejects.toThrow()
    expect(await readdir(join(f.root, 'package-vault'))).toEqual([f.pkg.release.archive.sha256])
    expect(f.state.inspect().pending).not.toBeNull()
  })
  it('a durable completion effect cannot skip a still-pending abort on reopen', async () => {
    const f = await fixture({
      fault(point) {
        if (point === 'ready') throw new Error('fictional pending crash image')
      },
    })
    f.failStop()
    await expect(f.controller.install(f.handle, 'chrome')).rejects.toThrow()
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
  it('P2: a state write that fails refuses the install before any process starts', async () => {
    const f = await fixture({ now: () => 1000 })
    const write = vi.spyOn(
      (f.state as unknown as { disk: { write(next: unknown): void } }).disk,
      'write',
    )
    // The disk is full when the prepare is written: writing the staged state file fails.
    const actual = fs.writeFileSync
    const full = vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
      if (typeof file === 'number')
        throw Object.assign(new Error('fictional full disk'), { code: 'ENOSPC' })
      actual(file, data, options)
    })
    syncBuiltinESMExports()
    try {
      await expect(f.controller.install(f.handle, 'chrome')).rejects.toThrow()
    } finally {
      full.mockRestore()
      syncBuiltinESMExports()
    }
    expect(write.mock.results.map((one) => one.type)).toEqual(['throw'])
    expect(f.starts()).toBe(0)
    expect(f.state.inspect().guards).toEqual([])
    expect(f.state.inspect().pending).toBeNull()
    const state = reopenLifecycleFixture(f)
    expect(state.inspect().guards).toEqual([])
  })
  it('P4: a cleanly recovered first install is Available without another owner restart', async () => {
    const f = await fixture({
      fault(point) {
        if (point === 'ready') throw new Error('fictional interruption')
      },
    })
    f.failStop()
    await expect(f.controller.install(f.handle, 'chrome')).rejects.toThrow()
    const state = reopenLifecycleFixture(f)
    f.failStop(false)
    const recovered = await PluginLifecycleController.open({ ...f.opts, state, fault: undefined })
    expect((await recovered.status()).cards[0]).toMatchObject({
      installed: false,
      state: 'Available',
    })
    const local = await recovered.attach(f.local.sink)
    await expect(recovered.install(local, 'chrome')).resolves.toBeUndefined()
  })
})
