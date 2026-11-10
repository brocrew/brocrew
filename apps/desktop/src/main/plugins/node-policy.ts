import { verifiedPluginDigest, type VerifiedPluginPackage } from './package-verifier'
import { PluginHostError } from './node-host-files'

export function pluginNodePolicy(pkg: VerifiedPluginPackage) {
  if (!verifiedPluginDigest(pkg) || !pkg.compatibility.host) throw new PluginHostError('package')
  const manifest = pkg.manifest
  if (manifest.server) {
    return {
      env: manifest.id.toUpperCase().replaceAll('-', '_'),
      entry: manifest.server.entry,
      transport: 'tools' as const,
    }
  }
  if (
    manifest.format !== 2 ||
    manifest.executor?.kind !== 'node' ||
    !manifest.hooks?.some((hook) => hook.kind === 'turn.context.titles' && hook.api === 1)
  )
    throw new PluginHostError('package')
  return {
    env: 'PLUGIN',
    entry: manifest.executor.entry,
    transport: 'hooks' as const,
  }
}
