/**
 * What the app is allowed to say about approvals (171).
 *
 * Extracted from the components on the same argument `plan-mode.ts` makes for plan mode: this copy
 * is governed by a rule, and a rule can only be enforced on wording a test can reach. The rule here
 * is 168 H1's finding — **the code claimed a boundary it does not have, and the mode was named after
 * the safer thing** — so every sentence below is checked against what the guard actually does.
 *
 * ## ⛔ The measurement the wording answers to
 *
 * In `auto`, `Bash {command: 'cat "<userData>/…/codex/auth.json"'}` reads a neighbouring credential
 * copy **with no card**: the guard hook yields on the mode check and `handleCanUseTool` returns
 * `allow`. In `ask` the same call still reaches the card, which shows the command in full. ⚑ Since
 * `726` (R92) the same is true of a structured `Read` or `Glob`: the path scan that refused one
 * naming the app's own data is gone, and BroBot reaches every folder, as the CLIs do.
 *
 * Keep the CLI allow-all modes: Claude's `--dangerously-skip-permissions` and Codex's `--yolo`. Describe that behavior accurately without inventing an allowlist mode or parsing shell commands here.
 */

import { YOLO_LABEL } from '../../../shared/runtime-ipc'

/**
 * ⛔ **What yolo means, said once, where the mode is chosen** (171 §3).
 *
 * ⚑ **031's register, and 167's shape** — the profile line beside it is `PROFILE_OWNS` in
 * `profile-words.ts`: one line, a colon, and then the things it actually names. A paragraph here
 * would be a paragraph nobody reads, which 031 rates as worse than nothing.
 *
 * ## 🔴 This docblock quoted that line, twice, and was wrong both times
 *
 * ⚠️ **`329` caught the first drift**: the quotation said *"the sessions **and sign-in** kept there"*
 * and truncated before the em-dash. It was corrected by hand — *"no test binds a comment"* — and by
 * 384 it was stale again, still reading *"its own CLAUDE.md"*, which `356` had retired because it is
 * one provider's filename stated for both.
 *
 * ⛔ **So it is a POINTER now and not a copy.** Twice is a pattern, and the second correction is the
 * one that says why: a comment that restates another module's sentence is a second string with
 * nothing keeping it equal, which is exactly what `384 §1.1`'s lift exists to stop.
 *
 * ⛔ **Note what the sentence below still names, and why it is untouched by that edit**: yolo can
 * reach *"the sign-ins kept in"* other profiles' folders, which remains true of every profile whose
 * provider keeps one. It is a statement about what a command can REACH, not about what a profile is
 * promised to hold.
 *
 * Describe selected mode without judgment. `ask` supplies approval cards rather than a promise that the app prevents every action. The shell-command reach statement is a narrower example of tool reach; structured tools can also access locations available to the process.
 */
export const YOLO_MEANS =
  'Yolo is what the CLIs call --dangerously-skip-permissions and --yolo: nothing is asked — except ' +
  'what a CLI’s own plan mode still asks while it plans — and a ' +
  'command it runs can reach anything you can — this app’s own data, the other profiles’ homes ' +
  'and the sign-ins kept in them included.'

/**
 * 🔴 **499 · the half {@link YOLO_MEANS} does not say: what this mode does to the TREE**
 * (HO-037 §1, and `499` relay 1).
 *
 * ## ⛔ Why a second sentence and not a longer first one
 *
 * ⚠️ **`367`'s disclosure ships exactly as it is** — HO-037 §1 *"adds a half; it does not license
 * rewording the half that ships"* — and {@link YOLO_MEANS} is pinned to the byte by
 * `a-mode-that-says-what-it-does.test.ts`. ⛔ Appending to it would have been a rewording of the
 * shipped half wearing an addition's name.
 *
 * ## 🔴 What the PO ruled, and it is a ruling and not a preference
 *
 * `499` §2 measured that **`auto` is two different acts with one spelling**: on Claude it removes
 * the card, on Codex it removes the card **and an OS sandbox**. ⛔ The two honest answers were
 * *clamp the child* or *tell the person*, and the PO chose telling, with the reason:
 *
 * > ⛔ *"A Codex child quietly narrower than its parent is a surprise in the other direction and an
 * > invisible one. Clamping trades a disclosed difference for an undisclosed one."*
 *
 * ⚑ **And telling is not a gate:** *"It blocks nothing, narrows nothing and asks nothing."*
 *
 * ## ⚠️ It names Codex in PROSE, and a test is what keeps that true
 *
 * ⛔ **The fact lives in `WHAT_STANDS_PAST_ITS_FOLDER` (`@brobot2/runtime`) — what `auto` takes
 * off is that table's `ask` row less its `auto` row — and this file may not import it**: the
 * renderer must not pull the provider adapters into its bundle, which is the same rule
 * `SPAWN_RAIL_MEANS` follows for its own tool names: *"the tool names are prose and the test is what
 * keeps them true."* ⚑ `a-mode-a-child-inherits.test.ts` §4 censuses this sentence against that
 * table **in both directions** — every provider whose `ask` keeps a sandbox its `auto` does not is
 * named here, and no other — so the day Claude gains one, or Codex loses one, this line fails rather
 * than drifts.
 *
 * ## ⛔ Three things it deliberately does not say
 *
 *  - ⚠️ **It does not say *every* agent.** What travels down is the parent's own mode, to a
 *    conversation a give STARTS, and *"run in this mode too"* is that and only that: a give that
 *    finds a conversation the agent already has sends the work there, in whatever mode it runs.
 *    ⚑ **Since D-038 a Claude parent's `auto` does hand a Codex child its `auto`** — neither keeps
 *    anything past its folder, and `wider-than-its-parent` compares that (F050) — so on a Claude
 *    conversation this sentence is where the person is told the Codex half: it takes the sandbox
 *    off too.
 *  - ⛔ **It does not argue**, which is `YOLO_MEANS`' own rule: no "unsafe", no scare quotes, no
 *    second sentence advising against the thing the control exists to do.
 *  - ⚑ **It does not repeat what {@link YOLO_MEANS} already said** about reach. This is one clause
 *    about descendants and one about the provider that means more by it.
 */
export const YOLO_MEANS_FOR_AGENTS_IT_STARTS =
  'Agents this conversation starts run in this mode too — and on Codex that also takes the ' +
  'sandbox off.'

/**
 * How an approval mode reads in a LIST rather than in a sentence (171 §2).
 *
 * ⚠️ **`null` is not a mode.** A session recorded before the column existed has no answer, and
 * *"unrecorded"* is that answer — never the default, because guessing `ask` here would present a
 * yolo session as a careful one.
 *
 * ⛔ The enum stays `auto` on the wire and in the ledger; this is the only place the renderer is
 * allowed to turn it into a word. See {@link YOLO_LABEL}.
 */
export function approvalModeLabel(mode: 'ask' | 'auto' | null | undefined): string {
  if (mode === 'auto') return YOLO_LABEL.toLowerCase()
  return mode ?? 'unrecorded'
}
