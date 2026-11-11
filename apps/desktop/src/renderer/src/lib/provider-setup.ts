import type { ClientProviderApi } from '../../../shared/client-provider-api'
export type { ProviderSetup as ProviderSetupSays } from '../../../shared/runtime-ipc'

/** Every provider's setup facts, or `null` when main does not report them or the read fails. */
export async function readProviderSetup(
  client: Pick<ClientProviderApi, 'providerSetup'>,
): Promise<Awaited<ReturnType<ClientProviderApi['providerSetup']>> | null> {
  try {
    return await client.providerSetup()
  } catch {
    return null
  }
}

/** Why there is no usable login, when main names it beside its sentence. */
export function whyNoLogin(state: unknown): string | undefined {
  const why = (state as { why?: unknown } | null)?.why
  return typeof why === 'string' ? why : undefined
}
