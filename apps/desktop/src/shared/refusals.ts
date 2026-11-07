export const RAIL_PERMANENCES = [
  'permanent',
  'until-a-person-changes-it',
  'while-this-holds',
] as const

export type RailPermanence = (typeof RAIL_PERMANENCES)[number]

export function isRailPermanence(said: unknown): said is RailPermanence {
  return typeof said === 'string' && (RAIL_PERMANENCES as readonly string[]).includes(said)
}

export const PERMANENCE_SAID: Readonly<Record<RailPermanence, string>> = {
  permanent: 'this exact call can never succeed',
  'until-a-person-changes-it': 'until somebody changes it',
  'while-this-holds': 'only while the reason lasts',
}

export function permanenceSaid(permanence: string): string {
  return isRailPermanence(permanence) ? PERMANENCE_SAID[permanence] : permanence
}

export const REFUSAL_REMEDIES = [
  'make-the-same-call-when-this-settles',
  'shorten-the-summary-and-attach-the-long-form',
  'shorten-the-answer-or-put-the-long-form-in-a-file',
  'answer-every-part-the-request-asks-for',
  'offer-a-workspace-markdown-file-that-reads',
  'change-what-you-sent-and-call-again',
] as const

export type RefusalRemedy = (typeof REFUSAL_REMEDIES)[number]

export function isRefusalRemedy(said: unknown): said is RefusalRemedy {
  return typeof said === 'string' && (REFUSAL_REMEDIES as readonly string[]).includes(said)
}

export function refusalReason(reason: string): string {
  if (reason === '' || reason.trim() !== reason)
    throw new Error('A refusal reason must be nonempty and have no boundary whitespace.')
  return reason
}

export const MAX_REFUSAL_TOLD = 4_000

export interface RefusalTold {
  readonly text: string
  readonly dropped: number
}

export function refusalToldOf(sentence: string): RefusalTold {
  if (sentence.length <= MAX_REFUSAL_TOLD) return { text: sentence, dropped: 0 }
  const points = [...sentence]
  const over = points.length - MAX_REFUSAL_TOLD
  return over <= 0
    ? { text: sentence, dropped: 0 }
    : { text: points.slice(0, MAX_REFUSAL_TOLD).join(''), dropped: over }
}

export function storedRefusalTold(stored: unknown): RefusalTold | undefined {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return undefined
  const { text, dropped } = stored as { text?: unknown; dropped?: unknown }
  if (typeof text !== 'string' || text === '') return undefined
  if (typeof dropped !== 'number' || !Number.isSafeInteger(dropped) || dropped < 0) return undefined
  const kept = refusalToldOf(text)
  const counted = kept.dropped + dropped
  if (!Number.isSafeInteger(counted)) return undefined
  return { text: kept.text, dropped: counted }
}
