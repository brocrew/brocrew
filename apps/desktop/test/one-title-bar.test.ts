import { readdirSync, readFileSync } from 'node:fs'
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

const withoutComments = (code: string): string =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')

const MAIN = withoutComments(src('main/index.ts'))
const TOKENS = src('renderer/src/assets/tokens.css')
const RUNTIME_SCREEN = src('renderer/src/components/RuntimeScreen.vue')
/** ⚑ **389 §2 moved the bar out of `RuntimeScreen` so a DOM test could mount it.** Same markup. */
const TITLE_BAR = src('renderer/src/components/AppTitleBar.vue')
const CONTROLS = src('renderer/src/components/WindowControls.vue')

/**
 * Every component in the renderer, **with its prose stripped**, so a census here is over the tree and
 * not over one file.
 *
 * ⛔ **The stripping is not tidiness and this file went red without it.** `WindowControls.vue`'s own
 * docblock explains that the three decorative `<span>`s it replaced lived in a
 * `class="traffic-lights"` wrapper — so a search over the raw text reports the component that ENDED
 * the defect as carrying it. `RuntimeScreen.vue` had the same shape for the drag region. A source
 * census that reads prose reads code wrong; what is left here is markup, expressions and literals,
 * which is where a second title bar would actually have to be written.
 */
function everyComponent(): { name: string; source: string }[] {
  const dir = fileURLToPath(new URL('../src/renderer/src/components', import.meta.url))
  return readdirSync(dir)
    .filter((name) => name.endsWith('.vue'))
    .map((name) => ({ name, source: withoutProse(src(`renderer/src/components/${name}`)) }))
}

