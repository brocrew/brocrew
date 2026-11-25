/**
 * 🔴 **The forms a resource can take, and what a model may be handed of each** (550, 635; resources
 * since D-016) — the shapes both ends of this app share.
 *
 * ⚑ **A resource is a file kept for a piece of work** — one its giver handed in, or one its owner
 * made, kept as it goes or handed back with its reply — copied byte for byte under this app's own
 * folder and named by its id. ⛔ This module says what a file IS (its form, read off its name),
 * what a resource is TO its piece (its role), and what a model may be handed of it; it reads no
 * file and knows no path.
 *
 * ## ⛔ Why this module exists rather than more lines in `runtime-ipc.ts`
 *
 * ⚑ **`shared/` is the only folder both ends may import from.** The module that keeps the bytes
 * reaches `node:fs` at its first line; a wire type declared there would put the renderer one
 * `import type` away from a module it must never load.
 */

/**
 * 🔴 **D-016 · what a resource is to its piece of work** — an INPUT its giver handed over, or
 * something its owner MADE.
 *
 * ⛔ **The one list**: `work_resource_role_ck` in `db/schema.ts` is built from it, so the database
 * admits exactly the words this app writes and reads.
 */
export const RESOURCE_ROLES = ['input', 'made'] as const
export type ResourceRole = (typeof RESOURCE_ROLES)[number]

/** The most files a single list_tasks answer shows. The rest are counted. */
export const MADE_FILES_LISTED = 10

/**
 * 🔴 **D-037 · the most files `find_files` names in one answer** — a list, or what a search found.
 * ⚑ The rest are counted, and the answer names the file to go on from.
 */
export const FILES_FOUND_LISTED = 25

/**
 * 🔴 **D-037 · how much one search looks through, newest first**: at most this many files, and the
 * text of at most {@link MOST_TEXT_SEARCHED} bytes of them — whichever comes first — so a call costs
 * what these cost and never what the store holds (measured: naming every one of 9,960 files took
 * 554 ms; reading 105 MB of text, 150 ms). ⚑ The answer says how many older files it did not look
 * through, and names the file to go on from.
 */
export const MOST_FILES_SEARCHED = 1_000
export const MOST_TEXT_SEARCHED = 33_554_432

/**
 * ⚑ **D-037 · how far `find_files` counts the files older than what it named** — a count costs what
 * the rows it counts cost, so it stops here and says *at least*.
 */
export const OLDER_FILES_COUNTED = 10_000

/** Known document views; other regular files remain usable kept files. */
export const DOCUMENT_FORMS = ['markdown', 'page', 'image', 'pdf', 'file'] as const
export type DocumentForm = (typeof DOCUMENT_FORMS)[number]

/** Extensions select a view; they do not decide whether a file can be kept. */
export const FORM_OF_EXTENSION: Readonly<Record<string, DocumentForm>> = {
  '.md': 'markdown',
  '.html': 'page',
  '.htm': 'page',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.svg': 'image',
  '.pdf': 'pdf',
}

/**
 * 🔴 **736 · `733` F-4 — the kinds of file this app holds, as a MODEL is told them, rendered from
 * {@link DOCUMENT_FORMS} and {@link FORM_OF_EXTENSION}** — never written out beside them.
 *
 * ⛔ `reply_to_parent`'s resource argument said *"A Markdown file holding the long form"*, and the
 * `summary-too-long` refusal *"a Markdown file"*, while the store took pages, images and PDFs as
 * well (`HO-097`): a sentence that described a capability and drifted when it grew (standing rule
 * 8). ⚑ A form added to the list above is in both sentences the next time a tool is declared.
 */
const FORM_SAID: Readonly<Record<DocumentForm, string>> = {
  markdown: 'a Markdown file',
  page: 'a page',
  image: 'an image',
  pdf: 'a PDF',
  file: 'any other file',
}

