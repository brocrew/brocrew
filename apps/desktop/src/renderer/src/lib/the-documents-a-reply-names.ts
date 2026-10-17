import { escaped, literal, markedValueAt, markNamesIn } from './named-in-a-reply'

/**
 * Make a resource id written into transcript text clickable.
 *
 * ## ⛔ The affordance is DERIVED, and the derivation is the app's OWN typed field
 *
 * ⚠️ **Nothing here trusts the words.** ⛔ `548` §Q4 is the rule and it is unchanged by `HO-057`:
 * *"Do not regex every code span into a button … The safe enhancement is to carry a typed document
 * reference in the transcript/work-report shape, validate it against the canonical document door,
 * and render the button only after that validation."* ⚑ **The only strings that become a control
 * here are ones this app itself minted and put on {@link WorkReport.resources}** — see
 * {@link everyResourceAReportNames}, which builds the roster out of the SAME predicate the work
 * report's own press is drawn from. 🔴 A model writing `res_…` about a file it wishes existed
 * produces the text it always produced.
 *
 * ⚑ **A roster read from the app's own data, matched against the rendered HTML, never against the
 * source** — `named-in-a-reply.ts` owns that walk.
 *
 * ## ⚠️ Why the id may match in RUNNING PROSE and not only inside a code span
 *
 * 🔴 **A resource id can never be an ordinary word**: it is `res_<32 hex>`, minted by
 * `newResourceId`, and a uuid is unspellable by accident. ⚑ So there is one pattern here, and it is
 * the same one inside a code span and in running prose.
 *
 * ⚠️ **And running prose is where the app's own sentence puts it.** `replyText` (`reply-rails.ts`)
 * composes *"Its resources: res_… (plan.md). Read one with read_document."* with **no backticks at
 * all**, so the id a person is most likely to see is not a code span. ⛔ (That sentence lands in
 * `WorkReportItem.text`, which `WorkReportEntry.vue` draws as `{{ item.text }}` and never as
 * Markdown — so this function does not reach it, and it does not need to: that row's presses are
 * in its meta line already.)
 */

/**
 * 🔴 **What counts as part of an id here** — and the characters that are deliberately NOT in it.
 *
 * ⛔ **`_` and `-` are in**, so a roster holding one id does not mark the head of a longer token
 * that merely starts with it. ⛔ **`.` and `:` are OUT, and that is measured rather than tidy**: the
 * app's own sentence follows an id with a space and ends a list of them with a full stop, and a
 * model's prose may follow one with a colon — treating either as part of a name would refuse the
 * one occurrence this module exists for. ⚠️ Nothing is lost by it: `res_<32 hex>` holds neither.
 */
const PART_OF_AN_ID = /[A-Za-z0-9_-]/

/**
 * ⛔ **The words on the press, and they are NOT `OPEN_THE_DOCUMENT`.**
 *
 * ⚠️ **`OPEN_THE_DOCUMENT` says the file is *"kept with this reply"*** (`the-document-a-report-names.ts`),
 * which is true only on the reply's own row. 🔴 **An id in a sentence sits in somebody else's
 * words**, so reusing it would print *this reply* over a message that is not one. ⛔ A shared
 * constant is only shared where the sentence is true of both callers (`169` §1 cuts this way too).
 *
 * ⚑ **It says what the press OPENS and never what it costs**: reading a file claims nothing,
 * changes nothing and ends when the panel is closed.
 *
 * ⛔ **It is a `title` and not a label**, because the control's visible text is the id itself — a
 * word inside a sentence, which is `439`'s ruling about an in-text control.
 */
export const READ_THE_DOCUMENT_NAMED = 'Open this file'

/**
 * 🔴 **Wrap every mention of a resource this app keeps in a control that opens it.**
 *
 * ⛔ **Longest first**, so a roster holding two ids where one is a prefix of the other matches the
 * longer.
 *
 * @param html the output of `renderChatMarkdown`, and nothing else.
 * @param resourceIds the ids this transcript's own work reports carry. An empty roster returns the
 *   html untouched.
 */
export function documentsNamedIn(html: string, resourceIds: readonly string[]): string {
  const named = [...new Set(resourceIds.filter((id) => id.length > 0))].sort(
    (a, b) => b.length - a.length,
  )
  if (named.length === 0) return html
  // ⚑ **One pattern, in prose and in a code span alike** — see this module's header: an id is never
  // an ordinary word, so there is nothing for a prose narrowing to protect.
  return markNamesIn(html, {
    pattern: new RegExp(named.map(literal).join('|'), 'g'),
    boundary: PART_OF_AN_ID,
    mark: (id) => {
      // ⛔ **Escaped**: a resource id is BYTES OFF A LEDGER — `toPersistedEvents` casts
      // `JSON.parse(row.payload) as TranscriptEvent` and a `.brobot` bundle is validated as
      // `z.object({ type: z.string().min(1) }).passthrough()` and written verbatim, which is the
      // same measurement `the-document-a-report-names.ts` guards the TYPE for.
      const safe = escaped(id)
      return (
        `<button type="button" class="open-the-document" data-cy="open-the-document" ` +
        `data-document="${safe}" title="${READ_THE_DOCUMENT_NAMED}">${safe}</button>`
      )
    },
  })
}

/**
 * ⛔ **The resource id a click landed on, or `null`** — the delegation half, kept beside the markup
 * so the attribute name is written once.
 *
 * ⚠️ **`data-document` is the work report press's attribute too** (`WorkReportEntry.vue`), and that
 * is deliberate rather than a collision: one attribute means *this element names a file to open*, and
 * the two are never in one delegation scope — this one is bound on `AssistantMessage`'s rendered
 * markdown, which holds no work report row. ⛔ Reading it with `closest` is what makes a click on
 * the TEXT inside the control land, which is how a person clicks a word.
 */
export function documentClicked(target: EventTarget | null): string | null {
  return markedValueAt(target, 'data-document')
}
