import { afterEach, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive, type Component } from 'vue'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { providerConditions, readProviderLimit } from '../../src/shared/provider-limit'
import type { LimitsDisplayState } from '../../src/renderer/src/lib/limits-display'
import type { ProviderUsageReading } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

const NOW = Date.UTC(2026, 9, 26, 19, 14, 52)
const HOUR = 3_600_000
const words = (node: Element) => (node.textContent ?? '').replace(/\s+/g, ' ').trim()

afterEach(unmountAll)

function card(usedPercent: number, resetsAt: number) {
  const wall = readProviderLimit(
    `claude is approaching its rate limit (seven_day) — 90% used; resets ${new Date(NOW + 48 * HOUR).toISOString()}`,
    NOW - HOUR,
  )!
  const display: LimitsDisplayState = {
    status: 'ready',
    reading: {
      operation: 1,
      databaseEpoch: 1,
      signInEpoch: 1,
      pinStartedAt: NOW,
      pinFinishedAt: NOW,
      evaluatedAt: NOW,
      usageAt: NOW,
      finishedAt: NOW,
      walked: {
        walk: 'every-provider-wall-recently-recorded',
        rows: [wall],
        ledgers: 1,
        rowsUnread: 0,
      },
    },
  }
  const props = reactive({
    provider: 'claude' as const,
    capabilities: null,
    limit: providerConditions([wall], NOW)[0]!,
    limitsRead: true,
    limitsDisplay: display,
    clock: NOW,
    version: { version: '2.1.290' },
    readings: [{ window: 'seven_day', usedPercent, resetsAt, at: NOW }] as ProviderUsageReading[],
    resources: null,
    resourcesPaused: false,
    resourcesError: null,
    loginMoved: 0,
    lists: createModelLists(
      () =>
        ({
          modelList: async () => ({
            provider: 'claude',
            notAsked: null,
            standIn: null,
            models: [],
            lastPicked: null,
            startsOn: null,
          }),
        }) as never,
    ),
  })
  ;(window as unknown as { api: unknown }).api = {
    runtime: {
      checkProviderAuth: async () => ({ state: 'usable', login: 'account', expiresAt: null }),
      apiKeyStatus: async () => ({ provider: 'claude', set: false, setAt: null, inUse: false }),
    },
  }
  const host = defineComponent({ setup: () => () => h(ProviderCard as Component, props) })
  return { m: mount(host, {}, { width: 760, height: 1400 }), props }
}

async function settled() {
  for (let i = 0; i < 4; i++) {
    await new Promise((done) => setTimeout(done, 0))
    await nextTick()
  }
}

it('does not repeat a retained 90% warning over the current 29% weekly card', async () => {
  const { m } = card(29, NOW + 7.75 * HOUR)
  await settled()
  expect(words(m.q('provider-usage-reading'))).toContain('29% used')
  expect(words(m.q('provider-usage-reading'))).toContain('7 h 45 min')
  expect(words(m.q('provider-usage-says'))).not.toContain('90% used')
  expect(words(m.q('provider-usage-says'))).not.toContain('2 days')
})

it('takes both the percentage and reset from the same current near-limit reading', async () => {
  const { m, props } = card(84, NOW + 7.75 * HOUR)
  await settled()
  expect(words(m.q('provider-usage-says'))).toContain('84% used')
  expect(words(m.q('provider-usage-says'))).toContain('7 h 45 min')
  props.readings = [{ window: 'seven_day', usedPercent: 29, resetsAt: NOW + HOUR, at: NOW }]
  await settled()
  expect(words(m.q('provider-usage-says'))).not.toContain('is near')
})

it('keeps a matching current near-limit warning', async () => {
  const { m } = card(90, NOW + 48 * HOUR)
  await settled()
  expect(words(m.q('provider-usage-says'))).toContain('90% used')
  expect(words(m.q('provider-usage-says'))).toContain('2 days')
})

it('pairs each near-limit window with its own percentage and reset', async () => {
  const { m, props } = card(91, NOW + 72 * HOUR)
  props.readings.unshift({ window: 'five_hour', usedPercent: 88, resetsAt: NOW + HOUR, at: NOW })
  await settled()
  const warning = words(m.q('provider-usage-says'))
  expect(warning).toContain('its 5-hour limit (88% used); it resets in 1 h.')
  expect(warning).toContain('its weekly limit (91% used); it resets in 3 days.')
})

it('does not confirm a retained warning from unconfirmed or absent readings', async () => {
  const { m, props } = card(90, NOW + 48 * HOUR)
  props.readings = [{ ...props.readings[0]!, unconfirmed: true }]
  await settled()
  expect(words(m.q('provider-usage-says'))).not.toContain('is near')
  props.readings = []
  await settled()
  expect(words(m.q('provider-usage-says'))).not.toContain('90% used')
})

it('keeps the separately reported stop without changing it into a measured percentage', async () => {
  const { m, props } = card(29, NOW + 7.75 * HOUR)
  const stopped = readProviderLimit('claude is rate-limited (seven_day)', NOW)!
  props.limit = providerConditions([stopped], NOW)[0]!
  await settled()
  expect(words(m.q('provider-usage-says'))).toContain('has reached its weekly limit')
  expect(words(m.q('provider-usage-says'))).not.toContain('29% used')
})
