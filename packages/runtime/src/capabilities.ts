import {
  providerDescriptor,
  providerRecord,
  type Provider,
  type ProviderCapabilities,
} from '@brobot2/shared'

export { isAvailable } from '@brobot2/shared'
export type {
  CapabilityState,
  CapabilityStatus,
  ProviderCapabilities,
  ProviderMarkKind,
} from '@brobot2/shared'

/** Frozen declarations shared by every caller in the process. */
const DECLARED: Record<Provider, ProviderCapabilities> = Object.freeze(
  providerRecord((provider) => providerDescriptor(provider).capabilities),
)

/** What this provider can do, from its shared declaration. */
export function capabilitiesFor(provider: Provider): ProviderCapabilities {
  return DECLARED[provider]
}

/** Every provider's declaration, available before a conversation exists. */
export function allProviderCapabilities(): Record<Provider, ProviderCapabilities> {
  return DECLARED
}
