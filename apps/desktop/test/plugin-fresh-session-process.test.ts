import { afterEach, expect, it, vi } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  FakeRuntime,
  withManagedPluginAttachments,
  type ManagedPluginAttachment,
  type ManagedPluginMcpServer,
  type SessionHandle,
  type RuntimeEvent,
} from '@brobot2/runtime'
import { PLUGIN_ATTACHMENT_WAIT_MS } from '../../../packages/runtime/src/managed-plugin-session'
import { fixture, cleanupLifecycleFixtures, deferred } from './plugin-lifecycle-fixtures'
import { manifestFor, packageFixture, signed } from './plugin-package-fixtures'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import {
  PluginSupervisorAttachment,
  pluginWorkspaceIdentity,
} from '../src/main/plugins/supervisor/client'
import { WorkspacePluginAttachments } from '../src/main/plugins/attachments'

const close: Array<() => Promise<unknown>> = []
const record = (value: Record<string, unknown>) => {
  const receipt = process.env.BROCREW_PLUGIN_DIAGNOSTIC_RECEIPT
  if (receipt)
    appendFileSync(receipt, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n')
  console.log(JSON.stringify(value))
}
afterEach(async () => {
  const errors: unknown[] = []
  for (const fn of close.splice(0).reverse()) {
    try {
      await fn()
    } catch (error) {
      errors.push(error)
    }
  }
  await cleanupLifecycleFixtures()
  vi.restoreAllMocks()
  if (errors.length) throw new AggregateError(errors, 'Scratch restart cleanup failed')
})

const program = `
const {PluginSupervisor,PluginLifecycleController,GlobalPluginState,sharedLifecycleWorkspaces,createLifecycleAgentBridge,servePersonPluginControl,requirePluginAdapter,fictionalPublicKey,keepPluginRootPrivate}=require(process.argv[1]);
const {randomUUID}=require('node:crypto');
const c=JSON.parse(process.argv[2]);
(async()=>{
 await keepPluginRootPrivate(c.root);
 const state=GlobalPluginState.open({root:c.root+'/state',workspaceRoots:[c.workspace]});
 let loads=0,loadMs=0;const originalLoad=state.disk.load.bind(state.disk);state.disk.load=(...args)=>{const began=performance.now();try{return originalLoad(...args)}finally{loads++;loadMs+=performance.now()-began}};
 const controller=sharedLifecycleWorkspaces(await PluginLifecycleController.open({root:c.root,state,pinnedPublicKey:fictionalPublicKey,target:c.target,catalogue:{bytes:Buffer.from(c.bytes,'hex'),signature:Buffer.from(c.signature,'hex')},names:{chrome:'Chrome',whatsapp:'WhatsApp'},deny(){},runtime:{previousOwnerClean:async()=>true,removeCode:async()=>{},removeData:async()=>{},start:async spec=>{let end;const exited=new Promise(resolve=>end=resolve);return {runId:randomUUID(),exited,ready:async()=>({serverPid:404941,origin:c.origin,mcp:()=>({url:c.origin+'/'+spec.package.manifest.id+'/mcp',headers:{Authorization:'Bearer '+c.token}}),admin:()=>({url:c.origin+'/'+spec.package.manifest.id+'/admin',headers:{Authorization:'Bearer '+c.token}})}),stop:async()=>end()}}}}));
 const owner=await PluginSupervisor.start({root:c.root,workspaceRoots:[c.workspace]});
 const agents=createLifecycleAgentBridge({owner,controller,binding:(view,diagnostic)=>requirePluginAdapter(view.installation.pluginId).broker(view,async()=>{},diagnostic)});
 owner.bindAgentBridge({...agents,agentRoutes:async(lease,request)=>{const began=performance.now(),beforeLoads=loads,beforeMs=loadMs;try{return await agents.agentRoutes(lease,request)}finally{process.send({profile:true,release:request.release,routeMs:performance.now()-began,loads:loads-beforeLoads,loadMs:loadMs-beforeMs})}}});
 const person=await servePersonPluginControl({root:c.root,key:'a'.repeat(64),controller,read:async()=>({})});
 process.on('message',async message=>{if(message==='stop'){await controller.drain();await agents.close();await person.close({endConsumers:true});await owner.shutdown();await owner.closed;state.close();process.send({stopped:true});process.disconnect();}});
 process.send({ready:true});
})().catch(error=>{process.send({failed:true,name:error.name,code:error.code});process.exitCode=1;process.disconnect()});
`

function receive(child: ChildProcess): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Scratch supervisor did not answer')), 15_000)
    const message = (answer: Record<string, unknown>) => {
      if (!answer.profile) finish(undefined, answer)
    }
    const exit = () => finish(new Error('Scratch supervisor exited before answering'))
    function finish(error?: Error, answer?: Record<string, unknown>) {
      clearTimeout(timeout)
      child.off('message', message)
      child.off('exit', exit)
      if (error) reject(error)
      else resolve(answer!)
    }
    child.on('message', message)
    child.once('exit', exit)
  })
}

