import { expect } from 'vitest'
import { visible as shown } from './harness'

/**
 * 🔴 **531 · what a browser actually DREW, as against what the element HOLDS.**
 *
 * ⛔ **`textContent` is identical whether a browser drew a string or clipped it**, and before this
 * module every assertion this app made about a bounded row read `textContent`. ⚠️ `530` measured
 * one row — *May start conversations as: none* wanted 148.6 px of ink in a 131 px column,
 * ellipsized at the LABEL, and **four suites were green over it** — and `531` is that finding's
 * general class.
 *
 * ⚑ **One helper, not a line copied into each suite** (`169`). The technique is `530`'s; what is
 * new is that it is addressed to an ELEMENT rather than to a hand-picked pair of numbers, that it
 * names WHICH box did the cutting, and that it separates three facts a single boolean was
 * conflating — see {@link ClipKind} and {@link Reach}.
 *
 * ---
 *
 * ## ⚑ What it measures
 *
 * **The ink, against the innermost box that could cut it.** {@link inkRects} takes a `Range` over
 * the element's contents, which is the geometry of the TEXT rather than of the element — a block
 * whose `nowrap` line runs past its own edge reports its own box either way, and the range does
 * not.
 *
 * ⚠️ **Why not `scrollWidth > clientWidth` alone**, which is the usual shape and the one `530`
 * used: `clientWidth` is **0 on a non-replaced inline element**, so the same line of code silently
 * answers *not clipped* for every `<span>` in this app. ⛔ A sensor that returns the safe answer
 * for the commonest element in a rail row is worse than no sensor. The scroll pair is still read
 * and still reported — {@link Clip.selfOverflowPx} — but it is corroboration, not the verdict.
 *
 * ⚑ **`text-overflow: ellipsis` is a PAINT-time effect**, so the overflowing inline boxes are laid
 * out past the edge and the range sees them. ⚑ **`-webkit-line-clamp` is the same on the y axis.**
 *
 * ## 🔴 The three separations, each of which was a false reading before it existed
 *
 * 1. ⛔ **The INNERMOST clipper decides, per axis.** A paragraph inside a sheet body that scrolls,
 *    inside a sheet root that is `overflow: hidden`, is **reachable** — the outer box clips the
 *    SCROLLER's viewport, not the text. ⚠️ Walking every clipper and taking the worst reported
 *    every paragraph of `CapabilitiesSheet` below its own fold as unreachable when a person only
 *    has to scroll.
 * 2. ⛔ **Half-leading is not a cut** ({@link Y_TOLERANCE_OF_A_LINE}). An inline box is taller than
 *    a `line-height` below ~1.2, so `h1 { line-height: var(--leading-tight) }` overflows its own
 *    `overflow: hidden` by 1 px on every title in this app. ⚠️ A y cut counts when it hides a real
 *    part of a line.
 *
 * ⚑ **Measured together.** Without the three, the same sweep reported every `--leading-tight`
 * heading in this app, every paragraph below a sheet's own fold, and every accessible-name band
 * as text a person cannot read. ⛔ They are separations in the SENSOR rather than exceptions in
 * each caller because each is a property of the engine, not of a surface — and §0 of
 * `every-string-a-rail-row-does-not-draw.dom.test.ts` plants each one, with a case that must NOT
 * match beside it.
 * 3. ⛔ **A box 1 px across is an accessible name, not a clipped string** ({@link ClipKind}).
 *    `.only-for-a-reader` is `width: 1px; height: 1px; clip-path: inset(50%)` in two components,
 *    and it is doing exactly what it should.
 *
 * ---
 *
 * ## ⛔ What it cannot do
 *
 * 1. ⛔ **It cannot say WHICH characters were dropped** — only that ink fell outside a box, and by
 *    how many px. No API returns the drawn substring.
 * 2. ⛔ **It is blind to text invisible for non-geometric reasons.** `visibility: hidden`,
 *    `opacity: 0`, ink the colour of its ground and `content-visibility` all leave the geometry
 *    exactly as it was — that is `harness.ts`'s `visible` and `paintedInk`, and a surface that
 *    matters needs both sensors, not this one.
 * 3. ⚠️ **A clipper BELOW the element is not walked.** Point it at the element inside the scroller;
 *    {@link containsItsOwnClipper} answers whether that is the case, so the limit is loud.
 * 4. ⚠️ **Scrollbar width differs between this runner and the product** —
 *    `the-dom-runner-draws-overlay-scrollbars`: 11 px in the Electron window, 0 px here. ⛔ That
 *    moves the content box of an `auto`/`scroll` clipper by up to 11 px, so a `by-scrolling`
 *    verdict within 11 px of the edge is this runner's answer and not the product's. ⚑ **`hidden`
 *    and `clip` draw no scrollbar in either**, so a `never` verdict is the same number in both —
 *    which is the verdict {@link cutsOf} is built on.
 * 5. ⛔ **`mask`, `transform` and an ancestor scrolled away are not modelled.** `clip-path` is read
 *    only as the reader-only signal in (3) above, never as a geometry.
 * 5b. 🔴 **Pass the mount host as `boundary`.** The default is `document.body`, and in THIS app
 *    `base.css` gives `html, body` `overflow: hidden` on purpose — *"whatever falls off the right
 *    edge is not behind a scrollbar, it is nowhere"* — so the default boundary is itself a `never`
 *    clipper and anything below the page fold reads `out-of-view`. ⚑ {@link sweep} always passes
 *    the host; a bare `assertDrawn(el, what)` on a tall page does not.
 * 6. ⚠️ **It measures ONE frame.** A transition still running measures mid-flight — settle first.
 * 7. 🔴 **It is only as right as the font that resolved.** Inter is a bundled `@font-face` and
 *    loads asynchronously, so a measurement taken before it arrives is the fallback's metrics.
 *    {@link drawnReady} is the await, and every entry point here refuses to run until the face is
 *    really loaded rather than trusting the caller.
 * 8. 🔴 **A COUNT of cuts over a fixed-height mount is not a score, and this one bites.** ⛔ Make a
 *    row taller and the rows under it leave the visible region of a 900 px test box; this sensor
 *    then classifies them `out-of-view` — correctly — and a sweep that counts `cut` reports a
 *    smaller number for a change that repaired none of them. ⚠️ **Measured at `531`**: the repair
 *    took the whole-project sweep from 84 carriers to 74, and only **four** of the ten were
 *    repairs. ⚑ Compare per carrier, never by total, and measure a surface at the width AND the
 *    height it ships at.
 */

