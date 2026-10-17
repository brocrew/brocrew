import type { TranscriptItem } from './transcript'

/** What the quiet line at the end of a conversation says while a turn runs: the tool, if one runs. */
export interface WorkingLine {
  readonly tool: string | null
}

/**
 * The line at the end of a conversation for as long as a turn runs, whatever started it — or `null`
 * when the end already shows the turn at work: the model's thinking or its reply, still arriving.
 * It names the tool the turn is waiting on, if any, by the name its row shows.
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
    if (item.result === null && item.unfinished !== true) return { tool: plainToolName(item.name) }
    break
  }
  return { tool: null }
}

/** A server's tool (`mcp__server__tool`) by its own name; any other tool as it is called. */
export function plainToolName(name: string): string {
  if (!name.startsWith('mcp__')) return name
  const at = name.lastIndexOf('__')
  return at > 'mcp_'.length ? name.slice(at + 2) : name
}
