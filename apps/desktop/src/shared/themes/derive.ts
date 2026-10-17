/**
 * How the window works semantic colours out of a theme's seeds, as numbers the contrast check can
 * compute. tokens.css writes the same formulas as `color-mix()`; a test keeps the two equal, so
 * what the validator measures is what the window paints.
 *
 * Every entry is `color-mix(in <space>, <a> <amount>, <b>)` for one zone (frame or content), where
 * `a` and `b` are that zone's ink, paper or accent, the derived page, or transparent.
 */
import { mixOklab, scaleChroma, type Rgba } from './colour'

/** A zone's seeds: three colours and the shared proportions, in percent. */
export interface ZoneSeeds {
  readonly ink: Rgba
  readonly paper: Rgba
  readonly accent: Rgba
  readonly page: number
  readonly line: number
  readonly tint: number
  readonly shadow: number
  /** What shadows are made of: the theme's shadow colour, else black on the frame and ink on content. */
  readonly shadowColour?: Rgba
}

type Source = 'ink' | 'paper' | 'accent' | 'shadow' | 'transparent'
/** A fixed percentage, or a shared proportion times a factor plus an offset. */
type Amount =
  | { readonly fixed: number }
  | {
      readonly of: 'page' | 'line' | 'tint' | 'shadow'
      readonly times: number
      readonly plus?: number
    }

export interface Derivation {
  readonly a: Source
  readonly amount: Amount
  readonly b: Source
  readonly space: 'oklab' | 'srgb'
}

const oklab = (a: Source, amount: Amount, b: Source): Derivation => ({
  a,
  amount,
  b,
  space: 'oklab',
})
const srgb = (a: Source, amount: Amount, b: Source): Derivation => ({ a, amount, b, space: 'srgb' })
const fixed = (n: number): Amount => ({ fixed: n })
const of = (k: 'page' | 'line' | 'tint' | 'shadow', times = 1, plus = 0): Amount => ({
  of: k,
  times,
  plus,
})

/** Semantic colour → its formula, in both zones. */
export const DERIVATION = {
  'paper-bg': oklab('ink', of('page'), 'paper'),
  'drawer-bg': oklab('ink', of('page', 1, 2), 'paper'),
  panel: oklab('ink', fixed(0), 'paper'),
  'panel-2': oklab('ink', fixed(3), 'paper'),
  'panel-3': oklab('ink', fixed(9), 'paper'),
  line: oklab('ink', of('line'), 'paper'),
  'line-strong': oklab('ink', of('line', 1.7), 'paper'),
  text: oklab('ink', fixed(100), 'paper'),
  'text-soft': oklab('ink', fixed(85), 'paper'),
  muted: oklab('ink', fixed(76), 'paper'),
  faint: oklab('ink', fixed(72), 'paper'),
  'accent-text': oklab('accent', fixed(80), 'ink'),
  'accent-fill': oklab('accent', of('tint'), 'paper'),
  'accent-fill-weak': oklab('accent', of('tint', 0.7), 'paper'),
  'accent-fill-strong': oklab('accent', of('tint', 1.6), 'paper'),
  'accent-border': oklab('accent', of('tint', 3.5), 'paper'),
  'accent-border-weak': oklab('accent', of('tint', 2.2), 'paper'),
  'focus-ring-color': oklab('accent', fixed(100), 'paper'),
  'selection-bg': srgb('accent', fixed(22), 'transparent'),
  'accent-glow': srgb('accent', fixed(14), 'transparent'),
  'accent-glow-weak': srgb('accent', fixed(10), 'transparent'),
  'shadow-card-near': srgb('shadow', of('shadow', 1.1), 'transparent'),
  'shadow-card-far': srgb('shadow', of('shadow'), 'transparent'),
  'shadow-menu': srgb('shadow', of('shadow', 1.5), 'transparent'),
  'shadow-dialog': srgb('shadow', of('shadow', 2.2), 'transparent'),
} as const satisfies Record<string, Derivation>

export type DerivedName = keyof typeof DERIVATION
export type DerivedZone = Readonly<Record<DerivedName, Rgba>>

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 }

/** `color-mix(in srgb, a p%, b)`, premultiplied as the engine does it. */
export function mixSrgb(a: Rgba, p: number, b: Rgba): Rgba {
  const w = Math.min(100, Math.max(0, p)) / 100
  const alpha = a.a * w + b.a * (1 - w)
  if (alpha === 0) return TRANSPARENT
  const mix = (x: number, y: number): number => (x * a.a * w + y * b.a * (1 - w)) / alpha
  return { r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b), a: alpha }
}

function amountOf(amount: Amount, seeds: ZoneSeeds): number {
  if ('fixed' in amount) return amount.fixed
  return seeds[amount.of] * amount.times + (amount.plus ?? 0)
}

/** Every derived colour of one zone. */
export function deriveZone(seeds: ZoneSeeds): DerivedZone {
  const source = (s: Source): Rgba =>
    s === 'transparent'
      ? TRANSPARENT
      : s === 'shadow'
        ? (seeds.shadowColour ?? seeds.ink)
        : seeds[s]
  const out = {} as Record<DerivedName, Rgba>
  for (const [name, d] of Object.entries(DERIVATION) as [DerivedName, Derivation][]) {
    const p = amountOf(d.amount, seeds)
    out[name] =
      d.space === 'oklab'
        ? mixOklab(source(d.a), p, source(d.b))
        : mixSrgb(source(d.a), p, source(d.b))
  }
  return out
}

/**
 * A status colour on the frame: the content's status colour mixed toward the frame's ink, then
 * given back its colour, so it reads on a dark frame and a light one alike. tokens.css writes it as
 * `oklch(from color-mix(in oklab, <status> 40%, <frame ink>) l calc(c * 2.5) h)`; the frame's second
 * accent is made the same way from the content's.
 */
export const FRAME_STATUS = { mix: 40, chroma: 2.5 } as const

/** The frame's colour for one of the content's status colours. */
export function frameStatus(status: Rgba, frameInk: Rgba): Rgba {
  return scaleChroma(mixOklab(status, FRAME_STATUS.mix, frameInk), FRAME_STATUS.chroma)
}

/** No text in the app is smaller than this, in px. */
export const TYPE_FLOOR = 12

/** The text size and ratio a theme that sets neither gets, as tokens.css declares them. */
export const TYPE_DEFAULTS = { base: 14, ratio: 1.26 } as const

/**
 * Each text role as a power of the ratio around the body size: tokens.css writes
 * `round(<base> × <ratio>^<power>, 1px)` for every role but the body, which is the base itself.
 */
export const TYPE_STEPS = {
  caption: -0.5,
  small: -0.25,
  body: 0,
  reading: 0.25,
  heading: 1,
  title: 2,
  display: 3,
} as const

export type TypeRole = keyof typeof TYPE_STEPS

/**
 * Each text role's size in px, rounded as the window rounds it (to the nearest pixel, a half
 * rounding up), before the window holds it at the floor.
 */
export function typeSizes(base: number, ratio: number): Record<TypeRole, number> {
  const out = {} as Record<TypeRole, number>
  for (const [role, power] of Object.entries(TYPE_STEPS) as [TypeRole, number][]) {
    out[role] = power === 0 ? base : Math.round(base * ratio ** power)
  }
  return out
}
