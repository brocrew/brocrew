import SettingsScreen from '../../src/renderer/src/components/SettingsScreen.vue'
import { useAttentionSignals } from '../../src/renderer/src/composables/useAttentionSignals'
import { scene } from '../capture'
import { dockLabelBridge } from '../fixtures/dock-label'

/** The General preferences in Settings, with their default values; a workspace named Atlas. */
scene('settings-general', async (stage) => {
  useAttentionSignals().value = true
  localStorage.removeItem('brobot2.debugMode')
  dockLabelBridge('Atlas workspace')
  window.api = {
    ...window.api,
    logging: {
      getLogging: async () => ({
        debug: false,
        path: '/fictional/Atlas/logs/brocrew.log',
        servicePath: null,
      }),
      setLoggingDebug: async (debug) => ({
        debug,
        path: '/fictional/Atlas/logs/brocrew.log',
        servicePath: null,
      }),
    },
  }
  stage.mount(SettingsScreen, {
    tab: 'general',
    capabilities: null,
    warnings: null,
    clock: Date.now(),
  })
})
