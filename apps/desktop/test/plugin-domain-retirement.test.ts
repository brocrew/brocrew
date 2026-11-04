import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

async function sources(root: string): Promise<Array<[string, string]>> {
  const result: Array<[string, string]> = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...(await sources(path)))
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) result.push([path, await readFile(path, 'utf8')])
  }
  return result
}

it('has no application-owned domain dispatcher, ledger reader or person proposal executor', async () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url))
  const forbidden =
    /\b(?:pluginAdapter|requirePluginAdapter|PluginProfileLedger|ChromeProposal|WhatsAppProposal|chromeProfileIntent|profileRevision|applyProfile|PluginUiPeer|PluginUiRpc|proposeConfig|configure-ledger)\b|(?:chrome|whatsapp)-(?:apply|read|broker|policy)|\/v1\/(?:profiles|groups|status|uninstall)/
  const violations = (await sources(root)).flatMap(([path, source]) =>
    source
      .split('\n')
      .flatMap((line, index) => (forbidden.test(line) ? [`${path}:${index + 1}: ${line}`] : [])),
  )
  // Historical declarations are decoded only in package-schema, never executable UI RPC.
  expect(violations.filter((line) => !line.includes('/plugins/package-schema.ts:'))).toEqual([])
})

// These controls exercise actual host installation/state/vault readers with an inert process
// fixture. Package execution and native/browser acceptance belong to the connected lane.
import { createHash, randomUUID } from 'node:crypto'
import {
  fixture,
  cleanupLifecycleFixtures,
  reopenLifecycleFixture,
  projection,
} from './plugin-lifecycle-fixtures'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { LifecycleEffects } from '../src/main/plugins/lifecycle/files'
import { PluginPackageVault } from '../src/main/plugins/lifecycle/vault'
import {
  servePersonPluginControl,
  connectPersonPluginControl,
} from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { fictionalPublicKey } from './plugin-package-fixtures'

