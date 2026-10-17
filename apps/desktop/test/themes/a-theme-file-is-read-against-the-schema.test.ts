import { describe, expect, it } from 'vitest'
import { validateTheme } from '../../src/shared/themes/validate'
import { contextFor, DEFINED, png, SAMPLES, woff2 } from './fixtures'

const base = { format: 1, id: 'mine', name: 'Mine', extends: 'defined' }
const valid = (file: Record<string, unknown>, assets = {}, pictures = {}) =>
  validateTheme(file, contextFor(assets, pictures))
const problems = (file: Record<string, unknown>, assets = {}, pictures = {}) => {
  const r = valid(file, assets, pictures)
  return r.ok ? [] : r.problems
}

describe('every live theme, written as settings, is accepted', () => {
  it.each(Object.entries(SAMPLES))('%s', (_, sample) => {
    const r = validateTheme(sample.file, contextFor(sample.assets, sample.pictures))
    expect(r.ok ? [] : r.problems).toEqual([])
  })

  it('the built-in base is accepted as a built-in', () => {
    const r = validateTheme(DEFINED, { ...contextFor(), builtIn: true })
    expect(r.ok).toBe(true)
  })
})

describe('values come back in one form', () => {
  it('colours become #rrggbb or #rrggbbaa, whatever they were written as', () => {
    const kinds = [
      'rgb(255 0 0 / 50%)',
      'hsl(0 0% 0%)',
      '#ABC',
      '#000',
      '#111',
      '#222',
      '#333',
      '#444',
    ]
    const r = valid({ ...base, kinds })
    expect(r.ok && r.theme.kinds?.slice(0, 3)).toEqual(['#ff000080', '#000000', '#aabbcc'])
  })

  it('a plain colour where a background goes becomes { color }', () => {
    const r = valid({ ...base, rail: { background: '#123456' } })
    expect(r.ok && r.theme.rail?.background).toEqual({ color: '#123456' })
  })

  it('a generic font family is written in lower case, a name as typed', () => {
    const r = valid({ ...base, shared: { fonts: { body: ['Avenir Next', 'Sans-Serif'] } } })
    expect(r.ok && r.theme.shared?.fonts?.body).toEqual(['Avenir Next', 'sans-serif'])
  })
})

