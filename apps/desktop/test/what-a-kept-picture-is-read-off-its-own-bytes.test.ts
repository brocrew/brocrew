import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MOST_BYTES_A_WINDOW_DRAWS,
  MOST_BYTES_OF_ANY_FORM,
  MOST_BYTES_OF_FORM,
  drawnAsOfBytes,
  keepResource,
  keptFileToShow,
  keptPictureOrPdf,
  pictureSize,
  sha256Hex,
  type KeptResource,
} from '../src/main/resources/resources'

/**
 * 🔴 D-032 · what main hands a window to draw, read off the file's own bytes — and what it refuses.
 *
 * An agent's file is untrusted. The window draws whatever `drawnAs` says, so the type is read here,
 * in main, from the bytes' own opening and within the kind the name says: a PNG, JPEG, GIF or WebP by
 * its signature, an SVG by its first element, a PDF by its `%PDF-`. A page renamed `.png`, `.svg` or
 * `.pdf` is `not-what-its-name-says`.
 *
 * And two caps hold the window's memory: 16 MiB of bytes (every picture or PDF this app keeps), and,
 * for a picture decoded whole, 64 megapixels read off its header. Each is pinned at its bound and one
 * past it, with literal numbers rather than the constants, so a moved bound fails here.
 *
 * Every helper is driven over real files in a temp `resources` tree, written by `keepResource`, the
 * same writer the app keeps files with.
 */

const SIXTEEN_MIB = 16 * 1024 * 1024
const SIXTY_FOUR_MEGAPIXELS = 8192 * 8192

// ─── Headers, built byte by byte ────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A PNG's signature and its first chunk, IHDR, saying `width` × `height`. */
function png(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0)
  ihdr.write('IHDR', 4, 'latin1')
  ihdr.writeUInt32BE(width, 8)
  ihdr.writeUInt32BE(height, 12)
  ihdr[16] = 8
  ihdr[17] = 6
  return Buffer.concat([Buffer.from(PNG_SIGNATURE), ihdr])
}

/** A GIF's header and logical screen, `width` × `height`. */
function gif(width: number, height: number, version = 'GIF89a'): Buffer {
  const bytes = Buffer.alloc(14)
  bytes.write(version, 0, 'latin1')
  bytes.writeUInt16LE(width, 6)
  bytes.writeUInt16LE(height, 8)
  bytes[13] = 0x3b
  return bytes
}

/** A RIFF/WEBP container with one chunk: `name` at byte 12, its body from byte 20. */
function riff(name: string, body: Buffer): Buffer {
  const head = Buffer.alloc(20)
  head.write('RIFF', 0, 'latin1')
  head.writeUInt32LE(12 + body.length, 4)
  head.write('WEBP', 8, 'latin1')
  head.write(name, 12, 'latin1')
  head.writeUInt32LE(body.length, 16)
  return Buffer.concat([head, body])
}

/** Lossy WebP (VP8): frame tag, start code `9d 01 2a`, then 14-bit width and height, raw. */
function webpLossy(rawWidth: number, rawHeight: number): Buffer {
  const body = Buffer.alloc(10)
  body[0] = 0x10
  body[1] = 0x02
  body[2] = 0x00
  body[3] = 0x9d
  body[4] = 0x01
  body[5] = 0x2a
  body.writeUInt16LE(rawWidth, 6)
  body.writeUInt16LE(rawHeight, 8)
  return riff('VP8 ', body)
}

/** Lossless WebP (VP8L): signature `0x2f`, then width − 1 and height − 1 packed in 14 bits each. */
function webpLossless(width: number, height: number): Buffer {
  const body = Buffer.alloc(10)
  body[0] = 0x2f
  body.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 1)
  return riff('VP8L', body)
}

/** Extended WebP (VP8X): the canvas, width − 1 and height − 1 in 24 bits each. */
function webpExtended(width: number, height: number): Buffer {
  const body = Buffer.alloc(10)
  body.writeUIntLE(width - 1, 4, 3)
  body.writeUIntLE(height - 1, 7, 3)
  return riff('VP8X', body)
}

/** JFIF's APP0 segment: 18 bytes, the length (16) not counting its own marker. */
const APP0 = Buffer.from([
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
  0x00, 0x00,
])

