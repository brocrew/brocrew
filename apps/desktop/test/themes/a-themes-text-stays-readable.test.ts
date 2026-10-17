import { describe, expect, it } from 'vitest'
import { colourCss, contrastRatio, mixOklab, parseColour } from '../../src/shared/themes/colour'
import { contrastProblems } from '../../src/shared/themes/contrast'
import { DERIVATION, deriveZone, frameStatus, mixSrgb } from '../../src/shared/themes/derive'
import { validateTheme } from '../../src/shared/themes/validate'
import { contextFor, png } from './fixtures'

const c = (s: string) => parseColour(s)!
const base = { format: 1, id: 'mine', name: 'Mine', extends: 'defined' }
const says = (file: Record<string, unknown>, assets = {}, pictures = {}) => {
  const r = validateTheme(file, contextFor(assets, pictures))
  return r.ok ? [] : r.problems.map((p) => `${p.at}: ${p.says}`)
}

describe('the colour maths is the engine’s', () => {
  it('reads every form a theme may write', () => {
    expect(colourCss(c('#abc'))).toBe('#aabbcc')
    expect(colourCss(c('#aabbcc80'))).toBe('#aabbcc80')
    expect(colourCss(c('rgb(10, 20, 30)'))).toBe('#0a141e')
    expect(colourCss(c('rgba(10 20 30 / 0.5)'))).toBe('#0a141e80')
    expect(colourCss(c('hsl(120 100% 25%)'))).toBe('#008000')
    expect(colourCss(c('oklch(62.8% 0.2577 29.23)'))).toBe('#ff0000')
    expect(c('transparent').a).toBe(0)
    for (const bad of [
      'red',
      'var(--x)',
      'color-mix(in oklab, red, blue)',
      '#ggg',
      'rgb(1 2)',
      'url(x)',
      '',
    ]) {
      expect(parseColour(bad), bad).toBeNull()
    }
  })

  it('mixes in oklab as color-mix does: half black, half white is #636363', () => {
    expect(colourCss(mixOklab(c('#000'), 50, c('#fff')))).toBe('#636363')
  })

  it('mixes premultiplied, so a transparent side lends no hue', () => {
    expect(colourCss(mixSrgb(c('#ff0000'), 50, c('transparent')))).toBe('#ff000080')
    expect(colourCss(mixOklab(c('#ff0000'), 50, c('transparent')))).toBe('#ff000080')
  })

  it('measures contrast as WCAG does', () => {
    expect(contrastRatio(c('#000'), c('#fff'))).toBeCloseTo(21, 5)
    expect(contrastRatio(c('#777'), c('#fff'))).toBeCloseTo(4.48, 2)
  })

  it('derives every semantic colour of a zone from its seeds', () => {
    const zone = deriveZone({
      ink: c('#1b2238'),
      paper: c('#ffffff'),
      accent: c('#4f46e5'),
      page: 7,
      line: 16,
      tint: 10,
      shadow: 9,
    })
    expect(Object.keys(zone).sort()).toEqual(Object.keys(DERIVATION).sort())
    expect(colourCss(zone.text)).toBe('#1b2238')
    expect(colourCss(zone.panel)).toBe('#ffffff')
    expect(zone['selection-bg'].a).toBeCloseTo(0.22, 2)
  })
})

