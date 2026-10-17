import SettingsScreen from '../../src/renderer/src/components/SettingsScreen.vue'
import { scene } from '../capture'
import { providersBridge } from '../fixtures/providers'

/**
 * 🎨 **The Providers screen, other states** — Claude signed out, Codex running on a saved API key.
 * Fake data: `fixtures/providers.ts`.
 */
scene('providers-signed-out', async (stage) => {
  providersBridge(true)
  stage.mount(SettingsScreen, { capabilities: null, warnings: null, clock: Date.now() })
  await new Promise((done) => setTimeout(done, 80))
})
