import type { CapabilityStatus, CommandTail } from '../../../shared/runtime-ipc'
import { backgroundState } from './background-work'
import type { ToolItem } from './transcript'

/**
 * Describe the output a command card can show while the command runs.
 *
 * ## ⛔ One vocabulary, because there are four different silences and they are not the same fact
 *
 * `222` §4's rule, applied one surface over from `background-work.ts`: the words live here so no
 * call site can phrase one its own way. And the four are genuinely different — `074`'s rule is that
 * saying nothing arrived is a different fact from saying what did, and here there are three ways
 * for nothing to have arrived:
 *
 * | state | what it means | who produced it |
 * |---|---|---|
 * | a tail with text | this is what it has printed | Codex, measured |
 * | a tail with none | it is running and has printed nothing yet | a command that is thinking |
 * | no tail at all | this app is holding nothing for it | evicted, or never streamed |
 * | this session cannot be asked | a recording, or an adapter that does not stream | Claude, measured |
 *
 * ⚠️ **The last one carries the PROVIDER's own sentence rather than one written here**, out of
 * `ProviderCapabilities.commandOutput`'s `reason`. `039`'s rule is that the renderer owns no copy of
 * a capability's words — *"a reason that goes stale is fixed in one place and cannot be fixed in only
 * one of two"* — and this is the surface that rule was written for.
 */

/**
 * ⛔ **What the card says INSTEAD of a tail, or `null` when there is one to show.**
 *
 * ⚠️ **`canRead` and `capability` answer different questions and both are needed** — see
 * `SessionLiveness.canReadCommandOutput`. `canRead` is about THIS session's handle: a recording has
 * none whatever its provider can do. `capability` is about the provider, and it is the only thing
 * that can say *why* nothing will ever arrive.
 *
 * ⚑ **A recording gets the short sentence and not the provider's**, because the provider's would be
 * false there: Codex streams a command's output, and a closed conversation still has none.
 */
/**
 * ⚑ **D-017b · one sentence for a command whose output is not held**, whatever the reason: whether
 * the conversation's process is running is not the card's to say (`05` rule 5).
 */
const NOTHING_KEPT = 'Nothing has been kept for this one.'

export function tailAbsence(
  tail: CommandTail | null,
  canRead: boolean,
  capability: CapabilityStatus | null,
): string | null {
  if (!canRead) {
    // ⚠️ **The `absent` arm only.** An `unwired` reason says what WE have not built, which is a true
    // sentence in the wrong voice for someone watching their own command; and `available` with no
    // handle is the recording below.
    if (capability?.state === 'absent') return capability.reason
    return NOTHING_KEPT
  }
  if (tail === null) return NOTHING_KEPT
  if (tail.text === '') return 'It has not printed anything yet.'
  return null
}

/**
 * ⚑ **Which of the provider's two standings a card reads** (provider follow-ups 1): a command that
 * went to the background reads `backgroundCommandOutput`, every other one `commandOutput` — the
 * halves have different answers on Claude since 2.1.287.
 */
export function outputStandingFor(
  wentToTheBackground: boolean,
  foreground: CapabilityStatus | null,
  background: CapabilityStatus | null,
): CapabilityStatus | null {
  return wentToTheBackground ? background : foreground
}

/**
 * ⛔ **What the tail says when it has already forgotten some** — `092`'s no-silent-cap rule, and the
 * same shape `background-work.ts`'s `cutNote` uses one surface over.
 *
 * ⚠️ **It says the characters are GONE rather than that they are elsewhere.** They are: the ring
 * keeps the last `MAX_COMMAND_TAIL` and discards the front, and there is no file behind it to point
 * at. `247`'s own note about a registry that undercounts applies to a tail that silently starts in
 * the middle.
 */
export function tailDroppedNote(dropped: number): string {
  return dropped === 1
    ? '1 earlier character is no longer kept'
    : `${dropped.toLocaleString()} earlier characters are no longer kept`
}

/**
 * ⛔ **Whether the tail is still a claim about NOW.**
 *
 * ⚠️ **Read from the provider's own ending, never from silence.** A command that has printed nothing
 * for a minute is a command printing nothing, not a finished one — which is the whole reason
 * `CommandTail.closed` is set by the adapter that was told rather than inferred by a timer here.
 * `042`'s ruling about `idle`, one subject over: *"the only definition of quiet is a timeout, a guess
 * wearing a number."*
 */
export function tailIsLive(tail: CommandTail | null): boolean {
  return tail !== null && !tail.closed
}

/**
 * 🔴 **Is this command going ON, right now** — the ONE predicate every surface with a decision asks
 * (300, on `223`'s rule and `099`'s).
 *
 * ⛔ **Two readers, and they must not be able to disagree.** The card offers a Stop and a tail while
 * this is true; the pane retires an in-flight stop when it goes false. `300` §4's warning is that
 * *"if the output view and the card can disagree, they will"* — and the answer is that there is one
 * function, not that the two derivations happen to match today.
 *
 * The two live states are the two ways a command can be unfinished-but-alive: a call with no receipt
 * yet, and one whose receipt said it LEFT and whose work has not ended. ⛔ `unfinished` is
 * deliberately not among them — that word means nothing will ever report back (074), so a control
 * that acted on it would be acting on a dead process, and a latch held for it would never be freed.
 */
export function commandIsLive(item: ToolItem): boolean {
  if (item.background !== undefined) return backgroundState(item.background) === 'running'
  return item.result === null && item.unfinished !== true
}
