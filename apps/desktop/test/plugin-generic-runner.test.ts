import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createPluginNodeHost } from '../src/main/plugins/node-host'
import {
  preparePluginNodeRuntime,
  PLUGIN_HOST_SCRIPTS,
  type PluginNodeRuntime,
} from '../src/main/plugins/node-runtime'
import * as verifier from '../src/main/plugins/package-verifier'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { tar } from './plugin-package-fixtures'
import { sharedDataOwner } from '../src/main/plugins/shared-data'
import { defaultPluginRoot } from '../src/main/plugins/supervisor/client'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { LifecycleEffects } from '../src/main/plugins/lifecycle/files'
import {
  fixture as lifecycleFixture,
  cleanupLifecycleFixtures,
  reopenLifecycleFixture,
} from './plugin-lifecycle-fixtures'

// The fictional server deliberately has no packaged tool inventory or domain health routes.
const stdioSource = String.raw`
import readline from 'node:readline';
import fs from 'node:fs';
const pending = new Map();
const send = value => process.stdout.write(JSON.stringify(value)+'\n');
const reply = (id,result) => send({jsonrpc:'2.0',id,result});
readline.createInterface({input:process.stdin}).on('line', async line => {
 const packet=JSON.parse(line);
 if(!packet.method) { pending.get(packet.id)?.(packet.result); pending.delete(packet.id); return; }
 if(packet.id===undefined) return;
 if(packet.method==='initialize') {
  if(process.argv.includes('--describe-on-initialize')) {
   const id='host-initialize';
   const result=new Promise(resolve=>pending.set(id,resolve));
   send({jsonrpc:'2.0',id,method:'brocrew/host',params:{api:1,workspaceId:'fictional-workshop',requestId:'describe',method:'host.describe',params:null}});
   if((await result)?.value?.api!==1) throw new Error('Fictional host was not attached before initialize');
  }
  return reply(packet.id,{protocolVersion:packet.params.protocolVersion,serverInfo:{name:'fictional-orchard',version:'1.0.0'},capabilities:{tools:{}}});
 }
 if(packet.method==='tools/list') return reply(packet.id,{tools:[{name:'orchard.echo',description:'Fictional echo',inputSchema:{type:'object',additionalProperties:true}}]});
 if(packet.method==='tools/call') {
  const args=packet.params.arguments;
  if(args?.exit) return process.exit(7);
  if(args?.host) {
   const id='host-'+packet.id;
   const result = new Promise(resolve=>pending.set(id,resolve));
   send({jsonrpc:'2.0',id,method:'brocrew/host',params:args.host});
   return reply(packet.id,{content:[],structuredContent:{host:await result}});
  }
  if(args?.write) fs.writeFileSync(process.env.BROCREW_PLUGIN_DATA+'/opaque.bin',Buffer.from([0,255,3,4]));
  return reply(packet.id,{content:[{type:'text',text:JSON.stringify(args)}],structuredContent:{arguments:args,argv:process.argv.slice(2),data:process.env.BROCREW_PLUGIN_DATA,shared:process.env.BROCREW_PLUGIN_SHARED,bootstrap:JSON.parse(process.env.BROCREW_PLUGIN_BOOTSTRAP),inherited:process.env.FICTIONAL_RUNNER_VALUE,home:process.env.HOME,ownerId:process.env.BROCREW_PLUGIN_OWNER_ID,ownerLabel:process.env.BROCREW_PLUGIN_OWNER_LABEL}});
 }
});
`
const httpSource = String.raw`
import http from 'node:http';
const server=http.createServer((req,res)=>{
 if(req.url!=='/fictional-mcp') { res.writeHead(404).end(); return; }
 if(req.method!=='POST') { res.writeHead(405).end(); return; }
 let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
  const packet=JSON.parse(body);
  if(packet.id===undefined) {res.writeHead(202).end();return;}
  const result=packet.method==='initialize'?{protocolVersion:packet.params.protocolVersion,serverInfo:{name:'fictional-meadow',version:'9.0.0'},capabilities:{tools:{}}}:{tools:[]};
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:packet.id,result}));
 });
});
server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({type:'brocrew-plugin-ready',api:1,mcp:{url:'http://127.0.0.1:'+server.address().port+'/fictional-mcp'}})+'\n'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`
function fixture(
  options: {
    id?: string
    version?: string
    dataOnRemove?: 'keep' | 'remove'
    source?: string
    process?: boolean
    http?: boolean
    command?: string
    args?: string[]
    entry?: string
  } = {},
) {
  const files = new Map([
    ['main.mjs', Buffer.from(options.source ?? stdioSource)],
    ['tools.json', Buffer.from('{"tools":[]}')],
  ])
  // Process entries are package files. A script with a declared shebang exercises the OS path.
  if (options.process)
    files.set(
      'runner',
      Buffer.from('#!' + process.execPath + '\n' + (options.source ?? stdioSource)),
    )
  const manifest = {
    format: 3,
    id: options.id ?? 'fictional-orchard',
    version: options.version ?? '1.0.0',
    name: 'Fictional orchard',
    description: 'Fictional process fixture',
    authors: ['Fictional Gardener'],
    platforms: [{ os: process.platform, cpu: process.arch }],
    permissions: { description: 'Operate fictional orchards' },
    files: [...files].map(([path, bytes]) => ({
      path,
      bytes: bytes.length,
      sha256: pluginSha256(bytes),
    })),
    runtime:
      options.process || options.command
        ? {
            kind: 'process',
            command: options.command ?? 'runner',
            args: options.args ?? ['--fictional'],
          }
        : {
            kind: 'node',
            entry: options.entry ?? 'main.mjs',
            args: options.args ?? ['--fictional'],
          },
    mcp: options.http
      ? { transport: 'streamable-http', bootstrap: 'ready-message' }
      : { transport: 'stdio' },
    tools: { source: 'mcp', inventory: 'tools.json' },
    lifecycle: {
      stop: { signal: 'SIGTERM', graceMs: 200 },
      dataOnRemove: options.dataOnRemove ?? 'keep',
    },
    data: { schema: 4, migrateOnStart: true },
  }
  const archive = tar([
    { path: 'plugin.json', body: Buffer.from(JSON.stringify(manifest)) },
    ...[...files].map(([path, body]) => ({ path, body })),
  ])
  const checked = verifier.verifyPluginPackage(
    archive,
    { sha256: pluginSha256(archive), bytes: archive.length, compression: 'tar' },
    { target: manifest.platforms[0] as never, appVersion: '1.0.0' },
  )
  return { package: checked, releaseDigest: verifier.verifiedPluginDigest(checked)!, archive }
}
let root: string, runtime: PluginNodeRuntime
const hosts: ReturnType<typeof createPluginNodeHost>[] = []
async function context(options: Partial<Parameters<typeof createPluginNodeHost>[0]> = {}) {
  const home = join(root, 'host-' + hosts.length)
  const host = createPluginNodeHost({ root: home, runtime, readyMs: 3000, ...options })
  hosts.push(host)
  return { host, home }
}
describe('generic plugin process runner', () => {
  it('attaches trusted instance metadata before a host request during MCP initialize', async () => {
    const { host } = await context()
    let attached: Readonly<{ pluginId: string; runId: string }> | undefined
    const onStarted = vi.fn(async (owner) => {
      await Promise.resolve()
      attached = owner
    })
    const hostRequest = vi.fn(async (owner, envelope, signal) => {
      expect(owner).toEqual(attached)
      expect(signal.aborted).toBe(false)
      expect(envelope).toEqual({
        api: 1,
        workspaceId: 'fictional-workshop',
        requestId: 'describe',
        method: 'host.describe',
        params: null,
      })
      return { value: { api: 1 } }
    })
    const run = await host.start({
      ...fixture({ args: ['--describe-on-initialize'] }),
      onStarted,
      hostRequest,
    })
    const ready = await run.ready()
    expect(onStarted).toHaveBeenCalledExactlyOnceWith({
      pluginId: 'fictional-orchard',
      runId: run.runId,
    })
    expect(hostRequest).toHaveBeenCalledOnce()
    expect((await ready.client!.listTools()).tools[0]?.name).toBe('orchard.echo')
  })
  beforeAll(async () => {
    root = await realpath(
      await mkdtemp(
        join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-generic-runner-'),
      ),
    )
    const resources = join(root, 'resources')
    await mkdir(join(resources, 'plugin-node'), { recursive: true })
    const binary = await readFile(process.execPath)
    await writeFile(
      join(resources, 'plugin-node', process.platform === 'win32' ? 'node.exe' : 'node'),
      binary,
    )
    await writeFile(join(resources, 'plugin-node', 'LICENSE'), 'Fictional runtime licence')
    await writeFile(
      join(resources, 'plugin-node', 'runtime.json'),
      JSON.stringify({
        format: 1,
        platform: process.platform,
        arch: process.arch,
        version: process.versions.node,
        sha256: createHash('sha256').update(binary).digest('hex'),
      }),
    )
    await mkdir(join(resources, 'plugin-host'))
    for (const name of PLUGIN_HOST_SCRIPTS)
      await copyFile(
        resolve(__dirname, '../resources/plugin-host', name),
        join(resources, 'plugin-host', name),
      )
    runtime = await preparePluginNodeRuntime({
      resourcesRoot: resources,
      durableRoot: join(root, 'runtimes'),
    })
  }, 30000)
  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((host) => host.stop()))
    vi.unstubAllEnvs()
    await cleanupLifecycleFixtures()
  })
  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })
  it.each(['absolute', 'PATH'] as const)('starts the declared %s process command', async (kind) => {
    let command = process.execPath
    if (kind === 'PATH') {
      const bin = join(root, 'fictional-command-bin')
      await mkdir(bin)
      command = 'fictional-node' + (process.platform === 'win32' ? '.exe' : '')
      if (process.platform === 'win32') await copyFile(process.execPath, join(bin, command))
      else await symlink(process.execPath, join(bin, command))
      vi.stubEnv('PATH', bin)
    }
    const { host } = await context()
    const run = await host.start(
      fixture({ command, args: ['--input-type=module', '-e', stdioSource] }),
    )
    expect((await (await run.ready()).client!.listTools()).tools[0]!.name).toBe('orchard.echo')
  })
  it('starts the declared absolute Node entry', async () => {
    const entry = join(root, 'external-fictional-entry.mjs')
    await writeFile(entry, stdioSource)
    const { host } = await context()
    const run = await host.start(fixture({ entry }))
    expect((await (await run.ready()).client!.listTools()).tools[0]!.name).toBe('orchard.echo')
  })
  it('serializes one installation while distinct private roots can use the same provided shared directory', async () => {
    const appData = join(root, 'same-provided-shared-data')
    await mkdir(appData)
    const sharedDataOwner = {
      appData,
      ownerId: '0c6462db-745c-405e-a826-3bc49852cdad',
      ownerLabel: 'Fictional workspaces',
    }
    const source = `import {openSync,unlinkSync} from 'node:fs';
const active=process.env.BROCREW_PLUGIN_DATA+'/active-runtime';
openSync(active,'wx');
process.on('SIGTERM',()=>{unlinkSync(active);process.exit(0)});
${stdioSource}`
    const spec = fixture({ source })
    const install = join(root, 'one-installation')
    const first = await context({ root: install, sharedDataOwner, readyMs: 10000 })
    const second = await context({ root: install, sharedDataOwner, readyMs: 10000 })
    const unrelated = await context({ sharedDataOwner, readyMs: 10000 })
    const run = await first.host.start(spec)
    const ready = await run.ready()
    const waiting = await second.host.start(spec)
    let settled = false
    const replacement = waiting.ready().then(
      (value) => {
        settled = true
        return value
      },
      (error: unknown) => {
        settled = true
        throw error
      },
    )
    void replacement.catch(() => {})
    const other = await unrelated.host.start(spec)
    const otherReady = await other.ready()
    const ownInfo = (await ready.client!.callTool({ name: 'orchard.echo', arguments: {} }))
      .structuredContent
    const otherInfo = (await otherReady.client!.callTool({ name: 'orchard.echo', arguments: {} }))
      .structuredContent
    expect(ownInfo).toMatchObject({
      data: join(install, 'data', 'fictional-orchard'),
      shared: join(appData, '@brobot2', 'shared', 'fictional-orchard'),
    })
    expect(otherInfo).toMatchObject({
      data: join(unrelated.home, 'data', 'fictional-orchard'),
      shared: join(appData, '@brobot2', 'shared', 'fictional-orchard'),
    })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(settled).toBe(false)
    expect(await run.stop()).toEqual({ exited: true })
    await expect(replacement).resolves.toHaveProperty('client')
    expect((await otherReady.client!.listTools()).tools).toHaveLength(1)
  })
  it.each([false, true])(
    'recovered retirement waits for its guardian and preserves missing explicit-removal facts (lost=%s)',
    async (lost) => {
      const f = await lifecycleFixture()
      const source = `process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),150));\n${stdioSource}`
      const spec = fixture({ id: 'chrome', source, dataOnRemove: 'remove' })
      const archive = join(f.parent, 'fictional-selected.tar')
      await writeFile(archive, spec.archive)
      await f.controller.installPackage(
        f.handle,
        {
          source: archive,
          sha256: spec.releaseDigest,
          bytes: spec.archive.length,
        },
        'install',
      )
      const home = join(f.root, 'host')
      const old = await context({ root: home })
      const run = await old.host.start(spec)
      await run.ready()
      const data = join(home, 'data', 'chrome', 'opaque.bin')
      await writeFile(data, Buffer.from([0, 255, 17, 4]))
      const code = join(home, 'packages', spec.releaseDigest, 'main.mjs')
      f.failStop()
      await expect(f.controller.uninstall(f.handle, 'chrome')).rejects.toThrow()
      const operationId = f.state.inspect().pending!.request.operationId
      const effect = await (await LifecycleEffects.open(f.root, false)).read(operationId)
      expect(effect).toMatchObject({ explicitRemoval: true, removalOutcome: { data: 'deleted' } })
      if (lost) await rm(join(f.root, 'lifecycle-effects', operationId + '.json'))
      const successor = await context({ root: home })
      const state = reopenLifecycleFixture(f)
      let settled = false
      const recovered = PluginLifecycleController.open({
        ...f.opts,
        state,
        runtime: {
          ...f.opts.runtime,
          removeCode: (id, digest) => successor.host.removePackage(id, digest),
          removeData: (id) => successor.host.removeData(id),
        },
      }).then((value) => {
        settled = true
        return value
      })
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(settled).toBe(false)
      expect(await readFile(code, 'utf8')).toBe(source)
      expect(await readFile(data)).toEqual(Buffer.from([0, 255, 17, 4]))
      const unrelated = fixture({ id: 'fictional-neighbor' })
      const neighbor = await successor.host.start(unrelated)
      expect((await (await neighbor.ready()).client!.listTools()).tools).toHaveLength(1)
      const stopped = run.stop()
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(settled).toBe(false)
      expect(await readFile(data)).toEqual(Buffer.from([0, 255, 17, 4]))
      expect(await stopped).toEqual({ exited: true })
      const controller = await recovered
      expect(state.inspect().pending).toBeNull()
      expect(state.exportActivation().entries).toEqual([])
      await expect(readFile(code)).rejects.toMatchObject({ code: 'ENOENT' })
      if (lost) expect(await readFile(data)).toEqual(Buffer.from([0, 255, 17, 4]))
      else await expect(readFile(data)).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await (await neighbor.ready()).client!.listTools()).tools).toHaveLength(1)
      await controller.drain()
    },
  )
  it('passes actual installation legacy paths through controller and runner bootstrap unchanged across update', async () => {
    const f = await lifecycleFixture()
    const appData = join(f.parent, 'fictional-app-data')
    await mkdir(appData)
    const priorOwner = {
      ownerId: '0c6462db-745c-405e-a826-3bc49852cdad',
      ownerLabel: 'Fictional legacy workspaces',
    }
    const { host } = await context({
      root: join(f.root, 'host'),
      sharedDataOwner: { appData, ...priorOwner },
    })
    const runs: Awaited<ReturnType<typeof host.start>>[] = []
    const controller = await PluginLifecycleController.open({
      ...f.opts,
      runtime: {
        ...f.opts.runtime,
        async start(spec) {
          const run = await host.start(spec)
          runs.push(run)
          return {
            runId: run.runId,
            ready: run.ready,
            exited: run.exited.then((result) => {
              if (!result.exited) throw new Error('fictional stop failure')
            }),
            async stop() {
              if (!(await run.stop()).exited) throw new Error('fictional stop failure')
            },
          }
        },
        removeCode: (id, digest) => host.removePackage(id, digest),
        removeData: (id) => host.removeData(id),
      },
    })
    const handle = await controller.attach(f.local.sink)
    const install = async (version: string, action: 'install' | 'update') => {
      const spec = fixture({ version })
      const path = join(f.parent, 'fictional-' + version + '.tar')
      await writeFile(path, spec.archive)
      await controller.installPackage(
        handle,
        { source: path, sha256: spec.releaseDigest, bytes: spec.archive.length },
        action,
      )
    }
    try {
      await install('1.0.0', 'install')
      const installId = f.state.exportActivation().entries[0]!.installId
      const legacyConfiguration = {
        directory: join(f.root, 'profile-apply', pluginSha256(Buffer.from(installId))),
        floor: join(f.root, 'profile-apply', installId + '.floor'),
      }
      const echo = async () =>
        (
          await (
            await runs.at(-1)!.ready()
          ).client!.callTool({ name: 'orchard.echo', arguments: {} })
        ).structuredContent
      expect(await echo()).toMatchObject({
        ...priorOwner,
        bootstrap: { legacyConfiguration, priorOwner },
      })
      await expect(readFile(legacyConfiguration.floor)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readdir(legacyConfiguration.directory)).rejects.toMatchObject({ code: 'ENOENT' })
      await mkdir(legacyConfiguration.directory, { recursive: true })
      const sentinel = join(legacyConfiguration.directory, 'fictional-consumed.json')
      const bytes = Buffer.from('fictional opaque consumed-boundary\u0000not an app parser input')
      await writeFile(sentinel, bytes)
      await writeFile(legacyConfiguration.floor, 'fictional opaque floor')
      await install('2.0.0', 'update')
      expect(f.state.exportActivation().entries[0]!.installId).toBe(installId)
      expect(await echo()).toMatchObject({
        ...priorOwner,
        bootstrap: { legacyConfiguration, priorOwner, previousVersion: '1.0.0' },
      })
      expect(await readFile(sentinel)).toEqual(bytes)
      expect(await readFile(legacyConfiguration.floor, 'utf8')).toBe('fictional opaque floor')
    } finally {
      await controller.drain()
    }
  })
  it('starts an unknown Node package over stdio and preserves arguments and ordinary environment', async () => {
    vi.stubEnv('FICTIONAL_RUNNER_VALUE', 'inherited fictional value')
    const inheritedHome = process.env.HOME
    const { host, home } = await context()
    const run = await host.start(fixture())
    const ready = await run.ready()
    expect((await ready.client!.listTools()).tools.map((tool) => tool.name)).toEqual([
      'orchard.echo',
    ])
    const args = { profile: 'fictional-explicit', nested: { enabled: false }, empty: null }
    const result = await ready.client!.callTool({ name: 'orchard.echo', arguments: args })
    expect(result.structuredContent).toMatchObject({
      arguments: args,
      argv: ['--fictional'],
      inherited: 'inherited fictional value',
      home: inheritedHome,
      data: join(home, 'data', 'fictional-orchard'),
      bootstrap: {
        api: 1,
        pluginId: 'fictional-orchard',
        instanceId: run.runId,
        dataDirectory: join(home, 'data', 'fictional-orchard'),
      },
    })
  })
  it.skipIf(process.platform === 'win32')(
    'starts a packaged process executable with the same stdio boundary',
    async () => {
      const { host } = await context()
      const run = await host.start(fixture({ process: true }))
      const ready = await run.ready()
      expect((await ready.client!.listTools()).tools).toHaveLength(1)
    },
  )
  it('initializes the MCP endpoint from a generic ready message without domain probes or version equality', async () => {
    const { host } = await context()
    const run = await host.start(fixture({ source: httpSource, http: true }))
    const ready = await run.ready()
    expect(ready.client!.getServerVersion()?.name).toBe('fictional-meadow')
    expect((await ready.client!.listTools()).tools).toEqual([])
  })
  it('binds duplex host requests to the actual instance and closes them with that instance', async () => {
    const request = vi.fn(async () => ({ value: { shown: true } }))
    const { host } = await context({ hostRequest: request })
    const run = await host.start(fixture())
    const ready = await run.ready()
    const payload = {
      api: 1,
      workspaceId: 'fictional-workspace',
      requestId: 'notice-1',
      method: 'host.notifications.show',
      params: { title: 'Fictional harvest', text: 'Ready', level: 'info' },
    }
    expect(
      (await ready.client!.callTool({ name: 'orchard.echo', arguments: { host: payload } }))
        .structuredContent,
    ).toEqual({ host: { value: { shown: true } } })
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: 'fictional-orchard', runId: run.runId }),
      payload,
      expect.anything(),
    )
    expect(await run.stop()).toEqual({ exited: true })
    await expect(ready.client!.listTools()).rejects.toThrow()
  })
  it('keeps opaque data bytes at the same path through stop/start', async () => {
    const { host, home } = await context()
    const spec = fixture()
    const first = await host.start(spec)
    await (
      await first.ready()
    ).client!.callTool({ name: 'orchard.echo', arguments: { write: true } })
    const path = join(home, 'data', 'fictional-orchard', 'opaque.bin')
    const before = await readFile(path)
    await first.stop()
    const second = await host.start(spec)
    await second.ready()
    expect(second.runId).not.toBe(first.runId)
    expect(await readFile(path)).toEqual(before)
    expect(await readdir(join(home, 'data'))).toContain('fictional-orchard')
  })
  it('passes previous version/schema and preserves the selected shared directory through restart', async () => {
    const appData = join(root, 'app-data'),
      workspaceRoot = join(root, 'fictional-workspace')
    await mkdir(join(appData, '@brobot2'), { recursive: true, mode: 0o700 })
    await mkdir(workspaceRoot, { mode: 0o700 })
    const pluginRoot = defaultPluginRoot(appData)
    await mkdir(pluginRoot, { mode: 0o700 })
    const owner = sharedDataOwner({ appData, root: pluginRoot, workspaceRoot, hidden: false })!
    const { host } = await context({ root: join(pluginRoot, 'host'), sharedDataOwner: owner })
    const spec = { ...fixture(), previousVersion: '0.9.0', previousDataSchema: 2 }
    const first = await host.start(spec)
    const ready = await first.ready()
    const shared = join(appData, '@brobot2', 'shared', 'fictional-orchard')
    const opaque = join(shared, 'fake-profile.bin')
    await writeFile(opaque, Buffer.from([0, 1, 255, 7]))
    const result = await ready.client!.callTool({ name: 'orchard.echo', arguments: {} })
    expect(result.structuredContent).toMatchObject({
      shared,
      bootstrap: {
        sharedDataDirectory: shared,
        previousVersion: '0.9.0',
        previousDataSchema: 2,
        dataSchema: 4,
      },
    })
    const second = await host.restart('fictional-orchard')
    await second.ready()
    expect(second.runId).not.toBe(first.runId)
    expect(await readFile(opaque)).toEqual(Buffer.from([0, 1, 255, 7]))
  })
  it('rejects a second running copy and isolates process failure from another plugin', async () => {
    const { host } = await context()
    const spec = fixture()
    const first = await host.start(spec)
    const ready = await first.ready()
    await expect(host.start(spec)).rejects.toThrow()
    const other = await host.start(fixture({ id: 'fictional-meadow' }))
    const otherReady = await other.ready()
    await expect(
      ready.client!.callTool({ name: 'orchard.echo', arguments: { exit: true } }),
    ).rejects.toThrow()
    expect(await first.exited).toEqual({ exited: true })
    expect((await otherReady.client!.listTools()).tools).toHaveLength(1)
    const replacement = await host.start(spec)
    await replacement.ready()
    expect((await otherReady.client!.listTools()).tools).toHaveLength(1)
  })
  it('bounds missing readiness and releases only that process slot for a retry', async () => {
    const { host } = await context({ readyMs: 1000 })
    const spec = fixture({ source: 'setInterval(()=>{},1000)' })
    const run = await host.start(spec)
    await expect(run.ready()).rejects.toThrow()
    expect(await run.exited).toEqual({ exited: true })
    const next = await host.start(fixture())
    await next.ready()
  })
})
