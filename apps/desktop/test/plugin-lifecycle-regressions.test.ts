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
import { STATE_LIMITS } from '../src/main/plugins/state/format'
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
const originalLimits = { records: STATE_LIMITS.records, journalBytes: STATE_LIMITS.journalBytes }
afterEach(async () => {
  deletion.interrupt = false
  Object.assign(STATE_LIMITS, originalLimits)
  await cleanupLifecycleFixtures()
})
async function journalBytes(root: string) {
  let bytes = 0
  for (const name of await readdir(join(root, 'state/lifecycle-guard')))
    if (name.endsWith('.json'))
      bytes += (await readFile(join(root, 'state/lifecycle-guard', name))).length
  return bytes
}
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
  it('a durable completion effect cannot skip a still-pending reserved journal abort on reopen', async () => {
    const f = await fixture({
      fault(point) {
        if (point === 'ready') throw new Error('fictional pending crash image')
      },
    })
    Object.assign(STATE_LIMITS, { records: 4 })
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
  it('P2-record: a last-budget install completes for every live workspace', async () => {
    const f = await fixture()
    const second = projection()
    const other = await f.controller.attach(second.sink)
    // Four record slots: the prepare and its reserved completion fit, with nothing written per workspace.
    Object.assign(STATE_LIMITS, { records: 4 })
    await expect(f.controller.install(f.handle, 'chrome')).resolves.toBeUndefined()
    const installId = f.state.exportActivation().entries[0]!.installId
    expect(f.controller.admitted(f.handle, 'chrome', installId)).toBe(true)
    expect(f.controller.admitted(other, 'chrome', installId)).toBe(true)
    expect(f.state.inspect().pending).toBeNull()
  })
  it('P2-names: interrupted stage names cannot consume the completion budget after activation', async () => {
    const f = await fixture()
    const second = projection()
    const other = await f.controller.attach(second.sink)
    Object.assign(STATE_LIMITS, { records: 8 })
    for (let i = 0; i < 8; i++)
      await writeFile(join(f.root, 'state/lifecycle-guard', `.stage-${randomUUID()}`), '', {
        mode: 0o600,
      })
    await expect(f.controller.install(f.handle, 'chrome')).resolves.toBeUndefined()
    const installId = f.state.exportActivation().entries[0]!.installId
    expect(f.controller.admitted(other, 'chrome', installId)).toBe(true)
  })
  it('P2-bytes: insufficient whole-lifecycle byte budget refuses before any process starts', async () => {
    const probe = await fixture({ now: () => 1000 })
    probe.state.prepare({
      operationId: randomUUID(),
      snapshot: null,
      consent: {
        action: 'install',
        pluginId: 'chrome',
        at: 1000,
        expectedSequence: probe.state.inspect().sequence,
        expectedInstallId: null,
        release: {
          version: probe.pkg.release.version,
          archiveSha256: probe.pkg.release.archive.sha256,
          manifestSha256: probe.pkg.release.manifestSha256,
          dataSchema: 1,
        },
      },
    })
    // One byte short of the probe's prepare and reserved completion, the same records an install writes.
    const budget =
      (await journalBytes(probe.root)) + probe.state.inspect().reservation!.recordBytes - 1
    const f = await fixture({ now: () => 1000 })
    Object.assign(STATE_LIMITS, { journalBytes: budget })
    await expect(f.controller.install(f.handle, 'chrome')).rejects.toThrow()
    expect(f.starts()).toBe(0)
    expect(f.state.inspect().guards).toEqual([])
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