/** The axis a cut happened on. */
export type Axis = 'x' | 'y'

/**
 * ⛔ **Whether any gesture brings the rest of the string on screen.** `hidden`/`clip` is `never` —
 * the text is in the DOM and no person will ever read it. `auto`/`scroll` is `by-scrolling`, which
 * is a different (and usually acceptable) fact about a surface.
 */
export type Reach = 'never' | 'by-scrolling'

/**
 * 🔴 **Three different facts, and collapsing them is what made the first sweep unreadable.**
 *
 * - `cut` — the ink **crosses** the clipper's edge: a person reads the first part of this string
 *   and not the rest. ⛔ **This is the defect class `530` found**, and the one an assertion reading
 *   `textContent` is blind to, because the element still holds every character.
 * - `out-of-view` — ink and visible box do not overlap at all: the element is below the fold of a
 *   scroller, or inside a disclosure collapsed to zero. ⚑ Nothing is mis-drawn; it is not on
 *   screen yet, and `harness.ts`'s `visible` is the sensor for whether that is intended.
 * - `for-a-reader-only` — the clipper's visible box is at most 1 px across, or it carries a
 *   `clip-path`. ⚑ That is the accessible-name pattern (`.only-for-a-reader`), where nothing being
 *   drawn is the entire point.
 */
export type ClipKind = 'cut' | 'out-of-view' | 'for-a-reader-only'

export interface Clip {
  /** The axis the ink ran off. */
  readonly axis: Axis
  /** Whether a person reads PART of this string, none of it, or it is a reader-only box. */
  readonly kind: ClipKind
  /** Whether a person could scroll to the rest of it. */
  readonly reach: Reach
  /** The innermost box that cut this ink on this axis — the element itself, or an ancestor. */
  readonly by: HTMLElement
  /** That box's `data-cy`, when it has one, so a failure names something greppable. */
  readonly byCy: string | null
  /** The computed `overflow-x`/`overflow-y` of the clipper on this axis. */
  readonly mode: string
  /** How far past the clipper's content box the furthest ink rect reached, in px. */
  readonly overflowPx: number
  /**
   * ⚑ **`scrollWidth − clientWidth` of the clipper** (or the height pair on `y`) — `530`'s own
   * measure, kept as corroboration. ⚠️ `0` on a non-replaced inline clipper, where the pair cannot
   * answer; the verdict above never depends on it.
   */
  readonly selfOverflowPx: number
}

