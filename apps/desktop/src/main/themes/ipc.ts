import type { IpcMain, IpcMainEvent } from 'electron'
import {
  THEME_FIRST_PAINT_CHANNEL,
  THEMES_CHANNELS,
  type ThemeChanged,
  type ThemePaint,
  type ThemeRefused,
} from '../../shared/theme-library'
import { themeAssetUrl, themeAttributes, themeCss } from '../../shared/themes/css'
import { assetOwner } from '../../shared/themes/theme'
import { THEME_ID } from './files'
import type { ThemeStore } from './store'

const validId = (id: unknown): id is string => typeof id === 'string' && THEME_ID.test(id)
const invalid = (): ThemeRefused => ({ outcome: 'refused', rail: 'theme-invalid', problems: [] })

export function registerThemeIpc(
  ipc: Pick<IpcMain, 'handle' | 'removeHandler' | 'on' | 'removeListener'>,
  store: ThemeStore,
  changed: (snapshot: ThemeChanged) => void,
): () => void {
  // Startup already loaded this store. This reply never waits for files or a refresh.
  const beforePaint = (event: IpcMainEvent): void => {
    let paint: ThemePaint | null = null
    try {
      const reading = store.reading()
      if ('outcome' in reading) return
      const theme = reading.theme
      paint = {
        id: theme?.id ?? null,
        css: theme
          ? themeCss(theme, {
              assetUrl: (path) => {
                const owner = assetOwner(path, theme.id)
                return themeAssetUrl(owner.id, owner.path, reading.assetVersions[owner.id])
              },
            })
          : '',
        attributes: theme ? themeAttributes(theme) : {},
      }
    } catch {
      // The normal asynchronous reading still handles an unavailable theme.
    } finally {
      // Setting returnValue sends the synchronous reply immediately. Send it only once.
      event.returnValue = paint
    }
  }
  ipc.on(THEME_FIRST_PAINT_CHANNEL, beforePaint)
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
    ipc.removeListener(THEME_FIRST_PAINT_CHANNEL, beforePaint)
    for (const channel of Object.values(THEMES_CHANNELS)) {
      if (channel !== THEMES_CHANNELS.changed) ipc.removeHandler(channel)
    }
  }
}
