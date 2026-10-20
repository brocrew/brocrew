/** Offline archive rebuild only. No server module is imported or executed. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { readPluginArchive } from '../src/main/plugins/package-archive'
import { parsePluginManifest } from '../src/main/plugins/package-schema'
import { createPluginVerifier } from '../src/main/plugins/package-verifier'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import {
  fictionalPublicKey,
  packageFixture,
  signed,
  inventory,
} from '../test/plugin-package-fixtures'
export const ORIGINAL_CHROME_SHA =
  'b3abe51ddeef240895ca6d9147e607cc32637edfe22c87ebc53a9050e27a2076'
export function verifyChromeUiArchive(archive: Buffer, compression: 'tar' | 'tar.gz' = 'tar') {
  const files = readPluginArchive(archive, compression),
    manifest = parsePluginManifest(files.get('plugin.json')!)
  const release = {
    id: manifest.id,
    version: manifest.version,
    sourceCommit: manifest.sourceCommit,
    platforms: manifest.platforms,
    archive: {
      url: 'https://plugins.example.invalid/chrome.tar',
      compression,
      size: archive.length,
      sha256: pluginSha256(archive),
    },
    manifestSha256: pluginSha256(files.get('plugin.json')!),
  }
  const catalogue = signed({ format: 1, entries: [release] })
  const verified = createPluginVerifier({
    pinnedPublicKey: fictionalPublicKey,
    target: { os: 'darwin', cpu: 'arm64' },
  })
    .verifyCatalogue(catalogue.bytes, catalogue.signature)
    .verifyPackage('chrome', manifest.version, archive)
  return { verified, release }
}
export function rebuildChromeUiArchive(
  original: string,
  uiRoot: string,
  sourceCommit: string,
  out: string,
) {
  const bytes = readFileSync(original)
  if (pluginSha256(bytes) !== ORIGINAL_CHROME_SHA) throw new Error('Wrong frozen Chrome artifact')
  const checked = verifyChromeUiArchive(bytes)
  const files = new Map(readPluginArchive(bytes, 'tar'))
  files.delete('plugin.json')
  const provenance = JSON.parse(readFileSync(join(uiRoot, '../UI-PROVENANCE.json'), 'utf8'))
  for (const name of ['index.html', 'style.css', 'app.js']) {
    const path = 'ui/' + name
    const pin = provenance.files.find((file: { path: string }) => file.path === path)
    const before = files.get(path)!
    const after = readFileSync(join(uiRoot, name))
    if (
      !pin ||
      pluginSha256(before) !== pin.sourceSha256 ||
      pluginSha256(after) !== pin.destinationSha256
    )
      throw new Error('Unexpected UI provenance')
    files.set(path, after)
  }
  const manifest = {
    ...structuredClone(checked.verified.manifest),
    sourceCommit,
    files: inventory(files),
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  const entries = [...files.entries(), ['plugin.json', manifestBytes] as [string, Buffer]]
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([path, body]) => {
      if (Buffer.byteLength(path) <= 100) return { path, body }
      const at = path.lastIndexOf('/')
      return { path: path.slice(at + 1), prefix: path.slice(0, at), body }
    })
  const result = packageFixture({ files, manifest, entries })
  const final = verifyChromeUiArchive(result.archive)
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'chrome.tar'), result.archive)
  writeFileSync(join(out, 'fixture-release.json'), JSON.stringify(final.release, null, 2) + '\n')
  const counts = {
    verified: true,
    files: final.verified.filePaths.length,
    bytes: result.archive.length,
    sha256: final.release.archive.sha256,
    sourceCommit,
    serverUnchanged: Buffer.from(final.verified.readFile('server.mjs')!).equals(
      files.get('server.mjs')!,
    ),
  }
  writeFileSync(join(out, 'proof.json'), JSON.stringify(counts, null, 2) + '\n')
  return counts
}