describe('a theme whose text would be too faint is refused, with the reason', () => {
  it('grey text on grey paper, in the conversation', () => {
    expect(says({ ...base, content: { ink: '#999999', paper: '#ffffff' } }).join('\n')).toMatch(
      /^content\.ink: Text on the page would be too faint: 2\.\d to 1 against the page, and it needs at least 4\.5 to 1\. Move `content\.ink` and `content\.paper` further apart\. Or lower `shared\.page`\.$/m,
    )
  })

  it('the same rule holds in the frame', () => {
    expect(says({ ...base, frame: { ink: '#3a4560', paper: '#182135' } }).join('\n')).toMatch(
      /^frame\.ink: Text in the left menu would be too faint/m,
    )
  })

  it('a pale accent makes links unreadable', () => {
    expect(says({ ...base, content: { accent: '#ffe066' } }).join('\n')).toMatch(
      /content\.accent: Links on cards would be too faint/,
    )
  })

  it('white text in a title bar painted light', () => {
    expect(
      says({ ...base, titlebar: { background: '#f0f0f0', ink: '#ffffff' } }).join('\n'),
    ).toMatch(
      /titlebar\.ink: Text in the title bar would be too faint: 1\.1 to 1 against its background/,
    )
  })

  it('a menu row whose text matches its fill', () => {
    expect(
      says({ ...base, rail: { item: { active: { fill: '#000080', ink: '#000060' } } } }).join('\n'),
    ).toMatch(/rail\.item\.active\.ink/)
  })

  it('a scrollbar thumb the colour of its track', () => {
    expect(says({ ...base, scrollbar: { thumb: '#dddddd', track: '#e0e0e0' } }).join('\n')).toMatch(
      /scrollbar\.thumb: The scrollbar would be too faint/,
    )
  })

  it('a hand-tuned token is measured instead of the derived one', () => {
    expect(says({ ...base, tokens: { content: { muted: '#d0d0d0' } } }).join('\n')).toMatch(
      /Secondary text on the page would be too faint/,
    )
  })
})

describe('status colours stay readable in both zones', () => {
  it('the defaults pass, on the classic frame and the default content', () => {
    expect(says({ ...base }).filter((s) => s.startsWith('status.'))).toEqual([])
  })

  it('a pale status colour is refused on the page, by its name', () => {
    expect(says({ ...base, status: { waiting: '#ffe9a8' } }).join('\n')).toMatch(
      /^status\.waiting: The “waiting” colour on the page would be too faint: .* Change `status\.waiting`\.$/m,
    )
  })

  it('the frame’s colour is worked out from the content’s: mixed toward its ink, it still reads', () => {
    const problems = says({ ...base, status: { danger: '#f2a0a8' } }).join('\n')
    expect(problems).toMatch(/^status\.danger: The “error” colour on the page would be too faint/m)
    expect(problems).not.toMatch(/The “error” colour in the left menu/)
    const mixed = frameStatus(c('#05725a'), c('#e3e8f4'))
    expect(contrastRatio(mixed, c('#182135'))).toBeGreaterThan(4.5)
  })

  it('the frame’s status colours are measured on its paper as well as in the left menu', () => {
    const problems = says({
      ...base,
      frame: { ink: '#1b2238', paper: '#f2f2f2', accent: '#4f46e5' },
      rail: { background: '#1b2238' },
      tokens: { frame: { waiting: '#fff3c4' } },
    }).join('\n')
    expect(problems).toMatch(
      /^tokens\.frame\.waiting: The “waiting” colour on the frame’s paper would be too faint: .* Change `tokens\.frame\.waiting`\.$/m,
    )
    expect(problems).not.toMatch(/The “waiting” colour in the left menu/)
  })

  it('a hand-tuned frame status is measured instead, and its refusal points at that token', () => {
    const problems = says({ ...base, tokens: { frame: { auto: '#2a3550' } } }).join('\n')
    expect(problems).toMatch(
      /^tokens\.frame\.auto: The “automatic approval” colour in the left menu would be too faint: .* Change `tokens\.frame\.auto`\.$/m,
    )
    expect(problems).not.toMatch(/^status\.auto:/m)
  })

  it('a hand-tuned content status is measured instead, and its refusal points at that token', () => {
    const problems = says({ ...base, tokens: { content: { waiting: '#ffe9a8' } } }).join('\n')
    expect(problems).toMatch(
      /^tokens\.content\.waiting: The “waiting” colour on the page would be too faint: .* Change `tokens\.content\.waiting`\.$/m,
    )
    expect(problems).not.toMatch(/^status\.waiting:/m)
  })

  it('a pale status setting with no hand-tuned token is refused at the setting itself', () => {
    const problems = says({ ...base, status: { danger: '#f2a0a8' } }).join('\n')
    expect(problems).toMatch(
      /^status\.danger: The “error” colour on the page would be too faint: .* Change `status\.danger`\.$/m,
    )
  })

  it('a hand-tuned frame token takes the frame’s refusals, the setting keeps the content’s', () => {
    const problems = says({
      ...base,
      status: { danger: '#f2a0a8' },
      tokens: { frame: { danger: '#2a3550' } },
    }).join('\n')
    expect(problems).toMatch(/^tokens\.frame\.danger: The “error” colour in the left menu/m)
    expect(problems).toMatch(/^status\.danger: The “error” colour on the page/m)
    expect(problems).not.toMatch(/^status\.danger: The “error” colour in the left menu/m)
  })
})

