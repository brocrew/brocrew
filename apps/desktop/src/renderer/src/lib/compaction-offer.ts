import type { CapabilityStatus } from '../../../shared/runtime-ipc'

/**
 * 🔴 **718 · `R60` — *"Compact now…"* works on both providers, after a confirm.**
 *
 * ## ⛔ The ruling, pasted whole
 *
 * > **R60 (`708` H-3b) · *"Compact now…"* works on both providers, after a confirm.** Claude through
 * > R42's own path (the person's `/compact`, stamped `person`); Codex through `thread/compact/start`
 * > (R59). Both are the person's `/compact` through the existing send door: no new IPC (`713` §3).
 *
 * ⚑ **So the press is a MESSAGE, and this file is the one place that decides when it may be one.**
 * The Dropped tab's control was hard-coded `disabled` from `087` to `718`, on the stated condition
 * that enabling it took *"the asymmetry between the providers resolved AND a confirm"*. `713`
 * resolved the first (both providers declare `requestCompaction` `available`); the confirm is
 * `SessionContext`'s door, and this is the gate in front of it.
 *
 * ## ⚑ Offered exactly where the composer would send a plain `/compact`
 *
 * ⛔ **Not a second opinion about the conversation.** Every state below that withholds it is one in
 * which the composer's own Send would not go either — `ended`, `closing`, a superseded sign-in, a
 * card waiting on the person, a launch still opening — and the one that differs by DESIGN is a
 * message already held: the composer still lets a person interrupt-and-send there (⇧⌘↵), but the
 * plain press — the one this control makes — would be refused behind the held one.
 *
 * ⚑ **`busy` queues**, which is the composer's own plain press (`sendIntentFor(busy, false)`) and
 * the brief's *"busy handling is whatever the composer already does"* (`713` §3): the compaction
 * goes when the running turn ends, and the sentence says so before the press. ⛔ Never `interrupt`
 * — a control that silently threw away a turn in flight would be a second, unconfirmed
 * irreversible act inside the confirmed one.
 *
 * ## ⚠️ The capability supplies the reason when it is not `available`
 *
 * ⛔ **Asked of the STATE, never of the provider's name** (`039`). `available` on both today; a
 * provider that declares it `absent` or `unwired` tomorrow withholds it here, in its own words.
 */

/** The control's label — unchanged since `087`; the ellipsis now means what it says: a question follows. */
export const COMPACT_NOW = 'Compact now…'

/** ⚑ The confirm's question, asked in front of an irreversible press. */
export const COMPACT_HEADING = 'Compact this conversation now?'

/**
 * ⚑ **…and the same question while the agent is working** (`718`'s review): the answer QUEUES the
 * compaction behind the turn, so a question that said *now* would be answered by something else.
 */
export const COMPACT_HEADING_AFTER_THE_TURN = 'Compact this conversation when this turn ends?'

/** The confirm's question for the press the offer would make. */
export function compactHeading(intent: 'now' | 'queue'): string {
  return intent === 'queue' ? COMPACT_HEADING_AFTER_THE_TURN : COMPACT_HEADING
}

/**
 * ⛔ **What a compaction COSTS, said before it is paid** — the tab's own note's consequence
 * (*"the provider drops earlier turns and summarises them, and the agent loses the detail"*), plus
 * the clause that makes it a confirm and not a courtesy.
 */
export const COMPACT_LINE =
  'The provider summarises the earlier turns and drops them: the agent keeps the summary and loses the detail. It cannot be undone.'

/** ⚑ The two answers. ⛔ They must not look alike — see `SessionContext`'s `.compact-it`. */
export const COMPACT_IT = 'Compact it'
export const KEEP_EVERYTHING = 'Keep everything'

/**
 * ⚑ **What the press sends: the person's `/compact`, and nothing after it.** ⛔ No instructions —
 * Codex takes none (`R59`, `R68`: the host refuses `/compact <instructions>` there), so the one
 * spelling both providers accept is the bare word.
 */
export const THE_COMPACT_COMMAND = '/compact'

