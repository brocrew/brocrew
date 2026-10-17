/**
 * Every setting a theme file may hold, as one table. The validator walks it, `themeCss` writes the
 * custom properties it names, and the catalogue an agent reads is generated from it — so a setting
 * exists in all three or in none.
 *
 * A theme sets style only. There is no setting here for display, visibility, position, size,
 * margin, padding, z-index, transform, a control's opacity or generated content, and every length
 * is bounded.
 *
 * Held without zod, like the rest of `src/shared`: the renderer imports the CSS writer from this
 * folder and must not bundle a validator it never runs.
 */

/** The `format` a theme file declares; the only one this build reads. */
export const THEME_FORMAT = 1

/** A spec for one value in `theme.json`. */
export type Spec =
  | { readonly kind: 'colour'; readonly css?: string; readonly says: string }
  | { readonly kind: 'fill'; readonly css: string; readonly says: string }
  | {
      readonly kind: 'font'
      readonly css: string
      /** Whether a woff2 file of the theme's own may be named. Only titles and the brand may. */
      readonly files: boolean
      readonly fallback: string
      readonly says: string
    }
  | {
      readonly kind: 'number'
      readonly min: number
      readonly max: number
      readonly unit: 'px' | '%' | 'em' | ''
      readonly integer?: boolean
      readonly css?: string
      readonly says: string
    }
  | {
      readonly kind: 'choice'
      readonly values: readonly string[]
      /** Written as an attribute on the theme's root, because CSS cannot branch on a keyword. */
      readonly attr?: string
      readonly css?: string
      readonly says: string
    }
  | { readonly kind: 'text'; readonly max: number; readonly says: string }
  | { readonly kind: 'flag'; readonly says: string }
  | {
      readonly kind: 'group'
      readonly fields: Readonly<Record<string, Spec>>
      readonly says: string
    }
  | {
      readonly kind: 'colours'
      readonly count: number
      readonly css?: string
      readonly says: string
    }
  | { readonly kind: 'effects'; readonly says: string }
  | { readonly kind: 'tokens'; readonly says: string }

const colour = (css: string | undefined, says: string): Spec => ({ kind: 'colour', css, says })
const fill = (css: string, says: string): Spec => ({ kind: 'fill', css, says })
const group = (says: string, fields: Record<string, Spec>): Spec => ({
  kind: 'group',
  fields,
  says,
})
const percent = (css: string, max: number, says: string): Spec => ({
  kind: 'number',
  min: 0,
  max,
  unit: '%',
  css,
  says,
})
const glass = (css: string, says: string): Spec =>
  group(says, {
    blur: {
      kind: 'number',
      min: 0,
      max: 24,
      unit: 'px',
      css: `${css}-blur`,
      says: 'How much the surface blurs what is behind it.',
    },
    saturate: {
      kind: 'number',
      min: 1,
      max: 1.5,
      unit: '',
      css: `${css}-saturate`,
      says: 'How much the colours behind it are strengthened.',
    },
  })
const inkOnFill = (prefix: string, says: string): Spec =>
  group(says, {
    fill: colour(`${prefix}-bg`, 'Its background.'),
    ink: colour(`${prefix}-ink`, 'Its text.'),
  })
const typeRole = (prefix: string, says: string): Spec =>
  group(says, {
    font: {
      kind: 'font',
      css: `--font-${prefix}`,
      files: true,
      fallback: 'var(--font-sans)',
      says: 'Up to 4 font names, or one woff2 file in assets/fonts/.',
    },
    weight: {
      kind: 'number',
      min: 300,
      max: 900,
      unit: '',
      integer: true,
      css: `--fw-${prefix}`,
      says: 'Weight, 300–900.',
    },
    style: {
      kind: 'choice',
      values: ['normal', 'italic'],
      css: `--font-style-${prefix}`,
      says: 'Upright or italic.',
    },
    letterSpacing: {
      kind: 'number',
      min: -0.02,
      max: 0.08,
      unit: 'em',
      css: `--tracking-${prefix}`,
      says: 'Space between letters.',
    },
  })

