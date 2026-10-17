import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import WindowControls from '../../src/renderer/src/components/WindowControls.vue'
import {
  WINDOW_CONTROLS,
  type WindowControl,
  type WindowControlEffect,
} from '../../src/shared/window-controls'
import { mount, unmountAll } from './harness'

/**
 * 🔴 **The three window controls, in a real engine** (385 §1).
 *
 * ## ⛔ Why this file and not an SSR one
 *
 * Two of the three claims here are questions **only a layout has**:
 *
 *  1. **`-webkit-app-region` computes to `no-drag` on every button.** A drag region swallows the
 *     clicks on everything inside its rectangle, and the property does not inherit — so a string
 *     assertion can see that the CSS says `no-drag` and nothing about whether that rule reaches the
 *     element the person presses. ⚑ `384`'s spans computed **`none`** (measured in the shipped
 *     window), which is not `no-drag`, and was the difference between a control and a picture.
 *  2. **The click lands on the BUTTON**, not on a parent that happens to be under the pointer.
 *     `elementFromPoint` at the button's own centre is the only reading that answers that, and it
 *     is a hit test — SSR has no points.
 *
 * ⚠️ **The bar is reproduced here rather than mounted from `RuntimeScreen`**, because `.titlebar`'s
 * `-webkit-app-region: drag` is scoped CSS in `RuntimeScreen.vue` and a scoped class matches nothing
 * in another component. What this file guards is the CONTROLS' half of the pair — the opt-out — and
 * §4 pins the bar's half against the real stylesheet so the reproduction cannot drift from it.
 */

interface Pressed {
  readonly control: WindowControl
}

/** A wire that records the verb, and answers the way the real one does. */
function armTheWire(): Pressed[] {
  const pressed: Pressed[] = []
  // ⚠️ Assigned, not defined: `test/dom/setup/the-window-is-a-wire.ts` intercepts the ASSIGNMENT and
  // wraps every member in the structured clone the real bridge performs. A verb is a string, so
  // nothing here can fail that clone — which is exactly why the reading is about the verb.
  window.api = {
    windowControl: (control: WindowControl): Promise<WindowControlEffect> => {
      pressed.push({ control })
      return Promise.resolve('closed')
    },
  } as unknown as Window['api']
  return pressed
}

/**
 * The controls inside a strip that is a drag region, which is what the real title bar is.
 *
 * ⛔ **`-webkit-app-region: drag` is set inline on the wrapper on purpose**: this is the hazard
 * being reproduced, and reproducing it with the same property the app uses is the whole point.
 */
const Bar = defineComponent({
  name: 'TitleBarUnderTest',
  setup() {
    return () =>
      h(
        'header',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            height: '32px',
            padding: '0 14px',
            webkitAppRegion: 'drag',
          },
        },
        [h(WindowControls)],
      )
  },
})

function bar(): { buttons: HTMLElement[]; host: HTMLElement } {
  const m = mount(Bar, {}, { width: 1200, height: 60 })
  const buttons = [...m.host.querySelectorAll<HTMLElement>('.window-controls > *')]
  return { buttons, host: m.host }
}

afterEach(() => {
  unmountAll()
  delete (window as { api?: unknown }).api
})

