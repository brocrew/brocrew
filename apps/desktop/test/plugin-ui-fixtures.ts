import { manifestFor, packageFixture, payload, verified } from './plugin-package-fixtures'
import { tar } from './plugin-package-fixtures'
import { verifyPluginPackage } from '../src/main/plugins/package-verifier'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import type { GenericPluginManifest } from '../src/main/plugins/generic-manifest'
import type { PluginTarget } from '../src/main/plugins/package-schema'
export function uiFixture() {
  const files = payload()
  files.set(
    'ui/index.html',
    Buffer.from(
      '<!doctype html><title>Fictional bakery</title><script src="app.js" defer></script>',
    ),
  )
  files.set('ui/app.js', Buffer.from('document.documentElement.dataset.ready = "yes";'))
  const manifest = manifestFor(files)
  manifest.ui!.assets.push({ path: 'ui/app.js', mime: 'text/javascript' })
  manifest.ui!.methodSchemas.unsubscribe = {
    type: 'object',
    properties: { subscriptionId: { type: 'string', maxLength: 64 } },
    required: ['subscriptionId'],
    additionalProperties: false,
  }
  manifest.ui!.methodSchemas.proposeConfig = {
    type: 'object',
    properties: { loaves: { type: 'integer', minimum: 0, maximum: 12 } },
    required: ['loaves'],
    additionalProperties: false,
  }
  const fixture = packageFixture({ files, manifest })
  return {
    fixture,
    verified: verified(fixture),
    binding: {
      pluginId: manifest.id,
      releaseDigest: fixture.release.archive.sha256,
      installId: 'fictional-install',
      incarnation: 'fictional-incarnation',
      leaseId: 'fictional-private-lease',
    },
  }
}

export function genericUiFixture(
  options: Pick<GenericPluginManifest, 'ui' | 'hooks'> & {
    version?: string
    target?: PluginTarget
  } = {},
) {
  const target: PluginTarget = options.target ?? { os: 'linux', cpu: 'x64' }
  const files = new Map([
    ['main.mjs', Buffer.from('// Inert fictional runtime.')],
    ['tools.json', Buffer.from('{"tools":[]}')],
    [
      'ui/index.html',
      Buffer.from(
        '<!doctype html><title>Fictional bakery</title><script src="app.js" defer></script>',
      ),
    ],
    ['ui/app.js', Buffer.from('document.documentElement.dataset.ready = "yes";')],
  ])
  const manifest = {
    format: 3,
    id: 'fictional-bakery',
    version: options.version ?? '1.0.0',
    name: 'Fictional bakery',
    description: 'Fictional recipes.',
    authors: ['Fictional Baker'],
    platforms: [target],
    permissions: { description: 'Save fictional recipes.' },
    files: [...files].map(([path, bytes]) => ({
      path,
      bytes: bytes.length,
      sha256: pluginSha256(bytes),
    })),
    runtime: { kind: 'node', entry: 'main.mjs' },
    mcp: { transport: 'stdio' },
    tools: { source: 'mcp', inventory: 'tools.json' },
    settings: { page: { entry: 'ui/index.html', assets: ['ui/index.html', 'ui/app.js'] } },
    lifecycle: { stop: { signal: 'SIGTERM' }, dataOnRemove: 'keep' },
    data: { schema: 1 },
    ...(options.ui ? { ui: options.ui } : {}),
    ...(options.hooks ? { hooks: options.hooks } : {}),
  }
  const archive = tar([
    { path: 'plugin.json', body: Buffer.from(JSON.stringify(manifest)) },
    ...[...files].map(([path, body]) => ({ path, body })),
  ])
  const digest = pluginSha256(archive)
  return {
    archive,
    verified: verifyPluginPackage(
      archive,
      { sha256: digest, bytes: archive.length, compression: 'tar' },
      { target, appVersion: '1.0.0' },
    ),
    binding: {
      pluginId: manifest.id,
      releaseDigest: digest,
      installId: 'fictional-install',
      incarnation: 'fictional-incarnation',
      leaseId: 'fictional-ui-lease',
    },
  }
}
