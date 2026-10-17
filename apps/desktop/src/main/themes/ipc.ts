import type { IpcMain } from 'electron'
import { THEMES_CHANNELS, type ThemeChanged, type ThemeRefused } from '../../shared/theme-library'
import { THEME_ID } from './files'
import type { ThemeStore } from './store'

const validId = (id: unknown): id is string => typeof id === 'string' && THEME_ID.test(id)
const invalid = (): ThemeRefused => ({ outcome: 'refused', rail: 'theme-invalid', problems: [] })

export function registerThemeIpc(
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
  store: ThemeStore,
  changed: (snapshot: ThemeChanged) => void,
): () => void {
  ipc.handle(THEMES_CHANNELS.list, () => store.refresh())
  ipc.handle(THEMES_CHANNELS.read, async (_event, id: unknown) => {
    if (id !== undefined && !validId(id)) return invalid()
    await store.refresh()
    return store.reading(id)
  })
  ipc.handle(THEMES_CHANNELS.set, (_event, id: unknown) =>
    validId(id) ? store.set(id) : invalid(),
  )
  ipc.handle(THEMES_CHANNELS.duplicate, (_event, id: unknown, name: unknown) =>
    validId(id) && typeof name === 'string' ? store.duplicate(id, name) : invalid(),
  )
  ipc.handle(THEMES_CHANNELS.delete, (_event, id: unknown) =>
    validId(id) ? store.delete(id) : invalid(),
  )
  ipc.handle(THEMES_CHANNELS.openFolder, () => store.openFolder())
  const unsubscribe = store.onChanged(changed)
  return () => {
    unsubscribe()
    for (const channel of Object.values(THEMES_CHANNELS)) {
      if (channel !== THEMES_CHANNELS.changed) ipc.removeHandler(channel)
    }
  }
}
