import type { ClientComposerApi } from './client-composer-api'
import type { ClientSessionApi } from './client-session-api'
import type { ClientProviderApi } from './client-provider-api'
import type { RecoveryRetentionClient } from './recovery-retention'
import type { PluginsClient } from './plugin-settings'
import type { LoggingClient } from './logging'

/** Client reads and intents composed at the existing injected application boundary. */
export interface ClientApi extends ClientProviderApi {
  readonly composer?: ClientComposerApi
  readonly sessions?: ClientSessionApi
  readonly recoveryCopies?: RecoveryRetentionClient
  readonly plugins?: PluginsClient
  readonly logging?: LoggingClient
}
