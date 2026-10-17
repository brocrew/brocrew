import type {
  ConversationWait,
  ConversationWaiting,
  HeldWork,
  WhatEachConversationIsWaitingOn,
} from '../../../shared/tasks'
import type { AgentState, StoppedPiece } from '../../../shared/agent-state'
import { waitsNotReadSays } from './rows-unread'

/**
 * 🔴 **What ONE conversation is waiting on, out of the reading that covers all of them** (636,
 * from `621` §5.1 · `HO-095` §5.1 · `HO-096` §4).
 *
 * ## ⛔ Why this is a file and not three lines in `SideRail.vue`
 *
 * ⚠️ **Three surfaces ask the same question about one reading** — the rail row, the header pill and
 * the plate under the avatar — and `099`'s defect is exactly a lookup written twice: the rail said
 * `idle` while the pane said `working` about one session. ⚑ One function, three callers, no way to
 * disagree.
 *
 * ## 🔴 THREE ABSENCES, and they are not collapsed
 *
 * ⛔ **`632` shipped three distinct absences at the band one surface over and this is the same
 * discipline**: a reading that has not landed, a conversation the reading does not cover, and a
 * conversation the reading covers and says nothing is outstanding about are THREE different
 * states, and a single `undefined` for all of them is
 * `an-unenumerated-state-counts-as-success` with the enumeration on the wire.
 *
 * | ⚑ {@link WaitReading.known} | ⛔ what it means | ⚠️ what a surface may say |
 * |---|---|---|
 * | `nobody-has-looked` | the poll has not answered yet, or the last call was refused | **nothing about a wait.** The five live facets still answer, and their answer is a fact this app holds |
 * | `not-in-the-reading` | the reading landed and this conversation is not in it — {@link WhatEachConversationIsWaitingOn} covers the RUNNING population and no others | the same: nothing about a wait |
 * | `read` | the reading covers it, and {@link WaitReading.waiting} is the one wait or `null` | the word, or — for `null` — that nothing this app has recorded AND COULD READ is outstanding |
 *
 * ⚑ **D-016 · commit 6 · a {@link ConversationWait}, never *waiting on you***: the wait a piece a
 * person gave reads is said on the piece only (plan ruling 9), and no conversation is in it.
 *
 * 🔴 **`waiting: null` is a REAL ANSWER and is not either absence**: the host read this
 * conversation and its verdicts say nobody owes it the next move ({@link theWaitAsTheHostOwesIt}) —
 * *nothing recorded is outstanding*, never *nobody looked*.
 *
 * ⚠️ **685 · *recorded and readable*, since `676`** (`676` F-R18a). ⛔ A torn ledger row cannot say
 * whose wait it was, so above {@link WhatEachConversationIsWaitingOn.rowsUnread} `0` a `null` here
 * may be a wait this app could not read — and the word it becomes (`idle`) may be narrower than the
 * truth. ⚑ The count is the READING's and never a conversation's, so the surface that drew plates
 * from it says so ONCE, beside them: {@link whatTheWaitsCouldNotRead}.
 *
 * ## ⚠️ And an absence never becomes `idle`
 *
 * ⛔ **`idle` on a rail row is what {@link sessionDoing} says about the DOING**, which is a live
 * fact pushed at this window — it is never concluded from a wait this app did not read.
 * ⚑ {@link theWaitIn} returns `undefined` for both absences precisely so that a missing reading
 * ADDS nothing rather than answering; the word a person sees is then the one the other five facets
 * were already producing, and no claim about work is made from a read that did not happen.
 */
export type WaitReading =
  | { readonly known: 'nobody-has-looked' }
  | { readonly known: 'not-in-the-reading' }
  | { readonly known: 'read'; readonly waiting: ConversationWait | null }

/**
 * ⛔ **The three absences, told apart** — see {@link WaitReading}.
 *
 * ⚑ **Linear in the reading and called once per row**, which is what the rail can afford: the
 * population is the conversations this app is RUNNING, the same list the rail is already drawing.
 * ⚠️ A map built per render would be a second shape to keep in step with a reading that is
 * replaced whole on every tick.
 */
