import RecoveryApp from '../../src/renderer/src/components/RecoveryApp.vue'
import { COPY_AT, fakeRecoveryBridge } from '../../test/dom/recovery-fake'
import { scene } from '../capture'

/** The failure screen for data changed outside BroBot after a copy was restored. Fake data. */
scene('recovery-failed', (stage) => {
  stage.mount(RecoveryApp, {
    bridge: fakeRecoveryBridge({
      verdict: {
        kind: 'failed',
        reason: 'replaced-outside',
        canRetry: false,
        where: 'gate',
        checkpointCreatedAt: COPY_AT,
        detail:
          'The database on disk is not the one the restore installed: its size and checksum differ.',
      },
    }),
  })
})
