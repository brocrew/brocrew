import { scene } from '../capture'
import { rightPanelStage } from '../fixtures/right-panel'

/** 🎨 **The right panel** — the agent's card. Fake data: `fixtures/right-panel.ts`. */
scene('right-panel', (stage) => {
  stage.mount(rightPanelStage(), {})
})
