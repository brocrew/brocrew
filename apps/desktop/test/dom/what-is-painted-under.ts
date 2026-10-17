import { page } from 'vitest/browser'
import { contrastRatio, type Rgba } from '../../src/shared/themes/colour'
import { drawnReady, inkRects, wordRects } from './drawn'

/**
 * How text reads where the window draws it, measured from the window's own pixels.
 *
 * Three pictures of the screen are taken. In the first every glyph's fill is see-through, so each
 * pixel is what is painted under the text: fills, washes, scrims, pictures, pseudo-elements and
 * layers no pointer can reach, each through the opacity of every group it is in. Only the glyphs
 * are hidden: `color` is left alone, so a fill or border drawn in `currentColor` stays as drawn. In
 * the second each piece of text is wrapped in an inline box filled with its own ink, which paints
 * in the glyphs' own layer, so it passes through exactly the same groups and under exactly the same
 * layers as the text does. The third fills that box with a far colour instead: where the two
 * differ, the text shows, and by how much says how much of it gets through. Texts whose line boxes
 * overlap are given those two pictures in turn, never together, so one text's box is never taken
 * for another showing.
 *
 * One more picture shows the window as it is, glyphs and all: where it differs from the first, a
 * glyph is painted. A text's reading is the worst contrast between the first two pictures over the
 * pixels of its line boxes where its glyphs are painted and it shows, not over the space a line box
 * holds around them. Whether a text is drawn at all is decided from its style alone: not
 * hidden, not see-through, not in a group at opacity 0, and on screen. Every text that is drawn is
 * read, however faint: a group's opacity fades its words and what they sit on alike, and the
 * reading says so. The pictures decide only what is drawn OVER a text: a pixel where less than
 * {@link SHOWS} of the text gets through shows none of it. A word is passed over only where one of
 * the window's NAMED backdrops (an overlay's, a dialog's, the command palette's, the scrim behind
 * the floating right-hand panel) or NAMED covers (the floating right-hand panel, an open popover or
 * dialog, and the shadow an open popover or dialog casts) is drawn over it and itself takes
 * {@link DIMMED} or more of it away (half that under a backdrop that blurs), measured against the
 * same pictures taken with every named surface hidden, so a named surface that paints nothing
 * there passes nothing over. The rest of its line is still read. Kept white space a line ends in
 * is passed over too, proved from the text itself: a line box none of its words meets, with none
 * of them after it on its line. Any other line box with no
 * pixel read is "unread", which the window check fails: a way of drawing text the sampler can't
 * see fails rather than passes.
 */

const canvas = document.createElement('canvas')
canvas.width = 1
canvas.height = 1
const ctx = canvas.getContext('2d', { willReadFrequently: true })!

/** A computed colour as sRGB with its alpha, read from its numbers where it is written as numbers. */
export function see(computed: string): Rgba {
  const srgb = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/.exec(computed)
  if (srgb) {
    const [r, g, b] = [srgb[1], srgb[2], srgb[3]].map((v) => Number(v) * 255)
    return { r: r!, g: g!, b: b!, a: srgb[4] === undefined ? 1 : Number(srgb[4]) }
  }
  const rgb = /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/.exec(computed)
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number)
    return { r: r!, g: g!, b: b!, a: rgb[4] === undefined ? 1 : Number(rgb[4]) }
  }
  // Any other form (oklab(), a mix): painted on one pixel and read back, alpha and all.
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = 'rgb(0 0 0 / 0)'
  ctx.fillStyle = computed
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return { r: d[0]!, g: d[1]!, b: d[2]!, a: d[3]! / 255 }
}

/** How a piece of text reads where it is drawn, or why it isn't read. */
export type Reading =
  | { readonly is: 'read'; readonly ratio: number }
  | { readonly is: 'covered' | 'not-drawn' | 'unread' }

/** The opacity an element is drawn at: its own times every ancestor's. */
function drawnOpacity(el: Element): number {
  let opacity = 1
  for (let e: Element | null = el; e; e = e.parentElement)
    opacity *= Number(getComputedStyle(e).opacity)
  return opacity
}

/** The least share of a text that must get through for a pixel to count as showing it. */
export const SHOWS = 0.02

/** The share of a text that must get through for a pixel by an edge to be read: none blends in. */
export const WHOLE = 0.95

