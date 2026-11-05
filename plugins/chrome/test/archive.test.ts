import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { FakeBrowser } from './fakes'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { pluginMcpClient } from '../../../apps/desktop/src/main/plugins/lifecycle/broker-inventory'
import type { AgentAttachmentView } from '../../../apps/desktop/src/main/plugins/lifecycle/controller'
import type { ProfileStore } from '../src/profiles/store.js'
import { loadConfig } from '../src/config.js'
import {
  bootstrapEnv,
  connectPackage,
  personMetadata,
  resultJson,
  resultText,
} from './ordinary-package-fixture.js'
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
type Inventory = Awaited<ReturnType<Client['listTools']>>
async function builtInventory(
  run: (fixture: {
    view: AgentAttachmentView
    inventory: Inventory
    authored: Inventory['tools']
    documentation: Inventory['tools']
    source: Client
    store: ProfileStore
    browser: FakeBrowser
    home: string
    token: string
    diagnostics: unknown[][]
    inventoryReply(tools: Inventory['tools']): void
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
  const authored = JSON.parse(
    Buffer.from(pkg.readFile('tools.json')!).toString(),
  ) as Inventory['tools']
  const built = await import(pathToFileURL(path.join(artifact!, 'package/server.mjs')).href)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-built-inventory-'))
  const store: ProfileStore = built.createProfileStore({ home })
  const browser = new FakeBrowser(store.dirOf)
  const config = loadConfig(bootstrapEnv(home))
  const clients: Client[] = [],
    diagnostics: unknown[][] = []
  let server, bridge: ReturnType<typeof createLifecycleAgentBridge> | undefined
  try {
    server = await built.startAgentChrome(config, {
      browser,
      store,
      logger: { info() {}, warn() {}, error() {} },
    })
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    const source = await connectPackage(origin, config.token)
    clients.push(source)
    const inventory = await source.listTools()
    const workspaceId = randomUUID()
    const view: AgentAttachmentView = {
      package: pkg,
      runId: randomUUID(),
      workspaceId,
      current: () => true,
      // No physical process was stopped; this promise never fabricates an exit witness.
      exited: new Promise<void>(() => {}),
      connection: Promise.resolve({
        serverPid: process.pid,
        origin,
        client: source,
        mcp: () => {
          throw new Error('Generic forwarding must reuse the retained client')
        },
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
          dataSchema: pkg.contract.data.schema,
        },
      }),
    }
    bridge = createLifecycleAgentBridge({
      owner: { valid: () => true },
      controller: {
        attach: async () => ({}) as LifecycleWorkspace,
        detach: async () => {},
        agentAttachments: () => [view],
        onHostChanged: () => () => {},
        agentScope: () => ({
          workspaceId,
          revision: 1,
          entries: [
            {
              is: 'admitted',
              enabled: true,
              pluginId: 'chrome',
              installId: view.installation.installId,
              runId: view.runId,
              switchRevision: 1,
              view,
            },
          ],
        }),
      },
      diagnostic: (...values) => {
        diagnostics.push(values)
      },
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
      authored,
      documentation: authored,
      source,
      store,
      browser,
      home,
      token: config.token,
      diagnostics,
      routes,
      inventoryReply(tools) {
        vi.spyOn(source, 'listTools').mockResolvedValue({ tools })
      },
      async agent() {
        const result = await routes()
        expect(result.unknown).toBe(false)
        expect(result.pending).toEqual([])
        expect(result.none).toEqual([])
        expect(result.servers).toHaveLength(1)
        const route = result.servers[0]!
        expect(route.pluginId).toBe('chrome')
        const client = new Client({ name: 'fictional-built-agent', version: '1' })
        clients.push(client)
        await client.connect(
          new StreamableHTTPClientTransport(new URL(route.url), {
            requestInit: { headers: { Authorization: `Bearer ${route.capability}` } },
          }),
        )
        return client
      },
    })
  } finally {
    vi.restoreAllMocks()
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
      const previousExecutable = process.env.BROCREW_CHROME_EXECUTABLE
      try {
        const runtime = await preparePluginNodeRuntime({
          resourcesRoot: path.resolve('apps/desktop/resources'),
          durableRoot: path.join(root, 'runtimes'),
        })
        const { node } = await runtimeFiles(runtime)
        const browser = path.join(root, 'inert-browser')
        fs.writeFileSync(
          browser,
          `#!${node}\nimport fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';\nconst child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});\nfs.writeFileSync(path.join(process.env.BROCREW_PLUGIN_DATA,'fake-browser.json'),JSON.stringify({pid:process.pid,child:child.pid}));\nprocess.on('SIGTERM',()=>{});setInterval(()=>{},1000);\n`,
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
        process.env.BROCREW_CHROME_EXECUTABLE = browser
        host = createPluginNodeHost({
          root: path.join(root, 'host'),
          runtime,
          readyMs: 5000,
        })
        const child = await host.start({ package: checked, releaseDigest: release.archive.sha256 })
        const ready = await child.ready()
        expect(ready.client).toBeDefined()
        const client = ready.client!
        expect(client.getServerVersion()?.version).toBe(checked.manifest.version)
        const made = await client.callTool({
          name: 'configure_profile',
          arguments: { action: 'create-profile', profile: 'fir' },
          _meta: personMetadata,
        })
        expect(made.isError).not.toBe(true)
        expect(resultJson(made)).toEqual({ profile: 'fir', completed: true })
        const opening = client
          .callTool(
            {
              name: 'configure_profile',
              arguments: { action: 'open-window', profile: 'fir' },
              _meta: personMetadata,
            },
            undefined,
            { timeout: 20000 },
          )
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
        if (previousExecutable === undefined) delete process.env.BROCREW_CHROME_EXECUTABLE
        else process.env.BROCREW_CHROME_EXECUTABLE = previousExecutable
        if (host) expect(await host.stop()).toEqual({ exited: true })
        fs.rmSync(root, { recursive: true, force: true })
      }
    },
    30000,
  )
  it('keeps complete inventories and scratch bytes unchanged without a retired refusal log across fresh connections', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-tool-refusal-'))
    try {
      const file = path.join(root, 'opaque-fixture')
      fs.writeFileSync(file, 'opaque fictional bytes')
      const before = fs
        .readdirSync(root)
        .map((name) => [name, hash(fs.readFileSync(path.join(root, name)))])
      await builtInventory(async ({ inventory, agent, diagnostics, home }) => {
        const bytes = () =>
          fs
            .readdirSync(home, { recursive: true })
            .map(String)
            .sort()
            .filter((name) => fs.lstatSync(path.join(home, name)).isFile())
            .map((name) => [name, hash(fs.readFileSync(path.join(home, name)))])
        const retained = bytes()
        for (let i = 0; i < 3; i++)
          expect((await (await agent()).listTools()).tools).toEqual(inventory.tools)
        expect(diagnostics).toEqual([])
        expect(bytes()).toEqual(retained)
        expect(fs.existsSync(path.join(home, 'plugin-tool-refusals.log'))).toBe(false)
      })
      expect(
        fs.readdirSync(root).map((name) => [name, hash(fs.readFileSync(path.join(root, name)))]),
      ).toEqual(before)
      expect(fs.existsSync(path.join(root, 'plugin-tool-refusals.log'))).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
  it('binds the complete authored inventory exactly through retained client and provider route', async () => {
    await builtInventory(async (fixture) => {
      const { view, inventory, authored, documentation, home, agent, source, store } = fixture
      for (const [name, placeholder, root] of [
        ['upload_file', '{roots}', path.join(home, 'files')],
        ['download', '{downloads}', path.join(home, 'downloads')],
        ['install_extension', '{roots}', path.join(home, 'files')],
      ] as const) {
        const documented = documentation.find((tool) => tool.name === name)!
        expect(documented.description).toContain(placeholder)
        expect(inventory.tools.find((tool) => tool.name === name)).toEqual({
          ...documented,
          description: documented.description!.replace(placeholder, () => root),
        })
      }
      expect(inventory.tools).toEqual(authored)
      expect(await pluginMcpClient(view)).toBe(source)
      expect((await (await pluginMcpClient(view)).listTools()).tools).toEqual(authored)
      const advertised = authored.map((tool) => tool.name)
      for (const name of ['show_tab', 'hide_tab', 'configure_profile', 'configuration_snapshot'])
        expect(advertised).toContain(name)
      for (const tool of authored) {
        if (tool.name === 'configuration_snapshot') expect(tool.inputSchema.properties).toEqual({})
        else expect(tool.inputSchema.required).toContain('profile')
      }
      const client = await agent()
      expect((await client.listTools()).tools).toEqual(authored)
      expect(
        (await client.callTool({ name: 'list_browser_profiles', arguments: {} })).isError,
      ).toBe(true)
      const snapshot = await client.callTool({ name: 'configuration_snapshot', arguments: {} })
      expect(snapshot.isError).not.toBe(true)
      expect(resultJson(snapshot)).toMatchObject({ profiles: [], tabs: [] })
      store.create('fern', 'panel')
      store.setFlags('fern', { enabled: true })
      const named = await client.callTool({
        name: 'list_browser_profiles',
        arguments: { profile: 'fern' },
      })
      expect(named.isError).not.toBe(true)
      expect(resultJson(named)).toContainEqual(expect.objectContaining({ name: 'fern' }))
    })
  })
  it.each(['show_tab', 'hide_tab'])(
    'forwards %s exactly under and above the old inventory count limit',
    async (name) => {
      await builtInventory(async ({ inventory, inventoryReply, agent }) => {
        const selected = [
          ...inventory.tools
            .filter((tool) => !['show_tab', 'hide_tab'].includes(tool.name))
            .slice(0, 31),
          inventory.tools.find((tool) => tool.name === name)!,
        ]
        expect(selected).toHaveLength(32)
        inventoryReply(selected)
        expect((await (await agent()).listTools()).tools).toEqual(selected)
        const expanded = [
          ...selected,
          {
            name: 'fictional_extra',
            description: 'Authored beyond old count',
            inputSchema: { type: 'object' as const },
          },
        ]
        inventoryReply(expanded)
        expect((await (await agent()).listTools()).tools).toEqual(expanded)
      })
    },
  )
  it('needs no legacy resources while disabled and foreign-profile calls refuse before effects', async () => {
    await builtInventory(async ({ view, inventory, agent, store, browser }) => {
      expect(view.package.contract.permissions).not.toHaveProperty('resources')
      const client = await agent()
      expect((await client.listTools()).tools).toEqual(inventory.tools)
      store.create('fern', 'panel')
      store.create('birch', 'panel')
      store.setFlags('fern', { enabled: true })
      store.setFlags('birch', { enabled: true })
      const opaque = path.join(store.dirOf('fern'), 'Cookies')
      fs.writeFileSync(opaque, 'opaque fictional browser bytes')
      const opened = await client.callTool({
        name: 'open_tab',
        arguments: { profile: 'fern', url: 'https://fictional.invalid/' },
      })
      expect(opened.isError).not.toBe(true)
      const tab = resultJson(opened)
      expect(tab.tabId).toEqual(expect.any(String))
      const before = {
        launches: [...browser.launches],
        closes: [...browser.closes],
        pages: browser.pages.get('fern')!.length,
      }
      const foreign = await client.callTool({
        name: 'close_tab',
        arguments: { profile: 'birch', tabId: tab.tabId },
      })
      expect(foreign.isError).toBe(true)
      expect(resultText(foreign)).toContain('tab must belong to the requested profile')
      store.setFlags('fern', { enabled: false })
      expect(
        (
          await client.callTool({
            name: 'open_tab',
            arguments: { profile: 'fern', url: 'https://fictional.invalid/refused' },
          })
        ).isError,
      ).toBe(true)
      expect(browser.launches).toEqual(before.launches)
      expect(browser.closes).toEqual(before.closes)
      expect(browser.pages.get('fern')).toHaveLength(before.pages)
      expect(fs.readFileSync(opaque, 'utf8')).toBe('opaque fictional browser bytes')
    })
  })
  it('forwards an author-advertised synthetic tool with unchanged arguments and results', async () => {
    await builtInventory(async ({ inventory, inventoryReply, agent, source }) => {
      const definition = {
        name: 'fictional_unreviewed',
        description: 'Ordinary authored extension',
        inputSchema: { type: 'object' as const, properties: { opaque: {} } },
      }
      inventoryReply([...inventory.tools, definition])
      const args = { opaque: { bytes: ['fictional', 7, null], origin: 'opaque author field' } }
      const reply = {
        isError: true,
        content: [{ type: 'text' as const, text: 'opaque fictional result' }],
        _meta: { author: 'retained' },
      }
      const actual = source.callTool.bind(source)
      const call = vi
        .spyOn(source, 'callTool')
        .mockImplementation((params, schema, options) =>
          params.name === definition.name
            ? Promise.resolve(reply)
            : actual(params, schema, options),
        )
      const client = await agent()
      expect((await client.listTools()).tools).toEqual([...inventory.tools, definition])
      expect(await client.callTool({ name: definition.name, arguments: args })).toEqual(reply)
      expect(call.mock.calls[0]![0]).toMatchObject({
        name: definition.name,
        arguments: args,
        _meta: { origin: 'agent' },
      })
      const unknown = await client.callTool({ name: 'fictional_genuinely_absent', arguments: {} })
      expect(unknown.isError).toBe(true)
      expect(unknown.content).toEqual([{ type: 'text', text: 'Unknown Chrome tool.' }])
    })
  })
  it('preserves opaque authored descriptors while generic error diagnostics omit transport auth and arguments', async () => {
    await builtInventory(
      async ({ inventory, inventoryReply, agent, source, token, diagnostics }) => {
        const marker = 'fictional-author-credential-marker'
        const tools = inventory.tools.map((tool) =>
          tool.name === 'snapshot' ? { ...tool, description: marker } : tool,
        )
        expect(tools.some((tool) => tool.description === marker)).toBe(true)
        inventoryReply(tools)
        const client = await agent()
        expect((await client.listTools()).tools).toEqual(tools)
        expect(JSON.stringify(tools)).not.toContain(token)
        vi.spyOn(source, 'callTool').mockRejectedValue(
          new Error(token + ' fictional-private-argument'),
        )
        const failure = await client
          .callTool({
            name: 'configuration_snapshot',
            arguments: { opaque: 'fictional-private-argument' },
          })
          .then(
            () => {
              throw new Error('Expected a generic transport rejection')
            },
            (error: unknown) => String(error),
          )
        expect(failure).toContain('Plugin call failed: transport.')
        expect(diagnostics.length).toBeGreaterThan(0)
        expect(JSON.stringify([diagnostics, failure])).not.toContain(token)
        expect(JSON.stringify([diagnostics, failure])).not.toContain('fictional-private-argument')
      },
    )
  })
  it('has the exact ordinary manifest contract and author disclosure', () => {
    const template = JSON.parse(fs.readFileSync('plugins/chrome/manifest-template.json', 'utf8'))
    expect(template.format).toBe(3)
    expect(template.runtime).toEqual({ kind: 'node', entry: 'server.mjs' })
    expect(template.mcp).toEqual({ transport: 'streamable-http', bootstrap: 'ready-message' })
    expect(template.tools).toEqual({ source: 'mcp', inventory: 'tools.json' })
    expect(template.settings).toEqual({
      page: { entry: 'ui/index.html', assets: ['ui/index.html', 'ui/app.js', 'ui/style.css'] },
    })
    expect(template.data).toEqual({
      schema: 1,
      compatibility: { minSchema: 1, maxSchema: 1 },
      migrateOnStart: true,
      rollback: 'code-only; retained data is never restored from an older snapshot',
    })
    expect(template.lifecycle).toEqual({
      stop: { signal: 'SIGTERM', graceMs: 5000 },
      dataOnRemove: 'keep',
    })
    expect(template.authors).toEqual(['brocrew'])
    expect(Object.keys(template.permissions)).toEqual(['description'])
    expect(template.permissions.description).toBeTruthy()
    for (const retired of ['server', 'admin', 'ui', 'skills', 'serviceTemplates'])
      expect(template).not.toHaveProperty(retired)
    expect(template.permissions).not.toHaveProperty('resources')
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
    expect(checked.contract.format).toBe(3)
    expect(checked.contract.runtime).toEqual({ kind: 'node', entry: 'server.mjs' })
    expect(checked.contract.tools).toEqual({ source: 'mcp', inventory: 'tools.json' })
    expect(checked.contract.data.schema).toBe(1)
    const manifestBytes = fs.readFileSync(path.join(root, 'package/plugin.json'))
    expect(hash(manifestBytes)).toBe(release.manifestSha256)
    const manifest = JSON.parse(manifestBytes.toString())
    const manifestFiles = new Map<string, { path: string; bytes: number; sha256: string }>()
    for (const entry of manifest.files) {
      expect(manifestFiles.has(entry.path), `Duplicate manifest path: ${entry.path}`).toBe(false)
      manifestFiles.set(entry.path, entry)
    }
    expect(manifestFiles.size).toBe(manifest.files.length)
    expect([...manifestFiles.keys()].sort()).toEqual(
      checked.filePaths.filter((name) => name !== 'plugin.json').sort(),
    )
    expect([...checked.filePaths].sort()).toEqual(
      ['plugin.json', ...manifest.files.map((file: { path: string }) => file.path)].sort(),
    )
    for (const name of [
      'server.mjs',
      'tools.json',
      'ui/index.html',
      'ui/app.js',
      'ui/style.css',
      'helper/manifest.json',
      'helper/worker.js',
    ])
      expect(checked.filePaths).toContain(name)
    expect(checked.filePaths.length).toBeGreaterThan(100)
    for (const name of checked.filePaths) {
      expect(name).not.toMatch(/(?:^|\/)\.\.|\.(?:sh|bash|zsh|bat|cmd|ps1)$/i)
      const file = path.join(root, 'package', name)
      expect(fs.lstatSync(file).isSymbolicLink()).toBe(false)
      expect(fs.lstatSync(file).isFile()).toBe(true)
      const bytes = fs.readFileSync(file)
      const verified = Buffer.from(checked.readFile(name)!)
      expect(verified.length).toBe(bytes.length)
      expect(verified).toEqual(bytes)
      if (name !== 'plugin.json')
        expect(manifest.files).toContainEqual({
          path: name,
          bytes: bytes.length,
          sha256: hash(bytes),
        })
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
    const config = loadConfig(bootstrapEnv(home))
    let client: Client | undefined
    let server
    try {
      server = await built.startAgentChrome(config, {
        browser,
        store,
        logger: { info() {}, warn() {}, error() {} },
      })
      const base = `http://127.0.0.1:${server.httpServer.address().port}`
      client = await connectPackage(base, config.token)
      expect(client.getServerVersion()?.version).toBe(checked.manifest.version)
      const snapshot = await client.callTool({ name: 'configuration_snapshot', arguments: {} })
      expect(snapshot.isError).not.toBe(true)
      expect(resultJson(snapshot)).toMatchObject({ profiles: [], tabs: [] })
      const refused = await client.callTool({
        name: 'configure_profile',
        arguments: { action: 'create-profile', profile: 'fern' },
        _meta: { ...personMetadata, origin: 'agent' },
      })
      expect(refused.isError).toBe(true)
      expect(store.list()).toEqual([])
      expect(browser.launches).toHaveLength(0)
      const made = await client.callTool({
        name: 'configure_profile',
        arguments: { action: 'create-profile', profile: 'fern' },
        _meta: personMetadata,
      })
      expect(made.isError).not.toBe(true)
      expect(resultJson(made)).toEqual({ profile: 'fern', completed: true })
      expect(store.get('fern')).toBeDefined()
      for (const route of ['/healthz', '/v1/profiles', '/v1/tabs']) {
        const response = await fetch(base + route, {
          headers: { authorization: `Bearer ${config.token}` },
        })
        expect(response.status).toBe(404)
        await response.body?.cancel()
      }
    } finally {
      await client?.close()
      await server?.close()
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})
