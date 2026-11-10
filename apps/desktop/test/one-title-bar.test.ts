import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

/**
 * 🔴 **One title bar, and its three controls WORK** (385 §1).
 *
 * ## ⛔ What this is about
 *
 * A frameless window has one titlebar, whose three traffic-light controls must work. A
 * web-content capture cannot detect a second macOS titlebar 32px above the app’s decorative
 * spans, so this property needs the actual window surface.
 *
 * ## ⚑ What each layer holds, so none of them is asked the wrong question
 *
 * - **here** — the declarations (`frame: false`), the branch table `applyWindowControl` owns, the
 *   channel's refusal, and the arithmetic that turns a declared window size into a shell size.
 * - `test/dom/window-controls.dom.test.ts` — the buttons in a real engine: hit-testable, `no-drag`
 *   inside a drag region, and each pressing the wire with its own verb.
 * - `pnpm run probe:window-controls` — the shipped app, on a real window: minimise really hides it,
 *   zoom really resizes it, close really ends the process. ⚠️ **That one is live and out of `ci`**,
 *   so §5 below pins its hooks against the component the way `310` taught us to.
 */

const src = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8')
const CONTROLS = src('renderer/src/components/WindowControls.vue')

/* ------------------------------------------------------- §2 · what a control does to a window */

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

