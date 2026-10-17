import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseColour } from '../../src/shared/themes/colour'
import {
  ACCENT_2_TEXT,
  ACCENT_MIXES,
  DEFAULT_ACCENT_2,
  CARD_TEXT,
  OVERLAY_BACKDROP,
  PAPER_LINK,
  SOLID_HOVER_ACCENT,
  STATUS_TEXT,
  WAITING_WASH,
  WASHES,
} from '../../src/shared/themes/contrast'
import { FRAME_STATUS } from '../../src/shared/themes/derive'
import { validateTheme } from '../../src/shared/themes/validate'
import { contextFor, SAMPLES } from './fixtures'

/**
 * A setting that paints a surface is measured against every ink the window draws on it, not only
 * the ink the setting names. Each theme here passes its own ink and is refused for another one the
 * same surface holds, in the existing sentence.
 */

const APP = { ...contextFor(), readsHeld: false }

const refused = (own: Record<string, unknown>) => {
  const read = validateTheme({ format: 1, id: 'ink', name: 'Ink', extends: 'defined', ...own }, APP)
  return read.ok ? [] : read.problems
}

/** A refusal at `at`, its sentence starting with `what`. */
const problem = (at: string, what: string) =>
  expect.objectContaining({
    at,
    says: expect.stringMatching(new RegExp(`^${what} would be too faint: [\\d.]+ to 1 against `)),
  })

