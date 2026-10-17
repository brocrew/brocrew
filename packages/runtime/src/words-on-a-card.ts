import { MAX_PERMISSION_DETAIL_CHARS } from './events'

/**
 * ⚑ **709 · words on a card that this app did not write** — one cleaning policy, two authors.
 *
 * ⚠️ **Lifted out of `claude-runtime.ts`, where `700` wrote it for the provider's own reason**
 * (`providerReason`), because `709` (R44) gives the Codex adapter a second author to clean: the
 * MODEL, whose `justification` arrives as a command approval's `reason` and whose `reason` arrives on
 * a permissions request (both measured, `probe:codex-approval-reason`). ⛔ Two copies of one
 * cleaning would be two chances to disagree about what a card may draw.
 */

/**
 * 🔴 **700 · how a sentence this app did not write is cleaned: terminal escapes out, control characters to a
 * space, reordering marks out.** ⚑ The CLI's own schema for `decision_reason`: *"May carry ANSI
 * escapes; sanitize before rendering."* An escape drawn raw is a box and `[1m`; a control character
 * is a box or a break; U+202A–U+202E, U+2066–U+2069, U+200E/U+200F and U+061C reorder what is drawn
 * without changing what is stored.
 *
 * ⚑ **Every ECMA-48 escape, in both its 7-bit and 8-bit form**, alternatives in this order: CSI
 * (`ESC [` or U+009B, then parameters, intermediates and a final byte — `ESC[1m`); OSC (`ESC ]` or
 * U+009D, to BEL or ST — a hyperlink's `ESC]8;;url BEL`); the strings DCS, SOS, PM and APC (`ESC P`,
 * `X`, `^`, `_` or U+0090/U+0098/U+009E/U+009F, to ST — payload and all); and every other escape,
 * intermediates then one final byte (`ESC(B`, `ESC7`, `ESCc`). ⚠️ An unterminated OSC or string runs
 * to the end, as a terminal would read it.
 *
 * ⚑ **A C1 control is a space in either encoding**: its 8-bit form goes to a space with the other
 * controls, and its 7-bit form — ESC and one byte 0x40–0x5F, {@link C1_IN_SEVEN_BITS} — does too, so
 * `ESC E` (NEL) does not join two words that U+0085 would have kept apart.
 */
/* eslint-disable no-control-regex -- the escapes and the control characters ARE the subject */
const TERMINAL_ESCAPE =
  /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]|(?:\u001B\]|\u009D)[^\u0007\u001B\u009C]*(?:\u0007|\u009C|\u001B\\)?|(?:\u001B[PX^_]|[\u0090\u0098\u009E\u009F])[^\u001B\u009C]*(?:\u009C|\u001B\\)?|\u001B[ -/]*[0-~]/g
const C1_IN_SEVEN_BITS = /^\u001B[@-_]$/
const CONTROL_OR_REORDERING =
  /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g
/* eslint-enable no-control-regex */

/**
 * ⚑ **Words someone other than this app wrote, as a card may carry them** — cleaned, never
 * reworded, or `null`.
 *
 * ⛔ **`null` for anything that is not a string, and for a string that cleans to nothing or to more
 * than {@link MAX_PERMISSION_DETAIL_CHARS}** — dropped rather than cut, as `summary` is: a cut
 * sentence would put words in the author's mouth that end where this app chose.
 */
export function wordsForACard(said: unknown): string | null {
  if (typeof said !== 'string') return null
  const cleaned = said
    .replace(TERMINAL_ESCAPE, (escape) => (C1_IN_SEVEN_BITS.test(escape) ? ' ' : ''))
    .replace(CONTROL_OR_REORDERING, (one) => (one <= '\u009F' ? ' ' : ''))
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned === '' || cleaned.length > MAX_PERMISSION_DETAIL_CHARS) return null
  return cleaned
}
