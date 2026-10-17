/**
 * ⛔ **What a conversation was opened with, in one line** (211 §3, from 210 finding 4).
 *
 * ## The bug
 *
 * Two Codex conversations, deliberately sharing a profile and a folder — one fixing a line-count
 * bug, one only proposing a plan — drew **exactly the same rail row**: `workspace-a / codex · idle`,
 * twice. The explorer had to open each to find out which was which. ⚑ **Sharing a profile is 166's
 * design and it worked**; what the rows were missing is any fact that differs.
 *
 * ## Why the first message, and not the age or a session suffix
 *
 * The dispatch offered three and asked for one, argued.
 *
 *  - **A short session suffix** (`…#a3f2`) is always available, stable and unique — and it answers
 *    the wrong question. It tells you the two rows are different; it cannot tell you WHICH is the
 *    one you want, which is the sentence 210 actually wrote.
 *  - **The age** moves. Two conversations started a minute apart both read `2m ago`, and a cue you
 *    cannot learn is a cue you re-read every time. It is also already the closed rows' word
 *    (`agoWords`), where it means "last active" — the same register saying two things.
 *  - **The opening line** is what the user typed, so it is the strongest recall cue there is, and it
 *    does not change for the life of the conversation.
 *
 * ⚠️ **It is a LINE, not a title.** Nothing summarizes, shortens by meaning, or asks a model: those
 * would put words on the row that nobody wrote. A prompt long enough to be cut says so with an
 * ellipsis and keeps the whole of itself one hover away.
 */

/**
 * How much of the prompt a rail row can carry before the cut stops being a cue.
 *
 * ⚠️ The row ellipsises in CSS as well, at whatever width the rail happens to be. This bound is
 * about the STRING — a 9,000-character paste rendered into a `title` attribute and diffed on every
 * keystroke of the conversation it belongs to is a cost with no reader.
 */
export const OPENING_LINE_MAX = 120

/**
 * The first line of what was said, or `null` when there is nothing to show.
 *
 * ⚠️ **Whitespace is collapsed, not stripped.** A multi-line prompt is one line here because the row
 * is one line; collapsing runs of it keeps the words in order and keeps a pasted block from becoming
 * a row of blanks. `null` for a message that is nothing but whitespace, because an empty cue that
 * takes up a line is worse than no cue.
 */
export function openingLine(text: string, max: number = OPENING_LINE_MAX): string | null {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return null
  // The ellipsis is a CHARACTER of the answer, so the result never exceeds `max`: a bound that the
  // marker is added on top of is not a bound.
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}
