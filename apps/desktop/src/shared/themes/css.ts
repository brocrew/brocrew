/**
 * `themeCss`: the stylesheet a validated theme becomes. It writes custom properties only — one
 * block on the theme's root, one for hand-tuned colours in the light zone — plus an `@font-face`
 * for each font file the theme carries. Every value is written from parsed numbers and names;
 * nothing a theme typed is copied through.
 *
 * A background never becomes a `background` shorthand. It becomes longhands — `-color`, `-image`,
 * `-size`, `-position`, `-repeat`, `-rendering` — so a component can paint its own fallback colour
 * under a theme's pictures without the two forming an invalid declaration.
 */
import { GENERIC_FONTS, THEME_SCHEMA, type Spec } from './schema'
import { assetOwner, type Theme, type ThemeFill, type ThemeLayer } from './theme'

/** The scheme the host serves theme files on. */
export const THEME_SCHEME = 'brobot-theme'

const ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

/** `brobot-theme://<id>/<path>?v=<version>`, every segment escaped. */
export function themeAssetUrl(id: string, path: string, version?: string): string {
  const file = path.split('/').map(encodeURIComponent).join('/')
  return `${THEME_SCHEME}://${encodeURIComponent(id)}/${file}${version ? `?v=${encodeURIComponent(version)}` : ''}`
}

export interface ThemeCssOptions {
  /** The selector the theme's block goes on. Default: `:root[data-theme='<id>']`. */
  readonly scope?: string
  /**
   * How a file in the theme becomes a URL. It receives the path as the resolved theme holds it,
   * so an inherited file arrives as `@<base id>/assets/…`. Default: `themeAssetUrl` on its owner.
   */
  readonly assetUrl?: (path: string) => string
  /**
   * The selector a theme's hand-tuned content colours go on. Default: the light content scope
   * under {@link scope} (`[data-chat-theme='light']` and `[data-on-white]`).
   */
  readonly contentScope?: string
}

/**
 * Set on the root when a theme gives the right-hand panel's cards an ink: every text inside a card
 * is then that ink, or worked out from it and the card's fill.
 */
export const CARD_INK_ATTRIBUTE = 'data-card-ink'

/** Every attribute a theme may set on its root; `applyTheme` clears them all before setting new ones. */
export const THEME_ATTRIBUTES: readonly string[] = (() => {
  const out: string[] = []
  const walk = (fields: Readonly<Record<string, Spec>>): void => {
    for (const spec of Object.values(fields)) {
      if (spec.kind === 'choice' && spec.attr) out.push(spec.attr)
      if (spec.kind === 'group') walk(spec.fields)
    }
  }
  walk(THEME_SCHEMA)
  out.push(CARD_INK_ATTRIBUTE)
  return out
})()

/**
 * Written when a theme gives the logo an ink: the app's own drawn mark gives way to the mark drawn
 * in that ink, or to nothing when the ink is transparent and a picture is the logo.
 */
export const BRAND_MARK_FIGURE = '--brand-mark-figure'

/** The longhands a background setting is written as, after its name. */
export const FILL_LONGHANDS = ['color', 'image', 'size', 'position', 'repeat', 'rendering'] as const

/**
 * Every custom property a theme's settings can write (hand-tuned `tokens` aside). A preview sets
 * them all to `initial` before its own theme, so nothing leaks in from the theme the window wears.
 */
