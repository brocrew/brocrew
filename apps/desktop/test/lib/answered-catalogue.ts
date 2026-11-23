import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'

/** The name the catalogue supplies for a provider id. */
export function suppliedName(id: string): string {
  return PROVIDER_DESCRIPTORS.find((one) => one.id === id)!.displayName
}
