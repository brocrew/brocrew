import type { TranscriptEvent } from '../conversation-events'
import type { DocumentForm, DrawnAs, ResourceRole } from '../documents'
import type { RetitleRail } from '../piece-called'
import type { LedgerWalkKind } from '../question-contracts'
import type { ChildThreadState } from '@brobot2/runtime'

/**
 * One provider config file, **as the host found it on disk** — not as anyone assumed
 * it would be. `exists` is the point: an absent file must read as absent, and the
 * renderer has no filesystem access with which to check, so it must be told.
 */
/**
 * What a workflow's output file read produced (108) — the document, or a word saying why not.
 *
 * A union rather than `WorkflowOutput | null` so the viewer can say which of the four things
 * happened. `gone` is the ordinary one: workflow outputs live under the OS temp directory.
 */
export type WorkflowOutputResult = (
  | { ok: true; name: string; text: string; truncated: boolean; bytes: number }
  | { ok: false; reason: 'no-output' | 'gone' | 'not-readable' | 'unreadable' }
) &
  LedgerRowsUnread

/**
 * ⚑ **697 · `676` §5 — the ledger rows an answer's reads could not parse, COUNTED.**
 *
 * ⛔ The workflow and child doors resolve from `workflow_run`/`sub_agent` rows; until `697` one torn
 * row made them raise, and now a torn row is skipped — so an answer may be older, or narrower, than
 * the ledger's truth (*no output*, *no record of that agent*), and this says by how many rows.
 * ⚠️ **Present on every answer the host gives — `0` is a measurement — and absent on a renderer's own
 * fallback**, where no read happened. A count and never a cause: a torn row cannot say what it held.
 * ⚑ **Drawn since `712`** (`697` H-a), beside the two absences it narrows: `WorkflowOutputViewer`'s
 * *"did not report an output file"* and `ChildWorkViewer`'s *"no record of that agent"* each add
 * *"in the rows this app could read; N … could not be read"*. ⚠️ The live channel's own *"no record
 * of that agent"* is not one of them: {@link ChildStateResult} and {@link ChildSendResult} carry no
 * count.
 */
export interface LedgerRowsUnread {
  readonly rowsUnread?: number
}

/**
 * 🔴 **One resource, read for the PERSON who pressed the row that names it** (510, as a document;
 * a resource since D-016) — or a WORD saying why not.
 *
 * ⛔ **Not the agent's refusal vocabulary.** `read_document`'s rails carry a permanence, a
 * retryability and a remedy addressed to a model deciding what to do next; ⚑ a person gets a
 * sentence, which is what every other viewer on this wire is handed — {@link WorkflowOutputResult},
 * {@link ChildWorkResult} — and re-spelling the rails here would put an agent's refusal grammar on a
 * window.
 *
 * ## ⚠️ Four reasons
 *
 *  - ⛔ **`no-such-resource`** — this app holds no resource by that id. An id written before D-016
 *    (a document's) names none, and reads this way.
 *  - ⚑ **`no-store`** — this app keeps no resources folder in this run, which is a different thing
 *    to be told from *there is no such resource*.
 *  - ⚠️ **`unreadable`** — the file is absent, is not a plain file, or cannot be read: each ends with
 *    a person going to look, so one word serves.
 *  - ⛔ **`changed`** — the bytes no longer hash to what was kept, so nothing is shown as if it were
 *    the resource.
 */
export type ResourceReading =
  | {
      ok: true
      /** The id the row named, echoed so the panel and the press cannot disagree about which. */
      resourceId: string
      /** `report.md` — the FILE's name as it was handed in, never a path. */
      name: string
      /**
       * 🔴 **635 · what the bytes ARE** (`HO-097` §1.3: *"show each type the way a person expects"*).
       *
       * ⛔ **Derived from the kept name** and never from a column, so the window and the file cannot
       * disagree about what a resource is.
       */
      form: DocumentForm
      /**
       * ⚑ **The TEXT, hash-re-checked on the way out** — Markdown for a report, the source for a
       * page, and ⛔ **`null` for a form that encodes none.**
       *
       * ⚠️ **`null` and never `''`.** Every resource holds at least one byte, and a picture is a
       * different thing entirely: a viewer that could not tell them apart would draw a blank page over
       * an image (`an-unenumerated-state-counts-as-success`).
       */
      text: string | null
      /** What was recorded when it was kept, so the panel can say how big it is without measuring. */
      bytes: number
    }
  | { ok: false; reason: 'no-such-resource' | 'no-store' | 'unreadable' | 'changed' }

