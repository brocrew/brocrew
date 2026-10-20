// Build-time hook: direct electron-builder invocations also carry the app's pinned Node.
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
}