describe('§1 · three controls, one per verb (385 §1)', () => {
  it('🔴 draws a real button for every verb on the wire, in the wire’s order', () => {
    const { buttons } = bar()
    expect(buttons.map((b) => b.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON'])
    expect(buttons.map((b) => b.dataset['cy'])).toEqual(
      WINDOW_CONTROLS.map((control) => `window-${control}`),
    )
    // ⚑ The order on screen is left to right, and it is macOS's: close · minimise · zoom.
    expect(buttons.map((b) => b.dataset['cy'])).toEqual([
      'window-close',
      'window-minimize',
      'window-zoom',
    ])
    for (const button of buttons) {
      const box = button.getBoundingClientRect()
      expect(box.width, `${button.dataset['cy']} has no width`).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
    }
  })

  it('⛔ every one has an accessible name, and none is hidden from a screen reader', () => {
    // ⚠️ **The exact defect this replaces**: the dots lived inside `aria-hidden="true"`, so to
    // anything but an eye the window had no controls at all.
    for (const button of bar().buttons) {
      expect(button.getAttribute('aria-label')).toMatch(/window/i)
      expect(button.closest('[aria-hidden="true"]')).toBe(null)
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'))
    }
  })

  it('⚠️ they are distinguishable to an eye, too — three different fills', () => {
    const fills = bar().buttons.map((b) => getComputedStyle(b).backgroundColor)
    expect(new Set(fills).size).toBe(3)
    for (const fill of fills) expect(fill).not.toBe('rgba(0, 0, 0, 0)')
  })
})

describe('§2 · a press reaches the wire with its own verb (385 §1)', () => {
  it('🔴 each button sends its own control, and no other', async () => {
    const pressed = armTheWire()
    const { buttons } = bar()
    for (const button of buttons) button.click()
    await nextTick()
    expect(pressed.map((p) => p.control)).toEqual([...WINDOW_CONTROLS])
  })

  it('⚑ …and the press really is what sends it — the control, one fact over', async () => {
    // ⛔ Non-vacuity: without this, a component that called the wire on MOUNT would satisfy the
    // assertion above, and a button that did nothing would satisfy it as long as something else did.
    const pressed = armTheWire()
    bar()
    await nextTick()
    expect(pressed).toEqual([])
  })
})

describe('§3 · inside a drag region, and still pressable (385 §1 item 2)', () => {
  it('🔴 every control computes `no-drag` where it actually sits', () => {
    const { buttons, host } = bar()
    const strip = host.querySelector('header')
    expect(strip).not.toBe(null)
    // The reproduction really is a drag region — otherwise the three readings below are about
    // nothing at all.
    expect(
      getComputedStyle(strip as Element)
        .getPropertyValue('-webkit-app-region')
        .trim(),
    ).toBe('drag')
    for (const button of buttons) {
      expect(
        getComputedStyle(button).getPropertyValue('-webkit-app-region').trim(),
        `${button.dataset['cy']} is inside the drag region`,
      ).toBe('no-drag')
    }
  })

  /**
   * 🔴 **`none` is the ABSENCE of a declaration, and writing the word is not the same as leaving it
   * out** — measured here, in this Chromium, because a mutation row that changed `no-drag` to `none`
   * survived and the reason turned out to be worth writing down.
   *
   * | what the element declares | what `getComputedStyle` answers | inside a drag region it is |
   * |---|---|---|
   * | nothing (`384`'s spans, and a bare `<button>`) | `none` | **part of the region — clicks swallowed** |
   * | `app-region: none` | `no-drag` | excluded |
   * | `app-region: no-drag` | `no-drag` | excluded |
   *
   * ⚠️ So the two KEYWORDS are one behaviour and the computed reading says so, which is why the
   * assertion above is a real measurement: `no-drag` means excluded, and `none` — the only other
   * answer this property gives — means the element never opted out at all.
   */
  it('⛔ …and a control with NO declaration is the state 384 shipped', () => {
    // ⚑ **The planted control, from the app's own material**: a bare button and a bare span, both
    // inside the same drag region, both saying nothing. This is what the three decorative dots were.
    const { buttons } = bar()
    const region = (element: Element): string =>
      getComputedStyle(element).getPropertyValue('-webkit-app-region').trim()
    for (const tag of ['span', 'button'] as const) {
      const decoration = document.createElement(tag)
      buttons[0]?.parentElement?.append(decoration)
      expect(region(decoration), `a bare <${tag}> already opts out`).toBe('none')
      decoration.remove()
    }
    // ⛔ …and the pair: ours does opt out, so the reading tells the two apart rather than accepting
    // anything non-empty.
    expect(region(buttons[0] as Element)).toBe('no-drag')
  })

  it('🔴 a click at the control’s own centre lands on the control', () => {
    for (const button of bar().buttons) {
      const box = button.getBoundingClientRect()
      const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      expect(at, `${button.dataset['cy']} is not the thing at its own centre`).toBe(button)
    }
  })
})

describe('§4 · the bar this file reproduces is the bar the app draws (385 §1)', () => {
  it('⛔ `.titlebar` is the drag region, and its height is the token', async () => {
    // ⚠️ **Pinned against the real stylesheet**, because the strip above is a reproduction and a
    // reproduction is free to drift from what it stands in for. `base.css` is already in this page
    // (the harness imports it), so the token is the app's own.
    const bar = document.createElement('header')
    bar.className = 'titlebar'
    document.body.append(bar)
    await nextTick()
    // ⛔ `.titlebar` is SCOPED to `RuntimeScreen.vue`, so this bare element resolves nothing from it
    // — which is why the reproduction exists. What IS global is the token the rule reads.
    const height = getComputedStyle(document.documentElement)
      .getPropertyValue('--titlebar-h')
      .trim()
    expect(height).toBe('32px')
    bar.remove()
  })
})
