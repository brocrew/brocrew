import type { RunningState } from '../../../shared/runtime-ipc'

/**
 * 🔴 **The words for the press a conversation row offers, in the one place every surface reads**
 * (421, 472, 504).
 *
 * ⚑ **D-017b · there is one press now.** A conversation opens in its one full view whatever it is
 * doing (`RuntimeScreen.openConversation`): running here, running for another window or for none,
 * or drawn from its ledger — so a row offers one gesture, in one sentence, on every surface that
 * offers it (the rail, the Team page and its forest, a work report, the person's queue).
 * ⛔ The four words there were (*Open*, *Take it over and open it*, *Reopen*, *Read the recording*)
 * each named what a process was doing, which a person no longer has to know (`05` rule 5).
 *
 * ⛔ **The copy lives here and the act does not.** Nothing in this file knows about the store, the
 * bridge or the host — it is words, and the one rule for when a row says them — so a fold that runs
 * in a test with no renderer can read it.
 */

/** ⚑ **D-017b · what the press on a conversation row says it will do** — the one gesture. */
export const OPEN_THE_CONVERSATION = 'Open the conversation'

/** ⚑ **The press could not open it, and the host gave no reason** — the plain sentence. */
export const COULD_NOT_BE_OPENED = 'That conversation could not be opened.'

/**
 * 🔴 **UI-007 · what a refused open says** — the host's own words, or {@link COULD_NOT_BE_OPENED}
 * where it gave none. ⛔ **`||` and not `??`**: an EMPTY reason is a refusal with no words, and an
 * empty notice is the silence this sentence exists to refuse (`668`'s `closedPress` had it, and
 * D-017b's one door lost it). ⚑ A reason of blanks says nothing either.
 */
export function refusedToOpen(reason: string | null): string {
  return reason?.trim() || COULD_NOT_BE_OPENED
}

/**
 * 🔴 **The claim with the navigation left off** (434) — take the conversation over so its card can
 * be answered where the person already is.
 *
 * ⛔ **It says *take it over*, because it IS that act.** `RuntimeHost.claimSession` is `336`'s door
 * and it is the one thing that makes this window the owner — the window that may send to it and
 * answer it. ⚠️ A control that said only *"answer here"* would perform an adoption a person did not
 * know they were agreeing to. ⚑ It is undoable: `handing-it-back.ts`.
 */
export const TAKE_IT_OVER_TO_ANSWER_HERE = 'Take it over to answer here'

/**
 * ⚑ **D-017b · a provider's card on a view this window is not fed, where ANOTHER window has the
 * conversation open** — that window answers it, in the words its composer says the same fact in.
 * ⚠️ No press: switching windows is not something this app can do for you (`106`).
 */
export const ANSWERED_IN_THE_OTHER_WINDOW =
  'This conversation is open in another window — it is answered there.'

/**
 * ⚑ **D-017b · the same card where NO window holds the conversation** (a hand-back) — the provider
 * waits for the window that takes it, and {@link TAKE_IT_OVER_TO_ANSWER_HERE} is the press beside
 * this line.
 */
export const ANSWERED_ONCE_A_WINDOW_TAKES_IT =
  'No window holds this conversation, so this is answered once one takes it.'

/**
 * **What a conversation another WINDOW holds says**, which is the one case *"already open in another
 * window"* is ever true of (421) — and, since D-017b, the one fact a row says about where a
 * conversation is: a message sent to it from here is refused, in the same words.
 *
 * ⚠️ **No gesture goes with it, and that is `106` rather than an omission.** Switching windows is
 * not something this app can do for you, so the row says where the conversation is.
 */
export const OPEN_IN_ANOTHER_WINDOW = 'open in another window'

/**
 * ⚑ **D-017b · whether a row says {@link OPEN_IN_ANOTHER_WINDOW}** — another window has it open, so a
 * message from this window is refused there. ⛔ Whether this app is running it, and whether anybody
 * is watching it, are process facts a person no longer has to know (`05` rule 5): every row opens the
 * conversation in its full view, whatever it is doing.
 *
 * ⚠️ **Whether that surface is THIS window is a question the host cannot answer about a list
 * command** (`RUNNING_STATES`' own docblock), so the window's own `held` decides it.
 */
export function openElsewhere(running: RunningState, held: boolean): boolean {
  return running === 'in-a-window' && !held
}
