import { verifyChromeUiArchive } from '../smoke/chrome-ui-archive'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PluginManifest } from '../src/main/plugins/package-schema'
import { inventory, packageFixture, verified } from './plugin-package-fixtures'
/** Package UI is copied from 6f9aa9213. This fixture has an INERT server and fictional target/data. */
export function chromeUiFixture(root = resolve(__dirname, '../../../plugins/chrome')) {
  if (process.env.BROBOT_CHROME_TEST_ARCHIVE) {
    const { verified, release } = verifyChromeUiArchive(
      readFileSync(process.env.BROBOT_CHROME_TEST_ARCHIVE),
    )
    return {
      verified,
      binding: {
        pluginId: 'chrome',
        releaseDigest: release.archive.sha256,
        installId: 'fictional-install',
        incarnation: 'fictional-incarnation',
        leaseId: 'fictional-lease',
      },
    }
  }
  const manifest: PluginManifest = JSON.parse(
    readFileSync(resolve(root, 'manifest-template.json'), 'utf8'),
  )
  const files = new Map<string, Buffer>([
    ['server.mjs', Buffer.from('export const fictional = true;\n')],
  ])
  for (const file of ['ui/index.html', 'ui/style.css', 'ui/app.js'])
    files.set(file, readFileSync(resolve(root, file)))
  manifest.platforms = [{ os: 'linux', cpu: 'x64' }]
  manifest.files = inventory(files)
  const fixture = packageFixture({ files, manifest })
  return {
    verified: verified(fixture),
    binding: {
      pluginId: 'chrome',
      releaseDigest: fixture.release.archive.sha256,
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
