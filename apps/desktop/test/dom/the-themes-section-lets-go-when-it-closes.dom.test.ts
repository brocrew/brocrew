import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ThemesSection from '../../src/renderer/src/components/ThemesSection.vue'
import type {
  ThemeReading,
  ThemeSet,
  ThemeSnapshot,
  ThemesBridge,
} from '../../src/shared/theme-library'
import { mount, unmountAll } from './harness'

/**
 * A Themes section that is closed while the host is still answering: nothing that arrives late
 * touches it, recreates its stylesheet, overwrites another section's, or starts another read.
 */

const SNAPSHOT: ThemeSnapshot = {
  active: 'classic',
  requested: 'classic',
  themes: [
    { id: 'classic', name: 'Classic', source: 'built-in', status: 'ok' },
    { id: 'zen', name: 'Zen', source: 'built-in', status: 'ok' },
  ],
}
const ZEN: ThemeReading = {
  active: 'classic',
  theme: { format: 1, id: 'zen', name: 'Zen', frame: { paper: '#17213a' } },
  version: null,
  assetVersions: {},
}
const LATE: ThemeReading = { ...ZEN, theme: { ...ZEN.theme!, frame: { paper: '#ff0000' } } }

/** A bridge whose answers wait until the test releases them, or come at once when `held` is off. */
function heldBridge(zen: ThemeReading = ZEN) {
  let held = true
  const waiting: (() => void)[] = []
  const counts = { list: 0, read: 0, set: 0 }
  const answer = <T>(value: () => T): Promise<T> =>
    held ? new Promise((done) => waiting.push(() => done(value()))) : Promise.resolve(value())
  const themes: ThemesBridge = {
    list: () => (counts.list++, answer(() => SNAPSHOT)),
    read: (id?: string) =>
      (counts.read++, answer(() => (id === 'zen' ? zen : { ...ZEN, theme: null }))) as ReturnType<
        ThemesBridge['read']
      >,
    set: (id: string) => (
      counts.set++,
      answer((): ThemeSet => ({ outcome: 'ok', active: id, previous: 'classic' }))
    ),
    duplicate: async () => ({ outcome: 'refused', rail: 'theme-unknown', problems: [] }),
    delete: async () => ({ outcome: 'refused', rail: 'theme-unknown', problems: [] }),
    openFolder: async () => ({ outcome: 'ok' }),
    onChanged: () => () => undefined,
  }
  return {
    themes,
    counts,
    release: async () => {
      while (waiting.length) waiting.shift()!()
      await settle()
    },
    answerAtOnce: () => void (held = false),
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
const previewSheets = (): HTMLStyleElement[] => [
  ...document.querySelectorAll<HTMLStyleElement>('style[data-theme-previews]'),
]

afterEach(unmountAll)

describe('a Themes section lets go when it closes', () => {
  it('while open, it owns one stylesheet with its cards’ previews', async () => {
    const b = heldBridge()
    mount(ThemesSection, { themes: b.themes }, { width: 900 })
    await b.release()
    await b.release()
    expect(previewSheets()).toHaveLength(1)
    expect(previewSheets()[0]!.textContent).toContain("[data-theme-preview='zen']")
  })

  it('a list read answered after it closed leaves no stylesheet and starts no read', async () => {
    const b = heldBridge()
    const m = mount(ThemesSection, { themes: b.themes }, { width: 900 })
    m.unmount()
    expect(previewSheets()).toHaveLength(0)
    await b.release()
    await b.release()
    expect(previewSheets()).toHaveLength(0)
    expect(b.counts).toMatchObject({ list: 1, read: 0 })
  })

  it('a card read answered after it closed never touches the section that replaced it', async () => {
    const first = heldBridge(LATE)
    const m = mount(ThemesSection, { themes: first.themes }, { width: 900 })
    while (first.counts.read === 0) await first.release()
    m.unmount()
    const second = heldBridge()
    second.answerAtOnce()
    mount(ThemesSection, { themes: second.themes }, { width: 900 })
    await settle()
    const before = previewSheets().map((s) => s.textContent)
    expect(before).toHaveLength(1)
    await first.release()
    expect(previewSheets().map((s) => s.textContent)).toEqual(before)
    expect(before[0]).not.toContain('#ff0000')
  })

  it('an action that finishes after it closed starts nothing', async () => {
    const b = heldBridge()
    const m = mount(ThemesSection, { themes: b.themes }, { width: 900 })
    await b.release()
    await b.release()
    m.host.querySelector<HTMLElement>('[data-theme-id="zen"] [data-cy="theme-use"]')!.click()
    await settle()
    const lists = b.counts.list
    m.unmount()
    await b.release()
    expect(b.counts.set).toBe(1)
    expect(b.counts.list).toBe(lists)
    expect(previewSheets()).toHaveLength(0)
  })
})
