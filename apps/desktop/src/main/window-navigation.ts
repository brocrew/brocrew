import { normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WebContents } from 'electron'
import { PDF_VIEWER_ORIGIN } from '../shared/content-security-policy'

/**
 * **One document may ever hold this window** (050, from 048 §1 finding 2).
 *
 * 017 wrote the threat model down correctly and then enforced it one level too wide. A navigated
 * document INHERITS the window's preload, so whatever page ends up here is handed `window.api.runtime`
 * — session creation on any provider in any cwd, auto-approval, permission answers, export. The guard
 * that was supposed to stop that accepted every URL beginning with `file://`, which is a SCHEME, not
 * a document. Every HTML file on the machine passed it.
 *
 * And an agent can put one there. `markdown.ts` renders links from model output with `html: false`,
 * and markdown-it's own `validateLink` drops a literal `file:` href — but it is a SCHEME check too
 * (`BAD_PROTO_RE = /^(vbscript|javascript|file|data):/`), so a *relative* href carries no scheme and
 * sails through. `[click](../../../tmp/evil.html)` renders as a live `<a>`, and the browser resolves
 * it against the document URL at click time into exactly the `file:///tmp/evil.html` the old
 * predicate welcomed. Nothing in between says no: there is no CSP on `index.html`, no `<base>`, and
 * no click interceptor in `AssistantMessage.vue` — the main process is the only guard there is.
 *
 * So the question this module answers is not "is this a local URL" but **"is this the document this
 * app loaded"**, and the answer is a comparison against the ONE entry the app itself will open.
 */
export interface AppDocument {
  /**
   * The packaged renderer entry, as an absolute filesystem path — the same expression `loadFile`
   * is given, so the thing we permit and the thing we load cannot drift.
   */
  readonly indexHtml: string
  /**
   * electron-vite's dev server (`ELECTRON_RENDERER_URL`), or undefined in a packaged app. When it is
   * set the app loads from http and `indexHtml` is never opened, so exactly one of the two is the
   * entry at any moment — which is why this is a choice below and not an "or".
   */
  readonly devServerUrl?: string | undefined
}

/**
 * The dev server's entry document, as a path, with the spellings that mean the same thing folded
 * together: a trailing slash, and the `index.html` a full reload may ask for by name.
 *
 * Today `ELECTRON_RENDERER_URL` is `http://localhost:5290` — electron-vite composes it as
 * `${protocol}//${host}:${port}` with no path — so this resolves to `/` and `/index.html`. It is
 * written against `server.pathname` rather than against a hardcoded `/` because a Vite `base` config
 * would move it, and because the obvious version of that has an off-by-one: with `base: '/app/'` the
 * server URL is `…/app` and a reload asks for `…/app/`, which an exact string comparison refuses —
 * refusing the app's own document.
 *
 * Narrower than the brief's "compare an exact origin" on purpose: the dev server serves the whole
 * repository, so an origin-only check would still let a link reach any file under it.
 */
function isEntryPath(pathname: string, serverPathname: string): boolean {
  const fold = (path: string): string => (path.endsWith('/') ? path.slice(0, -1) : path)
  const entry = fold(serverPathname)
  return pathname === entry || pathname === `${entry}/` || pathname === `${entry}/index.html`
}

/** Parse, or refuse. A URL this process cannot parse is one it cannot reason about. */
function parseUrl(candidate: string): URL | null {
  try {
    return new URL(candidate)
  } catch {
    return null
  }
}

/**
 * Is `candidate` the app's own document?
 *
 * **Never `startsWith`.** That was the second half of the defect: `http://localhost:5290` is a prefix
 * of `http://localhost:52900`, of `http://localhost:5290.evil.example`, and — worst — of
 * `http://localhost:5290@evil.example`, where everything before the `@` is *userinfo* and the real
 * host is the attacker's. All three are refused here because the URL is parsed and its `origin`
 * compared, which is the only thing that survives that trick.
 */
