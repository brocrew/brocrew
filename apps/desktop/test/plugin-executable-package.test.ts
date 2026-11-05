import { afterEach, describe, expect, it } from 'vitest'
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gzipSync } from 'node:zlib'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { verifyPluginPackage, verifiedPluginDigest } from '../src/main/plugins/package-verifier'
import { createPluginNodeHost } from '../src/main/plugins/node-host'
import { preparePluginNodeRuntime } from '../src/main/plugins/node-runtime'
import { tar } from './plugin-package-fixtures'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  const failures: unknown[] = []
  for (const close of cleanup.splice(0).reverse()) {
    try {
      await close()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length)
    throw new AggregateError(failures, 'Fictional executable fixture cleanup failed')
})

function fixture(processEntry = false, compressed = false) {
  const helper = 'helpers/fictional helper.mjs'
  const source = String.raw`
import readline from 'node:readline';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const helper=fileURLToPath(new URL('./helpers/fictional helper.mjs',import.meta.url));
readline.createInterface({input:process.stdin}).on('line',line=>{
 const packet=JSON.parse(line);if(packet.id===undefined)return;
 const reply=result=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:packet.id,result})+'\n');
 if(packet.method==='initialize')return reply({protocolVersion:packet.params.protocolVersion,serverInfo:{name:'fictional-parent-helper',version:'1'},capabilities:{tools:{}}});
 if(packet.method==='tools/list')return reply({tools:[{name:'fictional_helper',inputSchema:{type:'object'}}]});
 if(packet.method==='tools/call'){
  // Windows does not use POSIX mode bits: execute this same fictional JS through Node there.
  const command=process.platform==='win32'?process.execPath:helper;
  const args=process.platform==='win32'?[helper,'opaque-fixture']:['opaque-fixture'];
  const text=execFileSync(command,args,{encoding:'utf8'});
  return reply({content:[{type:'text',text}],structuredContent:{text,directExecutable:process.platform!=='win32'}});
 }
});
`
  const files = new Map([
    ['parent.mjs', Buffer.from('#!' + process.execPath + '\n' + source)],
    [
      helper,
      Buffer.from(
        '#!' + process.execPath + '\nprocess.stdout.write("fictional-helper:"+process.argv[2]);\n',
      ),
    ],
    ['tools.json', Buffer.from('{"tools":[]}')],
  ])
  const manifest = {
    format: 3,
    id: 'fictional-executable-parent',
    name: 'Fictional executable parent',
    version: '1.0.0',
    description: 'Run a fictional packaged helper.',
    authors: ['Fictional Keeper'],
    platforms: [{ os: process.platform, cpu: process.arch }],
    permissions: { description: 'Fictional files only' },
    files: [...files].map(([path, bytes]) => ({
      path,
      bytes: bytes.length,
      sha256: pluginSha256(bytes),
    })),
    runtime: processEntry
      ? { kind: 'process', command: 'parent.mjs' }
      : { kind: 'node', entry: 'parent.mjs' },
    mcp: { transport: 'stdio' },
    tools: { source: 'mcp', inventory: 'tools.json' },
    lifecycle: { stop: { signal: 'SIGTERM', graceMs: 200 }, dataOnRemove: 'keep' },
    data: { schema: 1 },
  }
  const plain = tar([
    { path: 'plugin.json', body: Buffer.from(JSON.stringify(manifest)) },
    ...[...files].map(([path, body]) => ({
      path: './' + path,
      body,
      mode: path === helper ? 0o751 : 0o644,
    })),
  ])
  const archive = compressed ? gzipSync(plain) : plain
  const pkg = verifyPluginPackage(
    archive,
    { sha256: pluginSha256(archive), bytes: archive.length },
    { target: manifest.platforms[0] as never, appVersion: '1.0.0' },
  )
  return { pkg, helper, files, spec: { package: pkg, releaseDigest: verifiedPluginDigest(pkg)! } }
}

