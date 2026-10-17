import { describe, expect, it } from 'vitest'
import type { AssetFacts } from '../../src/shared/themes/assets'
import type { PictureSamples } from '../../src/shared/themes/contrast'
import { validateTheme } from '../../src/shared/themes/validate'
import { contextFor, png, woff2 } from './fixtures'

const base = { format: 1, id: 'mine', name: 'Mine', extends: 'defined' }
const problems = (
  file: Record<string, unknown>,
  assets: Record<string, AssetFacts> = {},
  pictures: Record<string, PictureSamples> = {},
) => {
  const r = validateTheme(file, contextFor(assets, pictures))
  return r.ok ? [] : r.problems
}
const COLOUR = 'should be a colour, such as #4f46e5 or rgb(79 70 229 / 80%), not'

/** The rail's background, as one layer, so each case below names only its layer. */
const railLayer = (layer: unknown) => ({ ...base, rail: { background: { layers: [layer] } } })
const LAYER = 'rail.background.layers[0]'
const PICTURE = { 'assets/a.png': png(100, 100) }
const DARK = {
  'assets/a.png': { darkest: { r: 0, g: 0, b: 0, a: 1 }, lightest: { r: 40, g: 40, b: 40, a: 1 } },
}

describe('text a theme may write', () => {
  it('refuses a name longer than it may be, saying how long it is', () => {
    expect(problems({ ...base, name: 'x'.repeat(61) })).toEqual([
      { at: 'name', says: '`name` is 61 characters long; it can be up to 60.' },
    ])
  })

  it('refuses a name with a bidirectional isolate in it, which could disguise it', () => {
    expect(problems({ ...base, name: 'Mine⁧enim' })).toEqual([
      { at: 'name', says: '`name` has invisible control characters in it.' },
    ])
  })

  it('refuses a flag that is not true or false', () => {
    expect(problems({ ...base, localOnly: 'yes' })).toEqual([
      { at: 'localOnly', says: '`localOnly` should be true or false.' },
    ])
  })

  it('asks for the format when the file names none', () => {
    const { format: _, ...unformatted } = base
    void _
    expect(problems(unformatted)).toEqual([{ at: 'format', says: '`format` should be 1.' }])
  })
})

describe('what a problem says it was given instead', () => {
  it('says null, a list, a kind of value, or the text clipped to 40 characters', () => {
    expect(problems({ ...base, frame: null })).toEqual([
      { at: 'frame', says: '`frame` should be a group of settings, not null.' },
    ])
    expect(problems({ ...base, frame: [] })).toEqual([
      { at: 'frame', says: '`frame` should be a group of settings, not a list.' },
    ])
    expect(problems({ ...base, frame: { ink: 5 } })).toEqual([
      { at: 'frame.ink', says: `\`frame.ink\` ${COLOUR} number.` },
    ])
    expect(problems({ ...base, frame: { ink: 'a'.repeat(50) } })).toEqual([
      { at: 'frame.ink', says: `\`frame.ink\` ${COLOUR} “${'a'.repeat(37)}…”.` },
    ])
  })

  it('suggests the nearest of several close settings', () => {
    expect(problems({ ...base, content: { acent2: '#000' } })).toEqual([
      {
        at: 'content.acent2',
        says: '`content.acent2` isn’t a theme setting. Did you mean `content.accent2`?',
      },
    ])
  })
})

describe('numbers and colour lists', () => {
  it('asks for a number, in the unit the setting has, or in none', () => {
    expect(problems({ ...base, shared: { radius: '12' } })).toEqual([
      { at: 'shared.radius', says: '`shared.radius` should be a number of px, not “12”.' },
    ])
    expect(problems({ ...base, shared: { typeRatio: 'fast' } })).toEqual([
      { at: 'shared.typeRatio', says: '`shared.typeRatio` should be a number, not “fast”.' },
    ])
  })

  it('refuses a list of colours when any one is not a colour, saying which', () => {
    const kinds = ['red', '#111', '#222', '#333', '#444', '#555', '#666', '#777']
    expect(problems({ ...base, kinds })).toEqual([
      { at: 'kinds[0]', says: `\`kinds[0]\` ${COLOUR} “red”.` },
    ])
  })
})

