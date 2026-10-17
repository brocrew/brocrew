import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ASSET_SCHEME_PRIVILEGES,
  openResolvedAsset,
  resolveAssetRequest,
} from '../src/main/asset-protocol'
import { ASSET_SCHEME, assetUrl } from '../src/shared/asset-url'
import { permitsNavigation } from '../src/main/window-navigation'

/**
 * The door model-produced images come through (067).
 *
 * Two claims, and the second is the acceptance criterion:
 *  1. an image is served;
 *  2. **nothing else is** — and "nothing else" is tested with the paths an agent could actually
 *     arrange, not with a well-formed request that happens to be wrong.
 *
 * ⚑ **`726` · R92 — "nothing else" is decided by what the file IS, never by where it is.** Until
 * `726` claim 1 read *an image inside the app's own provider homes*, and nine tests here pinned
 * that root and the `generated_images` depth anchor inside it. R92 removed both: eight of those
 * tests went with them, and the one that inverts cleanly is kept below as what is true now.
 *
 * ⚠️ Real files and real symlinks, no `fs` mock. See `generated-image.test.ts` for the argument;
 * it applies twice as hard here, because this function is the security boundary rather than a
 * convenience on top of one.
 */

const PROJECT = 'default'
const PROFILE = 'default'
const THREAD = '019fcfb1-073a-74b0-b81a-6de6c47c57b4'
const PIXEL = Buffer.from([0x89, 0x50, 0x4e, 0x47])

