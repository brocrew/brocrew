import { mkdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

/**
 * 🔴 **Where this app keeps its data — pinned, so no name the OS shows can move it** (W4.90).
 *
 * ⚑ **What Electron does when nothing pins it** (Electron 43.2.0, read from its source): the
 * default `userData` is `<appData>/<app name>` (`shell/common/electron_paths.cc`), and the app name
 * is the packaged `package.json`'s `productName`, else its `name` (`lib/browser/init.ts`), else the
 * name the executable carries. ⚑ Measured on a packaged build: electron-builder writes no
 * `productName` into the app's `package.json`, so every build — a developer's and a packaged one,
 * on macOS and on Windows — has kept its data in `<appData>/@brobot2/desktop`, the package's npm
 * `name`. The same name labels the macOS Keychain entry `safeStorage` seals saved keys with
 * (`"<app name> Safe Storage"`), so the name must not move either.
 *
 * ⛔ **So this pins the folder rather than trusting the derivation**: the bundle and the installers
 * are called *BroBot*, and a name that ever reached the derivation — a `productName` in the
 * package, an executable's own name — would move every person's conversations, keys and settings
 * to a new, empty folder.
 *
 * ⚠️ **A launch that names its own folder keeps it** (`--user-data-dir`): every test and live smoke
 * runs that way, and Electron applies the switch before this runs.
 */
export const DATA_FOLDER = ['@brobot2', 'desktop'] as const

/** The app's data folder when no `--user-data-dir` names another. */
export function defaultDataFolder(appData: string): string {
  return join(appData, ...DATA_FOLDER)
}

/** The part of Electron's `app` the pin uses. */
export interface PinnableApp {
  getPath(name: 'appData'): string
  setPath(name: 'userData', path: string): void
  readonly commandLine: { hasSwitch(name: string): boolean }
}

/**
 * Pin `userData` to {@link defaultDataFolder} — called at module scope in `index.ts`, before
 * anything reads it — unless the launch named its own folder.
 *
 * ⚠️ The folder is made first, for a first launch on a new machine. ⚑ A folder that cannot be made
 * (its path is a file, a disk is gone) is not this call's to report: Electron accepts the path
 * either way, and opening the database there says what went wrong, as it always has.
 */
export function pinTheDataFolder(app: PinnableApp): void {
  if (app.commandLine.hasSwitch('user-data-dir')) return
  const folder = defaultDataFolder(app.getPath('appData'))
  try {
    mkdirSync(folder, { recursive: true })
  } catch {
    // Reported where the folder is first used.
  }
  app.setPath('userData', folder)
}

/**
 * 🔴 **The app's id, which the OS knows it by** — `appId` in `electron-builder.yml`, the bundle id on
 * macOS and the id the installer's shortcuts carry on Windows (W4.90).
 */
export const APP_ID = 'com.brobot2.desktop'

/**
 * ⚑ **On Windows, the running app is the app its shortcuts start**: the taskbar groups a window
 * with the Start menu and desktop shortcuts by this id, and a pin made from the window survives a
 * new name for the executable. ⚠️ Electron's own default is not the id the shortcuts carry, and it
 * follows the executable's name, which the rename to BroBot changed. No data is keyed by it.
 */
export function nameTheAppToWindows(
  app: {
    setAppUserModelId(id: string): void
  },
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === 'win32') app.setAppUserModelId(APP_ID)
}

/**
 * 🔴 **W4.105 · A0 — the file a workspace keeps its own name in**: `<folder>/workspace.json`,
 * `{"name": "Research"}`. ⚑ In the folder, so the name travels with it when it moves.
 */
export const WORKSPACE_FILE = 'workspace.json'

/** What the default folder is called when it names nothing itself. */
export const DEFAULT_WORKSPACE_NAME = 'Default'

/** How long a workspace's name may be, in code points — a footer's line, not a paragraph. */
export const WORKSPACE_NAME_MAX = 64

/** A name as it may be shown: trimmed, no control or format characters, at most 64 code points. */
function shownName(raw: string): string {
  return [...raw.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()].slice(0, WORKSPACE_NAME_MAX).join('')
}

/** The name `<folder>/workspace.json` gives, or null when it gives none it can be shown with. */
function namedIn(folder: string): string | null {
  try {
    const said = JSON.parse(readFileSync(join(folder, WORKSPACE_FILE), 'utf8')) as unknown
    const name =
      typeof said === 'object' && said !== null ? (said as { name?: unknown }).name : undefined
    if (typeof name !== 'string') return null
    const shown = shownName(name)
    return shown === '' ? null : shown
  } catch {
    // ⚑ No file, an unreadable one, or not JSON: the folder names nothing, and that is no fault.
    return null
  }
}

/**
 * 🔴 **W4.105 · A0 — the workspace a window runs on** (`AppInfo.workspace`): the folder, what to
 * call it, and whether it is the default one {@link pinTheDataFolder} pins.
 *
 * ⚑ The name: the folder's own `workspace.json`, else `Default` for the default folder, else the
 * folder's last segment — and never a person's name.
 */
export function workspaceOf(
  userData: string,
  isDefault: boolean,
): { readonly name: string; readonly path: string; readonly isDefault: boolean } {
  // ⚠️ A folder whose last segment names nothing (a root) is called by its path, never `Default`.
  const segment = shownName(basename(resolve(userData)))
  const fallback = isDefault ? DEFAULT_WORKSPACE_NAME : segment === '' ? userData : segment
  return { name: namedIn(userData) ?? fallback, path: userData, isDefault }
}
