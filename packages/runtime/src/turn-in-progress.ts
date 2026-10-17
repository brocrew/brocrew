/**
 * 🔴 **One string, two facts, and only the session machine can tell them apart** (650).
 *
 * ⛔ **Every adapter refuses an overlapping send with the same sentence**, and until `650` that
 * sentence was all a caller got: {@link TURN_REFUSED}, thrown when `beginTurn()` answers `null`.
 * ⚑ `beginTurn()` answers `null` for TWO reasons, and they are opposite in what a caller should do:
 *
 *  - **a turn is already held** — somebody else's words reached the agent first. It is busy, not
 *    broken, and the same send a moment later is accepted (or, one layer up, held until that turn
 *    ends). That is {@link TurnInProgress}.
 *  - **the session is not active** — it is closing, closed or errored. Nothing clears that without
 *    a person. That stays a plain `Error` with the same text.
 *
 * ⚠️ **`650` measured the first half through `message_agent`**: two calls in one tick to one idle
 * agent, and the second came back as `agent-cannot-take-a-message` — *"a person has to put that
 * conversation right"* — about an agent that was merely answering the first. The app could not do
 * better, because the only thing it had was the text, and the text is identical for both halves.
 *
 * ## ⛔ Why there is no `name`, unlike {@link AnswerRefused}
 *
 * 🔴 **This error could reach a person, and the rule below outlives that.** Until `670` a
 * window's send, interrupt-and-send and plan go-ahead let it out; since then every door a person
 * uses HOLDS it (`RuntimeHost.send`, `runSendInterrupting`, `endPlanMode`, and `queueAs` since
 * `657`). ⚠️ The name stays `Error` anyway, because a door added tomorrow that forgets to hold would
 * put these bytes on a screen. A window's send crosses IPC, Electron serialises it as
 * `${name}: ${message}`, and the renderer strips exactly one wrapper prefix — `\w*Error:` — before
 * it shows the rest (`renderer/src/lib/session-record.ts`, `readableError`). ⚑ A class named
 * `TurnInProgress` would put `TurnInProgress:` on a person's screen, so the name stays `Error` and
 * the bytes a person could see are the bytes they saw before `650`. ⚑ **Since `675` the runtime
 * command door re-throws any named class as a plain `Error`** (`withoutItsClassName` in `ipc.ts`),
 * so on that channel this is belt and braces — ⚠️ and it stays, because it is the class's own
 * guarantee on every other channel. `instanceof` is the check, and
 * it works because the adapters and the host share one process — {@link AnswerRefused}'s own
 * argument, which is the part of its shape this copies.
 */
export const TURN_REFUSED = 'cannot send: session is not active or a turn is in progress'

/**
 * ⚑ **A send refused because a turn is already held** — the half of {@link TURN_REFUSED} that
 * clears on its own. Built only by `SessionMachine.refusedTurn()`, which asks the session state
 * first, so an instance is never about a session that has stopped taking turns.
 */
export class TurnInProgress extends Error {
  constructor() {
    super(TURN_REFUSED)
  }
}
