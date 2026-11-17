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
