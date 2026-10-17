import UpdatesMenu from '../../src/renderer/src/components/UpdatesMenu.vue'
import { scene } from '../capture'
import { asAMenu, settingsBridge } from '../fixtures/workspaces'

/**
 * 🎨 **Settings** — the menu the rail's footer opens: the workspaces, this BroBot's version and its
 * updates, with the two switches. Fake data: `fixtures/workspaces.ts`.
 */
scene('settings', async (stage) => {
  settingsBridge()
  stage.mount(asAMenu(UpdatesMenu, { version: '0.9.2' }), {})
  // ⚑ Let the two reads answer before the picture.
  await new Promise((done) => setTimeout(done, 50))
})
