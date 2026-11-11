import type { TranscriptItem } from './transcript'

/** What the quiet line at the end of a conversation says while a turn runs: the tool, if one runs. */
export interface WorkingLine {
  readonly tool: string | null
}

/**
 * The line at the end of a conversation for as long as a turn runs, whatever started it — or `null`
 * when the end already shows the turn at work: the model's thinking or its reply, still arriving.
 * Uses the adapter's display name when supplied, otherwise the recorded name.
 */
export function workingLine(
  turnRunning: boolean,
  shown: readonly TranscriptItem[],
): WorkingLine | null {
  if (!turnRunning) return null
  const last = shown.at(-1)
  if ((last?.kind === 'thinking' || last?.kind === 'assistant') && last.streaming) return null
  for (let at = shown.length - 1; at >= 0; at--) {
    const item = shown[at]
    if (item?.kind !== 'tool') continue
    if (item.result === null && item.unfinished !== true) {
      return { tool: item.displayName ?? item.name }
    }
    break
  }
  return { tool: null }
}
