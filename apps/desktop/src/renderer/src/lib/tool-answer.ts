import type { ToolAnswer, ToolAnswerPart } from '../../../shared/runtime-ipc'

/**
 * **What the panel says about what a tool answered** (462) — `457`'s finding 1, *"the structured
 * half of a tool answer is durable nowhere and has no surface"*.
 *
 * ## ⛔ One vocabulary, because there are four silences here too and they are different facts
 *
 * `command-tail.ts`'s table one file over, re-derived for an ANSWER rather than a tail — and the
 * differences are the interesting part:
 *
 * | state | what it means | who produced it |
 * |---|---|---|
 * | an answer with parts | this is what it said | the receipt, whole |
 * | an answer with NO parts | the receipt arrived and carried no words | a picture, a sound, nothing |
 * | no answer at all | this app is not holding one for that call | evicted, or a receipt this adapter does not hold |
 * | this conversation cannot be asked | **it is not running** | every replayed conversation |
 *
 * 🔴 **The last row is the hole `462` §2.2 is about, and it is drawn rather than hidden.** These
 * answers are memory held by a live adapter: nothing persists them, so reopening a conversation
 * from the ledger brings back every row and none of what its tools said. ⛔ **A panel that showed an
 * empty frame there would let a person believe they were seeing everything**, which is the one
 * thing the brief rules out.
 *
 * ⚠️ **And there is NO provider sentence in this file, unlike `tailAbsence`.** That pair exists
 * because one adapter streams a command's output and the other does not, so a card must say why a
 * tail will never come. Both adapters hold answers; what differs is which receipts carry what, and
 * the panel reports that from what actually arrived rather than from a capability.
 */

/**
 * ⛔ **What the panel says INSTEAD of an answer, or `null` when there is one to show.**
 *
 * ⚠️ **`canAsk` is about THIS conversation's handle** — `SessionLiveness.canReadToolAnswer` — and it
 * is asked FIRST so a replay never has to press a door onto nothing. ⚑ A live session whose answer
 * is missing gets the other sentence, because for that one the row really was asked and really
 * answered *"not holding it"*.
 */
export function answerAbsence(answer: ToolAnswer | null, canAsk: boolean): string | null {
  if (!canAsk) {
    return 'What this tool said is no longer held — only its row is kept.'
  }
  if (answer === null) return 'This app is not holding the answer to this one.'
  // ⚠️ **NOT the same sentence as the line above, and `074` is why.** A receipt that arrived
  // carrying no words is a fact about the answer; not holding one is a fact about this app.
  if (answer.parts.length === 0) return 'The receipt arrived and carried no words.'
  return null
}

/**
 * ⛔ **What a ROW says where the button would be, on a conversation that cannot be asked** (462).
 *
 * ⚑ **This is the gap drawn at the place a person looks for the answer**, rather than behind a door
 * that opens onto nothing. The brief's instruction is exact: *"if the honest answer is only live,
 * and a reopened conversation shows nothing, then say that and DRAW it as a gap rather than letting
 * a person think they are seeing everything."*
 *
 * ⚠️ **It names no NUMBER**, and that is `458`'s rule rather than brevity: the row's summary is cut
 * at a bound that lives in `@brobot2/runtime`, a sentence here that said *200* would be a number
 * whose derivation is one import away and whose truth is not — and a value import from there costs
 * the renderer 135 kB for a constant it would only print.
 */
export const ANSWER_NOT_HELD = 'This is the short form of what the tool answered.'

/**
 * 🔴 **685 · what the panel draws under *not holding it*: the short form the row kept** (`675` F-d).
 *
 * ⚑ **The reopened case**: a conversation closed and opened again is running, so the panel can be
 * asked — and the adapter that held the answer is gone, so it answers *not holding it*. ⛔ Until
 * `685` the panel stopped there, over a row that still carried the first 200 characters of the
 * receipt — and for a refusal, `675` put the ACT inside those. ⚠️ **The heading says SHORT FORM**,
 * {@link ANSWER_NOT_HELD}'s own words, so it cannot be read as the whole answer.
 */
export const SHORT_FORM_KEPT = 'The short form its row kept'

/**
 * Part names follow position, not whether text resembles JSON. App tools return one prose part;
 * other receipts can carry several. These headings describe retained receipt parts; forwarding
 * to a model request is measured separately.
 */
