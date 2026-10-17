/**
 * `validateTheme`: reads an untrusted `theme.json` against the schema, checks every file it names
 * against what the host found in it, and measures whether its text stays readable. It answers with
 * a clean theme, every value written back in one form, or with every problem as a plain sentence
 * naming the setting.
 */
import { assetLimitProblems, assetPathProblem, LIMITS, type AssetFacts } from './assets'
import { colourCss, parseColour } from './colour'
import { contrastProblems, type PictureSamples } from './contrast'
import { TYPE_DEFAULTS, TYPE_FLOOR, typeSizes } from './derive'
import {
  EFFECT_PARAMS,
  EFFECT_TYPES,
  FONT_FILE_FOLDER,
  GENERIC_FONTS,
  LIVE_THEME_SCHEMA,
  MAX_EFFECTS,
  MAX_SPRITES,
  overridableIn,
  SPRITE_PARAMS,
  SYMBOL_FONTS,
  THEME_FORMAT,
  THEME_SCHEMA,
  type EffectParam,
  type Spec,
} from './schema'
import { resolveTheme, THEME_POSITIONS, type Theme, type ThemeProblem } from './theme'

export type ThemeValidation =
  | {
      readonly ok: true
      readonly theme: Theme
      /** Readability problems kept as notes, when `readability` is `'note'`. */
      readonly notes?: readonly ThemeProblem[]
    }
  | { readonly ok: false; readonly problems: readonly ThemeProblem[] }

/** What the host knows that the file alone doesn't say. */
export interface ThemeContext {
  /** Every file in the theme's folder under `assets/`, with what the host read from its bytes. */
  readonly assets: ReadonlyMap<string, AssetFacts>
  /**
   * The darkest and lightest colours of each picture, sampled by the host: this theme's by their
   * path, and its base's as `@<base id>/<path>`, since text may sit over an inherited picture.
   */
  readonly pictures?: ReadonlyMap<string, PictureSamples>
  /** The built-in themes, already valid: `extends` names one of these, and their ids are taken. */
  readonly builtIns: ReadonlyMap<string, Theme>
  /** Built-ins a theme may extend that an unknown `extends` doesn't suggest. */
  readonly hiddenBases?: ReadonlySet<string>
  /** True when validating a built-in itself, which may use its own reserved id. */
  readonly builtIn?: boolean
  /**
   * True to read the settings the window doesn't paint yet as well, by their own rules. No host
   * sets it: a theme the app reads is refused for any of them.
   */
  readonly readsHeld?: boolean
  /**
   * What a readability problem does: refuses the theme (the default, for a theme being saved or a
   * built-in), or is kept as a note on a theme that otherwise loads — a person's saved theme,
   * re-read after an update has made the readability check stricter.
   */
  readonly readability?: 'refuse' | 'note'
}

const ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

/** Why `v` can't be a theme's text: none, invisible control characters, or too long; else null. */
function textFault(v: unknown, max: number): 'empty' | 'hidden' | 'long' | null {
  if (typeof v !== 'string' || v.trim() === '') return 'empty'
  if ([...v].some(hidden)) return 'hidden'
  if (v.length > max) return 'long'
  return null
}

/**
 * The built-in a theme file extends, named as validation reads it: `extends` admitted as text and
 * trimmed. Undefined when the file names none, or names one in a form validation refuses.
 */
export function themeBaseName(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null || !('extends' in raw)) return undefined
  const spec = THEME_SCHEMA.extends
  const v = raw.extends
  return spec?.kind === 'text' && textFault(v, spec.max) === null ? (v as string).trim() : undefined
}

const FONT_NAME = /^[A-Za-z0-9][A-Za-z0-9 -]{0,39}$/

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const join = (at: string, key: string | number): string =>
  typeof key === 'number' ? `${at}[${key}]` : at ? `${at}.${key}` : key

/** Control characters and bidirectional overrides, which could disguise a name. */
const hidden = (ch: string): boolean => {
  const code = ch.codePointAt(0)!
  return (
    code < 0x20 ||
    code === 0x7f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  )
}

/** Edit distance, for "did you mean". */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j]!
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        prev + (a[i - 1]!.toLowerCase() === b[j - 1]!.toLowerCase() ? 0 : 1),
      )
      prev = keep
    }
  }
  return row[b.length]!
}