/** Whether `el` keeps white space as written, so a line can end in spaces that paint nothing. */
function keepsSpaces(el: Element): boolean {
  return ['pre', 'pre-wrap', 'break-spaces'].includes(getComputedStyle(el).whiteSpace)
}

/** The least a named backdrop must dim what is under it for that text to be passed over. */
export const DIMMED = 0.25

/** The window's backdrops: layers drawn over the rest of the window while something is in front. */
const BACKDROPS = ['.overlay-host', '.palette-scrim', '.drawer-scrim'] as const

/** The window's covers: opaque surfaces drawn over other content on purpose. */
const COVERS = ['.session-drawer.fit-overlay', ':popover-open', 'dialog[open]'] as const

/** Every named backdrop and cover hidden, to tell what they themselves take from a text. */
const HIDE_NAMED =
  [...BACKDROPS, ...COVERS].map((name) => `${name}, ${name} *`).join(', ') +
  ' { visibility: hidden !important; } dialog::backdrop { visibility: hidden !important; ' +
  'background: transparent !important; }'

/**
 * The least a text's own colour must move a pixel, at its drawn opacity, for the pictures to tell
 * whether something covers it: below this the text is read at every pixel of its boxes.
 */
const MEASURABLE = 8

/** Whether a style draws what is under it, or itself, through a blur of more than nothing. */
function blurs(style: CSSStyleDeclaration): boolean {
  return [style.backdropFilter, style.filter].some((f) =>
    [...(f ?? '').matchAll(/blur\(\s*([\d.]+)px/g)].some((m) => Number(m[1]) > 0),
  )
}

/**
 * How much the named paint over (x, y), above `el`, must be seen to take from a text for it to be
 * passed over there, or null where no named surface is over it. A cover must take {@link DIMMED}.
 * So must a backdrop whose colour dims by that much (its alpha), unless it blurs what is under it:
 * then half, since its blur mixes neighbouring words into what is left.
 */
function namedOver(el: Element, x: number, y: number): number | null {
  const backdrop = (alpha: number, style: CSSStyleDeclaration): number | null =>
    alpha >= DIMMED ? (blurs(style) ? DIMMED / 2 : DIMMED) : null
  // A modal dialog's ::backdrop covers everything outside the dialog.
  for (const dialog of document.querySelectorAll('dialog'))
    if (dialog.matches(':modal') && !dialog.contains(el)) {
      const style = getComputedStyle(dialog, '::backdrop')
      const need = backdrop(see(style.backgroundColor).a * drawnOpacity(dialog), style)
      if (need !== null) return need
    }
  const stack = document.elementsFromPoint(x, y)
  const at = stack.findIndex((e) => e === el || e.contains(el))
  for (const e of at < 0 ? stack : stack.slice(0, at)) {
    if (e.contains(el)) continue
    if (COVERS.some((name) => e.matches(name))) return DIMMED
    if (BACKDROPS.some((name) => e.matches(name))) {
      const style = getComputedStyle(e)
      const need = backdrop(see(style.backgroundColor).a * drawnOpacity(e), style)
      if (need !== null) return need
    }
  }
  // An open popover or dialog is drawn over everything, and so is the shadow it casts.
  const shadowed = [...document.querySelectorAll(':popover-open, dialog[open]')].some(
    (cover) => !cover.contains(el) && inShadow(cover, x, y),
  )
  return shadowed ? DIMMED : null
}

/** Whether (x, y) is inside `el`'s box grown by the furthest reach of its box shadows. */
function inShadow(el: Element, x: number, y: number): boolean {
  const box = el.getBoundingClientRect()
  let [left, top, right, bottom] = [box.left, box.top, box.right, box.bottom]
  for (const shadow of getComputedStyle(el).boxShadow.split(/,(?![^(]*\))/)) {
    if (shadow.includes('inset') || shadow.trim() === 'none') continue
    const [dx = 0, dy = 0, blur = 0, spread = 0] = [...shadow.matchAll(/(-?[\d.]+)px/g)].map((m) =>
      Number(m[1]),
    )
    const reach = blur + spread
    left = Math.min(left, box.left + dx - reach)
    right = Math.max(right, box.right + dx + reach)
    top = Math.min(top, box.top + dy - reach)
    bottom = Math.max(bottom, box.bottom + dy + reach)
  }
  return x >= left && x <= right && y >= top && y <= bottom
}

interface Picture {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly scale: number
}

/** How many pictures the sampler has taken, and the time they took, so a run can say so. */
export const pictures = { taken: 0, ms: 0 }

/** A picture of the viewport, as its pixels. */
async function shot(): Promise<Picture> {
  const started = performance.now()
  try {
    return await picture()
  } finally {
    pictures.taken += 1
    pictures.ms += performance.now() - started
  }
}

async function picture(): Promise<Picture> {
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))))
  const base64 = (await page.screenshot({ save: false })) as unknown as string
  const image = new Image()
  image.src = `data:image/png;base64,${base64}`
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(image, 0, 0)
  return {
    data: ctx.getImageData(0, 0, image.width, image.height).data,
    width: image.width,
    scale: image.width / window.innerWidth,
  }
}