export function permitsNavigation(document: AppDocument, candidate: string): boolean {
  const target = parseUrl(candidate)
  if (!target) return false
  return document.devServerUrl === undefined
    ? isPackagedDocument(document.indexHtml, target)
    : isDevDocument(document.devServerUrl, target)
}

/**
 * The packaged case: one file, compared as a PATH.
 *
 * Paths rather than URL strings, because the same file has many spellings — a directory with a space
 * arrives percent-encoded, and `..` segments are folded by the URL parser before we ever see them.
 * `fileURLToPath` collapses those differences; `normalize` closes the rest.
 *
 * Measured rather than reasoned about, because file-URL spelling is full of surprises — every claim
 * below was run through `new URL` + `fileURLToPath` + `normalize` before being written here:
 * - **a non-empty host is refused.** `file://evil.example/…/index.html` PARSES fine (`new URL` does
 *   not throw); it is `fileURLToPath` that rejects it, with `ERR_INVALID_FILE_URL_HOST`. The
 *   explicit check runs first so the refusal does not depend on which of the two noticed.
 * - ⚠️ **`localhost` is not a host here.** WHATWG normalizes `file://localhost/x` — and
 *   `file://LOCALHOST/x` — to an EMPTY host, so both arrive as `/x` and are ACCEPTED when the path
 *   is ours. That is correct (in a file URL `localhost` means this machine) and it is written down
 *   because the check above reads as if every spelled-out host were refused.
 * - ⚠️ **`file:////Applications/…` is accepted too.** Four slashes give `pathname` a leading `//`,
 *   which `normalize` collapses — and it is the same file on this platform. Also correct, also not
 *   obvious from reading the comparison.
 * - **case is refused.** macOS filesystems are case-insensitive by default, so `INDEX.HTML` opens
 *   the same bytes but fails this comparison. Denying our own document under an unusual spelling
 *   costs a reload; accepting a lookalike costs the preload. Same for a symlinked path: no
 *   `realpath` here.
 */
function isPackagedDocument(indexHtml: string, target: URL): boolean {
  if (target.protocol !== 'file:') return false
  if (target.host !== '') return false
  let path: string
  try {
    path = fileURLToPath(target)
  } catch {
    return false
  }
  return normalize(path) === normalize(indexHtml)
}

/** The development case: the dev server's exact origin, and only its entry document. */
function isDevDocument(devServerUrl: string, target: URL): boolean {
  const server = parseUrl(devServerUrl)
  if (!server) return false
  // ⚠️ `origin` is the literal string `'null'` for EVERY opaque scheme — `file:`, `data:`, `about:`,
  // `blob:` of one, and anything unrecognized. They therefore all compare equal to one another, so
  // an unguarded `target.origin === server.origin` would make every `file://` URL on the machine the
  // dev server the moment anything set `ELECTRON_RENDERER_URL` to one. Anchor on a real origin,
  // never a computed sentinel.
  if (server.origin === 'null' || target.origin === 'null') return false
  if (target.origin !== server.origin) return false
  return isEntryPath(target.pathname, server.pathname)
}

/**
 * ⚑ **A page of the PDF viewer Chromium ships** ({@link PDF_VIEWER_ORIGIN}) — its scheme, and its
 * extension's id as the host, with nothing else in the
 * authority. ⚠️ Compared part by part, because outside Chromium a `chrome-extension:` URL's origin is
 * opaque (`'null'`), which compares equal to every other.
 */
function isTheViewer(candidate: string): boolean {
  const target = parseUrl(candidate)
  return (
    target !== null &&
    `${target.protocol}//${target.host}` === PDF_VIEWER_ORIGIN &&
    target.username === '' &&
    target.password === '' &&
    target.port === ''
  )
}

/**
 * ⚑ **A `blob:` URL the app's own document minted** — its inner URL is the app's: a local file with
 * no host in the packaged build, the dev server's exact origin in development. ⚠️ Read off the inner
 * URL, because the origin of a `blob:file:` URL is opaque and compares equal to every other.
 */
