import type { ClientComposerApi } from '../../../shared/client-composer-api'
import type { ClientSessionApi } from '../../../shared/client-session-api'
import type { ClientApi } from '../../../shared/client-api'
import type { RecoveryRetentionClient } from '../../../shared/recovery-retention'
import type { PluginsClient } from '../../../shared/plugin-settings'
import type { ProviderSetupBridge } from '../../../shared/provider-setup'
import type { RuntimeBridge } from '../../../shared/runtime-ipc'

type ProviderTransport = Pick<
  RuntimeBridge,
  | 'providerCatalogue'
  | 'providerLaunchChoices'
  | 'resolveProviderLaunch'
  | 'addHandAddedModel'
  | 'deleteHandAddedModel'
  | 'checkProviderAuth'
  | 'apiKeyStatus'
  | 'signInProvider'
  | 'cancelProviderSignIn'
  | 'onProvidersChanged'
>

/** Resolve the transport on each call so construction performs no reads or subscriptions. */
export function createDesktopProviderApi(
  runtime: () => ProviderTransport,
  setup: () => ProviderSetupBridge | undefined,
  recoveryCopies: () => RecoveryRetentionClient | undefined = () => undefined,
  sessions: () => ClientSessionApi | undefined = () => undefined,
  composer: () => ClientComposerApi | undefined = () => undefined,
  plugins: () => PluginsClient | undefined = () => undefined,
): ClientApi {
  return Object.freeze({
    providerCatalogue: () => runtime().providerCatalogue(),
    providerLaunchChoices: (input) => runtime().providerLaunchChoices(input),
    resolveProviderLaunch: (input) => runtime().resolveProviderLaunch(input),
    addHandAddedModel: (input) => runtime().addHandAddedModel(input),
    deleteHandAddedModel: (input) => runtime().deleteHandAddedModel(input),
    checkProviderAuth: (input) => runtime().checkProviderAuth(input),
    apiKeyStatus: (input) => runtime().apiKeyStatus(input),
    signInProvider: (input) => runtime().signInProvider(input),
    cancelProviderSignIn: (input) => runtime().cancelProviderSignIn(input),
    onProvidersChanged: (listener) => runtime().onProvidersChanged(listener),
    get composer() {
      return composer()
    },
    get sessions() {
      return sessions()
    },
    get plugins() {
      return plugins()
    },
    get recoveryCopies() {
      return recoveryCopies()
    },
    get setup() {
      return setup()
    },
  } satisfies ClientApi)
}
