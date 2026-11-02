// Build-time hook: direct electron-builder invocations also carry the app's pinned Node,
// the plugin supervisor and, on a Mac, the voice helper.
// electron-builder's Arch: 1 is x64, 3 is arm64.
const ARCHES = { 1: 'x64', 3: 'arm64' }
module.exports = async (context) => {
  if (!['darwin', 'win32'].includes(context.electronPlatformName)) return
  const { join } = await import('node:path')
  const { preparePluginNode } = await import('./prepare-plugin-node.mjs')
  await preparePluginNode(
    join(context.packager.projectDir, 'resources', 'plugin-node'),
    fetch,
    `${context.electronPlatformName}-${ARCHES[context.arch]}`,
  )
  const { buildPluginSupervisor } = await import('./build-plugin-supervisor.mjs')
  await buildPluginSupervisor(
    join(context.packager.projectDir, 'resources', 'plugin-supervisor', 'entry.cjs'),
  )
  if (context.electronPlatformName !== 'darwin') return
  if (!ARCHES[context.arch]) throw new Error('Unsupported Mac voice helper architecture.')
  const { buildVoiceHelper } = await import('./build-voice-helper.mjs')
  buildVoiceHelper(ARCHES[context.arch])
}
