import SettingsScreen from '../../src/renderer/src/components/SettingsScreen.vue'
import { scene } from '../capture'
import { providersBridge } from '../fixtures/providers'
import { themesBridge } from '../fixtures/themes'

/**
 * The Settings Themes tab, with a card per theme and its
 * preview, Synthwave in use, a theme of one's own and one that can't be used. Fake data:
 * `fixtures/providers.ts` and `fixtures/themes.ts`.
 */
scene('themes', async (stage) => {
  providersBridge()
  themesBridge('synthwave')
  stage.mount(SettingsScreen, {
    tab: 'themes',
    capabilities: null,
    warnings: null,
    clock: Date.now(),
  })
  // Let the list and every preview's reading answer before the picture.
  await new Promise((done) => setTimeout(done, 120))
  document.querySelector('[data-cy="themes-section"]')?.scrollIntoView({ block: 'start' })
})
