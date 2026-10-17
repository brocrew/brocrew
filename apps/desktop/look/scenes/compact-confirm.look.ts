import { nextTick } from 'vue'
import { scene } from '../capture'
import { windowStage } from '../fixtures/window'

/** 🎨 **A confirm: compact the conversation — asked in the Context popup before /compact goes** — over the whole window, as it opens. Fake data: `fixtures/right-panel.ts`. */
scene('compact-confirm', async (stage) => {
  const m = stage.mount(windowStage(), {})
  await new Promise((done) => setTimeout(done, 50))
  m.q('card-run-context').click()
  await nextTick()
  m.q('context-compact-now').click()
  await nextTick()
})
