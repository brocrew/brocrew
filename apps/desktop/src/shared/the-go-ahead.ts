/**
 * 🔴 **700 · `688` H2 — what a person is told when the plan was released and the go-ahead did not go,
 * in ONE place** (060, 670).
 *
 * ⚑ **Two processes say it, about one state.** Main says it when the go-ahead's send fails, or a hold
 * a rail refused ({@link goAheadNotSent}); the renderer draws it when a person takes a held go-ahead
 * back (`688`, R33: *"the existing sentence"*), because `endPlanMode` releases the plan BEFORE the
 * go-ahead is sent or held — so a take-back leaves exactly the state a failed send does.
 *
 * ⛔ **Until 700 the bytes lived twice** — main's error and the renderer's two halves in
 * `plan-mode.ts`, pinned equal by a test that drove the real host's failed send, because the renderer
 * cannot import `main/`. ⚑ Both import this file now, and `one-sentence-one-place.test.ts` fails a
 * second spelling of either half anywhere in the app's or the packages' source.
 */

/** ⚑ The first half — what happened. */
export const THE_GO_AHEAD_WAS_NOT_SENT = 'the plan was released but the go-ahead was not sent'

/** ⚑ The second half — what a person can do about it. */
export const TYPE_TO_CARRY_ON = 'type your next message to carry on'

/**
 * ⚑ **Main's sentence** — the two halves around the cause, which only main knows (a send that
 * failed, or the rail that refused the hold).
 */
export function goAheadNotSent(cause: string): string {
  return `${THE_GO_AHEAD_WAS_NOT_SENT} (${cause}) — ${TYPE_TO_CARRY_ON}`
}

/**
 * ⚑ **The renderer's sentence for a taken-back go-ahead** — the same two halves with no cause: the
 * row's state line already says it (*you took it back*).
 */
export const THE_GO_AHEAD_TAKEN_BACK = `${THE_GO_AHEAD_WAS_NOT_SENT} — ${TYPE_TO_CARRY_ON}`
