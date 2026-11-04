import { randomUUID } from 'node:crypto'
import type { AStopAskedFor, TurnOrigin } from './turn-origin'
import type {
  HandedPath,
  MailboxKind,
  QueuedMessageDisclosure,
  TheQuestionItAsks,
  TurnAuthorship,
} from '../../shared/runtime-ipc'

/**
 * 🔴 **The messages one session is holding, and what you can only say about one once it has a
 * name** (354).
 *
 * ## ⛔ Its own module so the host and the disclosure share one shape
 *
 * ⚠️ **What is NOT here is policy.** Where a message may be held, who may cancel one, and what
 * happens to it when a conversation ends are all decisions {@link RuntimeHost} makes; this file
 * holds the shape and the mint. ⛔ `MessageAlreadyHeld` lived here until D-010 let a conversation
 * hold any number of messages, and `WorkAlreadyOpen` until D-016: a busy conversation takes a piece
 * of work now, and only a stalled one refuses it — a rail `give_work` asks before anything is sent.
 */

/**
 * 🔴 **The held message's own name** (354) — `msg_<uuid>`, in the house shape `sess_`/`evt_`/`turn_`
 * already use.
 *
 * ⚠️ **Minted in the main process, never supplied by a caller.** It is what a cancel names, so an id
 * anybody could choose would let one caller take back a message it was never shown.
 */
export const newQueuedMessageId = (): string => `msg_${randomUUID()}`

/** A message the user wrote mid-turn and asked us to hold (077), with a name of its own (354). */
export interface QueuedMessage {
  /** Its durable queue ending was written before this move's provider handoff. */
  moveHandoverStarted?: true
  /**
   * 🔴 **What this message is called** (354) — see {@link newQueuedMessageId}.
   *
   * ⛔ **On the SLOT, and therefore gone at a restart** — which is the answer to *"is the id
   * durable"* rather than an omission. A resumed conversation comes back holding nothing at all
   * (077; see the empty mailbox a resume passes {@link RuntimeHost.discloseReopened}), so there is
   * never an id here for a message a previous run of this app was holding. ⚑ **The durable half is
   * the PAIR OF EVENTS**: both carry this string, so a reader rebuilding from the ledger can name
   * the message by id rather than by position, even though nothing is holding it any more.
   */
  readonly id: string
  /**
   * 🔴 **Which kind of thing is waiting** (394) — one of `MAILBOX_KINDS`.
   *
   * ⛔ **It decides — since `624` — whether a person may take it back** (and until D-010 it decided
   * whether a second one could be held). ⚠️ **This read *"and nothing else: delivery, cancellation and the endings are
   * identical for both"*, and the cancellation half went false**: `HO-095` §6.2 ruled that a
   * person may not cancel the app's delivery of a fact, and {@link
   * RuntimeHost.cancelQueuedMessage} refuses a `'notice'` by this word. ⚑ **Delivery is still
   * identical for all three** — a kind that changed how a message is CARRIED would be three
   * delivery paths with one name, which is what {@link RuntimeHost.deliverReply} refused to build.
   * 🔴 **690 · but not the endings any more**: only this app's own notices can end `retracted` — a
   * `'notice'` once a later fact made it false (R32), and a `'question'`, its notice of a question,
   * once that question has stopped waiting ({@link asks}).
   */
  readonly kind: MailboxKind
  /**
   * ⚑ **D-022 · R1 — the words it was held with**; a held give goes out with its piece's NEWEST
   * brief, read at the handover ({@link RuntimeHost.runFlush}).
   */
  readonly text: string
  /** Epoch ms it was queued — shown as "waiting since", and recorded with it. */
  readonly since: number
  /**
   * ⛔ **Paths attached to it, held with it** (216 §2).
   *
   * ⚠️ **Without this a message queued behind a running turn would send its words and silently drop
   * its attachments** — the chip vanishing from the composer as if it had gone. `215` §3.2 names
   * this exact hazard ("input needs stable identity across acceptance, queue and replay"); this is
   * the narrow version of it that a path-only attachment actually needs, which is to hold the list
   * beside the text it belongs to and re-check it at the flush.
   */
  readonly attachments: readonly HandedPath[]
  /**
   * 🔴 **Whose words these are, and what they are about** (413, from 406) — see
   * {@link TurnAuthorship}.
   *
   * ⛔ **Held here for {@link attachments}' reason, one field over.** The flush builds the
   * `user_turn` from this record, so anything that lived only on the queue-time event would be
   * dropped by exactly the branch a busy parent takes — and the message would land in the
   * transcript as the person's own bubble.
   *
   * ## ⚠️ It replaced a bare `report`, and the difference is what `410` measured
   *
   * ⛔ **`406` held the `WorkReport` alone and the flush rebuilt the authorship from it** —
   * *"a report is present, therefore the app sent this."* ⚑ That reasoning is right for the two
   * producers `406` had and wrong for the two it did not: a routed question and an agent's work
   * carry no report, so they flushed as the person's. **The value is computed once at the door and
   * carried whole.**
   *
   * ⚠️ **`{}` for every message a person wrote**, which is almost all of them — and it is
   * REQUIRED rather than optional so a new way to fill the mailbox has to answer the question.
   */
  readonly authorship: TurnAuthorship
  /**
   * 🔴 **The piece these words deliver, when they are a brief `give_work` sent, or a new brief
   * `update_work` sent** (412 as a task, `410` F1; a piece since D-016) — `UserTurnEvent.piece`.
   *
   * ⛔ **Held here for {@link authorship}'s reason, one field over.** The label is composed into the
   * string the provider receives — the sender line and the line that says how to finish it — and
   * that composition happens at the FLUSH, so a piece known only at queue time would reach every
   * conversation that happened to be idle and none that was busy.
   *
   * ⚑ **It survives a restart**: the `message_queued` row names the piece, and a held brief rebuilt
   * from its row reads it back off that row — so the turn it becomes still delivers the piece, and a
   * take-back or a close still finds it.
   *
   * ⛔ **Absent, never null** — the shape every optional field on a held message and on a transcript
   * event already uses, so *a message that is not a brief* carries no such key at all.
   */
  readonly piece?: string
  /** ⚑ **The piece's label** (`W1.2`), present only beside {@link piece} — `UserTurnEvent.label`. */
  readonly label?: string
  /**
   * ⚑ **D-016 · these words are a NEW brief of {@link piece}** (`update_work`), not the brief that
   * gave it — present only beside it, so the sender line says which. `QueuedMessageEvent.rebrief`.
   */
  readonly rebrief?: true
  /**
   * 🔴 **D-016 · commit 6 · R4 — the piece of this conversation's these words drive, when they name
   * one** — `UserTurnEvent.drives`: the piece they name when this conversation holds it, else its
   * own piece the named one hangs under. ⚑ Held here for {@link piece}'s reason: the flush writes the
   * turn from this record. ⛔ Absent on words that name no piece, which drive every open piece, and
   * beside a {@link piece}, which names what a brief drives.
   */
  readonly drives?: string
  /**
   * 🔴 **F088 · the piece these words NAME, when an agent's note or follow-up names one** — the piece
   * itself, which {@link drives} is not when it hangs under a piece of this conversation's: a helper's
   * note about the piece it holds drives its giver's piece above it. ⚑ Held for {@link piece}'s reason:
   * the sender line that says which piece the words are about is composed at the flush, and on the
   * `message_queued` row so a restart keeps it. ⛔ Absent on words that name no piece.
   */
  // A work reminder also keeps its incident piece here for the last delivery check.
  readonly about?: string
  /**
   * ⚑ **The question these words ask, when they are a question's notice** — see
   * {@link TheQuestionItAsks}. ⚑ Held so a notice whose question has stopped waiting is taken back
   * unread rather than sent (`RuntimeHost.whyItNoLongerGoes`), and on the `message_queued` row so a
   * restart keeps it. ⛔ Absent on every other message.
   */
  readonly asks?: TheQuestionItAsks
  /**
   * 🔴 **Who these words came from, when they are somebody's own** (414) — see {@link TurnOrigin}.
   *
   * ⛔ **Held here for {@link piece}'s reason, one field over**, and it is the same failure both
   * fields exist to stop: the provider's string is composed at the FLUSH, where there is no caller
   * left to derive anything from. ⚑ An origin known only at queue time would frame every child
   * that happened to be IDLE and no child that was busy — `406`'s report defect, arriving a third
   * time, and looking exactly like a fix that works intermittently.
   *
   * ⚠️ **It is not {@link authorship}'s `relayedFrom`, and the difference is load-bearing.** Both
   * name a conversation. `relayedFrom` also covers the turn BroBot COMPOSED about somebody else —
   * a routed question — where the words are the app's and the sentence already names the child.
   * ⛔ Framing those as *sent by that child* would be false, so the provider-side fact is its own
   * field rather than a reading of the ledger's.
   *
   * ⛔ **Absent, never null.** ⚑ A message a restart left held is rebuilt with it, read back off its
   * authorship (D-017 · R3).
   */
  readonly origin?: TurnOrigin
  /**
   * Set when somebody asked for the running turn to be stopped so this message is read now: the
   * message goes out saying so, and who asked. Set after the message is held, never beside a
   * message that was not asked to interrupt.
   */
  interrupting?: AStopAskedFor
}

