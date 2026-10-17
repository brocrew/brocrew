import { scene } from '../capture'
import { rightPanelStage } from '../fixtures/right-panel'

/** 🎨 **The drawer's Changes tab** — what the agent did to the working folder. */
scene('drawer-changes', (stage) => {
  stage.mount(rightPanelStage({ tab: 'changes' }), {})
})