/** The facts about the CONVERSATION the offer is asked of — the composer's own, read by the pane. */
export interface CompactionFacts {
  /** `ComposerState`'s four words — `idle`, `busy`, `starting`, `frozen`. */
  readonly state: 'idle' | 'busy' | 'starting' | 'frozen'
  /** ⚑ The pane's `record.phase === 'closing'`. */
  readonly closing: boolean
  /** ⚑ Claude's superseded sign-in — no message goes out on it (`SIGN_IN_SUPERSEDED_BLOCK`). */
  readonly signInSuperseded: boolean
  /** ⚑ A message is already held behind the running turn (`record.meta.queued`). */
  readonly hasQueued: boolean
  /**
   * ⚑ **The held message IS the person's `/compact`** — the answer to this very question, queued
   * behind the turn (`718`'s second review round). ⛔ Without it the foot told a person who had just
   * compacted to cancel their own compaction *"to compact"*.
   */
  readonly compactionIsWaiting: boolean
  /** The agent's name, for the sentence — `ConversationPane`'s `who`. */
  readonly who: string
}

/** ⚑ The capability-shaped reasons keep `087`'s lead; a conversation's state gets its own. */
export const NOT_OFFERED = 'Not offered.'
export const NOT_NOW = 'Not now.'

/**
 * 🔴 **The one answer the Dropped tab's foot draws** — whether the press is live, what it would
 * mean, and the sentence under it.
 */
export type CompactionOffer =
  | {
      readonly offered: true
      /** `now` from `idle`, `queue` from `busy` — see the file's note. */
      readonly intent: 'now' | 'queue'
      readonly why: string
    }
  | {
      readonly offered: false
      /** {@link NOT_OFFERED} for a capability, {@link NOT_NOW} for this conversation's state. */
      readonly lead: string
      readonly why: string
    }

/** ⛔ `087`'s sentence for a read that has not arrived, unchanged. */
export const NOT_DECLARED =
  'Not declared — the capabilities read has not arrived, or it failed. Nothing is offered on a capability we could not read.'

/**
 * ⚑ **The whole decision, pure** — the capability first, because a provider that cannot be asked
 * makes every conversation fact beside the point; then the facts, in the composer's precedence
 * (`ended` above `closing` above the sign-in, `ConversationPane.sendBlocked`'s order).
 *
 * ⚠️ **`facts` is `null` where the surface drawing the tab is not the conversation's pane** — a
 * drawer mounted with no conversation behind it has no send door to reach, so nothing is offered
 * and the sentence says why rather than going blank.
 */
export function compactionOffer(
  capability: CapabilityStatus | null,
  facts: CompactionFacts | null,
): CompactionOffer {
  if (capability === null) return { offered: false, lead: NOT_OFFERED, why: NOT_DECLARED }
  if (capability.state !== 'available') {
    return {
      offered: false,
      lead: NOT_OFFERED,
      why:
        capability.state === 'absent'
          ? `${capability.reason} Checked against: ${capability.checkedAgainst}`
          : capability.reason,
    }
  }
  const road = `The provider can be asked${capability.note ? ` — ${capability.note}` : ''}.`
  const notNow = (why: string): CompactionOffer => ({ offered: false, lead: NOT_NOW, why })
  if (facts === null) return notNow(`${road} This view has no conversation to send it to.`)
  if (facts.closing) return notNow('Wait a moment — this conversation is taking up the change.')
  // ⚠️ **The drawer's own words, not the composer's** (`718`'s review): `SIGN_IN_SUPERSEDED_BLOCK` says
  // *"above"*, which is true under the Reopen bar and false in a drawer column beside it.
  if (facts.signInSuperseded) {
    return notNow(
      'No message can go out on the sign-in this conversation is holding — reopen it on the current one from the bar above the composer.',
    )
  }
  if (facts.state === 'starting') return notNow('This conversation is still opening.')
  if (facts.state === 'frozen') {
    return notNow(
      'A request in the conversation is waiting on you, and a compaction is sent as a message — answer it first.',
    )
  }
  // ⚑ **D-010 · a compaction queues behind whatever already waits**, as any message does — only a
  // second `/compact` is not offered, because the first is already the answer to this question.
  if (facts.state === 'busy' && facts.hasQueued && facts.compactionIsWaiting) {
    return notNow(
      `A /compact is already waiting to go when ${facts.who} finishes — the conversation compacts then.`,
    )
  }
  if (facts.state === 'busy') {
    return {
      offered: true,
      intent: 'queue',
      why: `${road} ${facts.who} is working, so it goes when this turn ends.`,
    }
  }
  return { offered: true, intent: 'now', why: road }
}