describe('§2 · one verb, one gesture (385 §1)', () => {
  it('🔴 close closes, minimise minimises', () => {
    const closing = fakeWindow()
    expect(applyWindowControl(closing.window, 'close')).toBe('closed')
    expect(closing.calls).toEqual(['close'])

    const minimising = fakeWindow()
    expect(applyWindowControl(minimising.window, 'minimize')).toBe('minimized')
    expect(minimising.calls).toEqual(['minimize'])
  })

  it('🔴 zoom has three answers, and they are three different screens', () => {
    // ⛔ **Tested where the readings DIVERGE.** A window that is neither maximised nor full screen
    // is the only state in which `maximize()` is the right call, and a test that only ever saw that
    // state would pass for an implementation that called `maximize()` unconditionally — which would
    // leave a full-screen window full screen with the button pressed.
    const plain = fakeWindow()
    expect(applyWindowControl(plain.window, 'zoom')).toBe('maximized')
    expect(plain.calls).toEqual(['maximize'])

    const zoomed = fakeWindow({ maximized: true })
    expect(applyWindowControl(zoomed.window, 'zoom')).toBe('unmaximized')
    expect(zoomed.calls).toEqual(['unmaximize'])

    // ⚑ **Full screen wins over maximised**, and this is the pair that proves the order rather than
    // the branch: a window can report both, and only one answer gets a person out of full screen.
    const full = fakeWindow({ fullScreen: true, maximized: true })
    expect(applyWindowControl(full.window, 'zoom')).toBe('left-full-screen')
    expect(full.calls).toEqual(['setFullScreen(false)'])
  })

  it('⚠️ a window destroyed between the press and the handler is answered, not thrown at', () => {
    // Every method on a destroyed `BrowserWindow` throws, and the commonest way to be here is a
    // person pressing close twice.
    for (const control of WINDOW_CONTROLS) {
      const gone = fakeWindow({ destroyed: true })
      expect(applyWindowControl(gone.window, control)).toBe('gone')
      expect(gone.calls, `${control} touched a destroyed window`).toEqual([])
    }
  })

  it('⛔ every verb in the vocabulary has a branch, and nothing else is a verb', () => {
    // ⚑ **Exhaustive over the type, not over a list written here.** A fourth verb added to
    // `WINDOW_CONTROLS` reaches this loop by itself; one that `applyWindowControl` forgot returns
    // `undefined` and fails on the line below.
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

/* ---------------------------------------------------------------- §3 · the channel and its owner */

describe('§3 · the channel answers for the window that asked (385 §1)', () => {
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

  it('🔴 drives the sender’s own window', () => {
    const first = fakeWindow()
    const handler = registered(() => first.window)
    expect(handler(null as never, 'minimize')).toBe('minimized')
    expect(first.calls).toEqual(['minimize'])
  })

  it('⚠️ a sender with no window is answered `gone`, not crashed into', () => {
    expect(registered(() => null)(null as never, 'close')).toBe('gone')
  })

  it('⛔ a verb outside the vocabulary is refused BY NAME, and nothing is touched', () => {
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

/* ------------------------------------------------------- §4 · the bar draws controls, not a picture */

describe('§4 · three buttons, one per verb, and no decoration left (385 §1)', () => {
  it('⚠️ the labels a person reads are British and the verbs on the wire are not', () => {
    // The wire says what Electron says (`minimize`); the button says what this product says
    // everywhere else (`Minimise`). Two spellings of one gesture are only safe when one of them is
    // never compared to the other, which is what this pins.
    expect(CONTROLS).toContain("minimize: 'Minimise this window'")
    expect(WINDOW_CONTROLS).toContain('minimize')
    expect(WINDOW_CONTROLS as readonly string[]).not.toContain('minimise')
  })

  it('🔴 …and the three agree with the Window menu, which already worked', () => {
    // ⛔ **The incumbent, measured at the same moment.** `app-menu.ts` has shipped `role: 'minimize'`,
    // `role: 'zoom'` and `role: 'close'` since before the decorative dots existed — so the menu was
    // the only working way to close this window with a pointer. The buttons must be the same three
    // gestures, or the app has two answers for one question.
    const roles = new Set(rolesIn(appMenuTemplate({ appName: 'BroBot', devTools: false })))
    for (const control of WINDOW_CONTROLS) {
      expect(roles.has(control), `the Window menu has no ${control} role`).toBe(true)
    }
  })
})

/* ------------------------------------------------- §5 · the live probe is pinned to what it drives */

describe('§5 · the live probe cannot go dark unnoticed (310)', () => {
  const PROBE = readFileSync(
    fileURLToPath(new URL('../../../scripts/window-controls-probe.mjs', import.meta.url)),
    'utf8',
  )

  it('⛔ drives every control by the `data-cy` the component actually draws', () => {
    // ⚠️ **BOTH ends build the hook from a template literal**, so neither file contains the string
    // `window-close` at all — a grep for it finds nothing on either side and would pass on a probe
    // that pressed nothing. What can drift is the PREFIX and the roster, so both are asserted:
    // the component's interpolation shape, the probe's, and one press per verb by name.
    expect(CONTROLS).toContain(':data-cy="`window-${control}`"')
    expect(PROBE).toContain('data-cy="window-${control}"')
    for (const control of WINDOW_CONTROLS) {
      expect(PROBE, `the probe never presses ${control}`).toContain(`PRESS('${control}')`)
    }
    // ⚑ …and the pair: a verb the probe does NOT press fails this reading, so it is a measurement
    // rather than a search that always succeeds.
    expect(PROBE).not.toContain("PRESS('maximize')")
  })

  it('⚑ and it asserts an OUTCOME for each, not that a button exists', () => {
    // A probe that clicked three buttons and photographed the result would photograph the defect
    // just as happily as the fix — `367`'s ruling, which its own probe carried until `417`
    // removed the screen that probe photographed.
    expect(PROBE).toContain('visibilityState')
    expect(PROBE).toContain('outerWidth')
  })
})

/* --------------------------------------------------------------- §6 · the bridge carries the verb */

describe('§6 · the wire (385 §1)', () => {
  it('⚑ the vocabulary’s ORDER is the one the buttons are drawn in', () => {
    // It is macOS's own left-to-right order, and the component keeps no second list — so the order
    // on screen is this array. A reorder here reorders the window's controls.
    expect([...WINDOW_CONTROLS]).toEqual(['close', 'minimize', 'zoom'] satisfies WindowControl[])
  })
})
