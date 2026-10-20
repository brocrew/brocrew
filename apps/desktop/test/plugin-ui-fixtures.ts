import { manifestFor, packageFixture, payload, verified } from './plugin-package-fixtures'
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