/** The whole of `theme.json`. */
export const THEME_SCHEMA: Readonly<Record<string, Spec>> = {
  format: {
    kind: 'number',
    min: THEME_FORMAT,
    max: THEME_FORMAT,
    unit: '',
    integer: true,
    says: 'Always 1.',
  },
  id: { kind: 'text', max: 40, says: 'The folder name: lowercase letters, digits and hyphens.' },
  name: { kind: 'text', max: 60, says: 'The name a person sees.' },
  author: { kind: 'text', max: 60, says: 'Who made it.' },
  description: { kind: 'text', max: 280, says: 'One or two sentences about the look.' },
  extends: { kind: 'text', max: 40, says: 'A built-in theme every unset setting comes from.' },
  localOnly: {
    kind: 'flag',
    says: 'Usable on this computer but never shipped or shared: it uses art the app may not publish.',
  },

  frame: group('The dark frame: title bar and left menu.', {
    ink: colour('--frame-ink', 'Text.'),
    paper: colour('--frame-paper', 'Background.'),
    accent: colour('--frame-accent', 'The main colour for highlights.'),
  }),
  content: group('The content area: the conversation, panels, sheets and toasts.', {
    ink: colour('--content-ink', 'Text. Greys are mixed from it.'),
    paper: colour('--content-paper', 'Card colour.'),
    accent: colour('--content-accent', 'The main colour for links, highlights and buttons.'),
    accent2: colour('--content-accent-2', 'A second colour.'),
    scheme: {
      kind: 'choice',
      values: ['light', 'dark'],
      css: '--content-scheme',
      attr: 'data-content-scheme',
      says: 'Whether built-in controls and scrollbars draw light or dark.',
    },
  }),
  status: group('Colours that carry a meaning.', {
    waiting: colour('--status-waiting', 'Waiting on someone.'),
    success: colour('--status-success', 'Done, healthy.'),
    danger: colour('--status-danger', 'Errors and destructive actions.'),
    auto: colour('--status-auto', 'Automatic approval.'),
  }),
  shared: group('Settings both zones use.', {
    page: percent(
      '--page-depth',
      30,
      'How far the page sits from the cards; 0 is the same colour.',
    ),
    line: percent('--line-strength', 40, 'How visible borders are.'),
    tint: percent('--tint-strength', 30, 'How strong accent-tinted fills are.'),
    shadow: group('Shadows.', {
      strength: percent('--shadow-strength', 40, 'How dark shadows are.'),
      color: colour('--shadow-color', 'The colour shadows are made of.'),
      style: {
        kind: 'choice',
        values: ['soft', 'hard', 'glow'],
        attr: 'data-shadow-style',
        says: 'Soft and blurred, hard and offset, or a coloured glow.',
      },
    }),
    borderWidth: {
      kind: 'number',
      min: 1,
      max: 2,
      unit: 'px',
      integer: true,
      css: '--border-width',
      says: 'Border width.',
    },
    radius: {
      kind: 'number',
      min: 0,
      max: 24,
      unit: 'px',
      css: '--radius-base',
      says: 'Corner roundness.',
    },
    fonts: group('Fonts for reading text.', {
      body: {
        kind: 'font',
        css: '--font-sans',
        files: false,
        fallback: "ui-sans-serif, -apple-system, 'Segoe UI', sans-serif",
        says: 'Up to 4 installed font names; the system font follows.',
      },
      mono: {
        kind: 'font',
        css: '--font-mono',
        files: false,
        fallback: 'ui-monospace, Menlo, Consolas, monospace',
        says: 'Up to 4 installed monospace font names.',
      },
    }),
    textBase: {
      kind: 'number',
      min: 12,
      max: 18,
      unit: 'px',
      css: '--type-base',
      says: 'Body text size.',
    },
    typeRatio: {
      kind: 'number',
      min: 1.1,
      max: 1.35,
      unit: '',
      css: '--type-ratio',
      says: 'How fast titles grow.',
    },
    accentStyle: {
      kind: 'choice',
      values: ['tinted', 'solid'],
      attr: 'data-accent-style',
      says: 'Primary buttons tinted, or solid accent.',
    },
  }),
  kinds: {
    kind: 'colours',
    count: 8,
    css: '--kind',
    says: 'Exactly 8 colours, for kinds of things: event kinds, file types, effort.',
  },

  window: group('Behind everything.', {
    background: fill(
      '--window-bg',
      'The window background; a picture here shows through translucent panels.',
    ),
  }),
  rail: group('The left menu.', {
    background: fill('--rail-bg', 'Its background.'),
    edge: fill('--rail-edge', 'A strip at most 8 px wide, drawn inside its right edge.'),
    glass: glass('--rail-glass', 'Frosted glass over the window background.'),
    item: group('Its rows.', {
      active: inkOnFill('--rail-item-active', 'The open row.'),
      hover: inkOnFill('--rail-item-hover', 'A row under the pointer.'),
    }),
  }),
  titlebar: group('The title bar.', {
    background: fill('--titlebar-bg', 'Its background.'),
    ink: colour('--titlebar-ink', 'Its text.'),
    inkGlow: colour('--titlebar-ink-glow', 'A soft shadow behind its text.'),
  }),
  brand: group('The logo tile and the name beside it.', {
    mark: fill('--brand-mark', 'The logo tile; a picture here replaces the drawn mark.'),
    markInk: colour('--brand-mark-ink', 'The drawn mark; transparent hides it behind a picture.'),
    markEdge: colour('--brand-mark-edge', 'The tile’s border.'),
  }),
  type: group('Fonts for titles and the brand.', {
    display: typeRole('display', 'Conversation titles and headings.'),
    brand: typeRole('brand', 'The name beside the logo.'),
  }),
  conversation: group('The conversation area.', {
    background: fill('--conversation-bg', 'Its background, under the messages.'),
    glass: glass('--conversation-glass', 'Frosted glass over the window background.'),
    textBacking: inkOnFill(
      '--conversation-text-backing',
      'A chip behind status text that floats over a picture. The app draws the chip.',
    ),
  }),
  composer: group('Where a person types.', {
    surround: fill('--composer-surround', 'The band around the typing field.'),
    field: group('The typing field.', {
      fill: colour('--composer-field-bg', 'Its background.'),
      ink: colour('--composer-field-ink', 'Its text.'),
      line: colour('--composer-field-line', 'Its border.'),
    }),
  }),
  drawer: group('The panel on the right.', {
    background: fill('--drawer-panel-bg', 'Its background.'),
    tabs: fill('--drawer-tabs-bg', 'The tab strip.'),
    card: group('Its cards.', {
      fill: colour('--drawer-card-bg', 'Background.'),
      ink: colour('--drawer-card-ink', 'Text.'),
      line: colour('--drawer-card-line', 'Border.'),
    }),
  }),
  controls: group('Buttons and fields.', {
    style: {
      kind: 'choice',
      values: ['flat', 'bevel'],
      attr: 'data-controls',
      says: 'Flat, or raised with a bevel.',
    },
    bevel: group('The bevel’s two edges.', {
      light: colour('--bevel-light', 'The lit edge.'),
      dark: colour('--bevel-dark', 'The shaded edge.'),
    }),
  }),
  scrollbar: group('Scrollbars. Their width stays the app’s.', {
    style: {
      kind: 'choice',
      values: ['thin', 'bevel'],
      attr: 'data-scrollbar',
      says: 'Thin, or a bevelled thumb.',
    },
    thumb: colour('--scrollbar-thumb-color', 'The part that moves.'),
    track: fill('--scrollbar-track', 'The groove.'),
  }),
  pictures: group('Pictures in the window.', {
    tone: {
      kind: 'choice',
      values: ['colour', 'grey'],
      attr: 'data-pictures',
      says: 'In colour, or grey.',
    },
  }),
  motion: group('Movement.', {
    underReduceMotion: {
      kind: 'choice',
      values: ['off', 'stepped'],
      says: 'Under Reduce Motion, effects stop, or keep moving in steps of at most 8 a second.',
    },
    transitions: {
      kind: 'choice',
      values: ['normal', 'none'],
      attr: 'data-motion',
      says: 'Whether the app’s own fades and slides run.',
    },
  }),
  effects: { kind: 'effects', says: 'Up to 4 built-in effects. See the effects list.' },
  tokens: {
    kind: 'tokens',
    says: 'Hand-tuned colours for named colour tokens, per zone: { "frame": {…}, "content": {…} }.',
  },
}

