import RecentActivity from '../../src/renderer/src/components/RecentActivity.vue'
import { DEFAULT_ACTIVITY_WINDOW_MS } from '../../src/renderer/src/lib/recent-activity'
import type { ActivityLine, RecentActivityReading } from '../../src/shared/recent-activity'
import { scene } from '../capture'

const TO = 1_790_000_000_000
const line = (
  id: string,
  what: ActivityLine['what'],
  ago: number,
  agent: string,
): ActivityLine => ({
  id,
  at: TO - ago * 60_000,
  what,
  register: what === 'finished' || what === 'failed' ? 'claimed' : 'observed',
  piece: { id, label: `W1.${id}`, title: 'Check the release notes' },
  agent,
  conversation: `sess_${id}`,
})
const READING: RecentActivityReading = {
  window: { from: TO - DEFAULT_ACTIVITY_WINDOW_MS, to: TO },
  read: { walk: 'one-window-over-every-agents-conversation', ledgers: 3, rowsUnread: 0 },
  lines: [
    line('1', 'finished', 3, 'Ada'),
    line('2', 'failed', 14, 'Felix'),
    line('3', 'started', 20, 'Ada'),
  ],
  capped: false,
}

scene('recent-activity', (stage) => {
  stage.mount(RecentActivity, { reading: READING, windowMs: DEFAULT_ACTIVITY_WINDOW_MS, clock: TO })
})
