import type { ClientComposerApi } from './client-composer-api'
import type { ClientSessionApi } from './client-session-api'
import type { ClientProviderApi } from './client-provider-api'
import type { RecoveryRetentionClient } from './recovery-retention'
import type { PluginsClient } from './plugin-settings'
import type { LoggingClient } from './logging'
import type { DockLabelClient } from './dock-label'
import type { ClientAgentApi } from './client-agent-api'
import type { StorageBridge } from './storage'
import type { WorkspacesClient } from './workspaces'
import type { ThemesBridge } from './theme-library'
import type { UpdatesBridge } from './updates'
import type { ChosenCwd } from './runtime-ipc'
import type { AppInfo } from '@brobot2/shared'
import type { AttentionSignal } from './attention-signals'
import type { SavedDrafts } from './saved-drafts'
import type { ClientScreenApi } from './client-screen-api'

export interface ClientDesktopApi {
  chooseBundle(): Promise<string | null>
  chooseCwd(): Promise<ChosenCwd>
  onClosing?(listener: () => void): () => void
  readonly updates?: UpdatesBridge
  getAppInfo(): Promise<AppInfo>
  onNavigate?(listener: (direction: 'back' | 'forward') => void): () => void
  attentionSignals?(signal: AttentionSignal): Promise<void>
  savedDrafts?(): Promise<SavedDrafts | null>
  saveDrafts?(saved: SavedDrafts): Promise<void>
  onLastDraftSave?(listener: () => void): () => void
}

/** Client reads and intents composed at the existing injected application boundary. */
export interface ClientApi extends ClientProviderApi {
  readonly composer?: ClientComposerApi
  readonly sessions?: ClientSessionApi
  readonly recoveryCopies?: RecoveryRetentionClient
  readonly plugins?: PluginsClient
  readonly logging?: LoggingClient
  readonly dockLabel?: DockLabelClient
  readonly agents?: ClientAgentApi
  readonly storage?: StorageBridge
  readonly workspaces?: WorkspacesClient
  readonly themes?: ThemesBridge
  readonly desktop?: ClientDesktopApi
  readonly screen?: ClientScreenApi
}
