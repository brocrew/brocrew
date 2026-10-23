import { provisionProviderHome } from '@brobot2/runtime'
import type { ProviderHomePaths, ProviderHomeSeams } from './module'

/** Shared containment/provisioning; provider credential work happens only after this settles. */
export async function prepareStateHome(
  paths: ProviderHomePaths,
  profileId: string,
  provision: ProviderHomeSeams['provisionHome'],
): Promise<string> {
  const home = paths.homeOf(profileId)
  await (provision ?? provisionProviderHome)(paths.managedRoot, home)
  return home
}
