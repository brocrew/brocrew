import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { pluginSha256 } from '../../src/main/plugins/package-digests'
import { tar } from '../plugin-package-fixtures'

export type MigratedPackage = 'chrome' | 'whatsapp'
const repository = fileURLToPath(new URL('../../../..', import.meta.url))

// esbuild is supplied by the desktop's existing Vitest -> Vite dependency, not an install here.
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
 * The supplied desktop dependency versions are recorded rather than mislabeled package pins.
 */
export async function migrationPackages(id: MigratedPackage, output: string) {
  const localRequire = createRequire(import.meta.url)
  const vitestRequire = createRequire(localRequire.resolve('vitest/package.json'))
  const viteRequire = createRequire(vitestRequire.resolve('vite/package.json'))
  const bundler = viteRequire('esbuild') as Bundle
  const desktopRequire = createRequire(join(repository, 'apps/desktop/package.json'))
  const sdkEntry = desktopRequire.resolve('@modelcontextprotocol/sdk/server/index.js')
  const sdkJson = join(dirname(dirname(dirname(dirname(sdkEntry)))), 'package.json')
  const sdkRequire = createRequire(sdkJson)
  const packageRoot = join(repository, 'plugins', id)
  const entry = join(packageRoot, 'src/index.ts')
  const boundary = id === 'chrome' ? /(?:^|\/)browser\/chromeBrowser\.js$/ : /^\.\/bridge\.js$/
  const result = await bundler.build({
    entryPoints: [entry],
    outfile: join(output, `${id}-ephemeral-entry.mjs`),
    platform: 'node',
    target: 'node22',
    format: 'esm',
    bundle: true,
    write: false,
    metafile: true,
    // Package-pinned dependencies, if staged beside the package, take normal precedence.
    // Otherwise the root run explicitly uses the desktop SDK and its Express dependency.
    nodePaths: [join(repository, 'apps/desktop/node_modules'), dirname(dirname(dirname(sdkJson)))],
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
    desktopFallbackDependencies: {
      sdk: JSON.parse(await readFile(sdkJson, 'utf8')).version as string,
      express: JSON.parse(await readFile(sdkRequire.resolve('express/package.json'), 'utf8'))
        .version as string,
    },
  }
}
