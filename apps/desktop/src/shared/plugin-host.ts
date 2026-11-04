import type { PluginContributionState, PluginHostResult, PluginJsonObject } from './plugin-contract'

export interface PluginContributionView {
  handle: string
  pluginId: string
  contributionId: string
  kind: string
  state: PluginContributionState
  definition: PluginJsonObject
  titlesEnabled: boolean
}
export interface PluginNotificationView {
  handle: string
  pluginId: string
  notificationId: string
  title: string
  text: string
  level: 'info' | 'warning' | 'error'
  actions: { id: string; label: string }[]
}
export interface PluginHostSnapshot {
  plugins?: { pluginId: string; name: string; enabled: boolean }[]
  contributions: PluginContributionView[]
  notifications: PluginNotificationView[]
  settingsViews?: { viewId: string; handle: string; pluginId: string }[]
}
export type PluginHostUiRequest =
  | { kind: 'snapshot' }
  | { kind: 'enabled'; pluginId: string; enabled: boolean }
  | { kind: 'activate'; handle: string }
  | { kind: 'notification-action'; handle: string; actionId: string }
  | { kind: 'notification-dismiss'; handle: string }
  | { kind: 'titles-enabled'; pluginId: string; enabled: boolean }
  | { kind: 'settings-open'; handle: string }
  | { kind: 'settings-close'; viewId: string }
export interface PluginHostClient {
  request(input: PluginHostUiRequest): Promise<PluginHostResult<unknown>>
  onChanged(listener: () => void): () => void
}
