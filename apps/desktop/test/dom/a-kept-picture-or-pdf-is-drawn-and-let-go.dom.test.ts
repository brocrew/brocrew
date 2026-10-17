import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import CanonicalDocumentOverlay from '../../src/renderer/src/components/CanonicalDocumentOverlay.vue'
import CanonicalDocumentViewer from '../../src/renderer/src/components/CanonicalDocumentViewer.vue'
import KeptFileDrawing from '../../src/renderer/src/components/KeptFileDrawing.vue'
import type {
  ResourceDrawer,
  ResourceReader,
  ResourceRevealer,
} from '../../src/renderer/src/lib/opening-a-document'
import type { DrawnAs } from '../../src/shared/documents'
import type { ResourceDrawing, ResourceReading, ResourceReveal } from '../../src/shared/runtime-ipc'
import { fileManagerWord } from '../../src/renderer/src/lib/message-paths'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * # 🔴 D-032 · a kept picture or PDF is drawn, and its URL is let go
 *
 * ⚑ **`KeptFileDrawing` is the one file of the window that frames anything** (the census in
 * `window-navigation.test.ts` says so), and `kept-file-urls.test.ts` pins the URLs it is handed.
 * ⚠️ **What neither measured is the component's own life**: that the URL is revoked when the file
 * shown changes and when the panel goes, that the frame carries exactly the attributes it was
 * written with, that an SVG reaches the page as a `data:` URL and never a blob or a frame, and that
 * a drawing answered for another id is not drawn. This file mounts the real overlay, viewer and
 * drawing in a browser and measures those.
 *
 * ⚑ **The bridge is not stood in for**: the overlay takes its doors (`read`, `draw`, `reveal`) as
 * props, which is how `RuntimeScreen` hands them `store.drawResource` and `store.revealResource`,
 * so a door here is a plain async function. `URL.createObjectURL` / `revokeObjectURL` are spied
 * and CALL THROUGH, so an `<img>` really loads a real `blob:`.
 *
 * ⛔ Each silence below sits beside the same mount one fact over, where the thing IS drawn, said
 * or revoked — a panel that drew nothing would otherwise pass the absences.
 */

/** The file manager's name on the computer the tests run on. */
const FILE_MANAGER = fileManagerWord(navigator.platform)

afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  delete (window as unknown as Record<string, unknown>).__d032_ran
})

type Drawn = Extract<ResourceDrawing, { ok: true }>

const bytesOf = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(new TextEncoder().encode(text))

/** A real 1 × 1 PNG, so an `<img>` from its blob loads rather than erring. */
const A_PNG: Uint8Array<ArrayBuffer> = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
)

const A_PDF = bytesOf('%PDF-1.4\n%%EOF\n')

/** ⛔ An SVG that would run, were it ever a document rather than a picture. */
const HOSTILE_SVG = bytesOf(
  '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" onload="window.__d032_ran=1">' +
    '<script>window.__d032_ran=2</script><rect width="4" height="4" fill="red"/></svg>',
)

const drawn = (
  resourceId: string,
  name: string,
  drawnAs: DrawnAs,
  bytes: Uint8Array<ArrayBuffer>,
): Drawn => ({
  ok: true,
  resourceId,
  name,
  drawnAs,
  bytes,
})

const reading = (
  resourceId: string,
  name: string,
  form: 'image' | 'pdf' | 'markdown',
  bytes = 2_048,
): ResourceReading => ({
  ok: true,
  resourceId,
  name,
  form,
  text: form === 'markdown' ? '# notes\n' : null,
  bytes,
})

/** What the overlay's doors answer, by id — a FRESH drawing each ask, as main's answer is. */
const READS: Record<string, ResourceReading> = {
  res_pdf: reading('res_pdf', 'brief.pdf', 'pdf'),
  res_pdf_2: reading('res_pdf_2', 'appendix.pdf', 'pdf'),
  res_png: reading('res_png', 'chart.png', 'image'),
  res_md: reading('res_md', 'notes.md', 'markdown'),
}
const DRAWS: Record<string, Drawn> = {
  res_pdf: drawn('res_pdf', 'brief.pdf', 'application/pdf', A_PDF),
  res_pdf_2: drawn('res_pdf_2', 'appendix.pdf', 'application/pdf', A_PDF),
  res_png: drawn('res_png', 'chart.png', 'image/png', A_PNG),
}

