import SettingsScreen from '../../src/renderer/src/components/SettingsScreen.vue'
import { scene } from '../capture'
import { providersBridge } from '../fixtures/providers'

/**
 * 🎨 **The Providers screen** — Claude and Codex, each signed in, with sample usage and what their
 * processes use. Fake data: `fixtures/providers.ts`.
 */
scene('providers', async (stage) => {
  providersBridge()
  stage.mount(SettingsScreen, { capabilities: null, warnings: null, clock: Date.now() })
  await new Promise((done) => setTimeout(done, 80))
})