export const THEME_CUSTOM_PROPERTIES: readonly string[] = (() => {
  const out: string[] = []
  const walk = (fields: Readonly<Record<string, Spec>>): void => {
    for (const spec of Object.values(fields)) {
      if (spec.kind === 'group') walk(spec.fields)
      else if (spec.kind === 'fill') out.push(...FILL_LONGHANDS.map((l) => `${spec.css}-${l}`))
      else if (spec.kind === 'colours' && spec.css) {
        for (let i = 1; i <= spec.count; i++) out.push(`${spec.css}-${i}`)
      } else if ('css' in spec && spec.css) out.push(spec.css)
    }
  }
  walk(THEME_SCHEMA)
  out.push(BRAND_MARK_FIGURE)
  return out
})()

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The keyword settings, as attributes for the theme's root. */
export function themeAttributes(theme: Theme): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (fields: Readonly<Record<string, Spec>>, value: Record<string, unknown>): void => {
    for (const [key, spec] of Object.entries(fields)) {
      const v = value[key]
      if (v === undefined) continue
      if (spec.kind === 'choice' && spec.attr && typeof v === 'string') out[spec.attr] = v
      if (spec.kind === 'group' && isObject(v)) walk(spec.fields, v)
    }
  }
  walk(THEME_SCHEMA, theme as unknown as Record<string, unknown>)
  if (theme.drawer?.card?.ink !== undefined) out[CARD_INK_ATTRIBUTE] = ''
  return out
}

const num = (n: number): string => String(Math.round(n * 10000) / 10000)

function repeatOf(r: boolean | 'x' | 'y' | undefined): string {
  return r === false ? 'no-repeat' : r === 'x' ? 'repeat-x' : r === 'y' ? 'repeat-y' : 'repeat'
}

interface LayerCss {
  readonly image: string
  readonly size: string
  readonly position: string
  readonly repeat: string
}

function layerCss(layer: ThemeLayer, url: (path: string) => string): LayerCss[] {
  if ('image' in layer) {
    const size =
      layer.size === undefined
        ? 'auto'
        : typeof layer.size === 'number'
          ? `${num(layer.size)}px`
          : layer.size
    return [
      {
        image: `url("${url(layer.image)}")`,
        size,
        position: layer.position ?? 'center',
        repeat: repeatOf(layer.repeat),
      },
    ]
  }
  if ('gradient' in layer) {
    const g = layer.gradient
    const stops = g.stops.map((s) => `${s.color} ${num(s.at)}%`).join(', ')
    const image =
      g.type === 'radial'
        ? `radial-gradient(circle at center, ${stops})`
        : `linear-gradient(${num(g.angle ?? 180)}deg, ${stops})`
    return [{ image, size: 'auto', position: 'center', repeat: 'no-repeat' }]
  }
  const p = layer.pattern
  const t = p.thickness ?? 1
  const cell = `${num(p.size)}px ${num(p.size)}px`
  const lines = (angle: number): LayerCss => ({
    image: `repeating-linear-gradient(${num(angle)}deg, ${p.color} 0 ${num(t)}px, transparent ${num(t)}px ${num(p.size)}px)`,
    size: 'auto',
    position: 'top left',
    repeat: 'repeat',
  })
  switch (p.kind) {
    case 'dots':
      return [
        {
          image: `radial-gradient(circle, ${p.color} ${num(t)}px, transparent ${num(t + 0.5)}px)`,
          size: cell,
          position: 'top left',
          repeat: 'repeat',
        },
      ]
    case 'lines':
      return [lines(p.angle ?? 180)]
    case 'grid':
      return [lines(0), lines(90)]
    case 'checker':
      return [
        {
          image: `repeating-conic-gradient(${p.color} 0 25%, transparent 0 50%)`,
          size: cell,
          position: 'top left',
          repeat: 'repeat',
        },
      ]
  }
}

/** A background as longhand custom properties. A plain colour clears any picture underneath. */
export function fillDeclarations(
  name: string,
  fill: ThemeFill,
  url: (path: string) => string,
): [string, string][] {
  const out: [string, string][] = []
  if (fill.color !== undefined) out.push([`${name}-color`, fill.color])
  const layers = (fill.layers ?? []).flatMap((l) => layerCss(l, url))
  if (layers.length === 0) {
    out.push(
      [`${name}-image`, 'none'],
      [`${name}-size`, 'auto'],
      [`${name}-position`, '0% 0%'],
      [`${name}-repeat`, 'repeat'],
    )
  } else {
    out.push(
      [`${name}-image`, layers.map((l) => l.image).join(', ')],
      [`${name}-size`, layers.map((l) => l.size).join(', ')],
      [`${name}-position`, layers.map((l) => l.position).join(', ')],
      [`${name}-repeat`, layers.map((l) => l.repeat).join(', ')],
    )
  }
  const pixelated = (fill.layers ?? []).some((l) => 'image' in l && l.pixelated)
  out.push([`${name}-rendering`, pixelated ? 'pixelated' : 'auto'])
  return out
}

