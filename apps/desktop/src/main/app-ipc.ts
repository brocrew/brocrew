import { ipcMain as raw } from 'electron'
import type { IpcMain } from 'electron'
import { isPluginSender } from './plugins/ui/senders'
import { PLUGIN_UI_UNAVAILABLE } from '../shared/plugin-ui'
/** Every existing app invocation passes this guard; dedicated plugin RPC uses the raw registrar. */
export function guardedAppIpc(
  backend: Pick<IpcMain, 'handle' | 'removeHandler'>,
): Pick<IpcMain, 'handle' | 'removeHandler'> {
  return {
    handle(channel, listener) {
      backend.handle(channel, (event, ...args) => {
        if (isPluginSender(event.sender)) throw new Error(PLUGIN_UI_UNAVAILABLE)
        return listener(event, ...args)
      })
    },
    removeHandler(channel) {
      backend.removeHandler(channel)
    },
  }
}
export const ipcMain = guardedAppIpc(raw)
