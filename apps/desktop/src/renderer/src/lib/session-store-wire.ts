import type { HandedPath } from '../../../shared/attachment-contracts'

/**
 * ⛔ **Staged paths as PLAIN objects, because the wire cannot clone a Proxy** (218, measured live).
 *
 * `createAttachmentBook` keeps them in a `reactive(new Map())`; what a caller reads back is a Vue
 * Proxy, and `ipcRenderer.invoke` structured-clones its payload. The structured clone algorithm
 * refuses a Proxy — `"An object could not be cloned."` — so a send carrying one threw at the bridge
 * and the session ended with no turn. See {@link SessionStore.send}'s note for how it survived
 * two dispatches.
 *
 * ⚑ **Field by field, not `{...each}`.** A spread would copy whatever the renderer happened to be
 * holding; this puts exactly the three fields the wire schema takes on the wire, so the shape is
 * pinned as well as the cloneability. ⚠️ Exported so its own test can call it, and so the rule is
 * somewhere a mutation can reach — `216` M55's lesson.
 */
export function overTheWire(handed: readonly HandedPath[]): HandedPath[] {
  return handed.map(({ path, kind, outsideCwd }) => ({ path, kind, outsideCwd }))
}

/**
 * 🔴 **What a card says when the answer never left this window** (473, from `469` F2).
 *
 * ⛔ **Here rather than inline, because it is a sentence a person reads** — `169` §2's rule, the
 * same one that puts `OPEN_REQUEST_MISSED` in `attention.ts` and `wideGrantWarning` in
 * `permission-offer.ts`. A test holds these words; a template literal buried in a closure is a
 * sentence nothing can pin.
 *
 * ⚠️ **It says *still waiting*, and that is the half `469` found missing.** The old sentence began
 * *"answering this failed"* and was written onto a card the same call had just marked settled, so a
 * person read a past-tense failure about a card with no buttons left, while the agent it belongs to
 * stayed frozen. ⛔ **This one is drawn above buttons that are still live**, which is the only
 * reading that matches what the provider is actually doing.
 *
 * ⚑ **The cause is carried, not swallowed.** `469`'s note already contained *could not be cloned* —
 * the diagnosis reached the window and the window did not act on it — so the reason stays in the
 * sentence and `record.error` keeps its banner.
 */
export function answerNeverLeftThisWindow(cause: string | null): string {
  return (
    'that answer did not reach the conversation, so it is still waiting — ' +
    `you can send it again: ${cause ?? 'this window could not say why'}`
  )
}

/**
 * 🔴 **739 · `737` F-6 — how long a command for a conversation holds its buttons dark** before
 * {@link forSession} stops counting it (`busy`) and the pane says it has had no answer
 * ({@link A_COMMAND_HAS_NOT_ANSWERED}, rule 8.4).
 *
 * ⛔ **Unbounded, a command whose promise never settled kept `busy` up for good**, with nothing
 * said: *Leave planning*, the go-ahead and both Reopens stayed dark (`737` F-6, found once `busy`
 * counted and the next command's `finally` no longer masked it).
 *
 * ⚑ **The number, derived** (rule 22) — ⚠️ it is a copy: no door's bound is on the wire (`739`
 * GAP). At or above every single bound the host itself puts on a door a person presses: a Stop's
 * 2 s (`DEFAULT_INTERRUPT_WAIT_MS`), the command list's 5 s, `waitForIdle`'s 5 s, a Claude settings
 * acknowledgement's 10 s (`SETTINGS_ACK_TIMEOUT_MS`) — and equal to the host's own patience with a
 * provider that has stopped talking (`DEFAULT_LAUNCH_TIMEOUT_MS`, `DEFAULT_DELIVERY_WAIT_MS`, *"the
 * same order of patience"*).
 * ⚠️ **Three ordinary paths can run longer, named** (`739` review): a Claude send stacking three
 * settings acknowledgements (≈37 s); a send that meets the delivery wait, whose 15 s starts only
 * after the host's own checks; and a close — its stop and drain are 5 s and 5 s, then the archive,
 * which the host does not bound. On each, `busy` comes down early and the line says it has had no
 * answer, which is true; the buttons that re-light are Codex's plan bar and a superseded sign-in's
 * Reopen, which a send cannot be under, and the grant sheet's Reopen, which a Claude send CAN be
 * under — a reopen pressed then closes the conversation over a send still out (a `739` finding, not
 * measured); a close ends the conversation that holds them.
 *
 * ⛔ **It releases the BUTTONS, never the caller**: the command's own promise is still awaited, and
 * its value or its failure lands when it comes — the host's `settledWithin` rule, *"releases the
 * WAITER, not the work"*, one layer up.
 */
export const A_COMMAND_IS_WAITED_ON_MS = 15_000

/**
 * 🔴 **739 · `737` F-6 — what the pane says while a command has had no answer** (rule 8.4: what a
 * person SEES at the limit). ⚑ *Something you asked* because the store does not know which verb —
 * every command it bounds is reached from a person's own press here; ⛔ never *failed* (`086`: the
 * window cannot back it) and never a provider named (it cannot tell the provider's silence from the
 * app's own).
 * ⛔ **Nothing about buttons, and nothing about the window's waiting** (`739` review, two rounds):
 * the controls `busy` darkens light again, but an ANSWER that has had no answer — to a permission or
 * a question — keeps its own card's `sent` guard until the host answers (`markSent`, cleared only by
 * `noteAnswer`; since `742` the host answers `unacknowledged` after its own bound and the guard stays
 * — `743` draws that arm), the *Waiting on you* row still says the answer is on its way, and the store still
 * awaits the command. What is true of every bounded command is the fact itself, and that an answer
 * may still come. ⚑ *once every answer has* (`739` round 3): the line is one for however many are
 * out (`unanswered` is a count), so it goes when the last of them answers, not the first.
 */
export const A_COMMAND_HAS_NOT_ANSWERED =
  `Something you asked of this conversation has had no answer in ${A_COMMAND_IS_WAITED_ON_MS / 1_000} ` +
  'seconds. An answer may still come — this line goes once every answer has.'