function isOwnBlob(document: AppDocument, candidate: string): boolean {
  const target = parseUrl(candidate)
  if (!target || target.protocol !== 'blob:') return false
  const inner = parseUrl(target.pathname)
  if (!inner) return false
  if (document.devServerUrl === undefined) return inner.protocol === 'file:' && inner.host === ''
  const server = parseUrl(document.devServerUrl)
  return server !== null && server.origin !== 'null' && inner.origin === server.origin
}

/**
 * 🔴 **D-032 · the one kind of SUBFRAME this window lets load: a kept PDF, drawn by Chromium's own
 * viewer — and only in the shape it was measured in.**
 *
 * ⚠️ **The viewer cannot be sandboxed**: measured on Electron 43.2.0, it never loads in a frame with
 * any `sandbox` value. So the frame is held by what may load in it instead. Measured there, a PDF in
 * a `blob:` iframe under this app's policy with `frame-src blob:`:
 *
 * | depth | frame | process | `will-frame-navigate` |
 * |---|---|---|---|
 * | 0 | the app's document | the window's | — |
 * | 1 | the iframe the window made, `blob:<the app's origin>/<uuid>` | the window's | ✅ that URL |
 * | 2 | the viewer's page, `chrome-extension://<viewer>/index.html` | its own | — the browser makes it |
 * | 3 | the PDF's own frame | its own | ✅ `chrome-extension://<viewer>/<uuid>`, committed as the blob's URL |
 *
 * ⚑ **So two navigations are admitted, each where it was measured**: a `blob:` URL the app's own
 * document minted, in a frame directly under the window's; and a URL of the viewer's own origin, in a
 * frame directly under a page of the viewer, itself directly under that blob frame. ⛔ Everything else
 * is refused as it always was — a `blob:` nested any deeper, the viewer's origin anywhere else, and
 * every other URL in every other frame.
 *
 * 🔴 **Why it must stay exactly this wide**: a `blob:` frame is the app's own origin, so script
 * running in one reaches the window's `api` through `parent`. ⚠️ **And the content security policy
 * does not stop all of it**: a `blob:` document inherits the policy, which runs no inline script, but
 * `script-src 'self'` on a `file:` origin admits any local file. Measured on Electron 43.2.0 in the
 * shipped setup: a page, or an SVG, framed as a `blob:` by mistake ran a script from a local file and
 * reached `api`. ⛔ So what holds the frame is what the window puts in it: only a kept PDF's bytes,
 * typed by main from their `%PDF-`, framed by one helper that refuses any other type — and the
 * window never makes a blob of an SVG, so no blob it holds can run script in its origin. ⚑ The preload never runs
 * in a subframe (`nodeIntegrationInSubFrames` is off) and context isolation is on.
 *
 * ⚠️ **The policy does not hold the viewer's scheme either**: `chrome-extension:` passes a page's
 * `frame-src` in Chromium (measured: the viewer's page asked for as a frame reached this guard), so
 * this rule alone keeps the viewer where it was measured.
 *
 * ⚑ **And measured beside it, with this guard and {@link installSessionRelease} installed**:
 *  - a PDF's frames raise `did-frame-navigate` and never `did-navigate`, so opening one releases no
 *    session;
 *  - the viewer's process or the PDF's dying leaves the window answering, raises no
 *    `render-process-gone` on it, and releases nothing;
 *  - a PDF's JavaScript (`app.launchURL`, `getURL`, `submitForm`) and its open action's URI asked
 *    for no navigation and opened no window;
 *  - ⚠️ a `data:` frame raises no `will-frame-navigate` at all, so this guard never sees one:
 *    `frame-src` is what keeps it out.
 *
 * @param ancestors the URLs of the navigating frame's ancestors, nearest first, without the window's
 *   own frame — `[]` for a frame directly under it.
 */
export function permitsSubframe(
  document: AppDocument,
  candidate: string,
  ancestors: readonly string[],
): boolean {
  if (isOwnBlob(document, candidate)) return ancestors.length === 0
  if (!isTheViewer(candidate)) return false
  const [viewer, blob, ...beyond] = ancestors
  return (
    viewer !== undefined &&
    isTheViewer(viewer) &&
    blob !== undefined &&
    isOwnBlob(document, blob) &&
    beyond.length === 0
  )
}

