import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import type { ProviderUsageReading } from '../../src/shared/runtime-ipc'
import { settingsWindow } from '../../look/fixtures/settings-window'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { provideIdlePlaceNavigator, settleProviderLaunch } from './provider-launch.fixture'
import { mount, unmountAll } from './harness'
import { assertDrawn, drawnReady } from './drawn'
import { readingTitle } from '../../src/renderer/src/lib/usage-limit'

const original = { width: innerWidth, height: innerHeight }
const HOUR = 3_600_000
afterEach(async () => {
  unmountAll()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
  await page.viewport(original.width, original.height)
})
for (const provider of ['claude', 'codex'] as const) {
  for (const width of [1180, 760]) {
    it(`${provider}: compact attributed windows keep their amount, time and full words at ${width}`, async () => {
      await page.viewport(width, 900)
      const now = Date.now()
      const Window = settingsWindow('providers', 'classic', undefined, CAPABILITY_FIXTURE)
      const row = (
        word: string,
        duration: number,
        used: number,
        resetIn: number,
      ): ProviderUsageReading => ({
        connectionId: `${provider}:sign-in`,
        window: word,
        period: { word, durationMs: duration, bucket: false, bucketName: null },
        usedPercent: used,
        resetsAt: now + resetIn,
        at: now - 60_000,
      })
      const readings =
        provider === 'claude'
          ? [
              row('5-hour', 5 * HOUR, 42, 2.5 * HOUR),
              row('weekly', 7 * 24 * HOUR, 67, 3 * 24 * HOUR),
            ]
          : [row('weekly', 7 * 24 * HOUR, 31, 5 * 24 * HOUR)]
      const compact =
        provider === 'claude'
          ? ['5-hour 42% used · resets in 2 h 30 min', 'Weekly 67% used · resets in 3 days']
          : ['Weekly 31% used · resets in 5 days']
      const timeWords =
        provider === 'claude'
          ? ['time gone · 2 h 30 min of 5 h gone', 'time gone · 4 of 7 days gone']
          : ['time gone · 2 of 7 days gone']
      const full =
        provider === 'claude'
          ? [
              '5-hour limit: 42% used; it resets in 2 h 30 min.',
              'Weekly limit: 67% used; it resets in 3 days.',
            ]
          : ['Weekly limit: 31% used; it resets in 5 days.']
      window.api.runtime.providerUsage = async () => ({
        claude: provider === 'claude' ? readings : [],
        codex: provider === 'codex' ? readings : [],
      })
      const signIn = vi.spyOn(window.api.runtime, 'signInProvider')
      const key = vi.spyOn(window.api.runtime, 'setApiKey')
      const remove = vi.spyOn(window.api.runtime, 'removeApiKey')
      const Frame = defineComponent({
        setup() {
          provideIdlePlaceNavigator()
          return () => h(Window)
        },
      })
      const m = mount(Frame, {}, { width, height: 900 })
      await settleProviderLaunch()
      await drawnReady()
      m.host
        .querySelector<HTMLButtonElement>(`[data-cy=provider-row][data-provider=${provider}]`)!
        .click()
      await settleProviderLaunch()
      await drawnReady()
      const entry = m
        .all('provider-connection')
        .find((one) =>
          one
            .querySelector('strong')
            ?.textContent?.includes(provider === 'claude' ? 'subscription' : 'ChatGPT'),
        )!
      expect(entry).toBeDefined()
      expect(entry.querySelector('[data-cy=connection-status]')?.textContent?.trim()).toBe('Ready')
      for (const words of [
        'Models are shown below.',
        'Models not checked.',
        'Runs on your',
        'When this login has expired',
        'No recorded warning attributed',
        'No limit warnings recorded as of',
        'Copies this Mac',
      ])
        expect(m.host.textContent).not.toContain(words)
      expect(entry.querySelector('[data-cy=provider-login-renewal]')).toBeNull()
      expect(entry.querySelector('[data-cy=copy-all-sign-ins]')).toBeNull()
      entry.scrollIntoView({ block: 'center' })
      await drawnReady()
      const lines = [...entry.querySelectorAll<HTMLElement>('[data-cy=provider-usage-reading]')]
      expect(lines).toHaveLength(readings.length)
      const amount = [...entry.querySelectorAll<HTMLMeterElement>('meter:not(.time-meter)')]
      const time = [...entry.querySelectorAll<HTMLMeterElement>('[data-cy=provider-usage-time]')]
      expect(amount.map((meter) => meter.value)).toEqual(
        readings.map((reading) => reading.usedPercent),
      )
      expect(time).toHaveLength(readings.length)
      const elapsed = [
        ...entry.querySelectorAll<HTMLElement>('[data-cy=provider-usage-time-words]'),
      ]
      expect(elapsed.map((one) => one.textContent?.replace(/\s+/g, ' ').trim())).toEqual(timeWords)
      const windows = entry.querySelector<HTMLElement>('.usage-windows')!
      const css = getComputedStyle(windows)
      const room = windows.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
      let previousBottom = -Infinity
      for (const [index, line] of lines.entries()) {
        expect(line.textContent?.trim()).toBe(compact[index])
        expect(line.title).toContain(full[index])
        expect(line.title).toContain(readingTitle(readings[index]!, now))
        expect(amount[index]!.getAttribute('aria-label')).toBe(full[index])
        expect(time[index]!.value).toBeCloseTo(
          provider === 'claude' && index === 0 ? 0.5 : provider === 'claude' ? 4 / 7 : 2 / 7,
          3,
        )
        assertDrawn(line, `${provider} compact window`, entry)
        const box = line.closest('.usage-window')!.getBoundingClientRect()
        for (const [part, words] of [
          [amount[index]!, 'amount'],
          [time[index]!, 'time'],
          [elapsed[index]!, 'time words'],
        ] as const) {
          assertDrawn(part, `${provider} ${words}`, entry)
          const drawn = part.getBoundingClientRect()
          expect(drawn.width).toBeGreaterThan(0)
          expect(drawn.height).toBeGreaterThan(0)
          expect(drawn.left).toBeGreaterThanOrEqual(box.left)
          expect(drawn.right).toBeLessThanOrEqual(box.right)
          expect(drawn.top).toBeGreaterThanOrEqual(box.top)
          expect(drawn.bottom).toBeLessThanOrEqual(box.bottom)
          expect(drawn.top).toBeGreaterThanOrEqual(0)
          expect(drawn.bottom).toBeLessThanOrEqual(900)
          expect(
            part.contains(
              document.elementFromPoint(drawn.x + drawn.width / 2, drawn.y + drawn.height / 2),
            ),
          ).toBe(true)
        }
        expect(amount[index]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
          line.getBoundingClientRect().bottom,
        )
        expect(time[index]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
          amount[index]!.getBoundingClientRect().bottom,
        )
        expect(elapsed[index]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
          time[index]!.getBoundingClientRect().bottom,
        )
        expect(time[index]!.getAttribute('aria-valuetext')).toBe(
          timeWords[index]!.replace('time gone · ', ''),
        )
        expect(Math.abs(box.width - room)).toBeLessThanOrEqual(1)
        expect(box.top).toBeGreaterThanOrEqual(previousBottom)
        previousBottom = box.bottom
      }
      expect(entry.querySelectorAll('[data-cy=provider-usage-time-words]')).toHaveLength(
        readings.length,
      )
      expect(signIn).not.toHaveBeenCalled()
      expect(key).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    })
  }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: an unknown reading adds no usage box or explanatory paragraphs`, async () => {
    const Window = settingsWindow('providers', 'classic', undefined, CAPABILITY_FIXTURE)
    window.api.runtime.providerUsage = async () => ({ claude: [], codex: [] })
    const Frame = defineComponent({
      setup() {
        provideIdlePlaceNavigator()
        return () => h(Window)
      },
    })
    const m = mount(Frame, {}, { width: 1180, height: 900 })
    await settleProviderLaunch()
    m.host
      .querySelector<HTMLButtonElement>(`[data-cy=provider-row][data-provider=${provider}]`)!
      .click()
    await settleProviderLaunch()
    expect(m.all('provider-connection')).toHaveLength(2)
    expect(m.host.querySelector('[data-cy=provider-usage-none]')).toBeNull()
    expect(m.host.querySelector('[data-cy=provider-usage-reading]')).toBeNull()
    expect(m.host.querySelector('[data-cy=provider-usage-says]')).toBeNull()
    expect(m.host.querySelector('[data-cy=copy-all-sign-ins]')).toBeNull()
    expect(m.host.textContent).not.toContain('Models not checked.')
    expect(m.host.textContent).not.toContain('No API key saved. Save a key')
    expect(m.host.textContent).not.toContain('No limit warnings recorded as of')
    expect(m.all('connection-edit')).toHaveLength(2)
  })
}
