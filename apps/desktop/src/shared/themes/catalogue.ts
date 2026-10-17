/**
 * The catalogue an agent reads before writing a theme: every setting with its type, bounds and
 * purpose, the background grammar, the effects and the limits. It is generated from the same
 * schema the validator reads, so it can't describe a setting the validator refuses.
 */
import { LIMITS } from './assets'
import {
  EFFECT_PARAMS,
  EFFECT_TYPES,
  MAX_EFFECTS,
  MAX_SPRITES,
  LIVE_THEME_SCHEMA,
  overridableIn,
  SPRITE_PARAMS,
  THEME_FORMAT,
  type EffectParam,
  type Spec,
} from './schema'
import { THEME_POSITIONS } from './theme'

export interface CatalogueEntry {
  readonly path: string
  readonly type: string
  readonly says: string
  readonly required?: boolean
}

export interface ThemeCatalogue {
  readonly format: typeof THEME_FORMAT
  readonly settings: readonly CatalogueEntry[]
  /** The background grammar, when a setting takes a background. */
  readonly background?: string
  /** The effects and their sprites, when a theme can set effects. */
  readonly effects?: readonly {
    readonly type: string
    readonly params: readonly CatalogueEntry[]
  }[]
  readonly sprites?: readonly CatalogueEntry[]
  /** The colour tokens a theme may set by hand, by zone. */
  readonly tokens: { readonly frame: readonly string[]; readonly content: readonly string[] }
  readonly limits: string
  readonly rules: readonly string[]
}

const COLOUR = 'colour: #rrggbb, #rrggbbaa, rgb(), hsl(), oklch() or transparent'

function typeOf(spec: Spec | EffectParam): string {
  switch (spec.kind) {
    case 'colour':
      return COLOUR
    case 'colours':
      return `list of exactly ${spec.count} colours`
    case 'fill':
      return 'background (see `background`)'
    case 'font':
      return spec.files
        ? 'list of 1–4 installed font names, or one assets/fonts/*.woff2'
        : 'list of 1–4 installed font names'
    case 'number':
      return `number from ${spec.min}${spec.unit} to ${spec.max}${spec.unit}${spec.integer ? ', whole' : ''}`
    case 'choice':
      return `one of ${spec.values.map((v) => `"${v}"`).join(', ')}`
    case 'text':
      return spec.max > 0 ? `text, up to ${spec.max} characters` : 'text'
    case 'flag':
      return 'true or false'
    case 'group':
      return 'group'
    case 'effects':
      return `list of up to ${MAX_EFFECTS} effects (see \`effects\`)`
    case 'tokens':
      return '{ "frame": { name: colour }, "content": { name: colour } } (see `tokens`)'
  }
}

function entries(fields: Readonly<Record<string, Spec | EffectParam>>, at = ''): CatalogueEntry[] {
  const out: CatalogueEntry[] = []
  for (const [key, spec] of Object.entries(fields)) {
    const path = at ? `${at}.${key}` : key
    if (spec.kind === 'group') {
      out.push(...entries(spec.fields, path))
      continue
    }
    const required = (spec as EffectParam).required
    out.push({ path, type: typeOf(spec), says: spec.says, ...(required ? { required } : {}) })
  }
  return out
}

const BACKGROUND =
  'A background is a colour, or { "color"?: colour, "layers"?: 1–3 layers }, the first layer on top. A layer is ' +
  `{ "image": "assets/….png|jpg", "size"?: "cover"|"contain"|"auto"|8–2048 (px)|"1%"–"100%", "position"?: ${THEME_POSITIONS.map((p) => `"${p}"`).join('|')}, "repeat"?: true|false|"x"|"y", "pixelated"?: true|false }, ` +
  'or { "gradient": { "type": "linear"|"radial", "angle"?: 0–360, "stops": 2–8 of { "color", "at": 0–100 } } }, ' +
  'or { "pattern": { "kind": "dots"|"lines"|"grid"|"checker", "color", "size": 2–64 (px), "thickness"?: 1–4 (px), "angle"?: 0–360 } }.'

/** Whether any setting among `fields` is of `kind`. */
function has(fields: Readonly<Record<string, Spec>>, kind: Spec['kind']): boolean {
  return Object.values(fields).some(
    (spec) => spec.kind === kind || (spec.kind === 'group' && has(spec.fields, kind)),
  )
}

/** The whole catalogue: the settings a theme can set, and only the grammar they use. */
export function themeCatalogue(): ThemeCatalogue {
  return {
    format: THEME_FORMAT,
    settings: entries(LIVE_THEME_SCHEMA),
    ...(has(LIVE_THEME_SCHEMA, 'fill') ? { background: BACKGROUND } : {}),
    ...(has(LIVE_THEME_SCHEMA, 'effects')
      ? {
          effects: EFFECT_TYPES.map((type) => ({ type, params: entries(EFFECT_PARAMS[type]) })),
          sprites: entries(SPRITE_PARAMS, `band.sprites[] (up to ${MAX_SPRITES})`),
        }
      : {}),
    tokens: { frame: overridableIn('frame'), content: overridableIn('content') },
    limits:
      `Pictures are PNG or JPEG, still, up to 4 MB and ${LIMITS.picturePixels} pixels a side. ` +
      `Fonts are woff2, up to 1 MB, at most ${LIMITS.fonts}. A theme's files come to at most 12 MB, ${LIMITS.files} files.`,
    rules: [
      'A theme sets style only: nothing can hide, move or resize a control.',
      'Every text colour must reach 4.5 to 1 against what it sits on, in both zones; the focus ring and the logo 3 to 1.',
      'Files are named as assets/… inside the theme; web addresses and other folders are refused.',
      'Pictures must be PNG or JPEG; other kinds aren’t supported yet.',
      'A built-in theme can’t be changed: set `extends` to it and save under a new id.',
    ],
  }
}
