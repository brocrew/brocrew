import RecoveryApp from '../../src/renderer/src/components/RecoveryApp.vue'
import { fakeRecoveryBridge, NEWER_WITH_A_COPY } from '../../test/dom/recovery-fake'
import { scene } from '../capture'

/** The refusal for data a newer BroBot changed, with a copy this build can restore. Fake data. */
scene('recovery-refusal', (stage) => {
  stage.mount(RecoveryApp, { bridge: fakeRecoveryBridge({ verdict: NEWER_WITH_A_COPY }) })
})
