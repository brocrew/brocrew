import type { IpcRenderer, IpcRendererEvent } from 'electron'
import { THEMES_CHANNELS, type ThemeChanged, type ThemesBridge } from '../shared/theme-library'

export function themesBridge(ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'off'>): ThemesBridge {
  return Object.freeze({
    list: () => ipc.invoke(THEMES_CHANNELS.list) as ReturnType<ThemesBridge['list']>,
    read: (id?: string) => ipc.invoke(THEMES_CHANNELS.read, id) as ReturnType<ThemesBridge['read']>,
    set: (id: string) => ipc.invoke(THEMES_CHANNELS.set, id) as ReturnType<ThemesBridge['set']>,
    duplicate: (id: string, name: string) =>
      ipc.invoke(THEMES_CHANNELS.duplicate, id, name) as ReturnType<ThemesBridge['duplicate']>,
    delete: (id: string) =>
      ipc.invoke(THEMES_CHANNELS.delete, id) as ReturnType<ThemesBridge['delete']>,
    openFolder: () =>
      ipc.invoke(THEMES_CHANNELS.openFolder) as ReturnType<ThemesBridge['openFolder']>,
    onChanged: (listener: (snapshot: ThemeChanged) => void): (() => void) => {
      const forward = (_event: IpcRendererEvent, snapshot: ThemeChanged): void => listener(snapshot)
      ipc.on(THEMES_CHANNELS.changed, forward)
      return () => {
        ipc.off(THEMES_CHANNELS.changed, forward)
      }
    },
  })
}
