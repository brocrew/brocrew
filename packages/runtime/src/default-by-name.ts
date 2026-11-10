import { providerDescriptor, type Provider } from '@brobot2/shared'

export interface ModelByName {
  readonly model: string
  readonly effort: string
}

/** Null means the provider reports its default through its model list. */
export function theDefaultByName(provider: Provider): ModelByName | null {
  return providerDescriptor(provider).defaultModelByName
}
