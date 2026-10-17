import SettingsScreen from '../../src/renderer/src/components/SettingsScreen.vue'
import { useAttentionSignals } from '../../src/renderer/src/composables/useAttentionSignals'
import { useDebugMode } from '../../src/renderer/src/composables/useDebugMode'
import { scene } from '../capture'
import { dockLabelBridge } from '../fixtures/dock-label'

/** The General preferences in Settings, with their default values; a workspace named Atlas. */
scene('settings-general', async (stage) => {
  useAttentionSignals().value = true
  useDebugMode().value = false
  dockLabelBridge('Atlas workspace')
  stage.mount(SettingsScreen, {
    tab: 'general',
    capabilities: null,
    warnings: null,
    clock: Date.now(),
  })
})
