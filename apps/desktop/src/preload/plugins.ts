import type { IpcRenderer } from 'electron'
import {
  PLUGIN_SETTINGS_CHANNEL,
  PLUGIN_SCREEN_CLOSED,
  PLUGIN_REVIEW_INVALIDATED,
  type PluginsClient,
  type PluginSettingsRequest,
} from '../shared/plugin-settings'
export function pluginsBridge(ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'off'>): PluginsClient {
  return Object.freeze({
    request: (input: PluginSettingsRequest) => ipc.invoke(PLUGIN_SETTINGS_CHANNEL, input),
    onReviewInvalidated: (listener: () => void) => {
      const notify = (_event: unknown, ...extra: unknown[]) => {
        if (!extra.length) listener()
      }
      ipc.on(PLUGIN_REVIEW_INVALIDATED, notify)
      return () => {
        ipc.off(PLUGIN_REVIEW_INVALIDATED, notify)
      }
    },
    onClosed: (listener: (screenId: string) => void) => {
      const notify = (_event: unknown, screenId: unknown) => {
        if (typeof screenId === 'string' && /^[a-f0-9-]{36}$/.test(screenId)) listener(screenId)
      }
      ipc.on(PLUGIN_SCREEN_CLOSED, notify)
      return () => {
        ipc.off(PLUGIN_SCREEN_CLOSED, notify)
      }
    },
  })
}