/** A JPEG: SOI, APP0, whatever segments come `before`, then a frame header of type `frame`, EOI. */
function jpeg(
  width: number,
  height: number,
  { frame = 0xc0, before = [] as readonly Buffer[] } = {},
): Buffer {
  const sof = Buffer.alloc(19)
  sof[0] = 0xff
  sof[1] = frame
  sof.writeUInt16BE(17, 2)
  sof[4] = 8
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  sof[9] = 3
  return Buffer.concat([Buffer.from([0xff, 0xd8]), APP0, ...before, sof, Buffer.from([0xff, 0xd9])])
}

/**
 * A Huffman table segment (`ff c4`) whose bytes, read as a frame header, would say 65535 × 65535 —
 * so a walk that took it for a frame would answer a size the file does not have.
 */
const DHT_THAT_LOOKS_HUGE = Buffer.from([
  0xff, 0xc4, 0x00, 0x08, 0x08, 0xff, 0xff, 0xff, 0xff, 0x00,
])

const text = (body: string): Buffer => Buffer.from(body, 'utf8')

// ─── A resources tree, kept the way the app keeps one ───────────────────────────────────────────

type Row = KeptResource & { readonly bytes: number }

let dir: string
let root: string
let outside: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brobot2-d032-bytes-'))
  root = join(dir, 'resources')
  outside = join(dir, 'outside')
  mkdirSync(outside, { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Keep `bytes` as `name` through the app's own writer, and answer the row that names them. */
function kept(name: string, bytes: Buffer): Row {
  const sha256 = sha256Hex(bytes)
  const done = keepResource(root, { bytes, sha256, name })
  if (!done.ok) throw new Error(`the fixture was not kept: ${done.problem}`)
  return { resource: `res_${sha256.slice(0, 32)}`, name, sha256, bytes: bytes.length }
}

const whereItIs = (row: Row): string => join(root, row.sha256, row.name)

describe('the type is read off the bytes’ own opening', () => {
  it('⚑ each picture signature is its own type, whatever else follows', () => {
    expect(drawnAsOfBytes('image', png(1, 1))).toBe('image/png')
    expect(drawnAsOfBytes('image', jpeg(1, 1))).toBe('image/jpeg')
    expect(drawnAsOfBytes('image', gif(1, 1, 'GIF87a'))).toBe('image/gif')
    expect(drawnAsOfBytes('image', gif(1, 1, 'GIF89a'))).toBe('image/gif')
    expect(drawnAsOfBytes('image', webpLossy(1, 1))).toBe('image/webp')
    expect(drawnAsOfBytes('image', webpLossless(1, 1))).toBe('image/webp')
    expect(drawnAsOfBytes('image', webpExtended(1, 1))).toBe('image/webp')
  })

  it('⛔ …and a signature one byte off is no picture at all', () => {
    const offByOne = png(1, 1)
    offByOne[7] = 0x0b
    expect(drawnAsOfBytes('image', offByOne)).toBeNull()
    expect(drawnAsOfBytes('image', Buffer.from([0xff, 0xd8]))).toBeNull()
    expect(drawnAsOfBytes('image', Buffer.from([0xff, 0xd8, 0xfe, 0x00]))).toBeNull()
    expect(drawnAsOfBytes('image', gif(1, 1, 'GIF88a'))).toBeNull()
    // A RIFF that is not a WebP (a WAVE), and WEBP at the wrong offset.
    const wave = webpLossy(1, 1)
    wave.write('WAVE', 8, 'latin1')
    expect(drawnAsOfBytes('image', wave)).toBeNull()
    expect(drawnAsOfBytes('image', text('RIFFWEBPxxxxVP8 '))).toBeNull()
  })

  it('⛔ a picture is never a PDF, and a PDF never a picture', () => {
    expect(drawnAsOfBytes('pdf', png(1, 1))).toBeNull()
    expect(drawnAsOfBytes('pdf', text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(drawnAsOfBytes('image', text('%PDF-1.7\n%%EOF\n'))).toBeNull()
    // The paired positives: the same bytes, in the kind they are.
    expect(drawnAsOfBytes('image', png(1, 1))).toBe('image/png')
    expect(drawnAsOfBytes('pdf', text('%PDF-1.7\n%%EOF\n'))).toBe('application/pdf')
  })

  it('⚑ a PDF’s `%PDF-` counts within its first 1024 bytes, and not one byte past them', () => {
    const at = (offset: number): Buffer =>
      Buffer.concat([Buffer.alloc(offset, 0x20), text('%PDF-1.7\n')])
    expect(drawnAsOfBytes('pdf', at(0))).toBe('application/pdf')
    // Ends on byte 1024 exactly.
    expect(drawnAsOfBytes('pdf', at(1024 - 5))).toBe('application/pdf')
    // Straddles the bound: its last byte is the 1025th.
    expect(drawnAsOfBytes('pdf', at(1024 - 4))).toBeNull()
    expect(drawnAsOfBytes('pdf', text('<!doctype html><p>a page</p>'))).toBeNull()
  })
})

describe('an SVG is text whose FIRST element is `<svg`', () => {
  it('⚑ past whitespace, a byte-order mark, an XML declaration, comments and a doctype', () => {
    for (const body of [
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      '<svg>',
      '<svg\n  width="10">',
      '  \t\r\n<svg/>',
      '<?xml version="1.0" encoding="UTF-8"?>\n<svg/>',
      '<!-- drawn by hand -->\n<svg/>',
      '<?xml version="1.0"?>\n<!-- one -->\n<!-- two -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg/>',
      '<!doctype svg>\n<svg/>',
      // An internal subset holding a `>` of its own, which a doctype read to its first `>` would
      // stop inside.
      '<!DOCTYPE svg [\n<!ENTITY a "x">\n]>\n<svg/>',
    ]) {
      expect(drawnAsOfBytes('image', text(body)), JSON.stringify(body)).toBe('image/svg+xml')
    }
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), text('<svg/>')])
    expect(drawnAsOfBytes('image', withBom)).toBe('image/svg+xml')
  })

  it('⛔ a page holding an inline <svg>, or any other first element, is not one', () => {
    for (const body of [
      '<!doctype html><html><body><svg></svg></body></html>',
      '<html><svg/></html>',
      'hello <svg/>',
      '<SVG/>',
      '<svgx/>',
      '<svg',
      '',
      '   \n',
      '<script>alert(1)</script><svg/>',
      // Each opener that never closes is not an SVG, however much follows it.
      '<!-- never closed <svg/>',
      '<?xml never closed <svg/>',
      '<!DOCTYPE svg [ never closed <svg/>',
    ]) {
      expect(drawnAsOfBytes('image', text(body)), JSON.stringify(body)).toBeNull()
    }
  })
})

describe('a picture’s size, read off its header', () => {
  it('⚑ each header says width and height in its own place, unswapped', () => {
    expect(pictureSize('image/png', png(300, 200))).toEqual({ width: 300, height: 200 })
    expect(pictureSize('image/gif', gif(300, 200))).toEqual({ width: 300, height: 200 })
    expect(pictureSize('image/webp', webpLossy(300, 200))).toEqual({ width: 300, height: 200 })
    expect(pictureSize('image/webp', webpLossless(300, 200))).toEqual({ width: 300, height: 200 })
    expect(pictureSize('image/webp', webpExtended(300, 200))).toEqual({ width: 300, height: 200 })
    expect(pictureSize('image/jpeg', jpeg(300, 200))).toEqual({ width: 300, height: 200 })
  })

  it('⚑ a lossy WebP’s two scale bits are not part of its size', () => {
    expect(pictureSize('image/webp', webpLossy(0xc000 | 3, 0x4000 | 2))).toEqual({
      width: 3,
      height: 2,
    })
  })

  it('⚑ a JPEG is walked by its segments: past fill bytes, a restart marker and a Huffman table, to its frame', () => {
    const walked = jpeg(640, 480, {
      before: [Buffer.from([0xff]), Buffer.from([0xff, 0xd0]), DHT_THAT_LOOKS_HUGE],
    })
    expect(pictureSize('image/jpeg', walked)).toEqual({ width: 640, height: 480 })
    // A progressive frame header (`ff c2`) is a frame header too.
    expect(pictureSize('image/jpeg', jpeg(640, 480, { frame: 0xc2 }))).toEqual({
      width: 640,
      height: 480,
    })
  })

  it('⛔ a header that is not there to read is `null`', () => {
    expect(pictureSize('image/png', Buffer.from(PNG_SIGNATURE))).toBeNull()
    const notIhdr = png(1, 1)
    notIhdr.write('IDAT', 12, 'latin1')
    expect(pictureSize('image/png', notIhdr)).toBeNull()
    expect(pictureSize('image/gif', text('GIF89a\x01\x00\x01'))).toBeNull()
    expect(pictureSize('image/webp', webpLossy(1, 1).subarray(0, 29))).toBeNull()
    const noStartCode = webpLossy(1, 1)
    noStartCode[23] = 0x00
    expect(pictureSize('image/webp', noStartCode)).toBeNull()
    expect(pictureSize('image/webp', riff('ALPH', Buffer.alloc(10)))).toBeNull()
    // A scan before any frame header, and a JPEG that ends before one.
    const scanFirst = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      APP0,
      Buffer.from([0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0, 0, 0]),
      jpeg(1, 1).subarray(20),
    ])
    expect(pictureSize('image/jpeg', scanFirst)).toBeNull()
    expect(pictureSize('image/jpeg', Buffer.concat([Buffer.from([0xff, 0xd8]), APP0]))).toBeNull()
  })
})

