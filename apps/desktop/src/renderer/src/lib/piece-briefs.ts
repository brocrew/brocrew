import type { TranscriptState } from './transcript'

/**
 * Each piece's brief, by its label: the trimmed words of the relayed turn that opened it
 * (`RelayedItem.opened`). Blank words never count, and the newest nonempty brief for a label
 * replaces the older one.
 */
export function briefsOf(state: TranscriptState): ReadonlyMap<string, string> {
  const found = new Map<string, string>()
  for (const item of state.items) {
    if (item.kind !== 'relayed') continue
    const label = item.opened?.label
    const text = item.text.trim()
    if (label !== undefined && text !== '') found.set(label, text)
  }
  return found
}
