import type { IpcRenderer } from 'electron'
import {
  PLUGIN_SETTINGS_CHANNEL,
  PLUGIN_SCREEN_CLOSED,
  PLUGIN_REVIEW_INVALIDATED,
  PLUGIN_REVIEW_PROGRESS,
} from '../shared/plugin-settings-channels'
import type {
  PluginsClient,
  PluginSettingsRequest,
  PluginReviewProgress,
} from '../shared/plugin-settings'
export function pluginsBridge(ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'off'>): PluginsClient {
  return Object.freeze({
    request: (input: PluginSettingsRequest) => ipc.invoke(PLUGIN_SETTINGS_CHANNEL, input),
    onReviewProgress: (listener: (progress: PluginReviewProgress) => void) => {
      const notify = (_event: unknown, progress: PluginReviewProgress) => listener(progress)
      ipc.on(PLUGIN_REVIEW_PROGRESS, notify)
      return () => ipc.off(PLUGIN_REVIEW_PROGRESS, notify)
    },
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