describe('a background', () => {
  it('refuses a plain value that is not a colour, or not a colour or a group', () => {
    expect(problems({ ...base, rail: { background: 'red' } })).toEqual([
      { at: 'rail.background', says: `\`rail.background\` ${COLOUR} “red”.` },
    ])
    expect(problems({ ...base, rail: { background: 5 } })).toEqual([
      {
        at: 'rail.background',
        says: '`rail.background` should be a colour, or { "color", "layers" }.',
      },
    ])
  })

  it('refuses a key other than color and layers, and a color that is not one', () => {
    expect(problems({ ...base, rail: { background: { color: '#000', colr: '#fff' } } })).toEqual([
      {
        at: 'rail.background.colr',
        says: '`rail.background.colr` isn’t a theme setting. Did you mean `rail.background.color`?',
      },
    ])
    expect(problems({ ...base, rail: { background: { color: 'red' } } })).toEqual([
      { at: 'rail.background.color', says: `\`rail.background.color\` ${COLOUR} “red”.` },
    ])
  })

  it('refuses a layer that is not a group', () => {
    expect(problems(railLayer('x'))).toEqual([
      {
        at: LAYER,
        says: `\`${LAYER}\` should be one of { "image" }, { "gradient" } or { "pattern" }.`,
      },
    ])
  })

  it('takes a picture’s size as a percentage, and its repeat across or down only', () => {
    for (const repeat of ['x', 'y'] as const) {
      const r = validateTheme(
        railLayer({ image: 'assets/a.png', size: '70%', repeat }),
        contextFor(PICTURE, DARK),
      )
      expect(r.ok ? r.theme.rail?.background : r.problems).toEqual({
        layers: [{ image: 'assets/a.png', size: '70%', repeat }],
      })
    }
  })

  it('refuses a picture size and a repeat it does not know', () => {
    expect(
      problems(railLayer({ image: 'assets/a.png', size: 'huge', repeat: 'z' }), PICTURE, DARK),
    ).toEqual([
      {
        at: `${LAYER}.size`,
        says: `\`${LAYER}.size\` should be "cover", "contain", "auto", a width in pixels from 8 to 2048, or a percentage such as "70%".`,
      },
      { at: `${LAYER}.repeat`, says: `\`${LAYER}.repeat\` should be true, false, "x" or "y".` },
    ])
  })

  it('refuses a gradient layer holding anything else, or that is not a group', () => {
    const gradient = { type: 'linear', stops: [] }
    expect(problems(railLayer({ gradient, extra: 1 }))).toEqual([
      { at: LAYER, says: `\`${LAYER}\` should hold only "gradient".` },
    ])
    expect(problems(railLayer({ gradient: 'linear' }))).toEqual([
      {
        at: `${LAYER}.gradient`,
        says: `\`${LAYER}.gradient\` should be { "type", "angle", "stops" }.`,
      },
    ])
  })

  it('refuses a gradient when any one stop is wrong, saying which', () => {
    const stops = [
      { color: 'red', at: 0 },
      { color: '#000', at: 100 },
    ]
    expect(problems(railLayer({ gradient: { type: 'linear', stops } }))).toEqual([
      {
        at: `${LAYER}.gradient.stops[0].color`,
        says: `\`${LAYER}.gradient.stops[0].color\` ${COLOUR} “red”.`,
      },
    ])
  })

  it('refuses a pattern layer holding anything else, or that is not a group', () => {
    const pattern = { kind: 'dots', color: '#000', size: 4 }
    expect(problems(railLayer({ pattern, extra: 1 }))).toEqual([
      { at: LAYER, says: `\`${LAYER}\` should hold only "pattern".` },
    ])
    expect(problems(railLayer({ pattern: 'dots' }))).toEqual([
      {
        at: `${LAYER}.pattern`,
        says: `\`${LAYER}.pattern\` should be a group of settings, not “dots”.`,
      },
    ])
  })
})

describe('fonts', () => {
  it('asks for a list of names, each one text', () => {
    expect(problems({ ...base, shared: { fonts: { body: 'Arial' } } })).toEqual([
      {
        at: 'shared.fonts.body',
        says: '`shared.fonts.body` should be a list of 1 to 4 font names.',
      },
    ])
    expect(problems({ ...base, shared: { fonts: { body: ['Arial', 5] } } })).toEqual([
      { at: 'shared.fonts.body[1]', says: '`shared.fonts.body[1]` should be a font name.' },
    ])
  })

  const display = (font: unknown[]) => ({ ...base, type: { display: { font } } })
  const AT = 'type.display.font[0]'

  it('takes a font file only from the fonts folder, and says why another is refused', () => {
    expect(problems(display(['assets/x.woff2']), { 'assets/x.woff2': woff2() })).toEqual([
      { at: AT, says: `\`${AT}\`: a font file must sit in assets/fonts/.` },
    ])
    expect(problems(display(['https://example.com/x.woff2']))).toEqual([
      {
        at: AT,
        says: `\`${AT}\`: “https://example.com/x.woff2” is a web address. Pictures and fonts must be files in the theme’s assets folder.`,
      },
    ])
  })

  it('refuses a font file the folder does not hold, or that is not a woff2 font', () => {
    expect(problems(display(['assets/fonts/none.woff2']))).toEqual([
      {
        at: AT,
        says: `\`${AT}\` names assets/fonts/none.woff2, which isn’t in the theme’s folder.`,
      },
    ])
    expect(
      problems(display(['assets/fonts/x.png']), { 'assets/fonts/x.png': png(10, 10) }),
    ).toEqual([{ at: AT, says: `\`${AT}\` names assets/fonts/x.png, which isn’t a woff2 font.` }])
  })
})

