import type { MailboxKind, PersistedEventInfo } from './runtime-ipc'

/**
 * 🔴 **The mailbox, DERIVED — what one conversation was handed to read, in order, and how each of
 * them ended** (394, HO-007 S4).
 *
 * ## ⛔ Why a fold rather than a flag
 *
 * ⚠️ **A queued message can have no ending.** `354` measured it: `UnqueuedMessageEvent`'s own first
 * line claims an ending is *"always emitted, exactly once, for every `message_queued`"*, and that is
 * **true of a clean quit and false of a crash**. ⛔ **A mailbox with more slots has more ways to end
 * in silence**, so the ending has to be read off the ledger for every slot rather than trusted on
 * one.
 *
 * ⚑ **`ending: null` is therefore a real answer and not a gap** — see {@link MailboxEntry.ending}.
 * It is what a live host holding a message looks like AND what a crash left behind, and those two
 * are byte-identical in the ledger (`354`), so this fold reports the shape and refuses to guess
 * which. The repair that CAN tell them apart is `SessionStore.settleStrandedMessages`, which runs at
 * startup and writes the ending the crash could not — and which already selects **every** unended
 * message per session rather than one, so it needed no change for a mailbox that holds several.
 *
 * ## ⛔ This module imports one TYPE and nothing else
 *
 * The same property `tasks.ts` has, for the same reason: *"the mailbox is a function of the ledger"*
 * is checked by the compiler on every build rather than by a test that has to remember to drop
 * something. There is no mailbox table and no mailbox column — the slot in `RuntimeHost` is a live
 * cache of what these events already say.
 *
 * ## ⚠️ Order is a fact
 *
 * ⛔ **Ledger order is delivery order**, and this fold preserves it because it walks the entries
 * once and appends. `394` §5: *"say what happens to a question that arrives while an earlier one is
 * unanswered, and make it a property somebody can read."* This is that property — the answer is
 * that it takes the next slot, and both are then delivered in the order they arrived.
 */

/** How a held message stopped being held — `UnqueuedMessageEvent.reason`, as this fold reads it. */
export const MAILBOX_ENDINGS = ['sent', 'cancelled', 'retracted', 'abandoned', 'handover'] as const

export type MailboxEnding = (typeof MAILBOX_ENDINGS)[number]

/** One message this conversation was handed to read, as derived. */
export interface MailboxEntry {
  /** `msg_<uuid>` — {@link QueuedMessageEvent.messageId}. */
  readonly messageId: string
  /**
   * ⛔ **`work` when the event carried no kind**, which is every row written before `394`. See
   * {@link QueuedMessageEvent.kind}: the absence is *this is work*, not *unknown*, because work was
   * the only thing that could be held.
   */
  readonly kind: MailboxKind
  /** What was waiting, verbatim, off the event. */
  readonly text: string
  /** Epoch ms it was queued — the `at` of the event, not of anything derived from it. */
  readonly since: number
  /**
   * 🔴 **How it ended, or `null` because nothing has said.**
   *
   * ⛔ **Null is not one of the endings.** It means no `message_unqueued` naming this id has been
   * written — the app is still holding it, or the app died holding it. See this module's note on
   * why no function over the ledger alone may choose between those two.
   */
  readonly ending: MailboxEnding | null
  /** Epoch ms of the ending, or null while there is none. */
  readonly endedAt: number | null
}

/**
 * 🔴 **One session's ledger folded into the messages it was handed, in arrival order.**
 *
 * ⛔ **Pure, total, and ordered by the ledger it was given.** The caller supplies entries in ordinal
 * order — every reader in the app already does — and the fold walks them once.
 *
 * ⚠️ **An unnamed message pairs with nothing** (`354`). A ledger written before messages had ids
 * holds `message_queued` rows with no `messageId`; they are skipped outright rather than folded,
 * because an entry that cannot be named cannot be joined to an ending and inventing a position-based
 * join is how two different messages become one row.
 */
export function mailboxOf(entries: readonly PersistedEventInfo[]): readonly MailboxEntry[] {
  const rows: MailboxEntry[] = []
  const held = new Map<string, number>()
  for (const entry of entries) {
    const event = entry.event
    if (event.type === 'message_queued') {
      if (event.messageId === undefined) continue
      held.set(event.messageId, rows.length)
      rows.push({
        messageId: event.messageId,
        kind: event.kind ?? 'work',
        text: event.text,
        since: entry.at,
        ending: null,
        endedAt: null,
      })
      continue
    }
    if (event.type === 'message_unqueued') {
      if (event.messageId === undefined) continue
      const index = held.get(event.messageId)
      if (index === undefined) continue
      rows[index] = { ...rows[index]!, ending: event.reason, endedAt: entry.at }
      // ⛔ **Removed from the open map, so a SECOND ending for one id changes nothing.** The ledger
      // should never hold two — `handOnWhatItHeld` takes the ending outright and `runFlush` re-checks
      // ownership at every suspension point (`234` §1) — and this fold must not be the place that
      // discovers otherwise by silently overwriting a `sent` with an `abandoned`.
      held.delete(event.messageId)
    }
  }
  return rows
}

/**
 * ⚑ **The slots nothing has ended** — the derived form of *"what is this conversation still holding"*.
 *
 * ⛔ **Derived from {@link mailboxOf} rather than from a second walk**, so the two can never
 * disagree about what an ending is.
 */
export function stillHeld(entries: readonly PersistedEventInfo[]): readonly MailboxEntry[] {
  return mailboxOf(entries).filter((one) => one.ending === null)
}
