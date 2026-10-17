import { scene } from '../capture'
import { rightPanelStage } from '../fixtures/right-panel'

/** 🎨 **The drawer's Info tab** — paths, the profile, its config and the session ref. */
scene('drawer-info', (stage) => {
  stage.mount(rightPanelStage({ tab: 'info' }), {})
})
