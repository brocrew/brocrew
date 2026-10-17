import SettingsScreen from '../../src/renderer/src/components/SettingsScreen.vue'
import { scene } from '../capture'
import { programBridge } from '../fixtures/providers-program'

scene('providers-program-newer-than-tested', async (stage) => {
  programBridge('newer-than-tested')
  stage.mount(SettingsScreen, { capabilities: null, warnings: null, clock: Date.now() })
  await new Promise((done) => setTimeout(done, 80))
})
