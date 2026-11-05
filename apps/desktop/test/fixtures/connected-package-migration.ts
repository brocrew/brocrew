import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { SHARED_DATA_FEATURE } from '../../src/main/plugins/shared-data-contract'
import { pluginSha256 } from '../../src/main/plugins/package-digests'
import { manifestFor, packageFixture, tar } from '../plugin-package-fixtures'

export type MigratedPackage = 'chrome' | 'whatsapp'
const repository = fileURLToPath(new URL('../../../..', import.meta.url))

// Exact package pins are staged privately by the root executor, separate from app dependencies.
interface Builder {
  resolve(
    path: string,
    options: { resolveDir: string; kind: string; pluginData: { staged: true } },
  ): Promise<{ path: string; errors: unknown[] }>
  onResolve(
    options: { filter: RegExp },
    resolve: (args: {
      path: string
      importer: string
      kind: string
      pluginData?: { staged?: boolean }
    }) => { path: string; namespace?: string } | undefined | Promise<{ path: string } | undefined>,
  ): void
  onLoad(
    options: { filter: RegExp; namespace: string },
    load: () => { contents: string; loader: string; resolveDir: string },
  ): void
}
interface Bundle {
  build(options: Record<string, unknown>): Promise<{
    outputFiles: { contents: Uint8Array }[]
    metafile: { inputs: Record<string, unknown> }
  }>
}

const pinnedImports = ['@modelcontextprotocol/sdk', 'express', 'playwright-core']

/** Check actual bundle inputs against the isolated npm lock, including legitimate nested deps. */
export async function packageBundleProvenance(inputs: string[], dependencyRoot: string) {
  const realRoot = await realpath(dependencyRoot)
  const lock = JSON.parse(
    await readFile(join(dirname(dependencyRoot), 'package-lock.json'), 'utf8'),
  ) as {
    packages: Record<string, { version?: string }>
  }
  const roots = new Map<string, string>()
  for (const file of inputs) {
    const absolute = resolve(repository, file).replaceAll('\\', '/')
    const marker = '/node_modules/'
    const at = absolute.lastIndexOf(marker)
    if (at === -1) continue
    const tail = absolute.slice(at + marker.length).split('/')
    const name = tail[0]!.startsWith('@') ? tail.slice(0, 2).join('/') : tail[0]!
    if (pinnedImports.includes(name))
      roots.set(absolute.slice(0, at + marker.length + name.length), name)
  }
  const checked: { name: string; version: string; lockPath: string }[] = []
  for (const [root, name] of roots) {
    const path = relative(realRoot, await realpath(root))
    if (
      path === '..' ||
      path.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) ||
      isAbsolute(path)
    )
      throw new Error(`Shadowed package dependency outside staged root: ${name}`)
    const lockPath = 'node_modules/' + path.replaceAll('\\', '/')
    const version = lock.packages[lockPath]?.version
    const actual = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    if (!version || actual.version !== version)
      throw new Error(`Bundled dependency disagrees with isolated package lock: ${name}`)
    checked.push({ name, version, lockPath })
  }
  return checked
}

/** The only replacement modules are the native browser and Go process boundaries. */
function boundarySource(id: MigratedPackage, packageRoot: string): string {
  const imports = JSON.stringify(join(packageRoot, 'test', 'fakes.ts'))
  const common = String.raw`
import fs from 'node:fs';
import path from 'node:path';
const readBootstrap=()=>JSON.parse(process.env.BROCREW_PLUGIN_BOOTSTRAP);
const record=(event,extra={})=>{
 const bootstrap=readBootstrap();
 const audit=path.join(bootstrap.sharedDataDirectory,'fictional-boundary.jsonl');
 fs.appendFileSync(audit,JSON.stringify({event,runId:bootstrap.instanceId,...extra})+'\n');
};
`
  if (id === 'chrome')
    return (
      common +
      `
import {FakeBrowser} from ${imports};
export class ChromeBrowser extends FakeBrowser {
 constructor(options) { super(options.dirOf); record('browser-start',{bootstrap:readBootstrap()}); }
 async ensure(profile,mode) { record('browser-open',{profile,mode}); return super.ensure(profile,mode); }
 async turnHelperOn(profile) { record('helper-on',{profile}); await super.turnHelperOn(profile); }
 visiblePages() { return []; }
 async closeAll() { for(const name of [...this.states.keys()]) await this.close(name); record('browser-close'); }
}
`
    )
  return (
    common +
    `
import {FakeBridge} from ${imports};
export function startBridge(options) {
 const bootstrap=readBootstrap();
 record('bridge-start',{bootstrap,home:options.config.home,bridgeData:options.config.bridgeData});
 const state=JSON.parse(fs.readFileSync(path.join(bootstrap.sharedDataDirectory,'fictional-phone.json'),'utf8'));
 class FictionalBridge extends FakeBridge {
  status() { return {...super.status(),removeOnPhone:state.warning}; }
  async pair() { record('bridge-pair'); return super.pair(); }
  async unlink() { record('bridge-unlink'); await super.unlink(); options.onUnlinked?.(); }
  async close() { record('bridge-close'); await super.close(); }
 }
 return new FictionalBridge();
}
`
  )
}