export function partHeading(index: number, total: number): string {
  if (index === 0) return 'What it said'
  if (total <= 2) return 'What it sent with it'
  return `What it sent with it (${index} of ${total - 1})`
}

/**
 * ⛔ **The same characters, indented — or `null` when they are not JSON.**
 *
 * ⚑ **This is the whole of what makes 3 691 characters readable**, and it is the argument for a
 * panel rather than a longer row: one line of JSON is a wall, and the same bytes at two spaces of
 * indent are a list a person can scan and pick a row out of.
 *
 * ⚠️ **Objects and arrays only.** `JSON.parse` answers a number for `353` and a string for `"x"`,
 * and re-serialising either changes nothing while claiming to have formatted something. ⛔ **And a
 * failure is `null` rather than a guess**: a part that is not JSON is shown exactly as it arrived,
 * which is also what the Raw view shows, so nothing is ever hidden behind a formatter.
 */
export function asPrettyJson(text: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  try {
    return JSON.stringify(parsed, null, 2) ?? null
  } catch {
    // ⚠️ Reachable: `JSON.parse` cannot produce a cycle, but it can produce a document large enough
    // to throw on re-serialisation. The part is still shown — verbatim — rather than lost.
    return null
  }
}

/**
 * ⛔ **Every part, one after another, exactly as the receipt carried them** — the Raw view.
 *
 * ⚠️ **Newline-joined, and the heading over it says *as the receipt carried them* rather than *what
 * the model received*.** ⚑ `457` measured that Codex joins `inputText` items with a newline before
 * the model sees them, so on that provider the two sentences name the same string. ⚑ **685 · and
 * `675` measured Claude** (`probe:claude-tool-answer`, SDK 0.3.218's bundled CLI against a loopback
 * endpoint, no login): the model-bound request carries the same text blocks the stream carries, in
 * order — but as TWO blocks, not one joined string. ⚠️ (680, re-taken at 0.3.281: the same, and the
 * CLI now ALSO appends its own `<system-reminder><total_tokens>…` after our answer, which the stream
 * does not carry — so *the same blocks* is true of what our tool said, not of every byte.) *"This captures what the provider put in its
 * model-bound request, not a hosted model's obedience to the text."* ⛔ So the newline is this app's
 * own join on that provider, the two sentences still name different things there, and *as the
 * receipt carried it* stays: a claim true on one provider, printed on a surface that draws both, is
 * `039`'s undisclosed asymmetry with the disclosure removed.
 */
export function rawAnswer(answer: ToolAnswer): string {
  return answer.parts.map((part) => part.text).join('\n')
}

/**
 * ⛔ **What a part says when this app kept only its beginning** — `092`'s no-silent-cap rule.
 *
 * ⚠️ **It says the END is gone, which is the opposite end from a command's tail** and is stated
 * rather than implied: an answer is a document whose first sentence `448` ordered first so it would
 * survive a cut, so this app keeps the head. A note that only said *"some is missing"* would leave a
 * reader looking for the rest at the top.
 */
export function partDroppedNote(dropped: number): string {
  return dropped === 1
    ? '1 further character was not kept'
    : `${dropped.toLocaleString()} further characters were not kept`
}

/**
 * ⛔ **What the panel says when the receipt carried more parts than this app keeps.**
 *
 * ⚠️ **Two is every shape this app builds**, so this is reachable only from a provider sending more
 * — and it is said rather than left to a reader to notice that the numbering stops early.
 */
export function partsDroppedNote(dropped: number): string {
  return dropped === 1
    ? '1 further part of this answer was not kept'
    : `${dropped.toLocaleString()} further parts of this answer were not kept`
}

/**
 * ⛔ **How long this part is, for a reader deciding whether to scroll it.**
 *
 * ⚑ **The number `457` had to measure by hand is on the panel** — 353 characters of prose against
 * 3 691 of payload was the measurement that made this dispatch exist, and it took a probe to get
 * it. A person reading their own workspace can now see it without one.
 */
export function partSizeNote(part: ToolAnswerPart): string {
  // ⚠️ **What ARRIVED, not what is held** — the two differ only when the ceiling bit, and a reader
  // who has just been told that some was not kept needs the size of the thing it was cut from.
  // Counted by CODE POINT, because that is the unit the hold was cut by.
  const whole = [...part.text].length + part.dropped
  return whole === 1 ? '1 character' : `${whole.toLocaleString()} characters`
}
