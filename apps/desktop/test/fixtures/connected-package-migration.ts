import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { pluginSha256 } from '../../src/main/plugins/package-digests'
import { tar } from '../plugin-package-fixtures'

export type MigratedPackage = 'chrome' | 'whatsapp'
const repository = fileURLToPath(new URL('../../../..', import.meta.url))

// Exact package pins are staged privately by the root executor, separate from app dependencies.
interface Builder {
  onResolve(
    options: { filter: RegExp },
    resolve: (args: {
      path: string
      importer: string
    }) => { path: string; namespace: string } | undefined,
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

/** The only replacement modules are the native browser and Go process boundaries. */
function boundarySource(id: MigratedPackage, packageRoot: string): string {
  const imports = JSON.stringify(join(packageRoot, 'test', 'fakes.ts'))
  const common = String.raw`
import fs from 'node:fs';
import path from 'node:path';
const bootstrap=JSON.parse(process.env.BROCREW_PLUGIN_BOOTSTRAP);
const audit=path.join(bootstrap.sharedDataDirectory,'fictional-boundary.jsonl');
const record=(event,extra={})=>fs.appendFileSync(audit,JSON.stringify({event,runId:bootstrap.instanceId,...extra})+'\n');
`
  if (id === 'chrome')
    return (
      common +
      `
import {FakeBrowser} from ${imports};
export class ChromeBrowser extends FakeBrowser {
 constructor(options) { super(options.dirOf); record('browser-start',{bootstrap}); }
 async ensure(profile,mode) { record('browser-open',{profile,mode}); return super.ensure(profile,mode); }
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
  const dependencyRoot = join(repository, '.test-toolchain/package-dependencies/node_modules')
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
  const result = await bundler.build({
    absWorkingDir: repository,
    entryPoints: [entry],
    outfile: join(output, `${id}-ephemeral-entry.mjs`),
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
  const sdkMarker = '/node_modules/@modelcontextprotocol/sdk/'
  const sdkRoots = new Set(
    Object.keys(result.metafile.inputs).flatMap((file) => {
      const absolute = resolve(repository, file).replaceAll('\\', '/')
      const at = absolute.lastIndexOf(sdkMarker)
      return at === -1 ? [] : [absolute.slice(0, at + sdkMarker.length)]
    }),
  )
  if (sdkRoots.size === 0) throw new Error('Actual package MCP SDK was not bundled')
  for (const root of sdkRoots) {
    const actual = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    if (actual.version !== '1.32.1') throw new Error('App SDK fallback entered the package bundle')
  }
  const server = Buffer.from(result.outputFiles[0]!.contents)
  const files = new Map<string, Buffer>([['server.mjs', server]])
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
      // Runtime discovery remains the real server's tools/list. No invented static tool inventory.
      tools: { source: 'mcp' },
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
  }
}
