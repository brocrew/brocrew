import type { Provider } from '@brobot2/shared'

/** Display metadata for an existing connection; its route and credential mode stay fixed. */
export interface UpdateProviderConnectionInput {
  readonly provider: Provider
  readonly connectionId: string
  readonly name: string
  readonly description: string | null
}