/** Builds the stylesheet for a validated theme. */
export function themeCss(theme: Theme, options: ThemeCssOptions = {}): string {
  if (!ID.test(theme.id))
    throw new Error(
      `A theme id must be validated before it reaches CSS: ${JSON.stringify(theme.id)}`,
    )
  const scope = options.scope ?? `:root[data-theme='${theme.id}']`
  const url =
    options.assetUrl ??
    ((path: string) => {
      const owner = assetOwner(path, theme.id)
      return themeAssetUrl(owner.id, owner.path)
    })
  const declarations: [string, string][] = []
  const fontFaces: string[] = []
  const fontFamilies = new Map<string, string>()

  const fontStack = (names: readonly string[], fallback: string): string => {
    const parts = names.map((n) => {
      if (n.startsWith('assets/') || n.startsWith('@')) {
        let family = fontFamilies.get(n)
        if (!family) {
          family = `brobot-theme-${theme.id}-${fontFamilies.size + 1}`
          fontFamilies.set(n, family)
          fontFaces.push(
            `@font-face {\n  font-family: "${family}";\n  src: url("${url(n)}") format("woff2");\n  font-display: swap;\n}`,
          )
        }
        return `"${family}"`
      }
      return GENERIC_FONTS.has(n) ? n : `"${n}"`
    })
    return [...parts, fallback].join(', ')
  }

  const walk = (fields: Readonly<Record<string, Spec>>, value: Record<string, unknown>): void => {
    for (const [key, spec] of Object.entries(fields)) {
      const v = value[key]
      if (v === undefined) continue
      switch (spec.kind) {
        case 'group':
          if (isObject(v)) walk(spec.fields, v)
          break
        case 'colour':
          if (spec.css && typeof v === 'string') declarations.push([spec.css, v])
          break
        case 'colours':
          if (spec.css && Array.isArray(v))
            v.forEach((c, i) => declarations.push([`${spec.css}-${i + 1}`, String(c)]))
          break
        case 'fill':
          if (isObject(v)) declarations.push(...fillDeclarations(spec.css, v as ThemeFill, url))
          break
        case 'font':
          if (Array.isArray(v))
            declarations.push([spec.css, fontStack(v as string[], spec.fallback)])
          break
        case 'number':
          if (spec.css && typeof v === 'number')
            declarations.push([spec.css, `${num(v)}${spec.unit}`])
          break
        case 'choice':
          if (spec.css && typeof v === 'string') declarations.push([spec.css, v])
          break
        default:
          break
      }
    }
  }
  walk(THEME_SCHEMA, theme as unknown as Record<string, unknown>)
  if (theme.brand?.markInk !== undefined) declarations.push([BRAND_MARK_FIGURE, 'hidden'])
  for (const [name, value] of Object.entries(theme.tokens?.frame ?? {}))
    declarations.push([`--${name}`, value])

  const block = (selector: string, decls: [string, string][]): string =>
    `${selector} {\n${decls.map(([n, v]) => `  ${n}: ${v};`).join('\n')}\n}`
  const rules = [...fontFaces, block(scope, declarations)]
  const content = Object.entries(theme.tokens?.content ?? {})
  if (content.length > 0) {
    rules.push(
      block(
        options.contentScope ?? `${scope} [data-chat-theme='light'],\n${scope} [data-on-white]`,
        content.map(([n, v]) => [`--${n}`, v]),
      ),
    )
  }
  return `${rules.join('\n')}\n`
}