/**
 * 🔴 **D-032 · a kept picture or PDF, read for the PERSON who opened it** — its bytes, checked
 * against the hash it was kept with, and the type main says they are drawn as — or a word saying
 * why not. ⚑ Read when a person opens it and at no other time: nothing asks for it on a timer.
 *
 * ## ⛔ What the window does with it, and must not do — an agent's file is untrusted
 *
 *  - ⛔ **Every URL is made by one file, `renderer/src/lib/kept-file-urls.ts`**: `pictureUrl` for an
 *    `<img>`, `pdfFrameUrl` for a PDF's frame. It is the only file the census in
 *    `window-navigation.test.ts` lets make a blob URL, and its own test pins what it refuses.
 *  - ⚑ **A picture is drawn by an `<img>` and nothing else**, from `pictureUrl`: a PNG, JPEG, GIF or
 *    WebP as a `blob:` of exactly its type (`img-src` admits `blob:`), and ⛔ **an SVG as a `data:`
 *    URL, never a blob**, so no blob the window holds can run script in its origin even if a bug
 *    ever frames it (`frame-src` refuses every `data:` URL). An `<img>` runs no script, loads nothing an SVG names
 *    and lets no event out, whatever the file holds. ⛔ **Never** an SVG's text in the page
 *    (`innerHTML`, `v-html`, an inline `<svg>`), and never an SVG in an `<object>`, an `<embed>` or
 *    a frame — each of those runs it as a document.
 *  - ⚑ **A PDF is drawn by Chromium's own viewer, in an `<iframe>` whose `src` is `pdfFrameUrl`'s**
 *    — a `blob:` typed `application/pdf`, the one frame the content security policy
 *    (`frame-src blob:`) and the navigation guard (`permitsSubframe`) admit. `pdfFrameUrl` refuses
 *    any other `drawnAs`. ⛔ The viewer that frames it will be the one file the same census lets make
 *    a frame, and it frames that URL alone: never a `data:` URL, never `srcdoc`, and no `sandbox` or
 *    `csp` attribute — measured on Electron 43.2.0, the viewer loads under neither.
 *  - 🔴 **Why the frame must hold nothing else**: a `blob:` frame has the window's own origin, so
 *    script running in it reaches the window's `api` through `parent` — measured: a page or an SVG
 *    framed as a `blob:` by mistake ran a script from a local file and reached `api`. ⚑ A PDF's own
 *    script runs in the PDF's frame, in a process of its own, never in the window's.
 *  - ⛔ **The type is `drawnAs`, exactly** — never one the window chooses or reads off the name.
 *  - ⚑ The window lets the URL go (`release`) when the viewer closes or shows another file.
 *  - ⛔ **`name` is the agent's own**: any character but `/` and NUL, direction overrides among
 *    them. It is drawn as text and never as markup.
 *  - ⚠️ **The content security policy is not the barrier here**: every `blob:` document inherits it,
 *    and it runs no inline script and no script from a `blob:` or a `data:` URL, but `script-src
 *    'self'` on the window's `file:` origin admits a script from any local file.
 *
 * ## ⚠️ The reasons
 *
 *  - `no-such-resource`, `no-store`, `unreadable` and `changed` — as {@link ResourceReading}.
 *  - ⛔ **`not-a-picture-or-pdf`** — a Markdown file or a page: {@link ResourceReading}'s text is
 *    its door.
 *  - ⚠️ **`too-large`** — bigger than a window is handed (`bytes` and `mostBytes`): nothing is read,
 *    and the window offers {@link RuntimeBridge.revealResource} instead. ⚑ The bound is the one
 *    pictures and PDFs are kept under, so only a hand-edited row or file can meet it; ⚠️ a file that
 *    really is bigger is not revealed either (`unreadable`).
 *  - ⚠️ **`too-many-pixels`** — a PNG, JPEG, GIF or WebP that says it is bigger than a window draws
 *    (`width` × `height` past `mostPixels`, 64 megapixels): a picture is decoded whole, so a small
 *    file can take gigabytes to draw. The window offers {@link RuntimeBridge.revealResource} instead.
 *  - ⛔ **`not-what-its-name-says`** — the bytes are not a picture or not a PDF, as the name says
 *    (a page named `.pdf`, say), so they are not handed over to be drawn as one. ⚠️ A picture of
 *    another type than its extension's — a PNG saved as `.jpg` — is drawn, as what it is.
 */