describe('every ink on a themed surface is measured', () => {
  it('a solid button under the pointer, not only at rest', () => {
    // White on this teal reads at rest; a step toward white under the pointer does not.
    const problems = refused({
      content: { accent: '#0e7c86' },
      tokens: { content: { 'accent-text': '#0b5d64' } },
      shared: { accentStyle: 'solid' },
    })
    expect(problems).toContainEqual(problem('content.accent', 'Text on solid buttons'))
  })

  it('the title bar’s secondary text and its status words, not only its ink', () => {
    expect(refused({ titlebar: { background: '#e9e4f5' } })).toContainEqual(
      problem('titlebar.ink', 'Text in the title bar'),
    )
    expect(refused({ titlebar: { background: '#8f1d2c', ink: '#ffffff' } })).toContainEqual(
      problem('titlebar.background', 'The “error” colour in the title bar'),
    )
  })

  it('a menu row given a fill and no ink, in the frame’s own colours', () => {
    const problems = refused({ rail: { item: { active: { fill: '#c9cbe0' } } } })
    expect(problems).toContainEqual(problem('rail.item.active.ink', 'Text of the open menu row'))
  })

  it('the right-hand panel’s secondary and faint text, links and status words', () => {
    const problems = refused({ drawer: { background: '#a9aebb' } })
    expect(problems).toContainEqual(
      problem('drawer.background', 'Secondary text in the right-hand panel'),
    )
  })

  it('its tab names in every state, not only the open one', () => {
    const problems = refused({ drawer: { tabs: '#a9aebb' } })
    expect(problems).toContainEqual(problem('drawer.tabs', 'Tab names in the right-hand panel'))
  })

  it('what a card in the right-hand panel holds, not only its ink', () => {
    // A white ink makes all the card's text white; its links keep the zone's colour.
    const problems = refused({ drawer: { card: { fill: '#2b2b2b', ink: '#ffffff' } } })
    expect(problems).toContainEqual(problem('drawer.card.fill', 'Links on cards'))
    expect(problems.filter((p) => p.says.includes('ext on cards'))).toEqual([])
  })

  it('the typing field’s placeholder, and the hint on the band around it', () => {
    expect(
      refused({ composer: { field: { fill: '#3a3a3a', ink: '#ffffff', line: '#888888' } } }),
    ).toContainEqual(problem('composer.field.ink', 'Text in the typing field'))
    expect(refused({ composer: { surround: '#1e1e1e' } })).toContainEqual(
      problem('composer.surround', 'Secondary text on the page'),
    )
  })

  it('links on the page itself, not only on cards', () => {
    const problems = refused({
      conversation: { background: '#d8dbe6' },
      content: { accent: '#7b8cff' },
      tokens: { content: { 'focus-ring-color': '#3b45b8' } },
    })
    expect(problems).toContainEqual(problem('content.accent', 'Links on the page'))
  })

  // Counterexamples from review: each was accepted while the window drew something else.
  it('a gray solid accent that reads at rest but not under the pointer', () => {
    expect(
      refused({ content: { accent: '#767676' }, shared: { accentStyle: 'solid' } }),
    ).toContainEqual(problem('content.accent', 'Text on solid buttons'))
  })

  it('a dark accent override over a light seed: the hover is worked out from the override', () => {
    const own = {
      content: { accent: '#d0d0d0' },
      tokens: {
        content: { accent: '#2f2f2f', 'accent-text': '#2f2f2f', 'focus-ring-color': '#2f2f2f' },
      },
      shared: { accentStyle: 'solid' },
    }
    const solid = refused(own).filter((p) => p.says.startsWith('Text on solid buttons'))
    expect(solid).toEqual([])
  })

  it('a gray tab strip, where the hovered open tab’s softer name would not read', () => {
    expect(refused({ drawer: { tabs: '#9e9e9e' } })).toContainEqual(
      problem('drawer.tabs', 'Tab names in the right-hand panel'),
    )
  })

  it('a light title bar with a dark ink is accepted only because every word on it uses the ink', () => {
    expect(refused({ titlebar: { background: '#e3e8f4', ink: '#182135' } })).toEqual([])
  })

  it('a dark card with white ink: what else the card holds is measured', () => {
    expect(refused({ drawer: { card: { fill: '#182135', ink: '#ffffff' } } })).toContainEqual(
      problem('drawer.card.fill', 'Links on cards'),
    )
  })

  it('a dark band around the typing field: the hint on it is measured', () => {
    expect(refused({ composer: { surround: '#182135' } })).toContainEqual(
      problem('composer.surround', 'Secondary text on the page'),
    )
  })

  it('a placeholder colour set by hand, measured in the typing field where it is drawn', () => {
    const problems = refused({
      composer: { field: { fill: '#ffffff' } },
      tokens: { content: { placeholder: '#ffffff' } },
    })
    expect(problems).toContainEqual(problem('composer.field.ink', 'Text in the typing field'))
  })

  it('a link colour set by hand, measured on the page and on cards', () => {
    expect(refused({ tokens: { content: { 'accent-link': '#c9d6ff' } } })).toContainEqual(
      problem('tokens.content.accent-link', 'Links on the page'),
    )
  })

  it('the text inside a card without an ink, in the zone’s own colours', () => {
    expect(refused({ drawer: { card: { fill: '#182135' } } })).toContainEqual(
      problem('drawer.card.fill', 'Text on cards'),
    )
  })

  it('⛔ a surface colour the check can’t measure text on is refused like an unknown token', () => {
    const problems = refused({ tokens: { content: { 'toast-bg': '#000000' } } })
    expect(problems).toEqual([
      expect.objectContaining({
        at: 'tokens.content.toast-bg',
        says: expect.stringMatching(/^`tokens\.content\.toast-bg` isn’t a theme setting\./),
      }),
    ])
  })

  // The last counterexamples from review, as recipes: each passed while an ink was drawn at 1:1.
  it('a white placeholder set by hand in a white typing field', () => {
    expect(
      refused({
        composer: { field: { fill: '#ffffff' } },
        tokens: { content: { placeholder: '#ffffff' } },
      }),
    ).toContainEqual(problem('composer.field.ink', 'Text in the typing field'))
  })

  it('a frame text set by hand over a black frame: the usage line draws it, and it reads', () => {
    expect(
      refused({
        frame: { ink: '#000000', paper: '#000000', accent: '#ffffff' },
        tokens: {
          frame: {
            text: '#ffffff',
            'text-soft': '#ffffff',
            muted: '#ffffff',
            faint: '#ffffff',
            waiting: '#ffffff',
            success: '#ffffff',
            danger: '#ffffff',
            auto: '#ffffff',
          },
        },
        titlebar: { background: '#000000' },
      }),
    ).toEqual([])
  })

  it('white card ink on a black card over a gray page: what the card holds draws in the ink', () => {
    expect(
      refused({
        content: { ink: '#000000', paper: '#767676', accent: '#4f46e5' },
        shared: { page: 0 },
        tokens: {
          content: {
            muted: '#ffffff',
            faint: '#ffffff',
            'accent-text': '#ffffff',
            'focus-ring-color': '#ffffff',
            waiting: '#ffffff',
            success: '#ffffff',
            danger: '#ffffff',
            auto: '#ffffff',
          },
        },
        drawer: { background: '#767676', card: { fill: '#000000', ink: '#ffffff' } },
      }).filter((p) => p.at.startsWith('drawer.card')),
    ).toEqual([])
  })

  it('a white waiting colour on a gray page: its label, a step toward the ink, does not read', () => {
    const white = '#ffffff'
    const problems = refused({
      content: { ink: '#000000', paper: '#767676', accent: '#4f46e5' },
      shared: { page: 0 },
      tokens: {
        content: {
          muted: white,
          faint: white,
          'accent-text': white,
          'focus-ring-color': white,
          waiting: white,
          success: white,
          danger: white,
          auto: white,
        },
      },
    })
    expect(problems).toContainEqual(
      problem('tokens.content.waiting', 'The “waiting” colour on the page'),
    )
  })

  it('the count of what waits on the person, on the waiting colour’s wash in the frame', () => {
    // Its text form reads on this dark frame's paper and in the left menu, and not on the wash the
    // header's count sits on.
    const problems = refused({
      frame: { ink: '#f2f2f7', paper: '#3b3b45', accent: '#a5b4fc' },
      status: { waiting: '#344247' },
    })
    expect(problems).toEqual([
      problem('status.waiting', 'The “waiting” colour on the frame’s paper'),
    ])
  })

  it('accent text on the strongest tint it is drawn on, not only the usual one', () => {
    // Its text form reads 4.8:1 on the usual tint and 4.2:1 on the strong one behind a join line.
    expect(refused({ content: { accent: '#7048e8' }, shared: { tint: 22 } })).toContainEqual(
      problem('content.accent', 'Accent text on tinted fills'),
    )
  })

  it('accent text on the left menu’s strong tint, behind the new-conversation button', () => {
    // A light frame whose accent text reads 5.6:1 on the weak tint and 4.2:1 on the strong one.
    const problems = refused({
      frame: { ink: '#1b2238', paper: '#ffffff', accent: '#7048e8' },
      content: { accent: '#4338ca' },
      shared: { tint: 22 },
    })
    expect(problems).toContainEqual(problem('frame.accent', 'Accent text on tinted fills'))
  })

  it('accent text on the accent’s fixed mixes with the panel, which no tint setting lowers', () => {
    // A light accent with no tint: its text form reads 4.7:1 on white, under 4.5:1 on its 8–12% mixes.
    const problems = refused({ content: { accent: '#7582df' }, shared: { page: 0, tint: 0 } })
    expect(problems).toContainEqual(problem('content.accent', 'Accent text on tinted fills'))
  })

  it('accent text on a mix over what the window paints under it: a dark card, under a see-through panel', () => {
    // On the page the 12% mix reads 4.6:1; over the card it is drawn on, 4.0:1.
    const problems = refused({
      content: { ink: '#ffffff', paper: '#000000', accent: '#4c6ef5', scheme: 'dark' },
      status: { waiting: '#ffd27a', success: '#7dffc8', danger: '#ffb3bd', auto: '#ffcf9e' },
      tokens: { content: { panel: '#00000000', 'accent-text': '#7c7c7c' } },
      drawer: { card: { fill: '#111111' } },
    })
    expect(problems).toContainEqual(problem('content.accent', 'Accent text on tinted fills'))
  })

  it('the right-hand panel on the conversation’s background docked, and on the page’s own colours floating', () => {
    // A see-through panel and cards: the mixes show what is under the panel, not the window's black.
    const seeThrough = (accentText: string, more: object = {}, conversation = '#111111') =>
      refused({
        frame: { ink: '#ffffff', paper: '#000000', accent: '#ffffff' },
        content: { ink: '#ffffff', paper: '#000000', accent: '#4c6ef5' },
        shared: { page: 0, tint: 0 },
        status: { waiting: '#ffffff', success: '#ffffff', danger: '#ffffff', auto: '#ffffff' },
        tokens: { content: { panel: '#00000000', 'accent-text': accentText, ...more } },
        conversation: { background: { color: conversation } },
        drawer: { background: { color: '#00000000' }, card: { fill: '#00000000' } },
      })
    /** Accent text on the panel's tinted tiles, refused at `ratio` over the `stack` named. */
    const tinted = (ratio: string, stack: string) =>
      expect.objectContaining({
        at: 'content.accent',
        says: expect.stringMatching(
          new RegExp(
            `^Accent text on tinted fills would be too faint: ${ratio} to 1 against .* over a card over ${stack},`,
          ),
        ),
      })
    // Docked, over the conversation's #111111: the darker text fails at 3.9, the lighter at 4.4,
    // each over the panel on the conversation's own colour.
    expect(seeThrough('#868686')).toContainEqual(
      tinted('3\\.9', 'the right-hand panel over its background'),
    )
    expect(seeThrough('#8e8e8e')).toContainEqual(
      tinted('4\\.4', 'the right-hand panel over its background'),
    )
    // Floating, the panel stands on the content's paper under the conversation's colour. A
    // see-through conversation colour over a lighter paper fails there, at 3.5, and only there:
    // its document links are white, and docked it would pass.
    const glass = seeThrough(
      '#999999',
      { 'paper-bg': '#333333', 'paper-link': '#ffffff' },
      '#11111100',
    )
    expect(glass).toContainEqual(tinted('3\\.5', 'the page'))
    expect(
      glass.filter((p) => p.says.includes('against its background')),
      'nothing docked is refused',
    ).toEqual([])
  })

  it('a document’s links, worked out at their own share of the accent, on the document’s paper', () => {
    // On black, the accent text reads 4.9:1; a document's link, a step nearer the accent, 4.4:1.
    expect(
      refused({
        content: { ink: '#ffffff', paper: '#000000', accent: '#5c5c5c' },
        shared: { page: 0, tint: 0 },
        status: { waiting: '#ffffff', success: '#ffffff', danger: '#ffffff', auto: '#ffffff' },
      }),
    ).toContainEqual(problem('content.accent', 'Links on the page'))
  })

  it('a theme that sets its accent text by hand and not its document links is told what to change', () => {
    // The sample BroCrew, with its pictures, before its document links were set by hand.
    const sample = SAMPLES.brocrew!
    const file = sample.file as {
      content: Record<string, string>
      tokens: { content: Record<string, string> }
    }
    const content = { ...file.tokens.content }
    delete content['paper-link']
    const without = { ...file, tokens: { ...file.tokens, content } }
    const APP = { ...contextFor(sample.assets, sample.pictures), readsHeld: false }
    const read = validateTheme(without, APP)
    expect(read.ok ? [] : read.problems).toEqual([
      expect.objectContaining({
        at: 'content.accent',
        says: expect.stringMatching(
          /^Links on the page would be too faint: .* Change `content\.accent`\.$/,
        ),
      }),
    ])
    // The setting it names puts it right, and so do document links set by hand.
    const darker = { ...without, content: { ...without.content, accent: '#b13c0b' } }
    expect(validateTheme(darker, APP).ok).toBe(true)
    expect(validateTheme(file, APP).ok).toBe(true)
  })

  describe('text on the content’s washes and raised panels', () => {
    const flat = { page: 0, tint: 0 }
    const whitePanels = { 'panel-2': '#ffffff', 'panel-3': '#ffffff' }

    it('the sign-in bar: accent text under the pointer, on the waiting colour’s wash', () => {
      // Grey links read 4.6:1 on the page and the ink washes, 4.4:1 on a dark waiting colour's wash.
      const problems = refused({
        shared: flat,
        content: { accent: '#c9d2ff' },
        status: { waiting: '#3d2600' },
        tokens: {
          content: {
            'accent-text': '#6c6c6c',
            'paper-link': '#6c6c6c',
            'focus-ring-color': '#3d4fd6',
            'accent-solid-bg': '#3d4fd6',
            ...whitePanels,
          },
        },
      })
      expect(problems).toEqual([problem('content.accent', 'Links on the page')])
    })

    it('the model picker: accent words on panel-3', () => {
      // Grey links read on the page, the washes and the waiting bar, and 4.4:1 on panel-3, a step
      // of the ink into the paper.
      const problems = refused({
        shared: flat,
        content: { accent: '#c9d2ff' },
        tokens: {
          content: {
            'accent-text': '#6c6c6c',
            'paper-link': '#6c6c6c',
            'focus-ring-color': '#3d4fd6',
            'accent-solid-bg': '#3d4fd6',
          },
        },
      })
      expect(problems).toEqual([problem('content.accent', 'Links on cards')])
    })

    it('words in the second accent, in its text form, wherever they sit', () => {
      // Its text form reads 5.0:1 on the page, and 4.4:1 on a workflow's head under the pointer.
      expect(refused({ shared: flat, content: { accent2: '#8676d8' } })).toEqual([
        problem('content.accent2', 'Links on the page'),
      ])
    })

    it('a theme’s own text form for the second accent is measured, and named', () => {
      expect(
        refused({ shared: flat, tokens: { content: { 'accent-2-text': '#a5a9ff' } } }),
      ).toContainEqual(problem('tokens.content.accent-2-text', 'Links on the page'))
    })

    it('a workflow’s head under the pointer: soft text on the second wash over the first', () => {
      // 4.8:1 on the block's wash, 4.4:1 on the head's second wash over it.
      expect(
        refused({ shared: flat, tokens: { content: { 'text-soft': '#6e6e6e', ...whitePanels } } }),
      ).toEqual([problem('content.ink', 'Text on the page')])
    })

    it('the child-work viewer: its panel on the overlay’s wash, not the page', () => {
      // A see-through panel colour: 6.3:1 straight on the page, 4.4:1 over the overlay's wash.
      expect(
        refused({
          shared: flat,
          tokens: {
            content: { 'drawer-bg': 'rgb(255 255 255 / 30%)', 'accent-2-text': '#606060' },
          },
        }),
      ).toContainEqual(problem('tokens.content.accent-2-text', 'Links in the right-hand panel'))
    })

    it('a sub-agent’s words read on its one wash, however deep it is nested', () => {
      // Nested cards no longer stack the wash, so one wash is what the check measures: 4.6:1.
      expect(
        refused({ shared: flat, tokens: { content: { 'accent-2-text': '#6b6b6b' } } }).filter(
          (p) => p.at === 'tokens.content.accent-2-text',
        ),
      ).toEqual([])
    })

    it('words on a solid fill, which the content always draws: a theme’s own fill is measured, and named', () => {
      expect(refused({ tokens: { content: { 'accent-solid-bg': '#e8572a' } } })).toContainEqual(
        problem('tokens.content.accent-solid-bg', 'Text on solid buttons'),
      )
      expect(refused({ content: { accent: '#e8572a' } })).toContainEqual(
        problem('content.accent', 'Text on solid buttons'),
      )
      expect(
        refused({
          content: { accent: '#e8572a' },
          tokens: { content: { 'accent-solid-bg': '#cf4719' } },
        }).filter((p) => p.says.startsWith('Text on solid buttons')),
      ).toEqual([])
    })

    it('⛔ a solid fill is opaque: one that lets what is under it through is refused, however it is spelled', () => {
      for (const value of [
        'rgb(0 0 0 / 52%)',
        'hsl(0 0% 0% / 0.5)',
        'oklch(0.5 0.1 30 / 50%)',
        '#00000080',
        'transparent',
      ]) {
        const problems = refused({ tokens: { content: { 'accent-solid-bg': value } } })
        expect(problems, value).toEqual([
          {
            at: 'tokens.content.accent-solid-bg',
            says: expect.stringMatching(
              /^`tokens\.content\.accent-solid-bg` should be one colour, such as #4f46e5; .* is something else\.$/,
            ),
          },
        ])
      }
      for (const value of ['#cf4719', 'rgb(207 71 25)', 'hsl(15 79% 45%)', '#cf4719ff']) {
        expect(
          refused({ tokens: { content: { 'accent-solid-bg': value } } }).filter(
            (p) => p.at === 'tokens.content.accent-solid-bg',
          ),
          value,
        ).toEqual([])
      }
    })

    it('a workflow’s block: soft text on the ink wash', () => {
      // With both panels as white as the page, only the wash is left: 4.4:1.
      expect(
        refused({ shared: flat, tokens: { content: { 'text-soft': '#6e7283', ...whitePanels } } }),
      ).toEqual([problem('content.ink', 'Text on the page')])
    })
  })

  it('a light accent at the usual tint: its text form reads on the strong tint too', () => {
    expect(
      refused({ content: { accent: '#4c6ef5' } }).filter((p) => p.says.startsWith('Accent text')),
    ).toEqual([])
  })

  it('⚑ the shipped samples still pass every measurement', () => {
    expect(refused({ titlebar: { background: '#10132f', ink: '#e9eaff' } })).toEqual([])
  })
})

