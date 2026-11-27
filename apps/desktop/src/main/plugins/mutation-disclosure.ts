import { join } from 'node:path'
import type { VerifiedPluginPackage } from './package-verifier'
import { verifiedPluginDigest } from './package-verifier'
import { pluginSha256 } from './package-digests'
import { observeInstalledPackage } from './state/observe-committed'
import {
  PluginReleaseDetailsSchema,
  canonicalPluginDisclosure,
  type PluginReleaseDetails,
  type PluginMutationReview,
} from '../../shared/plugin-settings'
import type { PluginPackageVault } from './lifecycle/vault'
import { SHARED_DATA_PERMISSION } from './shared-data-contract'
/** Only a verified package can supply display metadata. This never executes or stages code. */
export function releaseDisclosure(pkg: VerifiedPluginPackage): PluginReleaseDetails {
  if (!verifiedPluginDigest(pkg)) throw new Error('Unverified plugin disclosure')
  const permissions = structuredClone(pkg.manifest.permissions)
  if (pkg.manifest.sharedData === true)
    permissions.resources.push({
      id: SHARED_DATA_PERMISSION,
      label:
        'Shared plugin data on this computer, accessible to other plugin owners; workspaces using the same plugin owner share its settings',
      read: true,
      write: true,
    })
  return PluginReleaseDetailsSchema.parse({
    version: pkg.manifest.version,
    digest: verifiedPluginDigest(pkg),
    manifestSha256: pluginSha256(pkg.readFile('plugin.json')!),
    authors: pkg.manifest.authors ? [...pkg.manifest.authors] : null,
    permissions,
  })
}
export async function installedDisclosure(root: string, id: string, vault: PluginPackageVault) {
  const installed = await observeInstalledPackage(
    { root: join(root, 'state'), workspaceRoots: [] },
    id,
  )
  if (!installed) return null
  try {
    const pkg = await vault.load({
      id,
      version: installed.version,
      manifestSha256: installed.manifestSha256,
      archive: { sha256: installed.archiveSha256 },
    })
    return releaseDisclosure(pkg)
  } catch {
    return null
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
