import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { RECOVERY_CHANNELS, type StartupVerdict } from '../shared/recovery'
import { keepOutOfSight } from './launch-presentation'
import { INVOKED_CHANNELS, type RecoveryCalls } from './recovery/window-calls'
import {
  installNavigationGuard,
  installSessionRelease,
  type AppDocument,
} from './window-navigation'

/**
 * The window a start that did not open its data ends in: it says why, offers what can be done, and
 * reads a restored copy's history. Its own document, its own preload (`window.recovery` and nothing
 * else), and only the `recovery:*` calls; the app's own window, IPC and runtime never start beside
 * it.
 */

/** The recovery window's document: `recovery.html` beside the app's own, in both builds. */
export function recoveryDocument(devServerUrl: string | undefined): AppDocument {
  return {
    indexHtml: join(__dirname, '../renderer/recovery.html'),
    ...(devServerUrl ? { devServerUrl: `${devServerUrl.replace(/\/$/, '')}/recovery.html` } : {}),
  }
}

export interface RecoveryWindowOptions {
  /** A hidden launch's window is kept out of sight and never shown. */
  readonly hidden: boolean
  readonly openExternal: (url: string) => void
  /** Lets go of what the window's page was given when the page goes away: the history reader. */
  readonly release: () => void
  /** The window is gone, closed by the person or by the app. */
  readonly onClosed: () => void
}

export function openRecoveryWindow(options: RecoveryWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 760,
    height: 640,
    show: false,
    title: 'BroCrew',
    // The window's paper, painted before its page's first frame.
    backgroundColor: '#fdfdff',
    webPreferences: {
      preload: join(__dirname, '../preload/recovery.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  if (options.hidden) keepOutOfSight(window)
  window.on('ready-to-show', () => {
    if (!options.hidden) window.show()
  })
  // The page is handed `window.recovery`, so it may never become another document.
  const entry = recoveryDocument(process.env['ELECTRON_RENDERER_URL'])
  installNavigationGuard(window.webContents, entry, options.openExternal)
  installSessionRelease(window.webContents, options.release)
  window.on('closed', options.onClosed)
  if (entry.devServerUrl !== undefined) {
    void window.loadURL(entry.devServerUrl)
  } else {
    void window.loadFile(entry.indexHtml)
  }
  return window
}

/**
 * Registers the window's calls. Each one is answered only for the recovery window's own top frame,
 * so no other page can restore, return or read the history.
 */
export function registerRecoveryIpc(
  ipc: IpcMain,
  window: () => BrowserWindow | null,
  calls: RecoveryCalls,
): void {
  const fromTheWindow = (event: IpcMainInvokeEvent): boolean => {
    const theWindow = window()
    return (
      theWindow !== null &&
      !theWindow.isDestroyed() &&
      event.sender.id === theWindow.webContents.id &&
      event.senderFrame?.parent === null
    )
  }
  for (const channel of INVOKED_CHANNELS) {
    ipc.handle(channel, (event, ...args: unknown[]) => {
      if (!fromTheWindow(event)) throw new Error('Only the recovery window may ask this.')
      return calls.answer(channel, args)
    })
  }
}

/** Tells the window a verdict main settled, or progress; nothing when there is no window. */
export function tellTheWindow(
  window: BrowserWindow | null,
  message: { readonly verdict: StartupVerdict } | { readonly done: number; readonly total: number },
): void {
  if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) return
  if ('verdict' in message) window.webContents.send(RECOVERY_CHANNELS.verdict, message.verdict)
  else window.webContents.send(RECOVERY_CHANNELS.progress, message)
}
