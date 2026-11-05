/** Offline verification only. This reads the actual converted archive, never rebuilds old code. */
import { readPluginArchive } from '../src/main/plugins/package-archive'
import { parsePluginManifest, thisMachine } from '../src/main/plugins/package-schema'
import { verifyPluginPackage } from '../src/main/plugins/package-verifier'
import { pluginSha256 } from '../src/main/plugins/package-digests'
export function verifyOrdinaryChromeArchive(
  archive: Buffer,
  compression: 'tar' | 'tar.gz' = 'tar',
) {
  const files = readPluginArchive(archive, compression)
  const bytes = files.get('plugin.json')
  if (!bytes) throw new Error('Missing actual plugin manifest')
  const manifest = parsePluginManifest(bytes)
  if (manifest.format !== 3 || manifest.id !== 'chrome')
    throw new Error('Supply the actual converted Chrome format-3 archive')
  const release = {
    id: manifest.id,
    version: manifest.version,
    sourceCommit: manifest.sourceCommit,
    platforms: manifest.platforms,
    authors: manifest.authors,
    archive: {
      url: 'https://plugins.example.invalid/chrome.tar',
      compression,
      size: archive.length,
      sha256: pluginSha256(archive),
    },
    manifestSha256: pluginSha256(bytes),
  }
  const verified = verifyPluginPackage(
    archive,
    { sha256: release.archive.sha256, bytes: archive.length, compression },
    { target: thisMachine(), appVersion: '1.0.0' },
  )
  return { verified, release }
}
