/**
 * Colours for themes: parsing what a theme file may write, writing it back in one canonical form,
 * and the maths the contrast check needs — oklab and sRGB mixing as CSS `color-mix()` does it,
 * compositing a translucent colour over an opaque one, and the WCAG contrast ratio.
 *
 * Nothing a theme writes reaches CSS as typed: every colour is parsed into numbers here and written
 * back as `#rrggbb` or `#rrggbbaa`.
 */

/** Red, green and blue in 0–255; alpha in 0–1. */
export interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`

/** `n`, `n%`, or `ndeg`; returns the number and its unit. */
function token(text: string): { n: number; unit: '' | '%' | 'deg' } | null {
  const m = new RegExp(`^(${NUMBER})(%|deg)?$`, 'i').exec(text.trim())
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return { n, unit: (m[2]?.toLowerCase() ?? '') as '' | '%' | 'deg' }
}

/** Splits `rgb(1 2 3 / 50%)` or `rgb(1, 2, 3, 0.5)` into its parts and its alpha. */
function argumentsOf(body: string): { parts: string[]; alpha: string | null } | null {
  const [main, alpha, extra] = body.split('/')
  if (extra !== undefined || main === undefined) return null
  const parts = main.includes(',') ? main.split(',') : main.trim().split(/\s+/)
  const cleaned = parts.map((p) => p.trim()).filter((p) => p !== '')
  if (alpha !== undefined) {
    if (cleaned.length !== 3) return null
    return { parts: cleaned, alpha: alpha.trim() }
  }
  if (cleaned.length === 4) return { parts: cleaned.slice(0, 3), alpha: cleaned[3]! }
  if (cleaned.length === 3) return { parts: cleaned, alpha: null }
  return null
}

function alphaOf(text: string | null): number | null {
  if (text === null) return 1
  const t = token(text)
  if (!t || t.unit === 'deg') return null
  return clamp(t.unit === '%' ? t.n / 100 : t.n, 0, 1)
}

function fromHex(hex: string): Rgba | null {
  const h = hex.slice(1)
  if (!/^[0-9a-f]+$/i.test(h) || ![3, 4, 6, 8].includes(h.length)) return null
  const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h
  const byte = (i: number): number => parseInt(full.slice(i * 2, i * 2 + 2), 16)
  return { r: byte(0), g: byte(1), b: byte(2), a: full.length === 8 ? byte(3) / 255 : 1 }
}

function fromRgb(body: string): Rgba | null {
  const args = argumentsOf(body)
  if (!args) return null
  const channels = args.parts.map(token)
  if (channels.some((c) => !c || c.unit === 'deg')) return null
  const [r, g, b] = channels.map((c) => clamp(c!.unit === '%' ? (c!.n / 100) * 255 : c!.n, 0, 255))
  const a = alphaOf(args.alpha)
  return a === null ? null : { r: r!, g: g!, b: b!, a }
}

function fromHsl(body: string): Rgba | null {
  const args = argumentsOf(body)
  if (!args) return null
  const [h, s, l] = args.parts.map(token)
  if (!h || !s || !l || h.unit === '%' || s.unit === 'deg' || l.unit === 'deg') return null
  const hue = (((h.n % 360) + 360) % 360) / 360
  const sat = clamp(s.n / 100, 0, 1)
  const light = clamp(l.n / 100, 0, 1)
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat
  const p = 2 * light - q
  const channel = (t0: number): number => {
    const t = t0 < 0 ? t0 + 1 : t0 > 1 ? t0 - 1 : t0
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const a = alphaOf(args.alpha)
  if (a === null) return null
  return { r: channel(hue + 1 / 3) * 255, g: channel(hue) * 255, b: channel(hue - 1 / 3) * 255, a }
}

function fromOklch(body: string): Rgba | null {
  const args = argumentsOf(body)
  if (!args) return null
  const [l, c, h] = args.parts.map(token)
  if (!l || !c || !h || l.unit === 'deg' || c.unit === 'deg' || h.unit === '%') return null
  const L = l.unit === '%' ? l.n / 100 : l.n
  const C = c.unit === '%' ? (c.n / 100) * 0.4 : c.n
  const angle = (h.n * Math.PI) / 180
  const a = alphaOf(args.alpha)
  if (a === null) return null
  return fromOklab({ L: clamp(L, 0, 1), a: C * Math.cos(angle), b: C * Math.sin(angle) }, a)
}

/**
 * Reads a colour a theme may write: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`,
 * `hsl()`/`hsla()`, `oklch()` with plain numbers, or `transparent`. Anything else — a name, a
 * `var()`, a `color-mix()`, a url — is `null`.
 */
