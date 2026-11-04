import type { IpcRenderer } from 'electron'
import { PLUGIN_HOST_CHANNEL, PLUGIN_HOST_CHANGED } from '../shared/plugin-host-channels'
import type { PluginHostClient, PluginHostUiRequest } from '../shared/plugin-host'

export function pluginHostBridge(
  ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'off'>,
): PluginHostClient {
  return Object.freeze({
    request: (input: PluginHostUiRequest) => ipc.invoke(PLUGIN_HOST_CHANNEL, input),
    onChanged: (listener: () => void) => {
      const notify = () => listener()
      ipc.on(PLUGIN_HOST_CHANGED, notify)
      return () => {
        ipc.off(PLUGIN_HOST_CHANGED, notify)
      }
    },
  })
}
