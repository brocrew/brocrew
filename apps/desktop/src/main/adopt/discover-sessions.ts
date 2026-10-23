import { existsSync } from 'node:fs'
import type { Provider } from '@brobot2/shared'
import { providerDefinitions } from '../providers/definitions'
import { EMPTY, type Discovery } from './discovery-types'
export type {
  ProviderDescription,
  DiscoveredSession,
  ChildDescent,
  SkippedSession,
  Discovery,
} from './discovery-types'
export {
  discoverClaudeSessions,
  discoverCodexSessions,
  codexDescent,
} from '../providers/definitions'
export const NO_DISCOVERY = (): Discovery => EMPTY
export function discoverSessionsIn(provider: Provider, home: string, profileId: string): Discovery {
  if (!existsSync(home)) return EMPTY
  return providerDefinitions[provider].discovery.discover(home, profileId)
}
