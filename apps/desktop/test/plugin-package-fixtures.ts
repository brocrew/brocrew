import { createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import type { PluginManifest, PluginRelease } from '../src/main/plugins/package-schema'
import { createPluginVerifier } from '../src/main/plugins/package-verifier'

// Public deterministic test material, never a production key and never written to disk.
const key = createPrivateKey({
  key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.alloc(32, 0x42),
  ]),
  format: 'der',
  type: 'pkcs8',
})
export const fictionalPublicKey = createPublicKey(key)
export const signed = (value: unknown) => {
  const bytes = Buffer.from(JSON.stringify(value))
  return { bytes, signature: sign(null, bytes, key) }
}
export const initialApi = () => ({ major: 1, minMinor: 0, maxMinor: 0, requiredFeatures: [] })
export const payload = (): Map<string, Buffer> =>
  new Map([
    [
      'dist/recipe.mjs',
      Buffer.from(
        '// Inert fixture: no imports, processes, or effects.\nexport const recipe = 1;\n',
      ),
    ],
    [
      'bread/SKILL.md',
      Buffer.from(
        '---\nname: bread\ndescription: A fictional bread skill.\n---\nCount the loaves.\n',
      ),
    ],
    ['rules/baker.md', Buffer.from('Describe fictional bread.')],
    ['ui/index.html', Buffer.from('<!doctype html><title>Fictional bakery</title>')],
  ])
export const inventory = (files: ReadonlyMap<string, Buffer>) =>
  [...files].map(([path, body]) => ({
    path,
    type: 'file' as const,
    size: body.length,
    sha256: pluginSha256(body),
  }))
export function manifestFor(files = payload()): PluginManifest {
  const schema = () => ({
    type: 'object' as const,
    properties: {},
    additionalProperties: false as const,
  })
  return {
    format: 1,
    id: 'fictional-bakery',
    version: '1.0.0',
    sourceCommit: 'a'.repeat(40),
    platforms: [
      { os: 'linux', cpu: 'x64' },
      { os: 'win32', cpu: 'arm64' },
    ],
    hostApi: initialApi(),
    toolApi: initialApi(),
    uiApi: initialApi(),
    dataSchema: 1,
    files: inventory(files),
    server: { entry: 'dist/recipe.mjs', mcpPath: '/mcp', adminPath: '/admin' },
    skills: [
      {
        name: 'bread',
        version: '1.0.0',
        path: 'bread/SKILL.md',
        description: 'A fictional bread skill.',
        reminder: 'Count fictional loaves.',
      },
    ],
    serviceTemplates: [
      {
        id: 'baker',
        rules: 'rules/baker.md',
        provider: 'codex',
        model: 'fictional-model',
        effort: null,
        requiredTools: [],
      },
    ],
    ui: {
      entry: 'ui/index.html',
      assets: [{ path: 'ui/index.html', mime: 'text/html' }],
      methodSchemas: {
        read: schema(),
        subscribe: schema(),
        unsubscribe: schema(),
        proposeConfig: schema(),
      },
      texts: [{ id: 'bakery', text: 'Fictional bakery' }],
    },
    permissions: {
      description: 'Read fictional recipes.',
      resources: [{ id: 'recipes', label: 'Fictional recipes', read: true, write: false }],
    },
    dataCompatibility: { minSchema: 1, maxSchema: 1 },
  }
}
export interface TarEntry {
  path: string
  body?: Buffer
  type?: string
  prefix?: string
  mode?: number
  link?: string
}
export function tarChecksum(header: Buffer): void {
  header.fill(32, 148, 156)
  header.write(
    [...header]
      .reduce((sum, value) => sum + value, 0)
      .toString(8)
      .padStart(6, '0') + '\0 ',
    148,
    'ascii',
  )
}
export function tar(entries: readonly TarEntry[]): Buffer {
  const chunks: Buffer[] = []
  for (const entry of entries) {
    const header = Buffer.alloc(512)
    const body = entry.body ?? Buffer.alloc(0)
    header.write(entry.path, 0, 100, 'utf8')
    const octal = (number: number, at: number, length: number) =>
      header.write(number.toString(8).padStart(length - 1, '0') + '\0', at, length, 'ascii')
    octal(entry.mode ?? 0o644, 100, 8)
    octal(0, 108, 8)
    octal(0, 116, 8)
    octal(body.length, 124, 12)
    octal(0, 136, 12)
    header.write(entry.type ?? '0', 156, 1, 'ascii')
    if (entry.link) header.write(entry.link, 157, 100, 'utf8')
    header.write('ustar\0', 257, 'ascii')
    header.write('00', 263, 'ascii')
    if (entry.prefix) header.write(entry.prefix, 345, 155, 'utf8')
    tarChecksum(header)
    chunks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)])
}
export function packageFixture(
  options: {
    files?: Map<string, Buffer>
    manifest?: PluginManifest
    entries?: TarEntry[]
    compression?: 'tar' | 'tar.gz'
  } = {},
) {
  const files = options.files ?? payload()
  const manifest = options.manifest ?? manifestFor(files)
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  const plain = tar(
    options.entries ?? [
      { path: 'plugin.json', body: manifestBytes },
      ...[...files].map(([path, body]) => ({ path, body })),
    ],
  )
  const compression = options.compression ?? 'tar'
  const archive = compression === 'tar.gz' ? gzipSync(plain) : plain
  const release: PluginRelease = {
    id: manifest.id,
    version: manifest.version,
    sourceCommit: manifest.sourceCommit,
    platforms: manifest.platforms,
    archive: {
      url: 'https://plugins.example.invalid/bakery.tar',
      size: archive.length,
      sha256: pluginSha256(archive),
      compression,
    },
    manifestSha256: pluginSha256(manifestBytes),
  }
  const catalogue = { format: 1 as const, entries: [release] }
  const signature = signed(catalogue)
  return { files, manifest, manifestBytes, archive, release, catalogue, ...signature }
}
export const verifier = () =>
  createPluginVerifier({ pinnedPublicKey: fictionalPublicKey, target: { os: 'linux', cpu: 'x64' } })
export function verified(fixture = packageFixture()) {
  return verifier()
    .verifyCatalogue(fixture.bytes, fixture.signature)
    .verifyPackage(fixture.release.id, fixture.release.version, fixture.archive)
}