export function parseColour(text: unknown): Rgba | null {
  if (typeof text !== 'string' || text.length > 64) return null
  const t = text.trim().toLowerCase()
  if (t === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (t.startsWith('#')) return fromHex(t)
  const m = /^(rgba?|hsla?|oklch)\(([^()]*)\)$/.exec(t)
  if (!m) return null
  const fn = m[1]!
  const body = m[2]!
  if (fn.startsWith('rgb')) return fromRgb(body)
  if (fn.startsWith('hsl')) return fromHsl(body)
  return fromOklch(body)
}

const hex2 = (v: number): string =>
  Math.round(clamp(v, 0, 255))
    .toString(16)
    .padStart(2, '0')

/** The one form a theme colour reaches CSS in: `#rrggbb`, or `#rrggbbaa` when not opaque. */
export function colourCss(c: Rgba): string {
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`
  const alpha = Math.round(clamp(c.a, 0, 1) * 255)
  return alpha === 255 ? base : `${base}${hex2(alpha)}`
}

// ---- oklab ----

interface Oklab {
  readonly L: number
  readonly a: number
  readonly b: number
}

const toLinear = (v: number): number => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const fromLinear = (c: number): number =>
  255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function toOklab(c: Rgba): Oklab {
  const r = toLinear(c.r)
  const g = toLinear(c.g)
  const b = toLinear(c.b)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

function fromOklab(o: Oklab, alpha: number): Rgba {
  const l = (o.L + 0.3963377774 * o.a + 0.2158037573 * o.b) ** 3
  const m = (o.L - 0.1055613458 * o.a - 0.0638541728 * o.b) ** 3
  const s = (o.L - 0.0894841775 * o.a - 1.291485548 * o.b) ** 3
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return {
    r: clamp(fromLinear(clamp(r, 0, 1)), 0, 255),
    g: clamp(fromLinear(clamp(g, 0, 1)), 0, 255),
    b: clamp(fromLinear(clamp(b, 0, 1)), 0, 255),
    a: alpha,
  }
}

/**
 * `color-mix(in oklab, a p%, b)`: `p` is a's share, 0–100. Like the engine, it interpolates
 * premultiplied by alpha, so a transparent side lends no hue.
 */
export function mixOklab(a: Rgba, p: number, b: Rgba): Rgba {
  const w = clamp(p, 0, 100) / 100
  const alpha = a.a * w + b.a * (1 - w)
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const A = toOklab(a)
  const B = toOklab(b)
  const mix = (x: number, y: number): number => (x * a.a * w + y * b.a * (1 - w)) / alpha
  return fromOklab({ L: mix(A.L, B.L), a: mix(A.a, B.a), b: mix(A.b, B.b) }, alpha)
}

/**
 * `color-mix(in srgb, a p%, b)`: `p` is a's share, 0–100. Each channel is mixed as written, in
 * sRGB, premultiplied by alpha as the engine does.
 */
export function mixSrgb(a: Rgba, p: number, b: Rgba): Rgba {
  const w = clamp(p, 0, 100) / 100
  const alpha = a.a * w + b.a * (1 - w)
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const mix = (x: number, y: number): number => (x * a.a * w + y * b.a * (1 - w)) / alpha
  return { r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b), a: alpha }
}

/** A colour painted over an opaque one, as the screen shows it. */
export function over(top: Rgba, under: Rgba): Rgba {
  const a = clamp(top.a, 0, 1)
  return {
    r: top.r * a + under.r * (1 - a),
    g: top.g * a + under.g * (1 - a),
    b: top.b * a + under.b * (1 - a),
    a: 1,
  }
}

/** WCAG relative luminance of an opaque colour. */
export function luminance(c: Rgba): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b)
}

/** WCAG contrast ratio of ink over an opaque background; a translucent ink is composited first. */
export function contrastRatio(ink: Rgba, background: Rgba): number {
  const bg = { ...background, a: 1 }
  const fg = over(ink, bg)
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** `oklch(from c l calc(c * k) h)`: the same lightness and hue, `k` times the chroma. */
export function scaleChroma(c: Rgba, k: number): Rgba {
  const o = toOklab(c)
  return fromOklab({ L: o.L, a: o.a * k, b: o.b * k }, c.a)
}
