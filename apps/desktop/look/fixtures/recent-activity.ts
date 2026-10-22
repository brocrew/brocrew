import { DEFAULT_ACTIVITY_WINDOW_MS } from '../../src/renderer/src/lib/recent-activity'
import type { ActivityLine, RecentActivityReading } from '../../src/shared/recent-activity'

/**
 * A Recent activity reading that draws every kind of card the page has: a skill-name clash, a
 * transcript clearing, and two days of lines in every state, with the reported-outcomes note.
 * Fake data only.
 */
export const ACTIVITY_NOW = 1_790_000_000_000

const line = (
  id: string,
  what: ActivityLine['what'],
  ago: number,
  agent: string,
  title: string | null,
): ActivityLine => ({
  id,
  at: ACTIVITY_NOW - ago * 60_000,
  what,
  register: what === 'finished' || what === 'failed' ? 'claimed' : 'observed',
  piece: { id, label: `W1.${id}`, title },
  agent,
  conversation: `sess_${id}`,
})

export const EVERY_CARD: RecentActivityReading = {
  window: { from: ACTIVITY_NOW - 7 * 24 * 3_600_000, to: ACTIVITY_NOW },
  read: { walk: 'one-window-over-every-agents-conversation', ledgers: 4, rowsUnread: 0 },
  skillImports: [
    {
      id: 'imp_1',
      at: ACTIVITY_NOW - 40 * 60_000,
      name: 'release-notes',
      existing: 'release-notes',
      imported: 'release-notes-2',
    },
  ],
  transcriptsCleared: [
    { at: ACTIVITY_NOW - 90 * 60_000, days: 30, conversations: 12, bytes: 48_500_000 },
  ],
  lines: [
    line('1', 'finished', 3, 'Ada', 'Check the release notes'),
    line('2', 'failed', 14, 'Felix', 'Build the Sunday menu page'),
    line('3', 'started', 20, 'Ada', 'Draft the bakery’s opening hours'),
    line('4', 'stopped', 26 * 60, 'Mai', 'Compare the two dessert suppliers'),
    line('5', 'finished', 27 * 60, 'Ali', null),
  ],
  capped: false,
}

export const ACTIVITY_WINDOW = DEFAULT_ACTIVITY_WINDOW_MS
