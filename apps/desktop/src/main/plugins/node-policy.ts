import { verifiedPluginDigest, type VerifiedPluginPackage } from './package-verifier'
import { PluginHostError } from './node-host-files'
import type { PluginMcp, PluginRuntime } from '../../shared/plugin-contract'
import type { NormalizedPluginManifest } from './package-schema'

type GenericLaunchDeclaration = { runtime: PluginRuntime; mcp: PluginMcp }
type LegacyLaunchDeclaration = {
  env: string
  probe: string
  entry: string
  transport: 'tools' | 'hooks'
  runtime: NormalizedPluginManifest['runtime']
  mcp: NormalizedPluginManifest['mcp']
}

/** Launch declarations come from package bytes, without a table of admitted plugin IDs. */
export function pluginNodePolicy(
  pkg: VerifiedPluginPackage,
): GenericLaunchDeclaration | LegacyLaunchDeclaration {
  if (!verifiedPluginDigest(pkg) || !pkg.compatibility.host) throw new PluginHostError('package')
  const manifest = pkg.manifest
  if (manifest.format === 3) return { runtime: manifest.runtime, mcp: manifest.mcp }
  if (manifest.server) {
    return {
      env: manifest.id.replace(/-/g, '_').toUpperCase(),
      // Legacy startup retains its health message and MCP initialization, without domain probes.
      probe: '',
      entry: manifest.server.entry,
      transport: 'tools' as const,
      runtime: pkg.contract.runtime,
      mcp: pkg.contract.mcp,
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
    probe: '/healthz',
    entry: manifest.executor.entry,
    transport: 'hooks' as const,
    runtime: pkg.contract.runtime,
    mcp: pkg.contract.mcp,
  }
}
