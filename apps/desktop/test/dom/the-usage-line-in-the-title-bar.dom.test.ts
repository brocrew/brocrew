import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { nextTick } from 'vue'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { ProviderUsageReading } from '../../src/shared/runtime-ipc'
import { conv, forestOf } from './forest-fixture'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * The window's usage on one line in its title bar, for every screen: each provider's windows, the
 * agents running and their memory. A press opens the usage cards under it; Escape closes them.
 * Fictional readings only.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const HOUR = 3_600_000

afterEach(async () => {
  unmountAll()
  delete (window as { api?: unknown }).api
  const cast = useWhoCalledWhom()
  cast.runningConversations.value = null
  cast.forest.value = null
  cast.processMemory.value = new Map()
  cast.memoryUnmeasured.value = null
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

type Usage = Record<'claude' | 'codex', ProviderUsageReading[]>

async function bar(usage: Usage): Promise<Mounted> {
  ;(window as { api?: unknown }).api = {
    runtime: {
      providerUsage: () => Promise.resolve(usage),
      onProvidersChanged: () => () => {},
    },
  }
  await page.viewport(1180, 840)
  const m = mount(AppTitleBar, { info: null, error: null }, { width: 1180, height: 32 })
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
  return m
}

const READ: Usage = (() => {
  const now = Date.now()
  return {
    claude: [
      { window: 'five_hour', usedPercent: 28, resetsAt: now + 3 * HOUR, at: now - 60_000 },
      { window: 'seven_day', usedPercent: 61.4, resetsAt: now + 48 * HOUR, at: now - 60_000 },
    ],
    codex: [{ window: 'a 7-day window', usedPercent: 35, resetsAt: now + 96 * HOUR, at: now }],
  }
})()

describe('the usage line', () => {
  it('🔴 says each window’s use, then the agents and their memory, with the same words as its name', async () => {
    const cast = useWhoCalledWhom()
    cast.runningConversations.value = [
      { sessionId: 'sess_a', provider: 'claude', state: { is: 'active' } },
      { sessionId: 'sess_b', provider: 'codex', state: { is: 'idle' } },
    ]
    cast.forest.value = forestOf([
      conv('sess_a', null, { running: 'in-a-window' }),
      conv('sess_b', 'sess_a', { running: 'unwatched', provider: 'codex' }),
      conv('sess_c', 'sess_a', { running: 'not-running' }),
    ])
    cast.processMemory.value = new Map([
      ['sess_a', 600 * 1024 * 1024],
      ['sess_b', 700 * 1024 * 1024],
    ])
    const m = await bar(READ)
    const line = m.q('app-usage')
    const said = (line.textContent ?? '').trim()
    expect(said).toBe('Claude 5h 28% · week 61% · Codex week 35% · 2 agents · 1 working · 1.3 GB')
    // Short cells retain full plain usage sentences for hover and accessibility.
    expect(line.getAttribute('aria-label')).toBe(line.title)
    expect(line.title).toContain('Claude 5-hour usage: 28% used')
    expect(line.title).toContain('Claude weekly usage: 61% used')
    expect(line.title).toContain('Codex weekly usage: 35% used')
  })

  it('⚑ before anything is read it says so with a question mark, and keeps every window', async () => {
    const m = await bar({ claude: [], codex: [] })
    expect((m.q('app-usage').textContent ?? '').trim()).toBe(
      'Claude 5h ? · week ? · Codex week ? · ? agents · ?',
    )
  })

  it('⛔ it can be pressed inside the bar the window is moved by', async () => {
    const m = await bar(READ)
    const line = m.q('app-usage')
    expect(
      getComputedStyle(m.q('app-titlebar')).getPropertyValue('-webkit-app-region').trim(),
    ).toBe('drag')
    expect(getComputedStyle(line).getPropertyValue('-webkit-app-region').trim()).toBe('no-drag')
    const box = line.getBoundingClientRect()
    expect(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)).toBe(line)
  })

  it('🔴 a press opens the usage cards under it, and Escape closes them', async () => {
    const m = await bar(READ)
    const cards = m.q('app-usage-cards')
    expect(cards.matches(':popover-open')).toBe(false)
    m.q('app-usage').click()
    await nextTick()
    expect(cards.matches(':popover-open')).toBe(true)
    expect(cards.getAttribute('aria-label')).toBe('Usage and agents')
    expect(cards.querySelector('[data-cy="shelf-usage-claude-5h"]')!.textContent).toContain(
      '28% · resets in',
    )
    expect(cards.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      m.q('app-usage').getBoundingClientRect().bottom - 0.5,
    )
    await userEvent.keyboard('{Escape}')
    await nextTick()
    expect(cards.matches(':popover-open')).toBe(false)
  })

  it('⚑ the window’s title stays centred with the line beside the controls', async () => {
    const m = await bar(READ)
    const title = m.q('window-title').getBoundingClientRect()
    const strip = m.q('app-titlebar').getBoundingClientRect()
    expect(Math.abs(title.x + title.width / 2 - (strip.x + strip.width / 2))).toBeLessThan(1)
    expect(m.q('app-usage').getBoundingClientRect().right).toBeLessThanOrEqual(title.left)
  })
})

describe('a long window title leaves both clusters their own room', () => {
  /** A data folder's name as long as a file system allows, as `windowTitleFor` would put it. */
  const LONG = `BroCrew — ${'bakery-menu-design-review-and-autumn-recipes-'.repeat(6).slice(0, 255)}`

  it.each([760, 1180])(
    '🔴 at %ipx the usage line ends before the title, and the saved state starts after it',
    async (width) => {
      ;(window as { api?: unknown }).api = {
        runtime: {
          providerUsage: () => Promise.resolve(READ),
          onProvidersChanged: () => () => {},
        },
      }
      await page.viewport(width, 840)
      const info = {
        name: 'BroCrew',
        version: '0.0.0',
        windowTitle: LONG,
        build: { id: 'abc1234', commit: 'abc1234dead', dirty: false },
        db: { migrationsApplied: 7 },
      }
      const m = mount(AppTitleBar, { info, error: null }, { width, height: 32 })
      await new Promise((done) => setTimeout(done, 0))
      await nextTick()
      const title = m.q('window-title').getBoundingClientRect()
      const usage = m.q('app-usage').getBoundingClientRect()
      const saved = m.q('app-info').getBoundingClientRect()
      expect(usage.right, 'the usage line runs under the title').toBeLessThanOrEqual(
        title.left + 0.5,
      )
      expect(saved.left, 'the saved state runs under the title').toBeGreaterThanOrEqual(
        title.right - 0.5,
      )
      // ⚑ "Saved locally" is one line, never wrapped to two inside the 32px bar.
      const word = m.q('app-info').querySelector<HTMLElement>('.sync-word')!
      expect(word.textContent).toBe('Saved locally')
      expect(word.getClientRects()).toHaveLength(1)
      expect(word.getBoundingClientRect().height).toBeLessThan(24)
    },
  )
})