/**
 * Settings the window doesn't paint yet. A theme is read without them, so a theme that sets one is
 * refused like any unknown setting, and the catalogue leaves them out.
 */
export const HELD_SETTINGS: readonly string[] = [
  'rail.glass',
  'conversation.glass',
  'conversation.textBacking',
  'scrollbar',
  'motion.underReduceMotion',
  'effects',
]

function withoutHeld(
  fields: Readonly<Record<string, Spec>>,
  at = '',
): Readonly<Record<string, Spec>> {
  const out: Record<string, Spec> = {}
  for (const [key, spec] of Object.entries(fields)) {
    const path = at ? `${at}.${key}` : key
    if (HELD_SETTINGS.includes(path)) continue
    out[key] = spec.kind === 'group' ? { ...spec, fields: withoutHeld(spec.fields, path) } : spec
  }
  return out
}

/** The settings a theme can set: the whole schema without the held ones. */
export const LIVE_THEME_SCHEMA: Readonly<Record<string, Spec>> = withoutHeld(THEME_SCHEMA)

/** Woff2 files a theme may name, and where. */
export const FONT_FILE_FOLDER = 'assets/fonts/'

/** Fonts that draw letters as symbols, so words would be unreadable. */
export const SYMBOL_FONTS: ReadonlySet<string> = new Set([
  'wingdings',
  'wingdings 2',
  'wingdings 3',
  'webdings',
  'zapf dingbats',
  'symbol',
  'marlett',
  'bodoni ornaments',
])

