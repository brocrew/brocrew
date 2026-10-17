import { describe, expect, it } from 'vitest'
import { assetLimitProblems, assetPathProblem, sniffAsset } from '../../src/shared/themes/assets'

const bytes = (...parts: (number[] | string)[]): Uint8Array =>
  Uint8Array.from(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((ch) => ch.charCodeAt(0)) : p)),
  )
const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

const chunk = (type: string, data: number[]): number[] => [
  ...u32(data.length),
  ...[...type].map((c) => c.charCodeAt(0)),
  ...data,
  0,
  0,
  0,
  0,
]
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const ihdr = (w: number, h: number) => chunk('IHDR', [...u32(w), ...u32(h), 8, 6, 0, 0, 0])

describe('a file is what its first bytes say, whatever its name', () => {
  it('a PNG, with its size in pixels', () => {
    expect(
      sniffAsset(bytes(PNG_SIGNATURE, ihdr(640, 480), chunk('IDAT', [0]), chunk('IEND', []))),
    ).toEqual({
      ok: true,
      facts: { type: 'png', bytes: 58, width: 640, height: 480, animated: false },
    })
  })

  it('an animated PNG is marked as moving', () => {
    const apng = sniffAsset(
      bytes(
        PNG_SIGNATURE,
        ihdr(16, 16),
        chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]),
        chunk('IDAT', [0]),
      ),
    )
    expect(apng.ok && apng.facts.animated).toBe(true)
  })

  it('a JPEG, with its size read from its frame header', () => {
    const app0 = [
      0xff,
      0xe0,
      0,
      16,
      ...'JFIF'.split('').map((c) => c.charCodeAt(0)),
      0,
      1,
      1,
      0,
      0,
      1,
      0,
      1,
      0,
      0,
    ]
    const sof0 = [
      0xff, 0xc0, 0, 17, 8, 0x05, 0x35, 0x07, 0xd0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    ]
    const r = sniffAsset(bytes([0xff, 0xd8], app0, sof0, [0xff, 0xd9]))
    expect(r).toEqual({
      ok: true,
      facts: { type: 'jpeg', bytes: 41, width: 2000, height: 1333, animated: false },
    })
  })

  it('WebP is refused before the release, in a sentence', () => {
    expect(sniffAsset(bytes('RIFF', [22, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0]))).toEqual({
      ok: false,
      says: "WebP pictures aren't supported yet. Use PNG or JPEG",
    })
  })

  it('a woff2 font', () => {
    expect(sniffAsset(bytes('wOF2', [0, 1, 0, 0]))).toEqual({
      ok: true,
      facts: { type: 'woff2', bytes: 8 },
    })
  })

  it('SVG is refused before the release, in a sentence', () => {
    expect(
      sniffAsset(
        bytes(
          '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
      ),
    ).toEqual({
      ok: false,
      says: "SVG pictures aren't supported yet. Use PNG or JPEG",
    })
  })

  it('GIF, other fonts and anything else are refused', () => {
    expect(sniffAsset(bytes('GIF89a', [1, 0, 1, 0]))).toMatchObject({
      ok: false,
      says: "GIF pictures aren't supported. Use PNG or JPEG",
    })
    expect(sniffAsset(bytes('wOFF', [0, 0]))).toMatchObject({
      ok: false,
      says: 'only woff2 fonts are accepted',
    })
    expect(sniffAsset(bytes('#!/bin/sh\nrm -rf /'))).toMatchObject({ ok: false })
    expect(sniffAsset(bytes(PNG_SIGNATURE, [0, 0]))).toMatchObject({
      ok: false,
      says: 'it starts like a PNG file but can’t be read as one',
    })
  })

  it('a JPEG reads past a repeated start marker and fill bytes to its frame', () => {
    const sof0 = [0xff, 0xc0, 0, 17, 8, 0, 32, 0, 64, 3, 1, 0x22, 0]
    const r = sniffAsset(bytes([0xff, 0xd8], [0xff, 0xd8], [0xff, 0xff], sof0))
    expect(r).toEqual({
      ok: true,
      facts: { type: 'jpeg', bytes: 19, width: 64, height: 32, animated: false },
    })
  })

  it('a JPEG whose segments do not follow on, or whose scan starts before any frame, is refused', () => {
    const refused = { ok: false, says: 'it starts like a JPEG file but can’t be read as one' }
    // An APP0 segment that claims 4 bytes, followed by something that is not a marker.
    expect(sniffAsset(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0], new Array(12).fill(1)))).toEqual(
      refused,
    )
    expect(sniffAsset(bytes([0xff, 0xd8, 0xff, 0xda], new Array(12).fill(0)))).toEqual(refused)
  })
})

describe('a file is held to the limits for what it is', () => {
  it('a font over 1 MB', () => {
    expect(
      assetLimitProblems('assets/fonts/a.woff2', { type: 'woff2', bytes: 2 * 1024 * 1024 }),
    ).toEqual(['assets/fonts/a.woff2 is 2 MB; a font can be up to 1 MB.'])
  })

  it('a picture whose size in pixels was not read has no pixels', () => {
    expect(assetLimitProblems('assets/a.png', { type: 'png', bytes: 100 })).toEqual([
      'assets/a.png has no pixels.',
    ])
    expect(
      assetLimitProblems('assets/a.png', { type: 'png', bytes: 100, width: 10, height: 0 }),
    ).toEqual(['assets/a.png has no pixels.'])
  })
})

describe('a reference names a file inside the theme, or says why not', () => {
  it.each([
    ['assets/brick.png', null],
    ['assets/fonts/script.woff2', null],
    ['https://example.com/a.png', /is a web address/],
    ['//example.com/a.png', /is a web address/],
    ['file:///etc/hosts', /points outside the theme/],
    ['data:image/png;base64,AAAA', /points outside the theme/],
    ['/etc/hosts', /points outside the theme/],
    ['assets/../theme.json', /points outside the theme/],
    ['assets\\a.png', /points outside the theme/],
    ['assets/a b.png', /isn’t a file name the app accepts/],
    ['brick.png', /isn’t a file name the app accepts/],
  ])('%s', (ref, expected) => {
    const said = assetPathProblem(ref)
    if (expected === null) expect(said).toBeNull()
    else expect(said).toMatch(expected)
  })

  it('asks for a file when the reference is not text, or is empty', () => {
    for (const ref of [5, null, ''])
      expect(assetPathProblem(ref)).toBe('it should name a file in the theme’s assets folder')
  })

  it('shortens a long reference it quotes', () => {
    const long = `https://example.com/${'a'.repeat(60)}.png`
    expect(assetPathProblem(long)).toBe(
      `“${long.slice(0, 45)}…” is a web address. Pictures and fonts must be files in the theme’s assets folder`,
    )
  })
})
