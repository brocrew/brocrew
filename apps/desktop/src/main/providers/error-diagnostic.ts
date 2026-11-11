import type { TranscriptEvent } from '../../shared/conversation-events'
import type { ErrorFacts } from '../../shared/error-facts'

export const TURN_FAILED = 'turn failed'
const TURN_FAILED_PREFIX = `${TURN_FAILED}: `
const MAX_DEPTH = 4
const MAX_ENVELOPE_CHARS = 64 * 1024

/** The same diagnostic reading serves live delivery and each source-owned history reader. */
export function errorFactsForEvent(event: TranscriptEvent): ErrorFacts | undefined {
  if (event.type !== 'error') return undefined
  const ending = turnFailureDetail(event.message)
  return {
    sentence: providerErrorSentence(event.message),
    ...(ending === null
      ? {}
      : { ending: { raw: ending, sentence: providerErrorSentence(ending) } }),
  }
}

/** Preserve prose and unknown diagnostics; unwrap only bounded object envelopes. */
export function providerErrorSentence(message: string): string {
  let text = message
  for (let unwrapped = 0; unwrapped < MAX_DEPTH; unwrapped += 1) {
    const inner = sentenceInEnvelope(text)
    if (inner === null) return text
    text = inner
  }
  return text
}

function sentenceInEnvelope(message: string): string | null {
  const text = message.trim()
  if (!text.startsWith('{') || text.length > MAX_ENVELOPE_CHARS) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  let said: string | null = null
  let node: unknown = parsed
  for (let depth = 0; depth < MAX_DEPTH && isRecord(node); depth += 1) {
    const nested: unknown = node['message']
    if (typeof nested === 'string' && nested.trim() !== '') said = nested.trim()
    node = node['error']
  }
  return said
}

/** Recognize the runtime's terminal spelling when projecting current and older recorded rows. */
export function turnFailureDetail(message: string): string | null {
  if (message === TURN_FAILED) return ''
  if (message.startsWith(TURN_FAILED_PREFIX)) return message.slice(TURN_FAILED_PREFIX.length)
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
