import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ThemesSection from '../../src/renderer/src/components/ThemesSection.vue'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { previewCss } from '../../src/renderer/src/lib/theme-previews'
import type { ThemeReading, ThemesBridge } from '../../src/shared/theme-library'
import { THEME_CUSTOM_PROPERTIES } from '../../src/shared/themes/css'
import { overridableIn } from '../../src/shared/themes/schema'
import type { Theme } from '../../src/shared/themes/theme'
import { mount, unmountAll } from './harness'

/**
 * A card's preview shows its own theme, whatever the window wears: a window theme that only tunes
 * colour tokens by hand reaches neither Classic's card, a sparse theme's nor one with tokens of its
 * own, and the window keeps its own tokens.
 */

const SPARSE: Theme = { format: 1, id: 'sparse', name: 'Sparse' }
const TUNED: Theme = {
  format: 1,
  id: 'tuned',
  name: 'Tuned',
  tokens: { frame: { bg: '#0000aa' }, content: { panel: '#00aa00' } },
}
const WINDOW: Theme = {
  format: 1,
  id: 'loud',
  name: 'Loud',
  tokens: {
    frame: { bg: '#ff00ff', 'chrome-text': '#00ff00', accent: '#00ffff', text: '#ff8800' },
    content: {
      panel: '#ffff00',
      text: '#ff8800',
      'chat-bg': '#880088',
      line: '#00aa00',
      accent: '#00ffff',
    },
  },
}

const QUIET: Theme = {
  format: 1,
  id: 'quiet',
  name: 'Quiet',
  frame: { paper: '#303030', accent: '#909090' },
  tokens: {
    frame: { bg: '#202020', panel: '#252525' },
    content: { 'chat-bg': '#eeeeee', panel: '#dddddd' },
  },
}

function bridge(): ThemesBridge {
  const themes: Record<string, Theme | null> = { classic: null, sparse: SPARSE, tuned: TUNED }
  return {
    list: async () => ({
      active: 'classic',
      requested: 'classic',
      themes: Object.keys(themes).map((id) => ({
        id,
        name: id,
        source: 'mine' as const,
        status: 'ok' as const,
      })),
    }),
    read: async (id?: string): Promise<ThemeReading> => ({
      active: 'classic',
      theme: themes[id ?? 'classic'] ?? null,
      version: null,
      assetVersions: {},
    }),
    set: async () => ({ outcome: 'refused', rail: 'theme-unknown', problems: [] }),
    duplicate: async () => ({ outcome: 'refused', rail: 'theme-unknown', problems: [] }),
    delete: async () => ({ outcome: 'refused', rail: 'theme-unknown', problems: [] }),
    openFolder: async () => ({ outcome: 'ok' }),
    onChanged: () => () => undefined,
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await new Promise((done) => setTimeout(done, 0))
    await nextTick()
  }
  // IntersectionObserver delivers visible cards after layout.
  for (let i = 0; i < 2; i++) {
    await new Promise<void>((done) => requestAnimationFrame(() => done()))
    await nextTick()
  }
}

/** The painted colours of one card's preview, inside the light scope as on the Providers screen. */
async function cardColours(): Promise<Record<string, Record<string, string>>> {
  const m = mount(ThemesSection, { themes: bridge() }, { width: 900 })
  m.host.setAttribute('data-chat-theme', 'light')
  await settle()
  const out: Record<string, Record<string, string>> = {}
  for (const id of ['classic', 'sparse', 'tuned']) {
    const at = (part: string): string =>
      getComputedStyle(m.host.querySelector(`[data-theme-id="${id}"] ${part}`)!).backgroundColor
    out[id] = {
      bar: at('.mini-bar'),
      rail: at('.mini-rail'),
      on: at('.mini-rail i.on'),
      pane: at('.mini-pane'),
      bubble: at('.mini-bubble'),
      line: at('.mini-line'),
    }
  }
  m.unmount()
  return out
}

/** Classic's frame colour, read from the token file rather than restated, so a new palette moves both. */
function classicFrame(): string {
  const probe = document.createElement('div')
  probe.style.backgroundColor = 'var(--bg)'
  document.body.append(probe)
  const colour = getComputedStyle(probe).backgroundColor
  probe.remove()
  return colour
}

afterEach(() => {
  applyTheme(null)
  unmountAll()
})

describe('a theme preview shows its own theme', () => {
  it('each block puts back every setting and every hand-tunable token before its own', () => {
    const css = previewCss('classic', null)
    const [frame, content] = css.split(
      "[data-theme-preview='classic'] [data-preview-zone='content'] {",
    )
    for (const name of THEME_CUSTOM_PROPERTIES) expect(frame).toContain(`  ${name}: initial;`)
    for (const name of overridableIn('content')) {
      expect(frame).toMatch(new RegExp(`^  --${name}: `, 'm'))
      expect(content).toMatch(new RegExp(`^  --${name}: `, 'm'))
    }
  })

  it('under two different window themes, every card paints as it does with no theme', async () => {
    const frame = classicFrame()
    const plain = await cardColours()
    for (const worn of [WINDOW, QUIET]) {
      applyTheme(worn)
      expect(await cardColours(), worn.id).toEqual(plain)
    }
    // The app’s own look, not a blank: the frame in Classic's own ground, the conversation on paper.
    expect(plain.classic!.rail).toBe(frame)
    expect(plain.classic!.bar).toBe(frame)
    expect(plain.classic!.bubble).toBe('rgb(255, 255, 255)')
    // A theme that sets nothing is painted as the window paints it: its frame and its page from the
    // default settings, not Classic's.
    expect(plain.sparse!.rail).toBe('rgb(24, 33, 53)')
    expect(plain.sparse!.bar).toBe('rgb(24, 33, 53)')
    expect(plain.sparse!.pane).not.toBe(plain.classic!.pane)
    expect(plain.sparse!.bubble).toBe(plain.classic!.bubble)
  })

  it('a card’s own tokens still show, and the window keeps its own', async () => {
    applyTheme(WINDOW)
    const worn = await cardColours()
    // A hand-tuned `bg` is a token the window's frame surfaces don't paint, so the card doesn't.
    expect(worn.tuned!.rail).toBe('rgb(24, 33, 53)')
    expect(worn.tuned!.bubble).toBe('rgb(0, 170, 0)')
    expect(worn.classic!.bubble).not.toBe('rgb(0, 170, 0)')
    expect(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()).toBe(
      '#ff00ff',
    )
  })
})
