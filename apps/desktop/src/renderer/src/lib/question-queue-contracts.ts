import type { AboutWork } from '../../../shared/question-contracts'
import type { BlockedSinceIs } from './queue-time'

/** The named participants a queue question card reads. */
export interface QueueQuestionHop {
  /** The conversation that is waiting, named the way a person reads it. */
  readonly name: string
  /** ⛔ **Whether the answer owed AT this hop is yours.** The last hop of a walk that ended. */
  readonly you: boolean
}

/** The queue's context around a question, shared with its card. */
export interface QueueQuestionContext {
  /** The provider's own request id — what the card carries. */
  readonly requestId: string
  readonly chain: readonly QueueQuestionHop[]
  /**
   * ⛔ **The walk was stopped rather than ended**, so nothing above the last hop is known and no
   * hop says `you`. ⚠️ A cycle and {@link CHAIN_HOP_LIMIT} are both this, and the surface may not
   * tell them apart because the payload does not.
   */
  readonly unfollowable: boolean
  /** HO-007's own evidence line, as the host composed it from these same hops. */
  readonly sentence: string
  /**
   * How long it has been a person's, or null when the stamp did not cross.
   *
   * ⚠️ **Two different clocks under one field, and the row's own copy says which** (403). For an
   * `escalated` row it is `escalatedAt` — *the moment a person was told*. For `a-decision` there is
   * no such moment and never could be: it was a person's from the instant it was routed, so it is
   * the routing's own `at`. ⛔ Folding those into one WORD would say a person had been told about
   * something nothing ever told them about.
   */
  readonly since: string | null
  /**
   * 🔴 **The instant the ORDER is computed from, in epoch ms, or null because nothing recorded
   * one** (434, criterion 17).
   *
   * ⛔ **The number beside the words, and not a second derivation of them.** {@link since} is
   * `agoWords` of exactly this against exactly the same `now`, so a row cannot be drawn as
   * *"9 minutes ago"* and sorted as something else.
   *
   * ⚠️ **Null is ordered explicitly and never by a `?? 0`** — see {@link byBlockedSince}.
   */
  readonly blockedSince: number | null
  /**
   * 🔴 **WHICH instant {@link blockedSince} is** (434) — the field that lets one ordering run over
   * two clocks without claiming they are the same clock.
   *
   * ⛔ **`not-recorded` is a third value and not an absence**, for the reason
   * {@link PersonsQueueView.count} is never rounded: a surface that had only `blockedSince: null`
   * to go on would have to decide for itself whether that meant *old* or *new*, and two surfaces
   * would decide differently.
   */
  readonly blockedSinceIs: BlockedSinceIs
  /**
   * 🔴 **Which work this row is about, and why that is the answer** (474, from `463` F4) — the
   * vocabulary is `AboutWork` in `shared/questions.ts`, and its three arms are the whole of it.
   *
   * ⛔ **One field rather than a value beside a word**: the work this question names exists only on
   * the arm that names it.
   */
  readonly about: AboutWork
}
