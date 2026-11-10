import type { IpcRenderer, IpcRendererEvent } from 'electron'
import {
  STORAGE_CHANNELS,
  type CacheClearState,
  type StorageBridge,
  type StorageLocation,
} from '../shared/storage'

export function storageBridge(
  ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>,
): StorageBridge {
  let nextSubscription = 0
  return Object.freeze({
    measure: () => ipc.invoke(STORAGE_CHANNELS.measure) as ReturnType<StorageBridge['measure']>,
    children: (location: StorageLocation) =>
      ipc.invoke(STORAGE_CHANNELS.children, location) as ReturnType<StorageBridge['children']>,
    reveal: (location?: StorageLocation) =>
      ipc.invoke(STORAGE_CHANNELS.reveal, location) as ReturnType<StorageBridge['reveal']>,
    clearCache: () =>
      ipc.invoke(STORAGE_CHANNELS.clearCache) as ReturnType<StorageBridge['clearCache']>,
    watchCacheClear: (
      onState: (state: CacheClearState | null) => void,
      onError: (error: unknown) => void,
    ) => {
      const subscription = ++nextSubscription
      let live = true
      const listener = (_event: IpcRendererEvent, state: CacheClearState) => {
        if (live) onState(state)
      }
      ipc.on(STORAGE_CHANNELS.cacheClearChanged, listener)
      void ipc.invoke(STORAGE_CHANNELS.watchCacheClear, subscription).then(
        (state: CacheClearState | null) => {
          if (live) onState(state)
        },
        (error: unknown) => {
          if (live) onError(error)
        },
      )
      return () => {
        live = false
        ipc.removeListener(STORAGE_CHANNELS.cacheClearChanged, listener)
        void ipc.invoke(STORAGE_CHANNELS.unwatchCacheClear, subscription).catch(() => {})
      }
    },
    pruneBackups: () =>
      ipc.invoke(STORAGE_CHANNELS.pruneBackups) as ReturnType<StorageBridge['pruneBackups']>,
  })
}
