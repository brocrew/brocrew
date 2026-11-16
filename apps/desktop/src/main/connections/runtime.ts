import type { AgentRuntime } from '@brobot2/runtime'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import type { RuntimeHostDeps } from '../runtime/host-dependencies'

type ConnectionInputs = Pick<
  RuntimeHostDeps,
  'prepareProviderLaunch' | 'prepareProviderHome' | 'loginRenewal' | 'apiKeys'
>

/** Resolve the same fresh or recorded route before any provider/home work. */
export function connectionForLaunch(
  deps: Pick<RuntimeHostDeps, 'connectionFor' | 'store'>,
  provider: Provider,
  sessionId?: string,
): ProviderConnection | undefined {
  return sessionId === undefined
    ? deps.connectionFor?.(provider)
    : deps.connectionFor?.(provider, deps.store.connectionOf(sessionId))
}

/** Return declared metadata only, without invoking a provider or credential operation. */
export function providerConnections(
  deps: Pick<RuntimeHostDeps, 'listConnections'>,
): readonly ProviderConnection[] {
  return (deps.listConnections?.() ?? []).map((row) => ({
    id: row.id,
    provider: row.provider,
    name: row.name,
    authMethod: row.authMethod,
    credentialSource: row.credentialSource,
    baseUrl: row.baseUrl,
    enabled: row.enabled,
    contractVersion: row.contractVersion,
  }))
}

/** Whether a key is saved for a provider: then it is what a launch runs on, not the login. */
export function aKeyIsSaved(deps: Pick<RuntimeHostDeps, 'apiKeys'>, provider: Provider): boolean {
  try {
    return deps.apiKeys?.status(provider).set === true
  } catch {
    return true
  }
}

/** Prepare the selected home after the host's copy barriers have settled. */
export async function prepareConnectionHome(
  deps: ConnectionInputs,
  provider: Provider,
  profileId: string,
  connection: ProviderConnection | undefined,
  renewedForIt: boolean,
  withProviderLaunch: <T>(what: string, run: () => T | Promise<T>) => Promise<T>,
): Promise<{
  readonly home: string
  readonly loginRenewed: boolean
  readonly runtime?: AgentRuntime
}> {
  let runtime: AgentRuntime | undefined
  const prepare = async (): Promise<string> => {
    if (deps.prepareProviderLaunch !== undefined) {
      const prepared = await deps.prepareProviderLaunch(provider, profileId, connection)
      runtime = prepared.runtime
      return prepared.home
    }
    return deps.prepareProviderHome(provider, profileId)
  }
  const renewal = deps.loginRenewal?.(provider)
  if (renewal === undefined || aKeyIsSaved(deps, provider)) {
    return { home: await prepare(), loginRenewed: renewedForIt, runtime }
  }
  const prepared = await renewal.prepare(prepare, () =>
    withProviderLaunch(renewal.launchLabel, renewal.renew),
  )
  return { home: prepared.home, loginRenewed: renewedForIt || prepared.loginRenewed, runtime }
}
