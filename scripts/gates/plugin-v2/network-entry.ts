// Built and executed BEFORE projection, under a fictional home on an admitted hosted runner only.
import fs from 'node:fs'
import path from 'node:path'
import { downloadPluginBytes } from '../../../apps/desktop/src/main/plugins/catalogue/download'
import { loadRepoPluginList } from '../../../apps/desktop/src/main/plugins/catalogue/repo-list'
import { createRepoAwarePluginVerifier } from '../../../apps/desktop/src/main/plugins/package-verifier'
import { pluginSha256 } from '../../../apps/desktop/src/main/plugins/package-digests'
import { releaseDisclosure } from '../../../apps/desktop/src/main/plugins/mutation-disclosure'

export async function networkProof(root: string, appVersion: string) {
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
    const options = { root: listRoot, target, appVersion }
    const v1 = await loadRepoPluginList({ ...options, sourceVersion: 1 })
    request = 'v2'
    const v2 = await loadRepoPluginList({ ...options, sourceVersion: 2 })
    // The public list as published today is the one under test; its own digests are the pins.
    const v1sha = pluginSha256(v1.rawBytes),
      v2sha = pluginSha256(v2.rawBytes)
    const admitted = createRepoAwarePluginVerifier({
      target,
    }).verifyCatalogue(v2.bytes)
    const expected: Record<string, unknown> = {}
    for (const release of v2.releases) {
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
      // What the Review must show is the app's own disclosure of this verified package, so a
      // resource the app adds to the manifest's own (shared plugin data) is expected as well.
      const details = releaseDisclosure(admitted.verifyPackage(release.id, release.version, bytes))
      if (details.digest !== a.sha256 || details.manifestSha256 !== release.manifestSha256)
        throw new Error('Disclosed package identity changed')
      expected[release.id] = details
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
  networkProof(process.argv[2], process.argv[3]!).catch((error) => {
    console.error('Network phase failed:', error?.stack ?? error)
    process.exitCode = 1
  })
