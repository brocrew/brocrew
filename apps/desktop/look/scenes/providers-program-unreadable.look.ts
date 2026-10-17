import SettingsScreen from '../../src/renderer/src/components/SettingsScreen.vue'
import { scene } from '../capture'
import { programBridge } from '../fixtures/providers-program'

scene('providers-program-unreadable', async (stage) => {
  programBridge('unreadable')
  stage.mount(SettingsScreen, { capabilities: null, warnings: null, clock: Date.now() })
  await new Promise((done) => setTimeout(done, 80))
})
