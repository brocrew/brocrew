/**
 * Whether a theme's text stays readable, measured on the colours the window will actually paint:
 * semantic colours worked out from the seeds (`DERIVATION`), translucent surfaces composited over
 * whatever is under them, and pictures taken at their darkest and lightest. Every text pair must
 * reach 4.5 to 1 in both zones — the bar `chat-theme.test` holds the app to — and the focus ring
 * and a logo drawn over its tile 3 to 1.
 */
import { contrastRatio, mixOklab, mixSrgb, over, parseColour, type Rgba } from './colour'
import { deriveZone, frameStatus, type DerivedZone, type ZoneSeeds } from './derive'
import type { Theme, ThemeFill, ThemeProblem } from './theme'

/**
 * A picture's darkest and lightest colours, sampled by the host from a shrunken copy, and whether
 * any of it is see-through (alpha below 1), in which case what is under it still shows.
 */
export interface PictureSamples {
  readonly darkest: Rgba
  readonly lightest: Rgba
  readonly seeThrough?: boolean
}

export const TEXT_CONTRAST = 4.5
export const MARK_CONTRAST = 3

/**
 * Seeds a theme leaves unset: the frame as the app draws it today, and the content as the derived
 * look (`defined`) seeds it. Today's content colours are hand-picked, not derived, so they can't
 * stand in for seeds.
 */
export const DEFAULT_SEEDS = {
  frame: { ink: '#e3e8f4', paper: '#182135', accent: '#a7b7ff' },
  content: { ink: '#1b2238', paper: '#ffffff', accent: '#4f46e5' },
  page: 7,
  line: 16,
  tint: 10,
  shadow: 9,
} as const

/** The content's status colours a theme leaves unset, as tokens.css seeds them. */
export const DEFAULT_STATUS = {
  waiting: '#784f10',
  success: '#05725a',
  danger: '#ac3d49',
  auto: '#9a510d',
} as const

const STATUS_NAMES = ['waiting', 'success', 'danger', 'auto'] as const

/** How much of the accent a solid button keeps under the pointer, the rest its text's colour. */
export const SOLID_HOVER_ACCENT = 88

/** How a refusal names each status colour. */
const STATUS_WORDS: Readonly<Record<(typeof STATUS_NAMES)[number], string>> = {
  waiting: '“waiting”',
  success: '“done”',
  danger: '“error”',
  auto: '“automatic approval”',
}

/**
 * The accent's fixed shares in its sRGB mixes with the panel, `--accent-mix-N` in tokens.css. The
 * right-hand panel draws accent text on each: its run values, filters, chips and file tags.
 */
export const ACCENT_MIXES = [4, 5, 8, 9, 10, 12] as const

/** How much of the content's accent a document's links keep, the rest the content's ink. */
export const PAPER_LINK = 85

/**
 * The see-through wash behind a dialog in the content, and behind the right-hand panel floating over
 * a narrow window: `--overlay-backdrop` in tokens.css.
 */
export const OVERLAY_BACKDROP: Rgba = { r: 38, g: 51, b: 80, a: 0.28 }

/** The second accent a theme leaves unset, `--content-accent-2` in tokens.css. */
export const DEFAULT_ACCENT_2 = '#7953b9'

/** How much of the second accent its text form keeps, the rest the zone's ink. */
export const ACCENT_2_TEXT = 80

/** The waiting colour's share in the sign-in bar's wash, `--waiting-bg` in tokens.css. */
export const WAITING_WASH = 9

/**
 * The content's ink washes, `--wash-2` and `--wash-3` in tokens.css's light scope, which no theme
 * sets: a workflow's block, and its open buttons under the pointer.
 */
export const WASHES: Readonly<Record<2 | 3, Rgba>> = {
  2: { r: 40, g: 51, b: 78, a: 0.035 },
  3: { r: 40, g: 51, b: 78, a: 0.045 },
}

/** How much of a status colour its text form keeps, the rest the zone's ink. */
export const STATUS_TEXT = 85

/** How much of a card's ink its text keeps, the rest the card's fill, by kind of text. */
export const CARD_TEXT = { text: 100, 'text-soft': 85, muted: 76, faint: 72 } as const

/** The status words the title bar draws: an error, and a build that isn't clean. */
const TITLEBAR_STATUSES: readonly string[] = [STATUS_WORDS.danger, STATUS_WORDS.waiting]

/** One colour something is painted over, and how to name it in a sentence. */
interface Backdrop {
  readonly colour: Rgba
  readonly from: string
}

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }
const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 }
const colour = (text: string | undefined, fallback: Rgba): Rgba =>
  text ? (parseColour(text) ?? fallback) : fallback