it.each([
  { history: 0, provider: 'codex' },
  { history: 160, provider: 'claude' },
  { history: 160, provider: 'codex' },
] as const)(
  '$provider fixture handoff receives routes through the real wrapper and supervisor process restart with $history historical projections',
  async ({ history, provider }) => {
    async function observed<T>(stage: string, work: Promise<T>): Promise<T> {
      const began = performance.now()
      try {
        const answer = await work
        record({ history, stage, elapsedMs: performance.now() - began })
        return answer
      } catch (cause) {
        throw new Error(`${history}: ${stage} after ${Math.round(performance.now() - began)}ms`, {
          cause,
        })
      }
    }
    const token = randomBytes(32).toString('hex')
    const http = createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${token}`) return res.writeHead(401).end()
      if (req.method !== 'POST') return res.writeHead(405).end()
      let data = ''
      req.on('data', (chunk) => (data += chunk))
      req.on('end', () => {
        const packet = JSON.parse(data)
        if (packet.id === undefined) return res.writeHead(202).end()
        const result =
          packet.method === 'initialize'
            ? {
                protocolVersion: packet.params.protocolVersion,
                serverInfo: { name: 'inert-package', version: '1' },
                capabilities: { tools: {} },
              }
            : packet.method === 'tools/list'
              ? {
                  tools: [
                    {
                      name: req.url?.includes('whatsapp') ? 'list_chats' : 'list_browser_profiles',
                      description: 'Fictional profiles',
                      inputSchema: { type: 'object' },
                    },
                  ],
                }
              : { content: [{ type: 'text', text: '[]' }] }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ jsonrpc: '2.0', id: packet.id, result }))
      })
    })
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    close.push(
      () =>
        new Promise<void>((resolve) => {
          http.close(() => resolve())
          http.closeAllConnections()
        }),
    )
    const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
    const manifest = manifestFor()
    manifest.id = 'chrome'
    manifest.skills = []
    manifest.platforms = [
      { os: process.platform as 'darwin' | 'linux', cpu: process.arch as 'arm64' | 'x64' },
    ]
    manifest.permissions.resources = [
      { id: 'browser-profiles', label: 'Fictional profiles', read: true, write: true },
    ]
    const pkg = packageFixture({ manifest })
    const whatsappManifest = structuredClone(manifest)
    whatsappManifest.id = 'whatsapp'
    whatsappManifest.permissions.resources = [
      { id: 'whatsapp', label: 'Fictional chats', read: true, write: true },
    ]
    const whatsapp = packageFixture({ manifest: whatsappManifest })
    const catalogue = signed({ format: 1, entries: [pkg.release, whatsapp.release] })
    const f = await fixture({
      catalogue,
      download: async (release) => (release.id === 'chrome' ? pkg.archive : whatsapp.archive),
    })
    f.opts.runtime.start = async (spec) => {
      const exited = deferred<void>()
      return {
        runId: randomUUID(),
        exited: exited.promise,
        ready: async () => ({
          serverPid: 404941,
          origin,
          mcp: () => ({
            url: origin + '/' + spec.package.manifest.id + '/mcp',
            headers: { Authorization: `Bearer ${token}` },
          }),
          admin: () => ({
            url: origin + '/' + spec.package.manifest.id + '/admin',
            headers: { Authorization: `Bearer ${token}` },
          }),
        }),
        stop: async () => exited.resolve(),
      }
    }
    await f.controller.install(f.handle, 'chrome')
    await f.controller.install(f.handle, 'whatsapp')
    const historyWorkspace = randomUUID(),
      receipt = f.state.emptyProjection(historyWorkspace, 'chrome')
    for (let i = 0; i < history; i++)
      f.state.recordProjection(historyWorkspace, 'chrome', i % 2 ? null : receipt)
    await f.controller.drain()
    f.state.close()
    const bundle = await bundleAWorker(
      'test/fixtures/plugin-restart-process.ts',
      join(f.parent, 'bundle'),
      'owner.cjs',
    )
    const config = {
      root: f.root,
      workspace: f.workspace,
      target: f.opts.target,
      bytes: catalogue.bytes.toString('hex'),
      signature: catalogue.signature.toString('hex'),
      origin,
      token,
    }
    for (let generation = 0; generation < 2; generation++) {
      const child = spawn(process.execPath, ['-e', program, bundle, JSON.stringify(config)], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { ...process.env, NODE_OPTIONS: '' },
      })
      child.on('message', (value: Record<string, unknown>) => {
        if (value.profile) record({ history, generation, provider, ...value })
      })
      close.push(async () => {
        if (child.exitCode === null && child.signalCode === null) {
          const exit = once(child, 'exit')
          child.kill('SIGKILL')
          await exit
        }
      })
      expect(await receive(child)).toEqual({ ready: true })
      const attachment = new PluginSupervisorAttachment()
      attachment.start({ root: f.root, workspaceRoot: f.workspace, build: 'fictional' })
      close.push(() => attachment.quit())
      expect(await observed(`${generation}:lease-ready`, attachment.ready())).toBe(true)
      expect(attachment.supports('agent-routes-format-2')).toBe(true)
      const workspaceId = pluginWorkspaceIdentity(f.workspace)
      const settings = await connectPluginSettings({
        path: join(f.root, 'person-control/person.sock'),
        personKey: 'a'.repeat(64),
        root: f.root,
        pinnedPublicKey: f.opts.pinnedPublicKey,
        target: f.opts.target,
        catalogue: f.opts.catalogue,
        projection: {
          workspaceId,
          async applied() {},
          async reconcile() {},
          async revoke() {
            return true
          },
        },
        propose() {},
      })
      let settingsClosed = false
      const closeSettings = async () => {
        if (!settingsClosed) {
          settingsClosed = true
          await settings.close()
        }
      }
      close.push(closeSettings)
      expect(
        await observed(`${generation}:settings-owner-check-and-list`, settings.catalogue()),
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'chrome', state: 'Running' })]),
      )
      const baseSource = new WorkspacePluginAttachments(
        {
          agentRoutes: async (input) => {
            const began = performance.now()
            try {
              const reply = await attachment.agentRoutes(input)
              const value = reply.value as {
                servers?: Array<{ name: string }>
                pending?: string[]
                none?: string[]
                unknown?: boolean
              }
              record({
                history,
                generation,
                stage: 'ipc-reply',
                elapsedMs: performance.now() - began,
                format: reply.format,
                names: value.servers?.map((one) => one.name),
                pending: value.pending,
                none: value.none,
                unknown: value.unknown,
              })
              return reply
            } catch (error) {
              record({
                history,
                generation,
                stage: 'ipc-rejected',
                elapsedMs: performance.now() - began,
                name: (error as Error).name,
                code: (error as { code?: string }).code,
              })
              throw error
            }
          },
        },
        workspaceId,
      ).agent(['brobot'])
      const parsedReads: Array<{ value: ManagedPluginAttachment; elapsedMs: number }> = []
      const source = {
        async read() {
          const began = performance.now()
          const value = await baseSource.read()
          const elapsedMs = performance.now() - began
          parsedReads.push({ value, elapsedMs })
          record({
            history,
            generation,
            provider,
            stage: 'parsed-read',
            elapsedMs,
            first: parsedReads.length === 1,
          })
          return value
        },
        close: () => baseSource.close(),
      }
      // Only the provider is a double. Discovery/lease/format2/parser/wrapper/deadline are real.
      // Native SDK configuration and provider tools/list remain a separate required gate.
      const raw = new FakeRuntime(provider)
      let offered: readonly ManagedPluginMcpServer[] = []
      const prepare = <T extends SessionHandle>(handle: T) => {
        vi.spyOn(handle as SessionHandle, 'send').mockResolvedValue(undefined)
        Object.defineProperty(handle, 'awaitProcessExit', { value: () => Promise.resolve() })
        if (provider === 'claude')
          Object.defineProperty(handle, 'refreshManagedPlugins', {
            value: async (next: readonly ManagedPluginMcpServer[]) => {
              offered = next
            },
          })
        return handle
      }
      const start = raw.start.bind(raw),
        resume = raw.resume.bind(raw)
      vi.spyOn(raw, 'start').mockImplementation(async (options) => {
        offered = options.managedPluginMcp ?? []
        return prepare(await start(options))
      })
      vi.spyOn(raw, 'resume').mockImplementation(async (ref, options) => {
        offered = options.managedPluginMcp ?? []
        return prepare(await resume(ref, options))
      })
      const wrapped = withManagedPluginAttachments(raw, source)
      const session = await observed(
        `${generation}:wrapper-start`,
        wrapped.start({
          cwd: f.workspace,
          providerHome: join(f.parent, provider),
          model: 'fictional',
        }),
      )
      const wrapperEvents: RuntimeEvent[] = []
      const eventPump = (async () => {
        for await (const event of session.events()) wrapperEvents.push(event)
      })()
      let sessionClosed = false
      const closeSession = async () => {
        if (!sessionClosed) {
          sessionClosed = true
          await session.close()
          await eventPump
        }
      }
      close.push(closeSession)
      record({
        history,
        generation,
        provider,
        stage: 'fixture-start-offer',
        names: offered.map((server) => server.name),
      })
      expect(parsedReads[0]).toBeDefined()
      expect(parsedReads[0]!.elapsedMs).toBeLessThan(PLUGIN_ATTACHMENT_WAIT_MS)
      if (history === 0 || offered.length > 0) expect(offered.length).toBeGreaterThan(0)
      else {
        // A timely named unknown/pending reply may launch without routes; rejection/timeout may not.
        const first = parsedReads[0]!
        expect(first).toBeDefined()
        expect(first.elapsedMs).toBeLessThan(PLUGIN_ATTACHMENT_WAIT_MS)
        expect(first.value.servers).toEqual([])
        expect(first.value.plugins).toBeDefined()
        expect(first.value.plugins!.none).toEqual([])
        expect(first.value.plugins!.unknown || first.value.plugins!.pending.length > 0).toBe(true)
      }
      await observed(`${generation}:wrapper-first-send`, session.send('Fictional provider turn'))
      record({
        history,
        generation,
        provider,
        stage: 'fixture-first-send-offer',
        names: offered.map((server) => server.name),
      })
      expect(offered.some((server) => server.name === 'plugin-chrome')).toBe(true)
      const mcp = new Client({ name: 'fixture-client', version: '1' })
      close.push(() => mcp.close())
      const route = offered.find((server) => server.pluginId === 'chrome')!
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL(route.url), {
          requestInit: { headers: { Authorization: `Bearer ${route.capability}` } },
        }),
      )
      expect((await mcp.listTools()).tools.map((t) => t.name)).toContain('list_browser_profiles')
      expect(await mcp.callTool({ name: 'list_browser_profiles', arguments: {} })).toMatchObject({
        content: [{ type: 'text', text: '[]' }],
      })
      await mcp.close()
      await observed(`${generation}:wrapper-close`, closeSession())
      expect(
        wrapperEvents.filter(
          (event) =>
            event.type === 'unknown' && JSON.stringify(event).includes('plugin/attachment'),
        ),
      ).toEqual([])
      await closeSettings()
      const stopped = receive(child),
        exited = once(child, 'exit')
      child.send('stop')
      expect(await stopped).toEqual({ stopped: true })
      await exited
      await attachment.quit()
      expect(child.exitCode).toBe(0)
    }
  },
  60_000,
)
