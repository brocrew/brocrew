/**
 * The shape of a provider's own retention rules for its stored chatter. Each adapter writes its
 * table against these types; `./kept-chatter` reads the tables through `./worker-safe`.
 */

/**
 * How much of one kind of stored provider chatter (an `unknown` event, by its provider, category
 * and label) history keeps: `newest` rows per conversation at any age, the rest removed. A kind
 * with no entry keeps the ordinary rule. Decided with Majid on 26 Nov 2026 (W26, provider-events-list).
 */
export interface KeptChatter {
  /** The category the adapter files this kind under; a row filed otherwise keeps the ordinary rule. */
  readonly category: string
  readonly newest: 0 | 1
  /**
   * Whether a row is the routine form that was decided on. Anything else — a failure, a block, a
   * form the adapter cannot read — stays, however old.
   */
  readonly routine?: (raw: unknown) => boolean
  /**
   * The text of our own input this row reflects back, or null when it carries anything more. Such
   * a row goes only when the conversation's stored input for the same turn sent exactly this text.
   */
  readonly echoed?: (raw: unknown) => string | null
}

export type KeptChatterTable = Readonly<Record<string, KeptChatter>>

/** A repeating warning's kind, recognised by the adapter whose words it is. */
export interface RepeatingWarning {
  readonly kind: string
  readonly said: (message: string) => boolean
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
