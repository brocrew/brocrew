const { execFileSync } = require('node:child_process')

module.exports = async (event) => {
  if (!event.file?.endsWith('.dmg')) return
  const result = JSON.parse(
    execFileSync(
      'xcrun',
      [
        'notarytool',
        'submit',
        event.file,
        '--key',
        process.env.APPLE_API_KEY,
        '--key-id',
        process.env.APPLE_API_KEY_ID,
        '--issuer',
        process.env.APPLE_API_ISSUER,
        '--wait',
        '--output-format',
        'json',
      ],
      { encoding: 'utf8' },
    ),
  )
  console.log(result)
  if (result.status !== 'Accepted')
    throw new Error(`DMG notarization ${result.status}: ${result.id}`)
  execFileSync('xcrun', ['stapler', 'staple', event.file], { stdio: 'inherit' })
  // Builder writes the update metadata after this hook, using the final stapled bytes.
  const { default: tools } = await import('./builder-tools.mjs')
  event.updateInfo = await tools.buildBlockMap(event.file, 'gzip', `${event.file}.blockmap`)
}
