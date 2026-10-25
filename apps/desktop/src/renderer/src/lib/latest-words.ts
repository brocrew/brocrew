import type { TranscriptState } from './transcript'

/**
 * # ⚑ The agent's latest words, for the bubble on its card
 *
 * Show the agent's latest words beside its plate with their age.
 *
 * ⛔ **Read off the transcript this window holds, and nowhere else** — so only the conversation on
 * screen has a bubble. An agent under it is a rail row here, and a rail row carries no words.
 *
 * ⚠️ **The agent's OWN words**: a sub-agent's turn waiting for its card (`parentToolCallId`) is not
 * the conversation speaking, and a turn with no words draws no bubble rather than an empty one.
 */
export interface LatestWords {
  /** ⚑ The item the words are, so a press can show them in the conversation. */
  readonly itemId: string
  /** ⚑ One paragraph: each line's markdown marks taken off, the lines joined by a space. */
  readonly text: string
  /** ⚑ When the message began, or `null` where the fold had no clock. */
  readonly at: number | null
}

export function latestWords(state: TranscriptState): LatestWords | null {
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]
    if (item?.kind !== 'assistant' || item.parentToolCallId !== undefined) continue
    const text = plainParagraph(item.text)
    if (text === '') continue
    return { itemId: item.id, text, at: item.at ?? null }
  }
  return null
}

/** The latest human final takes precedence; pending human turns retain the existing response. */
export function panelWords(state: TranscriptState): LatestWords | null {
  const final = state.humanAnswers.latest?.final
  if (final == null) return latestWords(state)
  const item = state.items.find((one) => one.kind === 'assistant' && one.ordinal === final.ordinal)
  return { itemId: item?.id ?? `human-final-${final.ordinal}`, text: plainParagraph(final.text), at: final.at }
}

/**
 * ⚑ **A message as one paragraph a person reads at a glance** — a heading, quote or bullet lead,
 * bold, italics, inline code, a link's brackets and a code fence taken off, every line kept.
 * ⚠️ The bubble's `title` keeps the words exactly as written.
 */
const FENCE = /^\s{0,3}(```|~~~)/
const LEAD = /^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/
const BOLD = /(\*\*|__)(.+?)\1/g
const ITALIC = /(^|\s)[*_](\S(?:[^*_]*\S)?)[*_](?=\s|[.,;:!?)]|$)/g
const CODE = /`([^`]+)`/g
const LINK = /\[([^\]]+)\]\([^)]*\)/g

export function plainParagraph(words: string): string {
  return words
    .split('\n')
    .filter((line) => !FENCE.test(line))
    .map((line) =>
      line
        .replace(LEAD, '')
        .replace(BOLD, '$2')
        .replace(ITALIC, '$1$2')
        .replace(CODE, '$1')
        .replace(LINK, '$1')
        .trim(),
    )
    .filter((line) => line !== '')
    .join(' ')
}