const readDoor: ResourceReader = async (id) =>
  READS[id] ?? { ok: false, reason: 'no-such-resource' }
const drawDoor: ResourceDrawer = async (id) => {
  const one = DRAWS[id]
  return one === undefined ? { ok: false, reason: 'no-such-resource' } : { ...one }
}

/** Every URL the window made and every one it let go — the spies call through. */
function watchUrls(): {
  made: () => string[]
  types: () => string[]
  revoked: () => string[]
} {
  const make = vi.spyOn(URL, 'createObjectURL')
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  return {
    made: () => make.mock.results.flatMap((r) => (r.type === 'return' ? [r.value as string] : [])),
    types: () => make.mock.calls.map(([obj]) => (obj as Blob).type),
    revoked: () => revoke.mock.calls.map(([url]) => url),
  }
}

/** The overlay under a parent that can move its `scope`, as `ConversationPane` does. */
function overlay(doors: {
  read?: ResourceReader
  draw?: ResourceDrawer
  reveal?: ResourceRevealer
}) {
  const scope = shallowRef<string | undefined>('sess_1')
  const child = ref<{ open: (resourceId: string) => Promise<void> } | null>(null)
  const Wrapper = defineComponent({
    setup: () => () =>
      h(CanonicalDocumentOverlay as never, { ...doors, scope: scope.value, ref: child }),
  })
  const m = mount(Wrapper, {}, { width: 1200, height: 800 })
  return {
    m,
    scope,
    open: async (id: string): Promise<void> => {
      await child.value!.open(id)
      await nextTick()
    },
  }
}

const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

const viewer = (props: Record<string, unknown>): Mounted =>
  mount(CanonicalDocumentViewer, props, { width: 900, height: 700 })

const drawing = (props: { drawing: Drawn; finder: boolean }): Mounted =>
  mount(KeptFileDrawing, props, { width: 900, height: 700 })

/** Every element with a `src` under a mount, and what it loads. */
const sources = (m: Mounted): string[] =>
  [...m.host.querySelectorAll('[src]')].map((el) => el.getAttribute('src') ?? '')

/* -------------------------------------------------------------------------------------------- */

