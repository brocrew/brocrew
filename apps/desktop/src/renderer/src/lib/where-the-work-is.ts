import type { WorkReport } from '../../../shared/tasks'
import { OPEN_THE_CONVERSATION } from './taking-over'

/**
 * Make the conversation named by a work report available to open.
 *
 * ## ⛔ Derived from the REPORT, never from the sentence beside it
 *
 * ⚠️ **The row he was reading named two session ids and a task id — in its PROSE.**
 * `undrivenWorkText` wrote *"Task #5 (task_…) with sess_A is not being worked on: the turn it was
 * running in was stopped, by sess_B."*, and `WorkReportEntry` prints that string verbatim. ⛔ **A
 * control parsed out of it would be the one thing `work-report.ts` forbids by name** — *"Nothing
 * here is computed from the words … a renderer that read the outcome out of the prose would be a
 * second reading of a fold it cannot see"*. ⚑ So `506` put the conversation on the report — since
 * D-016 {@link WorkReport.owner} — and this reads the field.
 *
 * 🔴 **It is `439`'s rule one subject over**: *"the affordance is DERIVED from the roster, so a
 * model cannot invent one"*. Here the derivation is stronger still — the id is not matched against
 * anything a model wrote, because a model wrote none of it: both constructors copy
 * it off the `PieceRow` in the same call that composed the words.
 *
 * ## ⚑ One press, whatever the conversation is doing (D-017b)
 *
 * ⚑ **The gesture is {@link OPEN_THE_CONVERSATION}** — the same words the rail, the room, the Team
 * page and the person's queue say — because the press opens the conversation in its one full view
 * whether this window runs it, another window or no window does, or nothing runs it at all
 * (`RuntimeScreen.openConversation`). ⛔ This surface no longer tells those states apart, and it
 * never could tell all of them: a transcript row has no per-session read of who holds what.
 *
 * ## ⚑ What the press costs, measured rather than quoted
 *
 * ⛔ **Taking over a conversation an agent's give started and then closing the window does NOT end
 * it.** `closeSessionsForOwner` splits on `SessionSlot.bornWithoutASurface` — `if
 * (slot.bornWithoutASurface) this.release(slot)` — and every conversation a give starts is born
 * without a surface (`giveWork` passes no sink). ⚠️ The clause *"the window whose departure
 * ends the conversation"* is true of a conversation this window STARTED, and a work report never
 * names one of those. ⚑ The host's own comment says it: *"an agent that spawned a session and then
 * went away must not take the conversation with it."*
 */
export interface WorkIsWith {
  /** The conversation the work is with — {@link WorkReport.owner}, unchanged. */
  readonly conversation: string
  /** ⚑ **Whether THIS window is already running it** — for `data-held`, and nothing else. */
  readonly held: boolean
  /** {@link OPEN_THE_CONVERSATION} — the one press. */
  readonly action: string
}

/**
 * ⛔ **What a work report's row may offer, or `null` for nothing at all.**
 *
 * ⚠️ **Two different nulls, and both are absences of a FACT rather than refusals** — `118`'s rule:
 * a control is absent where nothing would make it work.
 *
 *  - **The report names no conversation.** The bound on the way in drops an owner this app could
 *    not have minted, so a report can arrive without one — see {@link WorkReport.owner}. ⛔ It is
 *    not *"the work is with nobody"*.
 *  - **This surface does not know what the window holds.** `ReadingPane` and `ChildWorkViewer`
 *    render the same transcript with no runtime behind them; a press there would reach nothing,
 *    which is `TranscriptView.canOpenStore`'s own default and its stated reason.
 *
 * ⚑ **Pure and total**, so a test drives both nulls and the arm with no renderer.
 */
export function workIsWith(
  report: Pick<WorkReport, 'owner'>,
  /** The ids this window is running, or `null` where the surface has no answer. */
  held: ReadonlySet<string> | null,
): WorkIsWith | null {
  const conversation = report.owner
  if (conversation === undefined || conversation.length === 0 || held === null) return null
  return { conversation, held: held.has(conversation), action: OPEN_THE_CONVERSATION }
}
