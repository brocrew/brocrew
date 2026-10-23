// Person-control may wait 180 seconds for a cold plugin start; leave room for its page load.
export const PLUGIN_CONFIGURATION_TIMEOUT = 200_000
export const PLUGIN_SETTINGS_CHANNEL = 'plugins:settings'
export const PLUGIN_SCREEN_CLOSED = 'plugins:screen-closed'
export const PLUGIN_STATES = [
  'Available',
  'Installed',
  'Running',
  'Needs setup',
  'Unavailable',
] as const
export type PluginState = (typeof PLUGIN_STATES)[number]
export type PluginMutationBlocked = 'owner-incompatible' | 'source-mismatch'
export interface PluginMutationConsent {
  releaseDigest: string
  preparation: string
}
export interface PluginCard {
  id: string
  name: string
  /** null means storage could not establish presence; never permission to install. */
  installed: boolean | null
  state: PluginState
  /** Scheduling snapshot, unknown off macOS or when the owned process cannot be read. */
  priorityClamped?: boolean | null
  installedVersion?: string
  updateVersion?: string
  /** Installed package is manageable but has no release admitted for this app. */
  updatesUnavailable?: true
  uninstallDeletesData?: boolean
  hasRemoteLogout?: boolean
  preparationRequired?: true
  mutationBlocked?: PluginMutationBlocked
}
/** Versioned actions remain denied until verified disclosure can supply consent. */
export function pluginMutationAllowed(card: PluginCard, action: 'install' | 'update'): boolean {
  if (card.preparationRequired || card.mutationBlocked) return false
  return action === 'install'
    ? card.installed === false && card.state === 'Available'
    : card.installed === true && !!card.updateVersion && card.state !== 'Unavailable'
}
export function pluginMutationNotice(cause: PluginMutationBlocked): string {
  return cause === 'source-mismatch'
    ? 'Install and update are unavailable because another BroCrew window on this computer uses a different plugin list. You can still configure or uninstall installed plugins.'
    : 'Install and update are unavailable until every BroCrew window on this computer is updated. You can still configure or uninstall installed plugins.'
}
/** Closed uninstall facts; remote removal is never inferred from deleting local data. */
export interface PluginRemovalOutcome {
  data: 'deleted'
  logout: 'confirmed' | 'unconfirmed'
}
export function pluginRemovalOutcome(value: unknown): PluginRemovalOutcome | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as Partial<PluginRemovalOutcome>
  if (
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'data') ||
    !Object.hasOwn(value, 'logout') ||
    result.data !== 'deleted' ||
    (result.logout !== 'confirmed' && result.logout !== 'unconfirmed')
  )
    return null
  return { data: 'deleted', logout: result.logout }
}
export interface PluginScreenBounds {
  x: number
  y: number
  width: number
  height: number
}
export type PluginSettingsRequest =
  | { kind: 'list' | 'availability' }
  | { kind: 'install' | 'update' | 'uninstall' | 'retry'; id: string }
  | { kind: 'configure'; id: string; screenId: string; bounds: PluginScreenBounds }
  | { kind: 'bounds'; bounds: PluginScreenBounds }
  | { kind: 'close' }
export type PluginListState = 'ready' | 'empty' | 'not-published' | 'fetch-error'
export type PluginSettingsReply =
  | {
      ok: true
      cards?: PluginCard[]
      available?: boolean
      listState?: PluginListState
      refreshFailed?: boolean
      removal?: PluginRemovalOutcome
    }
  | { ok: false; listState: 'not-published' | 'fetch-error' }
  | { ok: false; error: 'Plugin unavailable. Try again.' }
export interface PluginsClient {
  request(input: PluginSettingsRequest): Promise<PluginSettingsReply>
  onClosed(listener: (screenId: string) => void): () => void
}
