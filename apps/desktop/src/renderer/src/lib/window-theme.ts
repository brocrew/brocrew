/**
 * The window's theme: read once before the window first draws, then kept in step with every
 * change the host announces — a person's choice, an agent's, a theme file edited by hand. Each
 * change is read again rather than trusted from the announcement, and only the newest read is
 * applied, so a slow answer never puts back an older theme.
 */
import type {
  ThemeChanged,
  ThemeReading,
  ThemeRefused,
  ThemesBridge,
} from '../../../shared/theme-library'
import { themeAssetUrl } from '../../../shared/themes/css'
import { assetOwner } from '../../../shared/themes/theme'
import { applyTheme, type AppliedTheme, type ThemeDocument } from './apply-theme'

/** How long the first draw waits for the theme; after that the window draws and the theme follows. */
export const FIRST_THEME_WAIT_MS = 1500

/**
 * A theme file's URL on the host's scheme: inherited files are served from their own theme's
 * folder, and every URL carries its theme's version, so an edited picture is fetched again.
 */
export function readingAssetUrl(reading: ThemeReading): (path: string) => string {
  const id = reading.theme?.id ?? reading.active
  return (path) => {
    const owner = assetOwner(path, id)
    return themeAssetUrl(owner.id, owner.path, reading.assetVersions[owner.id])
  }
}

/** Applies what the host answered. The app's own look stands for classic and for a refusal. */
export function applyReading(
  reading: ThemeReading | ThemeRefused | null,
  doc?: ThemeDocument,
): AppliedTheme {
  const theme = reading && !('outcome' in reading) ? reading.theme : null
  if (!reading || 'outcome' in reading || !theme) return applyTheme(null, doc ? { doc } : {})
  return applyTheme(theme, { assetUrl: readingAssetUrl(reading), ...(doc ? { doc } : {}) })
}

export interface WindowThemeOptions {
  readonly doc?: ThemeDocument
  /**
   * Called for a change whose own read is the one now on the window: the newest read, of the theme
   * the change announced, at the version it announced. A change a newer one overtook, or whose read
   * failed, is never reported.
   */
  readonly onChange?: (change: ThemeChanged) => void
}

/** Whether a reading is of the theme a change announced, at the version it announced. */
export function readingMatches(change: ThemeChanged, reading: ThemeReading): boolean {
  if (reading.active !== change.active) return false
  const announced = change.themes.find((row) => row.id === change.active)?.version
  return announced === undefined || announced === reading.version
}

export interface WindowTheme {
  /**
   * Settles once a theme is on: the first read applied that no newer one overtook, or the app's own
   * look when the first read fails. Never rejects.
   */
  readonly ready: Promise<void>
  stop(): void
}

/**
 * Everything in the window that wants to know when the themes change hears it from here, so the
 * window has one listener on the host's themes channel: the one {@link startWindowTheme} holds.
 */
const followers = new Set<(change: ThemeChanged) => void>()

/** Calls `listener` on every change the host announces. Answers how to stop. */
export function onThemesChanged(listener: (change: ThemeChanged) => void): () => void {
  followers.add(listener)
  return () => void followers.delete(listener)
}

/** Starts following the host's themes. With no bridge, the app's own look stays. */
export function startWindowTheme(
  themes: ThemesBridge | undefined,
  options: WindowThemeOptions = {},
): WindowTheme {
  if (!themes) return { ready: Promise.resolve(), stop: () => undefined }
  let latest = 0
  let stopped = false
  let settle: () => void = () => undefined
  const ready = new Promise<void>((done) => (settle = done))
  /** Reads and applies; answers the reading when it is the newest and is now on the window. */
  const readAndApply = async (): Promise<ThemeReading | null> => {
    const mine = ++latest
    let reading: ThemeReading | ThemeRefused | null
    try {
      reading = await themes.read()
    } catch {
      reading = null
    }
    if (stopped || mine !== latest) return null
    // An unreadable answer after a theme is on keeps that theme; only the first read falls back.
    if (reading === null && mine > 1) return null
    const applied = applyReading(reading, options.doc)
    // Ready means a theme is on: the first application that took, or the app's own look.
    settle()
    return applied.ok && reading !== null && !('outcome' in reading) ? reading : null
  }
  void readAndApply()
  const unsubscribe = themes.onChanged((change) => {
    for (const follower of [...followers]) follower(change)
    void readAndApply().then((reading) => {
      if (stopped || reading === null || !readingMatches(change, reading)) return
      options.onChange?.(change)
    })
  })
  return {
    ready,
    stop() {
      stopped = true
      unsubscribe()
      settle()
    },
  }
}

/** Waits for the first theme, but never longer than {@link FIRST_THEME_WAIT_MS}. */
export function themeBeforeDrawing(
  theme: WindowTheme,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<void> {
  return Promise.race([theme.ready, wait(FIRST_THEME_WAIT_MS)])
}