describe('D-032 · a URL is let go when the file shown changes and when the panel goes', () => {
  it('🔴 PDF → picture → close: the PDF’s URL goes as the picture comes, and the picture’s as the panel closes', async () => {
    const urls = watchUrls()
    const { m, open } = overlay({ read: readDoor, draw: drawDoor })

    await open('res_pdf')
    const [pdfUrl] = urls.made()
    expect(pdfUrl).toMatch(/^blob:/)
    expect(m.q('kept-file-pdf').getAttribute('src')).toBe(pdfUrl)
    // ⚑ The positive half: while it is shown, nothing is let go.
    expect(urls.revoked()).toEqual([])

    await open('res_png')
    const pngUrl = urls.made()[1]
    expect(urls.made()).toHaveLength(2)
    expect(pngUrl).toMatch(/^blob:/)
    expect(pngUrl).not.toBe(pdfUrl)
    // ⛔ The PDF's URL is revoked, and the picture's — on screen — is not.
    expect(urls.revoked()).toEqual([pdfUrl])
    expect(m.all('kept-file-pdf')).toHaveLength(0)
    expect(m.q('kept-file-picture').getAttribute('src')).toBe(pngUrl)

    m.q('close-overlay').click()
    await nextTick()
    expect(m.all('canonical-document-viewer')).toHaveLength(0)
    expect(urls.revoked()).toEqual([pdfUrl, pngUrl])
  })

  it('🔴 PDF → PDF: the first frame’s URL goes, and the second frame loads its own', async () => {
    const urls = watchUrls()
    const { m, open } = overlay({ read: readDoor, draw: drawDoor })
    await open('res_pdf')
    await open('res_pdf_2')
    const [first, second] = urls.made()
    expect(urls.made()).toHaveLength(2)
    expect(second).not.toBe(first)
    expect(urls.revoked()).toEqual([first])
    // ⚑ One frame, the second file's.
    expect(m.all('kept-file-pdf')).toHaveLength(1)
    expect(m.q('kept-file-pdf').getAttribute('src')).toBe(second)
    expect(m.q('kept-file-pdf').getAttribute('title')).toBe('appendix.pdf')
  })

  it('⚑ Esc and the backdrop close it too, and each lets the URL go', async () => {
    for (const close of ['escape', 'backdrop'] as const) {
      const urls = watchUrls()
      const { m, open } = overlay({ read: readDoor, draw: drawDoor })
      await open('res_png')
      const [url] = urls.made()
      expect(urls.revoked()).toEqual([])
      if (close === 'escape') {
        m.q('overlay-host').dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        )
      } else {
        m.q('overlay-host').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      }
      await nextTick()
      expect(m.all('canonical-document-viewer'), close).toHaveLength(0)
      expect(urls.revoked(), close).toEqual([url])
      unmountAll()
      vi.restoreAllMocks()
    }
  })

  it('⚑ a conversation switch takes the panel, and its URL, with it', async () => {
    const urls = watchUrls()
    const { m, scope, open } = overlay({ read: readDoor, draw: drawDoor })
    await open('res_pdf')
    const [url] = urls.made()
    expect(m.all('kept-file-pdf')).toHaveLength(1)
    expect(urls.revoked()).toEqual([])
    scope.value = 'sess_2'
    await nextTick()
    expect(m.all('canonical-document-viewer')).toHaveLength(0)
    expect(urls.revoked()).toEqual([url])
  })

  it('⛔ an SVG holds nothing to let go — ⚑ while a PNG’s blob is revoked on the same close', async () => {
    const urls = watchUrls()
    const svg = drawing({
      drawing: drawn('res_svg', 'logo.svg', 'image/svg+xml', HOSTILE_SVG),
      finder: false,
    })
    expect(svg.q('kept-file-picture').getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/)
    svg.unmount()
    expect(urls.made()).toEqual([])
    expect(urls.revoked()).toEqual([])

    const png = drawing({
      drawing: drawn('res_png', 'chart.png', 'image/png', A_PNG),
      finder: false,
    })
    const [url] = urls.made()
    png.unmount()
    expect(urls.revoked()).toEqual([url])
  })
})

describe('D-032 · the door is asked once per open, and a later press drops an earlier answer', () => {
  it('🔴 a picture is asked for once as it opens — ⛔ a Markdown file never', async () => {
    const asked: string[] = []
    const draw: ResourceDrawer = async (id) => {
      asked.push(id)
      return drawDoor(id)
    }
    const { m, open } = overlay({ read: readDoor, draw })
    await open('res_png')
    expect(asked).toEqual(['res_png'])
    expect(m.all('kept-file-picture')).toHaveLength(1)
    await open('res_md')
    // ⛔ The text is its door: no bytes asked for, and the page is read as text.
    expect(asked).toEqual(['res_png'])
    expect(m.all('kept-file-drawing')).toHaveLength(0)
    expect(m.all('document-body')).toHaveLength(1)
  })

  it('⛔ a drawing that lands after a later press makes no URL — ⚑ the same answer, alone, draws', async () => {
    let release!: (answer: ResourceDrawing) => void
    const held = new Promise<ResourceDrawing>((it) => {
      release = it
    })
    const draw: ResourceDrawer = (id) => (id === 'res_pdf' ? held : drawDoor(id))

    const urls = watchUrls()
    const raced = overlay({ read: readDoor, draw })
    const stale = raced.open('res_pdf')
    await raced.open('res_png')
    release({ ...DRAWS.res_pdf! })
    await stale
    await nextTick()
    expect(urls.types()).toEqual(['image/png'])
    expect(raced.m.all('kept-file-pdf')).toHaveLength(0)
    expect(raced.m.all('kept-file-picture')).toHaveLength(1)
    unmountAll()

    // ⚑ The pair: no later press, and the held answer is drawn.
    let releaseAlone!: (answer: ResourceDrawing) => void
    const heldAlone = new Promise<ResourceDrawing>((it) => {
      releaseAlone = it
    })
    const alone = overlay({ read: readDoor, draw: () => heldAlone })
    const pending = alone.open('res_pdf')
    releaseAlone({ ...DRAWS.res_pdf! })
    await pending
    expect(alone.m.all('kept-file-pdf')).toHaveLength(1)
    expect(urls.types()).toEqual(['image/png', 'application/pdf'])
  })
})

