import { scene } from '../capture'
import { wearTheme } from '../fixtures/themes'
import { windowStage } from '../fixtures/window'

/**
 * 🎨 **The whole window in Crew Night**, the theme a new install starts in: the window scene's fake
 * data with `resources/themes/crew-night/theme.json` applied.
 */
scene('window-crew-night', async (stage) => {
  wearTheme('crew-night')
  stage.mount(windowStage(), {})
  await new Promise((done) => setTimeout(done, 50))
})