let root: string
let images: string
let outside: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot-067-homes-'))
  images = join(root, PROJECT, PROFILE, 'codex', 'generated_images', THREAD)
  mkdirSync(images, { recursive: true })
  outside = mkdtempSync(join(tmpdir(), 'brobot-067-elsewhere-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

function image(name = 'exec-1.png'): string {
  const path = join(images, name)
  writeFileSync(path, PIXEL)
  return path
}

describe('resolveAssetRequest — serves an image, and only an image (067)', () => {
  it('serves a generated image, with the media type read from its extension', () => {
    const path = image()
    const asset = resolveAssetRequest(assetUrl(path))
    expect(asset?.contentType).toBe('image/png')
    expect(asset?.path).toContain('exec-1.png')
  })

  it('round-trips a path with spaces, `#`, `?` and a `/`-looking escape', () => {
    // Default macOS paths include the space in “Application Support”. Encode the entire path
    // as one URL segment so filenames cannot restructure it; otherwise images fail to load on
    // default installs.
    const path = image('a b#c?d.png')
    const url = assetUrl(path)
    expect(url).not.toContain(' ')
    expect(resolveAssetRequest(url)?.path).toContain('a b#c?d.png')
  })

  it('🔴 372 · a case alias of an image is served under the file’s OWN spelling', () => {
    // ⚑ **The half of 372 that R92 left standing** (`726`'s review). The path this door answers with
    // is the one the host records for an image, so it is the spelling the filesystem keeps — APFS
    // folds case, and `realpathSync` hands back the alias it was given where `.native` does not.
    // Until `726` the other half, an alias outside the root staying out, was tested here too.
    const path = image('372-own.png')
    const leaf = basename(path)
    const alias = join(
      dirname(path),
      leaf.replace(/[a-z]/, (letter) => letter.toUpperCase()),
    )
    // A case-sensitive filesystem makes this a different missing file, not a second spelling.
    if (alias === path || !existsSync(alias)) return
    expect(resolveAssetRequest(assetUrl(alias))?.path).toBe(realpathSync.native(path))
  })

  it('refuses another scheme wearing the same shape', () => {
    const path = image()
    expect(resolveAssetRequest(`file://${path}`)).toBeNull()
    expect(resolveAssetRequest(`http://x/${encodeURIComponent(path)}`)).toBeNull()
  })

  it('🔴 726 · R92 — an image OUTSIDE the provider homes is served; a non-image there is not', () => {
    // ⛔ On `main` this was refused (067 acceptance 7: an image outside the provider-homes root).
    const anywhere = join(outside, 'anything.png')
    writeFileSync(anywhere, PIXEL)
    expect(resolveAssetRequest(assetUrl(anywhere))?.path).toContain('anything.png')
    // …and its controls, in the same directory: what still keeps a file out is its TYPE and its
    // existence, wherever it is.
    const notes = join(outside, 'notes.json')
    writeFileSync(notes, '{}')
    expect(resolveAssetRequest(assetUrl(notes))).toBeNull()
    expect(resolveAssetRequest(assetUrl(join(outside, 'gone.png')))).toBeNull()
  })

  it('⚠️ refuses a multi-segment URL even when the segments spell a file it WOULD serve', () => {
    // The single-segment rule, made to matter. `brobot-asset://file//<path>` gives `pathname` a
    // leading `//`; stripping one `/` leaves an absolute path that passes the media type and the
    // regular-file check — so without the rule this is a second, unencoded spelling of a
    // legitimate request, and one whose contents Chromium has already normalized on the way in.
    // (`726` · R92: it used to pass a root and a segment check as well; both are gone.)
    //
    // ⚠️ Also written because of a mutation: the obvious version (`.../a/b`) returns null either
    // way, since a multi-segment path is not absolute once one slash is stripped.
    const path = image()
    expect(resolveAssetRequest(`${ASSET_SCHEME}://file/${path}`)).toBeNull()
    // Non-vacuity: the same file, one encoded segment, is served — so the refusal is about the
    // spelling and not about the file.
    expect(resolveAssetRequest(assetUrl(path))?.path).toContain('exec-1.png')
  })

  it('refuses traversal spelled in the URL — more than one segment is never ours', () => {
    // ⚑ `726` · R92: traversal spelled in the PATH is no longer refused for where it lands — the
    // path is made real and judged by its type like any other, so that half of this test went with
    // the root it measured against.
    //
    // A hand-built URL rather than `assetUrl`: an attacker does not have to use our helper. Multiple
    // segments are refused outright, because everything we emit is exactly one.
    expect(resolveAssetRequest(`${ASSET_SCHEME}://file/../../etc/passwd`)).toBeNull()
    expect(resolveAssetRequest(`${ASSET_SCHEME}://file/a/b`)).toBeNull()
  })

  it('refuses a NUL, which would truncate the path at the syscall', () => {
    // ⚠️ **Belt and braces, and said out loud.** Node's own `realpathSync` throws
    // `ERR_INVALID_ARG_VALUE` on a path containing a NUL, so this request is refused with or
    // without the explicit check — a mutation removing that check survived this test, and that is
    // the correct outcome rather than a gap. The assertion is on the BEHAVIOUR, which is what a
    // consumer depends on; the explicit check stays because it is the only one that does not
    // depend on which call happens to run first.
    const path = image()
    expect(
      resolveAssetRequest(`${ASSET_SCHEME}://file/${encodeURIComponent(`${path}\0.txt`)}`),
    ).toBeNull()
  })

  it('refuses a relative path, an empty one, and a malformed escape', () => {
    expect(resolveAssetRequest(`${ASSET_SCHEME}://file/${encodeURIComponent('x.png')}`)).toBeNull()
    expect(resolveAssetRequest(`${ASSET_SCHEME}://file/`)).toBeNull()
    expect(resolveAssetRequest(`${ASSET_SCHEME}://file/%E0%A4%A`)).toBeNull()
  })

  it('refuses a non-image extension and a missing file', () => {
    const json = join(images, 'notes.json')
    writeFileSync(json, '{}')
    expect(resolveAssetRequest(assetUrl(json))).toBeNull()
    expect(resolveAssetRequest(assetUrl(join(images, 'gone.png')))).toBeNull()
  })

  it('refuses a directory that ends in `.png`', () => {
    const dir = join(images, 'trap.png')
    mkdirSync(dir)
    expect(resolveAssetRequest(assetUrl(dir))).toBeNull()
  })
})

describe('openResolvedAsset — the check and the open cannot be separated (067 review, HIGH)', () => {
  it('⚠️ refuses a symlink, which is what the swap looks like at open time', () => {
    // The race: `resolveAssetRequest` hands back a REAL path, and the model — which writes that
    // directory — can unlink the file and drop a symlink in its place before it is opened. A real
    // path's final component is never a symlink, so one appearing there is the swap and nothing
    // else. The race itself cannot be staged deterministically from outside; this is the property
    // it rests on, and without it the mutation that drops `O_NOFOLLOW` survives every other test.
    const target = join(outside, 'secret.png')
    writeFileSync(target, PIXEL)
    const link = join(images, 'swapped.png')
    symlinkSync(target, link)
    expect(openResolvedAsset(link)).toBeNull()
  })

  it('opens an ordinary file — the refusal above is about the symlink, not about failing always', () => {
    const fd = openResolvedAsset(image('ordinary.png'))
    expect(fd).not.toBeNull()
    if (fd !== null) closeSync(fd)
  })

  it('returns null for a file that has been moved away, rather than throwing', () => {
    // The ordinary case, not an attack: Codex's own skill tells the model to move these into the
    // workspace. A throw here would be an unhandled exception in the MAIN process.
    expect(openResolvedAsset(join(images, 'never-existed.png'))).toBeNull()
  })
})

describe('the scheme cannot become a document — 050 is unchanged (067 acceptance 6)', () => {
  /**
   * The load-bearing claim of the whole mechanism: an `<img>` is a subresource fetch and never
   * raises a navigation event, and *if one ever did*, 050 already refuses it. Asserted against the
   * real `permitsNavigation` rather than described, in both of the two modes it has.
   */
  it('050 refuses a brobot-asset URL in dev and in production, with no change to its code', () => {
    const path = image()
    const url = assetUrl(path)
    expect(permitsNavigation({ indexHtml: '/app/renderer/index.html' }, url)).toBe(false)
    expect(
      permitsNavigation(
        { indexHtml: '/app/renderer/index.html', devServerUrl: 'http://localhost:5290' },
        url,
      ),
    ).toBe(false)
  })

  it('the app document is still permitted — the guard was not narrowed to say no to everything', () => {
    // The other half of the assertion above. A guard that refused its own entry would also "pass"
    // the test above, and would be a broken app rather than a secure one.
    expect(
      permitsNavigation(
        { indexHtml: '/app/renderer/index.html', devServerUrl: 'http://localhost:5290' },
        'http://localhost:5290/index.html',
      ),
    ).toBe(true)
  })

  it('the scheme is privileged but never CSP-exempt', () => {
    expect(ASSET_SCHEME_PRIVILEGES.scheme).toBe(ASSET_SCHEME)
    expect(ASSET_SCHEME_PRIVILEGES.privileges.standard).toBe(true)
    expect(ASSET_SCHEME_PRIVILEGES.privileges.secure).toBe(true)
    // ⚠️ The one that must never flip: a bypass would make this scheme the way to load anything the
    // day a CSP is added.
    expect(ASSET_SCHEME_PRIVILEGES.privileges.bypassCSP).toBe(false)
  })
})
