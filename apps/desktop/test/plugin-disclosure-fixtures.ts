import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { lstat, readFile, readdir, readlink } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, vi } from 'vitest'
import { fixture, projection } from './plugin-lifecycle-fixtures'
import { packageFixture, signed } from './plugin-package-fixtures'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { registerPluginSettings, type PluginSettingsController } from '../src/main/plugins/settings'
import { pluginSha256 } from '../src/main/plugins/package-digests'

export interface ReviewConsent {
  releaseDigest: string
  preparation: string
  displayedDetailsHash?: string
}
export interface DisclosureDetails {
  version: string
  digest: string
  manifestSha256: string
  authors: string[] | null
  permissions: {
    description: string
    resources: Array<{ id: string; label: string; read: boolean; write: boolean }>
  }
}
export interface DisclosureReview {
  id: string
  action: 'install' | 'update'
  catalogueDigest: string
  details: DisclosureDetails | null
  installed: DisclosureDetails | null
  changes: { authors: boolean; permissions: boolean } | null
  consent: ReviewConsent
}
export type DisclosureClient = Awaited<ReturnType<typeof connectPluginSettings>>
/** Old implementation still obtains a real proof: RED must be behaviour, not a missing method. */
export async function review(
  client: DisclosureClient,
  action: 'install' | 'update',
): Promise<DisclosureReview> {
  const method = Reflect.get(client, 'reviewMutation') as
    ((action: 'install' | 'update', id: string) => Promise<DisclosureReview>) | undefined
  if (method) return method.call(client, action, 'chrome')
  return {
    id: 'chrome',
    action,
    catalogueDigest: '',
    details: null,
    installed: null,
    changes: null,
    consent: await client.prepareMutation!(action, 'chrome'),
  } satisfies DisclosureReview
}
export async function commit(
  client: DisclosureClient,
  action: 'install' | 'update',
  consent: ReviewConsent,
) {
  return client[action]!('chrome', consent)
}
export function cancelReviews(client: DisclosureClient) {
  const method = Reflect.get(client, 'cancelPreparations') as (() => void) | undefined
  method?.call(client)
}
export async function disclosureTree(
  root: string,
  relative = '',
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {}
  for (const name of (await readdir(join(root, relative))).sort()) {
    const key = relative ? `${relative}/${name}` : name
    if (
      [
        'state/writer-lock.sqlite',
        'state/writer-lock.sqlite-wal',
        'state/writer-lock.sqlite-shm',
      ].includes(key)
    )
      continue
    const path = join(root, key),
      stat = await lstat(path, { bigint: true })
    const metadata = {
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
      mode: Number(stat.mode & 0o777n),
    }
    if (stat.isDirectory()) {
      result[key] = { ...metadata, kind: 'directory' }
      Object.assign(result, await disclosureTree(root, key))
    } else if (stat.isFile())
      result[key] = { ...metadata, kind: 'file', sha256: pluginSha256(await readFile(path)) }
    else if (stat.isSymbolicLink())
      result[key] = { ...metadata, kind: 'link', target: await readlink(path) }
    else result[key] = { ...metadata, kind: stat.isSocket() ? 'socket' : 'other' }
  }
  return result
}
export async function disclosureFixture(
  options: {
    installed?: boolean
    legacyInstalled?: boolean
    nextAuthors?: string[]
    changePermissions?: boolean
  } = {},
) {
  const f = await fixture()
  function modern(version: string, authors = ['fern-makers'], write = false) {
    const pkg = packageFixture({
      manifest: {
        ...f.pkg.manifest,
        format: 2,
        authors,
        version,
        executor: { kind: 'node', entry: f.pkg.manifest.server!.entry },
        hooks: [],
        permissions: {
          description: 'Read fictional recipes.',
          resources: [{ id: 'recipes', label: 'Fictional recipes', read: true, write }],
        },
      },
    })
    const release = { ...pkg.release, authors }
    return { ...pkg, release, ...signed({ format: 2, entries: [release] }) }
  }
  const first = options.legacyInstalled ? f.pkg : modern('1.0.1')
  let next = modern('1.0.2', options.nextAuthors, options.changePermissions)
  let offered = first
  const ownerOptions = {
    ...f.opts,
    catalogue: { bytes: first.bytes, signature: first.signature },
    download: vi.fn(async () => offered.archive),
    refreshCatalogue: async () => ({
      catalogue: { bytes: next.bytes, signature: next.signature },
      names: f.opts.names,
    }),
  }
  if (options.installed) {
    const seed = await PluginLifecycleController.open(ownerOptions),
      handle = await seed.attach(projection().sink)
    if (options.legacyInstalled) await seed.install(handle, 'chrome')
    else {
      const proof = await seed.prepareMutation(
        handle,
        'install',
        'chrome',
        first.release.archive.sha256,
        pluginSha256(first.bytes),
      )
      await seed.installPrepared(handle, 'chrome', proof)
    }
    const seeded = f.state.inspect()
    expect(seeded.pending).toBeNull()
    expect(seeded.guards).toHaveLength(1)
    expect(seeded.guards[0]?.release.archiveSha256).toBe(first.release.archive.sha256)
    expect(seeded.guards[0]?.release.version).toBe(first.release.version)
  }
  offered = next
  ownerOptions.catalogue = { bytes: next.bytes, signature: next.signature }
  const controller = await PluginLifecycleController.open(ownerOptions),
    key = randomBytes(32).toString('hex')
  const bridge = await servePersonPluginControl({
    root: f.root,
    key,
    controller: sharedLifecycleWorkspaces(controller),
    read: async () => null,
  })
  const clients: DisclosureClient[] = []
  const download = vi.fn(async () => next.archive)
  async function connect() {
    const input = {
      root: f.root,
      path: bridge.path,
      personKey: key,
      pinnedPublicKey: f.opts.pinnedPublicKey,
      target: f.opts.target,
      catalogue: ownerOptions.catalogue,
      projection: projection().sink,
      propose() {},
      download,
    }
    const client = await connectPluginSettings(input)
    clients.push(client)
    return client
  }
  const snapshot = async () => ({
    state: structuredClone(f.state.inspect()),
    tree: await disclosureTree(f.root),
    events: [...f.events],
    starts: f.starts(),
    downloads: ownerOptions.download.mock.calls.length,
  })
  return {
    f,
    first,
    get next() {
      return next
    },
    controller,
    connect,
    download,
    snapshot,
    async replaceRelease() {
      next = modern('1.0.3', ['other-makers'], true)
      offered = next
      return next
    },
    async close() {
      for (const c of clients.reverse()) await c.close()
      await bridge.close()
    },
  }
}
function registerPeerController(controller: PluginSettingsController) {
  const owners = new WeakMap<object, unknown>(),
    ipc = { handle: vi.fn() }
  registerPluginSettings(ipc, (event) => owners.get(event.sender) as never, controller)
  return { owners, ipc }
}
const peerControllers = new WeakMap<
  PluginSettingsController,
  ReturnType<typeof registerPeerController>
>()
export function settingsPeer(controller: PluginSettingsController) {
  const owner = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getContentBounds: () => ({ width: 1180, height: 900 }),
    webContents: Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn() }),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  })
  let shared = peerControllers.get(controller)
  if (!shared) {
    shared = registerPeerController(controller)
    peerControllers.set(controller, shared)
  }
  shared.owners.set(owner.webContents, owner)
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame }
  return { owner, call: (input: unknown) => shared.ipc.handle.mock.calls[0]![1](event, input) }
}
