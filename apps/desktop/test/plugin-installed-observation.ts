import type { GlobalPluginState } from '../src/main/plugins/state/store'
import { PluginPackageVault } from '../src/main/plugins/lifecycle/vault'
import type { LifecycleOptions } from '../src/main/plugins/lifecycle/types'
/** Read the selected record through current state/vault readers, without executing old UI. */
export async function observeInstalled(
  options: Pick<LifecycleOptions, 'root' | 'target' | 'pinnedPublicKey' | 'appVersion'>,
  state: GlobalPluginState,
  id: string,
) {
  const installation = state.currentInstallation(id)
  if (!installation) throw new Error('Expected a selected installation')
  const vault = new PluginPackageVault(
    options.root,
    options.pinnedPublicKey,
    options.target,
    undefined,
    options.appVersion,
  )
  const pkg = await vault.load(
    {
      id,
      version: installation.release.version,
      manifestSha256: installation.release.manifestSha256,
      archive: { sha256: installation.release.archiveSha256 },
    },
    [],
  )
  return { installation, package: pkg }
}