describe('D-032 · the echoed id is checked — an answer for another file is not drawn', () => {
  it('⛔ a drawing echoing another id is not drawn and makes no URL — ⚑ the same drawing, this id, is', async () => {
    const urls = watchUrls()
    const elsewhere: ResourceDrawer = async () =>
      drawn('res_other', 'chart.png', 'image/png', A_PNG)
    const wrong = overlay({ read: readDoor, draw: elsewhere })
    await wrong.open('res_png')
    // ⚑ The panel is up and says what the read says; only the drawing is withheld.
    expect(read(wrong.m.q('canonical-document-name'))).toBe('chart.png')
    expect(wrong.m.all('kept-file-drawing')).toHaveLength(0)
    expect(read(wrong.m.q('canonical-document-not-drawn'))).toBe(
      'This file is an image. It is kept, and this window cannot draw it yet.',
    )
    expect(urls.made()).toEqual([])
    unmountAll()

    const right = overlay({ read: readDoor, draw: drawDoor })
    await right.open('res_png')
    expect(right.m.all('kept-file-picture')).toHaveLength(1)
    expect(right.m.all('canonical-document-not-drawn')).toHaveLength(0)
    expect(urls.made()).toHaveLength(1)
  })
})

describe('D-032 · the PDF frame is exactly what it was written as', () => {
  it('🔴 one frame: class, data-cy, src and title — ⛔ no sandbox, srcdoc, csp, allow or anything else', async () => {
    const urls = watchUrls()
    const m = drawing({
      drawing: drawn('res_pdf', 'brief.pdf', 'application/pdf', A_PDF),
      finder: true,
    })
    const frames = m.host.querySelectorAll('iframe')
    expect(frames).toHaveLength(1)
    const frame = frames[0]!
    // ⚑ Vue's scoped-style marker (`data-v-…`) is the build's, not the component's.
    const names = [...frame.attributes]
      .map((attribute) => attribute.name)
      .filter((name) => !name.startsWith('data-v-'))
      .sort()
    expect(names).toEqual(['class', 'data-cy', 'src', 'title'])
    expect(frame.getAttribute('class')).toBe('pdf-frame')
    expect(frame.getAttribute('data-cy')).toBe('kept-file-pdf')
    expect(frame.getAttribute('title')).toBe('brief.pdf')
    expect(frame.getAttribute('src')).toBe(urls.made()[0])
    expect(frame.getAttribute('src')).toMatch(/^blob:/)
    expect(urls.types()).toEqual(['application/pdf'])
    for (const absent of [
      'sandbox',
      'srcdoc',
      'csp',
      'allow',
      'referrerpolicy',
      'credentialless',
    ]) {
      expect(frame.hasAttribute(absent), absent).toBe(false)
    }
    // ⛔ And the frame is all there is: no picture, object or embed beside it.
    expect(m.host.querySelectorAll('img, object, embed')).toHaveLength(0)
    expect(m.q('kept-file-drawing').classList.contains('pdf')).toBe(true)
  })

  it('⛔ the type is main’s `drawnAs`, never the name — a `.pdf` drawn as PNG is a picture, a `.png` drawn as PDF a frame', async () => {
    const urls = watchUrls()
    const named = drawing({
      drawing: drawn('res_a', 'looks-like.pdf', 'image/png', A_PNG),
      finder: false,
    })
    expect(named.host.querySelectorAll('iframe')).toHaveLength(0)
    expect(named.q('kept-file-picture').getAttribute('alt')).toBe('looks-like.pdf')
    expect(named.q('kept-file-drawing').classList.contains('pdf')).toBe(false)
    named.unmount()

    const framed = drawing({
      drawing: drawn('res_b', 'looks-like.png', 'application/pdf', A_PDF),
      finder: false,
    })
    expect(framed.host.querySelectorAll('img')).toHaveLength(0)
    expect(framed.q('kept-file-pdf').getAttribute('title')).toBe('looks-like.png')
    expect(urls.types()).toEqual(['image/png', 'application/pdf'])
  })
})

