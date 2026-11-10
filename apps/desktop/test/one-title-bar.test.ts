import { describe, expect, it } from 'vitest'
import { appMenuTemplate, rolesIn } from '../src/main/app-menu'
import {
  applyWindowControl,
  registerWindowControls,
  type ControllableWindow,
} from '../src/main/window-controls'
import {
  WINDOW_CONTROLS,
  WINDOW_CONTROL_CHANNEL,
  isWindowControl,
  type WindowControl,
  type WindowControlEffect,
} from '../src/shared/window-controls'

/** A window that records rather than moves, and can be put in states a real one cannot. */
function fakeWindow(
  state: Partial<Record<'destroyed' | 'maximized' | 'fullScreen', boolean>> = {},
) {
  const calls: string[] = []
  const window: ControllableWindow = {
    isDestroyed: () => state.destroyed === true,
    close: () => void calls.push('close'),
    minimize: () => void calls.push('minimize'),
    isMaximized: () => state.maximized === true,
    maximize: () => void calls.push('maximize'),
    unmaximize: () => void calls.push('unmaximize'),
    isFullScreen: () => state.fullScreen === true,
    setFullScreen: (flag) => void calls.push(`setFullScreen(${String(flag)})`),
  }
  return { window, calls }
}

describe('one verb, one gesture', () => {
  it('close closes, minimise minimises', () => {
    const closing = fakeWindow()
    expect(applyWindowControl(closing.window, 'close')).toBe('closed')
    expect(closing.calls).toEqual(['close'])

    const minimising = fakeWindow()
    expect(applyWindowControl(minimising.window, 'minimize')).toBe('minimized')
    expect(minimising.calls).toEqual(['minimize'])
  })

  it('zoom has three answers, and they are three different screens', () => {
    const plain = fakeWindow()
    expect(applyWindowControl(plain.window, 'zoom')).toBe('maximized')
    expect(plain.calls).toEqual(['maximize'])

    const zoomed = fakeWindow({ maximized: true })
    expect(applyWindowControl(zoomed.window, 'zoom')).toBe('unmaximized')
    expect(zoomed.calls).toEqual(['unmaximize'])

    const full = fakeWindow({ fullScreen: true, maximized: true })
    expect(applyWindowControl(full.window, 'zoom')).toBe('left-full-screen')
    expect(full.calls).toEqual(['setFullScreen(false)'])
  })

  it('a window destroyed between the press and the handler is answered, not thrown at', () => {
    // Every method on a destroyed `BrowserWindow` throws, and the commonest way to be here is a
    // person pressing close twice.
    for (const control of WINDOW_CONTROLS) {
      const gone = fakeWindow({ destroyed: true })
      expect(applyWindowControl(gone.window, control)).toBe('gone')
      expect(gone.calls, `${control} touched a destroyed window`).toEqual([])
    }
  })

  it('every verb in the vocabulary has a branch, and nothing else is a verb', () => {
    for (const control of WINDOW_CONTROLS) {
      const effect: WindowControlEffect = applyWindowControl(fakeWindow().window, control)
      expect(effect, `${control} has no branch`).not.toBeUndefined()
      expect(effect).not.toBe('gone')
    }
    expect(isWindowControl('maximize')).toBe(false)
    expect(isWindowControl('minimise')).toBe(false) // the LABEL's spelling is not the wire's
    expect(isWindowControl(undefined)).toBe(false)
    expect(isWindowControl('close')).toBe(true)
  })
})

describe('the channel answers for the window that asked', () => {
  type Handler = (event: never, control: unknown) => WindowControlEffect

  /** Register against a recorder, and hand back the one handler that was registered. */
  function registered(ownerOf: () => ControllableWindow | null): Handler {
    const handlers = new Map<string, Handler>()
    registerWindowControls(
      {
        handle: (channel: string, listener: unknown): void =>
          void handlers.set(channel, listener as Handler),
      } as never,
      ownerOf as never,
    )
    const handler = handlers.get(WINDOW_CONTROL_CHANNEL)
    expect(handler, `nothing was registered on ${WINDOW_CONTROL_CHANNEL}`).toBeDefined()
    return handler as Handler
  }

  it('drives the sender’s own window', () => {
    const first = fakeWindow()
    const handler = registered(() => first.window)
    expect(handler(null as never, 'minimize')).toBe('minimized')
    expect(first.calls).toEqual(['minimize'])
  })

  it('a sender with no window is answered `gone`, not crashed into', () => {
    expect(registered(() => null)(null as never, 'close')).toBe('gone')
  })

  it('a verb outside the vocabulary is refused BY NAME, and nothing is touched', () => {
    const window = fakeWindow()
    const handler = registered(() => window.window)
    // The renderer is ours and the preload is the only thing that can reach this channel, so a bad
    // verb means the two sides have drifted. Doing the nearest thing would hide that for exactly as
    // long as nobody pressed the button.
    expect(() => handler(null as never, 'maximize')).toThrow(/not one of close, minimize, zoom/)
    expect(() => handler(null as never, { control: 'close' })).toThrow(/is not one of/)
    expect(window.calls).toEqual([])
  })
})

describe('the Window menu', () => {
  it('the three controls agree with the Window menu’s roles', () => {
    const roles = new Set(rolesIn(appMenuTemplate({ appName: 'BroBot', devTools: false })))
    for (const control of WINDOW_CONTROLS) {
      expect(roles.has(control), `the Window menu has no ${control} role`).toBe(true)
    }
  })
})

describe('the wire', () => {
  it('the vocabulary’s ORDER is the one the buttons are drawn in', () => {
    // It is macOS's own left-to-right order, and the component keeps no second list — so the order
    // on screen is this array. A reorder here reorders the window's controls.
    expect([...WINDOW_CONTROLS]).toEqual(['close', 'minimize', 'zoom'] satisfies WindowControl[])
  })
})