/** One pixel of a picture, at a point in CSS pixels. */
function pixel(pic: Picture, x: number, y: number): Rgba {
  const i = (Math.round(y * pic.scale) * pic.width + Math.round(x * pic.scale)) * 4
  return { r: pic.data[i]!, g: pic.data[i + 1]!, b: pic.data[i + 2]!, a: 1 }
}

/**
 * Whether a box is the containing block of absolute and fixed boxes inside it, whatever its own
 * position: it has a transform, a perspective or a filter, a backdrop filter, paint or layout
 * containment, or names one of those properties itself in `will-change` (not a property whose name
 * only contains one, such as `transform-origin`).
 */
function holdsPositioned(s: CSSStyleDeclaration): boolean {
  return (
    s.transform !== 'none' ||
    s.translate !== 'none' ||
    s.rotate !== 'none' ||
    s.scale !== 'none' ||
    s.perspective !== 'none' ||
    s.filter !== 'none' ||
    (s.backdropFilter ?? 'none') !== 'none' ||
    names(s.contain).some((v) => ['paint', 'layout', 'strict', 'content'].includes(v)) ||
    names(s.willChange).some((v) => WILL_HOLD.includes(v))
  )
}

/** The properties `will-change` can name that would make a box hold positioned boxes. */
const WILL_HOLD = [
  'transform',
  'translate',
  'rotate',
  'scale',
  'perspective',
  'transform-style',
  'filter',
  'backdrop-filter',
  'contain',
]

/** The words of a space- or comma-separated value, each trimmed and in lower case. */
function names(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
}

/** `rect` cut to the boxes that clip it: every ancestor whose overflow isn't visible, and the screen. */
function clipped(el: Element, rect: DOMRect): DOMRect | null {
  let left = Math.max(rect.left, 0)
  let top = Math.max(rect.top, 0)
  let right = Math.min(rect.right, window.innerWidth)
  let bottom = Math.min(rect.bottom, window.innerHeight)
  // A box's overflow clips only what it contains: a positioned box escapes every ancestor until
  // its containing block. For an absolute box that is the nearest ancestor that is positioned or
  // that holds positioned boxes (a transform, a filter, containment); for a fixed box, the nearest
  // that holds positioned boxes, else the screen.
  let escaping: 'absolute' | 'fixed' | null = null
  for (let e: Element | null = el; e; e = e.parentElement) {
    const s = getComputedStyle(e)
    if (escaping === 'absolute' && s.position === 'static' && !holdsPositioned(s)) continue
    if (escaping === 'fixed' && !holdsPositioned(s)) continue
    escaping = null
    if (s.position === 'absolute') escaping = 'absolute'
    if (s.position === 'fixed') escaping = 'fixed'
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
    // Overflow clips only a box it applies to; an inline element reports it and clips nothing.
    if (s.display === 'inline' || s.display === 'contents') continue
    const box = e.getBoundingClientRect()
    const inner = {
      left: box.left + e.clientLeft,
      top: box.top + e.clientTop,
      right: box.left + e.clientLeft + e.clientWidth,
      bottom: box.top + e.clientTop + e.clientHeight,
    }
    if (s.overflowX !== 'visible') {
      left = Math.max(left, inner.left)
      right = Math.min(right, inner.right)
    }
    if (s.overflowY !== 'visible') {
      top = Math.max(top, inner.top)
      bottom = Math.min(bottom, inner.bottom)
    }
  }
  if (right <= left || bottom <= top) return null
  // A sliver the clipping leaves (under 3 px) is not read; a line box that small by itself is.
  const cut = left > rect.left || top > rect.top || right < rect.right || bottom < rect.bottom
  if (cut && (right - left < 3 || bottom - top < 3)) return null
  return new DOMRect(left, top, right - left, bottom - top)
}