describe('D-032 · an SVG is a data: picture, never a blob and never a frame', () => {
  it('🔴 its src is `data:image/svg+xml;base64,` of exactly its bytes, it draws, and nothing in it runs', async () => {
    const urls = watchUrls()
    const m = drawing({
      drawing: drawn('res_svg', 'logo.svg', 'image/svg+xml', HOSTILE_SVG),
      finder: false,
    })
    const img = m.q('kept-file-picture') as HTMLImageElement
    const src = img.getAttribute('src') ?? ''
    expect(src.startsWith('data:image/svg+xml;base64,')).toBe(true)
    const decoded = atob(src.slice('data:image/svg+xml;base64,'.length))
    expect(Uint8Array.from(decoded, (c) => c.charCodeAt(0))).toEqual(HOSTILE_SVG)
    // ⛔ Never a blob, never a frame, an object or an embed.
    expect(urls.made()).toEqual([])
    expect(sources(m).some((one) => one.startsWith('blob:'))).toBe(false)
    expect(m.host.querySelectorAll('iframe, object, embed')).toHaveLength(0)
    // ⚑ The positive: it really draws, at its own size — and its script and onload did not run.
    await vi.waitFor(() => expect(img.complete && img.naturalWidth).toBe(4), { timeout: 2_000 })
    expect(m.all('kept-file-broken')).toHaveLength(0)
    expect((window as unknown as Record<string, unknown>).__d032_ran).toBeUndefined()
  })

  it('⚑ the pair: a PNG is a blob of exactly image/png, drawn by an <img>', async () => {
    const urls = watchUrls()
    const m = drawing({ drawing: drawn('res_png', 'chart.png', 'image/png', A_PNG), finder: false })
    const img = m.q('kept-file-picture') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(urls.made()[0])
    expect(img.getAttribute('src')).toMatch(/^blob:/)
    expect(urls.types()).toEqual(['image/png'])
    await vi.waitFor(() => expect(img.complete && img.naturalWidth).toBe(1), { timeout: 2_000 })
    expect(m.host.querySelectorAll('iframe')).toHaveLength(0)
  })
})