/** Sub-pixel layout rounds, and half a pixel is not a cut string. */
const TOLERANCE_PX = 0.5

/**
 * ⛔ **The half-leading floor, as a fraction of the line's OWN height.** An inline box is the
 * font's em box plus its leading, which is taller than a `line-height` under about 1.2 — so every
 * `--leading-tight` heading in this app overflows its own `overflow: hidden` by about a pixel and
 * loses not one glyph. ⚑ A quarter of a line is well above that and well below a hidden line.
 */
const Y_TOLERANCE_OF_A_LINE = 0.25

/** The overflow values that cut, and what a person can do about each. */
const REACH_OF: Readonly<Record<string, Reach>> = {
  hidden: 'never',
  clip: 'never',
  scroll: 'by-scrolling',
  auto: 'by-scrolling',
  overlay: 'by-scrolling',
}

/**
 * 🔴 **Await this before measuring anything.** Inter is a bundled `@font-face`; until it has
 * loaded, every width on the page is the fallback's.
 *
 * ⚠️ **Two awaits and not one.** `document.fonts.ready` settles the face; the frame after it is
 * when the engine has re-laid-out with the real metrics. Measuring between the two reads the old
 * boxes.
 */
export async function drawnReady(): Promise<void> {
  // ⛔ **Ask for the face, do not merely wait for whatever is already in flight.** A `@font-face`
  // loads when something on the page USES it, so `document.fonts.ready` resolves immediately —
  // and truthfully — on a page that has not drawn any Inter yet. ⚠️ A sweep whose first mount is
  // also the first Inter on the page would then measure the fallback's metrics and call them the
  // product's.
  await document.fonts.load('10px Inter')
  await document.fonts.ready
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

/**
 * ⛔ **The guard that makes limit 7 loud.** If Inter is not here, every number below is the
 * fallback's and the failure it would produce is a lie about the product.
 */
function refuseUnlessTheFontIsHere(): void {
  // ⛔ **`check` alone is not the question.** Per spec it answers *is anything still LOADING for
  // this list*, and a family the page never registered has nothing loading — so `check` returns
  // `true` on a page with no `@font-face` at all, which is the one case the guard exists for.
  // ⚑ So the face has to be in the set as well. Found in review.
  let registered = false
  document.fonts.forEach((face) => {
    if (face.family.replace(/['"]/g, '') === 'Inter') registered = true
  })
  if (!registered || !document.fonts.check('10px Inter')) {
    throw new Error(
      'drawn.ts: Inter has not loaded, so every width here would be the fallback’s — ' +
        'await drawnReady() after mounting',
    )
  }
}

/** The visible content box of a clipper, in viewport coordinates — padding box minus scrollbars. */
function contentBox(el: HTMLElement): { left: number; right: number; top: number; bottom: number } {
  const rect = el.getBoundingClientRect()
  // `clientLeft`/`clientTop` are the border widths; `clientWidth`/`clientHeight` are the padding
  // box minus any scrollbar — precisely the region the engine paints into.
  const left = rect.left + el.clientLeft
  const top = rect.top + el.clientTop
  return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight }
}

/**
 * ⚑ **The ink, not the box.** A `Range` over the element's contents reports the inline boxes the
 * engine actually laid the text into — the only geometry that answers the question for a `<span>`
 * (whose `clientWidth` is 0) and for a block whose `nowrap` line runs past its own edge (whose
 * `getBoundingClientRect` is the containing width either way).
 *
 * ⚠️ **Zero-area rects are dropped.** An empty text node and a collapsed whitespace node each
 * produce one, at the start edge — where they read as ink inside the box and make an element with
 * no text at all look measured.
 */
export function inkRects(el: HTMLElement | Text): DOMRect[] {
  // ⚠️ **The guard is here and not only in `clipsOf`.** These are exported entry points; a caller
  // measuring a width through them before the face arrived would get the fallback's metrics and
  // limit 7 would be a sentence the module does not keep. Found in review.
  refuseUnlessTheFontIsHere()
  const range = document.createRange()
  range.selectNodeContents(el)
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
  range.detach()
  return rects
}

/**
 * The boxes of a text's words: each run of characters other than white space, a box per line it is
 * laid on. A line box none of these meets holds white space alone.
 */
export function wordRects(node: Text): DOMRect[] {
  refuseUnlessTheFontIsHere()
  const range = document.createRange()
  const out: DOMRect[] = []
  for (const word of node.data.matchAll(/\S+/g)) {
    range.setStart(node, word.index)
    range.setEnd(node, word.index + word[0].length)
    out.push(...[...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0))
  }
  range.detach()
  return out
}

/**
 * ⚑ **How many LINES the engine laid this text into**, which is not how many rects the range
 * returned: a `<small>` holding two text nodes and a `<template>` gives three rects on one line.
 * ⛔ Distinct top edges, rounded, because a superscript or a smaller sibling shifts a rect by a
 * fraction without starting a new line.
 */
export function lineCount(el: HTMLElement): number {
  return new Set(inkRects(el).map((r) => Math.round(r.top))).size
}

/** Does this element hold a scroller of its own — which this helper does NOT walk into (limit 3). */
export function containsItsOwnClipper(el: HTMLElement): HTMLElement | null {
  for (const node of el.querySelectorAll<HTMLElement>('*')) {
    // ⚠️ **Only a clipper with text in it.** Every icon in this app is an `<svg>` with
    // `overflow: hidden`, so a version that answered on geometry alone said *yes* for every row
    // in the rail and limit 3 was permanently on. Found in review.
    if (!(node.textContent ?? '').trim()) continue
    const style = getComputedStyle(node)
    if (REACH_OF[style.overflowX] || REACH_OF[style.overflowY]) return node
  }
  return null
}

/**
 * Every box that is cutting this element's text — **at most one per axis**, the innermost.
 *
 * @param el the element whose TEXT is in question
 * @param boundary the outermost node to walk to, inclusive — the mount host, normally. The walk
 *   stops at `document.body` in any case.
 */
export function clipsOf(el: HTMLElement, boundary: HTMLElement = document.body): Clip[] {
  refuseUnlessTheFontIsHere()
  const rects = inkRects(el)
  if (rects.length === 0) return []

  const found: Clip[] = []
  const settled = new Set<Axis>()
  let node: HTMLElement | null = el
  while (node) {
    const style = getComputedStyle(node)
    const box = contentBox(node)
    for (const axis of ['x', 'y'] as const) {
      // ⛔ **Separation 1.** Once an axis has been decided by an inner box, every box outside it is
      // clipping that box and not this text.
      if (settled.has(axis)) continue
      const mode = axis === 'x' ? style.overflowX : style.overflowY
      const reach = REACH_OF[mode]
      if (!reach) continue
      const over =
        axis === 'x'
          ? Math.max(0, ...rects.map((r) => Math.max(box.left - r.left, r.right - box.right)))
          : Math.max(0, ...rects.map((r) => Math.max(box.top - r.top, r.bottom - box.bottom)))
      // ⛔ **Separation 2**, on the y axis only: the x advance width of an inline box is exact.
      // ⚠️ **The SMALLEST rect, not the tallest.** A rect is not always a line of text — an inline
      // image or a larger sibling on the same line produces a tall one — and taking the tallest
      // would raise the floor for every line beside it and mask a real cut. Found in review.
      const line = Math.min(...rects.map((r) => r.height))
      const floor =
        axis === 'y' ? Math.max(TOLERANCE_PX, line * Y_TOLERANCE_OF_A_LINE) : TOLERANCE_PX
      if (over <= floor) continue
      settled.add(axis)
      // ⛔ **Separation 3.** A box this size is an accessible name; nothing being drawn is the point.
      // ⚠️ **From the rect, not from `clientWidth`** — which is 0 on a non-replaced inline and
      // would file every inline clipper as an accessible name, re-importing the exact blindness
      // this module exists to avoid. Found in review.
      const own = node.getBoundingClientRect()
      const size = axis === 'x' ? own.width : own.height
      // ⚑ **Does ANY ink share space with the visible box?** If none does, the element is not being
      // mis-drawn — it is out of view, which is a scroller doing its job or a shut disclosure.
      const overlaps = rects.some((r) =>
        axis === 'x'
          ? r.right > box.left + TOLERANCE_PX && r.left < box.right - TOLERANCE_PX
          : r.bottom > box.top + TOLERANCE_PX && r.top < box.bottom - TOLERANCE_PX,
      )
      const kind: ClipKind =
        size <= 1 || style.clipPath !== 'none'
          ? 'for-a-reader-only'
          : overlaps
            ? 'cut'
            : 'out-of-view'
      found.push({
        axis,
        kind,
        reach,
        by: node,
        byCy: node.dataset.cy ?? null,
        mode,
        overflowPx: Number(over.toFixed(2)),
        selfOverflowPx:
          axis === 'x'
            ? Math.max(0, node.scrollWidth - node.clientWidth)
            : Math.max(0, node.scrollHeight - node.clientHeight),
      })
    }
    if (node === boundary || settled.size === 2) break
    node = node.parentElement
  }
  return found
}

/**
 * 🔴 **The defect class, on its own.** ⛔ *Some of this string is drawn, the rest is not, and no
 * gesture brings the rest back* — which is exactly what `textContent` cannot tell you and what
 * `531`'s enumeration found assertions passing over.
 */
export function cutsOf(el: HTMLElement, boundary?: HTMLElement): Clip[] {
  return clipsOf(el, boundary).filter((c) => c.kind === 'cut' && c.reach === 'never')
}

/**
 * 🔴 **Everything a person cannot read here: the part that was cut AND the whole that was never
 * drawn.**
 *
 * ⛔ **`cutsOf` alone was a hole and `531`'s own repair walked into it.** Make a row taller and the
 * rows under it leave a fixed-height box; the sensor then says `out-of-view` — correctly — and an
 * assertion built on `cut` alone goes GREEN for a string of which **nothing at all** is on
 * screen. ⚑ Found in review of this dispatch, which is also how limit 8 came to be written.
 *
 * ⚠️ **`out-of-view` with `reach: 'by-scrolling'` is NOT here.** Below the fold of a scroller is
 * where most of a list lives, and it is not a defect.
 */
export function notDrawn(el: HTMLElement, boundary?: HTMLElement): Clip[] {
  return clipsOf(el, boundary).filter((c) => c.reach === 'never')
}

/** Was every character of this element's text drawn, by the {@link cutsOf} reading? */
export function drawnInFull(el: HTMLElement, boundary?: HTMLElement): boolean {
  return cutsOf(el, boundary).length === 0
}

/**
 * ⚠️ **Is the whole string recoverable from a `title` on this element or on an ancestor?**
 *
 * ⛔ **The line between a layout decision and a lost sentence.** ⚑ An ancestor counts, because a
 * tooltip on the row is what a person's pointer actually lands on.
 *
 * ⚠️ **Derived, because the number in the comment this replaced was not**: **24 components in
 * this tree carry a `title` alongside a clipping declaration** — grep `:?title="` against the
 * category `every-assertion-that-reads-clipped-text.test.ts` defines. ⛔ `530`'s comment and the
 * first draft of `531`'s both said *fourteen*, restated from an older count, which is
 * `a-number-can-survive-the-death-of-its-derivation`.
 */
export function titleRecovers(el: HTMLElement, boundary: HTMLElement = document.body): boolean {
  const want = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!want) return false
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const title = node.title.replace(/\s+/g, ' ').trim()
    // ⛔ **An ANCESTOR's title has to be about this text, not merely contain it.** A `<span>`
    // reading `codex` sits inside a row whose title is a path with `codex` in it, and a bare
    // `includes` called that a recovery. ⚑ On the element itself a substring is enough — the
    // title is about that element by construction. Found in review.
    if (title && title.includes(want) && (node === el || want.length >= 8)) return true
    if (node === boundary) break
  }
  return false
}

/** A one-line description of a cut, for a failure message that names something greppable. */
export function describeClip(clip: Clip): string {
  const where = clip.byCy ? `[data-cy="${clip.byCy}"]` : `<${clip.by.tagName.toLowerCase()}>`
  return `${clip.kind} on ${clip.axis}: ${clip.overflowPx}px past ${where} (overflow-${clip.axis}: ${clip.mode}, ${clip.reach})`
}

/**
 * ⛔ **The assertion the app was missing.** *This string was DRAWN*, rather than *this element
 * holds this string*.
 *
 * ⚠️ **It reports the text it is about**, truncated, because a failure that names only a selector
 * sends the reader back to the fixture to find out what was cut.
 */
export function assertDrawn(el: HTMLElement, what: string, boundary?: HTMLElement): void {
  const clips = notDrawn(el, boundary)
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const shown = text.length > 60 ? `${text.slice(0, 57)}…` : text
  expect(
    clips.map(describeClip),
    `${what} was not drawn in full — “${shown}” · ${clips.map(describeClip).join(' · ')}`,
  ).toEqual([])
}

/**
 * ⚑ **The positive control, and every roster needs one**
 * (`a-positive-assertion-must-differ-from-the-default`). ⛔ *Nothing is cut* is only a measurement
 * if something on the same page CAN be cut and this sensor says so.
 */
export function assertClipped(el: HTMLElement, what: string, boundary?: HTMLElement): Clip {
  const clips = cutsOf(el, boundary)
  expect(clips.length, `${what} was expected to be cut and was drawn in full`).toBeGreaterThan(0)
  return clips[0] as Clip
}

/**
 * ⚠️ **Cut, and the whole string still reachable on a `title`.** ⛔ A cut WITHOUT one is a sentence
 * a person cannot get to; a cut WITH one is a layout decision.
 */
export function assertClippedButTold(el: HTMLElement, what: string, boundary?: HTMLElement): void {
  assertClipped(el, what, boundary)
  expect(titleRecovers(el, boundary), `${what} is cut and no title recovers it`).toBe(true)
}

/* ------------------------------------------------------------------ sweeping a surface */

export interface Carrier {
  /** The element's own `data-cy`, or the nearest hooked ancestor's, so a failure names something. */
  readonly cy: string
  /** What the element holds, whitespace-collapsed the way a person would read it. */
  readonly text: string
  /**
   * The innermost verdict a person cannot get past, or `null` when every character was drawn.
   *
   * ⛔ **{@link notDrawn} and not {@link cutsOf}**: a line whose ink lands entirely outside a
   * `hidden` box is `out-of-view`, not `cut`, and a sweep built on `cut` alone reported `null` —
   * *drawn in full* — for a string of which nothing at all is painted. Found in review.
   */
  readonly cut: Clip | null
  /** Whether a `title` here or on an ancestor carries the whole string back. */
  readonly recovered: boolean
  readonly el: HTMLElement
}

/**
 * 🔴 **Every string a mounted surface DREW, with the verdict on each.** ⛔ This is the shape that
 * found `531`'s class: an assertion per line only ever covers the lines somebody already
 * suspected, and all three of the sentences repaired at `531` were read by suites that were green.
 *
 * ⚠️ **Own text, not descendant text.** An element whose text is entirely its children's would be
 * measured again at every level up the tree and the same cut reported five times under five names.
 *
 * ⚠️ **Invisible elements are skipped** — `harness.ts`'s `visible`, which is the engine's own
 * answer. A shut disclosure holds strings nobody is drawing yet and they are not this sensor's.
 */
export function sweep(host: HTMLElement): Carrier[] {
  const out: Carrier[] = []
  for (const el of host.querySelectorAll<HTMLElement>('*')) {
    const own = [...el.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join('')
      .trim()
    if (!own || !shown(el)) continue
    out.push({
      cy: el.dataset.cy ?? el.closest<HTMLElement>('[data-cy]')?.dataset.cy ?? '(no data-cy)',
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      cut: notDrawn(el, host)[0] ?? null,
      recovered: titleRecovers(el, host),
      el,
    })
  }
  return out
}

/** One line for a failure message: what was cut, where, and how much of it. */
export function describeCarrier(c: Carrier): string {
  const text = c.text.length > 60 ? `${c.text.slice(0, 57)}…` : c.text
  return `${c.cy} :: ${text}${c.cut ? ` · ${describeClip(c.cut)}` : ''}`
}
