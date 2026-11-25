import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { scene } from '../capture'
import { WORKSPACE, stubRail } from '../fixtures/rail'

/**
 * 🎨 **The rail, collapsed** — icons, and each conversation as its avatar and work label; one
 * conversation needs you. Fake data: `fixtures/rail.ts`, as `rail.look.ts`.
 */
scene('rail-collapsed', (stage) => {
  stubRail('sess_ali')
  stage.mount(
    SideRail,
    { open: [], activeId: 'sess_bro', place: null, workspaceFolder: WORKSPACE, collapsed: true },
    { width: 64 },
  )
})
