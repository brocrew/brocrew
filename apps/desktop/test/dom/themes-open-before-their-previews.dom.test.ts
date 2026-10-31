import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ThemesSection from '../../src/renderer/src/components/ThemesSection.vue'
import type { ThemeReading, ThemeSnapshot, ThemesBridge } from '../../src/shared/theme-library'
import { mount, unmountAll } from './harness'

const frame = async (): Promise<void> => {
  await new Promise<void>((done) => requestAnimationFrame(() => done()))
  await nextTick()
}

function library() {
  const snapshot: ThemeSnapshot = {
    active: 'sample-0',
    requested: 'sample-0',
    themes: Array.from({ length: 200 }, (_, i) => ({
      id: `sample-${i}`,
      name: `Sample ${i}`,
      source: 'mine',
      status: 'ok',
    })),
  }
  let list!: (snapshot: ThemeSnapshot) => void
  const held: (() => void)[] = []
  let hold = true
  const read = vi.fn((id?: string): Promise<ThemeReading> => {
    const value: ThemeReading = {
      active: snapshot.active,
      version: null,
      assetVersions: {},
      theme: { format: 1, id: id!, name: id!, frame: { paper: '#17213a' } },
    }
    return hold ? new Promise((done) => held.push(() => done(value))) : Promise.resolve(value)
  })
  const themes: ThemesBridge = {
    list: () =>
      new Promise((done) => {
        list = done
      }),
    read,
    set: async (id) => ({ outcome: 'ok', active: id, previous: snapshot.active }),
    duplicate: async () => ({ outcome: 'refused', rail: 'theme-unknown', problems: [] }),
    delete: async () => ({ outcome: 'refused', rail: 'theme-unknown', problems: [] }),
    openFolder: async () => ({ outcome: 'ok' }),
    onChanged: () => () => {},
  }
  return {
    themes,
    read,
    list: () => list(snapshot),
    release: () => {
      hold = false
      for (const done of held.splice(0)) done()
    },
  }
}

afterEach(unmountAll)

describe('Themes opens before its previews', () => {
  it('shows loading content in the first frame while the list is still pending', async () => {
    const b = library()
    const m = mount(ThemesSection, { themes: b.themes }, { width: 900 })
    expect(m.q('themes-loading').getAttribute('role')).toBe('status')
    await frame()
    expect(m.q('themes-loading').getBoundingClientRect().height).toBeGreaterThan(0)
    expect(m.all('theme-card')).toHaveLength(0)
    expect(b.read).not.toHaveBeenCalled()
  })

  it('shows names before reads finish and hydrates only previews near the viewport', async () => {
    const b = library()
    const m = mount(ThemesSection, { themes: b.themes }, { width: 900 })
    b.list()
    await expect.poll(() => m.all('theme-card').length).toBe(200)
    expect(m.all('theme-name')[199]!.textContent).toBe('Sample 199')
    expect(m.host.querySelector('[data-cy="themes-loading"]')).toBeNull()
    expect(m.host.querySelectorAll('[data-theme-preview]')).toHaveLength(0)
    await expect.poll(() => b.read.mock.calls.length).toBe(4)
    b.release()
    await expect
      .poll(() => m.host.querySelectorAll('[data-theme-preview]').length)
      .toBeGreaterThan(0)
    for (let i = 0; i < 3; i++) await frame()
    const opened = m.host.querySelectorAll('[data-theme-preview]').length
    expect(opened).toBeLessThanOrEqual(12)
    expect(b.read.mock.calls.length).toBe(opened)
    expect(b.read).toHaveBeenCalledWith('sample-0', { refresh: false })
    m.all('theme-card')[199]!.scrollIntoView()
    await expect
      .poll(() => m.host.querySelector('[data-theme-preview="sample-199"]'))
      .not.toBeNull()
    expect(b.read.mock.calls.length).toBeLessThanOrEqual(24)
  })

  it('unmounting cancels queued work and late readings cannot recreate styles', async () => {
    const b = library()
    const m = mount(ThemesSection, { themes: b.themes }, { width: 900 })
    b.list()
    await expect.poll(() => b.read.mock.calls.length).toBe(4)
    m.unmount()
    b.release()
    await frame()
    expect(b.read).toHaveBeenCalledTimes(4)
    expect(document.querySelector('style[data-theme-previews]')).toBeNull()
  })
})