describe('🔴 64 megapixels: a picture at the bound is drawn, and one pixel row past it is not', () => {
  const READERS: readonly {
    readonly kind: string
    readonly name: string
    readonly make: (width: number, height: number) => Buffer
  }[] = [
    { kind: 'PNG', name: 'p.png', make: png },
    { kind: 'GIF', name: 'p.gif', make: (w, h) => gif(w, h) },
    { kind: 'JPEG', name: 'p.jpg', make: (w, h) => jpeg(w, h) },
    { kind: 'progressive JPEG', name: 'p.jpeg', make: (w, h) => jpeg(w, h, { frame: 0xc2 }) },
    { kind: 'lossy WebP', name: 'p.webp', make: webpLossy },
    { kind: 'lossless WebP', name: 'p.webp', make: webpLossless },
    { kind: 'extended WebP', name: 'p.webp', make: webpExtended },
  ]

  it.each(READERS)('⚑ $kind: 8192 × 8192 draws, 8193 × 8192 says its size', ({ name, make }) => {
    const atTheBound = keptPictureOrPdf(root, kept(name, make(8192, 8192)))
    expect(atTheBound.ok, JSON.stringify(atTheBound)).toBe(true)
    expect(keptPictureOrPdf(root, kept(name, make(8193, 8192)))).toEqual({
      ok: false,
      reason: 'too-many-pixels',
      width: 8193,
      height: 8192,
    })
  })

  it.each(READERS)('⚑ $kind: the bound is on the PRODUCT, not on either side', ({ name, make }) => {
    // 16000 × 4194 is under 64 megapixels with a side twice 8192; 16000 × 4200 is just over.
    expect(16000 * 4194).toBeLessThanOrEqual(SIXTY_FOUR_MEGAPIXELS)
    expect(16000 * 4200).toBeGreaterThan(SIXTY_FOUR_MEGAPIXELS)
    expect(keptPictureOrPdf(root, kept(name, make(16000, 4194))).ok).toBe(true)
    expect(keptPictureOrPdf(root, kept(name, make(16000, 4200)))).toEqual({
      ok: false,
      reason: 'too-many-pixels',
      width: 16000,
      height: 4200,
    })
  })

  it('⚑ an SVG and a PDF are not held to pixels: an SVG is drawn at the size it is shown', () => {
    const huge = kept('huge.svg', text('<svg width="100000" height="100000"/>'))
    const drawn = keptPictureOrPdf(root, huge)
    expect(drawn.ok && drawn.drawnAs).toBe('image/svg+xml')
  })

  it('⛔ a picture whose header cannot be read is not drawn', () => {
    // Its signature passes and its size cannot be read, so nothing bounds what it would decode to.
    expect(keptPictureOrPdf(root, kept('cut.png', Buffer.from(PNG_SIGNATURE)))).toEqual({
      ok: false,
      reason: 'not-what-its-name-says',
    })
    // The control: the same file, whole.
    expect(keptPictureOrPdf(root, kept('whole.png', png(1, 1))).ok).toBe(true)
  })
})

