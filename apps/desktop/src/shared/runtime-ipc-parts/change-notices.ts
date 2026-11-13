import type { PublicationEpoch } from '../data-version'

/**
 * Subjects of invalidation notices. A notice names what must be read again;
 * it carries no replacement data. Live state and kept-file deltas travel on
 * RUNTIME_STATES_CHANNEL instead. Derive the type from these values so validation
 * and the preload filter share the same vocabulary.
 */
export const RUNTIME_CHANGE_SUBJECTS = ['conversations', 'agents', 'work', 'persons'] as const

/** One of {@link RUNTIME_CHANGE_SUBJECTS}. */
export type RuntimeChangeSubject = (typeof RUNTIME_CHANGE_SUBJECTS)[number]

/**
 * ⚑ **The whole payload**: which population is stale. See {@link RUNTIME_CHANGED_CHANNEL}.
 *
 * ⚠️ **A message per subject rather than a list of them**, so a reader never has to decide what a
 * partially-understood message means: a subject it does not know is one message it drops, and every
 * other message is unaffected.
 */
export interface RuntimeChangeMessage {
  readonly what: RuntimeChangeSubject
  /** On a `persons` or `conversations` notice: the publication it was made at. */
  readonly published?: { readonly epoch: PublicationEpoch; readonly seq: number }
}
