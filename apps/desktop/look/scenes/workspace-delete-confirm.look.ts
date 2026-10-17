import { nextTick } from 'vue'
import WorkspacesSection from '../../src/renderer/src/components/WorkspacesSection.vue'
import { scene } from '../capture'
import { asAMenu, settingsBridge, WORKSPACES } from '../fixtures/workspaces'

/**
 * 🎨 **A confirm: delete a workspace** — what would go to the Trash, asked before anything moves.
 * Fake data: `fixtures/workspaces.ts`.
 */
scene('workspace-delete-confirm', async (stage) => {
  settingsBridge()
  const m = stage.mount(asAMenu(WorkspacesSection), {})
  await new Promise((done) => setTimeout(done, 50))
  m.q(`workspace-delete:${WORKSPACES[1]!.path}`).click()
  await new Promise((done) => setTimeout(done, 50))
  await nextTick()
})