/** The text nodes under `root` worth reading, each with its element and its line boxes on screen. */
function candidates(
  root: Element,
): { node: Text; el: Element; rects: DOMRect[]; ink: string; opacity: number }[] {
  const out: { node: Text; el: Element; rects: DOMRect[]; ink: string; opacity: number }[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.textContent ?? '').trim()) continue
    const el = node.parentElement
    if (!el) continue
    const style = getComputedStyle(el)
    if (style.visibility !== 'visible' || see(style.color).a === 0) continue
    const opacity = drawnOpacity(el)
    if (opacity === 0) continue
    const rects = inkRects(node as Text)
      .map((r) => clipped(el, r))
      .filter((r): r is DOMRect => r !== null)
    if (rects.length > 0) out.push({ node: node as Text, el, rects, ink: style.color, opacity })
  }
  return out
}

/**
 * The texts split into groups none of whose line boxes overlap, each group pictured on its own. A
 * text's box changes colour between the inked pictures, so where two texts overlap, one's box would
 * seem to be the other showing; in separate pictures, each is read where it really shows, through
 * the gaps between the glyphs of any text drawn over it.
 */
function apart(found: readonly { rects: DOMRect[] }[]): number[] {
  // Boxes that only touch, within the 2 px at a box's edge the reading leaves out, share a group.
  const overlap = (a: DOMRect, b: DOMRect): boolean =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2
  const group: number[] = []
  found.forEach((one, i) => {
    const taken = new Set<number>()
    for (let j = 0; j < i; j++)
      if (one.rects.some((a) => found[j]!.rects.some((b) => overlap(a, b)))) taken.add(group[j]!)
    let g = 0
    while (taken.has(g)) g++
    group.push(g)
  })
  return group
}

/** Nothing moving while the window is pictured, and no caret. */
const STILL =
  '*, *::before, *::after { caret-color: transparent !important; transition: none !important; ' +
  'animation: none !important; }'

/** The glyphs' fill hidden and nothing else. */
const HIDE_INK =
  '*, *::before, *::after { -webkit-text-fill-color: transparent !important; ' +
  'text-shadow: none !important; text-decoration-color: transparent !important; }'

/** A colour as far as can be from `ink`, channel by channel, at its alpha. */
function far(ink: Rgba): Rgba {
  return { r: ink.r < 128 ? 255 : 0, g: ink.g < 128 ? 255 : 0, b: ink.b < 128 ? 255 : 0, a: ink.a }
}

const css = (c: Rgba): string => `rgb(${c.r} ${c.g} ${c.b} / ${c.a})`

/**
 * Every piece of text under `root` that is drawn on screen, with how it reads there. A fade the
 * window applies on purpose, an element matching `unfaded`, is lifted for both pictures: its text
 * is read at full strength on its real stack, so a theme that makes it unreadable still shows.
 */