export function waitReadingFor(
  reading: WhatEachConversationIsWaitingOn | null,
  conversation: string,
): WaitReading {
  if (reading === null) return { known: 'nobody-has-looked' }
  const row = reading.conversations.find((each) => each.conversation === conversation)
  if (row === undefined) return { known: 'not-in-the-reading' }
  return { known: 'read', waiting: theWaitAsTheHostOwesIt(row) }
}

/**
 * ⚑ **D-017 · R11 · R19 — the one wait, with WHO OWES IT the next move as the host read it** — the
 * reading `list_agents` and `get_agent_status` state from ({@link ConversationWaiting.needsYou},
 * `.waitingOnTheAnswerOf`, `.waitingOnTheWorkOf`), so the plate, the rail and the tools say one
 * state of one conversation.
 *
 *  - **a person** (*needs you*) — `waiting-on-a-person`: a question asked of a person or passed up
 *    to one, a decision, an ask against its rules — facts of ledgers this window may not hold;
 *  - **another conversation's answer** — `waiting-on-an-answer`: a question it asked went to its
 *    parent or to the agent it named (named by {@link whoseAnswerIn});
 *  - **the work it gave out** — `waiting-on-a-worker`: a piece it gave is still open (D-036), its
 *    holders named by {@link whoseWorkIn}. ⚠️ An open question the host does not count as owed (a
 *    card no provider is parked on any more) is no wait, and ⛔ it hides no work: the host's
 *    `waiting` can name that question over it, so the verdict is read and never that.
 *
 * ⛔ The window decides none of it. ⚠️ A reading built without the verdict (a hand-made one) is read
 * as its wait alone: absent is *not read*.
 */
function theWaitAsTheHostOwesIt(row: ConversationWaiting): ConversationWait | null {
  if (row.needsYou === undefined) return row.waiting
  if (row.needsYou) return 'waiting-on-a-person'
  if ((row.waitingOnTheAnswerOf ?? null) !== null) return 'waiting-on-an-answer'
  // A holder that stopped with the work still holds it: the giver is said as waiting on it.
  const workOut = (row.waitingOnTheWorkOf ?? []).length + (row.stoppedWork ?? []).length
  return workOut > 0 ? 'waiting-on-a-worker' : null
}

/**
 * ⚑ **D-017 · R19 — what the HOST calls the conversation a question this one asked went to**, or
 * `null` — the name in *"waiting on an answer from <name>"*, on {@link theWaitIn}'s absences.
 */
export function whoseAnswerIn(
  reading: WhatEachConversationIsWaitingOn | null,
  conversation: string,
): string | null {
  const row = reading?.conversations.find((each) => each.conversation === conversation)
  return row?.waitingOnTheAnswerOf ?? null
}

/**
 * ⚑ **D-036 — what the HOST calls each conversation holding open work this one gave**, or none —
 * the names in *"waiting on <name>"*, on {@link whoseAnswerIn}'s rules.
 */
export function whoseWorkIn(
  reading: WhatEachConversationIsWaitingOn | null,
  conversation: string,
): readonly string[] {
  const row = reading?.conversations.find((each) => each.conversation === conversation)
  return row?.waitingOnTheWorkOf ?? []
}

/**
 * The pieces this conversation gave whose holder stopped with them open, as the HOST read them
 * (`ConversationWaiting.stoppedWork`), oldest give first, or none: the giver's
 * *"W6.4.1 with Quinn: stopped at 00:28"*.
 */
export function stoppedWorkIn(
  reading: WhatEachConversationIsWaitingOn | null,
  conversation: string,
): readonly StoppedPiece[] {
  const row = reading?.conversations.find((each) => each.conversation === conversation)
  return (row?.stoppedWork ?? []).map(({ label, holder, at }) => ({ label, holder, at }))
}

