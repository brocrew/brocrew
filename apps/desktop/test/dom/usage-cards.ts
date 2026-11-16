import type { ProviderUsageReading } from '../../src/shared/runtime-ipc'
import { nextTick } from 'vue'
import TitleUsage from '../../src/renderer/src/components/TitleUsage.vue'
import { mount, type Mounted } from './harness'

/**
 * The title bar's usage line, mounted on its own, with its cards opened by a press as a person opens
 * them. The cards are where each provider's usage cells and the two totals are drawn.
 */
export async function usageCards(width = 900, height = 400): Promise<Mounted> {
  const m = mount(TitleUsage, {}, { width, height })
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
  m.q('app-usage').click()
  await nextTick()
  return m
}

/** A fictional account names its windows before their measurements arrive. */
export function unreadUsage(): Record<'claude' | 'codex', ProviderUsageReading[]> {
  const pending = (window: string, word: string, durationMs: number): ProviderUsageReading => ({
    window,
    period: { word, durationMs, bucket: false, bucketName: null },
    usedPercent: null,
    resetsAt: null,
    at: 0,
  })
  return {
    claude: [
      pending('five_hour', '5-hour', 18_000_000),
      pending('seven_day', 'weekly', 604_800_000),
    ],
    codex: [pending('a 7-day window', 'weekly', 604_800_000)],
  }
}
