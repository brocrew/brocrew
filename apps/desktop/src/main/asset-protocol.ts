import { constants, createReadStream, realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { Readable } from 'node:stream'
import { imageMediaType, openNotThroughALink } from '@brobot2/runtime'
import { ASSET_SCHEME } from '../shared/asset-url'

/**
 * **The door this app's images come through** (067).
 *
 * The URL is one **the renderer produced**, and the renderer is a surface an agent can write into
 * (`AssistantMessage` renders model-authored Markdown — which may not name this scheme at all,
 * `markdown.ts`), so nothing about the request is believed beyond what makes a file PIXELS: the path
 * is decoded, made real, and required to be a regular file carrying an extension we are willing to
 * call an image. Anything else is a 404 — not an error page, not a reason.
 *
 * Files may be served from any readable location. Retain the type check because the response is drawn as an image; reject SVG documents because they can carry script. Refusing a non-image file such as `auth.json` follows from that rendering constraint.
 */

/** What a permitted request resolves to: a real file, and what to call it. */
export interface AssetResponse {
  /** The real (symlink-resolved) absolute path to stream. */
  path: string
  /** The media type, decided from the extension of the REAL path. */
  contentType: string
}

/**
 * `realpath`, or null. A missing file has no real path, and this handler treats "not there" and
 * "not allowed" as the same answer.
 */
function realOrNull(path: string): string | null {
  try {
    // Filesystem identity, not the path spelling the renderer supplied: it is what gets streamed.
    return realpathSync.native(path)
  } catch {
    return null
  }
}

/**
 * Decide a request, with no Electron and no I/O beyond `stat`/`realpath` — so the whole security
 * boundary is one pure-ish function a test can drive with real directories and real symlinks.
 *
 * Returns null for every refusal. The caller turns that into a 404.
 *
 * @param url the request URL, verbatim and untrusted
 */
export function resolveAssetRequest(url: string): AssetResponse | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // `URL` lower-cases the protocol, so a `BROBOT-ASSET:` spelling needs no second thought.
  if (parsed.protocol !== `${ASSET_SCHEME}:`) return null

  // `pathname` is `/<encoded path>`. One segment by construction (`assetUrl` encodes the whole
  // path), and a request that brings more than one is not one we made.
  const encoded = parsed.pathname.replace(/^\//, '')
  if (encoded === '' || encoded.includes('/') || encoded.includes('\\')) return null
  let candidate: string
  try {
    candidate = decodeURIComponent(encoded)
  } catch {
    return null // a malformed percent-escape
  }

  // A NUL truncates the path at the syscall boundary, so a name containing one is not the name
  // that would be opened. Refused rather than trimmed.
  if (candidate.includes('\0')) return null
  if (!isAbsolute(candidate)) return null

  const real = realOrNull(candidate)
  if (real === null) return null

  // Read from the REAL path: a symlink named `.png` may resolve to something else, and it is the
  // resolved file that would be streamed.
  const contentType = imageMediaType(real)
  if (contentType === null) return null

  try {
    if (!statSync(real).isFile()) return null
  } catch {
    return null
  }
  return { path: real, contentType }
}

/**
 * Open a verified asset for reading, or null.
 *
 * ⚠️ **`O_NOFOLLOW`, and it is not decoration.** {@link resolveAssetRequest} returns a path STRING
 * it has verified, not a handle, so between the `realpath` that verified the file and the `open`
 * that reads it the model — which writes that directory — can unlink the file and drop a symlink in
 * its place. The path handed here is already a REAL path: `realpathSync` resolved every link in it,
 * so its final component is by definition not a symlink. **If it is one by the time we open it,
 * that IS the swap**, and `ELOOP` is the right answer. Nothing legitimate ever trips it. Windows has
 * no `O_NOFOLLOW`, so there the name is looked at once the file is open ({@link openNotThroughALink}).
 *
 * The descriptor is then what gets streamed, not the path, so once open the read is pinned to that
 * inode and a later rename or replace cannot change what is sent.
 *
 * Its own function so that the guarantee can be TESTED — the race itself cannot be staged
 * deterministically from outside, but "a symlink is refused at open" can, and that is the property
 * the guarantee rests on.
 *
 * Null also covers the ordinary case: the file was moved between check and use, which Codex's own
 * image-generation skill instructs the model to do.
 */
export function openResolvedAsset(path: string): number | null {
  try {
    return openNotThroughALink(path, constants.O_RDONLY)
  } catch {
    return null // ELOOP (the swap), ENOENT (moved), EACCES — all the same answer to a caller
  }
}

/** What Electron must be told about the scheme, BEFORE `app.whenReady` — see `installAssetProtocol`. */
export const ASSET_SCHEME_PRIVILEGES = {
  scheme: ASSET_SCHEME,
  privileges: {
    /**
     * A standard scheme has a real origin, which is what stops it comparing equal to the `'null'`
     * that every opaque scheme shares — the trap `window-navigation.ts` documents.
     */
    standard: true,
    /** Treated as a secure context, so a page served over http in dev may load it. */
    secure: true,
    /** Served from disk, so responses stream rather than buffer. */
    stream: true,
    /**
     * ⚠️ **Never `bypassCSP`.** This scheme should be subject to whatever policy the document has,
     * not exempt from it — an exemption would make it the one way to load anything if a CSP is ever
     * added.
     */
    bypassCSP: false,
  },
} as const

/** The minimum surface of Electron this needs, so the wiring is testable without an app. */
export interface AssetProtocol {
  handle(scheme: string, handler: (request: Request) => Promise<Response> | Response): void
}

/**
 * Serve `brobot-asset:`.
 *
 * Streamed rather than read into a buffer: the measured images are 1.6 MB and 2.1 MB, and a handler
 * that buffers holds that in the main process's heap for the length of the request — the main
 * process being the one that must never stutter (see `index.ts` on why `ps` runs off-thread).
 */
export function installAssetProtocol(protocol: AssetProtocol): void {
  protocol.handle(ASSET_SCHEME, (request) => {
    const asset = resolveAssetRequest(request.url)
    if (!asset) return new Response(null, { status: 404 })
    // ⚠️ **Opened ONCE, by descriptor, with `O_NOFOLLOW` — and that closes a real race** (067
    // review, HIGH). `resolveAssetRequest` returns a path STRING it has verified, not a handle. An
    // earlier version passed that string to `createReadStream`, which opens it AGAIN — so between
    // the `realpath` that verified the file and the `open` that read it, the model (which writes
    // that directory) could unlink the file and drop a symlink in its place, and the stream would
    // have followed it to a file the check never saw.
    //
    // Two things fix it, and both are needed:
    //  - **`O_NOFOLLOW`** — the path we open is already a REAL path, so its final component is by
    //    definition not a symlink. If it is one by the time we open it, that IS the swap, and
    //    `ELOOP` is exactly the right answer. Nothing legitimate ever trips it.
    //  - **streaming from the `fd`, not the path** — once open, the descriptor is pinned to that
    //    inode. Renaming, unlinking or replacing the file afterwards cannot change what is read.
    //
    // It does not close the same race on an intermediate DIRECTORY; that needs an `openat` walk
    // Node does not expose. The remaining window is one component wide, and what it could yield is
    // bytes drawn as a picture in our own window — not data the model can read back.
    const fd = openResolvedAsset(asset.path)
    if (fd === null) return new Response(null, { status: 404 })
    // `autoClose` is the default and is what releases the descriptor; it is named because a leaked
    // fd in the main process is a leak for the life of the app.
    const stream = createReadStream('', { fd, autoClose: true })
    // Without this, a mid-read failure raises `error` on a stream nobody is listening to, which in
    // Node is an uncaught exception in the MAIN process. The renderer sees a truncated body and the
    // app stays up.
    stream.on('error', () => stream.destroy())
    // `as` because Node's web-stream type and the DOM `BodyInit` type describe the same object
    // through two different declaration files; `Response` accepts it at runtime.
    const body = Readable.toWeb(stream) as unknown as ReadableStream
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': asset.contentType,
        // The file is named after an immutable provider id and is never rewritten in place, so a
        // re-render must not re-read it. Private: it is one user's private image.
        'Cache-Control': 'private, max-age=3600',
      },
    })
  })
}