const close: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const finish of close.splice(0).reverse()) await finish()
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
})
async function legacyFixture(format: 1 | 2, id = 'chrome') {
  return fixture({}, false, id, undefined, (manifest) => {
    if (format === 2)
      Object.assign(manifest, {
        format: 2,
        authors: ['Fictional author'],
        executor: { kind: 'node', entry: manifest.server!.entry },
        hooks: [],
      })
  })
}
async function seedOpaque(root: string, installId: string) {
  const directory = join(
    root,
    'profile-apply',
    createHash('sha256').update(installId).digest('hex'),
  )
  const floor = join(root, 'profile-apply', installId + '.floor')
  const files = new Map([
    [
      join(directory, 'intents', '00000001.json'),
      'corrupt opaque historical DELETE command; do not interpret',
    ],
    [join(directory, 'checkpoint.json'), 'opaque checkpoint'],
    [floor, 'opaque replay floor'],
    [join(root, 'host', 'data', 'chrome', 'Profiles', 'Cookies'), 'opaque profile account bytes'],
    [join(root, 'host', 'data', 'whatsapp', 'pairing.db'), 'opaque pairing bytes'],
    [join(root, 'shared', 'profiles.json'), 'opaque shared profile bytes'],
  ])
  for (const [path, bytes] of files) {
    await mkdir(join(path, '..'), { recursive: true, mode: 0o700 })
    await writeFile(path, bytes)
  }
  const unchanged = async () => {
    for (const [path, bytes] of files) expect(await readFile(path, 'utf8')).toBe(bytes)
  }
  return { directory, floor, unchanged }
}
it.each([1, 2] as const)(
  'reads a format-%s installed archive/state and preserves opaque legacy data through reopen and explicit removal',
  async (format) => {
    const f = await legacyFixture(format)
    const starts: unknown[] = []
    const start = f.opts.runtime.start
    f.opts.runtime.start = async (spec) => {
      starts.push(spec)
      return start(spec)
    }
    const fetch = vi.fn(() => {
      throw new Error('No domain HTTP execution is permitted')
    })
    vi.stubGlobal('fetch', fetch)
    await f.controller.install(f.handle, 'chrome')
    const before = f.state.exportActivation().entries[0]!
    const opaque = await seedOpaque(f.root, before.installId)
    const archive = new PluginPackageVault(f.root, fictionalPublicKey, f.opts.target)
    const installed = await archive.load(
      {
        id: before.pluginId,
        version: before.release.version,
        manifestSha256: before.release.manifestSha256,
        archive: { sha256: before.release.archiveSha256 },
      },
      [],
    )
    expect(installed.manifest.format).toBe(format)
    expect(installed.manifest.id).toBe(before.pluginId)
    const state = reopenLifecycleFixture(f)
    const reopened = await PluginLifecycleController.open({ ...f.opts, state })
    const handle = await reopened.attach(projection().sink)
    expect(state.exportActivation().entries[0]).toEqual(before)
    expect(starts.at(-1)).toMatchObject({
      legacyConfiguration: { directory: opaque.directory, floor: opaque.floor },
    })
    await opaque.unchanged()
    expect((await reopened.status()).cards[0]).not.toHaveProperty('uninstallDeletesData')
    await reopened.uninstall(handle, 'chrome')
    expect(state.inspect().pending).toBeNull()
    expect(f.events).not.toContain('remove-data chrome')
    await opaque.unchanged()
    expect(fetch).not.toHaveBeenCalled()
  },
)
it.each([
  undefined,
  null,
  { data: 'deleted', logout: 'confirmed' },
  { data: 'deleted', logout: 'unconfirmed' },
] as const)(
  'recovers only saved legacy removal facts %j without issuing logout or replaying configuration',
  async (saved) => {
    const f = await legacyFixture(1, 'whatsapp')
    await f.controller.install(f.handle, 'whatsapp')
    const operationId = randomUUID()
    const before = f.state.exportActivation().entries[0]!
    const opaque = await seedOpaque(f.root, before.installId)
    f.failStop()
    await expect(f.controller.uninstall(f.handle, 'whatsapp', operationId)).rejects.toThrow()
    const effects = await LifecycleEffects.open(f.root, false)
    const pending = (await effects.read(operationId))!
    const { legacyRemovalOutcome: _ignored, ...facts } = pending
    await effects.write({
      ...facts,
      ...(saved === undefined ? {} : { legacyRemovalOutcome: saved }),
    })
    f.failStop(false)
    const fetch = vi.fn(() => {
      throw new Error('No legacy cleanup replay')
    })
    vi.stubGlobal('fetch', fetch)
    const state = reopenLifecycleFixture(f)
    await PluginLifecycleController.open({ ...f.opts, state })
    expect(state.inspect().pending).toBeNull()
    expect((await effects.read(operationId))?.legacyRemovalOutcome).toEqual(saved ?? null)
    expect(f.events.filter((event) => event === 'remove-data whatsapp')).toHaveLength(saved ? 1 : 0)
    expect(fetch).not.toHaveBeenCalled()
    await opaque.unchanged()
  },
)
it('refuses retired person methods and old declarations without reading or changing historical bytes', async () => {
  const f = await legacyFixture(2)
  await f.controller.install(f.handle, 'chrome')
  const active = f.state.exportActivation().entries[0]!
  const opaque = await seedOpaque(f.root, active.installId)
  const key = 'e'.repeat(64)
  const bridge = await servePersonPluginControl({ root: f.root, key, controller: f.controller })
  close.push(() => bridge.close())
  const channel = await connectPersonPluginControl({
    path: bridge.path,
    key,
    handle: async () => true,
  })
  close.push(async () => channel.close())
  await channel.call({ kind: 'attach', workspaceId: projection().sink.workspaceId })
  for (const request of [
    { kind: 'configure-ledger', format: 2 },
    { kind: 'read', pluginId: 'chrome', installId: active.installId },
    {
      kind: 'apply',
      pluginId: 'chrome',
      installId: active.installId,
      incarnation: active.incarnation,
      revision: 0,
      proposal: { action: 'delete-profile', profile: 'DO-NOT-REPLAY' },
    },
  ])
    await expect(channel.call(request)).rejects.toThrow()
  const client = await connectPluginSettings({
    path: bridge.path,
    personKey: key,
    root: f.root,
    pinnedPublicKey: fictionalPublicKey,
    target: f.opts.target,
    catalogue: f.opts.catalogue,
    projection: projection().sink,
  })
  close.push(() => client.close())
  await expect(client.screen('chrome')).rejects.toThrow()
  expect(f.state.exportActivation().entries[0]).toEqual(active)
  await opaque.unchanged()
})
