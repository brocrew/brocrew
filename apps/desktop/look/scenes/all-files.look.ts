import { nextTick } from 'vue'
import { scene } from '../capture'
import { windowStage } from '../fixtures/window'

/** 🎨 **The All files popup — opened from the panel’s Files box** — over the whole window, as it opens. Fake data: `fixtures/right-panel.ts`. */
scene('all-files', async (stage) => {
  const m = stage.mount(windowStage(), {})
  await new Promise((done) => setTimeout(done, 50))
  m.q('card-files-all').click()
  await nextTick()
})
