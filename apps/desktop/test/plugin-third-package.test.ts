import { afterEach, expect, it } from 'vitest'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { createPluginToolBroker } from '../src/main/plugins/tool-broker'
import { cleanupLifecycleFixtures, deferred, fixture } from './plugin-lifecycle-fixtures'
import { pluginProviderFixture, PLUGIN_MARKER } from './fixtures/plugin-provider-fixture'

afterEach(cleanupLifecycleFixtures)

it.each([1, 2] as const)(
  'installs, discovers and calls a format %s MCP package without an app adapter or UI',
  async (format) => {
    const f = await fixture({}, 'fictional-orchid', {
      format,
      ...(format === 2
        ? {
            authors: ['brocrew'],
            executor: { kind: 'node' as const, entry: 'dist/recipe.mjs' },
            hooks: [],
          }
        : {}),
      ui: null,
      uiApi: null,
      serviceTemplates: [],
      permissions: { description: 'Fictional package owns its tool inputs.', resources: [] },
    })
    const remote = await pluginProviderFixture({
      toolMetadata: { annotations: { readOnlyHint: true }, _meta: { packageOwned: 'orchid' } },
    })
    let broker: ReturnType<typeof createPluginToolBroker> | undefined
    try {
      const endpoint = await remote.route('fictional-package-endpoint')
      const start = f.opts.runtime.start.bind(f.opts.runtime)
      f.opts.runtime.start = async (spec) => {
        const run = await start(spec)
        const exited = deferred<void>()
        return {
          ...run,
          exited: exited.promise,
          async ready() {
            const ready = await run.ready()
            return {
              ...ready,
              mcp: () => ({
                url: endpoint.server.url,
                headers: { Authorization: `Bearer ${endpoint.server.capability}` },
              }),
            }
          },
          async stop() {
            await run.stop()
            exited.resolve()
          },
        }
      }
      if (format === 2) {
        const prepared = await f.controller.prepareMutation(
          f.handle,
          'install',
          f.pkg.manifest.id,
          f.pkg.release.archive.sha256,
          pluginSha256(f.pkg.bytes),
        )
        await f.controller.installPrepared(f.handle, f.pkg.manifest.id, prepared)
      } else await f.controller.install(f.handle, f.pkg.manifest.id)
      expect(f.starts()).toBe(1)
      const [view] = f.controller.agentAttachments(f.local.sink.workspaceId)
      expect(view?.installation.pluginId).toBe('fictional-orchid')
      const entry = f.controller.contributions(f.handle, f.pkg.manifest.id)
      expect(entry.contributions.configuration).toBeNull()
      expect(entry.contributions.tools).toBeTypeOf('function')
      const binding = await entry.contributions.tools!(view!)
      broker = createPluginToolBroker({
        ...binding,
        binding: {
          pluginId: view!.installation.pluginId,
          installId: view!.installation.installId,
          epoch: view!.runId,
        },
        reservedNamespace: 'brobot',
        hostToolNames: [],
        occupiedNamespaces: [],
        occupiedQualifiedNames: [],
      })
      const agent = broker.owner.grantAgent(
        broker.owner.attach(f.local.sink.workspaceId),
        'fictional-agent',
      )
      const [tool] = broker.agent.discover(agent)
      expect(tool).toMatchObject({
        name: 'echo',
        annotations: { readOnlyHint: true },
        _meta: { packageOwned: 'orchid' },
      })
      expect(
        await broker.agent.call(agent, tool!.qualifiedName, { profile: 'fern' }),
      ).toMatchObject({
        content: [{ type: 'text', text: PLUGIN_MARKER }],
        _meta: { fixture: true },
      })
      expect(remote.seen).toEqual([{ method: 'tools/call', authenticated: true }])
    } finally {
      try {
        broker?.owner.invalidate()
        await f.controller.drain()
      } finally {
        await remote.close()
      }
    }
  },
)