describe('the window works the measured colours out the same way', () => {
  const css = readFileSync(
    join(__dirname, '../../src/renderer/src/assets/tokens.css'),
    'utf8',
  ).replace(/\s+/g, ' ')

  it('a document’s links, from the content’s accent and ink', () => {
    expect(css).toContain(
      `--paper-link: color-mix(in oklab, var(--content-accent) ${PAPER_LINK}%, var(--content-ink));`,
    )
  })

  it('the wash behind a dialog in the content', () => {
    const [, value] = /--overlay-backdrop: (rgb\(38 51 80 \/ 28%\));/.exec(css) ?? []
    expect(value, 'the light scope declares its wash').toBeDefined()
    expect(parseColour(value)).toEqual(OVERLAY_BACKDROP)
  })

  it('the second accent’s text form, and the second accent a theme leaves unset', () => {
    expect(css).toContain(
      `--accent-2-text: color-mix(in oklab, var(--accent-2) ${ACCENT_2_TEXT}%, var(--z-ink));`,
    )
    // Classic draws its words in the second accent itself.
    expect(css).toContain('--accent-2-text: var(--accent-2);')
    expect(css).toContain(`--content-accent-2: ${DEFAULT_ACCENT_2};`)
  })

  it('the solid fill behind words in the accent’s ink, the accent itself unless a theme sets it', () => {
    expect(css).toContain('--accent-solid-bg: var(--accent);')
  })

  it('the sign-in bar’s wash, from the waiting colour', () => {
    expect(css).toContain(
      `--waiting-bg: color-mix(in srgb, var(--waiting) ${WAITING_WASH}%, transparent);`,
    )
  })

  it('the content’s ink washes, which no theme sets', () => {
    for (const n of [2, 3] as const) {
      const declared = [...css.matchAll(new RegExp(`--wash-${n}: ([^;]+);`, 'g'))].map((m) => m[1])
      // The dark root's and the light scope's, and nothing a theme writes.
      expect(declared, `--wash-${n}`).toHaveLength(2)
      expect(declared.map((v) => parseColour(v))).toContainEqual(WASHES[n])
    }
  })

  it('every fixed mix of the accent with the panel, in sRGB', () => {
    const mixes = [
      ...css.matchAll(
        /--accent-mix-(\d+): color-mix\(in srgb, var\(--accent\) (\d+)%, var\(--panel\)\);/g,
      ),
    ]
    expect(mixes.map((m) => Number(m[1]))).toEqual([...ACCENT_MIXES])
    for (const m of mixes) expect(m[2]).toBe(m[1])
    expect(css.match(/--accent-mix-\d+:/g)).toHaveLength(ACCENT_MIXES.length)
  })

  it('a solid button under the pointer', () => {
    expect(css).toContain(
      `--accent-solid-hover: color-mix(in oklab, var(--accent-solid-bg) ${SOLID_HOVER_ACCENT}%, var(--accent-ink));`,
    )
  })

  it.each(['waiting', 'danger'])('the title bar’s %s colour, from its ink', (name) => {
    expect(css).toContain(
      `--titlebar-${name}: oklch( from color-mix(in oklab, var(--status-${name}) ${FRAME_STATUS.mix}%, var(--titlebar-ink)) l calc(c * ${FRAME_STATUS.chroma}) h );`,
    )
  })

  it.each(['text-soft', 'muted', 'faint'] as const)(
    'a card’s %s, from its ink and its fill',
    (name) => {
      expect(css).toContain(
        `--${name}: color-mix(in oklab, var(--drawer-card-ink) ${CARD_TEXT[name]}%, var(--drawer-card-bg, var(--panel)));`,
      )
    },
  )

  it.each(['waiting', 'danger', 'success'])(
    'the %s colour’s text form, a step toward the ink',
    (name) => {
      expect(css).toContain(
        `--${name}-text: color-mix(in oklab, var(--${name}) ${STATUS_TEXT}%, var(--z-ink));`,
      )
    },
  )
})
