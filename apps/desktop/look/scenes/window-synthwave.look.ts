import { scene } from '../capture'
import { wearTheme } from '../fixtures/themes'
import { windowStage } from '../fixtures/window'

/**
 * 🎨 **The whole window in Synthwave**, one of the themes the app ships: the window scene's fake data
 * with `resources/themes/synthwave/theme.json` applied.
 */
scene('window-synthwave', async (stage) => {
  wearTheme('synthwave')
  stage.mount(windowStage(), {})
  await new Promise((done) => setTimeout(done, 50))
})