describe('🔴 16 MiB: what a window is handed, at the bound and one byte past it', () => {
  it('⚑ every picture or PDF this app may keep is one a window may draw', () => {
    expect(MOST_BYTES_A_WINDOW_DRAWS).toBe(SIXTEEN_MIB)
    expect(MOST_BYTES_A_WINDOW_DRAWS).toBeGreaterThanOrEqual(MOST_BYTES_OF_FORM.image)
    expect(MOST_BYTES_A_WINDOW_DRAWS).toBeGreaterThanOrEqual(MOST_BYTES_OF_FORM.pdf)
  })

  it('⛔ a row naming one byte more is `too-large` before a byte is read', () => {
    // No file stands behind this row at all: had it been read, the answer would be `unreadable`.
    const sha256 = sha256Hex(text('never written'))
    const row: Row = { resource: 'res_big', name: 'big.png', sha256, bytes: SIXTEEN_MIB + 1 }
    expect(keptPictureOrPdf(root, row)).toEqual({ ok: false, reason: 'too-large' })
    // The control: the same missing file, its row at the bound, IS read — and found missing.
    expect(keptPictureOrPdf(root, { ...row, bytes: SIXTEEN_MIB })).toEqual({
      ok: false,
      reason: 'unreadable',
    })
  })

  it('⚑ a real file of exactly 16 MiB is read, hashed and handed over whole', () => {
    const body = Buffer.alloc(SIXTEEN_MIB)
    png(1, 1).copy(body)
    const row = kept('full.png', body)
    expect(row.bytes).toBe(SIXTEEN_MIB)
    const drawn = keptPictureOrPdf(root, row)
    expect(drawn.ok).toBe(true)
    if (drawn.ok) {
      expect(drawn.drawnAs).toBe('image/png')
      expect(drawn.bytes.byteLength).toBe(SIXTEEN_MIB)
    }
  })

  it('⛔ a file on disk one byte past it is `unreadable` to draw and to show, whatever its row says', () => {
    // A row edited to say little, over a file grown past every bound this app keeps to: it is
    // never read, so it is never hashed, and it is never handed to Finder either.
    const sha256 = sha256Hex(text('the row says this'))
    const folder = join(root, sha256)
    mkdirSync(folder, { recursive: true })
    const path = join(folder, 'grown.png')
    writeFileSync(path, png(1, 1))
    truncateSync(path, MOST_BYTES_OF_ANY_FORM + 1)
    const row: Row = { resource: 'res_grown', name: 'grown.png', sha256, bytes: 33 }
    expect(keptPictureOrPdf(root, row)).toEqual({ ok: false, reason: 'unreadable' })
    expect(keptFileToShow(root, row)).toEqual({ ok: false, reason: 'unreadable' })
  })
})

