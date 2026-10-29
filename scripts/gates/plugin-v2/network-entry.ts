// Built and executed BEFORE projection, under a fictional home on an admitted hosted runner only.
import fs from 'node:fs'
import path from 'node:path'
import { downloadPluginBytes } from '../../../apps/desktop/src/main/plugins/catalogue/download'
import {
  loadRepoPluginList,
  parseRepoPluginList,
} from '../../../apps/desktop/src/main/plugins/catalogue/repo-list'
import { createRepoAwarePluginVerifier } from '../../../apps/desktop/src/main/plugins/package-verifier'
import { pluginSha256 } from '../../../apps/desktop/src/main/plugins/package-digests'
import { keepPluginRootPrivate } from '../../../apps/desktop/src/main/plugins/private-files'

export async function networkProof(root: string, candidate: Buffer, appVersion: string) {
  const target =
    process.platform === 'darwin'
      ? { os: 'darwin' as const, cpu: 'arm64' as const }
      : { os: 'win32' as const, cpu: 'x64' as const }
  const native = globalThis.fetch,
    hops: { request: string; host: string; status: number }[] = []
  const archives: {
    id: string
    version: string
    os: string
    cpu: string
    bytes: number
    sha256: string
  }[] = []
  let request = 'v1'
  // Passive observation only. Return the SAME response/body, without following a redirect here.
  globalThis.fetch = async (input, init) => {
    if (init?.credentials !== 'omit' || init?.redirect !== 'manual')
      throw new Error('Transport policy changed')
    const response = await native(input, init)
    const host = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    ).hostname
    if (
      hops.length >= 32 ||
      ![
        'raw.githubusercontent.com',
        'github.com',
        'release-assets.githubusercontent.com',
        'objects.githubusercontent.com',
      ].includes(host)
    )
      throw new Error('Unbounded transport witness')
    hops.push({ request, host, status: response.status })
    return response
  }
  try {
    const listRoot = path.join(root, 'network-root')
    fs.mkdirSync(listRoot, { mode: 0o700 })
    await keepPluginRootPrivate(listRoot)
    const options = { root: listRoot, target, appVersion }
    const v1 = await loadRepoPluginList({ ...options, sourceVersion: 1 })
    request = 'v2'
    const v2 = await loadRepoPluginList({ ...options, sourceVersion: 2 })
    const v1sha = pluginSha256(v1.rawBytes),
      v2sha = pluginSha256(v2.rawBytes)
    if (
      v1sha !== '16d5c9f55779f85bc94f632812cf4ec7afd3585ca54ac5799c00263732aa9f93' ||
      v2sha !== '68c495035726241ddf6862567d932c0f3c8086969875cb06b07552aa573b9171'
    )
      throw new Error('Public list changed; re-review')
    const parsed = parseRepoPluginList(candidate, target, appVersion)
    const admitted = createRepoAwarePluginVerifier({
      pinnedPublicKey: null,
      repoCatalogueSha256: parsed.sha256,
      target,
    }).verifyCatalogue(parsed.bytes, Buffer.alloc(0))
    const expected: Record<string, unknown> = {}
    for (const release of parsed.releases) {
      request = release.id
      const a = release.archive
      const bytes = await downloadPluginBytes({
        url: a.url,
        maximum: a.size,
        size: a.size,
        sha256: a.sha256,
      })
      if (bytes.length !== a.size || pluginSha256(bytes) !== a.sha256)
        throw new Error('Archive identity changed')
      archives.push({
        id: release.id,
        version: release.version,
        os: target.os,
        cpu: target.cpu,
        bytes: bytes.length,
        sha256: pluginSha256(bytes),
      })
      const verified = admitted.verifyPackage(release.id, release.version, bytes)
      expected[release.id] = {
        version: verified.manifest.version,
        authors: verified.manifest.authors,
        permissions: verified.manifest.permissions,
        digest: a.sha256,
        manifestSha256: release.manifestSha256,
      }
    }
    if (Object.keys(expected).sort().join(',') !== 'chrome,whatsapp')
      throw new Error('Missing target archives')
    fs.writeFileSync(path.join(root, 'expected.json'), JSON.stringify(expected), {
      flag: 'wx',
      mode: 0o600,
    })
    fs.writeFileSync(
      path.join(root, 'network.json'),
      JSON.stringify({
        v1: v1sha,
        v2: v2sha,
        archives: 2,
        archiveMeasurements: archives,
        hops,
        synthetic: false,
      }),
      { flag: 'wx', mode: 0o600 },
    )
  } finally {
    globalThis.fetch = native
  }
}
if (process.argv[2])
  networkProof(process.argv[2], fs.readFileSync(process.argv[3]!), process.argv[4]!).catch(
    (error) => {
      console.error('Network phase failed:', error?.stack ?? error)
      process.exitCode = 1
    },
  )
