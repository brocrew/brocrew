import { afterEach, describe, expect, it, vi } from 'vitest'
import { pdfFrameUrl, pictureUrl } from '../src/renderer/src/lib/kept-file-urls'
import { DRAWN_AS, type DrawnAs } from '../src/shared/documents'

/**
 * 🔴 D-032 · the one place the window turns a kept file's bytes into a URL.
 *
 * ⚠️ A `blob:` URL has the window's own origin, and measured on Electron 43.2.0 a page or an SVG
 * framed as one ran a script from a local file and reached `api`. So the frame takes only a PDF, and
 * an SVG never becomes a blob at all.
 */

const bytesOf = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(Buffer.from(text))

/** Every blob the helper wraps, and every URL it revokes. */
function watchBlobs(): { made: Blob[]; revoked: string[] } {
  const made: Blob[] = []
  const revoked: string[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    made.push(blob as Blob)
    return `blob:file:///kept-${made.length}`
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => void revoked.push(url))
  return { made, revoked }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the frame takes a PDF and nothing else', () => {
  it('⛔ refuses every other type, and makes no blob doing it', () => {
    const { made } = watchBlobs()
    const others = DRAWN_AS.filter((type) => type !== 'application/pdf')
    expect(others.length, 'every picture type is asked about').toBe(5)
    for (const drawnAs of others) {
      expect(() => pdfFrameUrl({ drawnAs, bytes: bytesOf('<svg/>') }), drawnAs).toThrow(
        /Only a PDF is drawn in a frame/,
      )
    }
    expect(made).toEqual([])
  })

  it('⚑ a PDF is a blob of exactly application/pdf, holding exactly its bytes', async () => {
    const { made, revoked } = watchBlobs()
    const bytes = bytesOf('%PDF-1.4\n%%EOF\n')
    const framed = pdfFrameUrl({ drawnAs: 'application/pdf', bytes })
    expect(framed.url).toBe('blob:file:///kept-1')
    expect(made).toHaveLength(1)
    expect(made[0]?.type).toBe('application/pdf')
    expect(new Uint8Array(await made[0]!.arrayBuffer())).toEqual(bytes)
    framed.release()
    expect(revoked).toEqual(['blob:file:///kept-1'])
  })
})

describe('a picture is drawn by an <img>, and an SVG is never a blob', () => {
  it('⛔ an SVG is a data: URL of exactly its bytes, and makes no blob', () => {
    const { made, revoked } = watchBlobs()
    // Every byte value, past a slice boundary, so the encoding is checked whole.
    const bytes = Uint8Array.from({ length: 70_000 }, (_, at) => at % 256)
    const drawn = pictureUrl({ drawnAs: 'image/svg+xml', bytes })
    expect(drawn.url.startsWith('data:image/svg+xml;base64,')).toBe(true)
    const decoded = Buffer.from(drawn.url.slice('data:image/svg+xml;base64,'.length), 'base64')
    expect(new Uint8Array(decoded)).toEqual(bytes)
    drawn.release()
    expect(made).toEqual([])
    expect(revoked).toEqual([])
  })

  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const)(
    '⚑ a %s is a blob of exactly that type',
    async (drawnAs: DrawnAs) => {
      const { made, revoked } = watchBlobs()
      const bytes = bytesOf('kept bytes')
      const drawn = pictureUrl({ drawnAs, bytes })
      expect(made).toHaveLength(1)
      expect(made[0]?.type).toBe(drawnAs)
      expect(new Uint8Array(await made[0]!.arrayBuffer())).toEqual(bytes)
      drawn.release()
      expect(revoked).toEqual([drawn.url])
    },
  )

  it('⛔ a PDF is not drawn as a picture', () => {
    const { made } = watchBlobs()
    expect(() => pictureUrl({ drawnAs: 'application/pdf', bytes: bytesOf('%PDF-') })).toThrow(
      /not drawn as a picture/,
    )
    expect(made).toEqual([])
  })
})

describe('a type this app does not draw is refused by both, whatever arrives', () => {
  it('⛔ a page, XML or nothing at all makes no URL', () => {
    const { made } = watchBlobs()
    for (const drawnAs of ['text/html', 'application/xhtml+xml', 'text/xml', 'IMAGE/PNG', '']) {
      const drawn = { drawnAs: drawnAs as DrawnAs, bytes: bytesOf('<html></html>') }
      expect(() => pictureUrl(drawn), drawnAs).toThrow(/not drawn as a picture/)
      expect(() => pdfFrameUrl(drawn), drawnAs).toThrow(/Only a PDF is drawn in a frame/)
    }
    expect(made).toEqual([])
  })
})
