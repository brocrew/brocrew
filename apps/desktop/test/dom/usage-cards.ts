import { nextTick } from 'vue'
import { page } from 'vitest/browser'
import TitleUsage from '../../src/renderer/src/components/TitleUsage.vue'
import { railFacts } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { mount, unmountAll, type Mounted } from './harness'

export async function resetUsageCards(width: number, height: number): Promise<void> {
  unmountAll()
  railFacts().update({ runningConversations: null })
  delete (window as { api?: unknown }).api
  await page.viewport(width, height)
}

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
