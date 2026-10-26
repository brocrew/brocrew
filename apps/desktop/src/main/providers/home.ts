import { provisionProviderHome } from '@brobot2/runtime'
import type { ProviderHomePaths, ProvisionHome } from './module'

/** Shared containment/provisioning; provider credential work happens only after this settles. */
export async function prepareStateHome(
  paths: ProviderHomePaths,
  profileId: string,
  provision?: ProvisionHome,
  recordedHome?: string,
): Promise<string> {
  const home = recordedHome ?? paths.homeOf(profileId)
  await (provision ?? provisionProviderHome)(paths.managedRoot, home)
  return home
}
