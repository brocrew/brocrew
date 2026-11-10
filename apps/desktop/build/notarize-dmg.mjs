/** Electron-builder calls this hook. @public */
export default async (event) => {
  if (!event.file?.endsWith('.dmg')) return
  const { default: tools } = await import('./builder-tools.mjs')
  await tools.notarize({
    appPath: event.file,
    appleApiKey: process.env.APPLE_API_KEY,
    appleApiKeyId: process.env.APPLE_API_KEY_ID,
    appleApiIssuer: process.env.APPLE_API_ISSUER,
  })
  console.log('DMG notarized and stapled')
  // Builder writes the update metadata after this hook, using the final stapled bytes.
  event.updateInfo = await tools.buildBlockMap(event.file, 'gzip', `${event.file}.blockmap`)
}
