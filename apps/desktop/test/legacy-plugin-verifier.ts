import {
  createRepoAwarePluginVerifier as currentVerifier,
  type VerifiedPluginPackage as CurrentPackage,
  type VerifiedPluginCatalogue as CurrentCatalogue,
} from '../src/main/plugins/package-verifier'
import type { PluginManifest } from '../src/main/plugins/package-schema'
import { PluginPackageVault as CurrentVault } from '../src/main/plugins/lifecycle/vault'

/** Historical controller fixtures consume their original format 1/2 contract. */
export type VerifiedPluginPackage = CurrentPackage<PluginManifest>
export type { PluginReleasePin } from '../src/main/plugins/package-verifier'
export type VerifiedPluginCatalogue = Omit<CurrentCatalogue, 'verifyPackage'> & {
  verifyPackage(...args: Parameters<CurrentCatalogue['verifyPackage']>): VerifiedPluginPackage
}
function legacyPackage(pkg: CurrentPackage): VerifiedPluginPackage {
  if (pkg.manifest.format === 3) throw new Error('Historical fixture expects format 1 or 2')
  return pkg as VerifiedPluginPackage
}
export class PluginPackageVault extends CurrentVault {
  override async load(...args: Parameters<CurrentVault['load']>) {
    return legacyPackage(await super.load(...args))
  }
  override async stage(...args: Parameters<CurrentVault['stage']>) {
    return legacyPackage(await super.stage(...args))
  }
}
export function createRepoAwarePluginVerifier(options: Parameters<typeof currentVerifier>[0]) {
  const verifier = currentVerifier(options)
  return {
    verifyCatalogue(...args: Parameters<typeof verifier.verifyCatalogue>) {
      const catalogue = verifier.verifyCatalogue(...args)
      return {
        ...catalogue,
        verifyPackage(...args: Parameters<typeof catalogue.verifyPackage>) {
          const pkg = catalogue.verifyPackage(...args)
          return legacyPackage(pkg)
        },
      }
    },
  }
}