/** Block, line and HTML comments removed; everything a compiler would keep, kept. */
function withoutProse(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The `new BrowserWindow({…})` options object, and nothing around it. */
function windowOptions(): string {
  const at = MAIN.indexOf('new BrowserWindow({')
  expect(
    at,
    'main/index.ts no longer constructs a BrowserWindow the way this reads it',
  ).toBeGreaterThan(-1)
  const open = MAIN.indexOf('{', at)
  let depth = 0
  for (let index = open; index < MAIN.length; index += 1) {
    if (MAIN[index] === '{') depth += 1
    if (MAIN[index] === '}') {
      depth -= 1
      if (depth === 0) return MAIN.slice(open + 1, index)
    }
  }
  throw new Error('the BrowserWindow options never close')
}

/* --------------------------------------------------------------- §1 · the window has no frame */

describe('§1 · the window draws its own bar, and only its own (385 §1)', () => {
  it('🔴 is frameless', () => {
    expect(windowOptions()).toMatch(/(^|\s)frame:\s*false/)
  })

  it('⚑ the reader really can see the options — the control, one fact over', () => {
    // ⛔ Non-vacuity for the negative below AND for the positive above: a brace walker that stopped
    // early, a rename, or a comment-stripper that ate the object would all produce a slice that
    // matches nothing, and `not.toMatch` passes on an empty string.
    const options = windowOptions()
    expect(options).toMatch(/(^|\s)width:\s*1200/)
    expect(options).toMatch(/(^|\s)height:\s*840/)
    expect(options).toMatch(/(^|\s)title:\s*'BroCrew'/)
  })

  it('⛔ and takes none of the half-measures, which each leave a second bar or a second set of lights', () => {
    const options = windowOptions()
    // `titleBarStyle: 'hiddenInset'` is the real alternative and it is a DIFFERENT product decision:
    // it keeps macOS's own traffic lights and insets them into our bar. It would also mean the dots
    // this app draws are a duplicate set. Frameless is what was ruled; this says so in code rather
    // than in a response document.
    for (const half of ['titleBarStyle', 'titleBarOverlay', 'trafficLightPosition']) {
      expect(options, `${half} is set as well as frame: false`).not.toMatch(
        new RegExp(`(^|\\s)${half}:`),
      )
    }
  })

  it('⛔ the controls are wired to the SENDER’s window, never to a captured one', () => {
    // ⚠️ **§3 below exercises `registerWindowControls` through an injected `ownerOf`**, which is what
    // makes its five outcomes assertable — and which means nothing there can see what the
    // composition root actually passes. This is that line, and it is the only place it exists.
    // ⛔ `BrowserWindow.getAllWindows()[0]` would pass every test in this file and move the wrong
    // window the day there are two.
    const at = MAIN.indexOf('registerWindowControls(')
    expect(at, 'main/index.ts never registers the window controls').toBeGreaterThan(-1)
    const call = MAIN.slice(at, MAIN.indexOf(')\n', at))
    expect(call).toContain('BrowserWindow.fromWebContents(event.sender)')
    expect(call).not.toContain('getAllWindows')
  })

  it('⚠️ 840 declared − a 32px bar = the 1200 × 808 shell 381 measured v2.3 assuming', () => {
    // ⛔ **Measured before and after on a real window** (385): `outerHeight` is 840 either way — it
    // is what the option declares — and `innerHeight` went 808 → 840 when the frame came off. So
    // the OS bar took exactly 32, and a 32px bar of our own puts the shell back where it was while
    // removing the second one.
    const declaredHeight = /(^|\s)height:\s*(\d+)/.exec(windowOptions())?.[2]
    const barHeight = /--titlebar-h:\s*(\d+)px/.exec(TOKENS)?.[1]
    expect(declaredHeight).toBe('840')
    expect(barHeight).toBe('32')
    expect(Number(declaredHeight) - Number(barHeight)).toBe(808)
  })
})

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
  it('🔴 the titlebar mounts the controls, and the dots that did nothing are gone', () => {
    // ⚑ **The bar moved to its own component in 389 §2 and the controls moved with it.** The frame
    // still mounts exactly one bar, and the bar still mounts the controls — two links instead of
    // one, and the census below is what makes the pair a chain rather than two loose facts.
    expect(RUNTIME_SCREEN).toContain('<AppTitleBar :info="info" :error="infoError" />')
    expect(RUNTIME_SCREEN).toContain("import AppTitleBar from './AppTitleBar.vue'")
    expect(TITLE_BAR).toContain('<WindowControls />')
    expect(TITLE_BAR).toContain("import WindowControls from './WindowControls.vue'")
    // ⛔ **The exact markup that was there**, so this cannot pass on a build where it came back
    // under another name: an `aria-hidden` div of bare spans coloured like traffic lights.
    for (const { name, source } of everyComponent()) {
      expect(source, `${name} draws the decorative dots again`).not.toContain(
        'class="traffic-lights"',
      )
      expect(source, `${name} draws bare spans inside an aria-hidden wrapper`).not.toMatch(
        /aria-hidden="true"><span \/>/,
      )
    }
  })

  it('⛔ …and ONE component in the whole tree mounts them — 386’s warning, as a census', () => {
    // 🔴 **`386` warned that keeping both bars recreates the double-title-bar defect we removed**,
    // and `389 §2` asks for the absence with a search shape rather than an impression. This is the
    // shape: every `.vue` in the renderer, asked which ones IMPORT the controls — the import and
    // not the mention, because a name in a comment is not a second bar and a component that draws
    // `<WindowControls />` without importing it does not compile.
    const mounts = everyComponent().filter(({ source }) =>
      source.includes("from './WindowControls.vue'"),
    )
    expect(mounts.map(({ name }) => name)).toEqual(['AppTitleBar.vue'])
    // ⚑ **The control, one fact over**: the search shape CAN find an import when there is one, so
    // the single-name list above is a reading rather than a pattern that matches nothing.
    expect(
      everyComponent().filter(({ source }) => source.includes("from './IconSprite.vue'")).length,
    ).toBeGreaterThan(0)
    // ⛔ …and exactly one component declares the drag region, which is the other half of "one bar":
    // a second strip that was draggable would be a title bar whatever it called itself.
    const regions = everyComponent().filter(({ source }) =>
      / {2}-webkit-app-region: drag;/.test(source),
    )
    expect(regions.map(({ name }) => name)).toEqual(['AppTitleBar.vue'])
  })

  it('⛔ every control is a real button with an accessible name, and the roster IS the vocabulary', () => {
    // ⚑ **One list, iterated** — see the component: a second list is a second opinion about which
    // controls exist, and both of its failure modes are silent.
    expect(CONTROLS).toContain('const controls: readonly WindowControl[] = WINDOW_CONTROLS')
    expect(CONTROLS).toMatch(/<button\b[\s\S]*v-for="control in controls"/)
    expect(CONTROLS).toContain(':aria-label="LABEL[control]"')
    expect(CONTROLS).toContain('type="button"')
    // …and the labels are exhaustive by type, so a verb cannot arrive unlabelled.
    expect(CONTROLS).toContain('const LABEL: Record<WindowControl, string>')
    for (const [control, label] of [
      ['close', 'Close this window'],
      ['minimize', 'Minimise this window'],
      ['zoom', 'Zoom this window'],
    ] as const) {
      expect(CONTROLS).toContain(`${control}: '${label}',`)
    }
  })

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
  it('⛔ the preload exposes exactly one window-control member, and it invokes', () => {
    const preload = withoutComments(src('preload/index.ts'))
    expect(preload).toContain('windowControl: (control: WindowControl)')
    expect(preload).toContain('ipcRenderer.invoke(WINDOW_CONTROL_CHANNEL, control)')
    // 🔒 The channel name is imported from the contract, never retyped — a second spelling of a
    // channel is a handler nobody reaches.
    expect(preload).not.toContain("invoke('app:window-control'")
  })

  it('⚠️ the contract lives in `shared/`, where a sandboxed preload can reach it', () => {
    const contract = src('shared/window-controls.ts')
    expect(contract).not.toMatch(/from 'electron'/)
    expect(src('preload/index.ts')).toContain("} from '../shared/window-controls'")
  })

  it('⚑ the vocabulary’s ORDER is the one the buttons are drawn in', () => {
    // It is macOS's own left-to-right order, and the component keeps no second list — so the order
    // on screen is this array. A reorder here reorders the window's controls.
    expect([...WINDOW_CONTROLS]).toEqual(['close', 'minimize', 'zoom'] satisfies WindowControl[])
  })
})
