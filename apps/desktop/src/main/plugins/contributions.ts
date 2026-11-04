import { z } from 'zod'
import { verifiedPluginDigest, type VerifiedPluginPackage } from './package-verifier'
import { hookSupport } from './hooks/definitions'
import { PluginSupervisorError } from './supervisor/protocol'

const unavailable = (): never => {
  throw new PluginSupervisorError('unsupported')
}
export function pluginContributions(pkg: VerifiedPluginPackage) {
  if (!verifiedPluginDigest(pkg) || !pkg.compatibility.host) return unavailable()
  const manifest = pkg.manifest
  const contract = pkg.contract
  const declarations: {
    id: string
    kind: string
    api: number
    definition: unknown
    supported: boolean
  }[] = []
  if (manifest.format === 3) {
    for (const { id, ...definition } of manifest.ui ?? [])
      declarations.push({ id, kind: 'ui.button', api: 1, definition, supported: false })
    if (manifest.settings)
      declarations.push({
        id: 'settings',
        kind: 'settings.page',
        api: 1,
        definition: {
          title: manifest.name,
          ...manifest.settings.page,
          fields: manifest.settings.fields,
        },
        supported: false,
      })
    for (const { id, kind, api, invoke } of manifest.hooks ?? [])
      declarations.push({ id, kind, api, definition: { invoke }, supported: false })
    for (const { id, ...definition } of manifest.speech ?? [])
      declarations.push({ id, kind: 'speech.transcribe', api: 1, definition, supported: false })
    for (const { id, ...definition } of manifest.cleanup ?? [])
      declarations.push({ id, kind: 'transcript.cleanup', api: 1, definition, supported: false })
  }
  return Object.freeze({
    executor: contract.runtime,
    runtime: contract.runtime,
    mcp: contract.mcp,
    tools: pkg.compatibility.tools ? contract.tools : null,
    configuration: pkg.compatibility.ui ? (contract.settings ?? null) : null,
    settings: pkg.compatibility.ui ? (contract.settings ?? null) : null,
    cleanup: manifest.format === 3 ? (manifest.lifecycle.beforeRemove ?? null) : null,
    declarations: Object.freeze(declarations.map((declaration) => Object.freeze(declaration))),
    hooks: Object.freeze(
      manifest.format === 3
        ? (manifest.hooks ?? []).map((hook) =>
            Object.freeze({ ...hook, supported: false as const }),
          )
        : (manifest.hooks ?? []).map(hookSupport),
    ),
  })
}
const Identity = z.strictObject({
  pluginId: z.string().min(1),
  releaseDigest: z.string().regex(/^[a-f0-9]{64}$/),
  installId: z.string().min(1),
  incarnation: z.string().min(1),
  runId: z.string().min(1),
  workspaceId: z.string().min(1),
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
      const key = JSON.stringify([identity.workspaceId, identity.pluginId])
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
        if (entry.identity.pluginId === pluginId) {
          entry.revoke()
          entries.delete(key)
        }
    },
    detach(workspaceId: string) {
      for (const [key, entry] of entries)
        if (entry.identity.workspaceId === workspaceId) {
          entry.revoke()
          entries.delete(key)
        }
    },
  })
}