describe('keptPictureOrPdf · the name says the kind, the bytes say the type', () => {
  it('⚑ a PNG saved as `.jpg` is drawn as the PNG it is, and its bytes are exactly the file’s', () => {
    const body = png(2, 3)
    const drawn = keptPictureOrPdf(root, kept('chart.jpg', body))
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    expect(drawn.drawnAs).toBe('image/png')
    expect(drawn.bytes).toEqual(new Uint8Array(body))
    // A Uint8Array that owns its whole buffer, not a Buffer view into a larger one.
    expect(Buffer.isBuffer(drawn.bytes)).toBe(false)
    expect(drawn.bytes.byteOffset).toBe(0)
    expect(drawn.bytes.buffer.byteLength).toBe(body.length)
  })

  it('⛔ a page renamed `.png`, `.svg` or `.pdf` is `not-what-its-name-says`', () => {
    const page = text('<!doctype html><script>parent.api && alert(1)</script><svg onload="x"/>')
    for (const name of ['page.png', 'page.svg', 'page.pdf', 'page.webp']) {
      expect(keptPictureOrPdf(root, kept(name, page)), name).toEqual({
        ok: false,
        reason: 'not-what-its-name-says',
      })
    }
    // A picture named `.pdf` and a PDF named `.png` are refused too: neither crosses kinds.
    expect(keptPictureOrPdf(root, kept('shot.pdf', png(1, 1)))).toEqual({
      ok: false,
      reason: 'not-what-its-name-says',
    })
    expect(keptPictureOrPdf(root, kept('report.png', text('%PDF-1.7\n')))).toEqual({
      ok: false,
      reason: 'not-what-its-name-says',
    })
  })

  it('⚑ …and the controls: a real SVG, a real PDF', () => {
    const svg = keptPictureOrPdf(root, kept('logo.svg', text('<?xml version="1.0"?>\n<svg/>')))
    expect(svg.ok && svg.drawnAs).toBe('image/svg+xml')
    const pdf = keptPictureOrPdf(root, kept('report.pdf', text('%PDF-1.7\n%%EOF\n')))
    expect(pdf.ok && pdf.drawnAs).toBe('application/pdf')
  })

  it('⛔ a Markdown file or a page is not drawn this way, whatever bytes it holds', () => {
    for (const name of ['notes.md', 'page.html', 'page.htm']) {
      expect(keptPictureOrPdf(root, kept(name, png(1, 1))), name).toEqual({
        ok: false,
        reason: 'not-a-picture-or-pdf',
      })
    }
  })

  it('⚑ bytes that changed are `changed`; a file that is gone is `unreadable`', () => {
    const changed = kept('changed.png', png(4, 4))
    writeFileSync(whereItIs(changed), png(5, 5))
    expect(keptPictureOrPdf(root, changed)).toEqual({ ok: false, reason: 'changed' })
    const gone = kept('gone.png', png(6, 6))
    rmSync(whereItIs(gone))
    expect(keptPictureOrPdf(root, gone)).toEqual({ ok: false, reason: 'unreadable' })
  })
})