/**
 * An ephemeral test archive, never a distributable package or native artifact build.
 * v1 and v2 use identical production entry/server/config/UI bytes; only release metadata changes.
 * The root stages exact package dependencies; the fixture never falls back to app SDK versions.
 */
export async function migrationPackages(id: MigratedPackage, output: string) {
  const dependencyRoot =
    process.env.BROCREW_PLUGIN_TEST_DEPENDENCIES ??
    join(repository, 'scripts/gates/plugin-test-dependencies/node_modules')
  const packageRequire = createRequire(join(dependencyRoot, 'fictional-fixture.cjs'))
  const dependencies: Record<string, string> = {}
  for (const [name, version] of [
    ['@modelcontextprotocol/sdk', '1.32.1'],
    ['express', '4.22.3'],
    ['playwright-core', '1.61.0'],
    ['esbuild', '0.25.12'],
  ]) {
    const metadata = JSON.parse(await readFile(join(dependencyRoot, name!, 'package.json'), 'utf8'))
    if (metadata.version !== version)
      throw new Error(
        `Fixture package dependency ${name}: expected ${version}, got ${metadata.version}`,
      )
    dependencies[name!] = metadata.version
  }
  const bundler = packageRequire('esbuild') as Bundle
  const packageRoot = join(repository, 'plugins', id)
  const entry = join(packageRoot, 'src/index.ts')
  const boundary = id === 'chrome' ? /(?:^|\/)browser\/chromeBrowser\.js$/ : /^\.\/bridge\.js$/
  const bundlePath = join(output, `${id}-ephemeral-entry.mjs`)
  const result = await bundler.build({
    absWorkingDir: repository,
    entryPoints: [entry],
    outfile: bundlePath,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    bundle: true,
    write: false,
    metafile: true,
    nodePaths: [dependencyRoot],
    define: { BROCREW_BRIDGE_SHA256: JSON.stringify('fictional-go-boundary-no-native-program') },
    banner: {
      js: "import { createRequire as fixtureCreateRequire } from 'node:module'; const require = fixtureCreateRequire(import.meta.url);",
    },
    plugins: [
      {
        name: 'fictional-native-boundary',
        setup(builder: Builder) {
          builder.onResolve(
            { filter: /^(?:@modelcontextprotocol\/sdk|express|playwright-core)(?:\/|$)/ },
            async (args) => {
              if (args.pluginData?.staged || !args.importer.startsWith(packageRoot))
                return undefined
              const resolved = await builder.resolve(args.path, {
                resolveDir: dirname(dependencyRoot),
                kind: args.kind,
                pluginData: { staged: true },
              })
              if (resolved.errors.length)
                throw new Error('Cannot resolve staged package dependency: ' + args.path)
              return { path: resolved.path }
            },
          )
          builder.onResolve({ filter: boundary }, (args) =>
            args.importer === entry ? { path: id, namespace: 'fictional-native' } : undefined,
          )
          builder.onLoad({ filter: /.*/, namespace: 'fictional-native' }, () => ({
            contents: boundarySource(id, packageRoot),
            loader: 'js',
            resolveDir: packageRoot,
          }))
        },
      },
    ],
  })
  const provenance = await packageBundleProvenance(
    Object.keys(result.metafile.inputs),
    dependencyRoot,
  )
  if (
    !provenance.some(
      (entry) => entry.name === '@modelcontextprotocol/sdk' && entry.version === '1.32.1',
    )
  )
    throw new Error('Actual staged package MCP SDK was not bundled')
  const server = Buffer.from(result.outputFiles[0]!.contents)
  const files = new Map<string, Buffer>([['server.mjs', server]])
  // Match the package builders: document the actual definitions without starting the entry.
  // The fictional native boundary reads bootstrap only when used by a running package.
  await writeFile(bundlePath, server)
  const definitions = await import(/* @vite-ignore */ pathToFileURL(bundlePath).href)
  const data = '${BROCREW_PLUGIN_DATA}'
  const inventory =
    id === 'chrome'
      ? definitions.chromeToolInventory()
      : {
          tools: definitions
            .whatsappTools(
              {
                home: data,
                files: data + '/files',
                downloads: data + '/downloads',
                bridgeData: data + '/bridge',
                scratch: data + '/scratch',
                bin: data + '/bin',
              },
              { bridge: {}, settings: {} },
            )
            .map((tool: { definition: unknown }) => tool.definition),
        }
  files.set('tools.json', Buffer.from(JSON.stringify(inventory, null, 2) + '\n'))
  for (const name of ['index.html', 'app.js', 'style.css'])
    files.set('ui/' + name, await readFile(join(packageRoot, 'ui', name)))
  if (id === 'chrome')
    for (const name of ['manifest.json', 'worker.js'])
      files.set('helper/' + name, await readFile(join(packageRoot, 'helper', name)))
  const template = JSON.parse(await readFile(join(packageRoot, 'manifest-template.json'), 'utf8'))
  const originalVersion = template.version as string
  const parts = originalVersion.split('.').map(Number)
  const versions = [originalVersion, `${parts[0]}.${parts[1]}.${parts[2]! + 1}`]
  const refs = []
  for (const version of versions) {
    const manifest = {
      ...template,
      version,
      platforms: [{ os: process.platform, cpu: process.arch }],
      // Keep the template's required tools.inventory; runtime discovery still uses tools/list.
      files: [...files].map(([path, body]) => ({
        path,
        bytes: body.length,
        sha256: pluginSha256(body),
      })),
    }
    const archive = tar([
      { path: 'plugin.json', body: Buffer.from(JSON.stringify(manifest)) },
      ...[...files].map(([path, body]) => ({ path, body })),
    ])
    const source = join(output, `${id}-${version}-fictional.tar`)
    await writeFile(source, archive)
    refs.push({ source, sha256: pluginSha256(archive), bytes: archive.length })
  }
  return {
    refs,
    versions,
    files,
    inputs: Object.keys(result.metafile.inputs),
    dependencies,
    provenance,
  }
}

