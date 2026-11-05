import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parsePluginManifest } from '../src/main/plugins/package-schema'
import { readPluginArchive } from '../src/main/plugins/package-archive'
import { verifyPluginPackage } from '../src/main/plugins/package-verifier'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { tar } from './plugin-package-fixtures'
/** Uses current package UI bytes with an INERT server and fictional target/data when no archive is supplied. */
export function chromeUiFixture(root = resolve(__dirname, '../../../plugins/chrome')) {
  let archive: Buffer
  if (process.env.BROBOT_CHROME_TEST_ARCHIVE)
    archive = readFileSync(process.env.BROBOT_CHROME_TEST_ARCHIVE)
  else {
    const manifest = parsePluginManifest(readFileSync(resolve(root, 'manifest-template.json')))
    if (manifest.format !== 3) throw new Error('Generic Chrome UI package required')
    const files = new Map<string, Buffer>([
      [manifest.runtime.entry, Buffer.from('export const fictional = true;\n')],
      ['tools.json', Buffer.from('{"tools":[]}')],
    ])
    for (const file of ['ui/index.html', 'ui/style.css', 'ui/app.js'])
      files.set(file, readFileSync(resolve(root, file)))
    const prepared = {
      ...manifest,
      platforms: [{ os: 'linux' as const, cpu: 'x64' as const }],
      files: [...files].map(([path, bytes]) => ({
        path,
        bytes: bytes.length,
        sha256: pluginSha256(bytes),
      })),
    }
    archive = tar([
      { path: 'plugin.json', body: Buffer.from(JSON.stringify(prepared)) },
      ...[...files].map(([path, body]) => ({ path, body })),
    ])
  }
  const manifestBytes = readPluginArchive(archive, 'tar').get('plugin.json')!
  const manifest = parsePluginManifest(manifestBytes)
  if (manifest.format !== 3 || manifest.id !== 'chrome')
    throw new Error('Generic Chrome UI package required')
  const digest = pluginSha256(archive)
  const verified = verifyPluginPackage(
    archive,
    { sha256: digest, bytes: archive.length, compression: 'tar' },
    { target: manifest.platforms[0]!, appVersion: '1.0.0' },
  )
  return {
    verified,
    manifest,
    manifestSha256: pluginSha256(manifestBytes),
    ref: {
      source: 'https://fictional.example.invalid/chrome.tar',
      sha256: digest,
      bytes: archive.length,
    },
    binding: {
      pluginId: 'chrome',
      releaseDigest: digest,
      installId: 'fictional-install',
      incarnation: 'fictional-incarnation',
      leaseId: 'fictional-lease',
    },
  }
}
export const FICTIONAL_CHROME = {
  configRevision: 0,
  profiles: [
    { name: 'birch', enabled: true, open: true },
    { name: 'fir', enabled: false, open: false },
  ],
  tabs: [
    { profile: 'birch', title: 'Oak atlas', url: 'https://atlas.example.invalid/' },
    { profile: 'birch', title: 'Fern notebook', url: 'https://fern.example.invalid/' },
  ],
}
