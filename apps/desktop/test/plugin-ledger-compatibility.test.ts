import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { PluginProfileLedger } from '../src/main/plugins/lifecycle/profile-ledger'
import { PluginProfileLedger as OldLedger } from './fixtures/plugin-update-parent/profile-ledger'
import { PersonChannel } from '../src/main/plugins/lifecycle/transport'
import { digest } from '../src/main/plugins/node-host-files'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import {
  connectPersonPluginControl,
  servePersonPluginControl,
} from '../src/main/plugins/lifecycle/person-control'
import { cleanupLifecycleFixtures, fixture, projection } from './plugin-lifecycle-fixtures'
import { fictionalPublicKey } from './plugin-package-fixtures'

const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
})
const id = '11111111-1111-4111-a111-111111111113'
const proposal = { action: 'create-profile', profile: 'fern' }
async function seedCheckpoint(root: string, installId = id, revision = 10_000) {
  const ledger = new PluginProfileLedger(root)
  await ledger.reserve(installId, 0, proposal)
  const parent = join(root, 'profile-apply')
  const directory = join(parent, digest(Buffer.from(installId)))
  const intents = join(directory, 'intents')
  await rm(intents, { recursive: true })
  await mkdir(intents, { mode: 0o700 })
  const checkpoint = { format: 2, installId, revision, previous: 'a'.repeat(64) }
  const bytes = Buffer.from(JSON.stringify(checkpoint))
  await writeFile(join(directory, 'checkpoint.json'), bytes, { mode: 0o400 })
  const floor = join(parent, installId + '.floor')
  await unlink(floor)
  await writeFile(floor, bytes, { mode: 0o400 })
  return { ledger, directory, intents, floor, bytes }
}
async function bytesIn(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      for (const [name, bytes] of Object.entries(await bytesIn(path)))
        result[entry.name + '/' + name] = bytes
    } else result[entry.name] = (await readFile(path)).toString('hex')
  }
  return result
}
async function connected(plugin = 'chrome') {
  const f = await fixture({}, false, plugin)
  await f.controller.install(f.handle, plugin)
  const active = f.state.exportActivation().entries[0]!
  const bridge = await servePersonPluginControl({
    root: f.root,
    key: 'e'.repeat(64),
    controller: f.controller,
    read: async () => ({ configRevision: 0, profiles: [], tabs: [] }),
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
  return { ...f, bridge, client, active }
}

describe.skipIf(process.platform === 'win32')('ledger reader and wire', () => {
  it('reads a committed checkpoint above the old four-digit floor', async () => {
    const f = await fixture()
    const seeded = await seedCheckpoint(f.root)
    expect(await seeded.ledger.revision(id)).toBe(10_000)
    const before = await bytesIn(join(f.root, 'profile-apply'))
    for (let i = 0; i < 5; i++) expect(await seeded.ledger.revision(id)).toBe(10_000)
    expect(await bytesIn(join(f.root, 'profile-apply'))).toEqual(before)
  })

  it('makes an actual old reader refuse new state without rewriting it', async () => {
    const f = await fixture()
    await seedCheckpoint(f.root)
    const before = await bytesIn(join(f.root, 'profile-apply'))
    await expect(new OldLedger(f.root).revision(id)).rejects.toThrow()
    expect(await bytesIn(join(f.root, 'profile-apply'))).toEqual(before)
    expect(await new PluginProfileLedger(f.root).revision(id)).toBe(10_000)
  })

  it.each(['chrome', 'whatsapp'])('round-trips negotiated %s revisions', async (plugin) => {
    const f = await connected(plugin)
    await seedCheckpoint(f.root, f.active.installId)
    const screen = await f.client.screen(plugin)
    const fetch = vi.fn(async () => Response.json({}))
    vi.stubGlobal('fetch', fetch)
    const read = () => screen.peer.read({}, 0, screen.binding, new AbortController().signal)
    expect(await read()).toMatchObject({ configRevision: 10_000 })
    const change =
      plugin === 'chrome'
        ? { action: 'set-enabled', profile: 'fern', enabled: true }
        : { action: 'set-prefix', enabled: false }
    await screen.peer.proposeConfig(change, 10_000, screen.binding, new AbortController().signal)
    expect(await read()).toMatchObject({ configRevision: 10_001 })
    await expect(
      screen.peer.proposeConfig(change, 10_000, screen.binding, new AbortController().signal),
    ).rejects.toThrow()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not permit a client that omitted ledger negotiation to rewrite new state', async () => {
    const f = await connected()
    await seedCheckpoint(f.root, f.active.installId)
    const channel = await connectPersonPluginControl({
      path: f.bridge.path,
      key: 'e'.repeat(64),
      handle: async () => true,
    })
    try {
      await channel.call({ kind: 'attach', workspaceId: projection().sink.workspaceId })
      const before = await bytesIn(join(f.root, 'profile-apply'))
      await expect(
        channel.call({
          kind: 'read',
          pluginId: 'chrome',
          installId: f.active.installId,
        }),
      ).rejects.toThrow()
      expect(await bytesIn(join(f.root, 'profile-apply'))).toEqual(before)
    } finally {
      channel.close()
    }
  })

  it('preserves old reader access after the first negotiated save', async () => {
    const f = await connected()
    const screen = await f.client.screen('chrome')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({})),
    )
    await screen.peer.proposeConfig(
      { action: 'set-enabled', profile: 'fern', enabled: true },
      0,
      screen.binding,
      new AbortController().signal,
    )
    expect(await new OldLedger(f.root).revision(f.active.installId)).toBe(1)
    expect(
      await readFile(join(f.root, 'profile-apply', f.active.installId + '.floor'), 'utf8'),
    ).toBe('1')
  })

  it('closes the person channel when ledger negotiation returns malformed data', async () => {
    const f = await fixture()
    const bridge = await servePersonPluginControl({
      root: f.root,
      key: 'e'.repeat(64),
      controller: f.controller,
      read: async () => ({}),
    })
    closers.push(() => bridge.close())
    const original = PersonChannel.prototype.call
    vi.spyOn(PersonChannel.prototype, 'call').mockImplementation(function (
      this: PersonChannel,
      input,
    ) {
      if (
        input &&
        typeof input === 'object' &&
        'kind' in input &&
        input.kind === 'configure-ledger'
      )
        return Promise.resolve({ format: 2, maxRevision: 1 })
      return original.call(this, input)
    })
    const lost = vi.fn()
    await expect(
      connectPluginSettings({
        path: bridge.path,
        personKey: 'e'.repeat(64),
        root: f.root,
        pinnedPublicKey: fictionalPublicKey,
        target: f.opts.target,
        catalogue: f.opts.catalogue,
        projection: projection().sink,
        propose: () => {},
        lost,
      }),
    ).rejects.toThrow()
    expect(lost).toHaveBeenCalledOnce()
  })

  it('refuses a checkpoint whose replay floor has a different committed digest', async () => {
    const f = await fixture()
    const seeded = await seedCheckpoint(f.root)
    await unlink(seeded.floor)
    await writeFile(
      seeded.floor,
      JSON.stringify({ format: 2, installId: id, revision: 10_000, previous: 'b'.repeat(64) }),
      { mode: 0o400 },
    )
    await expect(seeded.ledger.revision(id)).rejects.toThrow()
  })

  it('refuses overflow without consuming another intent', async () => {
    const f = await fixture()
    const seeded = await seedCheckpoint(f.root, id, Number.MAX_SAFE_INTEGER)
    expect(await seeded.ledger.revision(id)).toBe(Number.MAX_SAFE_INTEGER)
    await expect(seeded.ledger.reserve(id, Number.MAX_SAFE_INTEGER, proposal)).rejects.toThrow()
    expect(await bytesIn(join(f.root, 'profile-apply'))).toEqual({
      [id + '.floor']: seeded.bytes.toString('hex'),
      [digest(Buffer.from(id)) + '/birth']: Buffer.from(id).toString('hex'),
      [digest(Buffer.from(id)) + '/checkpoint.json']: seeded.bytes.toString('hex'),
    })
  })
})