/** Fictional predecessor only: no domain read/apply/migration/delete behavior or data access. */
export async function historicalPackage(id: MigratedPackage, format: 1 | 2, output: string) {
  const entry = String.raw`
import fs from 'node:fs';
import http from 'node:http';
const auth=JSON.parse(fs.readFileSync(process.env['BROCREW_'+PLUGIN.toUpperCase()+'_AUTH'],'utf8'));
const server=http.createServer((req,res)=>{
 if(req.url!=='/mcp') {res.writeHead(404);return res.end();}
 if(req.headers.authorization!=='Bearer '+auth.mcpToken) {res.writeHead(401);return res.end();}
 if(req.method!=='POST') {res.writeHead(405);return res.end();}
 let body=''; req.on('data',chunk=>body+=chunk); req.on('end',()=>{
  const packet=JSON.parse(body);
  if(packet.id===undefined) {res.writeHead(202);return res.end();}
  let response;
  if(packet.method==='initialize') response={result:{protocolVersion:packet.params.protocolVersion,serverInfo:{name:'fictional-historical-readiness-only',version:'0.0.1'},capabilities:{tools:{}}}};
  else if(packet.method==='tools/list') response={result:{tools:[]}};
  else response={error:{code:-32601,message:'No domain behavior in the fictional predecessor'}};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:packet.id,...response}));
 });
});
server.listen(0,'127.0.0.1',()=>process.send({channel:'brocrew-plugin-node:v1',runId:process.env.BROCREW_PLUGIN_RUN_ID,type:'listening',port:server.address().port}));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`.replace('PLUGIN', JSON.stringify(id))
  const files = new Map([['historical.mjs', Buffer.from(entry)]])
  const manifest = manifestFor(files)
  manifest.id = id
  manifest.version = '0.0.1'
  manifest.platforms = [
    { os: process.platform as 'darwin' | 'linux' | 'win32', cpu: process.arch as 'arm64' | 'x64' },
  ]
  manifest.server = { entry: 'historical.mjs', mcpPath: '/mcp', adminPath: '/unused' }
  manifest.skills = []
  manifest.serviceTemplates = []
  manifest.ui = null
  manifest.uiApi = null
  if (format === 2)
    Object.assign(manifest, {
      format: 2,
      authors: ['fictional-predecessor'],
      executor: { kind: 'node', entry: 'historical.mjs' },
      hooks: [],
      sharedData: true,
      hostApi: { ...manifest.hostApi, requiredFeatures: [SHARED_DATA_FEATURE] },
    })
  const pkg = packageFixture({ files, manifest })
  const source = join(output, `${id}-historical-format${format}.tar`)
  await writeFile(source, pkg.archive)
  return { ...pkg, ref: { source, sha256: pkg.release.archive.sha256, bytes: pkg.archive.length } }
}