/** Generic family keywords a font list may end with; written unquoted. */
export const GENERIC_FONTS: ReadonlySet<string> = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
])

/**
 * The colour tokens a theme may set by hand in `tokens`, per zone. Each is declared in tokens.css,
 * and the readability check measures each one where the window draws it.
 */
export const OVERRIDABLE_TOKENS: readonly string[] = [
  'panel',
  'panel-2',
  'panel-3',
  'line',
  'line-strong',
  'text',
  'text-soft',
  'muted',
  'faint',
  'placeholder',
  'accent',
  'accent-text',
  'accent-link',
  'accent-fill',
  'accent-fill-weak',
  'accent-fill-strong',
  'accent-border',
  'accent-border-weak',
  'accent-pill-border',
  'paper-bg',
  'paper-ink',
  'paper-ink2',
  'paper-muted',
  'paper-line',
  'paper-link',
  'chat-bg',
  'drawer-bg',
  'focus-ring-color',
  'chrome-text',
  'waiting',
  'success',
  'danger',
  'auto',
]

/** Colour tokens a theme may set in the content only: nothing in the frame draws them. */
export const CONTENT_ONLY_TOKENS: readonly string[] = ['accent-2-text', 'accent-solid-bg']

/** The colour tokens a theme may set by hand in `zone`. */
export const overridableIn = (zone: 'frame' | 'content'): readonly string[] =>
  zone === 'content' ? [...OVERRIDABLE_TOKENS, ...CONTENT_ONLY_TOKENS] : OVERRIDABLE_TOKENS

/**
 * Surface colours a theme can't set by hand yet: the window draws text on each, and the readability
 * check doesn't measure that text on a hand-set colour. A theme that sets one is refused like any
 * unknown token.
 */
