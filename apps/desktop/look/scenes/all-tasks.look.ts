import { nextTick } from 'vue'
import { scene } from '../capture'
import { windowStage } from '../fixtures/window'

/** 🎨 **The All tasks popup — opened from the panel’s current task** — over the whole window, as it opens. Fake data: `fixtures/right-panel.ts`. */
scene('all-tasks', async (stage) => {
  const m = stage.mount(windowStage(), {})
  await new Promise((done) => setTimeout(done, 50))
  m.q('card-tasks-all').click()
  await nextTick()
})
