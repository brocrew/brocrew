import { z } from 'zod'
import { pluginAdapter } from './lifecycle/adapters'
import { verifiedPluginDigest, type VerifiedPluginPackage } from './package-verifier'
import { hookSupport } from './hooks/definitions'
import { PluginSupervisorError } from './supervisor/protocol'

const unavailable = (): never => {
  throw new PluginSupervisorError('unsupported')
}
export function pluginContributions(pkg: VerifiedPluginPackage) {
  if (!verifiedPluginDigest(pkg) || !pkg.compatibility.host) return unavailable()
  const manifest = pkg.manifest
  const adapter = pluginAdapter(manifest.id)
  if (manifest.server && !adapter) return unavailable()
  const executor =
    manifest.format === 2
      ? manifest.executor
      : manifest.server
        ? { kind: 'node' as const, entry: manifest.server.entry }
        : undefined
  if (!executor || executor.kind !== 'node') return unavailable()
  return Object.freeze({
    executor: Object.freeze({ ...executor }),
    tools: manifest.server && pkg.compatibility.tools ? adapter!.broker : null,
    configuration: manifest.ui && pkg.compatibility.ui && adapter ? adapter : null,
    cleanup: adapter?.uninstall ?? null,
    hooks: Object.freeze((manifest.hooks ?? []).map(hookSupport)),
  })
}
const Identity = z.strictObject({
  pluginId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  releaseDigest: z.string().regex(/^[a-f0-9]{64}$/),
  installId: z.uuid(),
  incarnation: z.uuid(),
  runId: z.uuid(),
  workspaceId: z.uuid(),
  switchRevision: z.number().int().nonnegative().safe(),
})
export type ContributionIdentity = z.infer<typeof Identity>
/** Owner-only registrations. A caller cannot turn structural metadata into a verified package. */
export function createContributionRegistry() {
  const entries = new Map<
    string,
    {
      identity: ContributionIdentity
      contributions: ReturnType<typeof pluginContributions>
      current(): boolean
      revoke(): void
    }
  >()
  return Object.freeze({
    register(pkg: VerifiedPluginPackage, input: ContributionIdentity, ownerCurrent: () => boolean) {
      const identity = Object.freeze(Identity.parse(input))
      let current: boolean
      try {
        current = ownerCurrent()
      } catch {
        return unavailable()
      }
      if (
        identity.pluginId !== pkg.manifest.id ||
        identity.releaseDigest !== verifiedPluginDigest(pkg) ||
        !current
      )
        return unavailable()
      const contributions = pluginContributions(pkg)
      const key = identity.workspaceId + '/' + identity.pluginId
      if (!entries.has(key) && entries.size >= 512) return unavailable()
      const before = entries.get(key)
      if (
        before &&
        JSON.stringify(before.identity) === JSON.stringify(identity) &&
        before.current()
      )
        return before
      before?.revoke()
      let live = true
      const entry = Object.freeze({
        identity,
        contributions,
        current() {
          try {
            live = live && ownerCurrent()
          } catch {
            live = false
          }
          return live
        },
        revoke() {
          live = false
        },
      })
      entries.set(key, entry)
      return entry
    },
    revoke(pluginId: string) {
      for (const [key, entry] of entries)
        if (key.endsWith('/' + pluginId)) {
          entry.revoke()
          entries.delete(key)
        }
    },
    detach(workspaceId: string) {
      for (const [key, entry] of entries)
        if (key.startsWith(workspaceId + '/')) {
          entry.revoke()
          entries.delete(key)
        }
    },
  })
}
