import { ipcMain as raw } from 'electron'
import type { IpcMain, IpcMainEvent } from 'electron'
import { isPluginSender } from './plugins/ui/senders'
import { PLUGIN_UI_UNAVAILABLE } from '../shared/plugin-ui'
import { errorText, logDebug, logError } from './logging/log'

let calls = 0
function logTheCall(channel: string, invoke: () => unknown): unknown {
  const call = ++calls
  const began = performance.now()
  const facts = () => ({ call, ms: Math.round(performance.now() - began) })
  const failed = (error: unknown) =>
    logError('ipc', channel, { ...facts(), error: errorText(error) })
  try {
    const result = invoke()
    void Promise.resolve(result).then(() => logDebug('ipc', channel, facts()), failed)
    return result
  } catch (error) {
    failed(error)
    throw error
  }
}
/** Every existing app invocation passes this guard; dedicated plugin RPC uses the raw registrar. */
export function guardedAppIpc(
  backend: Pick<IpcMain, 'handle' | 'removeHandler' | 'on' | 'removeListener'>,
): Pick<IpcMain, 'handle' | 'removeHandler' | 'on' | 'removeListener'> {
  type Listener = (event: IpcMainEvent, ...args: unknown[]) => void
  const listeners = new Map<string, Map<Listener, Listener[]>>()
  const app: Pick<IpcMain, 'handle' | 'removeHandler' | 'on' | 'removeListener'> = {
    handle(channel, listener) {
      backend.handle(channel, (event, ...args) => {
        if (isPluginSender(event.sender)) throw new Error(PLUGIN_UI_UNAVAILABLE)
        return logTheCall(channel, () => listener(event, ...args))
      })
    },
    removeHandler(channel) {
      backend.removeHandler(channel)
    },
    on(channel, listener) {
      const forward: Listener = (event, ...args) => {
        if (isPluginSender(event.sender)) {
          event.returnValue = null
          return
        }
        listener(event, ...args)
      }
      const channelListeners = listeners.get(channel) ?? new Map<Listener, Listener[]>()
      const registrations = channelListeners.get(listener) ?? []
      registrations.push(forward)
      channelListeners.set(listener, registrations)
      listeners.set(channel, channelListeners)
      backend.on(channel, forward)
      return app as IpcMain
    },
    removeListener(channel, listener) {
      const channelListeners = listeners.get(channel)
      const registrations = channelListeners?.get(listener)
      const forward = registrations?.pop()
      if (forward) {
        backend.removeListener(channel, forward)
        if (!registrations?.length) channelListeners?.delete(listener)
        if (!channelListeners?.size) listeners.delete(channel)
      }
      return app as IpcMain
    },
  }
  return app
}
export const ipcMain = guardedAppIpc(raw)
