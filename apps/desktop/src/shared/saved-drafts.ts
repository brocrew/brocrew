import type { HandedPath } from './runtime-ipc'

/**
 * # 🔴 744 · R100 — what a person typed and did not send, as it crosses to disk and back
 *
 * Save every draft slot and its attached paths in the app's userData shortly after changes and on quit. Restore them to the same slots on launch. Saving never sends the draft.
 *
 * ⚠️ **The slots are `drafts.ts`' key space, carried as it is**: `new` for the launcher and
 * `session:<id>` for a conversation, a kept-open pane's included — one slot per conversation, so a
 * draft restored under its id cannot come back in any other conversation (`019`'s rule).
 * {@link conversationOfSlot} is main's reading of that key space, and
 * `a-draft-survives-a-restart.test.ts` pins the two together.
 */

/** One slot's unsent message: its words and what is attached to it. */
export interface SavedDraft {
  /** `new`, or `session:<id>` — `drafts.ts`' `NEW_CONVERSATION` and `draftKey`. */
  slot: string
  /** What is typed, or `''` when only attachments are waiting. */
  text: string
  /**
   * What is attached. ⚠️ **On the way BACK, a path that is no longer there carries `missing: true`**
   * — main's caption, from the one classifier (`handed-path.ts`), so the chip can say so instead of
   * the path vanishing from the message in silence.
   */
  attached: HandedPath[]
}

/** Every slot holding something, in no particular order. */
export interface SavedDrafts {
  drafts: SavedDraft[]
  /**
   * ⚑ **Present on the book a window hands over when the QUIT asks for it** (`LAST_DRAFT_SAVE_CHANNEL`)
   * — the one main waits for. Every other save leaves it out.
   */
  last?: true
}

/**
 * 🔴 **Main→renderer: the conversations are closed — hand over the book once more** (744).
 *
 * ⚑ **Sent by the quit AFTER it has closed the conversations**, because closing them is what
 * refuses a send or a start that was still in flight, and the refusal puts its words back in the
 * book: the book the window holds at this moment is the one to keep, and main waits for it
 * (`QUIT_SAVE_WITHIN_MS`). ⚠️ Its own channel, like `app:closing`, because it is about the
 * application ending rather than about any conversation.
 */
export const LAST_DRAFT_SAVE_CHANNEL = 'app:last-draft-save'

/** The launcher's slot — `drafts.ts`' `NEW_CONVERSATION`, which has no conversation. */
export const LAUNCHER_SLOT = 'new'

const CONVERSATION_SLOT = 'session:'

/**
 * ⚑ **Whose slot this is**: the conversation's id, `null` for the launcher, and `undefined` for a
 * string that is neither — which a reader of the saved file DROPS rather than guesses at.
 */
export function conversationOfSlot(slot: string): string | null | undefined {
  if (slot === LAUNCHER_SLOT) return null
  if (!slot.startsWith(CONVERSATION_SLOT)) return undefined
  const id = slot.slice(CONVERSATION_SLOT.length)
  return id === '' ? undefined : id
}
