import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { computed, defineComponent, h, nextTick } from 'vue'
import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import IconSprite from '../../src/renderer/src/components/IconSprite.vue'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import { providePlaceNavigator } from '../../src/renderer/src/composables/usePlaceNavigator'
import { mount, unmountAll } from './harness'
import { railFacts } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { providerConnectionFixtures } from '../../look/fixtures/providers'
import { attributedUsageFixtures, runningSignInFixtures } from './provider-launch.fixture'

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  vi.restoreAllMocks()
  railFacts().update({ runningConversations: null })
  delete (window as { api?: unknown }).api
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

it.each([
  ['MacIntel', 'mac'],
  ['Win32', 'windows'],
  ['Linux x86_64', 'linux'],
])('keeps arrows, title and usage in order with native space on %s', async (computer, platform) => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(computer)
  await page.viewport(1180, 840)
  const back = vi.fn()
  const forward = vi.fn()
  const Root = defineComponent({
    setup() {
      providePlaceNavigator({
        backTo: computed(() => 'Library'),
        forwardTo: computed(() => 'Agent'),
        back,
        forward,
      })
      return () =>
        h('div', { style: { display: 'grid', width: '100%' } }, [
          h(AppTitleBar, { info: null, error: null }),
        ])
    },
  })
  const m = mount(Root, {}, { width: 1180, height: 32 })
  await nextTick()
  const bar = m.q('app-titlebar')
  const title = m.q('window-title')
  const usage = m.q('app-usage')
  const arrows = m.q('nav-back').parentElement!
  expect(bar.dataset['platform']).toBe(platform)
  expect(title.textContent?.trim()).toBe('BroCrew')
  expect(arrows.nextElementSibling).toBe(title)
  expect(title.nextElementSibling).toBe(usage)
  expect(arrows.getBoundingClientRect().right).toBeLessThanOrEqual(
    title.getBoundingClientRect().left,
  )
  expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(
    usage.getBoundingClientRect().left,
  )
  expect(title.getBoundingClientRect().left).toBeLessThan(1180 / 2)
  expect(Math.round(bar.getBoundingClientRect().height)).toBe(32)
  expect(m.host.querySelector('.window-controls')).toBeNull()
  expect(m.all('app-info')).toHaveLength(0)

  const style = getComputedStyle(bar)
  if (platform === 'mac') {
    expect(style.paddingLeft).toBe('80px')
    expect(arrows.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      bar.getBoundingClientRect().left + 80,
    )
  } else if (platform === 'windows') {
    // Resolve the host's actual overlay values, including browser fallbacks.
    const overlay = document.createElement('div')
    overlay.style.position = 'absolute'
    overlay.style.visibility = 'hidden'
    overlay.style.width = '1180px'
    overlay.style.boxSizing = 'border-box'
    overlay.style.paddingLeft = 'calc(env(titlebar-area-x, 0px) + var(--space-7))'
    overlay.style.paddingRight =
      'calc(1180px - env(titlebar-area-x, 0px) - env(titlebar-area-width, 1180px) + var(--space-7))'
    m.host.append(overlay)
    const expected = getComputedStyle(overlay)
    expect(style.paddingLeft).toBe(expected.paddingLeft)
    expect(style.paddingRight).toBe(expected.paddingRight)
  } else {
    const inset = getComputedStyle(document.documentElement).getPropertyValue('--space-7').trim()
    expect(style.paddingLeft).toBe(inset)
    expect(style.paddingRight).toBe(inset)
  }

  for (const cy of ['nav-back', 'nav-forward', 'app-usage']) {
    const button = m.q(cy)
    expect(getComputedStyle(button).getPropertyValue('-webkit-app-region').trim()).toBe('no-drag')
    const box = button.getBoundingClientRect()
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    expect(hit?.closest('button')).toBe(button)
  }
  m.q('nav-back').click()
  m.q('nav-forward').click()
  expect(back).toHaveBeenCalledOnce()
  expect(forward).toHaveBeenCalledOnce()
  usage.click()
  await nextTick()
  expect(m.q('app-usage-cards').matches(':popover-open')).toBe(true)
})

it('keeps long title and diagnostics inside the window grid', async () => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
  await page.viewport(1180, 840)
  const now = Date.now()
  const hour = 3_600_000
  railFacts().update({ runningConversations: runningSignInFixtures() })
  window.api = {
    runtime: {
      providerCatalogue: async () => PROVIDER_DESCRIPTORS,
      providerConnections: async () => providerConnectionFixtures(),
      providerUsage: async () => attributedUsageFixtures({
        claude: [
          {
            window: 'five_hour',
            usedPercent: 28,
            resetsAt: now + 3 * hour,
            at: now,
            period: { word: '5-hour', durationMs: 5 * hour, bucket: false, bucketName: null },
          },
          {
            window: 'seven_day',
            usedPercent: 61,
            resetsAt: now + 48 * hour,
            at: now,
            period: { word: 'weekly', durationMs: 168 * hour, bucket: false, bucketName: null },
          },
        ],
        codex: [
          {
            window: 'a 7-day window',
            usedPercent: 35,
            resetsAt: now + 96 * hour,
            at: now,
            period: { word: 'weekly', durationMs: 168 * hour, bucket: false, bucketName: null },
          },
        ],
      }),
      onProvidersChanged: () => () => {},
    },
  } as never
  const Root = defineComponent({
    setup() {
      return () =>
        h('div', { style: { display: 'grid', width: '100%', gridTemplateRows: '32px 1fr' } }, [
          h(IconSprite),
          h(AppTitleBar, {
            info: {
              name: 'BroCrew',
              workspace: { name: 'Fictional', path: '', isDefault: true },
              version: '0.0.0',
              step: '',
              windowTitle: 'BroCrew — ' + 'fictional-studio-'.repeat(16),
              build: { id: 'demo123', commit: 'd'.repeat(40), dirty: true, branches: null },
              db: { migrationsApplied: 24, providerSessionCount: 0 },
            },
            error: 'Fictional startup read failed',
          }),
        ])
    },
  })
  const m = mount(Root, {}, { width: 1180, height: 32 })
  await nextTick()
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
  expect(m.q('app-usage').textContent).toContain('28%')
  const bar = m.q('app-titlebar').getBoundingClientRect()
  expect(bar.width).toBe(1180)
  expect(m.q('startup-error').getBoundingClientRect().right).toBeLessThanOrEqual(bar.right)
  expect(m.q('app-usage').getBoundingClientRect().width).toBeGreaterThan(0)
})
