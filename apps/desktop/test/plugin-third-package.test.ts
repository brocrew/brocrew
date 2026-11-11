import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { createPluginNodeHost, type PluginNodeProcess } from '../src/main/plugins/node-host'
import { PLUGIN_HOST_SCRIPTS, preparePluginNodeRuntime } from '../src/main/plugins/node-runtime'
import { ownedPluginNodeProcess } from '../src/main/plugins/supervisor/node-host'
import { createPluginToolBroker } from '../src/main/plugins/tool-broker'
import { cleanupLifecycleFixtures, fixture } from './plugin-lifecycle-fixtures'
import { manifestFor, packageFixture } from './plugin-package-fixtures'
import { thirdPartyMcpSource } from './fixtures/third-party-mcp-source'

const teardowns: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of teardowns.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})

async function runtimeAt(root: string) {
  const resources = join(root, 'resources')
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
  const binary = await readFile(process.execPath)
  await mkdir(join(resources, 'plugin-node'), { recursive: true })
  await writeFile(join(resources, 'plugin-node', nodeName), binary)
  await writeFile(join(resources, 'plugin-node/LICENSE'), 'Fictional runtime fixture licence')
  await writeFile(
    join(resources, 'plugin-node/runtime.json'),
    JSON.stringify({
      format: 1,
      platform: process.platform,
      arch: process.arch,
      version: process.versions.node,
      sha256: pluginSha256(binary),
    }),
  )
  await mkdir(join(resources, 'plugin-host'))
  for (const name of PLUGIN_HOST_SCRIPTS)
    await copyFile(
      resolve(__dirname, '../resources/plugin-host', name),
      join(resources, 'plugin-host', name),
    )
  return preparePluginNodeRuntime({ resourcesRoot: resources, durableRoot: join(root, 'runtimes') })
}

it.each([1, 2] as const)(
  'installs, starts, discovers and calls a format %s third-party Node MCP package',
  async (format) => {
    const source = Buffer.from(thirdPartyMcpSource)
    const files = new Map([['server.mjs', source]])
    const manifest = manifestFor(files)
    Object.assign(manifest, {
      id: 'fictional-orchid',
      format,
      ...(format === 2
        ? { authors: ['fictional'], executor: { kind: 'node', entry: 'server.mjs' }, hooks: [] }
        : {}),
      platforms: [{ os: process.platform, cpu: process.arch }],
      server: { entry: 'server.mjs', mcpPath: '/mcp', adminPath: '/admin' },
      ui: null,
      uiApi: null,
      serviceTemplates: [],
      permissions: { description: 'Echo a fictional profile.', resources: [] },
    })
    const pkg = packageFixture({ files, manifest })
    const f = await fixture(
      {
        catalogue: { bytes: pkg.bytes },
        download: async () => pkg.archive,
        names: {},
      },
      manifest.id,
      manifest,
    )
    let broker: ReturnType<typeof createPluginToolBroker> | undefined
    const children: PluginNodeProcess[] = []
    teardowns.push(() => f.controller.drain())
    try {
      const host = createPluginNodeHost({
        root: join(f.root, 'node-host'),
        runtime: await runtimeAt(f.parent),
        readyMs: 5000,
      })
      teardowns.push(async () => {
        expect(await host.stop()).toEqual({ exited: true })
      })
      f.opts.runtime.start = async (spec) => {
        const child = await host.start(spec)
        children.push(child)
        const owned = ownedPluginNodeProcess(child)
        return {
          runId: child.runId,
          ready: () => child.ready(),
          exited: owned.exited,
          async stop() {
            await owned.stop()
          },
        }
      }
      if (format === 2) {
        const prepared = await f.controller.prepareMutation(
          f.handle,
          'install',
          manifest.id,
          pkg.release.archive.sha256,
          pluginSha256(pkg.bytes),
        )
        await f.controller.installPrepared(f.handle, manifest.id, prepared)
      } else await f.controller.install(f.handle, manifest.id)
      expect(children).toHaveLength(1)
      const ready = await children[0]!.ready()
      expect(ready.serverPid).not.toBe(process.pid)
      const [view] = f.controller.agentAttachments(f.local.sink.workspaceId)
      expect(view?.installation.pluginId).toBe(manifest.id)
      const entry = f.controller.contributions(f.handle, manifest.id)
      expect(entry.contributions.configuration).toBeNull()
      const binding = await entry.contributions.tools!(view!)
      broker = createPluginToolBroker({
        ...binding,
        binding: {
          pluginId: manifest.id,
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
        content: [{ type: 'text', text: 'Fictional plugin result: fern' }],
        _meta: {
          pid: ready.serverPid,
          home: join(f.root, 'node-host/data/fictional-orchid'),
          packageOwned: 'orchid',
        },
      })
    } finally {
      try {
        broker?.owner.invalidate()
        await f.controller.drain()
      } finally {
        for (const child of children) expect(await child.stop()).toEqual({ exited: true })
      }
    }
  },
  20000,
)
