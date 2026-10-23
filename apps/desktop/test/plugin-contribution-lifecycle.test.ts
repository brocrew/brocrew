import { afterEach, describe, expect, it, vi } from 'vitest'
import * as nodeHost from '../src/main/plugins/node-host'
import { parsePluginManifest } from '../src/main/plugins/package-schema'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { connectPluginSettings as oldClient } from './fixtures/plugin-update-parent/lifecycle-settings-client'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { parseRepoPluginList } from '../src/main/plugins/catalogue/repo-list'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { fixture, projection, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { packageFixture, verified } from './plugin-package-fixtures'
import { repoListFor } from './plugin-repo-list-fixtures'

const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
})
async function generic(kind = 'turn.context.titles') {
  const f = await fixture({}, false, 'fictional-context')
  const manifest = parsePluginManifest(
    Buffer.from(
      JSON.stringify({
        ...f.pkg.manifest,
        format: 2,
        authors: ['brocrew'],
        server: null,
        toolApi: null,
        ui: null,
        uiApi: null,
        executor: { kind: 'node', entry: f.pkg.manifest.server!.entry },
        hooks: [
          {
            id: 'related-titles',
            kind,
            api: 1,
            optional: true,
            inputs:
              kind === 'turn.context.titles'
                ? ['resource-titles']
                : kind === 'speech.transcribe'
                  ? ['audio', 'vocabulary']
                  : ['transcript', 'vocabulary'],
          },
        ],
      }),
    ),
  )
  const pkg = packageFixture({ manifest })
  const options: typeof f.opts = {
    ...f.opts,
    catalogue: { bytes: pkg.bytes, signature: pkg.signature },
    download: async () => pkg.archive,
  }
  const controller = await PluginLifecycleController.open(options)
  const receiver = projection()
  const handle = await controller.attach(receiver.sink)
  return { ...f, controller, handle, receiver, pkg, options }
}

