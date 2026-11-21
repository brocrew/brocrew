import { normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WebContents } from 'electron'
import { PDF_VIEWER_ORIGIN } from '../shared/content-security-policy'

/** A navigated document inherits this window’s preload. Admit only the renderer entry the app loads. */
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

/** Match the dev server’s entry path under its configured base, including a trailing slash or index.html. */
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

/** Compare parsed URL components so a shared string prefix cannot stand in for the same origin. */
export function permitsNavigation(document: AppDocument, candidate: string): boolean {
  const target = parseUrl(candidate)
  if (!target) return false
  return document.devServerUrl === undefined
    ? isPackagedDocument(document.indexHtml, target)
    : isDevDocument(document.devServerUrl, target)
}

/**
 * Compare normalized local file paths, including encoded names, localhost and extra leading slashes.
 * The comparison is case-sensitive and does not resolve symlinks.
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

/** Send only HTTP and HTTPS URLs to the OS browser. URL parsing normalizes the scheme’s case. */
export function externalTarget(candidate: string): string | null {
  const target = parseUrl(candidate)
  if (!target) return null
  return target.protocol === 'http:' || target.protocol === 'https:' ? candidate : null
}

/** Check both frame navigations and redirects. The kept-PDF exception applies on will-frame-navigate. */
export const GUARDED_NAVIGATION_EVENTS = [
  'will-navigate',
  'will-redirect',
  'will-frame-navigate',
] as const

/** Attach to the preload-bearing window. Refuse window opens and webviews to keep that scope local. */
export function installNavigationGuard(
  contents: WebContents,
  document: AppDocument,
  openExternal: (url: string) => void,
): void {
  /**
   * Electron stops the gesture after cancellation, so its first navigation event owns the browser handoff.
   * Only the redirect event can carry the app’s programmatic entry load. See the navigation probe.
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
        // A same-entry gesture could reload the renderer. Cancel it silently, including in development.
        // The entry-path check ignores query changes in both builds.
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
