import { join } from 'node:path'
import type { VerifiedPluginPackage } from './package-verifier'
import { verifiedPluginDigest } from './package-verifier'
import { pluginSha256 } from './package-digests'
import { GlobalPluginState } from './state/store'
import {
  PluginReleaseDetailsSchema,
  canonicalPluginDisclosure,
  type PluginReleaseDetails,
  type PluginMutationReview,
} from '../../shared/plugin-settings'
import type { PluginPackageVault } from './lifecycle/vault'
/** Only a verified package can supply display metadata. This never executes or stages code. */
export function releaseDisclosure(pkg: VerifiedPluginPackage): PluginReleaseDetails {
  return PluginReleaseDetailsSchema.parse({
    version: pkg.manifest.version,
    digest: verifiedPluginDigest(pkg),
    manifestSha256: pluginSha256(pkg.readFile('plugin.json')!),
    authors: pkg.manifest.authors ? [...pkg.manifest.authors] : null,
    permissions: structuredClone(pkg.manifest.permissions),
  })
}
export function installedDisclosureIdentity(root: string, id: string) {
  try {
    return GlobalPluginState.readInstalledPackage(
      {
        root: join(root, 'state'),
        workspaceRoots: [],
      },
      id,
    )
  } catch {
    return null
  }
}
export async function installedDisclosure(root: string, id: string, vault: PluginPackageVault) {
  const identity = installedDisclosureIdentity(root, id)
  if (!identity) return { identity, details: null }
  try {
    const p = identity
    const pkg = await vault.load(
      {
        id,
        version: p.version,
        manifestSha256: p.manifestSha256,
        archive: { sha256: p.archiveSha256 },
      },
      [],
    )
    return { identity, details: releaseDisclosure(pkg) }
  } catch {
    return { identity, details: null }
  }
}
export function disclosureChanges(
  current: PluginReleaseDetails,
  installed: PluginReleaseDetails | null,
) {
  return {
    authors:
      !installed?.authors ||
      canonicalPluginDisclosure(current.authors) !== canonicalPluginDisclosure(installed.authors),
    permissions:
      !installed ||
      canonicalPluginDisclosure(current.permissions) !==
        canonicalPluginDisclosure(installed.permissions),
  }
}
export function displayedDetailsHash(display: Omit<PluginMutationReview, 'consent'>): string {
  return pluginSha256(Buffer.from(canonicalPluginDisclosure(display)))
}
