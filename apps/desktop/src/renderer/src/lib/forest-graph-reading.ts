import type { ForestSnapshot } from './forest-reading'
import type { WhatIsBeingDone } from '../../../shared/what-is-being-done'
import { forestView, type ForestViewInput } from './the-forest'

export function foldGraphReading(snapshot: ForestSnapshot | null, atWork: WhatIsBeingDone | null, facts: Omit<ForestViewInput, 'forest' | 'atWork'>) {
  const view = forestView({ ...facts, forest: snapshot?.forest ?? null, atWork })
  if (view === null || snapshot === null) return null
  const context = new Set(snapshot.reading.context)
  const reason =
    snapshot.reading.scope.is === 'the-workspace' && snapshot.reading.scope.window === 'all'
      ? ('limit' as const)
      : ('window' as const)
  return {
    ...view,
    reading: snapshot,
    rows: view.rows.map((row) =>
      row.kind === 'a-conversation' && context.has(row.conversation)
        ? { ...row, conversationRow: { ...row.conversationRow!, context: reason } }
        : row,
    ),
  }
}