/**
 * When this conversation's waits began, as the HOST read them: the question it asked, and the
 * oldest open work it gave. Each is `null` where the host cannot say or the reading has no row.
 */
export function whenItsWaitsBeganIn(
  reading: WhatEachConversationIsWaitingOn | null,
  conversation: string,
): { readonly answer: number | null; readonly work: number | null } {
  const row = reading?.conversations.find((each) => each.conversation === conversation)
  return { answer: row?.waitingOnTheAnswerSince ?? null, work: row?.waitingOnTheWorkSince ?? null }
}

/**
 * 🔴 **F036 · who waits on an answer from this conversation, as the HOST names them** — off the one
 * state it pushes of the conversation (`runtime:states`, the rail's listed row), which is where the
 * host says it: the window holds no asker's ledger. ⚑ `undefined` unless that state is *owes an
 * answer*, on {@link theWaitIn}'s rule: an absent facet adds nothing.
 */
export function whoItOwesIn(
  state: AgentState | null | undefined,
): readonly [string, ...string[]] | undefined {
  return state?.is === 'owes-an-answer' ? state.to : undefined
}

/** When the oldest question this conversation owes an answer to was put to it, off the same state. */
export function whenItOwedIn(state: AgentState | null | undefined): number | null {
  return state?.is === 'owes-an-answer' ? (state.since ?? null) : null
}

/**
 * 🔴 **The one wait a conversation is in, for a surface that draws a facet** — `undefined` for
 * BOTH absences and for a read that says nothing is outstanding.
 *
 * ⛔ **The collapse happens HERE and nowhere earlier**, which is the point: the three states stay
 * distinct in {@link waitReadingFor}, where a test and a future surface can tell them apart, and
 * only the facet — which has one slot — is handed the narrowed answer.
 *
 * ⚠️ **An absent facet ADDS nothing to {@link standingOf}.** It does not mean *idle*, it does not
 * mean *nothing is outstanding*, and it cannot talk over a fact the other five facets hold.
 */
export function theWaitIn(
  reading: WhatEachConversationIsWaitingOn | null,
  conversation: string,
): ConversationWait | undefined {
  const read = waitReadingFor(reading, conversation)
  return read.known === 'read' && read.waiting !== null ? read.waiting : undefined
}

/**
 * 🔴 **D-006 · F018 — where the work a conversation holds stands, for a surface that draws a facet**
 * — {@link ConversationWaiting.work}, `undefined` for both absences and for `null`, on
 * {@link theWaitIn}'s rule: an absent facet adds nothing, and never becomes *answered* or *stalled*.
 */
export function theWorkIn(
  reading: WhatEachConversationIsWaitingOn | null,
  conversation: string,
): HeldWork | undefined {
  const row = reading?.conversations.find((each) => each.conversation === conversation)
  return row?.work ?? undefined
}

/**
 * 🔴 **685 · the one sentence for the reading's unread rows — or `null` when no plate on this
 * surface was drawn from it** (`676` F-R18a).
 *
 * ⚑ **`waitsNotReadSays`** — `rows-unread.ts`' sentence for THIS count (and D-017's records skipped
 * whole), whose only effect is a plate
 * reading *idle* while it waits — never a `> 0` here: the wire is a trust boundary, and a
 * hand-built reading can carry no count at all.
 *
 * ⛔ **Gated on `drawn`** — the conversations the surface actually drew a plate for. A reading that
 * covers none of them qualified nothing on this surface, and a line under plates it did not touch
 * would be a claim about the wrong rows. ⚠️ Rows drawn from another source — the rail's
 * *Not open in this window* section folds the closed ledger and reads no wait — are not in `drawn`.
 */
export function whatTheWaitsCouldNotRead(
  reading: WhatEachConversationIsWaitingOn | null,
  drawn: Iterable<string>,
): string | null {
  if (reading === null) return null
  for (const conversation of drawn) {
    if (waitReadingFor(reading, conversation).known === 'read') {
      return waitsNotReadSays(reading.rowsUnread, reading.ledgersSkipped)
    }
  }
  return null
}
