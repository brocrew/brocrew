import { describe, expect, it, vi } from 'vitest'
import { nativeTitleBarOptions, updateNativeTitleBar } from '../src/main/native-title-bar'

describe('native title bars', () => {
  it('keeps macOS traffic lights inside the web bar and Linux controls in its native frame', () => {
    expect(nativeTitleBarOptions('darwin')).toEqual({
      frame: true,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 10 },
    })
    expect(nativeTitleBarOptions('linux')).toEqual({ frame: true })
  })

  it('uses the theme on the initial Windows overlay and updates the existing window', () => {
    const first = { color: '#091524', symbolColor: '#e6eef5' }
    const next = { color: '#e3e8f4', symbolColor: '#182135' }
    expect(nativeTitleBarOptions('win32', first)).toEqual({
      frame: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...first, height: 32 },
    })
    const window = { setTitleBarOverlay: vi.fn() }
    updateNativeTitleBar(window, 'win32', next)
    expect(window.setTitleBarOverlay).toHaveBeenCalledExactlyOnceWith({ ...next, height: 32 })
    updateNativeTitleBar(window, 'darwin', next)
    updateNativeTitleBar(window, 'linux', next)
    expect(window.setTitleBarOverlay).toHaveBeenCalledTimes(1)
  })
})
