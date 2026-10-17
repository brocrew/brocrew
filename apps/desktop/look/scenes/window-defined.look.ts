import { scene } from '../capture'
import { wearTheme } from '../fixtures/themes'
import { windowStage } from '../fixtures/window'

/**
 * 🎨 **The whole window in Defined**, one of the themes the app ships: the window scene's fake data
 * with `resources/themes/defined/theme.json` applied.
 */
scene('window-defined', async (stage) => {
  wearTheme('defined')
  stage.mount(windowStage(), {})
  await new Promise((done) => setTimeout(done, 50))
})
