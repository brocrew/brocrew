/**
 * Archiving and deleting a conversation, as main answers the window.
 *
 * Archive is the everyday action: it keeps everything and takes the conversation and the helpers
 * below it out of the rail, Team and Waiting on you until a person restores it, or until something
 * starts one of them. Delete is a person's alone: it removes the parts they tick, from a list main
 * reads first, and nothing else.
 */

/** What archiving or restoring answered. */
export type ArchiveOutcome =
  | {
      readonly done: true
      /** The conversations it archived or restored: the one asked about, then those below it. */
      readonly conversations: readonly string[]
    }
  | { readonly done: false; readonly refusal: string }

/** One part of a delete the person may tick. */
export interface DeletePart {
  /** What the delete names it by: `records`, `files:<conversation>` or `note:<path>`. */
  readonly id: string
  readonly kind: 'records' | 'provider-files' | 'memory-note'
  /** The line the person reads. */
  readonly says: string
  /** The conversation it belongs to: whose records, whose files, or whose stamp a note carries. */
  readonly conversation: string
  /** The files and folders it removes; empty for the records. */
  readonly paths: readonly string[]
  /** The bytes those files hold; null for the records. */
  readonly bytes: number | null
}

/** What deleting a conversation would remove, read before the person confirms. */
export type DeleteVerdict =
  | {
      readonly ok: true
      readonly conversation: string
      readonly name: string
      /** The helpers below it, which go with its records. */
      readonly helpers: readonly { readonly conversation: string; readonly name: string }[]
      readonly parts: readonly DeletePart[]
      /** What a delete ends: what runs is stopped first, and questions others asked it end. */
      readonly ends: readonly string[]
      /** What stays, said plainly: copies elsewhere, and its files in the person's own folders. */
      readonly stays: readonly string[]
      /** What a delete cannot remove, said plainly. */
      readonly cannot: readonly string[]
    }
  | { readonly ok: false; readonly refusal: string }

/** What a delete did: a refusal removed nothing, and `done` says what was removed. */
export type DeleteOutcome =
  | {
      readonly done: true
      /** Each part removed in full, by its id. */
      readonly removed: readonly string[]
      /** Each file or folder left, with why. */
      readonly left: readonly { readonly path: string; readonly why: string }[]
      /** Why its records were kept though they were ticked, or null. */
      readonly recordsKept: string | null
    }
  | { readonly done: false; readonly refusal: string }
