import { createModelLists } from '../lib/provider-launch-fixture'
import { providerDescriptor } from '@brobot2/shared'
import { afterEach, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive, type Component } from 'vue'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'

import { providerConditions, readProviderLimit } from '../../src/shared/provider-limit'
import {
  limitsDisplayWords,
  type LimitsDisplayState,
} from '../../src/renderer/src/lib/limits-display'
import type { ProviderUsageReading } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

const NOW = Date.UTC(2026, 9, 26, 19, 14, 52)
const HOUR = 3_600_000
const WEEKLY_PERIOD = {
  word: 'weekly',
  durationMs: 7 * 24 * HOUR,
  bucket: false,
  bucketName: null,
}
const words = (node: Element) => (node.textContent ?? '').replace(/\s+/g, ' ').trim()

afterEach(unmountAll)

function currentReading(
  usedPercent: number,
  resetsAt: number,
  warningUsed: number | null,
): ProviderUsageReading {
  return {
    window: 'seven_day',
    period: WEEKLY_PERIOD,
    usedPercent,
    resetsAt,
    at: NOW,
    warning:
      warningUsed === null
        ? null
        : {
            ...readProviderLimit(
              `claude is approaching its rate limit (seven_day) — ${warningUsed}% used; resets ${new Date(resetsAt).toISOString()}`,
              NOW,
            )!,
            meaning: { word: 'weekly', used: warningUsed, untimed: false },
          },
  }
}

function card(usedPercent: number, resetsAt: number, warningUsed: number | null) {
  const wall = {
    ...readProviderLimit(
      `claude is approaching its rate limit (seven_day) — 90% used; resets ${new Date(NOW + 48 * HOUR).toISOString()}`,
      NOW - HOUR,
    )!,
    meaning: { word: 'weekly', used: 90, untimed: false },
  }
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
    descriptor: providerDescriptor('claude'),
    capabilities: null,
    limit: providerConditions([wall], NOW)[0]!,
    limitsRead: true,
    limitsDisplay: display as LimitsDisplayState | undefined,
    clock: NOW,
    version: { version: '2.1.290' },
    readings: [currentReading(usedPercent, resetsAt, warningUsed)] as ProviderUsageReading[],
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
  const { m } = card(29, NOW + 7.75 * HOUR, null)
  await settled()
  expect(words(m.q('provider-usage-reading'))).toContain('29% used')
  expect(words(m.q('provider-usage-reading'))).toContain('7 h 45 min')
  expect(words(m.q('provider-usage-says'))).not.toContain('90% used')
  expect(words(m.q('provider-usage-says'))).not.toContain('2 days')
})

it('takes both the percentage and reset from the same current near-limit reading', async () => {
  const { m, props } = card(84, NOW + 7.75 * HOUR, 84)
  await settled()
  expect(words(m.q('provider-usage-says'))).toContain('84% used')
  expect(words(m.q('provider-usage-says'))).toContain('7 h 45 min')
  props.readings = [
    {
      window: 'seven_day',
      period: WEEKLY_PERIOD,
      usedPercent: 29,
      resetsAt: NOW + HOUR,
      at: NOW,
      warning: null,
    },
  ]
  await settled()
  expect(words(m.q('provider-usage-says'))).not.toContain('is near')
})

it('keeps a matching current near-limit warning', async () => {
  const { m } = card(90, NOW + 48 * HOUR, 90)
  await settled()
  expect(words(m.q('provider-usage-says'))).toContain('90% used')
  expect(words(m.q('provider-usage-says'))).toContain('2 days')
})