/**
 * ⛔ **What a surface is told about the held messages — ONE spelling, for both callers** (354).
 *
 * ⚠️ **It was written out twice**, in {@link sessionDisclosures} and in the attach path, and the two
 * copies had to gain `id` together or a re-attached window would be handed a message it could not
 * name and therefore could not cancel. 169 §1 is the dispatch about exactly that.
 *
 * ⚠️ **A NEW object rather than the host's own record**, which is the rule the call site used to
 * carry: a renderer holding the same object as the main process is how a later mutation shows up in
 * a window that was never told about it. ⛔ **A new ARRAY too, since `394`** — the mailbox is
 * mutated in place by the flush, so handing the live one out would let a renderer watch it change.
 *
 * ⚑ **In delivery order, which is what makes `394` §5's *"order is a fact"* readable rather than
 * assumed**: the surface shows what will go next, next.
 */
export const queuedDisclosure = (
  mailbox: readonly QueuedMessage[] | null | undefined,
): readonly QueuedMessageDisclosure[] =>
  (mailbox ?? []).map((queued) => ({
    id: queued.id,
    kind: queued.kind,
    text: queued.text,
    since: queued.since,
    // ⚑ **687 · whose words are waiting** (R22) — see `QueuedMessageDisclosure.attribution`.
    // ⛔ Spread, so a person's own message carries no such key, as on the ledger's rows.
    ...(queued.authorship.attribution === undefined
      ? {}
      : { attribution: queued.authorship.attribution }),
  }))
