import { agentName, type AgentIdentity } from '../../../shared/runtime-ipc'
import { pieceLine } from '../../../shared/piece-called'

/**
 * 🔴 **What a row says about words another conversation wrote** (413, reversed in half at 545) —
 * the strings and the one naming function, in one place, because two rows draw them.
 *
 * ## ⛔ One owner, and `406` learned that the hard way one subject over
 *
 * ⚠️ **A relayed message is drawn twice**: as a HELD row while the target conversation is
 * mid-turn, and as a turn once it flushes. `WORK_REPORT_MARK`'s own docblock records what
 * happens when a string like this is spelled at both ends — *"the two spellings had already
 * diverged, so while a reply was held nothing on it said who wrote it."*
 *
 * 🔴 **545 · so the NAME is one function here and not an expression in each entry**, which is
 * `537` §3.1's answer repeated rather than re-decided: one derivation feeding every surface, fixed
 * at the derivation and never at the call sites (`169` §1).
 *
 * ## ⚑ It named nobody until `545`, and `HO-054` §3 reversed exactly half of that ruling
 *
 * ⛔ **`413` §4: *"No invented actor … a turn attributed to the app is not a turn attributed to a
 * named agent unless the ledger holds that name."*** 🔴 **That clause SURVIVES, word for word.**
 * ⚠️ What expired is the REASON the docblock gave for stopping there:
 *
 * > *"the only thing the renderer could print is a `sess_…` handle, and a handle dressed as a
 * > sender is an actor invented out of an id."*
 *
 * ⚑ **`449` made a conversation resolvable to an identity, `537` made five surfaces plus the
 * drawer plate ask {@link agentName}, and `545` put the relayer's identity on the ledger row** —
 * {@link UserTurnEvent.relayedFromProfile}. ⛔ **The reversal is not *invent an actor*: it is that
 * an actor which used to be uninventable is now resolvable.** ⚠️ The conversation id is still not
 * printed anywhere a person reads, because that half did not move.
 *
 * ## ⚠️ What was wrong with the constant, in the PO's words
 *
 * Read the actual relayer on each hop. A chain can pass from BroBot through a manager to a worker; labeling every forwarded message BroBot would misattribute the manager's words.
 */

/**
 * ⛔ **The heading for a relayer this app cannot name** (545) — and that is the whole of what this
 * constant is FOR.
 *
 * ## 🔴 It is a CATEGORY and never a name, which is `413` §4's surviving half
 *
 * ⚠️ **It used to be `BroBot`, and the value moved because the old one is a NAME.** Naming the app
 * as the sender of words the app did not write is the invented actor that ruling forbids — true by
 * coincidence on a BroBot → PM hop and false on every hop below it. ⛔ *Another agent* asserts only
 * what this app actually knows about such a row: somebody who is not the reader wrote it.
 *
 * ## ⚠️ When a reader meets it, and it is not a defensive branch
 *
 * ⛔ **Every relayed row written before `545` reaches this**, because those rows carry the
 * conversation and not the identity — so it is what a person sees on last week's conversations for
 * as long as they keep them. ⚑ It is also the answer for a relaying conversation this app holds no
 * identity for, which is the same `null` `SessionStore.identityOf` returns.
 *
 * Keep this separate from {@link GO_AHEAD_SENDER}: go-aheads and app work reports use the app's own words, while relayed turns carry another sender's words. `words-the-person-did-not-say.test.ts` checks the provenance each row actually claims.
 */
export const AN_UNNAMED_RELAYER = 'Another agent'

/**
 * ⛔ **The subject, where `ContinuationEntry` puts *sent for you* and `WorkReportEntry` puts *work
 * you gave out*.**
 *
 * ⚠️ **It has to contradict *sent for you*, not merely differ from it.** That line is `278`'s and
 * it means *you pressed a button and I sent this on your behalf* — the opposite of what is true
 * here, which is that somebody else is speaking and you are only being shown it. ⛔ `406` refused
 * to mark `routeRequest` precisely because the only entry available said the false thing.
 *
 * ⚑ **545 · it stays, beside a heading that now names somebody.** *project-manager · from another
 * conversation* is WHO and WHERE FROM, which are two facts; the heading answering one of them does
 * not make the other redundant — and on a row this app cannot name, this line is the fact that
 * survives.
 */
export const RELAYED_MARK = 'from another conversation'

/**
 * 🔴 **Who a relayed row is headed by** (545) — the app's ONE naming function, asked once, for every
 * row that draws one: the relayed turn, its held twin, and since `658` a reply's from-line on the
 * work report.
 *
 * ## ⛔ Why it is a function here rather than an expression in each entry
 *
 * ⚠️ **`537` §3.1 found one naming function feeding five surfaces and repaired it at the
 * derivation rather than at the five call sites.** ⛔ The held row and the turn it becomes are the
 * same row a few seconds apart, and `WORK_REPORT_MARK`'s docblock records what happened last time
 * a string like that was spelled at both ends: *"the two spellings had already diverged."*
 *
 * ## 🔴 The `undefined` guard is load-bearing, and the reason is {@link agentName}'s own null
 *
 * ⛔ **{@link agentName} answers *BroBot (default)* for `null`**, because for a CONVERSATION a null
 * profile really did run in the default one. ⚠️ **That reading is false here**: an absent relayer
 * identity is *this app cannot say who*, not *it was BroBot* — so handing the null straight through
 * would re-introduce the exact defect `HO-054` §3 reversed, in a friendlier spelling.
 *
 * @param relayedFromProfile the relayer's identity slug, or `undefined` when the ledger holds none.
 * @param identities the roster, or `null` before the read lands and on a host with no database —
 *   {@link agentName} then answers the slug itself, which is the word every other surface uses.
 */
export function relayedSender(
  relayedFromProfile: string | undefined,
  identities: readonly AgentIdentity[] | null,
): string {
  return relayedFromProfile === undefined
    ? AN_UNNAMED_RELAYER
    : agentName(relayedFromProfile, identities)
}

/**
 * 🔴 **678 · what a card says about the piece its words gave or name** (`671` G2; a piece since
 * D-016) — `null` when they name none: a question, a routed answer, a message about no piece.
 *
 * ⚑ **The piece's own spelling** ({@link pieceLine}) — its label, the one every card and row uses,
 * and the title beside it when the `work_given` that names it is in view. ⚠️ **Just the label when
 * it is not**, never a title guessed from the words; ⛔ **and *Piece* for a piece whose label no row
 * in view spells** — the outgoing reply card's rule for the same honest absence, never a guess.
 */
export function pieceSays(
  piece: { readonly label?: string; readonly title?: string } | undefined,
): string | null {
  if (piece === undefined) return null
  return piece.label === undefined ? 'Piece' : pieceLine(piece.label, piece.title ?? null)
}
