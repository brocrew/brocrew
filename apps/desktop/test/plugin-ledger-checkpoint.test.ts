import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { PluginProfileLedger } from '../src/main/plugins/lifecycle/profile-ledger'
import { digest } from '../src/main/plugins/node-host-files'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { cleanupLifecycleFixtures, fixture, projection } from './plugin-lifecycle-fixtures'
import { fictionalPublicKey } from './plugin-package-fixtures'

const fault = vi.hoisted(() => ({ point: '' }))
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return {
    ...fs,
    async rename(...args: Parameters<typeof fs.rename>) {
      const checkpoint = String(args[1]).endsWith('/checkpoint.json')
      if (checkpoint && fault.point === 'before-checkpoint') throw new Error('fictional crash')
      await fs.rename(...args)
      if (checkpoint && fault.point === 'after-checkpoint') throw new Error('fictional crash')
    },
    async unlink(...args: Parameters<typeof fs.unlink>) {
      const tail = /\/intents\/\d{16}\.json$/.test(String(args[0]))
      if (tail && fault.point === 'before-tail-delete') throw new Error('fictional crash')
      await fs.unlink(...args)
      if (tail && fault.point === 'after-tail-delete') throw new Error('fictional crash')
    },
  }
})

const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  fault.point = ''
  for (const close of closers.splice(0).reverse()) await close()
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
})
const id = '11111111-1111-4111-a111-111111111114'
const proposal = { action: 'create-profile', profile: 'fern' }
const paths = (root: string, installId = id) => {
  const directory = join(root, 'profile-apply', digest(Buffer.from(installId)))
  return { directory, intents: join(directory, 'intents') }
}

async function upgradedFixture(root: string, installId = id) {
  const ledger = new PluginProfileLedger(root)
  await ledger.reserve(installId, 0, proposal)
  const bytes = await readFile(join(paths(root, installId).intents, '00000001.json'))
  const floor = join(root, 'profile-apply', installId + '.floor')
  await unlink(floor)
  await writeFile(
    floor,
    JSON.stringify({
      format: 2,
      installId,
      revision: 1,
      previous: digest(bytes),
    }),
    { mode: 0o400 },
  )
  return ledger
}

describe.skipIf(process.platform === 'win32')('bounded durable configuration ledger', () => {
  it.each(['before-checkpoint', 'after-checkpoint', 'before-tail-delete', 'after-tail-delete'])(
    'recovers consumed intents after %s without replay or reset',
    async (point) => {
      const f = await fixture()
      const ledger = await upgradedFixture(f.root)
      for (let revision = 1; revision < 63; revision++)
        await ledger.reserve(id, revision, proposal, 2)
      fault.point = point
      await expect(ledger.reserve(id, 63, proposal, 2)).rejects.toThrow()
      fault.point = ''
      const reopened = new PluginProfileLedger(f.root)
      expect(await reopened.revision(id)).toBe(64)
      await expect(reopened.reserve(id, 63, proposal, 2)).rejects.toThrow()
      await reopened.reserve(id, 64, proposal, 2)
      expect(await reopened.revision(id)).toBe(65)
      expect((await readdir(paths(f.root).intents)).length).toBeLessThanOrEqual(64)
      const checkpoint = JSON.parse(
        await readFile(join(paths(f.root).directory, 'checkpoint.json'), 'utf8'),
      )
      expect(checkpoint).toMatchObject({ format: 2, installId: id, revision: 64 })
      await rm(paths(f.root).directory, { recursive: true })
      await expect(reopened.revision(id)).rejects.toThrow()
    },
  )

  it('upgrades a full legacy history only after explicit format negotiation', async () => {
    const f = await fixture()
    const ledger = new PluginProfileLedger(f.root)
    await ledger.reserve(id, 0, proposal)
    let previous = digest(await readFile(join(paths(f.root).intents, '00000001.json')))
    for (let revision = 2; revision <= 4096; revision++) {
      const bytes = Buffer.from(
        JSON.stringify({ format: 1, installId: id, revision, previous, proposal }),
      )
      await writeFile(
        join(paths(f.root).intents, String(revision).padStart(8, '0') + '.json'),
        bytes,
        { mode: 0o400 },
      )
      previous = digest(bytes)
    }
    const floor = join(f.root, 'profile-apply', id + '.floor')
    await unlink(floor)
    await writeFile(floor, '4096', { mode: 0o400 })
    expect(await ledger.revision(id)).toBe(4096)
    await expect(ledger.reserve(id, 4096, proposal, 1)).rejects.toThrow()
    await ledger.reserve(id, 4096, proposal, 2)
    expect(await ledger.revision(id)).toBe(4097)
    expect((await readdir(paths(f.root).intents)).length).toBeLessThanOrEqual(64)
    expect(JSON.parse(await readFile(floor, 'utf8'))).toMatchObject({ format: 2, revision: 4097 })
  }, 30_000)

  it.each(['chrome', 'whatsapp'])(
    'keeps %s person applies available beyond the old lifetime ceiling',
    async (plugin) => {
      const f = await fixture({}, false, plugin)
      await f.controller.install(f.handle, plugin)
      const active = f.state.exportActivation().entries[0]!
      const bridge = await servePersonPluginControl({
        root: f.root,
        key: 'e'.repeat(64),
        controller: f.controller,
        read: async () => ({ profiles: [], tabs: [] }),
      })
      closers.push(() => bridge.close())
      const client = await connectPluginSettings({
        path: bridge.path,
        personKey: 'e'.repeat(64),
        root: f.root,
        pinnedPublicKey: fictionalPublicKey,
        target: f.opts.target,
        catalogue: f.opts.catalogue,
        projection: projection().sink,
        propose: () => {},
      })
      closers.push(() => client.close())
      const screen = await client.screen(plugin)
      await upgradedFixture(f.root, active.installId)
      const fetch = vi.fn(async () => Response.json({}))
      vi.stubGlobal('fetch', fetch)
      const change =
        plugin === 'chrome'
          ? { action: 'set-enabled', profile: 'fern', enabled: true }
          : { action: 'set-prefix', enabled: false }
      const signal = new AbortController().signal
      for (let revision = 1; revision <= 4100; revision++) {
        await screen.peer.proposeConfig(change, revision, screen.binding, signal)
        if (revision === 64 || revision % 64 === 0)
          expect(
            (await readdir(paths(f.root, active.installId).intents)).length,
          ).toBeLessThanOrEqual(64)
      }
      expect(fetch).toHaveBeenCalledTimes(4100)
      expect(await screen.peer.read({}, 0, screen.binding, signal)).toMatchObject({
        configRevision: 4101,
      })
      expect((await readdir(paths(f.root, active.installId).intents)).length).toBeLessThanOrEqual(
        64,
      )
      await expect(
        screen.peer.proposeConfig(change, 4100, screen.binding, signal),
      ).rejects.toThrow()
      fetch.mockRejectedValueOnce(new Error('fictional ambiguous reply'))
      await expect(
        screen.peer.proposeConfig(change, 4101, screen.binding, signal),
      ).rejects.toThrow()
      for (let i = 0; i < 3; i++)
        expect(await screen.peer.read({}, 0, screen.binding, signal)).toMatchObject({
          configRevision: 4102,
        })
      expect(fetch).toHaveBeenCalledTimes(4101)
      await expect(
        screen.peer.proposeConfig(change, 4101, screen.binding, signal),
      ).rejects.toThrow()
      expect(fetch).toHaveBeenCalledTimes(4101)
    },
    360_000,
  )
})
