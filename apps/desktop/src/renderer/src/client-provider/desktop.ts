import type { ClientComposerApi } from '../../../shared/client-composer-api'
import type { ClientSessionApi } from '../../../shared/client-session-api'
import type { ClientApi } from '../../../shared/client-api'
import type { ClientAgentApi } from '../../../shared/client-agent-api'
import type { TranscriptRetentionClient } from '../../../shared/transcript-retention'
import type { RecoveryRetentionClient } from '../../../shared/recovery-retention'
import type { PluginsClient } from '../../../shared/plugin-settings'
import type { LoggingClient } from '../../../shared/logging'
import type { DockLabelClient } from '../../../shared/dock-label'
import type { ProviderSetupBridge } from '../../../shared/provider-setup'
import type { RuntimeBridge } from '../../../shared/runtime-ipc'

type ProviderTransport = Pick<
  RuntimeBridge,
  | 'providerCatalogue'
  | 'providerUsage'
  | 'providerLaunchChoices'
  | 'resolveProviderLaunch'
  | 'addHandAddedModel'
  | 'deleteHandAddedModel'
  | 'checkProviderAuth'
  | 'apiKeyStatus'
  | 'setApiKey'
  | 'removeApiKey'
  | 'checkApiKey'
  | 'reprovisionProviderAuth'
  | 'reprovisionProviderHomes'
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
  logging: () => LoggingClient | undefined = () => undefined,
  dockLabel: () => DockLabelClient | undefined = () => undefined,
  agents: () => ClientAgentApi | undefined = () => undefined,
  transcriptRetention: () => TranscriptRetentionClient | undefined = () => undefined,
): ClientApi {
  return Object.freeze({
    providerCatalogue: () => runtime().providerCatalogue(),
    providerUsage: () => runtime().providerUsage(),
    providerLaunchChoices: (input) => runtime().providerLaunchChoices(input),
    resolveProviderLaunch: (input) => runtime().resolveProviderLaunch(input),
    addHandAddedModel: (input) => runtime().addHandAddedModel(input),
    deleteHandAddedModel: (input) => runtime().deleteHandAddedModel(input),
    checkProviderAuth: (input) => runtime().checkProviderAuth(input),
    apiKeyStatus: (input) => runtime().apiKeyStatus(input),
    setApiKey: (input) => runtime().setApiKey(input),
    removeApiKey: (input) => runtime().removeApiKey(input),
    checkApiKey: (input) => runtime().checkApiKey(input),
    reprovisionProviderAuth: (input) => runtime().reprovisionProviderAuth(input),
    reprovisionProviderHomes: (input) => runtime().reprovisionProviderHomes(input),
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
    get logging() {
      return logging()
    },
    get dockLabel() {
      return dockLabel()
    },
    get agents() {
      return agents()
    },
    get transcriptRetention() {
      return transcriptRetention()
    },
    get recoveryCopies() {
      return recoveryCopies()
    },
    get setup() {
      return setup()
    },
  } satisfies ClientApi)
}