describe('D-032 · a picture that cannot be drawn is said, never a dead blob', () => {
  const BROKEN_WITH_FINDER = `This image couldn't be drawn. Show it in ${FILE_MANAGER} to open it.`
  const BROKEN = "This image couldn't be drawn."

  it('⛔ a URL that could not be made is said — no <img>, no frame, no blob: — ⚑ with Finder named only where it is offered', async () => {
    for (const [one, as] of [
      [drawn('res_png', 'chart.png', 'image/png', A_PNG), 'png'],
      [drawn('res_pdf', 'brief.pdf', 'application/pdf', A_PDF), 'pdf'],
    ] as const) {
      for (const finder of [true, false]) {
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
          throw new Error('no URL for you')
        })
        const m = drawing({ drawing: one, finder })
        expect(read(m.q('kept-file-broken')), as).toBe(finder ? BROKEN_WITH_FINDER : BROKEN)
        expect(m.host.querySelectorAll('img, iframe'), as).toHaveLength(0)
        expect(sources(m), as).toEqual([])
        expect(m.q('kept-file-drawing').classList.contains('pdf'), as).toBe(false)
        unmountAll()
        vi.restoreAllMocks()
      }
    }
    // ⚑ The pair: the same drawings, with a URL to be had, are drawn and say nothing.
    const png = drawing({
      drawing: drawn('res_png', 'chart.png', 'image/png', A_PNG),
      finder: true,
    })
    expect(png.all('kept-file-broken')).toHaveLength(0)
    expect(png.q('kept-file-picture').getAttribute('src')).toMatch(/^blob:/)
    const pdf = drawing({
      drawing: drawn('res_pdf', 'brief.pdf', 'application/pdf', A_PDF),
      finder: true,
    })
    expect(pdf.all('kept-file-broken')).toHaveLength(0)
    expect(pdf.q('kept-file-pdf').getAttribute('src')).toMatch(/^blob:/)
  })

  it('⛔ a type this window does not know is said and makes no URL', async () => {
    const urls = watchUrls()
    const m = drawing({
      drawing: drawn('res_bmp', 'old.bmp', 'image/bmp' as unknown as DrawnAs, A_PNG),
      finder: true,
    })
    expect(read(m.q('kept-file-broken'))).toBe(BROKEN_WITH_FINDER)
    expect(urls.made()).toEqual([])
    expect(m.host.querySelectorAll('img, iframe')).toHaveLength(0)
  })

  it('⛔ bytes the window cannot decode are said once the <img> errs — ⚑ a real PNG stays drawn', async () => {
    const bad = drawing({
      drawing: drawn('res_bad', 'bad.png', 'image/png', bytesOf('not a png at all')),
      finder: true,
    })
    await vi.waitFor(() => expect(read(bad.q('kept-file-broken'))).toBe(BROKEN_WITH_FINDER), {
      timeout: 2_000,
    })
    expect(bad.all('kept-file-picture')).toHaveLength(0)

    const good = drawing({
      drawing: drawn('res_png', 'chart.png', 'image/png', A_PNG),
      finder: true,
    })
    const img = good.q('kept-file-picture') as HTMLImageElement
    await vi.waitFor(() => expect(img.complete && img.naturalWidth).toBe(1), { timeout: 2_000 })
    expect(good.all('kept-file-broken')).toHaveLength(0)
  })
})