/** The part of Electron's `WebFrameMain` the subframe rule reads: where a frame is, and what holds it. */
interface FrameInTheTree {
  readonly url: string
  readonly parent: FrameInTheTree | null
}

/**
 * The URLs above a frame, nearest first, without the window's own frame — or `null` when the event
 * names no frame, or names the window's own frame, which the rule refuses.
 */
function ancestorsOf(frame: FrameInTheTree | null | undefined): string[] | null {
  if (!frame?.parent) return null
  const ancestors: string[] = []
  for (let above = frame.parent; above?.parent; above = above.parent) ancestors.push(above.url)
  return ancestors
}

/**
 * A link an agent wrote that belongs in the user's browser, or null.
 *
 * Parsed rather than pattern-matched, for the same reason as above: `protocol` is normalized to
 * lower case by the parser, so `HTTPS://` needs no second thought. Everything else — `file:`,
 * `data:`, `mailto:`, an unknown scheme — is DROPPED rather than handed to the OS, because
 * `openExternal` on an arbitrary scheme is its own way to launch something.
 */
export function externalTarget(candidate: string): string | null {
  const target = parseUrl(candidate)
  if (!target) return null
  return target.protocol === 'http:' || target.protocol === 'https:' ? candidate : null
}

/**
 * Every event that can put a new document in a WebContents, as one list so the set is reviewable.
 *
 * All three carry the same shape (`details.url` + `details.preventDefault()`), which is why one
 * decision function serves all of them:
 * - **`will-navigate`** — the main frame going somewhere. 017 had this one.
 * - **`will-redirect`** — a 3xx during a navigation. 017 did not: an allowed first hop that redirects
 *   was never re-examined, so the check applied to the URL the user clicked and not to the document
 *   that actually loaded.
 * - **`will-frame-navigate`** — the same, for subframes AND the main frame. `html: false` means model
 *   output cannot author an iframe today, and Electron's `nodeIntegrationInSubFrames` (off) is what
 *   its docs tie preload-in-every-iframe to — but a guard whose correctness depends on two unrelated
 *   settings staying false is one flag away from being wrong, so subframes are guarded too. ⚑ D-032 ·
 *   one kind of subframe is admitted, on this event alone: a kept PDF ({@link permitsSubframe}).
 */
export const GUARDED_NAVIGATION_EVENTS = [
  'will-navigate',
  'will-redirect',
  'will-frame-navigate',
] as const

/**
 * Install the guard on the surface that holds the preload.
 *
 * **Why the window and not `app.on('web-contents-created')`.** Because after this runs, the window IS
 * the only surface that can hold the preload, and this function is what makes that true: window opens
 * are denied outright, and a `<webview>` is refused before it attaches. Those are the two ways a
 * second preload-bearing document could come into existence, and both are closed here. Guarding every
 * WebContents in the app would additionally cover Electron's own DevTools, whose navigation this app
 * has no policy for and no reason to break.
 *
 * The whole guard is per-window, so `createWindow()` is the one place that has to call it — and the
 * structural test in `window-navigation.test.ts` fails if a `new BrowserWindow` appears without it.
 */
