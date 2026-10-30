import type { ToolItem } from './transcript'

/**
 * ⚑ **Whether a call draws as a card rather than a tool row** — the one question every surface asks
 * (the transcript, `inACard`, `joinsARun`, and a refusal's receipt). ⚑ A recognised call is a card,
 * except an `update_work` whose new brief's row has not landed (D-047): it stays the tool row it
 * always was — a ledger from before D-047, or the moment before its row.
 */
export function drawsAsACard(item: Pick<ToolItem, 'outgoing'>): boolean {
  const words = item.outgoing
  if (words === undefined) return false
  if (words.tool === 'request_action') return words.asked?.action !== undefined
  return words.tool !== 'update_work' || words.rebriefed !== null
}