describe('D-032 · why a file is not drawn, in plain words, with Show in Finder where it can help', () => {
  const IMAGE = reading('res_big', 'huge.png', 'image')
  const PDF = reading('res_big', 'huge.pdf', 'pdf')
  const MB = 1024 ** 2
  const reveal: ResourceRevealer = async () => ({ ok: true, changed: false })

  const CASES: readonly {
    reason: string
    result: ResourceReading
    drawing: ResourceDrawing
    withFinder: string
    without: string
  }[] = [
    {
      reason: 'too-large',
      result: IMAGE,
      drawing: { ok: false, reason: 'too-large', bytes: 18 * MB, mostBytes: 16 * MB },
      withFinder: `This file is 18.0 MB, more than this app draws (16.0 MB). Try Show in ${FILE_MANAGER} to open it.`,
      without: 'This file is 18.0 MB, more than this app draws (16.0 MB).',
    },
    {
      reason: 'too-many-pixels',
      result: IMAGE,
      drawing: {
        ok: false,
        reason: 'too-many-pixels',
        width: 20_000,
        height: 20_000,
        mostPixels: 64 * MB,
      },
      withFinder: `This image is 20000 × 20000 pixels, more than this app draws (64 megapixels). Show it in ${FILE_MANAGER} to open it.`,
      without: 'This image is 20000 × 20000 pixels, more than this app draws (64 megapixels).',
    },
    {
      reason: 'not-what-its-name-says (image)',
      result: IMAGE,
      drawing: { ok: false, reason: 'not-what-its-name-says' },
      withFinder:
        "This file's name says it's an image, but its contents aren't one, so it isn't drawn.",
      without:
        "This file's name says it's an image, but its contents aren't one, so it isn't drawn.",
    },
    {
      reason: 'not-what-its-name-says (pdf)',
      result: PDF,
      drawing: { ok: false, reason: 'not-what-its-name-says' },
      withFinder:
        "This file's name says it's a PDF, but its contents aren't one, so it isn't drawn.",
      without: "This file's name says it's a PDF, but its contents aren't one, so it isn't drawn.",
    },
    {
      reason: 'changed',
      result: IMAGE,
      drawing: { ok: false, reason: 'changed' },
      withFinder: `The file is not the bytes that were kept. This app re-checks the hash on every read, and it did not match. Show it in ${FILE_MANAGER} to see what is there now.`,
      without:
        'The file is not the bytes that were kept. This app re-checks the hash on every read, and it did not match.',
    },
    {
      reason: 'unreadable',
      result: IMAGE,
      drawing: { ok: false, reason: 'unreadable' },
      withFinder:
        'This app keeps a file by that id and could not read it — it may have been moved, or replaced by something that is not a file.',
      without:
        'This app keeps a file by that id and could not read it — it may have been moved, or replaced by something that is not a file.',
    },
  ]

  it('🔴 each refusal says its own words, and Show in Finder is offered beside it', async () => {
    const urls = watchUrls()
    for (const one of CASES) {
      const m = viewer({ result: one.result, drawing: one.drawing, reveal })
      expect(read(m.q('canonical-document-undrawn')), one.reason).toBe(one.withFinder)
      expect(read(m.q('canonical-document-finder')), one.reason).toBe(`Show in ${FILE_MANAGER}`)
      expect(m.all('kept-file-drawing'), one.reason).toHaveLength(0)
      unmountAll()
    }
    expect(urls.made()).toEqual([])
  })

  it('⛔ with no Finder door the same refusals name no Finder, and no button is drawn', async () => {
    for (const one of CASES) {
      const m = viewer({ result: one.result, drawing: one.drawing })
      expect(read(m.q('canonical-document-undrawn')), one.reason).toBe(one.without)
      expect(m.all('canonical-document-finder'), one.reason).toHaveLength(0)
      unmountAll()
    }
  })
})

