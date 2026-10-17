import { nextTick } from 'vue'
import RecoveryApp from '../../src/renderer/src/components/RecoveryApp.vue'
import {
  CONVERSATIONS,
  fakeRecoveryBridge,
  HEADER_EVENTS,
  HISTORY_ONLY,
} from '../../test/dom/recovery-fake'
import { scene } from '../capture'

/** The read-only history from a restored copy, with one conversation open. Fake data. */
scene('recovery-history', async (stage) => {
  const view = stage.mount(RecoveryApp, {
    bridge: fakeRecoveryBridge({
      verdict: HISTORY_ONLY,
      conversations: CONVERSATIONS,
      transcripts: { 'conv-header': HEADER_EVENTS },
    }),
  })
  // Wait for the list, then open the second conversation as a person would.
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
  view.all('recovery-conversation')[1]?.click()
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
})