function unknownKey(at: string, key: string, known: readonly string[]): ThemeProblem {
  const path = join(at, key)
  const near = known
    .map((k) => ({ k, d: distance(key, k) }))
    .filter(({ d }) => d <= Math.max(2, Math.floor(key.length / 3)))
    .sort((x, y) => x.d - y.d)[0]
  const hint = near ? ` Did you mean \`${join(at, near.k)}\`?` : ''
  return { at: path, says: `\`${path}\` isn’t a theme setting.${hint}` }
}

const describe = (v: unknown): string =>
  v === null
    ? 'null'
    : Array.isArray(v)
      ? 'a list'
      : typeof v === 'string'
        ? `“${v.length > 40 ? v.slice(0, 37) + '…' : v}”`
        : typeof v

/** Reads every value of a theme against its spec, collecting problems and the clean value. */
class Reader {
  readonly problems: ThemeProblem[] = []
  readonly used = new Map<string, { at: string; as: 'picture' | 'font' }>()

  constructor(private readonly context: ThemeContext) {}

  problem(at: string, says: string): undefined {
    this.problems.push({ at, says })
    return undefined
  }

  object(
    at: string,
    value: unknown,
    fields: Readonly<Record<string, Spec | EffectParam>>,
    skip: readonly string[] = [],
  ) {
    if (!isObject(value))
      return this.problem(at, `\`${at}\` should be a group of settings, not ${describe(value)}.`)
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      if (skip.includes(key)) continue
      const spec = fields[key]
      if (!spec) {
        this.problems.push(unknownKey(at, key, Object.keys(fields)))
        continue
      }
      const clean = this.value(join(at, key), v, spec)
      if (clean !== undefined) out[key] = clean
    }
    for (const [key, spec] of Object.entries(fields)) {
      if ((spec as EffectParam).required && !(key in value)) {
        this.problem(join(at, key), `\`${join(at, key)}\` is needed.`)
      }
    }
    return out
  }

  value(at: string, v: unknown, spec: Spec | EffectParam): unknown {
    switch (spec.kind) {
      case 'colour':
        return this.colour(at, v)
      case 'colours':
        return this.colours(at, v, spec.count)
      case 'fill':
        return this.fill(at, v)
      case 'font':
        return this.font(at, v, spec.files)
      case 'number':
        return this.number(at, v, spec.min, spec.max, spec.unit, spec.integer)
      case 'choice':
        if (typeof v === 'string' && spec.values.includes(v)) return v
        return this.problem(
          at,
          `\`${at}\` should be one of ${spec.values.map((x) => `“${x}”`).join(', ')}, not ${describe(v)}.`,
        )
      case 'text':
        return this.text(at, v, spec.max)
      case 'flag':
        if (typeof v === 'boolean') return v
        return this.problem(at, `\`${at}\` should be true or false.`)
      case 'group':
        return this.object(at, v, spec.fields)
      case 'effects':
        return this.effects(at, v)
      case 'tokens':
        return this.tokens(at, v)
    }
  }

  colour(at: string, v: unknown): string | undefined {
    const c = parseColour(v)
    if (c) return colourCss(c)
    if (typeof v === 'string' && /url\(|var\(|color-mix|gradient|;|\{|\}/i.test(v)) {
      return this.problem(
        at,
        `\`${at}\` should be one colour, such as #4f46e5; ${describe(v)} is something else.`,
      )
    }
    return this.problem(
      at,
      `\`${at}\` should be a colour, such as #4f46e5 or rgb(79 70 229 / 80%), not ${describe(v)}.`,
    )
  }

  colours(at: string, v: unknown, count: number): string[] | undefined {
    if (!Array.isArray(v) || v.length !== count) {
      return this.problem(at, `\`${at}\` should be a list of exactly ${count} colours.`)
    }
    const out = v.map((c, i) => this.colour(join(at, i), c))
    return out.every((c) => c !== undefined) ? (out as string[]) : undefined
  }

  number(
    at: string,
    v: unknown,
    min: number,
    max: number,
    unit: string,
    integer?: boolean,
  ): number | undefined {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return this.problem(
        at,
        `\`${at}\` should be a number${unit ? ` of ${unit}` : ''}, not ${describe(v)}.`,
      )
    }
    if (v < min || v > max) {
      return this.problem(
        at,
        `\`${at}\` is ${v}${unit}; it can be from ${min}${unit} to ${max}${unit}.`,
      )
    }
    if (integer && !Number.isInteger(v))
      return this.problem(at, `\`${at}\` should be a whole number.`)
    return v
  }

  text(at: string, v: unknown, max: number): string | undefined {
    const fault = textFault(v, max)
    if (fault === 'empty') return this.problem(at, `\`${at}\` should be some text.`)
    if (fault === 'hidden')
      return this.problem(at, `\`${at}\` has invisible control characters in it.`)
    if (fault === 'long')
      return this.problem(
        at,
        `\`${at}\` is ${(v as string).length} characters long; it can be up to ${max}.`,
      )
    return (v as string).trim()
  }

  file(at: string, v: unknown, as: 'picture' | 'font'): string | undefined {
    const bad = assetPathProblem(v)
    if (bad) return this.problem(at, `\`${at}\`: ${bad}.`)
    const path = v as string
    const facts = this.context.assets.get(path)
    if (!facts)
      return this.problem(at, `\`${at}\` names ${path}, which isn’t in the theme’s folder.`)
    if (as === 'font' && facts.type !== 'woff2')
      return this.problem(at, `\`${at}\` names ${path}, which isn’t a woff2 font.`)
    if (as === 'picture' && facts.type === 'woff2')
      return this.problem(at, `\`${at}\` names ${path}, which is a font, not a picture.`)
    this.used.set(path, { at, as })
    return path
  }

  fill(at: string, v: unknown): Record<string, unknown> | undefined {
    if (typeof v === 'string') {
      const c = this.colour(at, v)
      return c === undefined ? undefined : { color: c }
    }
    if (!isObject(v))
      return this.problem(at, `\`${at}\` should be a colour, or { "color", "layers" }.`)
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(v)) {
      if (key !== 'color' && key !== 'layers')
        this.problems.push(unknownKey(at, key, ['color', 'layers']))
    }
    if ('color' in v) {
      const c = this.colour(join(at, 'color'), v.color)
      if (c !== undefined) out.color = c
    }
    if ('layers' in v) {
      const layers = v.layers
      if (!Array.isArray(layers) || layers.length < 1 || layers.length > 3) {
        this.problem(
          join(at, 'layers'),
          `\`${join(at, 'layers')}\` should be a list of 1 to 3 layers.`,
        )
      } else {
        const clean = layers.map((l, i) => this.layer(join(join(at, 'layers'), i), l))
        if (clean.every((l) => l !== undefined)) out.layers = clean
      }
    }
    if (!('color' in v) && !('layers' in v))
      return this.problem(at, `\`${at}\` needs a "color", "layers", or both.`)
    return out
  }

  layer(at: string, v: unknown): Record<string, unknown> | undefined {
    if (!isObject(v))
      return this.problem(
        at,
        `\`${at}\` should be one of { "image" }, { "gradient" } or { "pattern" }.`,
      )
    if ('image' in v) {
      const out = this.object(
        at,
        v,
        {
          image: { kind: 'text', max: 120, says: '' },
          size: { kind: 'text', max: 8, says: '' },
          position: { kind: 'choice', values: THEME_POSITIONS, says: '' },
          repeat: { kind: 'text', max: 1, says: '' },
          pixelated: { kind: 'flag', says: '' },
        },
        ['image', 'size', 'repeat'],
      )
      if (!out) return undefined
      const image = this.file(join(at, 'image'), v.image, 'picture')
      if (image === undefined) return undefined
      out.image = image
      if ('size' in v) {
        const size = v.size
        const ok =
          size === 'cover' || size === 'contain' || size === 'auto'
            ? size
            : typeof size === 'number' && size >= 8 && size <= 2048
              ? size
              : typeof size === 'string' && /^(?:[1-9]\d?|100)%$/.test(size)
                ? size
                : undefined
        if (ok === undefined) {
          this.problem(
            join(at, 'size'),
            `\`${join(at, 'size')}\` should be "cover", "contain", "auto", a width in pixels from 8 to 2048, or a percentage such as "70%".`,
          )
        } else out.size = ok
      }
      if ('repeat' in v) {
        const r = v.repeat
        if (r === true || r === false || r === 'x' || r === 'y') out.repeat = r
        else
          this.problem(
            join(at, 'repeat'),
            `\`${join(at, 'repeat')}\` should be true, false, "x" or "y".`,
          )
      }
      return out
    }
    if ('gradient' in v) {
      if (Object.keys(v).length > 1)
        return this.problem(at, `\`${at}\` should hold only "gradient".`)
      const g = v.gradient
      const gat = join(at, 'gradient')
      if (!isObject(g))
        return this.problem(gat, `\`${gat}\` should be { "type", "angle", "stops" }.`)
      const out = this.object(
        gat,
        g,
        {
          type: { kind: 'choice', values: ['linear', 'radial'], says: '', required: true },
          angle: { kind: 'number', min: 0, max: 360, unit: '', says: '' },
          stops: { kind: 'text', max: 0, says: '' },
        },
        ['stops'],
      )
      const stops = g.stops
      const sat = join(gat, 'stops')
      if (!Array.isArray(stops) || stops.length < 2 || stops.length > 8) {
        return this.problem(
          sat,
          `\`${sat}\` should be a list of 2 to 8 stops, each { "color", "at" }.`,
        )
      }
      const clean = stops.map((s, i) =>
        this.object(join(sat, i), s, {
          color: { kind: 'colour', says: '', required: true },
          at: { kind: 'number', min: 0, max: 100, unit: '%', says: '', required: true },
        }),
      )
      if (!out || clean.some((s) => s === undefined)) return undefined
      return { gradient: { ...out, stops: clean } }
    }
    if ('pattern' in v) {
      if (Object.keys(v).length > 1)
        return this.problem(at, `\`${at}\` should hold only "pattern".`)
      const out = this.object(join(at, 'pattern'), v.pattern, {
        kind: {
          kind: 'choice',
          values: ['dots', 'lines', 'grid', 'checker'],
          says: '',
          required: true,
        },
        color: { kind: 'colour', says: '', required: true },
        size: { kind: 'number', min: 2, max: 64, unit: 'px', says: '', required: true },
        thickness: { kind: 'number', min: 1, max: 4, unit: 'px', says: '' },
        angle: { kind: 'number', min: 0, max: 360, unit: '', says: '' },
      })
      return out ? { pattern: out } : undefined
    }
    return this.problem(
      at,
      `\`${at}\` should be one of { "image" }, { "gradient" } or { "pattern" }.`,
    )
  }

  font(at: string, v: unknown, files: boolean): string[] | undefined {
    if (!Array.isArray(v) || v.length < 1 || v.length > 4) {
      return this.problem(at, `\`${at}\` should be a list of 1 to 4 font names.`)
    }
    const out: string[] = []
    for (const [i, name] of v.entries()) {
      const fat = join(at, i)
      if (typeof name !== 'string') {
        this.problem(fat, `\`${fat}\` should be a font name.`)
        continue
      }
      if (name.startsWith('assets/') || /^[a-z]+:|\//i.test(name)) {
        if (!files) {
          this.problem(
            fat,
            `\`${fat}\`: a font file can be used for titles and the brand only. Reading text uses installed fonts, so every word stays readable.`,
          )
          continue
        }
        if (!name.startsWith(FONT_FILE_FOLDER)) {
          const bad = assetPathProblem(name)
          this.problem(fat, `\`${fat}\`: ${bad ?? `a font file must sit in ${FONT_FILE_FOLDER}`}.`)
          continue
        }
        const path = this.file(fat, name, 'font')
        if (path !== undefined) out.push(path)
        continue
      }
      if (!FONT_NAME.test(name)) {
        this.problem(
          fat,
          `\`${fat}\`: “${name.slice(0, 40)}” isn’t a font name the app accepts; use letters, digits, spaces and hyphens.`,
        )
        continue
      }
      if (SYMBOL_FONTS.has(name.toLowerCase())) {
        this.problem(
          fat,
          `\`${fat}\`: ${name} draws letters as symbols, so words would be unreadable.`,
        )
        continue
      }
      out.push(GENERIC_FONTS.has(name.toLowerCase()) ? name.toLowerCase() : name)
    }
    // A role is either installed font names or one font file, never both and never two files.
    const fileEntries = v.filter(
      (name) =>
        typeof name === 'string' && (name.startsWith('assets/') || /^[a-z]+:|\//i.test(name)),
    )
    if (files && fileEntries.length > 0 && v.length > 1) {
      return this.problem(at, `\`${at}\`: use 1–4 installed font names, or one font file.`)
    }
    return out.length === v.length ? out : undefined
  }

  effects(at: string, v: unknown): unknown[] | undefined {
    if (!Array.isArray(v)) return this.problem(at, `\`${at}\` should be a list of effects.`)
    if (v.length > MAX_EFFECTS)
      return this.problem(
        at,
        `\`${at}\` has ${v.length} effects; a theme can have up to ${MAX_EFFECTS}.`,
      )
    const out = v.map((e, i) => {
      const eat = join(at, i)
      if (
        !isObject(e) ||
        typeof e.type !== 'string' ||
        !(EFFECT_TYPES as readonly string[]).includes(e.type)
      ) {
        return this.problem(
          join(eat, 'type'),
          `\`${join(eat, 'type')}\` should be one of ${EFFECT_TYPES.map((t) => `“${t}”`).join(', ')}.`,
        )
      }
      const type = e.type as (typeof EFFECT_TYPES)[number]
      const params = this.object(eat, e, EFFECT_PARAMS[type], ['type', 'image', 'sprites'])
      if (!params) return undefined
      const clean: Record<string, unknown> = { type, ...params }
      if ('image' in EFFECT_PARAMS[type]) {
        if (!('image' in e)) return undefined
        const image = this.file(join(eat, 'image'), e.image, 'picture')
        if (image === undefined) return undefined
        clean.image = image
      }
      if (type === 'band' && 'sprites' in e) {
        const sat = join(eat, 'sprites')
        const sprites = e.sprites
        if (!Array.isArray(sprites) || sprites.length > MAX_SPRITES) {
          return this.problem(sat, `\`${sat}\` should be a list of up to ${MAX_SPRITES} sprites.`)
        }
        const cleanSprites = sprites.map((s, j) => {
          const one = this.object(join(sat, j), s, SPRITE_PARAMS, ['image'])
          const image =
            isObject(s) && 'image' in s
              ? this.file(join(join(sat, j), 'image'), s.image, 'picture')
              : undefined
          return one && image !== undefined ? { image, ...one } : undefined
        })
        if (cleanSprites.some((s) => s === undefined)) return undefined
        clean.sprites = cleanSprites
      } else if ('sprites' in e) {
        this.problems.push(unknownKey(eat, 'sprites', Object.keys(EFFECT_PARAMS[type])))
      }
      return clean
    })
    return out.every((e) => e !== undefined) ? out : undefined
  }

  tokens(at: string, v: unknown): Record<string, unknown> | undefined {
    if (!isObject(v))
      return this.problem(at, `\`${at}\` should be { "frame": {…}, "content": {…} }.`)
    const out: Record<string, unknown> = {}
    for (const [zone, map] of Object.entries(v)) {
      const zat = join(at, zone)
      if (zone !== 'frame' && zone !== 'content') {
        this.problems.push(unknownKey(at, zone, ['frame', 'content']))
        continue
      }
      if (!isObject(map)) {
        this.problem(zat, `\`${zat}\` should be a group of colour tokens.`)
        continue
      }
      const clean: Record<string, string> = {}
      for (const [name, value] of Object.entries(map)) {
        const bare = name.replace(/^--/, '')
        const known = overridableIn(zone)
        if (!known.includes(bare)) {
          this.problems.push(unknownKey(zat, name, known))
          continue
        }
        // A solid fill holds words; one that lets what is under it through is no solid fill.
        if (bare === 'accent-solid-bg' && (parseColour(value)?.a ?? 1) < 1) {
          const at = join(zat, name)
          this.problem(
            at,
            `\`${at}\` should be one colour, such as #4f46e5; ${describe(value)} is something else.`,
          )
          continue
        }
        const c = this.colour(join(zat, name), value)
        if (c !== undefined) clean[bare] = c
      }
      out[zone] = clean
    }
    return out
  }
}

