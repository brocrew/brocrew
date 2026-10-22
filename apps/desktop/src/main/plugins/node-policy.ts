import { verifiedPluginDigest, type VerifiedPluginPackage } from './package-verifier'
import { PluginHostError } from './node-host-files'

const HOSTED: Readonly<Record<string, { env: string; probe: string }>> = Object.freeze({
  chrome: { env: 'CHROME', probe: '/profiles' },
  whatsapp: { env: 'WHATSAPP', probe: '/status' },
})
/** A verified declaration selects only a host-defined bootstrap, never an arbitrary endpoint. */
export function pluginNodePolicy(pkg: VerifiedPluginPackage) {
  if (!verifiedPluginDigest(pkg) || !pkg.compatibility.host) throw new PluginHostError('package')
  const manifest = pkg.manifest
  if (manifest.server) {
    const hosted = Object.hasOwn(HOSTED, manifest.id) ? HOSTED[manifest.id] : undefined
    if (!hosted) throw new PluginHostError('package')
    return { ...hosted, entry: manifest.server.entry, transport: 'tools' as const }
  }
  if (
    manifest.format !== 2 ||
    manifest.executor?.kind !== 'node' ||
    !manifest.hooks?.some((hook) => hook.kind === 'turn.context.titles' && hook.api === 1)
  )
    throw new PluginHostError('package')
  return {
    env: 'PLUGIN',
    probe: '/healthz',
    entry: manifest.executor.entry,
    transport: 'hooks' as const,
  }
}
