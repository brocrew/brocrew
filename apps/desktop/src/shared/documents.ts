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

/**
 * ⚑ **D-016 · the most files one call may hand in** — a reply's `resource_paths`, a give's `inputs`
 * and `update_work`'s `resources` — and so the most resource ids a reply's stored report can
 * honestly name, which is how the store bounds one.
 */
export const MAX_RESOURCES_PER_REPLY = 10

/**
 * 🔴 **D-024 · R3 — the most files `list_tasks` lists of what a profile made.** ⚑ One reply's worth,
 * the same number as {@link MAX_RESOURCES_PER_REPLY}, and a constant of its own because it bounds
 * something else: how many rows a model reads in one answer before a list stops being one. ⛔ The
 * rest are counted, never dropped in silence, and a piece's own record lists all of its resources.
 */
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

/**
 * Classify resources handed back by agents as Markdown reports, pages, images or PDFs.
 *
 * ⚠️ **Orthogonal to {@link RESOURCE_ROLES}**: the role is what the file is TO its piece, and this
 * is what the bytes ARE — an input can be a page and something made can be Markdown.
 *
 * ## ⚑ It is DERIVED from the kept name and stored nowhere
 *
 * 🔴 **The form of a resource is a pure function of its name** ({@link formOfName}). ⛔ **A column
 * would be a second answer** free to disagree with the file on disk — and the file is the thing a
 * person opens (`HO-095` §4's *never two sources of truth*). ⚠️ A name this build has no word for
 * reads as `null`, not as a member, and every reader draws less rather than something else —
 * `an-unenumerated-state-counts-as-success`.
 */
export const DOCUMENT_FORMS = ['markdown', 'page', 'image', 'pdf'] as const
export type DocumentForm = (typeof DOCUMENT_FORMS)[number]

/**
 * ⛔ **Extension → form, and it is the ONE table** (635).
 *
 * ⚠️ **It decides two things at once and that is why it is one table**: what a reply may hand in
 * as a resource, and what form a kept resource reads back as. ⚑ Two tables would be two chances to
 * disagree about `.jpeg`.
 *
 * ⛔ **An ALLOW-LIST, which is the shape untrusted input needs** (`HO-097` §1.2 for the frame, and
 * the same argument for the store): a deny-list of types we will not take admits every type
 * nobody has thought of yet.
 *
 * ⚑ **Lower-cased keys, and the lookup lower-cases too** — `README.MD` is Markdown.
 */
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
    return `${FORM_SAID[form]} (${extensions.join(', ')})`
  }),
)

/**
 * ⚑ **The form a file with this name would be**, or `null` because this app has no word for it.
 *
 * ⛔ **It takes a NAME and never a path**, so a caller cannot reach a filesystem through it and
 * `shared/` keeps its promise. ⚠️ The extension is everything after the LAST dot; a name with no
 * dot has none.
 */
export function formOfName(name: string): DocumentForm | null {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  return FORM_OF_EXTENSION[name.slice(dot).toLowerCase()] ?? null
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
 * 🔴 **What an agent's MODEL is handed when it reads a resource** (635, `HO-097` §1.2).
 *
 * > ⚑ *"A form its model can actually use — the text of a page, the image itself, the content of a
 * > PDF. Where a type cannot be handed to a model, the tool says so plainly rather than returning
 * > something useless."*
 *
 * ## ⛔ A discriminated union, and `not-for-a-model` is a MEMBER rather than a missing key
 *
 * ⚠️ **The field it replaces was `markdown: string`.** ⛔ A PNG has no markdown, and an optional
 * string whose absence renders as empty is `an-unenumerated-state-counts-as-success` exactly — the
 * model would read `''` and conclude the document was blank. ⚑ `a-value-beside-a-word-or-a-union-of-arms`:
 * one-arm values want a union.
 *
 * ## ⚠️ Why an image is NOT a member today, measured rather than assumed
 *
 * ⛔ **`AgentToolAnswer` is `{ text: string; structured?: Record<string, unknown> }`**
 * (`packages/runtime/src/agent-tools.ts`) — ⚑ **there is no image member on the contract BOTH
 * adapters translate**, so neither provider can be handed a picture through this toolset. 🔴 **That
 * is a property of the toolset and not of the providers**, which is why the answer is the same for
 * both and why this is not the lowest common denominator picked silently (`635` §3.3): the door
 * that would have to widen is named, and it is in `packages/runtime`.
 */
export const NOT_FOR_A_MODEL = [
  /** ⛔ An image. The bytes are a picture and this app's tool answers carry text. */
  'a-picture-is-not-text',
  /**
   * ⛔ A PDF. ⚠️ **Its text could be extracted and this app does not do it**: a PDF parser is a
   * dependency with its own parsing surface over a file an agent wrote, and `HO-097` §1.2 says to
   * say so plainly rather than return something useless. ⚑ A person reads it; a model is told why
   * it cannot.
   */
  'a-pdf-is-not-text',
] as const
export type NotForAModel = (typeof NOT_FOR_A_MODEL)[number]

/**
 * ⛔ **What a model may do about a resource it cannot be handed** (635, `HO-097` §1.4's shape).
 *
 * ⚑ **It names an ARTIFACT and not a verb** (`422` §3), and it is the honest act: this app keeps the
 * resource and a PERSON can open it, so the thing to do is tell whoever asked.
 */
export const NOT_FOR_A_MODEL_ACT =
  'This app keeps it and a person can open it here; say so in your reply and name it by its resource id.'

export type DocumentContent =
  /** ⚑ Markdown, as it was kept — the arm every document had before `635`. */
  | { readonly as: 'markdown'; readonly text: string }
  /**
   * ⚑ **A page's SOURCE, as text.** ⛔ Not rendered, not stripped, not summarised — a model reads
   * HTML perfectly well, and anything else here would be this app deciding what the page says.
   */
  | { readonly as: 'source'; readonly text: string }
  /** ⛔ **Nothing a model can use**, and it says which of the two it is. */
  | { readonly as: 'not-for-a-model'; readonly because: NotForAModel }

/**
 * ⚑ **What a resource of this form is handed to a model AS** — the one mapping, so a form added
 * tomorrow does not compile until somebody answers this question for it.
 */
export const CONTENT_OF_FORM: Readonly<Record<DocumentForm, DocumentContent['as']>> = {
  markdown: 'markdown',
  page: 'source',
  image: 'not-for-a-model',
  pdf: 'not-for-a-model',
}