describe('keptFileToShow · where Finder is pointed, and when it is not', () => {
  it('⚑ an untouched kept file is shown where it was kept, and not as changed', () => {
    const row = kept('chart.png', png(1, 1))
    expect(keptFileToShow(root, row)).toEqual({ ok: true, path: whereItIs(row), changed: false })
  })

  it('🔴 a file whose bytes changed IS shown, at the same place, and says so', () => {
    const row = kept('chart.png', png(1, 1))
    writeFileSync(whereItIs(row), 'somebody edited it\n')
    expect(keptFileToShow(root, row)).toEqual({ ok: true, path: whereItIs(row), changed: true })
  })

  it('⛔ nothing at the place is `gone` — the file, or its whole folder', () => {
    const file = kept('one.png', png(1, 1))
    rmSync(whereItIs(file))
    expect(keptFileToShow(root, file)).toEqual({ ok: false, reason: 'gone' })
    const folder = kept('two.png', png(2, 2))
    rmSync(join(root, folder.sha256), { recursive: true })
    expect(keptFileToShow(root, folder)).toEqual({ ok: false, reason: 'gone' })
  })

  it('⛔ a directory, or a link out of the tree, at the place is `unreadable`, never shown', () => {
    const dirRow = kept('a-folder.png', png(1, 1))
    rmSync(whereItIs(dirRow))
    mkdirSync(whereItIs(dirRow))
    expect(keptFileToShow(root, dirRow)).toEqual({ ok: false, reason: 'unreadable' })

    const linked = kept('linked.png', png(3, 3))
    const stranger = join(outside, 'linked.png')
    writeFileSync(stranger, png(3, 3))
    rmSync(whereItIs(linked))
    symlinkSync(stranger, whereItIs(linked))
    expect(keptFileToShow(root, linked)).toEqual({ ok: false, reason: 'unreadable' })
    // The same link drawn: refused too, though its target's bytes hash to the kept ones.
    expect(keptPictureOrPdf(root, linked)).toEqual({ ok: false, reason: 'unreadable' })
  })

  it('⛔ a row whose name climbs out of the tree, or whose hash is not one, hands Finder no path', () => {
    const real = kept('real.png', png(1, 1))
    writeFileSync(join(outside, 'secrets.png'), png(1, 1))
    for (const row of [
      { ...real, name: '../../outside/secrets.png' },
      { ...real, name: 'a/b.png' },
      { ...real, sha256: '..' },
      { ...real, sha256: real.sha256.toUpperCase() },
    ]) {
      const shown = keptFileToShow(root, row)
      expect(shown, JSON.stringify(row)).toEqual({ ok: false, reason: 'unreadable' })
    }
    // The control: the same row, untouched.
    expect(keptFileToShow(root, real).ok).toBe(true)
  })
})