describe('what is refused, and the sentence that says so', () => {
  const cases: [string, Record<string, unknown>, RegExp, Record<string, unknown>?][] = [
    [
      'an unknown setting, with the nearest name',
      { ...base, rail: { backgrund: '#000' } },
      /`rail\.backgrund` isn’t a theme setting\. Did you mean `rail\.background`\?/,
    ],
    [
      'an unknown top-level key',
      { ...base, css: '.rail { display: none }' },
      /`css` isn’t a theme setting/,
    ],
    ['a missing id', { format: 1, name: 'x' }, /`id` is needed/],
    ['the wrong format', { ...base, format: 2 }, /`format` is 2; it can be from 1 to 1/],
    ['an id with capitals', { ...base, id: 'My Theme' }, /lowercase letters, digits and hyphens/],
    [
      'a built-in id',
      { ...base, id: 'defined' },
      /“defined” is a built-in theme’s id\. Save your changes under a new id/,
    ],
    [
      'an unknown base',
      { ...base, extends: 'nope' },
      /isn’t a built-in theme\. Use one of “defined”/,
    ],
    [
      'a colour name',
      { ...base, frame: { ink: 'red' } },
      /`frame\.ink` should be a colour, such as #4f46e5/,
    ],
    ['a var() for a colour', { ...base, frame: { ink: 'var(--accent)' } }, /should be one colour/],
    [
      'CSS smuggled into a colour',
      { ...base, frame: { ink: '#fff; display: none' } },
      /should be one colour/,
    ],
    [
      'a border too wide',
      { ...base, shared: { borderWidth: 6 } },
      /`shared\.borderWidth` is 6px; it can be from 1px to 2px/,
    ],
    ['a radius too large', { ...base, shared: { radius: 80 } }, /from 0px to 24px/],
    [
      'text too small',
      { ...base, shared: { textBase: 6 } },
      /`shared\.textBase` is 6px; it can be from 12px to 18px/,
    ],
    ['a half border', { ...base, shared: { borderWidth: 1.5 } }, /should be a whole number/],
    [
      'an unknown choice',
      { ...base, controls: { style: 'hidden' } },
      /should be one of “flat”, “bevel”/,
    ],
    [
      'seven kinds',
      { ...base, kinds: ['#000', '#111', '#222', '#333', '#444', '#555', '#666'] },
      /exactly 8 colours/,
    ],
    [
      'a web address for a picture',
      { ...base, rail: { background: { layers: [{ image: 'https://example.com/a.png' }] } } },
      /is a web address\. Pictures and fonts must be files in the theme’s assets folder/,
    ],
    [
      'a file:// picture',
      { ...base, rail: { background: { layers: [{ image: 'file:///etc/passwd' }] } } },
      /points outside the theme/,
    ],
    [
      'a path that climbs out',
      { ...base, rail: { background: { layers: [{ image: 'assets/../../secret.png' }] } } },
      /points outside the theme/,
    ],
    [
      'a picture not in the folder',
      { ...base, rail: { background: { layers: [{ image: 'assets/none.png' }] } } },
      /names assets\/none\.png, which isn’t in the theme’s folder/,
    ],
    [
      'four layers',
      {
        ...base,
        rail: {
          background: {
            layers: [
              { pattern: { kind: 'dots', color: '#000', size: 4 } },
              { pattern: { kind: 'dots', color: '#000', size: 4 } },
              { pattern: { kind: 'dots', color: '#000', size: 4 } },
              { pattern: { kind: 'dots', color: '#000', size: 4 } },
            ],
          },
        },
      },
      /a list of 1 to 3 layers/,
    ],
    [
      'a layer of an unknown kind',
      { ...base, rail: { background: { layers: [{ video: 'x' }] } } },
      /should be one of \{ "image" \}, \{ "gradient" \} or \{ "pattern" \}/,
    ],
    [
      'a gradient with one stop',
      {
        ...base,
        rail: {
          background: {
            layers: [{ gradient: { type: 'linear', stops: [{ color: '#000', at: 0 }] } }],
          },
        },
      },
      /2 to 8 stops/,
    ],
    [
      'an empty background',
      { ...base, rail: { background: {} } },
      /needs a "color", "layers", or both/,
    ],
    [
      'a font file for reading text',
      { ...base, shared: { fonts: { body: ['assets/fonts/x.woff2'] } } },
      /a font file can be used for titles and the brand only/,
    ],
    [
      'a symbol font',
      { ...base, type: { display: { font: ['Wingdings'] } } },
      /Wingdings draws letters as symbols, so words would be unreadable/,
    ],
    [
      'a font name with quotes',
      { ...base, type: { display: { font: ["Arial'; } * { display: none"] } } },
      /isn’t a font name the app accepts/,
    ],
    [
      'five effects',
      {
        ...base,
        effects: [1, 2, 3, 4, 5].map(() => ({
          type: 'shimmer',
          target: 'titlebar',
          color: '#fff',
        })),
      },
      /has 5 effects; a theme can have up to 4/,
    ],
    [
      'an unknown effect',
      { ...base, effects: [{ type: 'explode' }] },
      /should be one of “drift”, “float”, “band”, “shimmer”, “reel”/,
    ],
    [
      'an effect missing its picture',
      { ...base, effects: [{ type: 'drift', zone: 'rail', direction: 'up' }] },
      /`effects\[0\]\.image` is needed/,
    ],
    [
      'a shimmer that flashes',
      { ...base, effects: [{ type: 'shimmer', target: 'titlebar', color: '#fff', period: 0.2 }] },
      /`effects\[0\]\.period` is 0\.2; it can be from 3 to 30/,
    ],
    [
      'a token nobody may set',
      { ...base, tokens: { frame: { 'rail-w': '#000' } } },
      /`tokens\.frame\.rail-w` isn’t a theme setting/,
    ],
    [
      'control characters in a name',
      { ...base, name: 'Evil‮eman' },
      /invisible control characters/,
    ],
  ]
  it.each(cases)('%s', (_, file, says) => {
    const found = problems(file)
    expect(found.map((p) => p.says).join('\n')).toMatch(says)
  })

  it('names the setting each problem is about', () => {
    expect(problems({ ...base, rail: { glass: { blur: 99 } } })).toEqual([
      { at: 'rail.glass.blur', says: '`rail.glass.blur` is 99px; it can be from 0px to 24px.' },
    ])
  })

  it('reports every problem at once, not the first only', () => {
    expect(
      problems({ ...base, frame: { ink: 'red', paper: 'blue' }, shared: { radius: 99 } }),
    ).toHaveLength(3)
  })

  it('a file that is not a JSON object', () => {
    const r = validateTheme('hello', contextFor())
    expect(r).toEqual({
      ok: false,
      problems: [{ at: '', says: 'A theme file should hold one JSON object.' }],
    })
  })
})

describe('files are held to the limits', () => {
  const withPicture = { ...base, rail: { background: { layers: [{ image: 'assets/a.png' }] } } }
  const sampled = {
    'assets/a.png': {
      darkest: { r: 0, g: 0, b: 0, a: 1 },
      lightest: { r: 40, g: 40, b: 40, a: 1 },
    },
  }

  it('a picture over 4 MB', () => {
    expect(
      problems(withPicture, { 'assets/a.png': png(100, 100, 5 * 1024 * 1024) }, sampled).map(
        (p) => p.says,
      ),
    ).toEqual(['assets/a.png is 5 MB; a picture can be up to 4 MB.'])
  })

  it('a picture over 4096 pixels a side', () => {
    expect(
      problems(withPicture, { 'assets/a.png': png(5000, 100) }, sampled).map((p) => p.says),
    ).toEqual(['assets/a.png is 5000×100 pixels; a picture can be up to 4096 pixels a side.'])
  })

  it('an animated picture', () => {
    const facts = { ...png(100, 100), animated: true }
    expect(problems(withPicture, { 'assets/a.png': facts }, sampled)[0]?.says).toMatch(
      /is animated\. Pictures must be still/,
    )
  })

  it('a font where a picture goes', () => {
    expect(
      problems(
        { ...base, rail: { background: { layers: [{ image: 'assets/a.woff2' }] } } },
        { 'assets/a.woff2': woff2() },
      )[0]?.says,
    ).toMatch(/is a font, not a picture/)
  })

  it('a theme over 12 MB in all', () => {
    const many = Object.fromEntries(
      [1, 2, 3, 4].map((i) => [`assets/p${i}.png`, png(100, 100, 3.5 * 1024 * 1024)]),
    )
    expect(problems({ ...base }, many).map((p) => p.says)).toEqual([
      'The theme’s files come to 14 MB; a theme can be up to 12 MB.',
    ])
  })
})
