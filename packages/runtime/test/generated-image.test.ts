import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  GENERATED_IMAGES_DIRNAME,
  imageMediaType,
  resolveGeneratedImage,
} from '../src/codex/generated-image'

/**
 * Where a generated image really is (067).
 *
 * ⚠️ **Driven with real directories, real files and real symlinks, never with a mocked `fs`.** The
 * whole subject here is what the filesystem does with a path — how a symlink resolves, whether a
 * name that looks contained actually is — and a mock is a second opinion about exactly the thing
 * under test. 046 already paid for believing a claim about the filesystem instead of measuring it.
 */

const THREAD = '019fcfb1-073a-74b0-b81a-6de6c47c57b4'
const IMAGE = 'exec-297ad8c6-8e4e-403d-a8af-4d6a5e025cb2'

/** One byte pretending to be a PNG. Nothing here decodes it; existence and extension are the tests. */
const PIXEL = Buffer.from([0x89, 0x50, 0x4e, 0x47])

let home: string
let images: string
let outside: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'brobot-067-home-'))
  images = join(home, GENERATED_IMAGES_DIRNAME)
  mkdirSync(join(images, THREAD), { recursive: true })
  outside = mkdtempSync(join(tmpdir(), 'brobot-067-outside-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

function writeImage(name = `${IMAGE}.png`, dir = join(images, THREAD)): string {
  const path = join(dir, name)
  writeFileSync(path, PIXEL)
  return path
}

/** Change one leaf character while preserving its child segments. */
const alternateCaseLeaf = (path: string): string =>
  join(
    dirname(path),
    basename(path).replace(/[A-Za-z]/, (letter) =>
      letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase(),
    ),
  )

describe('resolveGeneratedImage — the provider proposes, the filesystem decides (067)', () => {
  it('takes the path the provider named, when it is a real file inside the images directory', () => {
    const saved = writeImage()
    const resolved = resolveGeneratedImage({
      codexHome: home,
      threadId: THREAD,
      imageId: IMAGE,
      savedPath: saved,
    })
    // `toContain` on the leaf rather than `toBe(saved)`: macOS resolves /var → /private/var, so the
    // real path legitimately differs from the one handed in. That IS the behaviour — a realpath.
    expect(resolved).not.toBeNull()
    expect(resolved).toContain(`${IMAGE}.png`)
  })

  it('🔴 372 · a case alias of an image is resolved to the file’s own spelling', () => {
    const imageId = '372-no-convention'
    const saved = writeImage('372-inside.png')
    const homeAlias = alternateCaseLeaf(home)
    const savedAlias = join(homeAlias, relative(home, saved))
    // A case-sensitive filesystem makes this a different missing path rather than a second spelling
    // for the same image, so the Node/APFS regression is not applicable there.
    if (!existsSync(homeAlias) || !existsSync(savedAlias)) return

    const accepted = resolveGeneratedImage({
      codexHome: home,
      threadId: THREAD,
      imageId,
      savedPath: savedAlias,
    })
    if (accepted === null) {
      throw new Error(`case alias of an inside generated image was refused: ${savedAlias}`)
    }
    // ⚑ **The file's OWN spelling, exactly** — what the title says. `realpathSync.native` is the
    // spelling APFS keeps; the plain `realpathSync` hands back the alias it was given (371's table).
    // Since `726` · R92 no containment compares it any more, so this is the half that still decides
    // anything: the path the app records is the one the filesystem has.
    expect(accepted).toBe(realpathSync.native(saved))
    expect(accepted).not.toBe(savedAlias)
    // (Its other half — an outside alias stayed out — went with the containment, `726` · R92.)
  })

  it('finds it by the naming convention when the provider named no path at all', () => {
    // `savedPath` is `Option<AbsolutePathBuf>` in the vendored types and no capture of a live v2
    // frame exists, so the absent case is a real possibility rather than a defensive one. Both
    // measured files are `<id>.png`, which is the rule this falls back to.
    writeImage()
    expect(
      resolveGeneratedImage({ codexHome: home, threadId: THREAD, imageId: IMAGE }),
    ).not.toBeNull()
  })

  it('returns null — not a guess — when the convention names a file that is not there', () => {
    // The lookup is what makes the fallback honest: a wrong guess produces NOTHING, never a path to
    // a file that does not exist. This is the difference between looking and inventing.
    expect(resolveGeneratedImage({ codexHome: home, threadId: THREAD, imageId: IMAGE })).toBeNull()
  })

  it('🔴 726 · R92 — takes a real image the provider named OUTSIDE the images directory', () => {
    // Resolve any readable existing path named by a person or agent, rather than require it
    // to lie within `<home>/generated_images`.
    const elsewhere = join(outside, 'secrets.png')
    writeFileSync(elsewhere, PIXEL)
    expect(
      resolveGeneratedImage({
        codexHome: home,
        threadId: THREAD,
        imageId: IMAGE,
        savedPath: elsewhere,
      }),
    ).toBe(realpathSync.native(elsewhere))
  })

  it('⚑ 726 · R92 CONTROL — what keeps a claim from being anything but pixels is its TYPE, wherever it is', () => {
    // `auth.json` next door is refused because it is not an image, not because of where it is.
    const auth = join(home, 'auth.json')
    writeFileSync(auth, '{"marker":"a fixture, never a credential"}')
    expect(
      resolveGeneratedImage({ codexHome: home, threadId: THREAD, imageId: IMAGE, savedPath: auth }),
    ).toBeNull()
    // …and a claim that is not there is still nothing.
    expect(
      resolveGeneratedImage({
        codexHome: home,
        threadId: THREAD,
        imageId: IMAGE,
        savedPath: join(outside, 'never-written.png'),
      }),
    ).toBeNull()
  })

  it('accepts a symlink to a real image, and names it by where it LANDS', () => {
    // A link is not refused for being a link: the claim is resolved and the RESOLVED file is what is
    // checked and returned. (Until `726` · R92 this was the paired positive of a containment — a link
    // leaving the images directory was refused; R92 removed that, and the flip above accepts it.)
    const real = writeImage('real.png')
    const link = join(images, THREAD, `${IMAGE}.png`)
    symlinkSync(real, link)
    expect(
      resolveGeneratedImage({ codexHome: home, threadId: THREAD, imageId: IMAGE, savedPath: link }),
    ).toContain('real.png')
  })

  it('⚠️ refuses a `.png` symlink whose REAL target is not an image', () => {
    // The extension is re-read from the resolved path, because it is the resolved file that would
    // be served. A `.png` name over an `.svg` body is a script delivery, not a picture.
    const svg = join(images, THREAD, 'payload.svg')
    writeFileSync(svg, '<svg onload="alert(1)"/>')
    const link = join(images, THREAD, 'looks-fine.png')
    symlinkSync(svg, link)
    expect(
      resolveGeneratedImage({ codexHome: home, threadId: THREAD, imageId: IMAGE, savedPath: link }),
    ).toBeNull()
  })

  it('refuses a directory, however well named', () => {
    const dir = join(images, THREAD, 'trap.png')
    mkdirSync(dir)
    expect(
      resolveGeneratedImage({ codexHome: home, threadId: THREAD, imageId: IMAGE, savedPath: dir }),
    ).toBeNull()
  })

  it('⚠️ refuses a relative path even when it WOULD resolve to a real file inside the root', () => {
    // A relative path resolves against the RUNTIME's working directory, which is not a place the
    // provider was ever talking about — the same string means a different file depending on where
    // this process happens to be running from.
    //
    // ⚠️ Built so that dropping the `isAbsolute` guard actually CHANGES the answer, because the
    // obvious version of this test does not: a relative path that resolves to nothing returns null
    // either way, so a mutation removing the guard survived it. Here the cwd is the home, the
    // relative claim lands on a REAL file inside the images root, and the image id has no file of
    // its own — so the guard is the only thing between the claim and a hit.
    const target = writeImage('other.png')
    expect(target).toContain('other.png')
    const cwd = process.cwd()
    try {
      process.chdir(home)
      expect(
        resolveGeneratedImage({
          codexHome: home,
          threadId: THREAD,
          imageId: 'no-such-image',
          savedPath: `${GENERATED_IMAGES_DIRNAME}/${THREAD}/other.png`,
        }),
      ).toBeNull()
      // Non-vacuity: the very same file IS reachable when the claim is absolute, so the refusal
      // above is about the spelling and not about the file being unreadable.
      expect(
        resolveGeneratedImage({
          codexHome: home,
          threadId: THREAD,
          imageId: 'no-such-image',
          savedPath: target,
        }),
      ).toContain('other.png')
    } finally {
      process.chdir(cwd)
    }
  })

  it('finds a non-PNG by convention — the fallback is not hardcoded to one extension', () => {
    // `savedPath` is optional, and an image saved as `.jpg` or `.webp` would otherwise be on disk
    // and permanently unreachable, reported to the user as "the file is gone" while it sat there.
    writeImage(`${IMAGE}.webp`)
    expect(resolveGeneratedImage({ codexHome: home, threadId: THREAD, imageId: IMAGE })).toContain(
      `${IMAGE}.webp`,
    )
  })

  it('⚠️ the SVG-over-symlink refusal holds on the CONVENTION path too, not just the claim', () => {
    // Both candidates run the same checks, but only the claimed path was ever tested through them —
    // so a mutation gutting the re-read of the resolved extension would have survived on the branch
    // that fires whenever the provider sends no `savedPath` at all.
    const svg = join(images, THREAD, `${IMAGE}.svg`)
    writeFileSync(svg, '<svg onload="alert(1)"/>')
    symlinkSync(svg, join(images, THREAD, `${IMAGE}.png`))
    expect(resolveGeneratedImage({ codexHome: home, threadId: THREAD, imageId: IMAGE })).toBeNull()
  })

  it('returns null when the home has no images directory at all', () => {
    const bare = mkdtempSync(join(tmpdir(), 'brobot-067-bare-'))
    try {
      expect(
        resolveGeneratedImage({ codexHome: bare, threadId: THREAD, imageId: IMAGE }),
      ).toBeNull()
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })

  it('falls back to the convention when the provider names a path that is not an image', () => {
    // Both candidates are tried and each is checked identically — a refused claim does not poison
    // the lookup that would have succeeded. This is what stops one bad field hiding a real file.
    writeImage()
    const notAnImage = join(outside, 'notes.json')
    writeFileSync(notAnImage, '{}')
    expect(
      resolveGeneratedImage({
        codexHome: home,
        threadId: THREAD,
        imageId: IMAGE,
        savedPath: notAnImage,
      }),
    ).toContain(`${IMAGE}.png`)
  })
})

describe('imageMediaType — what we are willing to call a picture (067)', () => {
  it('maps the raster formats, case-insensitively', () => {
    expect(imageMediaType('/x/a.png')).toBe('image/png')
    expect(imageMediaType('/x/a.PNG')).toBe('image/png')
    expect(imageMediaType('/x/a.jpg')).toBe('image/jpeg')
    expect(imageMediaType('/x/a.jpeg')).toBe('image/jpeg')
    expect(imageMediaType('/x/a.webp')).toBe('image/webp')
    expect(imageMediaType('/x/a.gif')).toBe('image/gif')
  })

  it('⚠️ refuses SVG — it is a document that can carry script, not a bitmap', () => {
    expect(imageMediaType('/x/a.svg')).toBeNull()
  })

  it('refuses anything without a recognized extension', () => {
    expect(imageMediaType('/x/a.json')).toBeNull()
    expect(imageMediaType('/x/auth')).toBeNull()
    expect(imageMediaType('/x/.png.txt')).toBeNull()
  })
})
