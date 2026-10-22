import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { FakeBrowser } from './fakes'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import * as chromeBinding from '../../../apps/desktop/src/main/plugins/lifecycle/chrome-broker'
import { createLifecycleAgentBridge } from '../../../apps/desktop/src/main/plugins/lifecycle/agent-bridge'
import { Installation } from '../../../apps/desktop/src/main/plugins/state/format'
import type { LifecycleWorkspace } from '../../../apps/desktop/src/main/plugins/lifecycle/types'
import { createPluginNodeHost } from '../../../apps/desktop/src/main/plugins/node-host'
import {
  preparePluginNodeRuntime,
  runtimeFiles,
} from '../../../apps/desktop/src/main/plugins/node-runtime'
import { liveGroupMembers } from '../../../apps/desktop/resources/plugin-host/process-groups.mjs'
import { createPluginVerifier } from '../../../apps/desktop/src/main/plugins/package-verifier'
import { fictionalPublicKey, signed } from '../../../apps/desktop/test/plugin-package-fixtures'
const artifact = process.env.BROCREW_CHROME_TEST_ARTIFACT
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function builtInventory(
  run: (fixture: {
    view: Parameters<typeof chromeBinding.chromeBrokerBinding>[0]
    inventory: Awaited<ReturnType<Client['listTools']>>
    inventoryReply(tools: Awaited<ReturnType<Client['listTools']>>['tools']): void
    routes(): Promise<Awaited<ReturnType<ReturnType<typeof createLifecycleAgentBridge>['routes']>>>
    agent(): Promise<Client>
  }) => Promise<void>,
) {
  expect(artifact, 'Build a fresh artifact and set BROCREW_CHROME_TEST_ARTIFACT').toBeTruthy()
  const archive = fs.readFileSync(path.join(artifact!, 'chrome.tar'))
  const release = JSON.parse(fs.readFileSync(path.join(artifact!, 'fixture-release.json'), 'utf8'))
  const catalogue = signed({ format: 2, entries: [release] })
  const pkg = createPluginVerifier({
    pinnedPublicKey: fictionalPublicKey,
    target: { os: 'darwin', cpu: 'arm64' },
  })
    .verifyCatalogue(catalogue.bytes, catalogue.signature)
    .verifyPackage('chrome', release.version, archive)
  const built = await import(pathToFileURL(path.join(artifact!, 'package/server.mjs')).href)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-built-inventory-'))
  const store = built.createProfileStore({ home })
  const browser = new FakeBrowser(store.dirOf)
  const config = {
    port: 0,
    home,
    workspace: path.join(home, 'files'),
    downloadsRoot: path.join(home, 'downloads'),
    authPath: '',
    token: 'a'.repeat(64),
    adminToken: 'b'.repeat(64),
  }
  const clients: Client[] = []
  let server, bridge: ReturnType<typeof createLifecycleAgentBridge> | undefined
  try {
    server = await built.startAgentChrome(config, {
      browser,
      store,
      logger: { info() {}, warn() {}, error() {} },
    })
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    const workspaceId = randomUUID()
    const view = {
      package: pkg,
      workspaceId,
      current: () => true,
      connection: Promise.resolve({
        serverPid: process.pid,
        origin,
        mcp: () => ({
          url: origin + '/mcp',
          headers: { Authorization: `Bearer ${config.token}` },
        }),
        admin: () => ({
          url: origin + '/v1',
          headers: { Authorization: `Bearer ${config.adminToken}` },
        }),
      }),
      installation: Installation.parse({
        pluginId: 'chrome',
        installId: randomUUID(),
        incarnation: randomUUID(),
        lifecycleSequence: 1,
        releaseRevision: 1,
        configRevision: 0,
        phase: 'active',
        release: {
          version: release.version,
          archiveSha256: release.archive.sha256,
          manifestSha256: release.manifestSha256,
          dataSchema: pkg.manifest.dataSchema,
        },
      }),
    }
    async function connect(url: string, capability: string) {
      const client = new Client({ name: 'fictional-built-inventory', version: '1' })
      client.onerror = () => undefined
      clients.push(client)
      await client.connect(
        new StreamableHTTPClientTransport(new URL(url), {
          requestInit: { headers: { Authorization: `Bearer ${capability}` } },
        }),
      )
      return client
    }
    const source = await connect(origin + '/mcp', config.token)
    const inventory = await source.listTools()
    bridge = createLifecycleAgentBridge({
      owner: { valid: () => true },
      controller: {
        attach: async () => ({}) as LifecycleWorkspace,
        detach: async () => {},
        agentAttachments: () => [view],
      },
      binding: chromeBinding.chromeBrokerBinding,
    })
    const routes = () =>
      bridge!.routes(
        {
          id: randomUUID(),
          workspace: 'a'.repeat(64),
          generation: randomUUID(),
          epoch: randomUUID(),
          counter: 0,
          renewedAt: 0,
          minor: 0,
          features: [],
        },
        {
          kind: 'agent-routes',
          workspaceId,
          incarnation: randomUUID(),
          workspace: 'a'.repeat(64),
          generation: randomUUID(),
          lease: 'b'.repeat(64),
          occupied: ['brobot'],
          release: false,
        },
      )
    await run({
      view,
      inventory,
      routes,
      inventoryReply(tools) {
        const actualFetch = globalThis.fetch
        vi.stubGlobal('fetch', async (url, init) => {
          const packet = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
          if (String(url) === origin + '/mcp' && packet?.method === 'tools/list')
            return new Response(
              JSON.stringify({ jsonrpc: '2.0', id: packet.id, result: { tools } }),
              {
                headers: { 'content-type': 'application/json' },
              },
            )
          return actualFetch(url, init)
        })
      },
      async agent() {
        const result = await routes()
        expect(result).toHaveLength(1)
        return connect(result[0]!.url, result[0]!.capability)
      },
    })
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    for (const client of clients.reverse()) await client.close()
    await bridge?.close()
    await server?.close()
    fs.rmSync(home, { recursive: true, force: true })
  }
}
describe('Chrome release fixture', () => {
  it.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64')(
    'the real Node host admits the built release and proves exact-run exit with an inert browser',
    async () => {
      expect(artifact, 'Build a fresh artifact and set BROCREW_CHROME_TEST_ARTIFACT').toBeTruthy()
      const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-built-host-')))
      let host: ReturnType<typeof createPluginNodeHost> | undefined
      try {
        const runtime = await preparePluginNodeRuntime({
          resourcesRoot: path.resolve('apps/desktop/resources'),
          durableRoot: path.join(root, 'runtimes'),
        })
        const { node } = await runtimeFiles(runtime)
        const browser = path.join(root, 'inert-browser')
        fs.writeFileSync(
          browser,
          `#!${node}\nimport fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';\nconst child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});\nfs.writeFileSync(path.join(process.env.BROCREW_CHROME_DATA,'fake-browser.json'),JSON.stringify({pid:process.pid,child:child.pid}));\nprocess.on('SIGTERM',()=>{});setInterval(()=>{},1000);\n`,
          { mode: 0o700 },
        )
        const archive = fs.readFileSync(path.join(artifact!, 'chrome.tar'))
        const release = JSON.parse(
          fs.readFileSync(path.join(artifact!, 'fixture-release.json'), 'utf8'),
        )
        const catalogue = signed({ format: 2, entries: [release] })
        const checked = createPluginVerifier({
          pinnedPublicKey: fictionalPublicKey,
          target: { os: 'darwin', cpu: 'arm64' },
        })
          .verifyCatalogue(catalogue.bytes, catalogue.signature)
          .verifyPackage('chrome', release.version, archive)
        host = createPluginNodeHost({
          root: path.join(root, 'host'),
          runtime,
          browserExecutable: browser,
          readyMs: 5000,
        })
        const child = await host.start({ package: checked, releaseDigest: release.archive.sha256 })
        const ready = await child.ready()
        const health = await fetch(ready.origin + '/healthz', { headers: ready.admin().headers })
        expect(await health.json()).toMatchObject({ ok: true, version: checked.manifest.version })
        const headers = { ...ready.admin().headers, 'content-type': 'application/json' }
        const made = await fetch(ready.origin + '/v1/profiles', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: 'fir' }),
        })
        expect(made.status).toBe(201)
        await made.body?.cancel()
        const opening = fetch(ready.origin + '/v1/profiles/fir/open', {
          method: 'POST',
          headers,
          body: '{}',
          signal: AbortSignal.timeout(20000),
        })
          .then(async (response) => {
            await response.body?.cancel()
          })
          .catch(() => {})
        let ids: { pid: number; child: number } | undefined
        const file = path.join(root, 'host/data/chrome/fake-browser.json')
        for (let attempt = 0; attempt < 100 && !ids; attempt++) {
          if (fs.existsSync(file)) ids = JSON.parse(fs.readFileSync(file, 'utf8'))
          else await new Promise((resolve) => setTimeout(resolve, 25))
        }
        expect(ids).toBeDefined()
        expect(await liveGroupMembers(ready.serverPid)).toContain(ids!.child)
        expect(await child.stop()).toEqual({ exited: true })
        expect(await child.exited).toEqual({ exited: true })
        expect(await liveGroupMembers(ready.serverPid)).toEqual([])
        const receipt = JSON.parse(fs.readFileSync(child.receiptPath, 'utf8'))
        expect(receipt).toMatchObject({ runId: child.runId, exited: true })
        await opening
      } finally {
        if (host) expect(await host.stop()).toEqual({ exited: true })
        fs.rmSync(root, { recursive: true, force: true })
      }
    },
    30000,
  )
  it('keeps the closed refusal log bounded and owner-private across repeated connections', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-tool-refusal-'))
    try {
      const record = chromeBinding.pluginToolRefusalLog(root)
      await Promise.all([record(), record()])
      await chromeBinding.pluginToolRefusalLog(root)()
      expect(fs.readdirSync(root)).toEqual(['plugin-tool-refusals.log'])
      const file = path.join(root, 'plugin-tool-refusals.log')
      expect(fs.readFileSync(file, 'utf8')).toBe('Some plugin tools were refused.\n')
      if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o400)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
  it('binds the complete built author-bearing inventory and pins allowlist parity with no filtered list', async () => {
    await builtInventory(async ({ view, inventory, agent }) => {
      const advertised = inventory.tools.map((tool) => tool.name).sort()
      expect(advertised).toHaveLength(34)
      expect(advertised).toContain('show_tab')
      expect(advertised).toContain('hide_tab')
      expect(
        Math.max(...inventory.tools.map((tool) => tool.description?.length ?? 0)),
      ).toBeLessThanOrEqual(2000)
      const client = await agent()
      expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual(advertised)
      const binding = await chromeBinding.chromeBrokerBinding(view)
      expect(binding.tools.map((tool) => tool.name).sort()).toEqual(advertised)
      const declared = view.package.manifest.permissions.resources
      expect(declared.map((resource) => resource.id)).toEqual([
        chromeBinding.chromeBrokerResourceId,
      ])
      expect(binding.resources).toEqual(
        declared.map(({ id, read, write }) => ({ id, read, write })),
      )
      for (const name of ['show_tab', 'hide_tab']) {
        const prepared = await binding.tools
          .find((tool) => tool.name === name)!
          .prepare({ tabId: 't1' })
        expect(prepared.resources).toEqual([
          { resource: chromeBinding.chromeBrokerResourceId, key: 't1', mode: 'write' },
        ])
      }
      expect(
        (await client.callTool({ name: 'list_browser_profiles', arguments: {} })).isError,
      ).not.toBe(true)
      expect([...chromeBinding.chromeBrokerToolNames].sort()).toEqual(advertised)
    })
  })
  it.each(['show_tab', 'hide_tab'])(
    'admits %s even in an inventory under the old count limit',
    async (name) => {
      await builtInventory(async ({ inventory, inventoryReply, agent }) => {
        // A diagnostic subset only: the separate parity control always consumes all 34 real tools.
        const selected = [
          ...inventory.tools
            .filter((tool) => !['show_tab', 'hide_tab'].includes(tool.name))
            .slice(0, 31),
          inventory.tools.find((tool) => tool.name === name)!,
        ]
        expect(selected).toHaveLength(32)
        inventoryReply(selected)
        const client = await agent()
        expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual(
          selected.map((tool) => tool.name).sort(),
        )
      })
    },
  )
  it('refuses a missing declared resource and never broadens its read/write permissions', async () => {
    await builtInventory(async ({ view }) => {
      const changed = (resources: typeof view.package.manifest.permissions.resources) => ({
        ...view,
        package: {
          ...view.package,
          manifest: {
            ...view.package.manifest,
            permissions: { ...view.package.manifest.permissions, resources },
          },
        },
      })
      await expect(chromeBinding.chromeBrokerBinding(changed([]))).rejects.toThrow('unavailable')
      const resource = view.package.manifest.permissions.resources[0]!
      for (const mode of ['read', 'write'] as const) {
        const binding = await chromeBinding.chromeBrokerBinding(
          changed([{ ...resource, [mode]: false }]),
        )
        const other = mode === 'read' ? 'write' : 'read'
        expect(binding.isAllowed({} as never, { resource: resource.id, key: 'fern', mode })).toBe(
          false,
        )
        expect(
          binding.isAllowed({} as never, { resource: resource.id, key: 'fern', mode: other }),
        ).toBe(true)
        expect(
          binding.isAllowed({} as never, {
            resource: 'fictional-foreign',
            key: 'fern',
            mode: other,
          }),
        ).toBe(false)
      }
    })
  })
  it('drops only an unknown tool while the complete built inventory still reaches agents, with a closed log', async () => {
    await builtInventory(async ({ inventory, inventoryReply, agent }) => {
      const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
      inventoryReply([
        ...inventory.tools,
        { name: 'fictional_unreviewed', inputSchema: { type: 'object' } },
      ])
      const client = await agent()
      expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual(
        inventory.tools.map((tool) => tool.name).sort(),
      )
      expect(log.mock.calls).toEqual([['Some plugin tools were refused.']])
      const refused = await client.callTool({ name: 'fictional_unreviewed', arguments: {} })
      expect(refused.isError).toBe(true)
      expect(JSON.stringify(refused)).not.toContain('fictional_unreviewed')
    })
  })
  it('refuses a credential-bearing definition alone and never includes its bytes in the log', async () => {
    await builtInventory(async ({ inventory, inventoryReply, agent, view }) => {
      const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const credential = (await view.connection).mcp().headers.Authorization.slice('Bearer '.length)
      inventoryReply(
        inventory.tools.map((tool) =>
          tool.name === 'snapshot' ? { ...tool, description: credential } : tool,
        ),
      )
      const client = await agent()
      const tools = (await client.listTools()).tools
      expect(tools).toHaveLength(33)
      expect(tools.some((tool) => tool.name === 'snapshot')).toBe(false)
      expect(JSON.stringify(tools)).not.toContain(credential)
      expect(log.mock.calls).toEqual([['Some plugin tools were refused.']])
    })
  })
  it('has a strict manifest with no optional skills or service templates', () => {
    const template = JSON.parse(fs.readFileSync('plugins/chrome/manifest-template.json', 'utf8'))
    expect(template.skills).toEqual([])
    expect(template.serviceTemplates).toEqual([])
    expect(template.server).toEqual({ entry: 'server.mjs', mcpPath: '/mcp', adminPath: '/v1' })
    expect(Object.keys(template.ui.methodSchemas)).toEqual([
      'read',
      'subscribe',
      'unsubscribe',
      'proposeConfig',
    ])
  })
  it('verifies the real USTAR with the app verifier and an in-memory fictional key, then refuses tampering', async () => {
    expect(artifact, 'Build a fresh artifact and set BROCREW_CHROME_TEST_ARTIFACT').toBeTruthy()
    const root = artifact!
    const archive = fs.readFileSync(path.join(root, 'chrome.tar'))
    const release = JSON.parse(fs.readFileSync(path.join(root, 'fixture-release.json'), 'utf8'))
    expect(release.archive.sha256).toBe(hash(archive))
    const catalogue = signed({ format: 2, entries: [release] })
    const verifier = createPluginVerifier({
      pinnedPublicKey: fictionalPublicKey,
      target: { os: 'darwin', cpu: 'arm64' },
    })
    const trusted = verifier.verifyCatalogue(catalogue.bytes, catalogue.signature)
    const checked = trusted.verifyPackage(
      'chrome',
      JSON.parse(fs.readFileSync('plugins/chrome/manifest-template.json', 'utf8')).version,
      archive,
    )
    expect(checked.compatibility).toEqual({ host: true, tools: true, ui: true })
    expect(checked.manifest.skills).toEqual([])
    expect(checked.manifest.serviceTemplates).toEqual([])
    expect(checked.filePaths.length).toBeGreaterThan(100)
    for (const name of checked.filePaths) {
      expect(name).not.toMatch(/(?:^|\/)\.\.|\.(?:sh|bash|zsh|bat|cmd|ps1)$/i)
      expect(fs.lstatSync(path.join(root, 'package', name)).isSymbolicLink()).toBe(false)
      if (name.endsWith('package.json')) {
        const meta = JSON.parse(Buffer.from(checked.readFile(name)!).toString())
        expect(meta.scripts).toBeUndefined()
        expect(meta.hooks).toBeUndefined()
        expect(meta.gypfile).toBeUndefined()
      }
    }
    const changed = Buffer.from(archive)
    changed[512] ^= 1
    expect(() =>
      trusted.verifyPackage(
        'chrome',
        JSON.parse(fs.readFileSync('plugins/chrome/manifest-template.json', 'utf8')).version,
        changed,
      ),
    ).toThrow()
    const wrong = Buffer.from(catalogue.signature)
    wrong[0] ^= 1
    expect(() => verifier.verifyCatalogue(catalogue.bytes, wrong)).toThrow()
    const built = await import(pathToFileURL(path.join(root, 'package/server.mjs')).href)
    expect(typeof built.startAgentChrome).toBe('function')
    expect(typeof built.createProfileStore).toBe('function')
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-built-chrome-'))
    const store = built.createProfileStore({ home })
    const browser = new FakeBrowser(store.dirOf)
    const config = {
      port: 0,
      home,
      workspace: path.join(home, 'files'),
      downloadsRoot: path.join(home, 'downloads'),
      authPath: '',
      token: 'fictional-built-tool-'.repeat(4),
      adminToken: 'fictional-built-person-'.repeat(4),
    }
    let server
    try {
      server = await built.startAgentChrome(config, {
        browser,
        store,
        logger: { info() {}, warn() {}, error() {} },
      })
      const base = `http://127.0.0.1:${server.httpServer.address().port}`
      const response = await fetch(base + '/v1/profiles', {
        headers: { authorization: `Bearer ${config.adminToken}` },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ profiles: [] })
      const refused = await fetch(base + '/v1/profiles', {
        headers: { authorization: `Bearer ${config.token}` },
      })
      expect(refused.status).toBe(401)
      await refused.body?.cancel()
      expect(browser.launches).toHaveLength(0)
    } finally {
      await server?.close()
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})
