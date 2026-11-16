import { expect, it } from 'vitest'
import { providerDescriptor } from '@brobot2/shared'
import type { ProviderUsageReading } from '../../src/shared/runtime-ipc'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'
import { readingStatus, readingTitle } from '../../src/renderer/src/lib/usage-limit'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { mount } from './harness'
import { assertDrawn, drawnReady } from './drawn'
import {
  providerCardReadingProps,
  providerLaunchFixture,
  settleProviderLaunch,
} from './provider-launch.fixture'

providerLaunchFixture()
const HOUR = 3_600_000
const cases = [
  {
    kind: 'zero',
    visible: 'Weekly 0% used · resets in 3 days',
    full: 'Weekly limit: 0% used; it resets in 3 days.',
    compact: true,
  },
  {
    kind: 'bucket',
    visible: 'Weekly (fictional bucket) 42% used · resets in 3 days',
    full: 'Weekly limit (fictional bucket): 42% used; it resets in 3 days.',
    compact: true,
  },
  {
    kind: 'missing-amount',
    visible: 'Weekly limit: how much is used isn’t said; it resets in 3 days.',
    compact: false,
  },
  { kind: 'missing-period', visible: 'weekly: 42% used; it resets in 3 days.', compact: false },
  {
    kind: 'missing-reset',
    visible: 'Weekly limit: 42% used; it hasn’t said when it resets.',
    compact: false,
  },
  { kind: 'unconfirmed', visible: 'Weekly limit: 42% used; it resets in 3 days.', compact: false },
  {
    kind: 'reset-now',
    visible: 'Weekly limit: was 42% used; it reset less than a minute ago.',
    compact: false,
  },
  { kind: 'expired', visible: 'Weekly limit: was 42% used; it reset 1 h ago.', compact: false },
] as const
for (const provider of ['claude', 'codex'] as const) {
  for (const one of cases) {
    it(`${provider}: compact drawer preserves ${one.kind} reading facts`, async () => {
      const now = Date.now()
      const reading: ProviderUsageReading = {
        connectionId: `${provider}:sign-in`,
        window: 'weekly',
        usedPercent: one.kind === 'missing-amount' ? null : one.kind === 'zero' ? 0 : 42,
        resetsAt:
          one.kind === 'missing-reset'
            ? null
            : one.kind === 'reset-now'
              ? now
              : one.kind === 'expired'
                ? now - HOUR
                : now + 3 * 24 * HOUR,
        at: now - 60_000,
        ...(one.kind === 'missing-period'
          ? {}
          : {
              period: {
                word: 'weekly',
                durationMs: 7 * 24 * HOUR,
                bucket: one.kind === 'bucket',
                bucketName: one.kind === 'bucket' ? 'fictional bucket' : null,
              },
            }),
        ...(one.kind === 'unconfirmed' ? { unconfirmed: true } : {}),
      }
      const m = mount(
        ProviderCard,
        {
          provider,
          descriptor: providerDescriptor(provider),
          capabilities: CAPABILITY_FIXTURE,
          limit: null,
          limitsRead: true,
          clock: now,
          version: { version: 'fictional' },
          frameless: true,
          ...providerCardReadingProps([reading]),
        },
        { width: 365, height: 1400 },
      )
      await settleProviderLaunch()
      await drawnReady()
      const line = m.q('provider-usage-reading')
      expect(line.childNodes[0]?.textContent?.trim()).toBe(one.visible)
      assertDrawn(line, `${provider} ${one.kind} usage`, m.host)
      const full = one.compact ? one.full : one.visible
      expect(line.title).toContain(readingTitle(reading, now))
      if (one.compact) expect(line.title).toContain(full)
      const status = readingStatus(reading, now)
      if (status === null) expect(m.all('provider-usage-unconfirmed')).toHaveLength(0)
      else expect(m.q('provider-usage-unconfirmed').textContent?.trim()).toBe(status)
      const amounts = m.host.querySelectorAll<HTMLMeterElement>('meter:not(.time-meter)')
      if (reading.usedPercent === null) {
        expect(amounts).toHaveLength(0)
        expect(m.host.querySelectorAll('.empty-meter')).toHaveLength(1)
      } else {
        expect(amounts).toHaveLength(1)
        expect(amounts[0]!.value).toBe(reading.usedPercent)
        expect(amounts[0]!.getAttribute('aria-label')).toBe(status ? `${full} ${status}` : full)
      }
      const elapsed = !['missing-period', 'missing-reset', 'reset-now', 'expired'].includes(
        one.kind,
      )
      expect(m.all('provider-usage-time')).toHaveLength(elapsed ? 1 : 0)
      if (elapsed) {
        expect((m.q('provider-usage-time') as HTMLMeterElement).value).toBeCloseTo(4 / 7, 6)
        expect(m.q('provider-usage-time-words').textContent?.replace(/\s+/g, ' ').trim()).toBe(
          'time gone · 4 of 7 days gone',
        )
      }
    })
  }
}
