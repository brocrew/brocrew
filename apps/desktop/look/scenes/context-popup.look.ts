import { nextTick } from 'vue'
import { scene } from '../capture'
import { windowStage } from '../fixtures/window'

/** 🎨 **The Context popup — opened from the context figure in the panel’s model row** — over the whole window, as it opens. Fake data: `fixtures/right-panel.ts`. */
scene('context-popup', async (stage) => {
  const m = stage.mount(windowStage(), {})
  await new Promise((done) => setTimeout(done, 50))
  m.q('card-run-context').click()
  await nextTick()
})
