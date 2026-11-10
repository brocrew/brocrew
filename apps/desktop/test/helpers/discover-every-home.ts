import { discoverSessionsIn, type Discovery } from '../../src/main/adopt/discover-sessions'
import { listProviderHomes } from '../../src/main/runtime/provider-homes'

/** Every recorded conversation in every provider home under `userData`, as one discovery. */
export function discoverEveryHomeIn(userData: string): Discovery {
  return listProviderHomes(userData)
    .map((home) => discoverSessionsIn(home.provider, home.path, home.profileId))
    .reduce<Discovery>(
      (all, part) => ({
        found: [...all.found, ...part.found],
        skipped: [...all.skipped, ...part.skipped],
      }),
      { found: [], skipped: [] },
    )
}
