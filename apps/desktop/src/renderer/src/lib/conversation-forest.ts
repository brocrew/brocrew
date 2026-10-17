import type { ForestView } from './the-forest'

/** Keep the whole top-level tree containing this conversation, including its task rows. */
export function conversationForest(
  view: ForestView | null,
  conversation: string,
): ForestView | null {
  if (view === null) return null
  const here = view.placeOf?.get(conversation) ?? conversation
  const at = view.rows.findIndex(
    (row) => row.kind === 'a-conversation' && row.conversation === here,
  )
  if (at === -1) return { ...view, rows: [] }

  let start = at
  while (start > 0 && view.rows[start]!.depth !== 0) start -= 1
  let end = at + 1
  while (end < view.rows.length && view.rows[end]!.depth !== 0) end += 1
  return { ...view, rows: view.rows.slice(start, end) }
}
