import {
  PACKAGED_WORKSPACE_REFUSAL,
  requiresWorkspacePolicy,
  workspaceRouting,
} from './workspace-routing'
import { claimPackagedWorkspace } from './workspace-routing-store'
import { ExistingWorkspace } from './workspace-startup'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

/**
 * Keep the default data folder at <appData>/@brobot2/desktop while the bundle and installers are
 * named BroCrew. Electron otherwise derives userData from the app's product or package name, so
 * a display-name change could make existing conversations, keys and settings appear to vanish.
 *
 * The package name remains @brobot2/desktop. Its macOS Keychain entry is still
 * "@brobot2/desktop Safe Storage"; changing the product's displayed name must not rename it.
 * Packaged Finder launches can reopen their last workspace. Explicit folders are kept only when
 * the workspace routing policy permits this build to open them.
 */
export const DATA_FOLDER = ['@brobot2', 'desktop'] as const

/** The app's data folder when no `--user-data-dir` names another. */
export function defaultDataFolder(appData: string): string {
  return join(appData, ...DATA_FOLDER)
}

/** The part of Electron's `app` the pin uses. */
export interface PinnableApp {
  getPath(name: 'appData' | 'userData'): string
  readonly isPackaged?: boolean
  getAppPath?(): string
  setPath(name: 'userData', path: string): void
  readonly commandLine: { hasSwitch(name: string): boolean }
}

const existingWorkspaces = new WeakMap<PinnableApp, ExistingWorkspace>()

export function workspaceStartup(app: PinnableApp): ExistingWorkspace | undefined {
  return existingWorkspaces.get(app)
}

/** Select and fence the workspace before Chromium's lock or any database access. */
export function pinTheDataFolder(app: PinnableApp): void {
  existingWorkspaces.delete(app)
  const explicit = app.commandLine.hasSwitch('user-data-dir')
  let folder: string
  if (typeof app.isPackaged === 'boolean') {
    const hidden = app.commandLine.hasSwitch('brobot-hidden')
    const appData = app.getPath('appData')
    const routing = workspaceRouting(
      appData,
      app.isPackaged,
      app.isPackaged && app.getAppPath ? requiresWorkspacePolicy(app.getAppPath()) : false,
      { readOnly: hidden },
    )
    folder = explicit
      ? app.getPath('userData')
      : ((app.isPackaged ? routing.first : undefined) ?? defaultDataFolder(appData))
    const refusal = routing.refusal(folder)
    if (refusal) throw new Error(refusal)
    const existing =
      app.isPackaged && (routing.configured || (explicit ? routing.known(folder) : routing.first))
    if (existing) {
      try {
        const root = statSync(folder)
        if (!root.isDirectory()) throw new Error(PACKAGED_WORKSPACE_REFUSAL)
        if (routing.configured) existingWorkspaces.set(app, new ExistingWorkspace(folder, root))
      } catch {
        throw new Error(PACKAGED_WORKSPACE_REFUSAL)
      }
    }
    if (app.isPackaged && !hidden) claimPackagedWorkspace(appData, folder)
    if (explicit) return
    if (existing) {
      app.setPath('userData', folder)
      return
    }
  } else {
    if (explicit) return
    folder = defaultDataFolder(app.getPath('appData'))
  }
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