export async function paintedReadings(
  root: Element,
  unfaded?: string,
): Promise<{ readonly node: Text; readonly reading: Reading }[]> {
  await drawnReady()
  const lift = document.createElement('style')
  lift.textContent = unfaded ? `${unfaded} { opacity: 1 !important; }` : ''
  document.head.append(lift)
  const found = candidates(root)
  const group = apart(found)
  const groups = Math.max(0, ...group) + 1

  const still = document.createElement('style')
  still.textContent = STILL
  document.head.append(still)
  const hide = document.createElement('style')
  hide.textContent = HIDE_INK
  let real: Picture
  let under: Picture
  const inkedIn: Picture[] = []
  const farIn: Picture[] = []
  // The same two pictures with the named backdrops and covers hidden, for each group holding a
  // text a named surface is over: at the middle or either end of one of its line boxes.
  const underNamed = found.map(({ el, rects }) =>
    rects.some((r) =>
      [r.left + 2, (r.left + r.right) / 2, r.right - 2].some(
        (x) => namedOver(el, x, (r.top + r.bottom) / 2) !== null,
      ),
    ),
  )
  const bareFor = new Set(group.filter((_, i) => underNamed[i]))
  const bareInkedIn: Picture[] = []
  const bareFarIn: Picture[] = []
  const hideNamed = document.createElement('style')
  hideNamed.textContent = HIDE_NAMED
  // Each text wrapped in an inline box of its own ink, which paints in the glyphs' own layer.
  const wraps = found.map(({ node }) => {
    const span = document.createElement('span')
    span.setAttribute('data-ink-probe', '')
    node.replaceWith(span)
    span.append(node)
    return span
  })
  const paint = (g: number, colour: (ink: Rgba) => Rgba): void =>
    wraps.forEach((span, i) => {
      if (group[i] === g)
        span.style.setProperty('background-color', css(colour(see(found[i]!.ink))), 'important')
      else span.style.removeProperty('background-color')
    })
  try {
    real = await shot()
    document.head.append(hide)
    under = await shot()
    for (let g = 0; g < groups; g++) {
      paint(g, (ink) => ink)
      inkedIn.push(await shot())
      paint(g, far)
      farIn.push(await shot())
    }
    if (bareFor.size > 0) {
      document.head.append(hideNamed)
      for (const g of bareFor) {
        paint(g, (ink) => ink)
        bareInkedIn[g] = await shot()
        paint(g, far)
        bareFarIn[g] = await shot()
      }
    }
  } finally {
    hideNamed.remove()
    for (const span of wraps) span.replaceWith(...span.childNodes)
    hide.remove()
    still.remove()
    lift.remove()
  }

  return found.map(({ node, el, rects, ink, opacity }, index) => {
    const inked = inkedIn[group[index]!]!
    const farInked = farIn[group[index]!]!
    const bareInked = bareInkedIn[group[index]!]
    const bareFar = bareFarIn[group[index]!]
    const own = see(ink)
    const away = far(own)
    // How much one channel moves when all of the text gets through: the one that moves most, at
    // the opacity the text is drawn at.
    const channel = (['r', 'g', 'b'] as const).reduce((a, b) =>
      Math.abs(own[a] - away[a]) >= Math.abs(own[b] - away[b]) ? a : b,
    )
    const full = opacity * own.a * Math.abs(own[channel] - away[channel])
    let worst = Infinity
    const lines = rects.map((rect): 'read' | 'covered' | 'blank' | 'unread' => {
      const xs: number[] = []
      for (let x = rect.left; x < rect.right; x += 1) xs.push(x)
      const ys: number[] = []
      for (let y = rect.top; y < rect.bottom; y += 1) ys.push(y)
      // Kept white space at the end of a line is not text: proved from the text itself, a line box
      // none of its other characters meets, with none of them after it on its line.
      if (keepsSpaces(el)) {
        const chars = wordRects(node)
        const meets = (c: DOMRect): boolean =>
          Math.min(c.right, rect.right) - Math.max(c.left, rect.left) > 0.5 &&
          Math.min(c.bottom, rect.bottom) - Math.max(c.top, rect.top) > 0.5
        const after = (c: DOMRect): boolean =>
          Math.min(c.bottom, rect.bottom) - Math.max(c.top, rect.top) > rect.height / 2 &&
          c.left >= rect.right - 0.5
        if (!chars.some((c) => meets(c) || after(c))) return 'blank'
      }
      const shows = ys.map((y) =>
        xs.map(
          (x) =>
            full < MEASURABLE ||
            Math.abs(pixel(inked, x, y)[channel] - pixel(farInked, x, y)[channel]) / full >= SHOWS,
        ),
      )
      // Under a named backdrop or cover, a word is passed over only where that named paint itself
      // dims it, measured against the pictures taken with every named surface hidden: over the
      // word's pixels where the text shows without them, it shows less, on average, with them
      // drawn, by at least what {@link namedOver} asks there. Something else hiding the text, or a
      // named surface that paints nothing over the word, passes nothing over. The line box is
      // passed over when all its words are; otherwise the rest of it is read.
      const passed: DOMRect[] = []
      let words = 0
      if (full >= MEASURABLE && bareInked && bareFar) {
        const through = (a: Picture, b: Picture, x: number, y: number): number =>
          Math.abs(pixel(a, x, y)[channel] - pixel(b, x, y)[channel]) / full
        for (const w of wordRects(node)) {
          const left = Math.max(w.left, rect.left)
          const right = Math.min(w.right, rect.right)
          const top = Math.max(w.top, rect.top)
          const bottom = Math.min(w.bottom, rect.bottom)
          if (right - left < 1 || bottom - top < 1) continue
          words++
          const need = namedOver(el, (left + right) / 2, (top + bottom) / 2)
          if (need === null) continue
          const edge = right - left > 4 && bottom - top > 4 ? 2 : 0
          let seen = 0
          let taken = 0
          for (let y = top + edge; y < bottom - edge; y += 1)
            for (let x = left + edge; x < right - edge; x += 1) {
              const bare = through(bareInked, bareFar, x, y)
              if (bare < 0.5) continue
              seen++
              taken += bare - through(inked, farInked, x, y)
            }
          if (seen > 0 && taken / seen >= need)
            passed.push(new DOMRect(left - 2, top - 2, right - left + 4, bottom - top + 4))
        }
        if (words > 0 && passed.length === words) return 'covered'
      }
      const passedAt = (x: number, y: number): boolean =>
        passed.some((p) => x >= p.left && x < p.right && y >= p.top && y < p.bottom)
      // Read where the text shows. The pictures are scaled, so a box's outer pixels, and the edge
      // of something drawn over the text, blend with what is beside them: a pixel within 2 px of
      // such an edge is read only where nearly all of the text gets through ({@link WHOLE}), and
      // one further in wherever it shows, as dimmed as it is. Of those pixels, read the ones where
      // a glyph is painted (the window as it is differs there from the window with the glyphs
      // hidden). Where none is, the text paints nothing there although nothing hides it: either
      // its ink is the colour under it, which reads about 1:1, or it is cut off, and either way its
      // ink against what is under it is the reading. A text drawn so faintly that the pictures
      // can't tell what covers it is read at every pixel, as faint as it is.
      const inside = (i: number, j: number): boolean => {
        if (i < 2 || j < 2 || i >= ys.length - 2 || j >= xs.length - 2) return false
        for (let di = -2; di <= 2; di++)
          for (let dj = -2; dj <= 2; dj++) if (!shows[i + di]![j + dj]) return false
        return true
      }
      const clear: [number, number, boolean][] = []
      for (let i = 0; i < ys.length; i++)
        for (let j = 0; j < xs.length; j++) {
          const x = xs[j]!
          const y = ys[i]!
          const a = pixel(real, x, y)
          const b = pixel(under, x, y)
          const glyph = a.r !== b.r || a.g !== b.g || a.b !== b.b
          if (!shows[i]![j] || passedAt(x, y)) continue
          const through =
            Math.abs(pixel(inked, x, y)[channel] - pixel(farInked, x, y)[channel]) / full
          if (full >= MEASURABLE && !inside(i, j) && through < WHOLE) continue
          clear.push([x, y, glyph])
        }
      const glyphs = clear.filter(([, , glyph]) => glyph)
      const read = glyphs.length > 0 ? glyphs : clear
      for (const [x, y] of read)
        worst = Math.min(worst, contrastRatio(pixel(inked, x, y), pixel(under, x, y)))
      const any = read.length > 0
      if (any) return 'read'
      return 'unread'
    })
    if (lines.includes('unread')) return { node, reading: { is: 'unread' } as const }
    if (lines.includes('read')) return { node, reading: { is: 'read', ratio: worst } as const }
    if (lines.includes('covered')) return { node, reading: { is: 'covered' } as const }
    return { node, reading: { is: 'not-drawn' } as const }
  })
}

/** How an element's first direct piece of text reads where it is drawn. */
export async function readsAt(el: Element): Promise<Reading> {
  const node = [...el.childNodes].find(
    (n): n is Text => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
  )
  if (!node) return { is: 'not-drawn' }
  const all = await paintedReadings(el)
  return all.find((one) => one.node === node)?.reading ?? { is: 'not-drawn' }
}

/** The colour shown just inside `el`'s top-left corner, read from the window with text hidden. */
export async function shownUnder(el: Element): Promise<Rgba> {
  const hide = document.createElement('style')
  hide.textContent = HIDE_INK
  document.head.append(hide)
  let pic: Picture
  try {
    pic = await shot()
  } finally {
    hide.remove()
  }
  const box = el.getBoundingClientRect()
  return pixel(pic, box.left + 4, box.top + 4)
}
