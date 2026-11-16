import type { AgentRuntime } from '@brobot2/runtime'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import type { SessionSettingsDisclosure } from '../../shared/model-choice-contracts'
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
  connectionId?: string | null,
): ProviderConnection | undefined {
  return sessionId !== undefined
    ? deps.connectionFor?.(provider, deps.store.connectionOf(sessionId))
    : connectionId === undefined
      ? deps.connectionFor?.(provider)
      : deps.connectionFor?.(provider, connectionId)
}

/** Return declared metadata only, without invoking a provider or credential operation. */
export function providerConnections(
  deps: Pick<RuntimeHostDeps, 'listConnections'>,
): readonly ProviderConnection[] {
  return (deps.listConnections?.() ?? []).map((row) => ({
    id: row.id,
    provider: row.provider,
    name: row.name,
    ...(row.description === undefined ? {} : { description: row.description }),
    authMethod: row.authMethod,
    credentialSource: row.credentialSource,
    baseUrl: row.baseUrl,
    enabled: row.enabled,
    contractVersion: row.contractVersion,
  }))
}

/** The selected mode, or legacy saved-key precedence when no connection was captured. */
export function aKeyIsSaved(
  deps: Pick<RuntimeHostDeps, 'apiKeys'>,
  provider: Provider,
  connection?: ProviderConnection,
): boolean {
  if (connection !== undefined) return connection.authMethod === 'api-key'
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
  if (renewal === undefined || aKeyIsSaved(deps, provider, connection)) {
    return { home: await prepare(), loginRenewed: renewedForIt, runtime }
  }
  const prepared = await renewal.prepare(prepare, () =>
    withProviderLaunch(renewal.launchLabel, renewal.renew),
  )
  return { home: prepared.home, loginRenewed: renewedForIt || prepared.loginRenewed, runtime }
}

export function freshConnectionId(
  deps: Pick<RuntimeHostDeps, 'store'>,
  provider: Provider,
  profileId: string,
  requested?: string,
): string | undefined {
  if (requested !== undefined) return requested
  const choice = deps.store.modelChoiceOf(profileId)
  return choice?.provider === provider ? choice.connectionId : undefined
}

/** Compare the next recorded route with the route captured by this running life. */
export function nextConnectionPick(
  deps: Pick<RuntimeHostDeps, 'store'>,
  sessionId: string,
  current: ProviderConnection | undefined,
): SessionSettingsDisclosure['nextConnection'] {
  if (current === undefined) return undefined
  const connectionId = deps.store.connectionOf(sessionId)
  if (connectionId == null || connectionId === current.id) return undefined
  const row = deps.store.whatItRunsOn(sessionId)
  return { connectionId, model: row?.model ?? null, effort: row?.reasoningEffort ?? null }
}