/** A faint wash over each backdrop, named as the backdrop it tints. */
const washed = (wash: Rgba, under: readonly Backdrop[]): Backdrop[] =>
  under.map((u) => ({ colour: over(wash, u.colour), from: u.from }))

function zoneSeeds(theme: Theme, zone: 'frame' | 'content'): ZoneSeeds {
  const set = theme[zone]
  const d = DEFAULT_SEEDS[zone]
  return {
    ink: colour(set?.ink, parseColour(d.ink)!),
    paper: colour(set?.paper, parseColour(d.paper)!),
    accent: colour(set?.accent, parseColour(d.accent)!),
    page: theme.shared?.page ?? DEFAULT_SEEDS.page,
    line: theme.shared?.line ?? DEFAULT_SEEDS.line,
    tint: theme.shared?.tint ?? DEFAULT_SEEDS.tint,
    shadow: theme.shared?.shadow?.strength ?? DEFAULT_SEEDS.shadow,
    ...(theme.shared?.shadow?.color
      ? { shadowColour: colour(theme.shared.shadow.color, BLACK) }
      : zone === 'frame'
        ? { shadowColour: BLACK }
        : {}),
  }
}

/** Derived colours, with any hand-tuned `tokens` for that zone on top. */
function zoneColours(theme: Theme, zone: 'frame' | 'content'): DerivedZone {
  const derived: Record<string, Rgba> = { ...deriveZone(zoneSeeds(theme, zone)) }
  const tokens = theme.tokens?.[zone] ?? {}
  for (const [name, value] of Object.entries(tokens)) {
    const c = parseColour(value)
    if (!c) continue
    if (name === 'chat-bg') derived['paper-bg'] = c
    else if (name in derived) derived[name] = c
  }
  return derived as DerivedZone
}

class Measure {
  readonly problems: ThemeProblem[] = []

  constructor(private readonly pictures: ReadonlyMap<string, PictureSamples>) {}

  /**
   * The colours a background shows: its colour (or `base` when it sets none) over what is under
   * it when see-through, then its layers from the bottom one up. A gradient covers everything
   * under it, and so does a picture that tiles or covers the area with no see-through pixels; a
   * pattern, or a single picture placed once, leaves some of what is under showing.
   */
  backdrops(
    fill: ThemeFill | undefined,
    at: string,
    base: Rgba,
    baseFrom: string,
    under: readonly Backdrop[],
  ): Backdrop[] {
    const own = fill?.color ? colour(fill.color, base) : base
    const ownFrom = fill?.color ? 'its background' : baseFrom
    let shown: Backdrop[] =
      own.a >= 1
        ? [{ colour: own, from: ownFrom }]
        : under.map((u) => ({ colour: over(own, u.colour), from: u.from }))
    const layers = [...(fill?.layers ?? []).entries()].reverse()
    for (const [i, layer] of layers) {
      const lat = `${at}.layers[${i}]`
      const colours: Backdrop[] = []
      let covers = 'gradient' in layer
      if ('image' in layer) {
        const s = this.pictures.get(layer.image)
        if (!s) {
          this.problems.push({
            at: `${lat}.image`,
            says: `The app couldn’t read the colours of ${layer.image}, so it can’t tell whether text over it is readable.`,
          })
          continue
        }
        colours.push(
          { colour: s.darkest, from: `the darkest part of ${layer.image}` },
          { colour: s.lightest, from: `the lightest part of ${layer.image}` },
        )
        covers = !s.seeThrough && (layer.size === 'cover' || layer.repeat !== false)
      } else if ('gradient' in layer) {
        for (const stop of layer.gradient.stops)
          colours.push({
            colour: colour(stop.color, TRANSPARENT),
            from: `the gradient in \`${at}\``,
          })
      } else {
        colours.push({
          colour: colour(layer.pattern.color, TRANSPARENT),
          from: `the pattern in \`${at}\``,
        })
      }
      const painted = colours.flatMap((c) =>
        shown.map((b) => ({
          colour: over(c.colour, b.colour),
          from: c.colour.a >= 1 ? c.from : b.from === c.from ? c.from : `${c.from} over ${b.from}`,
        })),
      )
      shown = covers ? painted : [...shown, ...painted]
    }
    return shown
  }

  /** Something painted over each backdrop: a surface colour composited over every one of them. */
  surface(paint: Rgba, from: string, under: readonly Backdrop[]): Backdrop[] {
    if (paint.a >= 1) return [{ colour: paint, from }]
    return under.map((u) => ({ colour: over(paint, u.colour), from: `${from} over ${u.from}` }))
  }

