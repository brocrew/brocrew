/** The window supplies the same count it draws in Waiting on you. */
export const ATTENTION_SIGNALS_CHANNEL = 'app:attention-signals'

/** Native badge APIs accept signed integer counts. Arrival numbers never wrap within a document. */
export const MAX_ATTENTION_COUNT = 0x7fffffff
export const MAX_ATTENTION_ARRIVAL = Number.MAX_SAFE_INTEGER

export interface AttentionSignal {
  readonly enabled: boolean
  readonly count: number
  /** Increasing within a document, and unchanged when only the badge or preference changes. */
  readonly arrival: number
}

export function isAttentionSignal(value: unknown): value is AttentionSignal {
  if (value === null || typeof value !== 'object') return false
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== 3 ||
    !keys.every((key) => ['enabled', 'count', 'arrival'].includes(String(key)))
  ) {
    return false
  }
  const signal = value as Partial<AttentionSignal>
  return (
    typeof signal.enabled === 'boolean' &&
    typeof signal.count === 'number' &&
    Number.isInteger(signal.count) &&
    signal.count >= 0 &&
    signal.count <= MAX_ATTENTION_COUNT &&
    typeof signal.arrival === 'number' &&
    Number.isSafeInteger(signal.arrival) &&
    signal.arrival >= 0 &&
    signal.arrival <= MAX_ATTENTION_ARRIVAL
  )
}