/** Validates an untrusted theme file. */
export function validateTheme(raw: unknown, context: ThemeContext): ThemeValidation {
  const r = new Reader(context)
  if (!isObject(raw))
    return { ok: false, problems: [{ at: '', says: 'A theme file should hold one JSON object.' }] }

  const clean = r.object('', raw, context.readsHeld ? THEME_SCHEMA : LIVE_THEME_SCHEMA) ?? {}

  if (raw.format !== THEME_FORMAT && !r.problems.some((p) => p.at === 'format')) {
    r.problem('format', `\`format\` should be ${THEME_FORMAT}.`)
  }
  for (const key of ['id', 'name'] as const) {
    if (!(key in raw)) r.problem(key, `\`${key}\` is needed.`)
  }
  if (typeof clean.id === 'string') {
    if (!ID.test(clean.id)) {
      r.problem(
        'id',
        '`id` should be 1 to 40 lowercase letters, digits and hyphens, starting and ending with a letter or digit.',
      )
    } else if (!context.builtIn && context.builtIns.has(clean.id)) {
      r.problem('id', `“${clean.id}” is a built-in theme’s id. Save your changes under a new id.`)
    }
  }
  let base: Theme | undefined
  const named = themeBaseName(raw)
  if (named !== undefined) {
    base = context.builtIns.get(named)
    if (!base) {
      r.problem(
        'extends',
        `\`extends\` names “${named}”, which isn’t a built-in theme. Use one of ${[
          ...context.builtIns.keys(),
        ]
          .filter((k) => !context.hiddenBases?.has(k))
          .map((k) => `“${k}”`)
          .join(', ')}.`,
      )
    }
  }

  // Files: each one checked against the limits, the whole folder against the total.
  let total = 0
  let fonts = 0
  for (const [path, facts] of context.assets) {
    total += facts.bytes
    if (facts.type === 'woff2') fonts++
    if (r.used.has(path))
      for (const says of assetLimitProblems(path, facts)) r.problem(r.used.get(path)!.at, says)
  }
  if (context.assets.size > LIMITS.files) {
    r.problem(
      'assets',
      `The theme has ${context.assets.size} files; it can have up to ${LIMITS.files}.`,
    )
  }
  if (total > LIMITS.themeBytes) {
    r.problem(
      'assets',
      `The theme’s files come to ${Math.round(total / 104857.6) / 10} MB; a theme can be up to 12 MB.`,
    )
  }
  if (fonts > LIMITS.fonts)
    r.problem('assets', `The theme has ${fonts} fonts; it can have up to ${LIMITS.fonts}.`)

  if (r.problems.length > 0) return { ok: false, problems: r.problems }

  const theme = clean as unknown as Theme
  const small = smallTextProblem(theme, resolveTheme(theme, base))
  if (small) return { ok: false, problems: [small] }
  const contrast = contrastProblems(resolveTheme(theme, base), context.pictures ?? new Map())
  if (contrast.length > 0)
    return context.readability === 'note'
      ? { ok: true, theme, notes: contrast }
      : { ok: false, problems: contrast }
  return { ok: true, theme }
}

/**
 * The text size and ratio, with what the theme inherits, must keep every text role at the floor or
 * above. Reported where the theme set it: at the ratio when that is all it set, else at the size.
 */
function smallTextProblem(theme: Theme, resolved: Theme): ThemeProblem | null {
  const base = resolved.shared?.textBase ?? TYPE_DEFAULTS.base
  const ratio = resolved.shared?.typeRatio ?? TYPE_DEFAULTS.ratio
  const smallest = Math.min(...Object.values(typeSizes(base, ratio)))
  if (smallest >= TYPE_FLOOR) return null
  const at =
    theme.shared?.textBase === undefined && theme.shared?.typeRatio !== undefined
      ? 'shared.typeRatio'
      : 'shared.textBase'
  return {
    at,
    says: `The smallest text would be ${smallest} px, and text can’t be smaller than ${TYPE_FLOOR} px. Raise \`shared.textBase\` or lower \`shared.typeRatio\`.`,
  }
}