describe('D-032 · what Show in Finder says', () => {
  const RESULT = reading('res_png', 'chart.png', 'image')

  it('🔴 on a Windows PC the button, the refusals and what it says name Explorer, never Finder', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    const answers: ResourceReveal[] = [
      { ok: true, changed: true },
      { ok: false, reason: 'unreadable' },
    ]
    let asked = 0
    const reveal: ResourceRevealer = async () => answers[asked++]!
    const m = viewer({ result: RESULT, drawing: DRAWS.res_png, reveal })
    const button = m.q('canonical-document-finder')
    expect(read(button)).toBe('Show in Explorer')
    for (const said of [
      'Shown in Explorer. It no longer matches what was kept.',
      "This app can't read the file where it keeps it, so Explorer can't show it.",
    ]) {
      const before = asked
      button.click()
      await vi.waitFor(() => expect(asked).toBe(before + 1))
      await new Promise((settle) => setTimeout(settle, 0))
      await nextTick()
      expect(read(m.q('canonical-document-revealed'))).toBe(said)
    }
    expect(m.host.textContent).not.toContain('Finder')
    unmountAll()

    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('no URL for you')
    })
    const broken = drawing({ drawing: DRAWS.res_png!, finder: true })
    expect(read(broken.q('kept-file-broken'))).toBe(
      "This image couldn't be drawn. Show it in Explorer to open it.",
    )
  })

  it('🔴 asks by the id; says nothing when it showed the file, and says so when the bytes changed, are gone or unreadable', async () => {
    const answers: ResourceReveal[] = [
      { ok: true, changed: false },
      { ok: true, changed: true },
      { ok: false, reason: 'gone' },
      { ok: false, reason: 'unreadable' },
    ]
    const asked: string[] = []
    const reveal: ResourceRevealer = async (id) => {
      asked.push(id)
      return answers[asked.length - 1]!
    }
    const m = viewer({ result: RESULT, drawing: DRAWS.res_png, reveal })
    const press = async (): Promise<void> => {
      const before = asked.length
      m.q('canonical-document-finder').click()
      await vi.waitFor(() => expect(asked).toHaveLength(before + 1))
      await new Promise((settle) => setTimeout(settle, 0))
      await nextTick()
    }

    await press()
    expect(asked).toEqual(['res_png'])
    // ⛔ Shown and unchanged: nothing to say.
    expect(m.all('canonical-document-revealed')).toHaveLength(0)

    await press()
    expect(read(m.q('canonical-document-revealed'))).toBe(
      `Shown in ${FILE_MANAGER}. It no longer matches what was kept.`,
    )
    await press()
    expect(read(m.q('canonical-document-revealed'))).toBe(
      'The file is no longer where this app kept it.',
    )
    await press()
    expect(read(m.q('canonical-document-revealed'))).toBe(
      `This app can't read the file where it keeps it, so ${FILE_MANAGER} can't show it.`,
    )
    expect(asked).toEqual(['res_png', 'res_png', 'res_png', 'res_png'])
  })

  it('⛔ a read that names no kept file offers no Finder — ⚑ one whose bytes changed does, by the pressed id', async () => {
    const asked: string[] = []
    const reveal: ResourceRevealer = async (id) => {
      asked.push(id)
      return { ok: true, changed: true }
    }
    const none = viewer({
      resourceId: 'res_gone',
      result: { ok: false, reason: 'no-such-resource' },
      reveal,
    })
    expect(read(none.q('canonical-document-refusal'))).toBe(
      'This app is not keeping a file with that id.',
    )
    expect(none.all('canonical-document-finder')).toHaveLength(0)
    unmountAll()

    const changed = viewer({
      resourceId: 'res_moved',
      result: { ok: false, reason: 'changed' },
      reveal,
    })
    changed.q('canonical-document-finder').click()
    await vi.waitFor(() =>
      expect(read(changed.q('canonical-document-revealed'))).toBe(
        `Shown in ${FILE_MANAGER}. It no longer matches what was kept.`,
      ),
    )
    expect(asked).toEqual(['res_moved'])
  })
})

describe('D-032 · the header: the name, “Image · size”, and the name kept to itself', () => {
  it('🔴 a picture’s header says its name and “Image · 2 KB”; a PDF’s, “PDF · …”', async () => {
    const m = viewer({ result: reading('res_png', 'chart.png', 'image'), drawing: DRAWS.res_png })
    expect(read(m.q('canonical-document-name'))).toBe('chart.png')
    expect(read(m.q('canonical-document-kind'))).toBe('Image · 2 KB')
    expect(read(m.q('canonical-document-id'))).toBe('res_png')
    unmountAll()
    const pdf = viewer({
      result: reading('res_pdf', 'brief.pdf', 'pdf', 3 * 1024 ** 2),
      drawing: DRAWS.res_pdf,
    })
    expect(read(pdf.q('canonical-document-kind'))).toBe('PDF · 3.0 MB')
  })

  it('⛔ a name holding a direction override is drawn as text and isolated — ⚑ the kind beside it is not', async () => {
    const hostile = '‮gnp.exe<b>x</b>'
    const m = viewer({
      result: reading('res_png', hostile, 'image'),
      drawing: drawn('res_png', hostile, 'image/png', A_PNG),
    })
    const name = m.q('canonical-document-name')
    expect(name.textContent).toBe(hostile)
    expect(name.querySelector('b')).toBeNull()
    expect(getComputedStyle(name).unicodeBidi).toBe('isolate')
    // ⚑ The pair: the rule is the name's, not every span's in the header.
    expect(getComputedStyle(m.q('canonical-document-kind')).unicodeBidi).not.toBe('isolate')
    // ⛔ And in the drawing it is an attribute, never markup.
    expect(m.q('kept-file-picture').getAttribute('alt')).toBe(hostile)
    expect(m.q('kept-file-drawing').querySelector('b')).toBeNull()
  })
})
