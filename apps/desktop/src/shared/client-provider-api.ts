import type {
  ProviderLaunchChoices,
  ResolveProviderLaunchInput,
  ResolvedProviderLaunch,
} from './provider-launch'
import type { ProviderDescriptor } from '@brobot2/shared'
import type { ProviderSetupBridge } from './provider-setup'
import type {
  ApiKeyStatus,
  ApiKeyChanged,
  ApiKeyCheck,
  ReprovisionOutcome,
  ProviderHomesReprovision,
  ProviderUsageReading,
  AuthState,
  CheckProviderAuthInput,
  Provider,
  ProviderProfileInput,
  ProviderSignInResult,
  ProvidersChangedMessage,
} from './runtime-ipc'

/** Provider facts and person intents, independent of the desktop transport. */
export interface ClientProviderApi {
  providerCatalogue(): Promise<readonly ProviderDescriptor[]>
  providerUsage(): Promise<Readonly<Record<Provider, readonly ProviderUsageReading[]>>>
  providerLaunchChoices(input: ProviderProfileInput): Promise<ProviderLaunchChoices>
  resolveProviderLaunch(input: ResolveProviderLaunchInput): Promise<ResolvedProviderLaunch>
  addHandAddedModel(input: { provider: Provider; model: string }): Promise<readonly string[]>
  deleteHandAddedModel(input: { provider: Provider; model: string }): Promise<readonly string[]>
  checkProviderAuth(input: CheckProviderAuthInput): Promise<AuthState>
  apiKeyStatus(input: { provider: Provider }): Promise<ApiKeyStatus>
  setApiKey(input: { provider: Provider; key: string }): Promise<ApiKeyChanged>
  removeApiKey(input: { provider: Provider }): Promise<ApiKeyChanged>
  checkApiKey(input: { provider: Provider }): Promise<ApiKeyCheck>
  reprovisionProviderAuth(input: ProviderProfileInput): Promise<ReprovisionOutcome>
  reprovisionProviderHomes(input: {
    provider: Provider
    statusOnly?: boolean
  }): Promise<ProviderHomesReprovision>
  signInProvider(input: ProviderProfileInput): Promise<ProviderSignInResult>
  cancelProviderSignIn(input: ProviderProfileInput): Promise<void>
  onProvidersChanged(listener: (message: ProvidersChangedMessage) => void): () => void
  readonly setup: ProviderSetupBridge | undefined
}
