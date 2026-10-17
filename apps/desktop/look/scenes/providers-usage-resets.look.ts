import SettingsScreen from '../../src/renderer/src/components/SettingsScreen.vue'
import { boxOf, crop, scene } from '../capture'
import { providersBridge } from '../fixtures/providers'
import { settle } from '../fixtures/window'

/**
 * 🎨 **The Providers card's usage** — each window's reading with its reset said relative to now.
 * Saves `2-resets-after-<width>.png`, Claude's usage block alone. Fake data: `fixtures/providers.ts`.
 */
scene('providers-usage-resets', async (stage) => {
  providersBridge()
  stage.mount(SettingsScreen, { capabilities: null, warnings: null, clock: Date.now() })
  await settle()
  const usage = document.querySelector('[data-cy="provider-usage"]')!
  usage.scrollIntoView({ block: 'center' })
  await settle()
  await crop(`2-resets-after-${stage.width}`, boxOf(usage))
})