async function hostFixture() {
  const root = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-executable-')),
  )
  // Windows can hold a stopped process's executable open for a moment after it exits.
  cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }))
  const resources = join(root, 'resources')
  await mkdir(join(resources, 'plugin-node'), { recursive: true })
  await copyFile(
    process.execPath,
    join(resources, 'plugin-node', process.platform === 'win32' ? 'node.exe' : 'node'),
  )
  await cp(new URL('../resources/plugin-host/', import.meta.url), join(resources, 'plugin-host'), {
    recursive: true,
  })
  const runtime = await preparePluginNodeRuntime({
    resourcesRoot: resources,
    durableRoot: join(root, 'runtime'),
  })
  const home = join(root, 'host')
  const host = createPluginNodeHost({ root: home, runtime })
  cleanup.push(async () => {
    expect(await host.stop()).toEqual({ exited: true })
  })
  return { root, home, host }
}

describe('ordinary packaged executable metadata', () => {
  it.each([false, true])(
    'retains tar execute bits through verified normalized paths, gzip=%s',
    (compressed) => {
      const { pkg, helper, files } = fixture(false, compressed)
      expect(
        (pkg as typeof pkg & { isExecutable?(path: string): boolean }).isExecutable?.(helper),
      ).toBe(true)
      expect(
        (pkg as typeof pkg & { isExecutable?(path: string): boolean }).isExecutable?.(
          './helpers/./fictional helper.mjs',
        ),
      ).toBe(true)
      expect(
        (pkg as typeof pkg & { isExecutable?(path: string): boolean }).isExecutable?.('parent.mjs'),
      ).toBe(false)
      expect(
        (pkg as typeof pkg & { isExecutable?(path: string): boolean }).isExecutable?.('absent'),
      ).toBe(false)
      expect(Buffer.from(pkg.readFile(helper)!)).toEqual(files.get(helper))
    },
  )
  it('starts a real Node parent that directly executes its staged auxiliary tar helper without external chmod', async () => {
    const { host, home } = await hostFixture()
    const { spec, helper } = fixture()
    const run = await host.start(spec)
    const ready = await run.ready()
    expect(
      (await ready.client!.callTool({ name: 'fictional_helper', arguments: {} })).structuredContent,
    ).toEqual({
      text: 'fictional-helper:opaque-fixture',
      directExecutable: process.platform !== 'win32',
    })
    if (process.platform !== 'win32')
      expect((await stat(join(home, 'packages', spec.releaseDigest, helper))).mode & 0o777).toBe(
        0o500,
      )
  }, 180000)
  it('repairs cached same-byte nonexecutable helpers while retaining declared process-entry fallback', async () => {
    const { host, home } = await hostFixture()
    // A process entry with no tar execute bit remains executable by its declared entry fallback.
    const { spec, helper, files } = fixture(process.platform !== 'win32')
    const first = await host.start(spec)
    await first.ready()
    expect(await first.stop()).toEqual({ exited: true })
    const path = join(home, 'packages', spec.releaseDigest, helper)
    // Only this negative cache control uses chmod, simulating publication by the previous app.
    await chmod(path, 0o400)
    const next = await host.start(spec)
    const ready = await next.ready()
    expect(
      (await ready.client!.callTool({ name: 'fictional_helper', arguments: {} })).content,
    ).toEqual([{ type: 'text', text: 'fictional-helper:opaque-fixture' }])
    expect(await readFile(path)).toEqual(files.get(helper))
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o500)
    expect(await next.stop()).toEqual({ exited: true })
    await chmod(path, 0o600)
    await writeFile(path, 'fictional changed helper bytes')
    await chmod(path, 0o400)
    await expect(host.start(spec)).rejects.toThrow('plugin-host-paths')
    expect(await readFile(path, 'utf8')).toBe('fictional changed helper bytes')
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o400)
  }, 180000)
})
