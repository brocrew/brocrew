/**
 * A theme after validation: every value parsed and written back in one form. Colours are
 * `#rrggbb` or `#rrggbbaa`; numbers are numbers; pictures and fonts are `assets/…` paths that name
 * files the host has checked.
 */

/** One thing wrong with a theme: where, and a sentence a person or an agent can act on. */
export interface ThemeProblem {
  readonly at: string
  readonly says: string
}

/** One layer of a background, painted over the fill's colour; the first layer is on top. */
export type ThemeLayer =
  | {
      readonly image: string
      readonly size?: 'cover' | 'contain' | 'auto' | number | `${number}%`
      readonly position?: ThemePosition
      readonly repeat?: boolean | 'x' | 'y'
      readonly pixelated?: boolean
    }
  | {
      readonly gradient: {
        readonly type: 'linear' | 'radial'
        readonly angle?: number
        readonly stops: readonly { readonly color: string; readonly at: number }[]
      }
    }
  | {
      readonly pattern: {
        readonly kind: 'dots' | 'lines' | 'grid' | 'checker'
        readonly color: string
        readonly size: number
        readonly thickness?: number
        readonly angle?: number
      }
    }

export const THEME_POSITIONS = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top left',
  'top right',
  'bottom left',
  'bottom right',
] as const
export type ThemePosition = (typeof THEME_POSITIONS)[number]

/** A background: one colour under at most three layers. A plain colour in the file becomes `{ color }`. */
export interface ThemeFill {
  readonly color?: string
  readonly layers?: readonly ThemeLayer[]
}

/** Up to four font names, or one `assets/fonts/*.woff2`. */
export type ThemeFont = readonly string[]

export interface ThemeTypeRole {
  readonly font?: ThemeFont
  readonly weight?: number
  readonly style?: 'normal' | 'italic'
  readonly letterSpacing?: number
}

export interface ThemeGlass {
  readonly blur?: number
  readonly saturate?: number
}

export interface ThemeInkOnFill {
  readonly fill?: string
  readonly ink?: string
}

export type ThemeEffect =
  | {
      readonly type: 'drift'
      readonly zone: 'rail' | 'conversation' | 'window'
      readonly image: string
      readonly direction: 'up' | 'down' | 'left' | 'right'
      readonly period?: number
      readonly size?: number
      readonly opacity?: number
      readonly steps?: number
    }
  | {
      readonly type: 'float'
      readonly zone: 'rail' | 'conversation' | 'window'
      readonly image: string
      readonly anchor: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
      readonly x?: number
      readonly y?: number
      readonly size?: number
      readonly amplitude?: number
      readonly period?: number
    }
  | {
      readonly type: 'band'
      readonly edge: 'conversation-top' | 'above-composer'
      readonly image: string
      readonly height?: number
      readonly period?: number
      readonly steps?: number
      readonly sprites?: readonly {
        readonly image: string
        readonly frames: number
        readonly period?: number
        readonly speed?: number
      }[]
    }
  | {
      readonly type: 'shimmer'
      readonly target: 'brand-mark' | 'titlebar'
      readonly color: string
      readonly period?: number
    }
  | {
      readonly type: 'reel'
      readonly image: string
      readonly rope?: readonly [string, string, string]
    }