describe('effects', () => {
  it('asks for a list', () => {
    expect(problems({ ...base, effects: {} })).toEqual([
      { at: 'effects', says: '`effects` should be a list of effects.' },
    ])
  })

  it('refuses an effect whose picture the folder does not hold', () => {
    expect(
      problems({
        ...base,
        effects: [{ type: 'drift', zone: 'rail', direction: 'up', image: 'assets/none.png' }],
      }),
    ).toEqual([
      {
        at: 'effects[0].image',
        says: '`effects[0].image` names assets/none.png, which isn’t in the theme’s folder.',
      },
    ])
  })

  const band = (sprites: unknown) => ({
    ...base,
    effects: [{ type: 'band', edge: 'conversation-top', image: 'assets/a.png', sprites }],
  })

  it('asks a band for a list of at most four sprites', () => {
    expect(problems(band('x'), PICTURE)).toEqual([
      {
        at: 'effects[0].sprites',
        says: '`effects[0].sprites` should be a list of up to 4 sprites.',
      },
    ])
  })

  it('refuses a sprite without its picture', () => {
    expect(problems(band([{ frames: 4 }]), PICTURE)).toEqual([
      { at: 'effects[0].sprites[0].image', says: '`effects[0].sprites[0].image` is needed.' },
    ])
  })

  it('refuses sprites on any effect but a band', () => {
    expect(
      problems({
        ...base,
        effects: [{ type: 'shimmer', target: 'titlebar', color: '#fff', sprites: [] }],
      }),
    ).toEqual([{ at: 'effects[0].sprites', says: '`effects[0].sprites` isn’t a theme setting.' }])
  })
})

describe('colour tokens', () => {
  it('asks for the frame and content zones, each a group, and no other zone', () => {
    expect(problems({ ...base, tokens: 'x' })).toEqual([
      { at: 'tokens', says: '`tokens` should be { "frame": {…}, "content": {…} }.' },
    ])
    expect(problems({ ...base, tokens: { frme: {} } })).toEqual([
      {
        at: 'tokens.frme',
        says: '`tokens.frme` isn’t a theme setting. Did you mean `tokens.frame`?',
      },
    ])
    expect(problems({ ...base, tokens: { frame: 'x' } })).toEqual([
      { at: 'tokens.frame', says: '`tokens.frame` should be a group of colour tokens.' },
    ])
  })

  it('refuses a solid fill that lets what is under it through, and a token that is not a colour', () => {
    const AT = 'tokens.content.accent-solid-bg'
    expect(
      problems({ ...base, tokens: { content: { 'accent-solid-bg': 'rgb(0 0 0 / 50%)' } } }),
    ).toEqual([
      {
        at: AT,
        says: `\`${AT}\` should be one colour, such as #4f46e5; “rgb(0 0 0 / 50%)” is something else.`,
      },
    ])
    expect(problems({ ...base, tokens: { content: { 'accent-solid-bg': 'red' } } })).toEqual([
      { at: AT, says: `\`${AT}\` ${COLOUR} “red”.` },
    ])
  })
})

describe('the folder as a whole', () => {
  it('refuses more files than a theme may hold', () => {
    const many = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [`assets/p${i}.png`, png(10, 10, 100)]),
    )
    expect(problems({ ...base }, many)).toEqual([
      { at: 'assets', says: 'The theme has 65 files; it can have up to 64.' },
    ])
  })

  it('refuses more fonts than a theme may hold', () => {
    const fonts = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`assets/fonts/f${i}.woff2`, woff2(100)]),
    )
    expect(problems({ ...base }, fonts)).toEqual([
      { at: 'assets', says: 'The theme has 5 fonts; it can have up to 4.' },
    ])
  })
})
