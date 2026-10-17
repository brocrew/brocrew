import { DRAWN_AS, type DrawnAs } from '../../../shared/documents'
import type { ResourceDrawing } from '../../../shared/runtime-ipc'

/**
 * 🔴 **D-032 · the one place the window turns a kept file's bytes into a URL** — for an `<img>`, or
 * for the one frame a PDF is drawn in.
 *
 * ⚠️ **An agent's file is untrusted, and a `blob:` URL has the window's own origin.** Measured on
 * Electron 43.2.0 under this app's policy: a page or an SVG framed as a `blob:` ran a script from a
 * local file and reached `api`. ⛔ So:
 *
 *  - **a PDF is the only thing framed**: {@link pdfFrameUrl} refuses any other type;
 *  - **an SVG is never a blob**: {@link pictureUrl} draws it from a `data:` URL, which `frame-src`
 *    refuses, so no blob this window holds can run script in its origin, even if a bug frames it;
 *  - **the type is main's** (`drawnAs`), never one chosen here or read off the name.
 *
 * ⚑ The census in `window-navigation.test.ts` lets no other file make a blob URL.
 */

/** A URL a kept file is drawn from, and how to let it go when the viewer closes or moves on. */
export interface KeptFileUrl {
  readonly url: string
  /** Revokes a `blob:` URL; a `data:` URL holds nothing to let go. */
  release(): void
}

/** What a kept file is drawn from: main's answer, the type and the bytes. */
type Drawn = Pick<Extract<ResourceDrawing, { ok: true }>, 'drawnAs' | 'bytes'>

/** Every picture this app keeps: what an `<img>` draws. */
const PICTURES: ReadonlySet<DrawnAs> = new Set(
  DRAWN_AS.filter((type) => type !== 'application/pdf'),
)

/**
 * ⚑ **The URL an `<img>` draws a kept picture from** — a `blob:` of exactly its type for a PNG,
 * JPEG, GIF or WebP, and a `data:` URL for an SVG (measured: one of 16 MiB, the most this app keeps,
 * builds in under half a second and draws). ⛔ A PDF is not a picture: {@link pdfFrameUrl} is its
 * door.
 */
export function pictureUrl(drawn: Drawn): KeptFileUrl {
  // ⚑ Read once: the type checked is the type used.
  const { drawnAs, bytes } = drawn
  if (!PICTURES.has(drawnAs)) {
    throw new Error(`This file is ${drawnAs}, which is not drawn as a picture.`)
  }
  if (drawnAs === 'image/svg+xml') {
    return { url: `data:image/svg+xml;base64,${base64Of(bytes)}`, release: () => {} }
  }
  return blobUrlOf(bytes, drawnAs)
}

/**
 * 🔴 **The URL the one frame a PDF is drawn in loads** — a `blob:` typed `application/pdf`, which
 * Chromium hands to its own viewer, in processes of its own. ⛔ Any other type is refused.
 */
export function pdfFrameUrl(drawn: Drawn): KeptFileUrl {
  const { drawnAs, bytes } = drawn
  if (drawnAs !== 'application/pdf') {
    throw new Error(`Only a PDF is drawn in a frame, and this file is ${drawnAs}.`)
  }
  return blobUrlOf(bytes, 'application/pdf')
}

/**
 * ⛔ **The only types this window makes a blob of** — every picture but an SVG, and a PDF — written
 * out, so a type missing here cannot become a blob at all.
 */
const AS_A_BLOB: Readonly<Record<Exclude<DrawnAs, 'image/svg+xml'>, { readonly type: string }>> = {
  'image/png': { type: 'image/png' },
  'image/jpeg': { type: 'image/jpeg' },
  'image/gif': { type: 'image/gif' },
  'image/webp': { type: 'image/webp' },
  'application/pdf': { type: 'application/pdf' },
}

function blobUrlOf(bytes: Uint8Array<ArrayBuffer>, as: keyof typeof AS_A_BLOB): KeptFileUrl {
  const url = URL.createObjectURL(new Blob([bytes], AS_A_BLOB[as]))
  return { url, release: () => URL.revokeObjectURL(url) }
}

/** Base64, a slice at a time: one `String.fromCharCode` over 16 MiB would take too many arguments. */
function base64Of(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(binary)
}