describe.skipIf(process.platform === 'win32')('independent owned contributions', () => {
  it('runs a generic Node contribution without granting an MCP or configuration route', async () => {
    const f = await generic()
    const prepared = await f.controller.prepareMutation(
      f.handle,
      'install',
      f.pkg.manifest.id,
      f.pkg.release.archive.sha256,
      pluginSha256(f.pkg.bytes),
    )
    await f.controller.installPrepared(f.handle, f.pkg.manifest.id, prepared)
    expect(f.controller.agentAttachments(f.receiver.sink.workspaceId)).toEqual([])
    const get = Reflect.get(f.controller, 'contributions') as (
      handle: unknown,
      id: string,
    ) => { current(): boolean; contributions: { tools: unknown; configuration: unknown } }
    expect(typeof get).toBe('function')
    const entry = get.call(f.controller, f.handle, f.pkg.manifest.id)
    expect(entry.current()).toBe(true)
    expect(get.call(f.controller, f.handle, f.pkg.manifest.id)).toBe(entry)
    expect(entry.contributions.tools).toBeNull()
    expect(entry.contributions.configuration).toBeNull()
    await f.controller.uninstall(f.handle, f.pkg.manifest.id)
    expect(entry.current()).toBe(false)
  })
  it('revokes a contribution on update and never revives it when its workspace reattaches', async () => {
    const f = await generic()
    const prepared = await f.controller.prepareMutation(
      f.handle,
      'install',
      f.pkg.manifest.id,
      f.pkg.release.archive.sha256,
      pluginSha256(f.pkg.bytes),
    )
    await f.controller.installPrepared(f.handle, f.pkg.manifest.id, prepared)
    const get = Reflect.get(f.controller, 'contributions') as (
      handle: unknown,
      id: string,
    ) => { current(): boolean; identity: { runId: string } }
    expect(typeof get).toBe('function')
    const before = get.call(f.controller, f.handle, f.pkg.manifest.id)
    const next = packageFixture({ manifest: { ...f.pkg.manifest, version: '1.0.3' } })
    f.options.refreshCatalogue = async () => ({
      catalogue: { bytes: next.bytes, signature: next.signature },
      names: f.opts.names,
    })
    f.options.download = async () => next.archive
    await f.controller.refreshCatalogue(pluginSha256(next.bytes))
    const update = await f.controller.prepareMutation(
      f.handle,
      'update',
      f.pkg.manifest.id,
      next.release.archive.sha256,
      pluginSha256(next.bytes),
    )
    await f.controller.updatePrepared(f.handle, f.pkg.manifest.id, update)
    expect(before.current()).toBe(false)
    const updated = get.call(f.controller, f.handle, f.pkg.manifest.id)
    expect(updated.current()).toBe(true)
    expect(updated.identity.runId).not.toBe(before.identity.runId)
    await f.controller.detach(f.handle)
    const restored = await f.controller.attach({
      ...projection().sink,
      workspaceId: f.receiver.sink.workspaceId,
    })
    expect(updated.current()).toBe(false)
    expect(get.call(f.controller, restored, f.pkg.manifest.id).current()).toBe(true)
  })
  it('keeps an old frozen source admitted when the new owner uses a versioned source', async () => {
    const f = await fixture()
    const legacy = repoListFor(f.pkg.release)
    const raw = Buffer.from(
      JSON.stringify({
        format: 2,
        entries: legacy.entries.map((entry) => ({ ...entry, legacy: true })),
      }),
    )
    const legacyRaw = Buffer.from(JSON.stringify(legacy))
    const source = parseRepoPluginList(raw, f.opts.target, '1.0.0')
    const old = parseRepoPluginList(legacyRaw, f.opts.target, '1.0.0')
    const options = {
      ...f.opts,
      pinnedPublicKey: null,
      repoCatalogueSha256: source.sha256,
      catalogue: { bytes: source.bytes, signature: Buffer.alloc(0) },
      repoList: { bytes: raw, sha256: pluginSha256(raw), appVersion: '1.0.0' },
      legacyRepoList: { bytes: legacyRaw, sha256: pluginSha256(legacyRaw), appVersion: '1.0.0' },
    }
    const controller = await PluginLifecycleController.open(options)
    const bridge = await servePersonPluginControl({
      root: f.root,
      key: 'b'.repeat(64),
      controller,
      read: async () => ({}),
    })
    closers.push(() => bridge.close())
    const client = await oldClient({
      root: f.root,
      path: bridge.path,
      personKey: 'b'.repeat(64),
      pinnedPublicKey: null,
      repoCatalogueSha256: old.sha256,
      target: f.opts.target,
      catalogue: { bytes: old.bytes, signature: Buffer.alloc(0) },
      projection: projection().sink,
      propose() {},
    })
    closers.push(() => client.close())
    expect((await client.catalogue()).map((entry) => entry.id)).toEqual([f.pkg.manifest.id])
  })
  it('negotiates contribution support without expanding the strict attach reply', async () => {
    const f = await fixture()
    const bridge = await servePersonPluginControl({
      root: f.root,
      key: 'c'.repeat(64),
      controller: f.controller,
      read: async () => ({}),
    })
    closers.push(() => bridge.close())
    const client = await connectPluginSettings({
      path: bridge.path,
      personKey: 'c'.repeat(64),
      root: f.root,
      pinnedPublicKey: f.opts.pinnedPublicKey,
      target: f.opts.target,
      catalogue: { bytes: f.pkg.bytes, signature: f.pkg.signature },
      projection: projection().sink,
      propose() {},
    })
    closers.push(() => client.close())
    const features = Reflect.get(client, 'features') as (() => readonly string[]) | undefined
    expect(features?.()).toEqual(expect.arrayContaining(['contributions-v1', 'hooks-v1']))
  })
  it.each(['speech.transcribe', 'transcript.cleanup'])(
    'does not start a reserved-only %s executor',
    async (kind) => {
      const f = await generic(kind)
      const policy = Reflect.get(nodeHost, 'pluginNodePolicy') as (pkg: unknown) => unknown
      expect(typeof policy).toBe('function')
      expect(() => policy(verified(f.pkg))).toThrow()
    },
  )
  it('uses a distinct fixed hook readiness route, without MCP or person-admin credentials', async () => {
    const health = Reflect.get(nodeHost, 'authenticatedHookHealth') as (
      input: Record<string, unknown>,
    ) => Promise<void>
    expect(typeof health).toBe('function')
    const fetch = vi.fn(
      async (_url: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        return headers.get('Authorization') === 'Bearer fictional-hook-capability'
          ? Response.json({ ok: true, version: '1.0.0', hookProtocol: 1 })
          : new Response('', { status: 401 })
      },
    )
    await health({
      origin: 'http://127.0.0.1:1234',
      hookToken: 'fictional-hook-capability',
      otherTokens: ['fictional-tool-capability', 'fictional-person-capability'],
      version: '1.0.0',
      fetch,
    })
    expect(
      fetch.mock.calls.every(([url]) => String(url) === 'http://127.0.0.1:1234/v1/hooks/healthz'),
    ).toBe(true)
    expect(
      fetch.mock.calls.some(
        ([, init]) =>
          new Headers(init?.headers).get('Authorization') === 'Bearer fictional-hook-capability',
      ),
    ).toBe(true)
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/mcp'))).toBe(false)
  })
})
