import { describe, expect, it } from 'vitest'
import {
  fillDeclarations,
  THEME_ATTRIBUTES,
  themeAssetUrl,
  themeAttributes,
  themeCss,
} from '../../src/shared/themes/css'
import { resolveTheme, type Theme, type ThemeFill } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import { contextFor, DEFINED, SAMPLES } from './fixtures'

function sample(name: string): Theme {
  const s = SAMPLES[name]!
  const r = validateTheme(s.file, contextFor(s.assets, s.pictures))
  if (!r.ok) throw new Error(JSON.stringify(r.problems))
  return resolveTheme(r.theme, DEFINED)
}

/** Every `--name: value` the stylesheet declares. */
const declarations = (css: string): [string, string][] =>
  [...css.matchAll(/^\s*(--[a-z0-9-]+):\s*(.+);$/gm)].map((m) => [m[1]!, m[2]!])

describe('a theme becomes one block of custom properties', () => {
  it('Valentine', () => {
    expect(themeCss(sample('valentine'))).toMatchSnapshot()
  })

  it('Retro Desktop', () => {
    expect(themeCss(sample('retro-desktop'))).toMatchSnapshot()
  })

  it('declares on its own root, with hand-tuned content colours in the light zone only', () => {
    const css = themeCss(sample('beach'))
    expect(css).toMatch(/^:root\[data-theme='beach'\] \{$/m)
    const [rootBlock, lightBlock] = css.split(
      ":root[data-theme='beach'] [data-chat-theme='light'],\n:root[data-theme='beach'] [data-on-white] {\n",
    )
    expect(lightBlock).toBe(
      '  --accent-solid-bg: #116e7c;\n  --accent-text: #055f6b;\n  --paper-link: #055f6b;\n  --muted: #2f525c;\n  --faint: #2f525c;\n  --focus-ring-color: #067482;\n}\n',
    )
    expect(rootBlock).toContain('  --muted: #d3f1f7;\n')
    expect(rootBlock).not.toContain('#2f525c')
  })

  it('a preview takes another scope', () => {
    expect(themeCss(sample('zen'), { scope: "[data-theme-preview='zen']" })).toMatch(
      /^\[data-theme-preview='zen'\] \{$/m,
    )
  })

  it('writes only custom properties, plus a font face for each font file', () => {
    for (const name of Object.keys(SAMPLES)) {
      const css = themeCss(sample(name))
      const withoutFaces = css.replace(/@font-face \{[^}]*\}/g, '')
      for (const line of withoutFaces.split('\n')) {
        expect(line, `${name}: ${line}`).toMatch(
          /^(\s*--[a-z0-9-]+: [^;{}]+;|[^{};]+ \{|[^{};]+,|\}|)$/,
        )
      }
    }
  })

  it('a font file gets a family of the app’s own naming, and its URL on the theme scheme', () => {
    const css = themeCss(sample('valentine'))
    expect(css).toContain('font-family: "brobot-theme-valentine-1";')
    expect(css).toContain(
      'src: url("brobot-theme://valentine/assets/fonts/script.woff2") format("woff2");',
    )
    expect(css).toContain('--font-brand: "brobot-theme-valentine-1", var(--font-sans);')
  })

  it('a file inherited from the base is served from the base’s folder, and measured there', () => {
    const brocrew = validateTheme(
      SAMPLES.brocrew!.file,
      contextFor(SAMPLES.brocrew!.assets, SAMPLES.brocrew!.pictures),
    )
    if (!brocrew.ok) throw new Error('brocrew should be valid')
    const builtIns = new Map([
      ['defined', DEFINED],
      ['brocrew', resolveTheme(brocrew.theme, DEFINED)],
    ])
    const mine = {
      format: 1,
      id: 'mine',
      name: 'Mine',
      extends: 'brocrew',
      content: { accent: '#c2410c' },
    }
    const unsampled = validateTheme(mine, { assets: new Map(), builtIns })
    expect(unsampled.ok ? [] : unsampled.problems.map((p) => p.says).join('\n')).toMatch(
      /couldn’t read the colours of @brocrew\/assets\/network\.png/,
    )
    const pictures = new Map(
      Object.entries(SAMPLES.brocrew!.pictures!).map(
        ([path, s]) => [`@brocrew/${path}`, s] as const,
      ),
    )
    const r = validateTheme(mine, { assets: new Map(), builtIns, pictures })
    expect(r.ok ? [] : r.problems).toEqual([])
    const css = themeCss(resolveTheme(r.ok ? r.theme : DEFINED, builtIns.get('brocrew')))
    expect(css).toContain('--rail-bg-image: url("brobot-theme://brocrew/assets/network.png");')
  })

  it('a file name is escaped in its URL', () => {
    expect(themeAssetUrl('a', 'assets/x y.png', '1')).toBe('brobot-theme://a/assets/x%20y.png?v=1')
  })

  it('refuses a theme that skipped validation', () => {
    expect(() => themeCss({ ...DEFINED, id: "x'] { } * { display: none } [x='" })).toThrow(
      /must be validated/,
    )
  })
})

describe('a background never becomes a shorthand', () => {
  const IMAGE =
    /^(?:none|(?:url\("[^"()]+"\)|(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\))(?:, (?:url\("[^"()]+"\)|(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)))*)$/
  const COLOUR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/

  const fills: [string, ThemeFill][] = [
    ['a colour', { color: '#c2185b' }],
    [
      'a picture with no colour',
      { layers: [{ image: 'assets/heart.png', size: '70%', repeat: false }] },
    ],
    [
      'a picture over a colour',
      { color: '#c2185b', layers: [{ image: 'assets/heart.png', size: 'contain', repeat: false }] },
    ],
    [
      'a gradient',
      {
        layers: [
          {
            gradient: {
              type: 'linear',
              angle: 115,
              stops: [
                { color: '#7a5c2a', at: 0 },
                { color: '#f6e7bf', at: 100 },
              ],
            },
          },
        ],
      },
    ],
    [
      'three layers and a translucent colour',
      {
        color: '#00000080',
        layers: [
          { pattern: { kind: 'grid', color: '#ffffff', size: 8 } },
          {
            gradient: {
              type: 'radial',
              stops: [
                { color: '#ff0000', at: 0 },
                { color: 'transparent', at: 100 },
              ],
            },
          },
          { image: 'assets/a.png', pixelated: true },
        ],
      },
    ],
  ]

  it.each(fills)('brand.mark as %s', (_, mark) => {
    const decls = declarations(themeCss({ ...DEFINED, brand: { mark } }))
    const names = decls.map(([n]) => n).filter((n) => n.startsWith('--brand-mark'))
    expect(names).not.toContain('--brand-mark-bg')
    expect(names).not.toContain('--brand-mark')
    for (const [name, value] of decls) {
      if (name === '--brand-mark-color') expect(value).toMatch(COLOUR)
      if (name === '--brand-mark-image') expect(value).toMatch(IMAGE)
    }
    expect(names).toContain('--brand-mark-image')
  })

  it('a plain colour clears the default picture under it', () => {
    expect(fillDeclarations('--x', { color: '#123456' }, (p) => p)).toEqual([
      ['--x-color', '#123456'],
      ['--x-image', 'none'],
      ['--x-size', 'auto'],
      ['--x-position', '0% 0%'],
      ['--x-repeat', 'repeat'],
      ['--x-rendering', 'auto'],
    ])
  })

  it('every list stays aligned with the pictures it describes, a grid being two', () => {
    const d = Object.fromEntries(
      fillDeclarations('--x', fills[4]![1], (p) => p).map(([n, v]) => [
        n,
        v.split(/, (?![^(]*\))/).length,
      ]),
    )
    expect(d).toMatchObject({ '--x-image': 4, '--x-size': 4, '--x-position': 4, '--x-repeat': 4 })
  })

  it('a pixel-art picture asks for pixelated rendering', () => {
    expect(fillDeclarations('--x', fills[4]![1], (p) => p)).toContainEqual([
      '--x-rendering',
      'pixelated',
    ])
  })
})