export type ResourceDrawing =
  | {
      ok: true
      /** The id the row named, echoed so the viewer and the press cannot disagree about which. */
      resourceId: string
      /** `chart.png` — the FILE's name as it was handed in, never a path. */
      name: string
      /** ⛔ The type to draw the bytes as — set by main from the bytes' own opening. */
      drawnAs: DrawnAs
      /** The kept bytes, exactly — typed as `new Blob([bytes])` takes them. */
      bytes: Uint8Array<ArrayBuffer>
    }
  | {
      ok: false
      reason:
        | 'no-such-resource'
        | 'no-store'
        | 'unreadable'
        | 'changed'
        | 'not-a-picture-or-pdf'
        | 'not-what-its-name-says'
    }
  | { ok: false; reason: 'too-large'; bytes: number; mostBytes: number }
  | { ok: false; reason: 'too-many-pixels'; width: number; height: number; mostPixels: number }

/**
 * 🔴 **D-032 · whether a kept file was shown in Finder, by its id** — or why not.
 *
 * ⚠️ **`ok: true` means the OS was asked**, as {@link RevealResult}'s does. ⛔ **No path comes
 * back**: a kept file is reached by its id, and the window has no use for where this app keeps it.
 *
 *  - `no-such-resource` and `no-store` — as {@link ResourceReading}.
 *  - ⚠️ **`gone`** — its row is here and nothing is where this app keeps its file.
 *  - ⛔ **`unreadable`** — what stands there could not be read as a kept file: not a plain file,
 *    outside the folder this app keeps files in, or bigger than any file it keeps. Nothing is shown.
 *
 * ⚑ A file whose bytes have **changed** is still shown, and `changed` says so: it is where this app
 * kept it, and a person restoring it needs to find it.
 */
export type ResourceReveal =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'no-such-resource' | 'no-store' | 'gone' | 'unreadable' }

/**
 * 🔴 **D-026 · R1 — which kept files a window asks for: exactly one of three.**
 *
 * ⚑ **A conversation is named by its id, and a piece by its label (`W1.3`) or its id** — the
 * spellings every other door here takes.
 */
export type FilesKeptScope =
  /**
   * Every file on the pieces this conversation holds or gave — and, D-017 · R10, those the
   * conversations it took the place of gave — and on every piece under those, at any depth: for the
   * holder of a root, the whole tree.
   */
  | { scope: 'tree'; conversation: string; withAdded?: true }
  /** The files this conversation added: what it made and the inputs it handed over. */
  | { scope: 'conversation'; conversation: string }
  /** The files kept on one piece. */
  | { scope: 'piece'; piece: string }

/**
 * 🔴 **D-026 · R1 — one kept file, as every surface draws it** — the same row in all three scopes
 * of {@link FilesKept} and on {@link RUNTIME_STATES_CHANNEL}.
 */
