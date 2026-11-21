import { ipcMain } from './app-ipc'
import { ATTENTION_SIGNALS_CHANNEL, isAttentionSignal } from '../shared/attention-signals'
import { AttentionSignals } from './attention-signals'
import { attentionOverlay } from './attention-overlay'
import { app, BrowserWindow, nativeImage } from 'electron'

export function registerAttentionSignalsIpc(): void {
  const attentionWindows = new WeakMap<BrowserWindow, AttentionSignals>()
  ipcMain.handle(ATTENTION_SIGNALS_CHANNEL, (event, signal: unknown) => {
    if (!isAttentionSignal(signal)) throw new Error('Invalid attention signal.')
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window === null || window.isDestroyed()) return
    let signals = attentionWindows.get(window)
    if (signals === undefined) {
      signals = new AttentionSignals({
        platform: process.platform,
        isFocused: () => window.isFocused(),
        badge: (count) => {
          if (process.platform === 'darwin') app.dock?.setBadge(count === 0 ? '' : String(count))
          else if (process.platform === 'linux') app.setBadgeCount(count)
        },
        bounce: (kind) => app.dock?.bounce(kind),
        cancelBounce: (id) => app.dock?.cancelBounce(id),
        flash: (active) => {
          if (!window.isDestroyed()) window.flashFrame(active)
        },
        overlay: (count) => {
          if (window.isDestroyed()) return
          const png = attentionOverlay(count)
          window.setOverlayIcon(
            png === null ? null : nativeImage.createFromBuffer(png),
            count === 0 ? '' : `${count} item${count === 1 ? '' : 's'} waiting on you`,
          )
        },
      })
      const owned = signals
      window.on('focus', () => owned.focused())
      window.once('closed', () => owned.clear())
      window.webContents.on('render-process-gone', () => owned.reloaded())
      window.webContents.on('did-navigate', () => owned.reloaded())
      attentionWindows.set(window, signals)
    }
    signals.update(signal)
  })
}
