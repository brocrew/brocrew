import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'

/**
 * The person's queue as a page sees it once its reads answered with nothing in them. Without it,
 * *Waiting on you* is still waiting for its first read, and draws grey cards instead of a list.
 */
export function aQueueReadEmpty(now = Date.now()): void {
  usePersonsQueue().supply(
    { rows: [], walk: 'every-conversation-that-routed', ledgers: 0, rowsUnread: 0 },
    { rows: [], walk: 'every-conversation-that-routed', ledgers: 0, rowsUnread: 0 },
    {
      held: new Set<string>(),
      answerable: new Map(),
      answeredFromHere: new Set<string>(),
      now,
      lastLookAnswered: { questions: true, decisions: true },
    },
    { travel: () => {}, settle: () => {}, takeOver: () => {}, open: () => {} },
  )
}