export interface KeptFile {
  readonly group?: import('../work-file-groups').WorkFileGroup
  readonly mainResult?: true
  /** `res_…` — what `readResource` opens. */
  readonly resourceId: string
  /**
   * 🔴 **Its title, never empty** — taken from its bytes when it was kept: a Markdown file's first
   * `# ` heading, a page's `<title>`, else its name.
   */
  readonly title: string
  /** `report.md` — the FILE's name as it was handed in, never a path. */
  readonly name: string
  /**
   * What the bytes ARE, derived from the name as {@link ResourceReading.form} is — ⚠️ `null` for a
   * name this build has no word for, and a surface draws less rather than something else.
   */
  readonly form: DocumentForm | null
  /** Its size, as recorded when it was kept. */
  readonly bytes: number
  /** What it is to its piece: an input its giver handed over, or something its holder made. */
  readonly role: ResourceRole
  /** When it was kept — epoch ms. */
  readonly keptAt: number
  /** Lower-case hex of the bytes as they were kept — the same file wherever it is kept. */
  readonly sha256: string
  /**
   * **Who added it** — the conversation, its agent's name and its identity (the folded slug,
   * `SpawnEdge.identity`'s word), in the words the rest of the window names them by; ⚑ `null`: a
   * person. ⚠️ `identity` is `null` for a conversation this app holds no identity for.
   */
  readonly addedBy: {
    readonly conversation: string
    readonly name: string
    readonly identity: string | null
  } | null
  /** The piece it was kept on — `work_…`. */
  readonly piece: string
  /** That piece's label — `W1.3.1`. */
  readonly label: string
  /** The title that piece stands under now — `null`: a root nobody has titled. */
  readonly pieceTitle: string | null
}

/**
 * 🔴 **D-026 · R1 — what a window is answered about the files kept in one scope** — in label order
 * (a piece before the pieces under it, siblings and roots by number), then oldest first within a
 * piece; ⚑ or the word for a scope that names nothing this app holds, in the words its neighbours
 * answer that with. ⚠️ A scope that names something real and holds no files answers an empty list.
 */
export type FilesKept =
  | { ok: true; files: readonly KeptFile[]; added?: readonly KeptFile[] }
  | {
      ok: false
      reason:
        | Extract<LedgerWalkKind, 'no-such-conversation'>
        | Extract<RetitleRail, 'no-piece-by-that-name'>
    }

/**
 * One instruction file the provider reported, read ON REQUEST (356 §2) — or a WORD saying why not.
 *
 * ⛔ **`path` comes back even though the caller named an index**, and it is the path the PROVIDER
 * gave us rather than where a link landed: the viewer's toolbar has to agree with the row that was
 * pressed. ⚠️ **`no-source` is not `gone`.** `gone` means the file has been removed since the
 * provider loaded it — ordinary, and worth saying. `no-source` means the row is not one this
 * session's provider reported at all, which is a refusal rather than an absence.
 */
export type InstructionSourceResult =
  | { ok: true; path: string; name: string; text: string; truncated: boolean; bytes: number }
  | { ok: false; reason: 'no-source' | 'gone' | 'not-readable' | 'unreadable' }

/**
 * ⚑ **Which path on the Info panel a gesture is about** (356 §1) — never the path itself.
 *
 * ⛔ **The renderer names a ROW; main re-derives the string.** The file doors that read text refuse
 * a renderer-supplied path by construction (`workflow-output`, `child-work`, `instruction-source`),
 * and a reveal that took one would invert those rulings however small the diff. (`asset-protocol`
 * takes one and, since `726` · R92, serves any image file it names.) Each member below
 * names something the host already holds for the session: its working directory, its provider home,
 * one of the config files `readProviderConfig` reports, or one row of the provider's own list.
 */
export type SessionPathTarget =
  | { of: 'cwd' }
  | { of: 'home' }
  | { of: 'config-file'; name: string }
  | { of: 'instruction-source'; index: number }

/**
 * Whether a path was shown to the person at the machine (356 §1), or why it was not.
 *
 * ⚠️ **`ok: true` means the OS was asked, not that a window appeared.** `shell.showItemInFolder`
 * returns nothing and reports nothing; what this can honestly say is that a path was resolved and
 * handed over. The refusals are the states this app can see: the row named nothing it holds, or
 * there is nothing at that path any more.
 */
