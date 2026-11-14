import type { TranscriptItem } from '../transcript-message-contracts'
import type { TranscriptState } from '../transcript-state-contracts'

export type Timed = Pick<TranscriptItem, 'at'>

export function nextId(state: TranscriptState, prefix: string): string {
  state.seq += 1
  return `${prefix}_${state.seq}`
}

export function itemById(
  state: TranscriptState,
  id: string | undefined,
): TranscriptItem | undefined {
  return id === undefined ? undefined : state.items.find((item) => item.id === id)
}
