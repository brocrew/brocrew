import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { WebContents } from 'electron'
import { PDF_VIEWER_ORIGIN } from '../src/shared/content-security-policy'
import {
  installNavigationGuard,
  permitsSubframe,
  type AppDocument,
} from '../src/main/window-navigation'

/**
 * 🔴 D-032 · the subframe guard, past what `window-navigation.test.ts` pins.
 *
 * One subframe shape is admitted, on `will-frame-navigate` alone: a `blob:` the app's own document
 * minted, directly under the window; and the viewer's origin, directly under the viewer's page,
 * directly under that blob. A `blob:` frame has the window's own origin, so anything else that
 * loaded there would reach `parent.api`.
 *
 * This file adds, through the INSTALLED guard and its frame tree: a foreign blob, a blob two
 * frames deep, a `data:` frame and a web page each refused in the very position the admitted frame
 * holds; an ancestor whose URL cannot be read; an event that does not say it is a subframe; a
 * subframe tree arriving on `will-navigate`; the dev build's whole PDF tree; a dev origin that is
 * opaque; and the viewer's id behind a password. Each refusal sits beside the admitted shape it
 * differs from by one fact.
 */

const INDEX_HTML = '/Applications/Bro Bot2.app/Contents/Resources/app.asar/out/renderer/index.html'
const INDEX_URL = pathToFileURL(INDEX_HTML).href
const PACKAGED: AppDocument = { indexHtml: INDEX_HTML }
const DEV_SERVER_URL = 'http://localhost:5290'
const DEV: AppDocument = { indexHtml: INDEX_HTML, devServerUrl: DEV_SERVER_URL }

const UUID = '7f9c0b1e-2d3a-4c5b-9e8f-0a1b2c3d4e5f'
const BLOB = `blob:file:///${UUID}`
const DEV_BLOB = `blob:${DEV_SERVER_URL}/${UUID}`
const VIEWER_PAGE = `${PDF_VIEWER_ORIGIN}/index.html`
const PDF_FRAME = `${PDF_VIEWER_ORIGIN}/5cddf959-c621-40aa-9af6-0308cbe7a250`

/** `WebFrameMain`'s two fields the guard reads. */
interface Frame {
  readonly url: string
  readonly parent: Frame | null
}

/** The last of `urls` as a frame, each one above it its parent, the window's own frame at the top. */
function frameUnder(...urls: string[]): Frame {
  let frame: Frame = { url: INDEX_URL, parent: null }
  for (const url of urls) frame = { url, parent: frame }
  return frame
}

/** A window with the real guard installed, and a way to raise each event it listens to. */
function guarded(document: AppDocument): {
  fire: (event: string, url: string, extra: Record<string, unknown>) => { prevented: boolean }
} {
  const listeners = new Map<string, (details: unknown) => void>()
  const contents = {
    on(event: string, listener: (details: unknown) => void) {
      listeners.set(event, listener)
      return contents
    },
    setWindowOpenHandler(): void {},
  }
  installNavigationGuard(contents as unknown as WebContents, document, () => {})
  return {
    fire: (event, url, extra) => {
      const listener = listeners.get(event)
      if (!listener) throw new Error(`nothing is listening for '${event}'`)
      let prevented = false
      listener({ ...extra, url, preventDefault: () => void (prevented = true) })
      return { prevented }
    },
  }
}

/** An event's details for a subframe whose tree is `frame`. */
const subframe = (frame: Frame | null): Record<string, unknown> => ({ isMainFrame: false, frame })

describe('D-032 · through the installed guard, in the position the admitted frame holds', () => {
  const { fire } = guarded(PACKAGED)
  const frameNavigates = (url: string, frame: Frame | null): boolean =>
    fire('will-frame-navigate', url, subframe(frame)).prevented

  it('⚑ the admitted shape: the window’s blob, and the PDF frame under the viewer under it', () => {
    expect(frameNavigates(BLOB, frameUnder(BLOB))).toBe(false)
    expect(frameNavigates(PDF_FRAME, frameUnder(BLOB, VIEWER_PAGE, PDF_FRAME))).toBe(false)
  })

  it('⛔ a blob another origin minted, directly under the window', () => {
    for (const url of [
      `blob:https://evil.example/${UUID}`,
      `blob:file://evil.example/${UUID}`,
      `blob:null/${UUID}`,
      `blob:${PDF_VIEWER_ORIGIN}/${UUID}`,
    ]) {
      expect(frameNavigates(url, frameUnder(url)), url).toBe(true)
    }
  })

  it('⛔ the window’s own blob, two frames deep or under the viewer', () => {
    expect(frameNavigates(BLOB, frameUnder(BLOB, BLOB))).toBe(true)
    expect(frameNavigates(BLOB, frameUnder(BLOB, VIEWER_PAGE, BLOB))).toBe(true)
    expect(frameNavigates(BLOB, frameUnder(BLOB, VIEWER_PAGE, PDF_FRAME, BLOB))).toBe(true)
  })

  it('⛔ a `data:` frame and a web page, directly under the window and where the PDF frame sits', () => {
    for (const url of [
      'data:text/html,<script>parent.api</script>',
      'data:application/pdf;base64,JVBERi0xLjcK',
      'data:image/svg+xml;base64,PHN2Zy8+',
      'https://evil.example/',
      'http://localhost:5290/',
      'file:///tmp/evil.html',
    ]) {
      expect(frameNavigates(url, frameUnder(url)), url).toBe(true)
      expect(frameNavigates(url, frameUnder(BLOB, VIEWER_PAGE, url)), url).toBe(true)
    }
  })

  it('⛔ the PDF frame under anything but the viewer’s page under the window’s blob', () => {
    const foreign = `blob:https://evil.example/${UUID}`
    for (const tree of [
      frameUnder(BLOB, 'https://evil.example/', PDF_FRAME),
      frameUnder(foreign, VIEWER_PAGE, PDF_FRAME),
      frameUnder(DEV_BLOB, VIEWER_PAGE, PDF_FRAME),
      frameUnder(VIEWER_PAGE, BLOB, PDF_FRAME),
    ]) {
      expect(frameNavigates(PDF_FRAME, tree)).toBe(true)
    }
  })

  it('⛔ a tree with an ancestor whose URL cannot be read is refused, not let past', () => {
    const top: Frame = { url: INDEX_URL, parent: null }
    const unreadable = {
      get url(): string {
        throw new Error('Render frame was disposed before WebFrameMain could be accessed')
      },
      parent: top,
    } as Frame
    const viewer: Frame = { url: VIEWER_PAGE, parent: unreadable }
    expect(frameNavigates(PDF_FRAME, { url: PDF_FRAME, parent: viewer })).toBe(true)
    // …and an ancestor whose own parent cannot be read.
    const cut = {
      url: BLOB,
      get parent(): Frame {
        throw new Error('Render frame was disposed before WebFrameMain could be accessed')
      },
    } as Frame
    const underCut: Frame = { url: PDF_FRAME, parent: { url: VIEWER_PAGE, parent: cut } }
    expect(frameNavigates(PDF_FRAME, underCut)).toBe(true)
  })
})