export type RevealResult = { ok: true; path: string } | { ok: false; reason: 'no-path' | 'gone' }

/**
 * The path-like texts the window found in ONE message, as written. A relative one is read from the
 * conversation's working folder; with no conversation, only absolute and `~` paths are read.
 */
export interface MessagePathAsk {
  readonly sessionId: string | null
  readonly texts: readonly string[]
}

/** One path-like text, as main resolved it now: nothing, or a file or a folder that is there. */
export type MessagePath =
  | { readonly text: string; readonly found: false }
  | {
      readonly text: string
      readonly found: true
      /** The full path, for the hover. */
      readonly absolute: string
      /** The last part of the path, for the link's name. */
      readonly name: string
      readonly kind: 'file' | 'folder'
      /** Whether a press opens it: only a file whose type is on main's document allowlist. */
      readonly opens: boolean
    }

/** One path a message wrote, for a press: the conversation it is read from, and the text. */
export interface MessagePathTarget {
  readonly sessionId: string | null
  readonly text: string
}

/**
 * What a press on a path did: opened a document in its default app, or showed the path in the file
 * manager. `gone` is nothing at it now; `no-path` is text that names no path; `failed` is the
 * computer refusing to open it.
 */
export type OpenMessagePathResult =
  { ok: true; did: 'opened' | 'shown' } | { ok: false; reason: 'gone' | 'no-path' | 'failed' }

/**
 * 🔴 **733 · one config file of this session's home, read now** — the Info panel's Open.
 *
 * ⛔ **Until `733` that panel offered only Finder for these files, and said why in a credential's
 * terms** (`auth.json` is one of them). The PM, on `731` F-2, under R92 and R93: *"Offer Open as
 * for any other file, and drop the credential wording."* ⚑ So it is the provider-reported file's
 * Open ({@link InstructionSourceResult}) on another row: the renderer names the FILE by the name
 * {@link ProviderConfigFile} gave it, and main looks the path up in the session it launched.
 *
 * ⚠️ `no-path` is {@link RevealResult}'s word for the same row naming nothing — a file this
 * provider does not declare, or a session this host is not holding.
 */
export type ConfigFileResult =
  | { ok: true; path: string; name: string; text: string; truncated: boolean; bytes: number }
  | { ok: false; reason: 'no-path' | 'gone' | 'not-readable' | 'unreadable' }

/** Which of a sub-agent's artefacts to open (112). See `main/child-work.ts` for where each lives. */
export type ChildWorkPart = 'transcript' | 'journal' | 'script'

/**
 * What to open, and the id it is addressed by (112).
 *
 * ⚠️ **A transcript belongs to an AGENT and a journal or a script belongs to the RUN**, so they are
 * keyed differently and the type says so rather than leaving one field to be ignored. Review found
 * why it matters: keyed on `agents[0]`, a run whose first-announced agent was still queued had no
 * file to find the run directory by, and both footer buttons refused a journal that was on disk.
 */
export type ChildWorkInput =
  { part: 'transcript'; agentId: string } | { part: 'journal' | 'script'; taskId: string }

/**
 * What a sub-agent's own work read produced (112) — the file, or a word saying why not.
 *
 * ⚠️ **`entries` is present for a TRANSCRIPT and only for one**, and it is the parsed conversation
 * rather than a second copy of the prose: a child's `.jsonl` is an ordinary Claude transcript, so it
 * is folded by the same `applyEvent` and drawn by the same components as any other. `text` is the
 * bytes as written, which is what the Raw view shows and what makes the rendering checkable.
 *
 * `unknown-agent` is not `gone`: it means no READABLE row of this session's ledger reported that
 * agent — a disagreement between the screen and the record rather than a missing file — and it is
 * the door's allowlist saying no. ⚠️ Since `697` a torn row is skipped rather than raised, so beside
 * `rowsUnread` above 0 it may have been reported in a row this app could not read. ⚑ **`unsupported` no longer means Codex** (115): a Codex child is
 * a real thread and opens its own rollout. It means a JOURNAL or a SCRIPT of one — a thread is in
 * no run, so those two do not exist for it rather than being unread.
 */
