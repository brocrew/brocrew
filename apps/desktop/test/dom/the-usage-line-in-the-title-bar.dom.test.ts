import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, provide } from 'vue'
import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { providerConnectionFixtures, providersBridge } from '../../look/fixtures/providers'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import {
  railFacts,
  screenFacts,
  useWhoCalledWhom,
  type RunningConversation,
} from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { ProviderUsageReading } from '../../src/shared/runtime-ipc'
import { conv, forestOf } from './forest-fixture'
import { mount, unmountAll, type Mounted } from './harness'
import { drawnReady } from './drawn'
import {
  attributedUsageFixtures,
  provideIdlePlaceNavigator,
  runningSignInFixtures,
  reserveTitleUsageRoom,
} from './provider-launch.fixture'

/**
 * The window's usage on one line in its title bar, for every screen: each provider's windows, the
 * agents running and their memory. A press opens the usage cards under it; Escape closes them.
 * Fictional readings only.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const HOUR = 3_600_000

afterEach(async () => {
  unmountAll()
  vi.restoreAllMocks()
  delete (window as { api?: unknown }).api
  railFacts().update({ runningConversations: null })
  screenFacts().update({ forest: null })
  screenFacts().update({ processMemory: new Map() })
  screenFacts().update({ memoryUnmeasured: null })
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

type Usage = Record<'claude' | 'codex', ProviderUsageReading[]>

async function settledTitle(): Promise<void> {
  await drawnReady()
  await new Promise<void>((done) => requestAnimationFrame(() => done()))
  await nextTick()
}

async function bar(
  usage: Usage,
  running: readonly RunningConversation[] | null = runningSignInFixtures(),
): Promise<Mounted> {
  railFacts().update({ runningConversations: running })
  ;(window as { api?: unknown }).api = {
    runtime: {
      providerCatalogue: async () => PROVIDER_DESCRIPTORS,
      providerConnections: async () => providerConnectionFixtures(),
      providerUsage: () => Promise.resolve(attributedUsageFixtures(usage)),
      onProvidersChanged: () => () => {},
    },
  }
  await page.viewport(1180, 840)
  const Frame = defineComponent(() => {
    provideIdlePlaceNavigator()
    return () => h(AppTitleBar, { info: null, error: null })
  })
  const m = mount(Frame, {}, { width: 1180, height: 32 })
  m.host.style.flexDirection = 'column'
  await settledTitle()
  return m
}

const READ: Usage = (() => {
  const now = Date.now()
  return {
    claude: [
      {
        window: 'five_hour',
        usedPercent: 28,
        resetsAt: now + 3 * HOUR,
        at: now - 60_000,
        period: { word: '5-hour', durationMs: 5 * HOUR, bucket: false, bucketName: null },
      },
      {
        window: 'seven_day',
        usedPercent: 61.4,
        resetsAt: now + 48 * HOUR,
        at: now - 60_000,
        period: { word: 'weekly', durationMs: 7 * 24 * HOUR, bucket: false, bucketName: null },
      },
    ],
    codex: [
      {
        window: 'a 7-day window',
        usedPercent: 35,
        resetsAt: now + 96 * HOUR,
        at: now,
        period: { word: 'weekly', durationMs: 7 * 24 * HOUR, bucket: false, bucketName: null },
      },
    ],
  }
})()

describe('the usage line', () => {
  it('🔴 says each window’s use, then the agents and their memory, with the same words as its name', async () => {
    railFacts().update({
      runningConversations: [
        {
          sessionId: 'sess_a',
          provider: 'claude',
          connectionId: 'claude:sign-in',
          state: { is: 'active' },
        },
        {
          sessionId: 'sess_b',
          provider: 'codex',
          connectionId: 'codex:sign-in',
          state: { is: 'idle' },
        },
      ],
    })
    screenFacts().update({
      forest: forestOf([
        conv('sess_a', null, { running: 'in-a-window' }),
        conv('sess_b', 'sess_a', { running: 'unwatched', provider: 'codex' }),
        conv('sess_c', 'sess_a', { running: 'not-running' }),
      ]),
    })
    screenFacts().update({
      processMemory: new Map([
        ['sess_a', 600 * 1024 * 1024],
        ['sess_b', 700 * 1024 * 1024],
      ]),
    })
    const m = await bar(READ, useWhoCalledWhom().runningConversations.value)
    await reserveTitleUsageRoom(m, 'Claude 5h 28% · week 61% · +1')
    const line = m.q('app-usage')
    const said = (line.textContent ?? '').trim()
    expect(said).toBe('Claude 5h 28% · week 61% · +1')
    expect(line.title).toContain(
      'Claude 5h 28% · week 61% · Codex week 35% · 2 agents · 1 working · 1.3 GB',
    )
    // Short cells retain full plain usage sentences for hover and accessibility.
    expect(line.getAttribute('aria-label')).toBe(line.title)
    expect(line.title).toContain('Claude 5-hour usage: 28% used')
    expect(line.title).toContain('Claude weekly usage: 61% used')
    expect(line.title).toContain('Codex weekly usage: 35% used')
  })

  it('⚑ before the running list is read it says unknown without inventing provider windows', async () => {
    const m = await bar({ claude: [], codex: [] }, null)
    expect((m.q('app-usage').textContent ?? '').trim()).toBe('? agents · ?')
    expect(m.all('shelf-usage-claude-5h')).toHaveLength(0)
    expect(m.all('shelf-usage-codex-week')).toHaveLength(0)
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

  it('places usage after the left-aligned window title', async () => {
    const m = await bar(READ)
    const title = m.q('window-title').getBoundingClientRect()
    const usage = m.q('app-usage').getBoundingClientRect()
    expect(title.right).toBeLessThanOrEqual(usage.left + 0.5)
    expect(title.left).toBeLessThan(1180 / 2)
  })
})

describe('a long window title leaves usage its own room', () => {
  /** A data folder's name as long as a file system allows, as `windowTitleFor` would put it. */
  const LONG = `BroCrew — ${'bakery-menu-design-review-and-autumn-recipes-'.repeat(6).slice(0, 255)}`

  it.each([760, 1180])('at %ipx the title ends before the usage line', async (width) => {
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
    expect(title.right, 'the title runs under usage').toBeLessThanOrEqual(usage.left + 0.5)
    expect(usage.width).toBeGreaterThan(0)
    expect(m.q('window-title').title).toBe(LONG)
    expect(m.host.textContent).not.toContain('Saved locally')
  })
})

