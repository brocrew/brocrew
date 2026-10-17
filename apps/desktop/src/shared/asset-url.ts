/**
 * **How a model-produced image gets on screen without ever becoming a document** (067).
 *
 * The renderer needs to display a PNG that lives on disk. Every obvious way to do that is worse
 * than it looks:
 *
 *  - **`file://` in an `<img>`** works in the packaged app (the document is itself a `file:` URL)
 *    and fails in dev (the document is `http://localhost:5290`, and Chromium will not fetch `file:`
 *    from an http origin). A mechanism that only works in one of the two is a mechanism nobody can
 *    test, and it would make `file:` URLs an ordinary thing to write in this renderer — the exact
 *    habit 050 was created to break.
 *  - **base64 in the event payload** is the 2.9 MB blob 052 spent a task removing, and the dispatch
 *    rules it out by name.
 *  - **bytes over IPC** re-copies megabytes per render through a channel built for small structured
 *    messages, and holds them in JS heap on both sides.
 *
 * So there is a scheme of our own. It is served by the main process from the file, streamed, cached
 * by Chromium like any other subresource, and identical in dev and production.
 *
 * ## Why this cannot become a navigation
 *
 * Two independent reasons, and the second does not depend on the first:
 *
 *  1. `permitsNavigation` (050) admits exactly one document — the packaged `index.html` or the dev
 *     server's entry. A `brobot-asset:` URL is neither, in either mode, so every one of the three
 *     guarded navigation events refuses it. **050 is not modified by 067**; it already says no.
 *  2. `externalTarget` hands only `http:`/`https:` to the OS, so a refused `brobot-asset:` URL is
 *     not opened anywhere else either.
 *
 * An `<img src>` is a subresource fetch and never raises a navigation event, which is precisely why
 * this shape was chosen: the picture arrives through a door that cannot lead anywhere.
 *
 * ## Why the URL carries a full path
 *
 * Because the check that matters is not in the URL. The main-process handler checks the path it is
 * given from scratch and refuses anything that does not resolve to a regular file with an image
 * type — see `asset-protocol.ts`. **The URL is untrusted input in both directions**;
 * making it opaque would only hide from the reader what the handler still has to assume.
 */

/** Our scheme. Lower-case letters and a hyphen — the only characters a custom scheme may hold. */
export const ASSET_SCHEME = 'brobot-asset'

/**
 * The host component, which is a constant.
 *
 * A registered *standard* scheme has an origin, and an origin needs a host; leaving it empty makes
 * `new URL()` fold the first path segment into the host and quietly change the path. Naming it
 * removes the question.
 */
export const ASSET_HOST = 'file'

/**
 * The URL that displays the image at absolute path `path`.
 *
 * `encodeURIComponent` on the whole path, not `pathToFileURL`: the path becomes ONE opaque segment,
 * so a filename containing `/`, `..`, `#` or `?` cannot restructure the URL it is being put into.
 * The handler decodes it back to exactly the string passed here and then checks it.
 */
export function assetUrl(path: string): string {
  return `${ASSET_SCHEME}://${ASSET_HOST}/${encodeURIComponent(path)}`
}
