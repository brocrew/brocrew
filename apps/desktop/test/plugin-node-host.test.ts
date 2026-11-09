import { pluginStartupTrace } from '../src/main/plugins/startup-failure'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { once } from 'node:events'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  mkdtemp,
  mkdir,
  copyFile,
  cp,
  writeFile,
  readFile,
  rm,
  chmod,
  symlink,
  stat,
  realpath,
  readdir,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { pluginStartupDiagnostic } from '../src/main/plugins/startup-failure'
import { createPluginNodeHost } from '../src/main/plugins/node-host'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { ownedPluginNodeProcess } from '../src/main/plugins/supervisor/node-host'
import {
  preparePluginNodeRuntime,
  PLUGIN_HOST_SCRIPTS,
  runtimeFiles,
  resumePluginNodeRuntime,
  type PluginNodeRuntime,
} from '../src/main/plugins/node-runtime'
import {
  liveGroupMembers,
  stopGroups,
  pluginServerLaunch,
  readPriorityClamped,
} from '../resources/plugin-host/process-groups.mjs'
import { createRepoAwarePluginVerifier } from '../src/main/plugins/package-verifier'
import { manifestFor, packageFixture } from './plugin-package-fixtures'
import { sharedDataOwner } from '../src/main/plugins/shared-data'
import { SHARED_DATA_FEATURE } from '../src/main/plugins/shared-data-contract'

const cleanupFault = vi.hoisted(() => ({ once: false }))
vi.mock('../resources/plugin-host/process-groups.mjs', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../resources/plugin-host/process-groups.mjs')>()
  return {
    ...original,
    stopGroups: (...args: Parameters<typeof original.stopGroups>) => {
      if (cleanupFault.once) {
        cleanupFault.once = false
        args[2]?.(
          new Error('group-census', {
            cause: Object.assign(new Error('fictional ps failure'), { code: 'EIO' }),
          }),
        )
        return Promise.resolve(false)
      }
      return original.stopGroups(...args)
    },
  }
})

const copyFault = vi.hoisted(() => ({ once: false }))
const admissionFault = vi.hoisted(() => ({
  once: false,
  guardian: 0,
  pid: 0,
  birth: '',
  waiting: false,
}))

describe('plugin server application scheduling policy', () => {
  const node = '/fictional/runtime/node',
    preload = '/fictional/runtime/server.mjs'
  it('uses only the absolute macOS taskpolicy with argv separated and the owned preload retained', () => {
    const stat = vi.fn(() => ({ isFile: () => true, uid: 0 })),
      access = vi.fn()
    expect(pluginServerLaunch(node, preload, { platform: 'darwin', stat, access })).toEqual({
      execPath: '/usr/sbin/taskpolicy',
      execArgv: ['-a', node, '--import', preload],
    })
    expect(stat).toHaveBeenCalledWith('/usr/sbin/taskpolicy')
    expect(access).toHaveBeenCalledWith('/usr/sbin/taskpolicy', 1)
  })
  it.each([{ isFile: () => false, uid: 0 }])('uses plain Node for a nonregular utility', (info) => {
    const access = vi.fn()
    expect(
      pluginServerLaunch(node, preload, {
        platform: 'darwin',
        stat: () => info,
        access,
      }),
    ).toEqual({ execPath: node, execArgv: ['--import', preload] })
    expect(access).not.toHaveBeenCalled()
  })
  it.each(['ENOENT', 'EACCES'])('falls back to the unchanged plain Node shape for %s', (code) => {
    expect(
      pluginServerLaunch(node, preload, {
        platform: 'darwin',
        stat: () => ({ isFile: () => true, uid: 0 }),
        access() {
          throw Object.assign(new Error('fictional unavailable utility'), { code })
        },
      }),
    ).toEqual({
      execPath: node,
      execArgv: ['--import', preload],
    })
  })
  it.each([
    ['linux', preload],
    ['win32', pathToFileURL('/fictional/runtime/server.mjs').href],
  ])(
    'does not inspect or wrap the utility on %s, and names the preload as Node takes it there',
    (platform, named) => {
      const stat = vi.fn(() => ({ isFile: () => true, uid: 0 })),
        access = vi.fn()
      expect(pluginServerLaunch(node, preload, { platform, stat, access })).toEqual({
        execPath: node,
        execArgv: ['--import', named],
      })
      expect(stat).not.toHaveBeenCalled()
      expect(access).not.toHaveBeenCalled()
    },
  )
  it.each([
    ['4 0', true],
    ['9 0', true],
    ['10 0', true],
    ['20 0', true],
    ['21 0', false],
    ['31 0', false],
    ['46 0', false],
    ['46 10', true],
    ['46 -20', false],
    ['127 20', true],
    ['128 0', null],
    ['46 -21', null],
    ['46 21', null],
    ['fictional-private-output', null],
    ['46 0 extra', null],
  ])('reduces priority output to a closed fact for %s', (output, expected) => {
    expect(readPriorityClamped(1234, { platform: 'darwin', read: () => output })).toBe(expected)
  })
  it('reports unknown on a failed priority read and does not inspect other platforms or invalid PIDs', () => {
    const read = vi.fn(() => {
      throw new Error('fictional-private-output')
    })
    expect(readPriorityClamped(1234, { platform: 'darwin', read })).toBeNull()
    read.mockClear()
    for (const platform of ['linux', 'win32'])
      expect(readPriorityClamped(1234, { platform, read })).toBeNull()
    expect(readPriorityClamped(1, { platform: 'darwin', read })).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })
})
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return {
    ...original,
    fork: (...args: Parameters<typeof original.fork>) => {
      const child = original.fork(...args)
      if (!admissionFault.once) return child
      admissionFault.once = false
      admissionFault.guardian = child.pid!
      const emit = child.emit.bind(child)
      child.emit = (event: string | symbol, ...values: unknown[]) => {
        const message = values[0] as { type?: string; pid?: number; birth?: string }
        if (event === 'message' && message?.type === 'group') {
          admissionFault.pid = message.pid!
          admissionFault.birth = message.birth!
          return true // Delay delivery to the live host, not the guardian's own child startup.
        }
        if (event === 'message' && message?.type === 'awaiting-admission')
          admissionFault.waiting = true
        return emit(event, ...values)
      }
      return child
    },
  }
})
vi.mock('../src/main/plugins/node-host-files', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/main/plugins/node-host-files')>()
  return {
    ...original,
    async immutableFile(path: string, bytes: Uint8Array, executable = false) {
      if (copyFault.once) {
        copyFault.once = false
        await original.immutableFile(path, bytes.subarray(0, 8), executable)
        throw Object.assign(new Error('fictional interrupted copy'), { code: 'ENOSPC' })
      }
      return original.immutableFile(path, bytes, executable)
    },
  }
})

