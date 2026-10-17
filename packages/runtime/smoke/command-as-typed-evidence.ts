/**
 * 🔴 **708 · what `probe:claude-command-as-typed` decides from one arm's evidence** — pure, so the
 * verdict is tested in `pnpm run ci` while the probe itself is not (`704`'s
 * `early-interrupt-evidence.ts` shape).
 *
 * ⚑ **The CLI's own word for having RUN a command**, measured on CLI 2.1.281 through the loopback:
 *
 * | command | what it emits when it ran it | what it does when it did not |
 * |---|---|---|
 * | `/clear` | `conversation_reset`, and asks no model anything | hands the words to a model, which answers them |
 * | `/compact` | `system/compact_boundary` after its summary request | hands the words to a model, which answers them |
 */

/**
 * ⚑ **The product's frame in front of a person's words, as bytes** (708's review) — this package
 * cannot import the desktop's `messageNamingItsSender`, so both probes send this copy, and
 * `a-command-goes-as-typed.test.ts` pins it equal to what that function writes for a person.
 * ⚠️ **The whole frame, not its first line**: where a `$` mention sits in the text is part of what
 * the Codex probe measures, so the probe puts it where the product does. ⚑ PE-005 (`a0e50b37`) changed
 * the frame's second paragraph; the landing aligned this copy (its apostrophes as `\u0027`, so the
 * literal stays one single-quoted string that `JSON.parse` reads).
 */
export const A_PERSONS_FRAME =
  'Sent by a person, typed into this app.\n\nYou are answering a person. For a question about a piece another conversation gave you, use the-parent unless that piece\u0027s brief says otherwise. If no conversation gave you work, use a-person when you need the person\u0027s decision. ask_question takes who_answers and there is no default.'

export type CommandUnderTest = '/clear' | '/compact'

/** ⚑ The frame the CLI emits when it RAN the command — see the module table. */
export const RAN_IT: Record<CommandUnderTest, string> = {
  '/clear': 'conversation_reset',
  '/compact': 'system/compact_boundary',
}

export interface CommandArmEvidence {
  readonly command: CommandUnderTest
  /** Every frame after the first turn's `result`, as `type/subtype`. */
  readonly framesAfterFirst: readonly string[]
  /** Did the words sent reach a model as a user message? */
  readonly wordsReachedAModel: boolean
  /** Did the second turn end at all, inside its deadline? */
  readonly secondEnded: boolean
}

/**
 * ⛔ **Three answers, and the third is not a pass.**
 *
 * - `ran-it` — the CLI's own frame for the command, and the words never reached a model;
 * - `words` — the words reached a model, and no such frame: the command was text;
 * - `not-performed` — the turn did not end, or the evidence says both or neither. ⚠️ A run that
 *   cannot be read is never counted as either of the other two.
 */
export function whatTheCliDid(arm: CommandArmEvidence): 'ran-it' | 'words' | 'not-performed' {
  if (!arm.secondEnded) return 'not-performed'
  const ran = arm.framesAfterFirst.includes(RAN_IT[arm.command])
  if (ran && !arm.wordsReachedAModel) return 'ran-it'
  if (!ran && arm.wordsReachedAModel) return 'words'
  return 'not-performed'
}

/**
 * ⚑ **Did the STAMP move anything?** Two arms one fact apart — the person's `origin` and none — are
 * the same when the CLI emitted the same frames and the words went the same way.
 */
export function theStampMovedNothing(stamped: CommandArmEvidence, unstamped: CommandArmEvidence) {
  return (
    stamped.wordsReachedAModel === unstamped.wordsReachedAModel &&
    JSON.stringify(stamped.framesAfterFirst) === JSON.stringify(unstamped.framesAfterFirst)
  )
}
