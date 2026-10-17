import WorkspacesSection from '../../src/renderer/src/components/WorkspacesSection.vue'
import { scene } from '../capture'
import { asAMenu, settingsBridge } from '../fixtures/workspaces'

/**
 * 🎨 **The workspace chooser** — every workspace, the one this window runs on, a closed one and a
 * missing one, with the way to make a new one. Fake data: `fixtures/workspaces.ts`.
 */
scene('workspaces', async (stage) => {
  settingsBridge()
  stage.mount(asAMenu(WorkspacesSection), {})
  await new Promise((done) => setTimeout(done, 50))
})