export const HELD_TOKENS: readonly string[] = [
  'bg',
  'app-bg',
  'raised',
  'accent-pill-bg',
  'paper-code-bg',
  'drawer-solid',
  'composer-bg',
  'surface-header-bg',
  'info-bg',
  'code-bg',
  'chrome-selection',
  'toast-bg',
]

/** The built-in effects and their parameters. */
export const EFFECT_TYPES = ['drift', 'float', 'band', 'shimmer', 'reel'] as const
export type EffectType = (typeof EFFECT_TYPES)[number]
export const MAX_EFFECTS = 4

/** A parameter of an effect, in the same terms as a setting. */
export type EffectParam = Spec & { readonly required?: boolean }

const picture: EffectParam = {
  kind: 'text',
  max: 120,
  says: 'A picture in assets/.',
  required: true,
}
const period = (min: number, max: number): EffectParam => ({
  kind: 'number',
  min,
  max,
  unit: '',
  says: `Seconds for one cycle, ${min}–${max}.`,
})
const steps: EffectParam = {
  kind: 'number',
  min: 0,
  max: 12,
  unit: '',
  integer: true,
  says: '0 moves smoothly; 2–12 moves in that many steps a second.',
}

export const EFFECT_PARAMS: Readonly<Record<EffectType, Readonly<Record<string, EffectParam>>>> = {
  drift: {
    zone: {
      kind: 'choice',
      values: ['rail', 'conversation', 'window'],
      says: 'Where it drifts.',
      required: true,
    },
    image: picture,
    direction: {
      kind: 'choice',
      values: ['up', 'down', 'left', 'right'],
      says: 'Which way it drifts.',
      required: true,
    },
    period: period(8, 120),
    size: { kind: 'number', min: 8, max: 256, unit: 'px', says: 'Tile size.' },
    opacity: { kind: 'number', min: 0.05, max: 1, unit: '', says: 'How strongly it shows.' },
    steps,
  },
  float: {
    zone: {
      kind: 'choice',
      values: ['rail', 'conversation', 'window'],
      says: 'Where it floats.',
      required: true,
    },
    image: picture,
    anchor: {
      kind: 'choice',
      values: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'],
      says: 'Which corner it is placed from.',
      required: true,
    },
    x: { kind: 'number', min: 0, max: 1200, unit: 'px', says: 'Distance from the anchor, across.' },
    y: {
      kind: 'number',
      min: 0,
      max: 1200,
      unit: 'px',
      says: 'Distance from the anchor, down or up.',
    },
    size: { kind: 'number', min: 16, max: 320, unit: 'px', says: 'Width.' },
    amplitude: {
      kind: 'number',
      min: 0,
      max: 12,
      unit: 'px',
      says: 'How far it bobs; 0 keeps it still.',
    },
    period: period(2, 20),
  },
  band: {
    edge: {
      kind: 'choice',
      values: ['conversation-top', 'above-composer'],
      says: 'Which edge the strip runs along.',
      required: true,
    },
    image: picture,
    height: { kind: 'number', min: 16, max: 160, unit: 'px', says: 'Strip height.' },
    period: period(8, 120),
    steps,
  },
  shimmer: {
    target: {
      kind: 'choice',
      values: ['brand-mark', 'titlebar'],
      says: 'What shines.',
      required: true,
    },
    color: { kind: 'colour', says: 'The colour of the shine.', required: true },
    period: period(3, 30),
  },
  reel: {
    image: picture,
    rope: { kind: 'colours', count: 3, says: 'Three colours for the rope, light to dark.' },
  },
}

/** Sprites walking along a band: `band.sprites`, at most 4. */
export const SPRITE_PARAMS: Readonly<Record<string, EffectParam>> = {
  image: picture,
  frames: {
    kind: 'number',
    min: 2,
    max: 8,
    unit: '',
    integer: true,
    says: 'Frames side by side in the picture.',
    required: true,
  },
  period: period(0.2, 4),
  speed: { kind: 'number', min: 4, max: 200, unit: 'px', says: 'Pixels walked a second.' },
}
export const MAX_SPRITES = 4
