import type {
  ProviderLaunchChoices,
  ResolveProviderLaunchInput,
  ResolvedProviderLaunch,
} from './provider-launch'
import type { ProviderDescriptor } from '@brobot2/shared'
import type { ProviderSetupBridge } from './provider-setup'
import type {
  ApiKeyStatus,
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
  providerLaunchChoices(input: ProviderProfileInput): Promise<ProviderLaunchChoices>
  resolveProviderLaunch(input: ResolveProviderLaunchInput): Promise<ResolvedProviderLaunch>
  addHandAddedModel(input: { provider: Provider; model: string }): Promise<readonly string[]>
  deleteHandAddedModel(input: { provider: Provider; model: string }): Promise<readonly string[]>
  checkProviderAuth(input: CheckProviderAuthInput): Promise<AuthState>
  apiKeyStatus(input: { provider: Provider }): Promise<ApiKeyStatus>
  signInProvider(input: ProviderProfileInput): Promise<ProviderSignInResult>
  cancelProviderSignIn(input: ProviderProfileInput): Promise<void>
  onProvidersChanged(listener: (message: ProvidersChangedMessage) => void): () => void
  readonly setup: ProviderSetupBridge | undefined
}
