import { agentName, type AgentIdentity } from '../../../shared/runtime-ipc'
import { AN_UNNAMED_PARENT } from './outgoing-card'

/**
 * 🔴 **667 · a reply that reached nobody, said the way its card says it** (`658`'s G3).
 *
 * ## ⛔ What the notice printed until this dispatch
 *
 * > *"the reply to task_… did not reach sess_…: no-conversation"*
 *
 * ⚠️ **Three words a person cannot read, beside a card that already said all of it in words** — the
 * card reads *"Ada to BroBot · W1.2 · reply · not delivered"*. ⛔ A raw id where the card says
 * *W1.2*, a `sess_` handle where the card names the agent, and a closed-vocabulary word where a
 * person needs a reason.
 *
 * ## ⚑ Three facts, each asked of the function the card asks
 *
 * | fact | ⚑ from |
 * |---|---|
 * | the piece | its label, from this ledger's `work_given` — the work report's heading and the card's, one spelling |
 * | the parent | {@link agentName} over the roster, or {@link AN_UNNAMED_PARENT} — the card's recipient word |
 * | why | {@link UNDELIVERED_REASON_WORDS} — exhaustive over the delivery's reasons, so no raw word reaches a person; ⚠️ since `729` (R89) main also writes `held-then-lost`, a LATER loss with no words here yet (the frontend's), so the sentence gives no reason; ⚑ since D-017 (R14) the row's `detail` follows, in the words of what failed |
 */

/**
 * 🔴 **The answers `reply_to_parent`'s delivery can give that landed NOWHERE** — `REPLY_DELIVERIES`'
 * members that `REPLY_LANDED` marks `false`, in `main/runtime/reply-rails.ts`.
 *
 * ## ⛔ Spelled here because the renderer cannot import `main/`, and PINNED so it cannot drift
 *
 * ⚠️ **`tsconfig.web.json` holds `renderer/` and `shared/` and nothing else**, so this type cannot
 * be `Exclude<ReplyDelivery, …>`. ⚑ **`test/the-three-sentences-beside-the-cards.test.ts` §1 is
 * compiled by `tsconfig.node.json`, which sees both sides, and it asserts at the TYPE level that main's
 * vocabulary is exactly this one plus the three that landed** — so a new delivery answer in main
 * is a compile error in `pnpm run typecheck`, and never a raw word on a person's screen.
 * ⚑ **D-017 · R14 — `no-conversation` is gone**: a giver that is not running is started for the
 * reply, so a row that still says it is read with no reason.
 */
export type UndeliveredReason = 'not-delivered'

/**
 * ⚑ **Why a reply reached nobody, in words** — one clause per reason, after a colon.
 *
 * ⛔ **Each clause is a fact about THIS reply**, from the reason's own docblock in `reply-rails.ts`,
 * and never a sentence about how replies are routed (HO-015 §2). ⚠️ **Past tense**: the notice is a
 * record of something that happened, and the parent may be running again by the time it is read.
 */
export const UNDELIVERED_REASON_WORDS = {
  'not-delivered': 'something went wrong on the way',
} as const satisfies Record<UndeliveredReason, string>

/**
 * ⚑ A word this build has words for — a row from a later build answers `false` and prints no reason,
 * and so, since `729`, does `held-then-lost` (R89), which this build's main writes and this table has
 * no words for yet — and, since D-010, a row an EARLIER build wrote `parent-is-holding-a-message`,
 * the answer a busy parent gave before it held replies; and since D-017, `no-conversation`.
 */
export function isUndeliveredReason(word: unknown): word is UndeliveredReason {
  return typeof word === 'string' && Object.hasOwn(UNDELIVERED_REASON_WORDS, word)
}

/**
 * ⚑ **What the fold knows about a lost reply**, kept as FACTS so the sentence can name the parent
 * through the roster at the moment it is drawn — the roster arrives later than the ledger, and a
 * name frozen into the row at fold time would be the slug forever.
 */
export interface LostReply {
  /** The piece's label, when its `work_given` is in this transcript. */
  readonly label?: string
  /**
   * The identity that gave the piece — ⛔ **only when the brief in view names it**, so a name is
   * never borrowed from a different giver.
   */
  readonly toProfile?: string
  /** ⛔ `null` for a word this build does not know: the sentence then gives no reason, never the word. */
  readonly because: UndeliveredReason | null
  /**
   * ⚑ **D-017 · R14 — what failed, in its own words** (`ReplyUndeliveredEvent.detail`): since D-030
   * why nothing could hold the words for the giver — its record would not take them, or they could
   * not be composed; ⚠️ a row an earlier build wrote may name a start that failed. Absent on rows
   * written before D-017.
   */
  readonly detail?: string
}

/**
 * 🔴 **The sentence**: *"the reply to W1.2 did not reach Ada: something went wrong on the way —
 * <what failed>"*.
 *
 * ⚠️ **No label → *the reply*; no name → *its parent*; no reason → the sentence stops at the name**,
 * or gives only what failed. ⛔ **Each fallback says less, never something else** — no id, no
 * handle and no raw word of this app's vocabulary.
 */
export function lostReplySentence(
  lost: LostReply,
  identities: readonly AgentIdentity[] | null,
): string {
  const reply = lost.label === undefined ? 'the reply' : `the reply to ${lost.label}`
  const whom =
    lost.toProfile === undefined ? AN_UNNAMED_PARENT : agentName(lost.toProfile, identities)
  const said = `${reply} did not reach ${whom}`
  const why = [
    lost.because === null ? null : UNDELIVERED_REASON_WORDS[lost.because],
    lost.detail ?? null,
  ].filter((part) => part !== null)
  return why.length === 0 ? said : `${said}: ${why.join(' — ')}`
}
