import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'

export interface TitleBarPalette {
  readonly color: string
  readonly symbolColor: string
}

export const CLASSIC_TITLE_BAR: TitleBarPalette = {
  color: '#10132f',
  symbolColor: '#dfe1fb',
}

export function nativeTitleBarOptions(
  platform: NodeJS.Platform,
  palette: TitleBarPalette = CLASSIC_TITLE_BAR,
): Pick<
  BrowserWindowConstructorOptions,
  'frame' | 'titleBarStyle' | 'titleBarOverlay' | 'trafficLightPosition'
> {
  if (platform === 'darwin') {
    return {
      frame: true,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 10 },
    }
  }
  if (platform === 'win32') {
    return { frame: true, titleBarStyle: 'hidden', titleBarOverlay: { ...palette, height: 32 } }
  }
  return { frame: true }
}

export function updateNativeTitleBar(
  window: Pick<BrowserWindow, 'setTitleBarOverlay'>,
  platform: NodeJS.Platform,
  palette: TitleBarPalette = CLASSIC_TITLE_BAR,
): void {
  if (platform === 'win32') window.setTitleBarOverlay({ ...palette, height: 32 })
}