const source = String.raw`
import http from 'node:http'; import fs from 'node:fs'; import {spawn} from 'node:child_process';
const home = process.env.BROCREW_CHROME_DATA;
const auth = JSON.parse(fs.readFileSync(process.env.BROCREW_CHROME_AUTH, 'utf8'));
const server = http.createServer((req, res) => {
 const token = req.url === '/mcp' ? auth.mcpToken : auth.adminToken;
 if (req.headers.authorization !== 'Bearer '+token) { res.writeHead(401).end(); return }
 res.setHeader('content-type','application/json');
 if (req.url === '/mcp') {
  if(req.method !== 'POST') return res.writeHead(405).end();
  let body=''; req.on('data',chunk=>body+=chunk); req.on('end',()=>{
   const packet=JSON.parse(body);
   if(packet.id===undefined)return res.writeHead(202).end();
   res.end(JSON.stringify({jsonrpc:'2.0',id:packet.id,result:{protocolVersion:packet.params.protocolVersion,serverInfo:{name:'fictional-host',version:'1.0.0'},capabilities:{}}}));
  }); return;
 }

 if (req.url === '/healthz') return res.end(JSON.stringify({ok:true, version:'1.0.0'}));
 if (req.url === '/v1/profiles') return res.end(JSON.stringify({profiles:[]}));
 if (req.url === '/v1/launch') {
  const child = spawn(process.env.BROCREW_CHROME_EXECUTABLE, ['--user-data-dir='+home], {detached:true, stdio:'ignore'});
  res.end(JSON.stringify({pid:child.pid})); return;
 }
 if (req.url === '/v1/owner') return res.end(JSON.stringify({pid:process.ppid}));
 if (req.url === '/v1/env') return res.end(JSON.stringify({home, exec:process.execPath, pid:process.pid, inherited:!!process.env.FICTIONAL_HOST_SECRET}));
 if (req.url === '/v1/shared') return res.end(JSON.stringify(Object.fromEntries(['BROCREW_CHROME_SHARED','BROCREW_PLUGIN_OWNER_ID','BROCREW_PLUGIN_OWNER_LABEL','BROCREW_CHROME_MIGRATION_QUALIFICATION'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]))));
 res.writeHead(404).end();
});
server.listen(0,'127.0.0.1',()=>process.send({channel:'brocrew-plugin-node:v1',runId:process.env.BROCREW_PLUGIN_RUN_ID,type:'listening',port:server.address().port}));
process.on('SIGTERM',()=>{});
`
function fixture(body = source, mcpPath = '/mcp', sharedData = false) {
  const files = new Map([['server.mjs', Buffer.from(body)]])
  const manifest = manifestFor(files)
  manifest.id = 'chrome'
  manifest.platforms = [
    { os: process.platform as 'darwin' | 'linux', cpu: process.arch as 'arm64' | 'x64' },
  ]
  manifest.server = { entry: 'server.mjs', mcpPath, adminPath: '/v1' }
  manifest.skills = []
  manifest.serviceTemplates = []
  manifest.ui = null
  manifest.uiApi = null
  if (sharedData)
    Object.assign(manifest, {
      format: 2,
      authors: ['fictional'],
      executor: { kind: 'node', entry: manifest.server.entry },
      hooks: [],
      sharedData: true,
      hostApi: { ...manifest.hostApi, requiredFeatures: [SHARED_DATA_FEATURE] },
    })
  const value = packageFixture({ files, manifest })
  const catalogue = createRepoAwarePluginVerifier({
    target: manifest.platforms[0]!,
  }).verifyCatalogue(value.bytes)
  return {
    package: catalogue.verifyPackage('chrome', manifest.version, value.archive),
    releaseDigest: value.release.archive.sha256,
  }
}
let root: string, resources: string, runtime: PluginNodeRuntime, node: string
const hosts: ReturnType<typeof createPluginNodeHost>[] = []
let sequence = 0
async function context() {
  const path = join(root, String(++sequence))
  await mkdir(path, { mode: 0o700 })
  const browser = join(path, 'fake-browser')
  const pidFile = join(path, 'browser.json')
  await writeFile(
    browser,
    `#!${node}\nimport fs from 'node:fs'; import {spawn} from 'node:child_process';\nconst child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});\nfs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({pid:process.pid, child:child.pid}));\nprocess.on('SIGTERM',()=>{}); setInterval(()=>{},1000);\n`,
    { mode: 0o700 },
  )
  const home = join(path, 'private')
  const host = createPluginNodeHost({
    root: home,
    runtime,
    browserExecutable: browser,
    readyMs: 5000,
  })
  hosts.push(host)
  return { host, home, pidFile }
}
async function browserStarted(path: string): Promise<{ pid: number; child: number }> {
  for (let i = 0; i < 100; i++) {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch {
      await new Promise((r) => setTimeout(r, 25))
    }
  }
  throw new Error('fake browser did not start')
}
// Process groups and POSIX permissions have no Windows implementation in this host.
describe.skipIf(process.platform === 'win32')('app-supplied plugin Node host', () => {
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'fictional-node-host-')))
    resources = join(root, 'bundle')
    await mkdir(join(resources, 'plugin-node'), { recursive: true, mode: 0o700 })
    const binary = await readFile(
      process.env.BROBOT_PLUGIN_NODE_TEST_BINARY ||
        (process.platform === 'darwin' &&
        existsSync(resolve(__dirname, '../resources/plugin-node/node'))
          ? resolve(__dirname, '../resources/plugin-node/node')
          : process.execPath),
    )
    await writeFile(join(resources, 'plugin-node/node'), binary)
    await writeFile(join(resources, 'plugin-node/LICENSE'), 'fictional runtime fixture licence')
    await writeFile(
      join(resources, 'plugin-node/runtime.json'),
      JSON.stringify({
        format: 1,
        platform: process.platform,
        arch: process.arch,
        version: process.platform === 'darwin' ? '24.22.0' : process.versions.node,
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
    node = (await runtimeFiles(runtime)).node
  }, 30000)
  afterEach(async () => {
    for (const host of hosts.splice(0)) await host.stop()
  })
  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })
  it('starts a verified hook-only package with no MCP or configuration server', async () => {
    const { host } = await context()
    const body = `import http from 'node:http'; import fs from 'node:fs';
const auth = JSON.parse(fs.readFileSync(process.env.BROCREW_PLUGIN_AUTH, 'utf8'));
const server = http.createServer((req,res) => {
 if (req.url !== '/v1/hooks/healthz' || req.headers.authorization !== 'Bearer ' + auth.hookToken) { res.writeHead(401); res.end('{}'); return; }
 res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({ok:true,version:'1.0.0',hookProtocol:1}));
});
server.listen(0,'127.0.0.1',()=>process.send({channel:'brocrew-plugin-node:v1',runId:process.env.BROCREW_PLUGIN_RUN_ID,type:'listening',port:server.address().port}));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`
    const files = new Map([['dist/recipe.mjs', Buffer.from(body)]])
    const manifest = {
      ...manifestFor(files),
      format: 2 as const,
      id: 'fictional-context',
      version: '1.0.0',
      authors: ['brocrew'],
      platforms: [{ os: process.platform, cpu: process.arch }],
      server: null,
      toolApi: null,
      ui: null,
      uiApi: null,
      skills: [],
      serviceTemplates: [],
      executor: { kind: 'node' as const, entry: 'dist/recipe.mjs' },
      hooks: [
        {
          id: 'related-titles',
          kind: 'turn.context.titles',
          api: 1,
          optional: true as const,
          inputs: ['resource-titles' as const],
        },
      ],
    }
    const value = packageFixture({ files, manifest: manifest as ReturnType<typeof manifestFor> })
    const checked = createRepoAwarePluginVerifier({
      target: { os: process.platform as 'darwin' | 'linux', cpu: process.arch as 'arm64' | 'x64' },
    })
      .verifyCatalogue(value.bytes)
      .verifyPackage(value.manifest.id, value.manifest.version, value.archive)
    const handle = await host.start({
      package: checked,
      releaseDigest: value.release.archive.sha256,
    })
    const ready = await handle.ready()
    expect(() => ready.mcp()).toThrow()
    expect(() => ready.admin()).toThrow()
    const hooks = Reflect.get(ready, 'hooks') as () => {
      url: string
      headers: Record<string, string>
    }
    expect(typeof hooks).toBe('function')
    expect((await fetch(hooks().url + '/healthz', { headers: hooks().headers })).status).toBe(200)
    expect(JSON.stringify(ready)).not.toContain('Bearer')
    expect(await handle.stop()).toEqual({ exited: true })
  })
  it('starts packages that require the published bootstrap file mode under an ordinary umask', async () => {
    const priorMask = process.umask(0o022)
    try {
      const { host } = await context()
      const publishedBootstrap = source.replace(
        "const auth = JSON.parse(fs.readFileSync(process.env.BROCREW_CHROME_AUTH, 'utf8'));",
        `const authPath = process.env.BROCREW_CHROME_AUTH;
const stat = fs.lstatSync(authPath);
if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) !== 0)
  throw new Error('published plugin rejected bootstrap file mode');
const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));`,
      )
      const child = await host.start(fixture(publishedBootstrap))
      expect((await child.ready()).origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(await child.stop()).toEqual({ exited: true })
    } finally {
      process.umask(priorMask)
    }
  })
  it('removes the bootstrap auth file at listening, before the first authenticated readiness check', async () => {
    const { host, home } = await context()
    const body = source.replace(
      " const token = req.url === '/mcp' ? auth.mcpToken : auth.adminToken;",
      ` if (req.url === '/healthz') fs.writeFileSync(home+'/auth-presence-at-health.json',
        JSON.stringify({present:fs.existsSync(process.env.BROCREW_CHROME_AUTH)}));
 const token = req.url === '/mcp' ? auth.mcpToken : auth.adminToken;`,
    )
    expect(body).not.toBe(source)
    const handle = await host.start(fixture(body))
    const ready = await handle.ready()
    expect(ready.serverPid).toBeGreaterThan(1)
    expect(
      JSON.parse(await readFile(join(home, 'data/chrome/auth-presence-at-health.json'), 'utf8')),
    ).toEqual({ present: false })
    expect(await readdir(resolve(handle.receiptPath, '..'))).not.toContain('auth.json')
    expect(await handle.stop()).toEqual({ exited: true })
  })
  it('uses the durable app copy, private data/download roots and authenticated readiness without inheriting host secrets', async () => {
    const { host, home } = await context()
    process.env.FICTIONAL_HOST_SECRET = 'fictional-only'
    let handle
    try {
      handle = await host.start(fixture())
    } finally {
      delete process.env.FICTIONAL_HOST_SECRET
    }
    const ready = await handle.ready()
    expect([true, false, null]).toContain(ready.priorityClamped)
    expect((await fetch(ready.origin + '/healthz')).status).toBe(401)
    expect((await fetch(ready.origin + '/healthz', { headers: ready.mcp().headers })).status).toBe(
      401,
    )
    const facts = await (
      await fetch(ready.origin + '/v1/env', { headers: ready.admin().headers })
    ).json()
    expect(facts).toEqual({
      home: join(home, 'data/chrome'),
      exec: node,
      pid: ready.serverPid,
      inherited: false,
    })
    expect(
      await (await fetch(ready.origin + '/v1/shared', { headers: ready.admin().headers })).json(),
    ).toEqual({})
    for (const path of [
      home,
      join(home, 'data/chrome'),
      join(home, 'data/chrome/downloads'),
      join(home, 'data/chrome/files'),
    ])
      expect((await stat(path)).isDirectory()).toBe(true)
    expect(JSON.stringify(ready)).not.toContain('Bearer')
    expect(await handle.stop()).toEqual({ exited: true })
    const receipt = JSON.parse(await readFile(handle.receiptPath, 'utf8'))
    expect(receipt).toMatchObject({
      format: 1,
      runId: handle.runId,
      pluginId: 'chrome',
      exited: true,
    })
    expect(await readdir(resolve(handle.receiptPath, '..'))).not.toContain('auth.json')
    expect(() => ready.mcp()).toThrow('plugin-host-ready')
  }, 15000)
  it('passes shared storage and stable workspace identity through the guardian only for an eligible owner', async () => {
    const folder = await realpath(await mkdtemp('/tmp/shared-host-'))
    const appData = join(folder, 'a'),
      workspaceRoot = join(folder, 'fern')
    await mkdir(join(appData, '@brobot2'), { recursive: true, mode: 0o700 })
    await mkdir(workspaceRoot, { mode: 0o700 })
    await writeFile(
      join(workspaceRoot, 'plugin-root.json'),
      JSON.stringify({ format: 1, slot: 'a' }),
      { mode: 0o600 },
    )
    await writeFile(
      join(appData, '@brobot2', 'plugin-root-pins.json'),
      JSON.stringify({ format: 1, selections: [{ workspace: workspaceRoot, slot: 'a' }] }),
      { mode: 0o600 },
    )
    const pluginRoot = join(appData, '@brobot2', 'plugins-a')
    await mkdir(pluginRoot, { mode: 0o700 })
    const owner = sharedDataOwner({
      appData,
      root: pluginRoot,
      workspaceRoot,
      hidden: false,
      label: 'Fern\n\u202e workspace',
    })!
    const host = createPluginNodeHost({
      root: join(pluginRoot, 'host'),
      runtime,
      sharedDataOwner: owner,
    })
    hosts.push(host)
    try {
      const run = await host.start(fixture(source, '/mcp', true)),
        ready = await run.ready()
      expect(
        await (await fetch(ready.origin + '/v1/shared', { headers: ready.admin().headers })).json(),
      ).toEqual({
        BROCREW_CHROME_SHARED: join(appData, '@brobot2', 'shared', 'chrome'),
        BROCREW_PLUGIN_OWNER_ID: owner.ownerId,
        BROCREW_PLUGIN_OWNER_LABEL: 'Fern workspace',
      })
      expect(await run.stop()).toEqual({ exited: true })
    } finally {
      await host.stop()
      await rm(folder, { recursive: true, force: true })
    }
  }, 15000)
  it.each(['stop', 'crash', 'quit'] as const)(
    'contains a requested detached browser and cleans its descendant after %s',
    async (kind) => {
      const { host, pidFile } = await context()
      const child = await host.start(fixture()),
        ready = await child.ready()
      const response = await fetch(ready.origin + '/v1/launch', { headers: ready.admin().headers })
      expect(response.status).toBe(200)
      const ids = await browserStarted(pidFile)
      expect(await liveGroupMembers(ready.serverPid)).toContain(ids.pid)
      expect(await liveGroupMembers(ready.serverPid)).toContain(ids.child)
      if (kind === 'crash') process.kill(ready.serverPid, 'SIGKILL')
      const proof =
        kind === 'quit'
          ? await host.stop()
          : kind === 'stop'
            ? await child.stop()
            : await child.exited
      expect(proof).toEqual({ exited: true })
      expect(await liveGroupMembers(ready.serverPid)).toEqual([])
    },
    15000,
  )
  it('fails the host closed when a browser launcher force-kills its requested child group', async () => {
    const { host, pidFile } = await context()
    const child = await host.start(
      fixture(
        source.replace(
          "if (req.url === '/v1/owner')",
          "if (req.url === '/v1/force-close') { process.kill(-Number(req.headers['x-child']), 'SIGKILL'); return; } if (req.url === '/v1/owner')",
        ),
      ),
    )
    const ready = await child.ready()
    await fetch(ready.origin + '/v1/launch', { headers: ready.admin().headers })
    const ids = await browserStarted(pidFile)
    await fetch(ready.origin + '/v1/force-close', {
      headers: { ...ready.admin().headers, 'x-child': String(ids.pid) },
    }).catch(() => {})
    expect(await child.exited).toEqual({ exited: true })
    expect(await liveGroupMembers(ready.serverPid)).toEqual([])
  }, 15000)
  it('still cleans owned groups if the guardian crashes', async () => {
    const { host, pidFile } = await context()
    const child = await host.start(fixture()),
      ready = await child.ready()
    await fetch(ready.origin + '/v1/launch', { headers: ready.admin().headers })
    await browserStarted(pidFile)
    const owner = await (
      await fetch(ready.origin + '/v1/owner', { headers: ready.admin().headers })
    ).json()
    if (
      !owner ||
      typeof owner !== 'object' ||
      !('pid' in owner) ||
      typeof owner.pid !== 'number' ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 1
    )
      throw new Error('invalid fictional owner')
    process.kill(owner.pid, 'SIGKILL')
    expect(await child.exited).toEqual({ exited: true })
    expect(await liveGroupMembers(ready.serverPid)).toEqual([])
  }, 15000)
  it.each([false, true])(
    'rechecks a failed cleanup with live group=%s without signalling it',
    async (live) => {
      const { host, home, pidFile } = await context()
      const child = await host.start(fixture()),
        ready = await child.ready()
      if (live) {
        await fetch(ready.origin + '/v1/launch', { headers: ready.admin().headers })
        await browserStarted(pidFile)
      }
      const guardian = (await (
        await fetch(ready.origin + '/v1/owner', { headers: ready.admin().headers })
      ).json()) as { pid: number }
      cleanupFault.once = true
      process.kill(guardian.pid, 'SIGKILL')
      expect(await child.exited).toEqual({ exited: false })
      try {
        if (!live) await expect.poll(() => liveGroupMembers(ready.serverPid)).toEqual([])
        else expect((await liveGroupMembers(ready.serverPid)).length).toBeGreaterThan(0)
        if (live) expect((await child.proveEmptyGroups?.()) === true).toBe(false)
        else {
          const workspace = join(home, 'fictional-workspace')
          await mkdir(workspace, { mode: 0o700 })
          const options = { root: home, workspaceRoots: [workspace] }
          const owner = await PluginSupervisor.start(options)
          const lease = await PluginWorkspaceLease.attach({
            root: home,
            workspaceRoot: workspace,
            generation: randomUUID(),
            build: 'fictional',
          })
          owner.adopt(ownedPluginNodeProcess(child))
          expect(await lease.close()).toBe(true)
          const successor = await PluginSupervisor.start(options)
          expect(await successor.shutdown()).toBe(true)
        }
        const trace = await readFile(join(home, 'plugin-drain.log'), 'utf8')
        expect(trace).toContain('stage=group-cleanup state=failed')
        expect(trace).toContain('group-census')
        expect(trace).toContain('EIO')
        const receipt = JSON.parse(await readFile(child.receiptPath, 'utf8'))
        expect(receipt.exited).toBe(!live)
        expect(receipt.runId).toBe(child.runId)
        if (live) expect((await liveGroupMembers(ready.serverPid)).length).toBeGreaterThan(0)
      } finally {
        await stopGroups(new Map([[ready.serverPid, '']]), 0)
      }
    },
    15000,
  )
  it('never enters the package if the guardian dies before its group reaches the live host', async () => {
    const { host, pidFile } = await context()
    admissionFault.once = true
    admissionFault.waiting = false
    const child = await host.start(
      fixture(
        source.replace(
          'const auth =',
          "spawn(process.env.BROCREW_CHROME_EXECUTABLE, [], {detached:true, stdio:'ignore'}); const auth =",
        ),
      ),
    )
    try {
      for (let i = 0; i < 200 && !admissionFault.waiting; i++)
        await new Promise((resolve) => setTimeout(resolve, 25))
      await expect(readFile(pidFile)).rejects.toHaveProperty('code', 'ENOENT')
      expect(admissionFault.waiting).toBe(true)
      expect(admissionFault.pid).toBeGreaterThan(1)
      process.kill(admissionFault.guardian, 'SIGKILL')
      await expect(child.ready()).rejects.toThrow('plugin-host-ready')
      // No admission evidence means no claim of proved cleanup, even though entry was gated.
      expect(await child.exited).toEqual({ exited: false })
      expect((await child.proveEmptyGroups?.()) === true).toBe(false)
      for (let i = 0; i < 100 && (await liveGroupMembers(admissionFault.pid)).length; i++)
        await new Promise((resolve) => setTimeout(resolve, 25))
      expect(await liveGroupMembers(admissionFault.pid)).toEqual([])
      await expect(readFile(pidFile)).rejects.toHaveProperty('code', 'ENOENT')
      await expect(host.start(fixture())).rejects.toThrow('plugin-host-start')
    } finally {
      try {
        process.kill(admissionFault.guardian, 'SIGKILL')
      } catch {
        /* Already exited. */
      }
      if (admissionFault.pid > 1)
        await stopGroups(new Map([[admissionFault.pid, admissionFault.birth]]), 0)
    }
  }, 15000)
  it('leaves a different process group alone', async () => {
    const unrelated = spawn(node, ['-e', 'setInterval(()=>{},1000)'], {
      detached: true,
      stdio: 'ignore',
    })
    try {
      const { host } = await context(),
        child = await host.start(fixture())
      await child.ready()
      expect(await child.stop()).toEqual({ exited: true })
      expect(await liveGroupMembers(unrelated.pid!)).toContain(unrelated.pid)
      const diagnostic = vi.fn()
      expect(
        await stopGroups(new Map([[unrelated.pid!, 'fictional-other-birth']]), 1500, diagnostic),
      ).toBe(false)
      expect(diagnostic).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'group-identity: changed birth' }),
      )
      expect(await liveGroupMembers(unrelated.pid!)).toContain(unrelated.pid)
    } finally {
      unrelated.kill('SIGTERM')
      await once(unrelated, 'close')
    }
  }, 15000)
  it('refuses an unauthenticated healthy server, and a process that never becomes ready', async () => {
    const { host } = await context()
    const child = await host.start(
      fixture(source.replace('res.writeHead(401).end()', 'res.writeHead(200).end()')),
    )
    await expect(child.ready()).rejects.toThrow('plugin-host-ready')
    expect(await child.exited).toEqual({ exited: true })
    const other = createPluginNodeHost({ root: join(root, 'never-ready'), runtime, readyMs: 50 })
    hosts.push(other)
    const silent = await other.start(fixture('setInterval(()=>{},1000)'))
    await expect(silent.ready()).rejects.toThrow('plugin-host-ready')
    expect(await silent.exited).toEqual({ exited: true })
  }, 15000)
  it('refuses health-only readiness when authenticated MCP cannot initialize', async () => {
    const { host } = await context()
    const child = await host.start(
      fixture(
        source.replace(
          "if (req.url === '/mcp') {",
          "if (req.url === '/mcp') return res.writeHead(503).end(); if (false) {",
        ),
      ),
    )
    await expect(child.ready()).rejects.toThrow('plugin-host-ready')
    expect(await child.exited).toEqual({ exited: true })
  }, 15000)
  it('refuses a declared MCP path that the package does not actually serve', async () => {
    const { host } = await context(),
      child = await host.start(fixture(source, '/fictional-missing'))
    await expect(child.ready()).rejects.toThrow('plugin-host-ready')
    expect(await child.exited).toEqual({ exited: true })
  }, 15000)
  it('deletes one plugin’s data folder and no other, and refuses a name that leaves the data folder', async () => {
    const { host, home } = await context()
    for (const id of ['whatsapp', 'chrome']) {
      await mkdir(join(home, 'data', id, 'bridge'), { recursive: true, mode: 0o700 })
      await writeFile(join(home, 'data', id, 'bridge', 'messages.db'), 'fictional messages')
    }
    await chmod(home, 0o700)
    await chmod(join(home, 'data'), 0o700)
    await host.removeData('whatsapp')
    expect(await readdir(join(home, 'data'))).toEqual(['chrome'])
    await expect(host.removeData('../data')).rejects.toThrow('plugin-host-cleanup')
    expect(await readdir(join(home, 'data'))).toEqual(['chrome'])
  })
  it('refuses linked or public data roots, with no outside write', async () => {
    const { host, home } = await context()
    await mkdir(home, { mode: 0o700 })
    await mkdir(join(home, 'data'), { mode: 0o700 })
    const outside = join(root, 'outside')
    await mkdir(outside, { mode: 0o700 })
    await symlink(outside, join(home, 'data/chrome'))
    await expect(host.start(fixture())).rejects.toThrow('plugin-host-paths')
    expect(await readdir(outside)).toEqual([])
    const path = join(root, 'public')
    await mkdir(path, { mode: 0o700 })
    await chmod(path, 0o755)
    const other = createPluginNodeHost({ root: path, runtime })
    hosts.push(other)
    const shared = await other.start(fixture())
    await shared.ready()
    expect(await shared.stop()).toEqual({ exited: true })
  })
  it('serializes duplicate starts and refuses new starts after quit', async () => {
    const { host } = await context(),
      spec = fixture()
    const first = host.start(spec)
    await expect(host.start(spec)).rejects.toThrow('plugin-host-start')
    await (await first).ready()
    expect(await host.stop()).toEqual({ exited: true })
    await expect(host.start(spec)).rejects.toThrow('plugin-host-start')
  }, 15000)
  it('retries the same package digest after an interrupted copy without publishing partial code', async () => {
    const { host, home } = await context(),
      spec = fixture()
    copyFault.once = true
    await expect(host.start(spec)).rejects.toThrow('plugin-host-start')
    const packages = join(home, 'packages')
    expect((await readdir(packages)).filter((name) => /^[a-f0-9]{64}$/.test(name))).toEqual([])
    const orphan = join(packages, '.stage-fictional-abandoned')
    await mkdir(orphan, { mode: 0o700 })
    await writeFile(join(orphan, 'server.mjs'), 'partial fictional server', { mode: 0o400 })
    const retried = await host.start(spec)
    expect((await retried.ready()).origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(await retried.stop()).toEqual({ exited: true })
    expect(await readFile(join(packages, spec.releaseDigest, 'server.mjs'), 'utf8')).toBe(source)
    expect(await readFile(join(orphan, 'server.mjs'), 'utf8')).toBe('partial fictional server')
  }, 15000)
  it('refuses tampered published package bytes without repairing them', async () => {
    const { host, home } = await context(),
      spec = fixture()
    const child = await host.start(spec)
    await child.ready()
    expect(await child.stop()).toEqual({ exited: true })
    const path = join(home, 'packages', spec.releaseDigest, 'server.mjs')
    await chmod(path, 0o700)
    await writeFile(path, 'fictional tampered package')
    await expect(host.start(spec)).rejects.toThrow('plugin-host-paths')
    expect(await readFile(path, 'utf8')).toBe('fictional tampered package')
  }, 15000)
  it('keeps the server error and real exit code when the guardian exits cleanly', async () => {
    const { host, home } = await context()
    const child = await host.start(
      fixture(`
import fs from 'node:fs';
const auth = JSON.parse(fs.readFileSync(process.env.BROCREW_CHROME_AUTH, 'utf8'));
fs.writeSync(2, 'Error: rejected /fictional/plugin/auth.json '+auth.mcpToken+'\\n');
fs.writeSync(2, 'x'.repeat(20000));
fs.writeSync(2, '\\n at /fictional/first-stack.mjs '+auth.adminToken+'\\n');
process.exit(23);
`),
    )
    const refusal = await child.ready().catch((error: unknown) => error)
    expect(pluginStartupDiagnostic(refusal)).toEqual({
      exitCode: 23,
      signal: null,
      stderr: 'Error: rejected /fictional/plugin/auth.json [redacted]',
    })
    expect(await child.exited).toMatchObject({ exited: true })
    const firstLog = resolve(child.receiptPath, '..', 'plugin-startup.log')
    await vi.waitFor(async () => {
      const log = await readFile(firstLog, 'utf8')
      expect(log).toContain('Exit code 23')
      expect(log).toContain('/fictional/first-stack.mjs [redacted]')
      expect(log).toContain('[stderr truncated to last 16 KiB]')
      expect(log).not.toMatch(/[a-f0-9]{64}/i)
      expect(log.length).toBeLessThan(18 * 1024)
    })
    const second = await host.start(
      fixture(`
import fs from 'node:fs';
const auth = JSON.parse(fs.readFileSync(process.env.BROCREW_CHROME_AUTH, 'utf8'));
fs.writeSync(2, 'Error: second startup failure\\n at /fictional/second-stack.mjs '+auth.adminToken+'\\n');
process.exit(24);
`),
    )
    const secondFailure = await second.ready().catch((error: unknown) => error)
    expect(pluginStartupDiagnostic(secondFailure)?.exitCode).toBe(24)
    expect(await second.exited).toMatchObject({ exited: true })
    await vi.waitFor(async () => {
      const log = await readFile(resolve(second.receiptPath, '..', 'plugin-startup.log'), 'utf8')
      expect(log).toContain('Exit code 24')
      expect(log).toContain('/fictional/second-stack.mjs [redacted]')
      expect(log).not.toMatch(/[a-f0-9]{64}/i)
      expect(await readFile(join(home, 'plugin-startup.log'), 'utf8')).toContain('Exit code 24')
    })
    expect(await readFile(firstLog, 'utf8')).toContain('/fictional/first-stack.mjs [redacted]')
  }, 20000)
  it('retains the server cause after a ready run exits', async () => {
    const { host } = await context()
    const body = source.replace(
      "if (req.url === '/v1/owner') return res.end(JSON.stringify({pid:process.ppid}));",
      "if (req.url === '/v1/owner') { res.end('{}'); setTimeout(() => { fs.writeSync(2, 'Error: ended /fictional/plugin/server.mjs\\n'); process.exit(17) }, 20); return; }",
    )
    expect(body).not.toBe(source)
    const child = await host.start(fixture(body))
    const ready = await child.ready()
    const admin = ready.admin()
    await (await fetch(admin.url + '/owner', { headers: admin.headers })).text()
    expect(await child.exited).toMatchObject({ exited: true })
    expect(child.startupDiagnostic?.()).toEqual({
      exitCode: 17,
      signal: null,
      stderr: 'Error: ended /fictional/plugin/server.mjs',
    })
  }, 15000)
  it('retains stderr and the actual exit when a server announces failed over IPC', async () => {
    const { host } = await context()
    const child = await host.start(
      fixture(`
import fs from 'node:fs';
process.on('SIGTERM', () => {});
fs.writeSync(2, 'Error: failed /fictional/plugin/server.mjs\\n');
process.send({ channel: 'brocrew-plugin-node:v1', runId: process.env.BROCREW_PLUGIN_RUN_ID, type: 'failed' },
  () => setTimeout(() => process.exit(29), 25));
`),
    )
    const refusal = await child.ready().catch((error: unknown) => error)
    expect(pluginStartupDiagnostic(refusal)).toEqual({
      exitCode: 29,
      signal: null,
      stderr: 'Error: failed /fictional/plugin/server.mjs',
    })
    expect(await child.exited).toMatchObject({ exited: true })
  }, 15000)
  it('a guardian that dies at start names its own error as the cause of the refusal', async () => {
    // A kept runtime whose guardian fails before it starts anything, as it would on a machine
    // where its process setup is refused.
    const failing = join(root, 'failing-guardian-resources')
    await cp(resources, failing, { recursive: true })
    await writeFile(
      join(failing, 'plugin-host', 'guardian.mjs'),
      "process.stderr.write('fictional guardian setup refused\\n'); process.exit(7)\n",
    )
    const dying = await preparePluginNodeRuntime({
      resourcesRoot: failing,
      durableRoot: join(root, 'failing-guardian-runtimes'),
    })
    const host = createPluginNodeHost({ root: join(root, 'failing-guardian'), runtime: dying })
    hosts.push(host)
    const child = await host.start(fixture(source))
    const refusal = await child.ready().then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(refusal).toMatchObject({ message: 'plugin-host-ready' })
    expect(String((refusal as Error).cause)).toContain('code 7')
    expect(String((refusal as Error).cause)).toContain('fictional guardian setup refused')
  }, 15000)
  it('refuses runtime tampering and never falls back to PATH', async () => {
    const bad = { id: 'fictional', version: process.versions.node }
    await expect(runtimeFiles(bad)).rejects.toThrow('plugin-host-runtime')
    await expect(
      preparePluginNodeRuntime({
        resourcesRoot: join(root, 'absent'),
        durableRoot: join(root, 'unused'),
      }),
    ).rejects.toThrow('plugin-host-runtime')
  })
  it('refuses modified executable or bootstrap bytes in a kept runtime', async () => {
    pluginStartupTrace.destination(root)
    const runtime = await preparePluginNodeRuntime({
      resourcesRoot: resources,
      durableRoot: join(root, 'other-runtimes'),
    })
    const paths = await runtimeFiles(runtime)
    await chmod(paths.node, 0o700)
    await writeFile(paths.node, 'fictional replaced node')
    await expect(runtimeFiles(runtime)).rejects.toThrow('plugin-host-runtime')
    await pluginStartupTrace.flush()
    pluginStartupTrace.destination(undefined)
    expect(await readFile(join(root, 'plugin-startup-trace.log'), 'utf8')).toContain(
      'runtime-files-verify failure',
    )
  })
  it('retries the same runtime after an interrupted private copy without publishing partial bytes', async () => {
    pluginStartupTrace.destination(root)
    const durableRoot = join(root, 'interrupted-runtime')
    copyFault.once = true
    await expect(
      preparePluginNodeRuntime({ resourcesRoot: resources, durableRoot }),
    ).rejects.toThrow('plugin-host-runtime')
    const entries = await readdir(durableRoot)
    expect(entries.filter((name) => /^[a-f0-9]{64}$/.test(name))).toEqual([])
    // A process killed before finally may leave its private stage; it is never a published runtime.
    const orphan = join(durableRoot, '.stage-fictional-abandoned')
    await mkdir(orphan, { mode: 0o700 })
    await writeFile(join(orphan, 'node'), 'partial fictional executable', { mode: 0o500 })
    const retried = await preparePluginNodeRuntime({ resourcesRoot: resources, durableRoot })
    expect(retried.id).toBe(runtime.id)
    expect((await runtimeFiles(retried)).node).toBe(join(durableRoot, retried.id, 'node'))
    expect(await readFile(join(orphan, 'node'), 'utf8')).toBe('partial fictional executable')
    await preparePluginNodeRuntime({ resourcesRoot: resources, durableRoot })
    await pluginStartupTrace.flush()
    pluginStartupTrace.destination(undefined)
    const log = await readFile(join(root, 'plugin-startup-trace.log'), 'utf8')
    for (const phase of [
      'runtime-hash end',
      'runtime-copy failure',
      'runtime-copy end',
      'runtime-verify end',
    ])
      expect(log).toContain(phase)
  }, 15000)
  it('refuses a tampered published runtime on preparation instead of repairing it', async () => {
    const durableRoot = join(root, 'published-tamper')
    const kept = await preparePluginNodeRuntime({ resourcesRoot: resources, durableRoot })
    const path = (await runtimeFiles(kept)).node
    await chmod(path, 0o700)
    await writeFile(path, 'fictional tampered published executable')
    await expect(
      preparePluginNodeRuntime({ resourcesRoot: resources, durableRoot }),
    ).rejects.toThrow('plugin-host-runtime')
    expect(await readFile(path, 'utf8')).toBe('fictional tampered published executable')
  }, 15000)
  it('reopens the exact durable runtime and refuses another identity or replaced metadata', async () => {
    const paths = await runtimeFiles(runtime)
    const directory = join(paths.node, '..')
    const reopened = await resumePluginNodeRuntime({ directory, id: runtime.id })
    expect(await runtimeFiles(reopened)).toEqual(paths)
    await expect(resumePluginNodeRuntime({ directory, id: '0'.repeat(64) })).rejects.toThrow(
      'plugin-host-runtime',
    )
    const metadata = join(directory, 'runtime.json'),
      before = await readFile(metadata)
    await chmod(metadata, 0o600)
    try {
      await writeFile(
        metadata,
        JSON.stringify({ ...JSON.parse(before.toString()), version: '24.99.0' }),
      )
      await expect(resumePluginNodeRuntime({ directory, id: runtime.id })).rejects.toThrow(
        'plugin-host-runtime',
      )
    } finally {
      await writeFile(metadata, before)
      await chmod(metadata, 0o400)
    }
  })
  it('continues using its durable runtime after the original app resources disappear', async () => {
    await rm(resources, { recursive: true })
    const { host } = await context()
    const child = await host.start(fixture())
    expect((await child.ready()).origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(await child.stop()).toEqual({ exited: true })
  }, 15000)
})