export interface Theme {
  readonly format: 1
  readonly id: string
  readonly name: string
  readonly author?: string
  readonly description?: string
  readonly extends?: string
  readonly localOnly?: boolean
  readonly frame?: { readonly ink?: string; readonly paper?: string; readonly accent?: string }
  readonly content?: {
    readonly ink?: string
    readonly paper?: string
    readonly accent?: string
    readonly accent2?: string
    readonly scheme?: 'light' | 'dark'
  }
  readonly status?: {
    readonly waiting?: string
    readonly success?: string
    readonly danger?: string
    readonly auto?: string
  }
  readonly shared?: {
    readonly page?: number
    readonly line?: number
    readonly tint?: number
    readonly shadow?: {
      readonly strength?: number
      readonly color?: string
      readonly style?: 'soft' | 'hard' | 'glow'
    }
    readonly borderWidth?: number
    readonly radius?: number
    readonly fonts?: { readonly body?: ThemeFont; readonly mono?: ThemeFont }
    readonly textBase?: number
    readonly typeRatio?: number
    readonly accentStyle?: 'tinted' | 'solid'
  }
  readonly kinds?: readonly string[]
  readonly window?: { readonly background?: ThemeFill }
  readonly rail?: {
    readonly background?: ThemeFill
    readonly edge?: ThemeFill
    readonly glass?: ThemeGlass
    readonly item?: { readonly active?: ThemeInkOnFill; readonly hover?: ThemeInkOnFill }
  }
  readonly titlebar?: {
    readonly background?: ThemeFill
    readonly ink?: string
    readonly inkGlow?: string
  }
  readonly brand?: {
    readonly mark?: ThemeFill
    readonly markInk?: string
    readonly markEdge?: string
  }
  readonly type?: { readonly display?: ThemeTypeRole; readonly brand?: ThemeTypeRole }
  readonly conversation?: {
    readonly background?: ThemeFill
    readonly glass?: ThemeGlass
    readonly textBacking?: ThemeInkOnFill
  }
  readonly composer?: {
    readonly surround?: ThemeFill
    readonly field?: { readonly fill?: string; readonly ink?: string; readonly line?: string }
  }
  readonly drawer?: {
    readonly background?: ThemeFill
    readonly tabs?: ThemeFill
    readonly card?: { readonly fill?: string; readonly ink?: string; readonly line?: string }
  }
  readonly controls?: {
    readonly style?: 'flat' | 'bevel'
    readonly bevel?: { readonly light?: string; readonly dark?: string }
  }
  readonly scrollbar?: {
    readonly style?: 'thin' | 'bevel'
    readonly thumb?: string
    readonly track?: ThemeFill
  }
  readonly pictures?: { readonly tone?: 'colour' | 'grey' }
  readonly motion?: {
    readonly underReduceMotion?: 'off' | 'stepped'
    readonly transitions?: 'normal' | 'none'
  }
  readonly effects?: readonly ThemeEffect[]
  readonly tokens?: {
    readonly frame?: Readonly<Record<string, string>>
    readonly content?: Readonly<Record<string, string>>
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A theme with its base underneath: every setting the theme leaves unset comes from `base`.
 * Groups merge key by key; a background, a font list, `kinds` and `effects` are replaced whole.
 * A file the base names stays the base's: `assets/x.png` comes through as `@<base id>/assets/x.png`
 * (see `assetOwner`).
 */
export function resolveTheme(theme: Theme, base: Theme | null | undefined): Theme {
  if (!base) return theme
  const WHOLE = new Set([
    'kinds',
    'effects',
    'background',
    'edge',
    'mark',
    'surround',
    'tabs',
    'track',
    'font',
    'body',
    'mono',
  ])
  const merge = (
    under: Record<string, unknown>,
    top: Record<string, unknown>,
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...under }
    for (const [k, v] of Object.entries(top)) {
      const u = out[k]
      out[k] = !WHOLE.has(k) && isObject(u) && isObject(v) ? merge(u, v) : v
    }
    return out
  }
  const IDENTITY = new Set(['id', 'name', 'author', 'description', 'localOnly', 'extends'])
  const owned = (v: unknown): unknown =>
    typeof v === 'string' && v.startsWith('assets/')
      ? `@${base.id}/${v}`
      : Array.isArray(v)
        ? v.map(owned)
        : isObject(v)
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, owned(x)]))
          : v
  const settings = Object.fromEntries(
    Object.entries(base)
      .filter(([k]) => !IDENTITY.has(k))
      .map(([k, v]) => [k, owned(v)]),
  )
  return merge(settings, theme as unknown as Record<string, unknown>) as unknown as Theme
}

/** Whose folder a file in a resolved theme sits in: its own, or its base's for `@<id>/…`. */
export function assetOwner(
  path: string,
  themeId: string,
): { readonly id: string; readonly path: string } {
  const m = /^@([a-z0-9-]+)\/(assets\/.*)$/.exec(path)
  return m ? { id: m[1]!, path: m[2]! } : { id: themeId, path }
}
