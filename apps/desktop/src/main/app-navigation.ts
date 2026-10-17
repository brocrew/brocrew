import type { BrowserWindow } from 'electron'
import { APP_NAVIGATE_CHANNEL } from '../shared/app-navigation'

/** Forward native history gestures to the app's own navigation history. */
export function installAppNavigation(window: Pick<BrowserWindow, 'on' | 'webContents'>): void {
  window.on('swipe', (_event, direction) => {
    if (direction === 'left') window.webContents.send(APP_NAVIGATE_CHANNEL, 'back')
    else if (direction === 'right') window.webContents.send(APP_NAVIGATE_CHANNEL, 'forward')
  })
  window.on('app-command', (_event, command) => {
    if (command === 'browser-backward') window.webContents.send(APP_NAVIGATE_CHANNEL, 'back')
    else if (command === 'browser-forward') window.webContents.send(APP_NAVIGATE_CHANNEL, 'forward')
  })
}
