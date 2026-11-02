/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads this hook as CommonJS. */
// Keep electron-builder's hook entry inside the app root; share the build-time implementation.
module.exports = async (context) => {
  await require('../../../scripts/prepare-plugin-node-before-pack.cjs')(context)
  if (context.electronPlatformName === 'darwin') {
    const { buildVoiceHelper } = await import('../../../scripts/build-voice-helper.mjs')
    const arch = { 1: 'x64', 3: 'arm64' }[context.arch]
    if (!arch) throw new Error('Unsupported Mac voice helper architecture.')
    buildVoiceHelper(arch)
  }
}