/** `a, b, c or d`. */
function listSaid(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1] ?? ''}`
}

/** The forms this app holds, in a model's words: *"a Markdown file, a page, an image or a PDF"*. */
export const HELD_FORMS_SAID = listSaid(DOCUMENT_FORMS.map((form) => FORM_SAID[form]))

/** …and with the extensions each is known by: *"a Markdown file (.md), a page (.html, .htm), …"*. */
export const HELD_FORMS_WITH_EXTENSIONS_SAID = listSaid(
  DOCUMENT_FORMS.map((form) => {
    const extensions = Object.keys(FORM_OF_EXTENSION).filter(
      (extension) => FORM_OF_EXTENSION[extension] === form,
    )
    return extensions.length === 0
      ? FORM_SAID[form]
      : `${FORM_SAID[form]} (${extensions.join(', ')})`
  }),
)

/** A known view selected by the name, or a generic file. */
export function formOfName(name: string): DocumentForm {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return 'file'
  return FORM_OF_EXTENSION[name.slice(dot).toLowerCase()] ?? 'file'
}

/** Card 483: the type of UTF-8 text other than Markdown or a page, by its name; else plain. */
const TEXT_TYPE_OF_EXTENSION: Readonly<Record<string, string>> = {
  '.json': 'application/json',
  '.csv': 'text/csv',
}

export function textTypeOf(form: DocumentForm, name: string): string {
  if (form === 'markdown') return 'text/markdown'
  if (form === 'page') return 'text/html'
  const dot = name.lastIndexOf('.')
  const type = dot < 0 ? undefined : TEXT_TYPE_OF_EXTENSION[name.slice(dot).toLowerCase()]
  return type ?? 'text/plain'
}

/**
 * 🔴 **D-032 · the types a window draws a kept picture or PDF as** — and the only ones. ⛔ No
 * `text/html`, no `text/xml`, no `application/xhtml+xml`: an SVG is drawn as a picture
 * (`image/svg+xml` in an `<img>`), which runs nothing inside it, and never as a document.
 * ⚑ Main reads which one off the bytes themselves, within the form the name says.
 */
export const DRAWN_AS = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
] as const
export type DrawnAs = (typeof DRAWN_AS)[number]

/**
 * 🔴 **731 · the view a text viewer OPENS a file on, read off its name** — the one thing about a
 * file's NAME a text viewer still asks, and it only chooses a pane.
 *
 * ⛔ Until `731` two text viewers took only a short list of extensions (a workflow's output; the
 * instruction files a provider reported), and the list also meant nothing but prose ever opened on
 * the Markdown view. The PM ruled the list away (`726` §9: *"a text viewer opens any readable text
 * file a person names"*), so a `.sh` or a `.py` now arrives too — and rendered as Markdown its
 * `# comment` is a heading. ⚑ So: **Markdown first only for prose** (the prose members of the old
 * list, `.md`, `.markdown`, `.output`, `.txt`), Raw first for everything else, and a page is
 * source only (`HO-097` §1.3, as {@link formOfName}'s `page` is in the resource viewer). ⚠️ The
 * old list's other four (`.json`, `.jsonl`, `.log`, `.csv`) opened on Raw already.
 */
export function textViewFor(name: string): { raw: boolean; sourceOnly: boolean } {
  if (formOfName(name) === 'page') return { raw: true, sourceOnly: true }
  return { raw: !/\.(md|markdown|output|txt)$/i.test(name), sourceOnly: false }
}

/**
 * Text is inline for a person's window; every form names its kept path, its type and its size in
 * bytes, which is all an agent's `read_document` answers (card 483).
 */
export type DocumentContent = (
  | { readonly as: 'markdown'; readonly text: string }
  | { readonly as: 'source'; readonly text: string }
  | { readonly as: 'file'; readonly preview: string | null }
) & { readonly path: string; readonly mimeType: string; readonly bytes: number }

export const CONTENT_OF_FORM: Readonly<Record<DocumentForm, DocumentContent['as']>> = {
  markdown: 'markdown',
  page: 'source',
  image: 'file',
  pdf: 'file',
  file: 'file',
}

export interface GivenInput {
  /** `res_<32 hex>` — `newResourceId`. */
  readonly resource: string
  readonly title: string
  readonly name: string
  readonly sha256: string
  readonly bytes: number
}
