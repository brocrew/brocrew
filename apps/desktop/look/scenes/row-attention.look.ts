import AttentionQueue from '../../src/renderer/src/components/AttentionQueue.vue'
import {
  attentionToACardNobodyHolds,
  type AttentionRequest,
} from '../../src/renderer/src/lib/attention'
import { scene } from '../capture'

const NOW = Date.now()
function request(n: number, where: string, provider: 'claude' | 'codex'): AttentionRequest {
  const row = attentionToACardNobodyHolds(
    `sess_${n}`,
    {
      asked: {
        type: 'permission_request',
        id: `r${n}`,
        kind: 'command',
        action: 'Run the test suite',
        detail: 'npm test',
        scope: {
          cwd: '/work/sample-site',
          paths: [],
          networkHosts: [],
          persistence: 'once',
          amendments: [],
          availableDecisions: ['allow', 'deny'],
          underDisclosed: false,
        },
      },
      provider,
      profileId: 'designer',
    },
    { sent: false, refused: null },
    () => 'Ada',
  )
  if (!row) throw new Error('The sample permission produced no attention row')
  return { ...row, key: `req-${n}`, where, at: NOW - 120_000 * n }
}

/** 🎨 Home's attention queue, one row per conversation asking. Fake data. */
scene('row-attention', async (stage) => {
  stage.mount(
    AttentionQueue,
    {
      requests: [
        request(1, 'W1.2 · Landing page header', 'claude'),
        request(2, 'W1.3 · Contact form', 'codex'),
      ],
      now: NOW,
    },
    { width: 760 },
  )
  await new Promise((done) => setTimeout(done, 50))
})