describe('keyword settings become attributes on the root', () => {
  it('Retro Desktop sets its controls and scrollbars, Paper its pictures and motion', () => {
    expect(themeAttributes(sample('retro-desktop'))).toEqual({
      'data-shadow-style': 'hard',
      'data-controls': 'bevel',
      'data-scrollbar': 'bevel',
      // Its cards have an ink, so every text inside them takes it.
      'data-card-ink': '',
    })
    expect(themeAttributes(sample('paper'))).toEqual({
      'data-pictures': 'grey',
      'data-motion': 'none',
    })
  })

  it('the list applyTheme clears is every attribute a theme can set', () => {
    expect([...THEME_ATTRIBUTES].sort()).toEqual(
      [
        'data-accent-style',
        'data-card-ink',
        'data-content-scheme',
        'data-controls',
        'data-motion',
        'data-pictures',
        'data-scrollbar',
        'data-shadow-style',
      ].sort(),
    )
  })
})

describe('the settings no sample sets still reach the stylesheet', () => {
  const MINE: Theme = { format: 1, id: 'mine', name: 'Mine' }

  it('the eight kind colours become one numbered property each', () => {
    const kinds = [
      '#000000',
      '#111111',
      '#222222',
      '#333333',
      '#444444',
      '#555555',
      '#666666',
      '#777777',
    ]
    expect(
      declarations(themeCss({ ...MINE, kinds })).filter(([n]) => n.startsWith('--kind')),
    ).toEqual(kinds.map((c, i) => [`--kind-${i + 1}`, c]))
  })

  it('a picture that does not repeat, or repeats across or down only, says so', () => {
    const repeats = ([false, 'x', 'y', undefined] as const).map(
      (repeat) =>
        fillDeclarations('--x', { layers: [{ image: 'assets/a.png', repeat }] }, (p) => p).find(
          ([n]) => n === '--x-repeat',
        )?.[1],
    )
    expect(repeats).toEqual(['no-repeat', 'repeat-x', 'repeat-y', 'repeat'])
  })

  it('one font file named for titles and the brand is declared once, under one family', () => {
    const font = ['assets/fonts/title.woff2']
    const css = themeCss(
      { ...MINE, type: { display: { font }, brand: { font } } },
      { assetUrl: (p) => `brobot-theme://mine/${p}` },
    )
    expect(css.match(/@font-face/g)).toHaveLength(1)
    expect(css).toContain(
      'src: url("brobot-theme://mine/assets/fonts/title.woff2") format("woff2")',
    )
    const fonts = declarations(css).filter(([n]) => n === '--font-display' || n === '--font-brand')
    expect(fonts).toEqual([
      ['--font-display', '"brobot-theme-mine-1", var(--font-sans)'],
      ['--font-brand', '"brobot-theme-mine-1", var(--font-sans)'],
    ])
  })
})
