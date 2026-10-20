import type { IpcRenderer } from 'electron'
import {
  PLUGIN_SETTINGS_CHANNEL,
  PLUGIN_SCREEN_CLOSED,
  type PluginsClient,
  type PluginSettingsRequest,
} from '../shared/plugin-settings'
export function pluginsBridge(ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'off'>): PluginsClient {
  return Object.freeze({
    request: (input: PluginSettingsRequest) => ipc.invoke(PLUGIN_SETTINGS_CHANNEL, input),
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
