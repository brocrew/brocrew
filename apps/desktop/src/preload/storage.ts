import type { IpcRenderer } from 'electron'
import { STORAGE_CHANNELS, type StorageBridge, type StorageLocation } from '../shared/storage'

export function storageBridge(ipc: Pick<IpcRenderer, 'invoke'>): StorageBridge {
  return Object.freeze({
    measure: () => ipc.invoke(STORAGE_CHANNELS.measure) as ReturnType<StorageBridge['measure']>,
    children: (location: StorageLocation) =>
      ipc.invoke(STORAGE_CHANNELS.children, location) as ReturnType<StorageBridge['children']>,
    reveal: (location?: StorageLocation) =>
      ipc.invoke(STORAGE_CHANNELS.reveal, location) as ReturnType<StorageBridge['reveal']>,
    clearCache: () =>
      ipc.invoke(STORAGE_CHANNELS.clearCache) as ReturnType<StorageBridge['clearCache']>,
  })
}