it('places fictional raw windows by supplied period facts and excludes supplied bucket readings', async () => {
  const now = Date.now()
  const reading: ProviderUsageReading = {
    window: 'fern native history without a duration',
    usedPercent: 23,
    resetsAt: now + HOUR,
    at: now,
    period: { word: 'weekly', durationMs: 9 * HOUR, bucket: false, bucketName: null },
  }
  const mounted = await bar({
    claude: [
      reading,
      {
        ...reading,
        usedPercent: 99,
        period: { word: '5-hour', durationMs: 9 * HOUR, bucket: true, bucketName: 'Fern branch' },
      },
    ],
    codex: [],
  })
  const line = mounted.q('app-usage')
  expect(line.textContent).toContain('week 23%')
  expect(line.textContent).not.toContain('99%')
})

async function namedTitle(name: string, delayed = false) {
  providersBridge()
  railFacts().update({ runningConversations: runningSignInFixtures() })
  const raw = vi.spyOn(window.api.runtime, 'providerCatalogue')
  let release!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const runtime = {
    ...window.api.runtime,
    providerUsage: vi.fn(async () => attributedUsageFixtures(READ)),
    providerCatalogue: vi.fn(async function (this: object) {
      expect(this).toBe(runtime)
      if (delayed) await hold
      return PROVIDER_DESCRIPTORS.map((row) => ({
        ...row,
        displayName: row.id === 'claude' ? name : 'Birch',
      }))
    }),
  }
  const api = createDesktopProviderApi(
    () => runtime,
    () => undefined,
  )
  const Root = defineComponent({
    setup() {
      provideIdlePlaceNavigator()
      provide(CLIENT_PROVIDERS, api)
      return () => h(AppTitleBar, { info: null, error: null })
    },
  })
  const m = mount(Root, {}, { width: 1180, height: 32 })
  m.host.style.flexDirection = 'column'
  await settledTitle()
  return { m, raw, runtime, release: () => release() }
}

it('uses selected names in real title usage with the same numbers and popover action', async () => {
  const first = await namedTitle('Fern')
  const line = first.m.q('app-usage')
  expect(line.textContent).toBe(
    'Fern 5h 28% · week 61% · Birch week 35% · 2 agents · 0 working · ?',
  )
  expect(line.title).toContain('Fern 5h 28% · week 61% · Birch week 35%')
  expect(line.getAttribute('aria-label')).toBe(line.title)
  expect(line.title).toContain('Fern 5-hour usage: 28% used')
  const second = await namedTitle('Willow')
  expect(second.m.q('app-usage').textContent).toContain('Willow 5h 28%')
  expect(line.textContent).toContain('Fern 5h 28%')
  line.click()
  await nextTick()
  expect(first.m.q('app-usage-cards').matches(':popover-open')).toBe(true)
  expect(
    first.m.q('app-usage-cards').querySelector('[data-cy="shelf-usage-claude-5h"]')!.textContent,
  ).toContain('28% · resets in')
  expect(first.runtime.providerUsage.mock.results).toHaveLength(1)
  expect(first.raw).not.toHaveBeenCalled()
  expect(second.raw).not.toHaveBeenCalled()
})

it('retains title usage amounts while names are unread and updates on their selected answer', async () => {
  const out = await namedTitle('Fern', true)
  const line = out.m.q('app-usage')
  expect(line.textContent).toContain('28%')
  expect(line.textContent).toMatch(/provider/i)
  expect(line.textContent).not.toContain('Claude')
  out.release()
  await vi.waitFor(() => expect(line.textContent).toContain('Fern 5h 28%'))
  expect(out.runtime.providerCatalogue).toHaveBeenCalledTimes(1)
  expect(out.raw).not.toHaveBeenCalled()
})
