import AttentionQueue from '../../src/renderer/src/components/AttentionQueue.vue'
import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import { scene } from '../capture'

const NOW = Date.now()
const request = (n: number, where: string, provider: 'claude' | 'codex'): AttentionRequest => ({
  key: `req-${n}`,
  sessionId: `sess_${n}`,
  requestId: `r${n}`,
  itemId: `i${n}`,
  kind: 'permission',
  where,
  hasACommander: false,
  provider,
  profileId: 'designer',
  who: 'Ada',
  standing: 'waiting: permission',
  asked: 'Run the test suite',
  scope: ['npm test', 'in /work/sample-site'],
  underDisclosed: false,
  detailOmitted: null,
  noPositive: null,
  at: NOW - 120_000 * n,
  decisions: [],
  limit: null,
  sent: false,
  refused: null,
})

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