it('pairs each near-limit window with its own percentage and reset', async () => {
  const { m, props } = card(91, NOW + 72 * HOUR, 91)
  props.readings.unshift({
    window: 'five_hour',
    period: { word: '5-hour', durationMs: 5 * HOUR, bucket: false, bucketName: null },
    usedPercent: 88,
    resetsAt: NOW + HOUR,
    at: NOW,
    warning: {
      ...readProviderLimit(
        `claude is approaching its rate limit (five_hour) — 88% used; resets ${new Date(NOW + HOUR).toISOString()}`,
        NOW,
      )!,
      meaning: { word: '5-hour', used: 88, untimed: false },
    },
  })
  await settled()
  const warning = words(m.q('provider-usage-says'))
  expect(warning).toContain('its 5-hour limit (88% used); it resets in 1 h.')
  expect(warning).toContain('its weekly limit (91% used); it resets in 3 days.')
})

it('does not confirm a retained warning from unconfirmed or absent readings', async () => {
  const { m, props } = card(90, NOW + 48 * HOUR, 90)
  props.readings = [{ ...props.readings[0]!, unconfirmed: true }]
  await settled()
  expect(words(m.q('provider-usage-says'))).not.toContain('is near')
  props.readings = []
  await settled()
  expect(words(m.q('provider-usage-says'))).not.toContain('90% used')
})

it('keeps the separately reported stop without changing it into a measured percentage', async () => {
  const { m, props } = card(29, NOW + 7.75 * HOUR, null)
  const stopped = {
    ...readProviderLimit('claude is rate-limited (seven_day)', NOW)!,
    meaning: { word: 'weekly', used: null, untimed: true },
  }
  props.limit = providerConditions([stopped], NOW)[0]!
  await settled()
  expect(words(m.q('provider-usage-says'))).toContain('has reached its weekly limit')
  expect(words(m.q('provider-usage-says'))).not.toContain('29% used')
})

it('retains the supplied consequence for an intentionally raw-only legacy warning', async () => {
  const { m, props } = card(29, NOW + HOUR, null)
  const raw = readProviderLimit('claude is rate-limited (seven_day)', NOW)!
  props.limit = providerConditions([raw], NOW)[0]!
  await settled()
  expect(words(m.q('provider-usage-says'))).toBe(
    limitsDisplayWords.condition(props.limit.says, NOW),
  )
  expect(words(m.q('provider-usage-says'))).not.toContain('weekly limit')
  expect(raw.meaning).toBeUndefined()
})

it('uses supplied warning facts despite contradictory raw figures and window names', async () => {
  const { m, props } = card(12, NOW + HOUR, 92)
  const supplied = props.readings[0]!.warning!
  props.readings = [
    {
      ...props.readings[0]!,
      window: 'seven_day',
      warning: { ...supplied, meaning: { word: 'Fern', used: 92, untimed: false } },
    },
  ]
  await settled()
  expect(words(m.q('provider-usage-reading'))).toContain('12% used')
  expect(words(m.q('provider-usage-says'))).toContain('its Fern limit (92% used)')
  props.readings = [{ ...props.readings[0]!, usedPercent: 99, warning: null }]
  await settled()
  expect(words(m.q('provider-usage-says'))).not.toContain('is near')
})

it('retires a supplied warning at its reset without recreating it from raw usage', async () => {
  const { m, props } = card(90, NOW + HOUR, 90)
  await settled()
  expect(words(m.q('provider-usage-says'))).toContain('90% used')
  props.clock = NOW + HOUR
  await settled()
  expect(words(m.q('provider-usage-says'))).not.toContain('is near')
  expect(words(m.q('provider-usage-reading'))).toContain('was 90% used')
})

it('does not invent a warning for old readings without a supplied decision', async () => {
  const { m, props } = card(90, NOW + HOUR, 90)
  const legacy = { ...props.readings[0]! }
  delete legacy.warning
  props.readings = [legacy]
  await settled()
  expect(words(m.q('provider-usage-reading'))).toContain('90% used')
  expect(words(m.q('provider-usage-says'))).not.toContain('is near')
  props.limitsDisplay = undefined
  await settled()
  expect(words(m.q('provider-usage-says'))).toContain('90% used')
})