export function installNavigationGuard(
  contents: WebContents,
  document: AppDocument,
  openExternal: (url: string) => void,
): void {
  /**
   * Refuse, and decide whether this particular event should ALSO hand the link to the browser.
   *
   * Refusing is uniform — that is the security property, and every event does it. Handing off is
   * not: **a gesture hands off, a redirect does not.** A 3xx is not something a person did; the
   * click it came from was already answered.
   *
   * ⚠️ **This used to be a rule about which EVENT hands off, and that rule silently handed off
   * nothing at all for a year** (095, from 094 §6 P4). It read: `will-navigate` hands off for the
   * main frame, `will-frame-navigate` only for a subframe "since the main frame already did" —
   * which is true of Electron's documentation and false of Electron. Measured on 43.2.0, against
   * this very function compiled out of this file and installed on a real `BrowserWindow`, with
   * `openExternal` spied:
   *
   * | window | what it prevents | order observed |
   * |---|---|---|
   * | **the shipped guard** | everything not ours | `will-frame-navigate` — **and nothing else** |
   * | nothing installed | — | `will-frame-navigate` → `will-navigate` |
   * | `will-frame-navigate` only | that one | `will-frame-navigate`, then **no `will-navigate`** |
   * | `will-navigate` only | that one | `will-frame-navigate` → `will-navigate` |
   *
   * So `will-frame-navigate` is emitted FIRST, and Electron's throttle returns on a cancel without
   * ever emitting `will-navigate` — row three is that sentence measured rather than reasoned about.
   * A hand-off owned by `will-navigate` is therefore a hand-off that never runs: `handedToBrowser`
   * was `[]` for `https://example.com/`, and the only external link that reached the browser at all
   * was one opened through `setWindowOpenHandler`.
   *
   * **Once per gesture is now structural rather than arithmetical.** Every hand-off below happens
   * after `preventDefault()`, and a prevented navigation ends the throttle — so whichever gesture
   * event fires first is the only one that fires, whatever order a future Electron picks. The
   * subframe special case is gone with the assumption that needed it.
   *
   * ⚠️ **What that rests on, said out loud** (review): it is Electron's *cancel* semantics, not its
   * *order*, that now carries the once-per-gesture rule — row three above is the measurement of
   * exactly that. An Electron that emitted `will-navigate` after a cancel in `will-frame-navigate`
   * would put two tabs on screen for one click. It would also mean a refused navigation could
   * proceed, which is a far larger problem than a duplicate tab and is not one this rule could
   * paper over. The instrument for both is the same: `pnpm run probe:nav`, smoke step 54, which
   * asserts the cancel really ends the gesture on a real window. A timestamp-keyed de-duplicator
   * was considered and rejected — it would be a number guessing at what a measurement already says.
   *
   * ⚠️ **`ourDocumentIsALoad` is the second per-event fact, and getting it wrong breaks the app's
   * own startup rather than letting something through** (074). It says whether *this* event can be
   * the app opening its entry document, in which case our own URL must be permitted; where it
   * cannot, our own URL is a re-navigation and is refused (see the block below for what that costs).
   *
   * Measured against Electron 43 rather than read off the docs, spawning a window that logs all
   * three and never prevents anything:
   *
   * | | `will-navigate` | `will-frame-navigate` | `will-redirect` |
   * |---|---|---|---|
   * | programmatic `loadFile` of the entry document | — | — | — |
   * | clicking a schemeless `?v=2` in the page | ✅ `isMainFrame=true` | ✅ `isMainFrame=true` | — |
   * | programmatic load through a 302 | — | — | ✅ |
   *
   * So the two gesture events never fire for our own load and can refuse it safely, and
   * `will-redirect` DOES fire inside a programmatic load — which is why it alone treats our own
   * document as a load. A redirect can only reach here from a navigation that was already permitted,
   * and a gesture toward anything else is prevented above before any redirect could follow it.
   *
   * ⚠️ **Read that table as being about a window with NO guard on it, because that is the window it
   * was measured on** — "logs all three and never prevents anything", as its own sentence says. 095
   * re-ran it both ways: unguarded, the click really does raise both gesture events in the order
   * above; with this guard installed, `will-navigate` is never reached at all. Both statements are
   * true and only one of them is about this app, which is how the hand-off came to be wired to an
   * event that cannot fire here. The row still earns its place — `ourDocumentIsALoad` is a claim
   * about which events can carry the app's own startup, and prevention does not change that.
   */
  const refuse =
    (policy: {
      readonly ourDocumentIsALoad: boolean
      readonly isAGesture: boolean
      /** D-032 · the one event a kept PDF's frames load by — see {@link permitsSubframe}. */
      readonly framesAPdf: boolean
    }) =>
    (details: {
      url: string
      isMainFrame?: boolean
      frame?: FrameInTheTree | null
      preventDefault(): void
    }): void => {
      if (policy.framesAPdf && details.isMainFrame === false) {
        // ⛔ A frame read that throws — one whose process is gone — falls through to the refusal
        // below, never past it.
        try {
          const ancestors = ancestorsOf(details.frame)
          if (ancestors !== null && permitsSubframe(document, details.url, ancestors)) return
        } catch {
          // refused below
        }
      }
      if (permitsNavigation(document, details.url)) {
        if (policy.ourDocumentIsALoad) return
        // ⚠️ **Our own document, reached by a GESTURE — refused, and this is data loss if it is
        // not** (074, from 069 §1.5). "Is this our document" and "should this window navigate to it
        // AGAIN" are two questions, and only the first was ever asked. `[refresh](?v=2)` and
        // `[open](index.html)` carry no scheme, so markdown-it's `BAD_PROTO_RE` passes them and they
        // render as live anchors in a model's reply; the browser resolves them against the document
        // URL into this very file, which `permitsNavigation` then correctly says yes to.
        //
        // Measured, because both halves are surprising:
        //  - **it is permitted in BOTH builds.** Packaged, `fileURLToPath` DROPS the query, so
        //    `…/index.html?v=2` normalizes to exactly `indexHtml`. Dev, `?v=2` leaves `pathname` as
        //    `/`, which `isEntryPath` folds to the entry.
        //  - **the cost WAS every live conversation, and 094 fixed that half** (found in review:
        //    this paragraph described the defect in the present tense after it had been repaired).
        //    `main/index.ts` released the window's sessions on `did-start-loading`, which fires for
        //    a load that is about to be refused — so one click on one line of model-authored
        //    markdown ended every session in a window whose guard had just said no. The release now
        //    hangs off {@link SESSION_RELEASE_EVENTS}; refusing here costs nothing but the click.
        //
        // Silent: no `externalTarget` hand-off below. In dev our own document is an `http:` URL, so
        // handing it on would open the app's dev server in the user's browser — a second wrong
        // answer to a click that should simply do nothing.
        details.preventDefault()
        return
      }
      details.preventDefault()
      if (!policy.isAGesture) return
      // Offered to the real browser if it is a web link — where a link from an agent belongs. A
      // denied navigation is silent for every other scheme.
      const outside = externalTarget(details.url)
      if (outside) openExternal(outside)
    }

  // Listed one call per event rather than looped: Electron types `on` as one overload per event
  // name, so a union would not resolve. `GUARDED_NAVIGATION_EVENTS` above is the reviewable set, and
  // the test asserts the registrations MATCH it in both directions — nothing listed but unhandled,
  // nothing handled but unlisted.
  contents.on(
    'will-navigate',
    refuse({ ourDocumentIsALoad: false, isAGesture: true, framesAPdf: false }),
  )
  contents.on(
    'will-redirect',
    refuse({ ourDocumentIsALoad: true, isAGesture: false, framesAPdf: false }),
  )
  contents.on(
    'will-frame-navigate',
    refuse({ ourDocumentIsALoad: false, isAGesture: true, framesAPdf: true }),
  )

  contents.setWindowOpenHandler(({ url }) => {
    // Denied for EVERY url, including the app's own: a second window would be a second preload.
    const outside = externalTarget(url)
    if (outside) openExternal(outside)
    return { action: 'deny' }
  })

  // No surface in this app uses `<webview>`, and `webviewTag` is not enabled — so this never fires
  // today. It is here because a guest page is the one document that WOULD get its own preload
  // without ever raising a navigation event on this WebContents.
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

/**
 * The events that mean this window's renderer no longer holds its sessions (094).
 *
 * ⚠️ **A navigation that HAPPENED — never one that was attempted, and the difference is the whole
 * of 069 §1.5.** The guard above refuses a link back to the app's own document; the sessions were
 * released anyway, because the release was wired to `did-start-loading`, which Chromium raises the
 * moment a load BEGINS and long before anyone gets to veto it. One click on one line of
 * model-authored markdown therefore ended every conversation in the window, in an app whose
 * navigation guard was working perfectly. 074 fixed the window and left this behind; 093 measured
 * it twice (`7 → 0` in the record run, `1 → 0` in a deliberate single-conversation reproduction)
 * and inferred the mechanism without instrumenting it.
 *
 * **094 instrumented it**, against this very function compiled out of this file and installed on a
 * real Electron 43.2.0 `BrowserWindow` — not against a transcription of the policy:
 *
 * | gesture | `did-start-loading` | `did-start-navigation` | `did-navigate` |
 * |---|---|---|---|
 * | the app's own `loadFile` | ✅ | ✅ | ✅ |
 * | a link to `?v=2` — **refused above** | ✅ | ✅ | — |
 * | a link to `index.html` — **refused above** | ✅ | ✅ | — |
 * | an external link — **refused above** | ✅ | ✅ | — |
 * | `location.reload()` — **refused above** | ✅ | ✅ | — |
 * | `webContents.reload()` (⌘R, devtools, menu) | ✅ | ✅ | ✅ |
 *
 * So `did-start-loading` fires for every refusal, exactly as 093 inferred — and so does
 * `did-start-navigation`, which is the trap in the obvious fix: Electron raises it from
 * `WillStartRequest` BEFORE it consults `will-frame-navigate`, so a listener there is just as wrong
 * for a subtler reason. `did-navigate` is the only one of the three that fires when, and only when,
 * a document actually commits — which is the sentence the dispatch asked for made mechanical.
 *
 * `destroyed` stays: a window that is gone holds nothing either, and it is not a navigation at all.
 *
 * **`render-process-gone` is the third, and 095 added it** (094 §6, and the dispatch's own §4). A
 * renderer that CRASHES while its window stays open raises neither of the other two — measured, by
 * calling `forcefullyCrashRenderer()` on the probe window above and reading the log: exactly one
 * event arrived, and it was this one. So a crash left every provider in that window running with
 * nothing able to answer it, which is the same orphan the other two exist to prevent, reached by the
 * one route nobody was watching.
 *
 * ⚠️ **The word "crashed" goes back into `index.ts`'s comment with this line and not before.** 094
 * took it out rather than fake the coverage — the old wiring did not cover a crash either — and the
 * rule it set is the reason it is being typed again: the comment says what the code does.
 *
 * **What this must not cost is the reason the wiring exists.** A renderer that has been replaced has
 * forgotten its session ids, so its providers would run on with nothing able to answer them — and
 * the last row of the table is that case, still covered. `location.reload()` is not, and that is not
 * a regression: the guard refuses it, so it never replaces anything (row five — no `did-navigate`,
 * and the document's marker survives). Re-attaching a live session to a reloaded renderer needs
 * persisted session refs, which is a later slice.
 */
export const SESSION_RELEASE_EVENTS = ['did-navigate', 'render-process-gone', 'destroyed'] as const

/**
 * Wire the release to those events, and to nothing else.
 *
 * **In this file rather than beside the window it is installed on**, because the release is only
 * correct relative to what {@link installNavigationGuard} refuses, and the two living in different
 * files is how they came to disagree for two tasks running. A reader of either one now meets the
 * other.
 */
export function installSessionRelease(contents: WebContents, release: () => void): void {
  contents.on('did-navigate', release)
  // ⚠️ **Not a second `destroyed` in disguise** — the obvious worry, and measured false: closing
  // the probe's window raised `["destroyed"]` and nothing else, crashing its renderer raised
  // `["render-process-gone"]` and nothing else. Two endings, two events, neither standing in for
  // the other. (`closeSessionsForOwner` is idempotent regardless — it closes the slots it finds —
  // so a future Electron that raised both would cost a second walk over an empty list.)
  contents.on('render-process-gone', release)
  contents.on('destroyed', release)
}
