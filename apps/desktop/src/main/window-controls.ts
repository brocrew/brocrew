/**
 * 🔴 **What the three window controls DO to a window** (385 §1) — the behaviour half of
 * `shared/window-controls.ts`, which is the wire half and carries the whole argument for both:
 * what was there before this file, why the verbs are Electron's spelling, and why zoom is not
 * full screen.
 */
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  WINDOW_CONTROL_CHANNEL,
  WINDOW_CONTROLS,
  isWindowControl,
  type WindowControl,
  type WindowControlEffect,
} from '../shared/window-controls'

/**
 * The part of a `BrowserWindow` this module touches, named so a test can hand it a double.
 *
 * ⚠️ **Structural rather than `BrowserWindow`**, for the same reason `window-navigation.ts` takes a
 * `WebContents`: the branch table below has five outcomes and a real window can only be put into
 * some of them by a window manager. A double is how the other ones get asserted at all.
 */
export interface ControllableWindow {
  isDestroyed(): boolean
  close(): void
  minimize(): void
  isMaximized(): boolean
  maximize(): void
  unmaximize(): void
  isFullScreen(): boolean
  setFullScreen(flag: boolean): void
}

/**
 * ⛔ **One verb → one gesture**, and the branch is named in the return value.
 *
 * | verb | window state | what happens |
 * |---|---|---|
 * | `close` | any | `close()` — the same path `role: 'close'` and ⌘W take |
 * | `minimize` | any | `minimize()` — the page goes `visibilityState: 'hidden'` (measured, 385) |
 * | `zoom` | full screen | `setFullScreen(false)` — the only way back out of a frameless full screen |
 * | `zoom` | maximised | `unmaximize()` |
 * | `zoom` | neither | `maximize()` — which on macOS IS zoom |
 *
 * ⚠️ **`isDestroyed()` first, and it is not defensive.** A click travels over IPC, and the window
 * it came from can be gone by the time this runs — the commonest way being a person pressing close
 * twice, or pressing close while a `beforeunload` is settling. Every method below throws on a
 * destroyed window, and an unhandled throw in a main-process handler surfaces to the renderer as a
 * rejected invoke on a window that no longer exists to show it.
 */
export function applyWindowControl(
  window: ControllableWindow,
  control: WindowControl,
): WindowControlEffect {
  if (window.isDestroyed()) return 'gone'
  switch (control) {
    case 'close':
      window.close()
      return 'closed'
    case 'minimize':
      window.minimize()
      return 'minimized'
    case 'zoom':
      if (window.isFullScreen()) {
        window.setFullScreen(false)
        return 'left-full-screen'
      }
      if (window.isMaximized()) {
        window.unmaximize()
        return 'unmaximized'
      }
      window.maximize()
      return 'maximized'
  }
}

/**
 * Wire the channel to whichever window asked.
 *
 * ⛔ **`fromWebContents(event.sender)` and never a captured window.** The handler is registered once,
 * for the whole app, and the app is allowed to have opened only one window today — but a control
 * that moved *the* window rather than *its own* window is a defect that cannot be seen until the day
 * there are two, and by then it is three surfaces away from this line. The dialogs above it in
 * `index.ts` resolve their owner the same way.
 *
 * ⚠️ **An unknown verb is refused, and refused LOUDLY.** The renderer is ours and the preload is the
 * only thing that can reach this channel, so a bad verb means the preload and this file have
 * drifted; answering `'gone'` or silently doing nothing would make that drift invisible for exactly
 * as long as nobody pressed the button.
 */
export function registerWindowControls(
  ipc: Pick<IpcMain, 'handle'>,
  ownerOf: (event: IpcMainInvokeEvent) => BrowserWindow | null,
): void {
  ipc.handle(WINDOW_CONTROL_CHANNEL, (event, control: unknown): WindowControlEffect => {
    if (!isWindowControl(control)) {
      throw new Error(
        `${WINDOW_CONTROL_CHANNEL}: ${JSON.stringify(control)} is not one of ` +
          `${WINDOW_CONTROLS.join(', ')}.`,
      )
    }
    const owner = ownerOf(event)
    return owner === null ? 'gone' : applyWindowControl(owner, control)
  })
}
