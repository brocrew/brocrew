import { afterEach, describe, expect, it, vi } from 'vitest'
import { pdfFrameUrl, pictureUrl } from '../src/renderer/src/lib/kept-file-urls'
import type { DrawnAs } from '../src/shared/documents'

/**
 * 🔴 D-032 · the window's one maker of kept-file URLs takes the type main gave, once, and never
 * looks at the bytes to choose another.
 *
 * `kept-file-urls.test.ts` pins what each helper refuses and what each blob holds. This file pins
 * the two rules beside them: the type is read ONCE (a `drawnAs` that answered differently on a
 * second read cannot make the URL of a type that was never checked), and the bytes are never
 * sniffed here — bytes that look like a page or an SVG, typed by main as a PNG or a PDF, become a
 * blob of exactly that type, never a `data:` SVG and never anything a frame would run as a page.
 */

const bytesOf = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(Buffer.from(text))

/** Every blob the helper wraps. */
function watchBlobs(): { made: Blob[] } {
  const made: Blob[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    made.push(blob as Blob)
    return `blob:file:///kept-${made.length}`
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  return { made }
}

/** A drawing whose `drawnAs` answers `first`, then `later` on every read after. */
function shifty(
  first: DrawnAs,
  later: string,
  bytes: Uint8Array<ArrayBuffer>,
): { readonly drawnAs: DrawnAs; readonly bytes: Uint8Array<ArrayBuffer>; reads: () => number } {
  let reads = 0
  return {
    get drawnAs(): DrawnAs {
      reads += 1
      return (reads === 1 ? first : later) as DrawnAs
    },
    bytes,
    reads: () => reads,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the type is read once', () => {
  it('⛔ a picture checked as a PNG is made as a PNG, whatever a second read would say', () => {
    const { made } = watchBlobs()
    const drawing = shifty('image/png', 'image/svg+xml', bytesOf('<svg onload="parent.api"/>'))
    const drawn = pictureUrl(drawing)
    expect(drawing.reads()).toBe(1)
    expect(drawn.url.startsWith('blob:')).toBe(true)
    expect(made.map((blob) => blob.type)).toEqual(['image/png'])
  })

  it('⛔ a frame checked as a PDF is made as a PDF, and the type is not read again', () => {
    const { made } = watchBlobs()
    const drawing = shifty('application/pdf', 'text/html', bytesOf('%PDF-1.7\n'))
    pdfFrameUrl(drawing)
    expect(drawing.reads()).toBe(1)
    expect(made.map((blob) => blob.type)).toEqual(['application/pdf'])
  })

  it('⛔ …and one that is refused on its first read is refused, whatever it says after', () => {
    const { made } = watchBlobs()
    const notAPdf = shifty('image/png', 'application/pdf', bytesOf('%PDF-1.7\n'))
    expect(() => pdfFrameUrl(notAPdf)).toThrow(/Only a PDF is drawn in a frame/)
    const notAPicture = shifty('application/pdf', 'image/png', bytesOf('\x89PNG'))
    expect(() => pictureUrl(notAPicture)).toThrow(/not drawn as a picture/)
    expect(made).toEqual([])
  })
})

describe('the bytes are never sniffed here', () => {
  it('⚑ an SVG’s text typed by main as a PNG is a PNG blob, not a data: SVG', async () => {
    const { made } = watchBlobs()
    const bytes = bytesOf('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')
    const drawn = pictureUrl({ drawnAs: 'image/png', bytes })
    expect(drawn.url.startsWith('data:')).toBe(false)
    expect(made).toHaveLength(1)
    expect(made[0]?.type).toBe('image/png')
    expect(new Uint8Array(await made[0]!.arrayBuffer())).toEqual(bytes)
  })

  it('⚑ a page’s text typed by main as a PDF is a PDF blob, never a page', () => {
    const { made } = watchBlobs()
    pdfFrameUrl({ drawnAs: 'application/pdf', bytes: bytesOf('<!doctype html><script>1</script>') })
    expect(made.map((blob) => blob.type)).toEqual(['application/pdf'])
  })

  it('⛔ and the converse: PNG bytes typed by main as an SVG are a data: URL, and make no blob', () => {
    const { made } = watchBlobs()
    const drawn = pictureUrl({ drawnAs: 'image/svg+xml', bytes: bytesOf('\x89PNG\r\n') })
    expect(drawn.url.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(made).toEqual([])
  })
})