  /** Requires `ink` to reach `min` against every backdrop; reports the worst one. */
  require(
    at: string,
    what: string,
    ink: Rgba,
    on: readonly Backdrop[],
    min: number,
    hint: string,
  ): void {
    let worst: { ratio: number; from: string } | null = null
    for (const b of on) {
      const ratio = contrastRatio(ink, b.colour)
      if (!worst || ratio < worst.ratio) worst = { ratio, from: b.from }
    }
    if (
      !worst ||
      worst.ratio >= min ||
      this.problems.some((p) => p.at === at && p.says.startsWith(what))
    )
      return
    const ratio = Math.floor(worst.ratio * 10) / 10
    const picture = worst.from.includes('part of')
      ? ' Or make the surface over the picture less see-through.'
      : ''
    this.problems.push({
      at,
      says: `${what} would be too faint: ${ratio} to 1 against ${worst.from}, and it needs at least ${min} to 1. ${hint}${picture}`,
    })
  }
}

/** Every readability problem of a resolved theme (its base already merged in). */
export function contrastProblems(
  theme: Theme,
  pictures: ReadonlyMap<string, PictureSamples>,
): ThemeProblem[] {
  const m = new Measure(pictures)
  const frame = zoneColours(theme, 'frame')
  const content = zoneColours(theme, 'content')
  const apart = (zone: string): string =>
    `Move \`${zone}.ink\` and \`${zone}.paper\` further apart.`

  // Behind everything: the window, over the frame's paper.
  const window = m.backdrops(
    theme.window?.background,
    'window.background',
    zoneSeeds(theme, 'frame').paper,
    'the window',
    [{ colour: BLACK, from: 'the window' }],
  )

  // The frame: the left menu's background is where its text sits.
  const rail = m.backdrops(
    theme.rail?.background,
    'rail.background',
    frame.panel,
    'the left menu',
    window,
  )
  m.require('frame.ink', 'Text in the left menu', frame.text, rail, TEXT_CONTRAST, apart('frame'))
  m.require(
    'frame.ink',
    'Secondary text in the left menu',
    frame.muted,
    rail,
    TEXT_CONTRAST,
    apart('frame'),
  )
  m.require(
    'frame.ink',
    'Faint text in the left menu',
    frame.faint,
    rail,
    TEXT_CONTRAST,
    apart('frame'),
  )
  m.require(
    'frame.accent',
    'Links in the left menu',
    frame['accent-text'],
    rail,
    TEXT_CONTRAST,
    'Change `frame.accent`.',
  )
  m.require(
    'frame.accent',
    'The focus ring in the left menu',
    frame['focus-ring-color'],
    rail,
    MARK_CONTRAST,
    'Change `frame.accent`.',
  )

  // The content: text sits on the page, and on cards over it.
  const page = m.backdrops(
    theme.conversation?.background,
    'conversation.background',
    content['paper-bg'],
    'the page',
    window,
  )
  const cards = m.surface(content.panel, 'a card', page)
  const pageHint = `${apart('content')} Or lower \`shared.page\`.`
  for (const [on, where] of [
    [page, 'on the page'],
    [cards, 'on cards'],
  ] as const) {
    m.require('content.ink', `Text ${where}`, content.text, on, TEXT_CONTRAST, pageHint)
    m.require('content.ink', `Secondary text ${where}`, content.muted, on, TEXT_CONTRAST, pageHint)
    m.require('content.ink', `Faint text ${where}`, content.faint, on, TEXT_CONTRAST, pageHint)
    m.require(
      'content.accent',
      `The focus ring ${where}`,
      content['focus-ring-color'],
      on,
      MARK_CONTRAST,
      'Change `content.accent`.',
    )
  }
  m.require(
    'content.accent',
    'Links on cards',
    content['accent-text'],
    cards,
    TEXT_CONTRAST,
    'Change `content.accent`.',
  )
  m.require(
    'content.accent',
    'Links on the page',
    content['accent-text'],
    page,
    TEXT_CONTRAST,
    'Change `content.accent`.',
  )
  // Tinted fills sit on the page as well as on cards.
  // Accent text on every strength of accent tint it is drawn on, in both zones: in the left menu,
  // the new-conversation button sits on the weak tint and on the strong one under the pointer.
  const tints = ['accent-fill-weak', 'accent-fill', 'accent-fill-strong'] as const
  for (const [zone, colours, under] of [
    ['content', content, [...page, ...cards]],
    ['frame', frame, rail],
  ] as const) {
    const tinted = tints.flatMap((tint) =>
      under.flatMap((c) => m.surface(colours[tint], 'an accent-tinted fill', [c])),
    )
    m.require(
      `${zone}.accent`,
      'Accent text on tinted fills',
      colours['accent-text'],
      tinted,
      TEXT_CONTRAST,
      `Change \`${zone}.accent\` or lower \`shared.tint\`.`,
    )
    // The zone's own text sits on the tints too. In the content, rows, filters, notices and said
    // lines hold all of it on every strength; in the left menu, the open section's name and count
    // sit on the usual tint.
    const inks =
      zone === 'content'
        ? ([
            ['Text on the page', colours.text, tinted],
            ['Text on the page', colours['text-soft'], tinted],
            ['Secondary text on the page', colours.muted, tinted],
            ['Faint text on the page', colours.faint, tinted],
          ] as const)
        : ([
            [
              'Text in the left menu',
              colours.text,
              under.flatMap((c) => m.surface(colours['accent-fill'], 'an accent-tinted fill', [c])),
            ],
          ] as const)
    for (const [what, ink, on] of inks) {
      m.require(
        `${zone}.accent`,
        what,
        ink,
        on,
        TEXT_CONTRAST,
        `Change \`${zone}.accent\` or lower \`shared.tint\`.`,
      )
    }
  }

  // The right-hand panel, and the cards it holds. Docked, it sits on the conversation's background.
  // Floating over a narrow window, it stands on the page's own colours, as SessionDrawer paints
  // them under it: the content's paper, then the conversation's colour (and not its picture), with
  // the pane's wash over the page showing only through a see-through paper.
  const pageColour = (paint: Rgba, under: readonly Backdrop[]): Backdrop[] =>
    paint.a >= 1
      ? [{ colour: paint, from: 'the page' }]
      : under.map((u) => ({ colour: over(paint, u.colour), from: 'the page' }))
  const floatingBase = pageColour(
    colour(theme.conversation?.background?.color, TRANSPARENT),
    pageColour(content['paper-bg'], [...page, ...m.surface(OVERLAY_BACKDROP, 'the page', page)]),
  )
  const drawer = [page, floatingBase].flatMap((under) =>
    m.backdrops(
      theme.drawer?.background,
      'drawer.background',
      content['drawer-bg'],
      'the right-hand panel',
      under,
    ),
  )
  const drawerCard = m.surface(colour(theme.drawer?.card?.fill, content.panel), 'a card', drawer)

  // Accent text on the accent's fixed mixes with the panel, which don't follow `shared.tint`, each
  // over what the window paints under it: the run strip on the right-hand panel, the compact door
  // on the strip, file tiles, chips and totals on a card, and a dialog's filters and tags on the
  // dialog over its wash.
  const accent = colour(theme.tokens?.content?.accent, zoneSeeds(theme, 'content').accent)
  const mix = (share: (typeof ACCENT_MIXES)[number], under: readonly Backdrop[]): Backdrop[] =>
    m.surface(mixSrgb(accent, share, content.panel), 'an accent-tinted fill', under)
  const strip = mix(5, drawer)
  const tiles = [...mix(5, drawerCard), ...mix(12, drawerCard)]
  const dialog = m.surface(
    content.panel,
    'a card',
    m.surface(OVERLAY_BACKDROP, 'the right-hand panel', drawer),
  )
  const rows = [...dialog, ...mix(5, dialog)]
  const mixed = [
    ...strip,
    ...mix(8, strip),
    ...mix(10, m.surface(content.panel, 'a card', strip)),
    ...tiles,
    ...mix(12, tiles),
    ...mix(4, drawerCard),
    ...mix(8, drawerCard),
    ...mix(10, dialog),
    ...mix(12, rows),
  ]
  m.require(
    'content.accent',
    'Accent text on tinted fills',
    content['accent-text'],
    mixed,
    TEXT_CONTRAST,
    'Change `content.accent`.',
  )

  // A document's links, on its paper: worked out from the content's accent and ink, in both zones.
  const contentSeeds = zoneSeeds(theme, 'content')
  const documentPaper = m.surface(
    colour(theme.tokens?.content?.['paper-bg'], deriveZone(contentSeeds)['paper-bg']),
    'the page',
    page,
  )
  const paperLink = theme.tokens?.content?.['paper-link']
  m.require(
    paperLink ? 'tokens.content.paper-link' : 'content.accent',
    'Links on the page',
    paperLink
      ? colour(paperLink, TRANSPARENT)
      : mixOklab(contentSeeds.accent, PAPER_LINK, contentSeeds.ink),
    documentPaper,
    TEXT_CONTRAST,
    paperLink ? 'Change `tokens.content.paper-link`.' : 'Change `content.accent`.',
  )

  // The content's raised panels: the model picker on `panel-3`, a popover over whatever opened it
  // (the page, a card, the right-hand panel or a card in it), and the library's filters on
  // `panel-2`, on the page.
  for (const [name, under] of [
    ['panel-3', [...page, ...cards, ...drawer, ...drawerCard]],
    ['panel-2', page],
  ] as const) {
    const raised = m.surface(content[name], 'a card', under)
    const set = theme.tokens?.content?.[name] ? `tokens.content.${name}` : null
    const hint = (otherwise: string): string => (set ? `Change \`${set}\`.` : otherwise)
    for (const [what, ink] of [
      ['Text on cards', content.text],
      ['Text on cards', content['text-soft']],
      ['Secondary text on cards', content.muted],
      ['Faint text on cards', content.faint],
    ] as const) {
      m.require(set ?? 'content.ink', what, ink, raised, TEXT_CONTRAST, hint(apart('content')))
    }
    m.require(
      set ?? 'content.accent',
      'Links on cards',
      content['accent-text'],
      raised,
      TEXT_CONTRAST,
      hint('Change `content.accent`.'),
    )
  }

  // A workflow's block on the page, under an ink wash, and under the pointer its head and its open
  // buttons take a second wash over the first: every ink the block draws is measured on both.
  const block = washed(WASHES[2], page)
  const blockAndHover = [...block, ...washed(WASHES[3], block)]
  for (const [what, ink] of [
    ['Text on the page', content.text],
    ['Text on the page', content['text-soft']],
    ['Secondary text on the page', content.muted],
    ['Faint text on the page', content.faint],
  ] as const) {
    m.require('content.ink', what, ink, blockAndHover, TEXT_CONTRAST, pageHint)
  }
  m.require(
    'content.accent',
    'Links on the page',
    content['accent-text'],
    blockAndHover,
    TEXT_CONTRAST,
    'Change `content.accent`.',
  )

  // An overlay's own panel (the child-work viewer) sits on the overlay's wash over the page.
  const overlayWash = m.surface(OVERLAY_BACKDROP, 'the page', page)

  // Words in the second accent, in its text form, on everything they sit on: the page, the weak
  // tint behind an active filter or a constraint chip, a workflow's or sub-agent's wash and its head
  // under the pointer, and the child-work viewer's panel over the overlay's wash.
  // A theme's own text form is measured where it sets one, and named in the refusal.
  const accent2Set = theme.tokens?.content?.['accent-2-text']
  const accent2At = accent2Set ? 'tokens.content.accent-2-text' : 'content.accent2'
  const accent2Text = accent2Set
    ? colour(accent2Set, TRANSPARENT)
    : mixOklab(
        colour(theme.content?.accent2, parseColour(DEFAULT_ACCENT_2)!),
        ACCENT_2_TEXT,
        contentSeeds.ink,
      )
  const accent2Hint = `Change \`${accent2At}\`.`
  for (const [what, on] of [
    ['Links on the page', [...page, ...blockAndHover]],
    [
      'Accent text on tinted fills',
      m.surface(content['accent-fill-weak'], 'an accent-tinted fill', page),
    ],
    [
      'Links in the right-hand panel',
      m.surface(content['drawer-bg'], 'the right-hand panel', overlayWash),
    ],
  ] as const) {
    m.require(accent2At, what, accent2Text, on, TEXT_CONTRAST, accent2Hint)
  }

  // Colours a theme sets by hand, measured where the window draws them.
  const tuned = (zone: 'frame' | 'content', name: string): Rgba | null =>
    theme.tokens?.[zone]?.[name] ? colour(theme.tokens[zone]![name], TRANSPARENT) : null
  const handSet: [
    zone: 'frame' | 'content',
    name: string,
    what: string,
    on: readonly Backdrop[],
  ][] = [
    ['content', 'accent-link', 'Links on the page', page],
    ['content', 'accent-link', 'Links on cards', cards],
    ['content', 'paper-link', 'Links on the page', page],
    ['content', 'paper-link', 'Links on cards', cards],
    ['content', 'paper-ink', 'Text on the page', page],
    ['content', 'paper-ink2', 'Text on the page', page],
    ['content', 'paper-muted', 'Secondary text on the page', page],
    ['content', 'placeholder', 'Faint text on cards', cards],
    ['frame', 'accent-link', 'Links in the left menu', rail],
    ['frame', 'paper-link', 'Links in the left menu', rail],
    ['frame', 'placeholder', 'Faint text in the left menu', rail],
  ]
  for (const [zone, name, what, on] of handSet) {
    const ink = tuned(zone, name)
    if (!ink) continue
    const at = `tokens.${zone}.${name}`
    m.require(at, what, ink, on, TEXT_CONTRAST, `Change \`${at}\`.`)
  }

  // Solid fills: words in the accent's ink (the zone's paper) on the accent's solid fill. The
  // content always draws them, on its segmented tabs, send buttons and running chips; under the
  // solid accent style, primary buttons draw them too, in both zones, and take a step toward the
  // ink under the pointer. A theme's own solid fill for the content is measured where it sets one.
  const solidStyle = theme.shared?.accentStyle === 'solid'
  for (const [zone, what, on] of [
    ['content', 'Text on solid buttons', page],
    ['frame', 'Text on solid buttons in the left menu', rail],
  ] as const) {
    if (zone === 'frame' && !solidStyle) continue
    const seeds = zoneSeeds(theme, zone)
    const own = zone === 'content' ? theme.tokens?.content?.['accent-solid-bg'] : undefined
    const fill = colour(own ?? theme.tokens?.[zone]?.accent, seeds.accent)
    const at = own ? 'tokens.content.accent-solid-bg' : `${zone}.accent`
    const button = [
      ...m.surface(fill, 'a solid button', on),
      ...(solidStyle
        ? m.surface(mixOklab(fill, SOLID_HOVER_ACCENT, seeds.paper), 'a solid button', on)
        : []),
    ]
    m.require(at, what, seeds.paper, button, TEXT_CONTRAST, `Change \`${at}\`.`)
  }

  // The frame's own paper, which the title bar and the frame's other surfaces stand on.
  const framePaper = m.backdrops(
    undefined,
    'frame.paper',
    zoneSeeds(theme, 'frame').paper,
    'the frame’s paper',
    window,
  )

  // Status colours: the content's on the page and on cards, and the frame's, worked out from them,
  // on the frame's paper and in the left menu. A hand-tuned token is measured instead of the colour
  // it replaces.
  const frameInk = zoneSeeds(theme, 'frame').ink
  const contentInk = zoneSeeds(theme, 'content').ink
  /**
   * Each zone's status colours as the window draws them, and the value that decides each. A status
   * word is drawn in the colour itself and in its text form, the colour a step toward the zone's
   * ink, so both are measured.
   */
  const statuses: {
    word: string
    seed: Rgba
    frame: Rgba
    frameInks: Rgba[]
    frameAt: string
    contentInks: Rgba[]
    contentAt: string
  }[] = []
  for (const name of STATUS_NAMES) {
    const word = STATUS_WORDS[name]
    const seed = colour(theme.status?.[name], parseColour(DEFAULT_STATUS[name])!)
    const onContent = colour(theme.tokens?.content?.[name], seed)
    const onFrame = colour(theme.tokens?.frame?.[name], frameStatus(seed, frameInk))
    const frameInks = [onFrame, mixOklab(onFrame, STATUS_TEXT, frameInk)]
    const contentInks = [onContent, mixOklab(onContent, STATUS_TEXT, contentInk)]
    // A problem is placed at the value that decides the colour: the hand-tuned token when the
    // theme sets one, else the status setting it is worked out from.
    const frameAt = theme.tokens?.frame?.[name] ? `tokens.frame.${name}` : `status.${name}`
    const contentAt = theme.tokens?.content?.[name] ? `tokens.content.${name}` : `status.${name}`
    const change = (at: string): string => `Change \`${at}\`.`
    statuses.push({ word, seed, frame: onFrame, frameInks, frameAt, contentInks, contentAt })
    for (const ink of frameInks) {
      m.require(
        frameAt,
        `The ${word} colour in the left menu`,
        ink,
        rail,
        TEXT_CONTRAST,
        change(frameAt),
      )
      m.require(
        frameAt,
        `The ${word} colour on the frame’s paper`,
        ink,
        framePaper,
        TEXT_CONTRAST,
        change(frameAt),
      )
    }
    // The count of what waits on the person, on the header's button: the waiting colour's text
    // form on that colour's wash, over the header's own paper.
    if (name === 'waiting')
      m.require(
        frameAt,
        `The ${word} colour on the frame’s paper`,
        frameInks[1]!,
        washed(mixSrgb(onFrame, WAITING_WASH, TRANSPARENT), framePaper),
        TEXT_CONTRAST,
        change(frameAt),
      )
    // The sign-in bar: the waiting colour's wash over the page, holding its lines in the waiting
    // colour's text form and, under the pointer, its button's accent text.
    if (name === 'waiting') {
      const bar = washed(mixSrgb(onContent, WAITING_WASH, TRANSPARENT), page)
      m.require(
        contentAt,
        `The ${word} colour on the page`,
        contentInks[1]!,
        bar,
        TEXT_CONTRAST,
        change(contentAt),
      )
      m.require(
        'content.accent',
        'Links on the page',
        content['accent-text'],
        bar,
        TEXT_CONTRAST,
        'Change `content.accent`.',
      )
    }
    for (const ink of contentInks) {
      m.require(
        contentAt,
        `The ${word} colour on the page`,
        ink,
        page,
        TEXT_CONTRAST,
        change(contentAt),
      )
      m.require(
        contentAt,
        `The ${word} colour on cards`,
        ink,
        cards,
        TEXT_CONTRAST,
        change(contentAt),
      )
    }
  }

  // Component settings, measured only where a theme sets them.
  for (const state of ['active', 'hover'] as const) {
    const item = theme.rail?.item?.[state]
    if (!item) continue
    const on = item.fill ? m.surface(colour(item.fill, TRANSPARENT), 'its background', rail) : rail
    const what = `Text of the ${state === 'active' ? 'open' : 'pointed-at'} menu row`
    // A row with an ink draws all its text in it; without one, its name and the lines under it
    // keep the frame's colours.
    const inks = item.ink
      ? [colour(item.ink, frame.text)]
      : [state === 'active' ? frame.text : frame['text-soft'], frame.muted]
    for (const ink of inks) {
      m.require(
        `rail.item.${state}.ink`,
        what,
        ink,
        on,
        TEXT_CONTRAST,
        `Change \`rail.item.${state}\`.`,
      )
    }
  }
  if (theme.titlebar?.background || theme.titlebar?.ink) {
    const bar = m.backdrops(
      theme.titlebar.background,
      'titlebar.background',
      zoneSeeds(theme, 'frame').paper,
      'the title bar',
      window,
    )
    // The bar's own text, and its usage line, are the theme's ink, or else the frame's soft,
    // secondary and faint text and its chrome text.
    const ink = theme.titlebar.ink ? colour(theme.titlebar.ink, frame.text) : null
    const inks = ink
      ? [ink]
      : [
          frame.faint,
          frame.muted,
          frame['text-soft'],
          colour(theme.tokens?.frame?.['chrome-text'], frame.text),
        ]
    for (const ink of inks) {
      m.require(
        'titlebar.ink',
        'Text in the title bar',
        ink,
        bar,
        TEXT_CONTRAST,
        'Change `titlebar.ink` or `titlebar.background`.',
      )
    }
    // Its status words, an error and a build that isn't clean: worked out from the bar's ink as
    // the frame's are from the frame's, or else the frame's own.
    for (const status of statuses.filter((s) => TITLEBAR_STATUSES.includes(s.word))) {
      m.require(
        'titlebar.background',
        `The ${status.word} colour in the title bar`,
        ink ? frameStatus(status.seed, ink) : status.frame,
        bar,
        TEXT_CONTRAST,
        'Change `titlebar.background`.',
      )
    }
  }
  const markInk = theme.brand?.markInk ? colour(theme.brand.markInk, TRANSPARENT) : null
  if (markInk && markInk.a > 0) {
    const tile = m.backdrops(
      theme.brand?.mark,
      'brand.mark',
      frame['panel-2'],
      'the logo tile',
      rail,
    )
    m.require(
      'brand.markInk',
      'The logo',
      markInk,
      tile,
      MARK_CONTRAST,
      'Change `brand.markInk` or `brand.mark`.',
    )
  }
  const backing = theme.conversation?.textBacking
  if (backing) {
    const chip = backing.fill
      ? m.surface(colour(backing.fill, TRANSPARENT), 'the text backing', page)
      : page
    m.require(
      'conversation.textBacking.ink',
      'Status text over the conversation',
      colour(backing.ink, content.muted),
      chip,
      TEXT_CONTRAST,
      'Change `conversation.textBacking`.',
    )
  }
  if (theme.composer?.surround || theme.composer?.field) {
    const band = m.backdrops(
      theme.composer.surround,
      'composer.surround',
      TRANSPARENT,
      'the page',
      page,
    )
    const field = theme.composer.field?.fill
      ? m.surface(colour(theme.composer.field.fill, TRANSPARENT), 'the typing field', band)
      : m.surface(content.panel, 'the typing field', band)
    // What a person types, in the field's ink, and the placeholder before they do: the zone's
    // faint text, or the placeholder colour a theme sets by hand.
    const placeholder = colour(theme.tokens?.content?.placeholder, content.faint)
    for (const ink of [colour(theme.composer.field?.ink, content.text), placeholder]) {
      m.require(
        'composer.field.ink',
        'Text in the typing field',
        ink,
        field,
        TEXT_CONTRAST,
        'Change `composer.field`.',
      )
    }
    // The hint under the field sits on the band.
    m.require(
      'composer.surround',
      'Secondary text on the page',
      content.muted,
      band,
      TEXT_CONTRAST,
      'Change `composer.surround`.',
    )
  }
  if (theme.drawer?.background || theme.drawer?.card || theme.drawer?.tabs) {
    m.require(
      'drawer.background',
      'Text in the right-hand panel',
      content.text,
      drawer,
      TEXT_CONTRAST,
      'Change `drawer.background`.',
    )
    const panelHint = 'Change `drawer.background`.'
    for (const [what, ink] of [
      ['Secondary text in the right-hand panel', content.muted],
      ['Faint text in the right-hand panel', content.faint],
      ['Links in the right-hand panel', content['accent-text']],
    ] as const) {
      m.require('drawer.background', what, ink, drawer, TEXT_CONTRAST, panelHint)
    }
    for (const status of statuses) {
      for (const ink of status.contentInks) {
        m.require(
          'drawer.background',
          `The ${status.word} colour in the right-hand panel`,
          ink,
          drawer,
          TEXT_CONTRAST,
          panelHint,
        )
      }
    }
    if (theme.drawer.tabs) {
      const tabs = m.backdrops(
        theme.drawer.tabs,
        'drawer.tabs',
        TRANSPARENT,
        'the right-hand panel',
        drawer,
      )
      // An open tab's name, and the others in soft, secondary and faint text.
      for (const ink of [content.text, content['text-soft'], content.muted, content.faint]) {
        m.require(
          'drawer.tabs',
          'Tab names in the right-hand panel',
          ink,
          tabs,
          TEXT_CONTRAST,
          'Change `drawer.tabs`.',
        )
      }
    }
    const card = drawerCard
    m.require(
      'drawer.card.ink',
      'Text on cards in the right-hand panel',
      colour(theme.drawer.card?.ink, content.text),
      card,
      TEXT_CONTRAST,
      'Change `drawer.card`.',
    )
    // Everything a card holds: with a card ink, its text in the ink and its soft, secondary and
    // faint text worked out from the ink and the fill; without one, the zone's own.
    const cardHint = 'Change `drawer.card`.'
    const cardInk = theme.drawer.card?.ink ? colour(theme.drawer.card.ink, content.text) : null
    const cardFill = colour(theme.drawer.card?.fill, content.panel)
    const cardText = (ink: keyof typeof CARD_TEXT): Rgba =>
      cardInk ? mixOklab(cardInk, CARD_TEXT[ink], cardFill) : content[ink]
    for (const [what, inks] of [
      ['Text on cards', ['text', 'text-soft']],
      ['Secondary text on cards', ['muted']],
      ['Faint text on cards', ['faint']],
    ] as const) {
      for (const ink of inks) {
        m.require('drawer.card.fill', what, cardText(ink), card, TEXT_CONTRAST, cardHint)
      }
    }
    m.require(
      'drawer.card.fill',
      'Links on cards',
      content['accent-text'],
      card,
      TEXT_CONTRAST,
      cardHint,
    )
    for (const status of statuses) {
      for (const ink of status.contentInks) {
        m.require(
          'drawer.card.fill',
          `The ${status.word} colour on cards`,
          ink,
          card,
          TEXT_CONTRAST,
          cardHint,
        )
      }
    }
  }
  if (theme.scrollbar?.thumb) {
    const track = m.backdrops(
      theme.scrollbar.track,
      'scrollbar.track',
      TRANSPARENT,
      'the page',
      page,
    )
    m.require(
      'scrollbar.thumb',
      'The scrollbar',
      colour(theme.scrollbar.thumb, TRANSPARENT),
      track,
      MARK_CONTRAST,
      'Change `scrollbar.thumb` or `scrollbar.track`.',
    )
  }
  return m.problems
}
