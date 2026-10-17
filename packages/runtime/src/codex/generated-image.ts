import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * **Where a Codex-generated image really is** — turning the provider's claim into a checked fact
 * (067).
 *
 * ## What was measured
 *
 * Codex records generated files through `ImageGenerationItem.savedPath`, with rollout `saved_path` naming the same bytes. The provider's default convention is `generated_images/<threadId>/<call_id>.png`; its bundled skill allows files to remain under `$CODEX_HOME/generated_images/...`.
 *
 * ## Why the provider's path is not simply believed
 *
 * `savedPath` arrives over the wire, from a process running model-authored code — the same skill
 * has a fallback mode that shells out to a script. A path from there is **input**, and this app has
 * already paid once for treating provider-adjacent input as trustworthy (050: an agent could author
 * a link that navigated the window and inherited the preload). So the path is not used to open a
 * file; it is used to *propose* one, and the proposal is checked:
 *
 *  - it must be absolute and exist — by **real** path, which is the file that is then shown;
 *  - it must be a regular file — not a directory, not a fifo, not a device;
 *  - its extension, on the real path too, must be one we are willing to call an image.
 *
 * Accept a generated image at any readable location rather than require `<codexHome>/generated_images`. Keep the rendering type check: SVG can carry script and is not served as an image. Refusing non-images such as `auth.json` is a consequence of that check.
 *
 * A claim that fails any of those is discarded rather than repaired, and the caller emits an image
 * event with no path. **There is no fallback to "show it anyway"**, because the failure modes this
 * refuses are exactly the ones that would matter.
 *
 * ## Why there is a fallback for a MISSING claim
 *
 * `savedPath` is `Option<AbsolutePathBuf>` in the vendored types, and no capture of a live v2
 * `item/completed` frame exists on this machine to prove it is populated — the app-server frames are
 * not archived, and Codex's own log database has no row containing the string. So the field name is
 * confirmed (it is in the binary; so are `imageGeneration` and `revisedPrompt`) but its VALUE at
 * runtime is not. When it is absent the file is looked up by the item's own id, which is the naming
 * rule both measured files follow. That is a **lookup, not an invention**: it returns a path only
 * when a file is actually there, so a wrong guess produces nothing rather than a broken image.
 */

/** Codex's own directory name for these, from its own skill text and both measured homes. */
export const GENERATED_IMAGES_DIRNAME = 'generated_images'

/**
 * What we are willing to serve as an image, and what to call it.
 *
 * An allow-list rather than a lookup table over every known type: this set is what the renderer can
 * display in an `<img>`, and the media type is decided HERE from the extension rather than sniffed
 * later, so the thing that admits a file and the thing that labels it cannot disagree.
 *
 * No SVG. An SVG is a document that can carry script and reference other origins, and the point of
 * this whole path is that a model-produced file never becomes anything but pixels.
 */
export const IMAGE_MEDIA_TYPES = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
])

/** The media type for `path`, or null when its extension is not one we display. */
export function imageMediaType(path: string): string | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  return IMAGE_MEDIA_TYPES.get(path.slice(dot).toLowerCase()) ?? null
}

/** `realpath`, or null — a path that does not exist has no real path, and that is not an error. */
function realOrNull(path: string): string | null {
  try {
    // The file's own spelling on disk, not the provider's: it is what the renderer is then handed.
    return realpathSync.native(path)
  } catch {
    return null
  }
}

/**
 * The absolute, real path of a generated image, or null.
 *
 * Null covers every way this can fail to be a displayable file — no claim and no file at the
 * conventional name, a dangling symlink, a directory, an extension we do not display. **Callers must not distinguish them**: all of them mean the same
 * thing to a reader, which is that the picture is not there.
 */
export function resolveGeneratedImage(input: {
  /** The provider home this session's Codex was launched with — `CODEX_HOME`. */
  codexHome: string
  /** The Codex thread id. Its images are in a directory of this name. */
  threadId: string
  /** The item's own id. Codex names the file after it. */
  imageId: string
  /** `ImageGenerationItem.savedPath`, verbatim and untrusted, when the provider sent one. */
  savedPath?: string | undefined
}): string | null {
  // ⚑ The images directory is needed only to build the CONVENTION candidates below; a claim is
  // checked on its own merits wherever it is (`726` · R92).
  const home = realOrNull(resolve(input.codexHome))
  const root = home === null ? null : realOrNull(join(home, GENERATED_IMAGES_DIRNAME))

  // The provider's claim first, the naming convention second. Both are candidates and neither is
  // trusted — they differ only in where the string came from, and the checks below are identical.
  //
  // ⚠️ The convention tries every extension we display, not just `.png` (067 review). Both measured
  // files are PNG and the built-in tool writes PNG, but `savedPath` is optional and an image saved
  // as `.jpg` or `.webp` would otherwise be on disk and permanently unreachable — reported to the
  // user as "the file is gone" while it sat right there.
  const claimed = input.savedPath?.trim()
  const candidates = [
    ...(claimed ? [claimed] : []),
    ...(root === null
      ? []
      : [...IMAGE_MEDIA_TYPES.keys()].map((ext) =>
          join(root, input.threadId, `${input.imageId}${ext}`),
        )),
  ]

  for (const candidate of candidates) {
    // A relative path would resolve against this process's cwd, which is not a place the provider
    // was ever talking about. Refused rather than joined to something.
    if (!isAbsolute(candidate)) continue
    if (imageMediaType(candidate) === null) continue
    const real = realOrNull(candidate)
    if (real === null) continue
    // The extension is re-read from the REAL path: a symlink named `x.png` may resolve to `x.svg`,
    // and it is the resolved file we would be serving.
    if (imageMediaType(real) === null) continue
    try {
      if (!statSync(real).isFile()) continue
    } catch {
      continue
    }
    return real
  }
  return null
}
