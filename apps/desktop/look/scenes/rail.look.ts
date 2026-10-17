import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { scene } from '../capture'

/**
 * 🎨 **The rail** — the left navigation, its conversation list and the workspace footer.
 * ⚑ To make another: copy this file and change the CONVERSATIONS and the WORKSPACE (fake data only).
 */
const CONVERSATIONS = [
  { id: 'sess_ada', label: 'Ada', profileId: 'designer', title: 'W1.2 · Landing page header' },
  { id: 'sess_ali', label: 'Ali', profileId: 'developer', title: 'W1.3 · Contact form' },
  { id: 'sess_bro', label: 'BroBot', profileId: 'default', title: 'W1 · Bakery website' },
]

const WORKSPACE = {
  name: 'Default',
  path: '/Users/someone/Library/Application Support/@brobot2/desktop',
  isDefault: true,
}

scene('rail', (stage) => {
  window.api = {
    runtime: {
      listResumable: async () =>
        CONVERSATIONS.map((one, index) => ({
          sessionId: one.id,
          provider: 'claude',
          cwd: '/Users/someone/BroBot workspaces/Default/brobot-workspace',
          status: 'idle',
          state: { is: 'idle' },
          label: one.label,
          profileId: one.profileId,
          named: { label: one.title.split(' · ')[0], title: one.title.split(' · ')[1] },
          updatedAt: Date.now() - index * 60_000,
          createdAt: Date.now() - 3_600_000,
          running: 'unwatched',
          inAnotherWindow: false,
        })),
      listUnresumable: async () => [],
    },
  } as never
  stage.mount(
    SideRail,
    { open: [], activeId: null, place: null, workspaceFolder: WORKSPACE },
    // The shipped --rail-w.
    { width: 251.68 },
  )
})