describe('a translucent surface over a picture is measured against the picture', () => {
  const photo = { 'assets/photo.jpg': png(2000, 1300) }
  const theme = (paper: string) => ({
    ...base,
    window: { background: { layers: [{ image: 'assets/photo.jpg', size: 'cover' }] } },
    content: { ink: '#0c2a33', paper },
    conversation: { background: paper },
  })

  it('a frosted panel opaque enough passes over a dark photo', () => {
    const dark = { 'assets/photo.jpg': { darkest: c('#1d3b2a'), lightest: c('#ffffff') } }
    expect(says(theme('rgb(255 255 255 / 92%)'), photo, dark)).toEqual([])
  })

  it('a panel too see-through fails over the photo’s darkest part', () => {
    const dark = { 'assets/photo.jpg': { darkest: c('#000000'), lightest: c('#ffffff') } }
    expect(says(theme('rgb(255 255 255 / 30%)'), photo, dark).join('\n')).toMatch(
      /Text on the page would be too faint: \d\.\d to 1 against the darkest part of assets\/photo\.jpg.*Or make the surface over the picture less see-through\./,
    )
  })

  it('the same panel passes over a photo that is light throughout', () => {
    const light = { 'assets/photo.jpg': { darkest: c('#eef4f7'), lightest: c('#ffffff') } }
    // The page's text passes. Only what the right-hand panel holds is refused, where it stands on
    // the see-through paper and lets the photo through: accent text on its tinted fills and the
    // second accent's links in it. And the words on the solid controls, which take that
    // see-through paper as their colour.
    expect(says(theme('rgb(255 255 255 / 30%)'), photo, light)).toEqual([
      expect.stringMatching(
        /^content\.accent: Accent text on tinted fills would be too faint: .* over a card over the right-hand panel over the page,/,
      ),
      expect.stringMatching(
        /^content\.accent2: Links in the right-hand panel would be too faint: .* over the page over the darkest part of assets\/photo\.jpg/,
      ),
      expect.stringMatching(/^content\.accent: Text on solid buttons would be too faint: /),
    ])
  })

  it('a picture the host could not sample is reported, not passed', () => {
    expect(says(theme('rgb(255 255 255 / 88%)'), photo, {}).join('\n')).toMatch(
      /The app couldn’t read the colours of assets\/photo\.jpg, so it can’t tell whether text over it is readable/,
    )
  })

  it('layers stack: a dark gradient over a light picture dims it for the text on top', () => {
    const file = {
      ...base,
      rail: {
        background: {
          layers: [
            {
              gradient: {
                type: 'linear',
                stops: [
                  { color: 'rgb(20 6 0 / 85%)', at: 0 },
                  { color: 'rgb(20 6 0 / 85%)', at: 100 },
                ],
              },
            },
            { image: 'assets/brick.png', size: 32 },
          ],
        },
      },
    }
    const bricks = { 'assets/brick.png': png(16, 16) }
    const sampled = { 'assets/brick.png': { darkest: c('#000000'), lightest: c('#ffcec5') } }
    expect(says(file, bricks, sampled)).toEqual([])
    const undimmed = {
      ...file,
      rail: { background: { layers: [{ image: 'assets/brick.png', size: 32 }] } },
    }
    expect(says(undimmed, bricks, sampled).join('\n')).toMatch(
      /Text in the left menu would be too faint: .* against the lightest part of assets\/brick\.png/,
    )
  })

  it('contrastProblems reads a resolved theme and nothing else', () => {
    expect(contrastProblems({ format: 1, id: 'x', name: 'x' }, new Map())).toEqual([])
  })
})
