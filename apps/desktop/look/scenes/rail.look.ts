import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { scene } from '../capture'
import { WORKSPACE, stubRail } from '../fixtures/rail'

/**
 * 🎨 **The rail** — the left navigation, its conversation list and the workspace footer.
 * ⚑ Fake data: `fixtures/rail.ts`.
 */
scene('rail', (stage) => {
  stubRail()
  stage.mount(
    SideRail,
    { open: [], activeId: null, place: null, workspaceFolder: WORKSPACE },
    // The shipped --rail-w.
    { width: 251.68 },
  )
})