describe('D-032 · only an event that says it is a subframe, on the one event a frame loads by', () => {
  it('⛔ a frame-navigate that does not say whether it is the main frame is refused, tree or not', () => {
    const { fire } = guarded(PACKAGED)
    expect(fire('will-frame-navigate', BLOB, { frame: frameUnder(BLOB) }).prevented).toBe(true)
    expect(
      fire('will-frame-navigate', BLOB, { isMainFrame: undefined, frame: frameUnder(BLOB) })
        .prevented,
    ).toBe(true)
    // The control: the same tree, said to be a subframe.
    expect(fire('will-frame-navigate', BLOB, subframe(frameUnder(BLOB))).prevented).toBe(false)
  })

  it('⛔ the admitted tree arriving on will-navigate is refused', () => {
    const { fire } = guarded(PACKAGED)
    expect(fire('will-navigate', BLOB, subframe(frameUnder(BLOB))).prevented).toBe(true)
    const pdfTree = frameUnder(BLOB, VIEWER_PAGE, PDF_FRAME)
    expect(fire('will-navigate', PDF_FRAME, subframe(pdfTree)).prevented).toBe(true)
  })
})

describe('D-032 · the dev build admits the same shape over its server’s origin', () => {
  it('⚑ the dev blob, and the PDF frame under the viewer under it', () => {
    const { fire } = guarded(DEV)
    expect(fire('will-frame-navigate', DEV_BLOB, subframe(frameUnder(DEV_BLOB))).prevented).toBe(
      false,
    )
    expect(
      fire('will-frame-navigate', PDF_FRAME, subframe(frameUnder(DEV_BLOB, VIEWER_PAGE, PDF_FRAME)))
        .prevented,
    ).toBe(false)
    expect(permitsSubframe(DEV, PDF_FRAME, [VIEWER_PAGE, DEV_BLOB])).toBe(true)
  })

  it('⛔ …and nothing over a packaged blob, a lookalike server, or a dev origin that is opaque', () => {
    expect(permitsSubframe(DEV, PDF_FRAME, [VIEWER_PAGE, BLOB])).toBe(false)
    const nextPort = `blob:http://localhost:5291/${UUID}`
    expect(permitsSubframe(DEV, PDF_FRAME, [VIEWER_PAGE, nextPort])).toBe(false)
    expect(permitsSubframe(DEV, `blob:https://localhost:5290/${UUID}`, [])).toBe(false)
    // A dev origin that is opaque (`'null'`) would compare equal to every opaque blob's origin.
    const opaque: AppDocument = { indexHtml: INDEX_HTML, devServerUrl: 'file:///Users/dev/app/' }
    expect(permitsSubframe(opaque, BLOB, [])).toBe(false)
    expect(permitsSubframe(opaque, `blob:null/${UUID}`, [])).toBe(false)
    const unparseable: AppDocument = { indexHtml: INDEX_HTML, devServerUrl: 'not a url' }
    expect(permitsSubframe(unparseable, BLOB, [])).toBe(false)
  })
})

describe('D-032 · the viewer by its exact authority', () => {
  const host = PDF_VIEWER_ORIGIN.slice('chrome-extension://'.length)

  it('⛔ the viewer’s id behind a password, as the frame and as the page above it', () => {
    const withPassword = `chrome-extension://:secret@${host}/x`
    expect(permitsSubframe(PACKAGED, withPassword, [VIEWER_PAGE, BLOB])).toBe(false)
    expect(permitsSubframe(PACKAGED, PDF_FRAME, [withPassword, BLOB])).toBe(false)
    // The control: the same tree, spelled plainly.
    expect(permitsSubframe(PACKAGED, `${PDF_VIEWER_ORIGIN}/x`, [VIEWER_PAGE, BLOB])).toBe(true)
  })

  it('⛔ an id one letter short of the viewer’s', () => {
    const shorter = `chrome-extension://${host.slice(0, -1)}/x`
    expect(permitsSubframe(PACKAGED, shorter, [VIEWER_PAGE, BLOB])).toBe(false)
    expect(permitsSubframe(PACKAGED, PDF_FRAME, [shorter, BLOB])).toBe(false)
  })
})