/**
 * Why BroBot could not ask about a child, or could not speak to one (296).
 *
 * ⛔ **ONE vocabulary for both verbs**, so the viewer holds one table of sentences rather than two
 * that drift. The first four are *"we never got to ask"*; the last four are the provider's own
 * answer about the child, and only {@link ChildSendResult} can carry those.
 *
 * - `unknown-agent` — no readable row of this session's ledger reported that child. The allowlist
 *   saying no, and the same word {@link ChildWorkResult} uses for the same refusal (which carries
 *   `rowsUnread`; this one only warns — `697`).
 * - `unsupported` — this provider has no channel to a child at all. Claude: measured absent against
 *   the SDK's whole control surface, see `claude/capabilities.ts`.
 * - `not-live` — nothing is running. A recording opened from the library has a transcript on disk
 *   and no app-server behind it, so there is no connection on which to ask.
 * - `unreachable` — the provider was asked and did not answer inside the budget.
 * - `working` · `not-accepting` · `unloaded` · `error` — the child's own state, refusing the send.
 */
export type ChildTalkRefusal =
  | 'unknown-agent'
  | 'unsupported'
  | 'not-live'
  | 'unreachable'
  | 'working'
  | 'not-accepting'
  | 'unloaded'
  | 'error'

/** What asking about a child produced (296) — its state, or a word saying why we could not ask. */
export type ChildStateResult =
  | { ok: true; state: ChildThreadState }
  | { ok: false; reason: 'unknown-agent' | 'unsupported' | 'not-live' | 'unreachable' }

/**
 * What offering a message to a child produced (296).
 *
 * ⚠️ **`state` rides on the refusal so the viewer can say WHICH child fact refused it** — *"it is
 * still working"* rather than *"no"*. It is absent on the four arms decided before the provider was
 * reached, because there is no state to report on those.
 */
export type ChildSendResult =
  | { ok: true; turnId: string | null }
  | { ok: false; reason: ChildTalkRefusal; state?: ChildThreadState }

export type ChildWorkResult = (
  | {
      ok: true
      part: ChildWorkPart
      name: string
      /** The workflow run it belongs to, or null for a plain Task child that is in no run. */
      runId: string | null
      /**
       * The run this app's ledger recorded the agent under, or null when there is no run.
       *
       * ⚑ **Nullable since 115**, and for the reason `runId` already was: a plain `Task` child and a
       * Codex child thread belong to no workflow, and the alternative was to borrow some other id
       * to fill the shape — a name for an absence, which 086/104 rule out.
       */
      taskId: string | null
      /**
       * What the child was ASKED to do, when its sidecar says (115).
       *
       * ⚠️ **Only a plain `Task` child's `.meta.json` carries this.** A dynamic workflow's agent
       * gets `{"agentType":"workflow-subagent","spawnDepth":1}` and nothing more, so this is absent
       * for one kind of child and present for the other — measured, not assumed.
       */
      title?: string
      /** The tool-use that dispatched it, from the same sidecar and with the same asymmetry. */
      parentToolCallId?: string
      text: string
      truncated: boolean
      bytes: number
      /** The folded conversation, for `transcript` only. */
      entries?: TranscriptEvent[]
      /** One optional diagnostic reading per entry, in exactly the same order. */
      errorFacts?: readonly (import('../error-facts').ErrorFacts | undefined)[]
      /** Lines that were not JSON at all — reported, never silently dropped. */
      unreadable?: number
      /**
       * How many thinking blocks the child recorded, for `transcript` only.
       *
       * ⛔ **A count, never a rendering** (109). Measured: every one of them has an empty body and a
       * signature, and the importer drops them for that reason — so this is the only way the viewer
       * can say what was there without implying the reasoning is readable.
       */
      thinkingBlocks?: number
    }
  | {
      ok: false
      reason: 'unknown-agent' | 'unsupported' | 'gone' | 'not-readable' | 'unreadable'
    }
) &
  LedgerRowsUnread
