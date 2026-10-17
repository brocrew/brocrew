import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, unmountAll } from './harness'
import { DIMMED, paintedReadings } from './what-is-painted-under'

/**
 * The window's text is read from what the screen paints, so every way a surface can change what a
 * piece of text sits on counts: a group's opacity, a pseudo-element behind the words, a layer no
 * pointer reaches. Each control below draws white words that can't be read, and each must read as
 * the screen shows it, not as the colours alone would suggest. A layer that is not drawn at all
 * covers nothing, and neither does one drawn too faintly to hide the words or one over only part of
 * them; only the window's named backdrops, dimming what is under them enough, pass text over.
 */

afterEach(unmountAll)

const STYLE = `
.sampler-backed { position: relative; isolation: isolate; background: #000; color: #fff; }
.sampler-backed::before { content: ''; position: absolute; inset: 0; z-index: -1; background: #fff; }
.sampler-layered { position: relative; background: #000; }
.sampler-layered .layer { position: absolute; inset: 0; background: #fff; pointer-events: none; }
.sampler-layered .words { position: relative; color: #fff; }
`

/** How the text `words` in `content` reads, on a white page with the controls' rules. */
async function readingOf(
  content: () => ReturnType<typeof h>,
  words = 'Words',
): Promise<number | string> {
  const Page = defineComponent({
    setup: () => () =>
      h('div', { style: 'background:#fff;padding:24px;font:16px sans-serif' }, [
        h('style', STYLE),
        content(),
      ]),
  })
  const m = mount(Page, {}, { width: 400, height: 200 })
  await new Promise((done) => setTimeout(done, 50))
  const target = [...(await paintedReadings(m.host))].find(
    (one) => one.node.textContent?.trim() === words,
  )
  if (!target) return 'not found'
  return target.reading.is === 'read' ? target.reading.ratio : target.reading.is
}

/**
 * Whether the window check fails a reading: under 4.5:1, or unread, as words no glyph of shows
 * through are when no named cover is over them.
 */
const fails = (reading: number | string): boolean =>
  reading === 'unread' || (typeof reading === 'number' && reading < 4.5)

describe('the window is read from what it paints', () => {
  it('⚑ white words on a black fill read 21:1: the control the others are measured against', async () => {
    const ratio = await readingOf(() =>
      h('div', { style: 'background:#000;color:#fff;padding:8px' }, 'Words'),
    )
    expect(ratio).toBeGreaterThan(20)
  })

  it('⛔ in a half-faded group, the fill fades with the words: about 4:1, not 5.3', async () => {
    const ratio = await readingOf(() =>
      h('div', { style: 'opacity:.5;background:#000;color:#fff;padding:8px' }, 'Words'),
    )
    expect(ratio).toBeLessThan(4.5)
  })

  it('⛔ a white pseudo-element behind white words on a black parent: they fail, not 21', async () => {
    const ratio = await readingOf(() =>
      h('div', { class: 'sampler-backed', style: 'padding:8px' }, 'Words'),
    )
    expect(fails(ratio), String(ratio)).toBe(true)
  })

  it('⛔ a white layer no pointer reaches, under white words on a black parent: they fail', async () => {
    const ratio = await readingOf(() =>
      h('div', { class: 'sampler-layered', style: 'padding:8px' }, [
        h('div', { class: 'layer' }),
        h('div', { class: 'words' }, 'Words'),
      ]),
    )
    expect(fails(ratio), String(ratio)).toBe(true)
  })

  it('⚑ a fill over the words inside a group that is not drawn covers nothing', async () => {
    const ratio = await readingOf(() =>
      h('div', { style: 'position:relative;padding:8px;color:#000' }, [
        'Words',
        h('div', {
          style: 'position:absolute;inset:0;opacity:0',
          innerHTML: '<div style="position:absolute;inset:0;background:#000"></div>',
        }),
      ]),
    )
    expect(ratio).toBeGreaterThan(20)
  })

  it('⛔ a layer drawn at 1% over grey words on grey still lets them be read: they fail', async () => {
    const ratio = await readingOf(() =>
      h('div', { style: 'position:relative' }, [
        h('div', { style: 'padding:8px;background:#888;color:#777' }, 'Words'),
        h('div', { style: 'position:absolute;inset:0;background:#000;opacity:.01' }),
      ]),
    )
    expect(ratio).toBeLessThan(4.5)
  })

  it('⛔ white words on a fill drawn in their own colour over black: they fail, not 21', async () => {
    const ratio = await readingOf(() =>
      h('div', { style: 'background:#000;padding:8px' }, [
        h('span', { style: 'color:#fff;background:currentColor' }, 'Words'),
      ]),
    )
    expect(fails(ratio), String(ratio)).toBe(true)
  })

  it('⛔ a box over the first line of two does not pass the second over: it fails', async () => {
    const ratio = await readingOf(
      () =>
        h('div', { style: 'position:relative;width:70px' }, [
          h('div', { style: 'background:#888;color:#777' }, 'Words words'),
          h('div', {
            style: 'position:absolute;left:0;right:0;top:0;height:1.1em;background:#fff',
          }),
        ]),
      'Words words',
    )
    expect(fails(ratio), String(ratio)).toBe(true)
  })

  it(`⚑ grey words behind a named backdrop dimming at least ${DIMMED} are passed over`, async () => {
    const reading = await readingOf(() =>
      h('div', { style: 'position:relative' }, [
        h('div', { style: 'padding:8px;background:#888;color:#777' }, 'Words'),
        h('div', {
          class: 'drawer-scrim',
          style: 'position:absolute;inset:0;background:rgb(0 0 0 / 28%)',
        }),
      ]),
    )
    expect(reading).toBe('covered')
  })

  it('⛔ behind a named backdrop that dims less than that, they are read: they fail', async () => {
    const ratio = await readingOf(() =>
      h('div', { style: 'position:relative' }, [
        h('div', { style: 'padding:8px;background:#888;color:#777' }, 'Words'),
        h('div', {
          class: 'drawer-scrim',
          style: 'position:absolute;inset:0;background:rgb(0 0 0 / 10%)',
        }),
      ]),
    )
    expect(fails(ratio), String(ratio)).toBe(true)
  })

  it('⛔ words under an opaque box that holds its own words are unread: no named cover is over them', async () => {
    const reading = await readingOf(() =>
      h('div', { style: 'position:relative' }, [
        h('div', { style: 'padding:8px;background:#fff;color:#000' }, 'Words'),
        h(
          'div',
          { style: 'position:absolute;inset:0;padding:8px;background:#fff;color:#999' },
          'Over',
        ),
      ]),
    )
    expect(reading).toBe('unread')
  })

  it('⚑ words under one of the window’s named covers are passed over', async () => {
    const reading = await readingOf(() =>
      h('div', { style: 'position:relative' }, [
        h('div', { style: 'padding:8px;background:#fff;color:#000' }, 'Words'),
        h('div', {
          class: 'session-drawer fit-overlay',
          style: 'position:absolute;inset:0;background:#fff',
        }),
      ]),
    )
    expect(reading).toBe('covered')
  })

  it('⛔ words in a group drawn at 1% are read at that opacity: they fail', async () => {
    const ratio = await readingOf(() =>
      h('div', { style: 'opacity:.01;background:#000;color:#fff;padding:8px' }, 'Words'),
    )
    expect(fails(ratio), String(ratio)).toBe(true)
  })

  it('⛔ a single narrow character in a failing pair is read: it fails', async () => {
    const ratio = await readingOf(
      () =>
        h('div', { style: 'padding:8px' }, [
          h('span', { style: 'background:#888;color:#777;font-size:12px' }, '1'),
        ]),
      '1',
    )
    expect(fails(ratio), String(ratio)).toBe(true)
  })

  it('⛔ a single dot in a failing pair is read: it fails', async () => {
    const ratio = await readingOf(
      () =>
        h('div', { style: 'padding:8px' }, [
          h('span', { style: 'background:#888;color:#777;font-size:10px' }, '·'),
        ]),
      '·',
    )
    expect(fails(ratio), String(ratio)).toBe(true)
  })

  it('⛔ failing words under a word drawn over them with a see-through box are read: they fail', async () => {
    const ratio = await readingOf(() =>
      h('div', { style: 'position:relative' }, [
        h('div', { style: 'padding:8px;background:#888;color:#777' }, 'Words'),
        h(
          'div',
          { style: 'position:absolute;inset:0;padding:8px;color:#000;white-space:nowrap' },
          'Over and over again',
        ),
      ]),
    )
    expect(fails(ratio), String(ratio)).toBe(true)
  })

  it('⛔ a narrow letter kept as written, white on white, is not taken for white space: it fails', async () => {
    const reading = await readingOf(
      () =>
        h('div', { style: 'padding:8px;background:#fff' }, [
          h(
            'span',
            {
              style:
                'display:inline-block;white-space:pre-wrap;font:12px monospace;transform:scaleX(.25);transform-origin:left top;background:#fff;color:#fff',
            },
            'I',
          ),
        ]),
      'I',
    )
    expect(fails(reading), String(reading)).toBe(true)
  })

  it('⚑ white space kept at the end of a wrapped line is passed over: the words read as drawn', async () => {
    const ratio = await readingOf(
      () =>
        h(
          'div',
          {
            style:
              'box-sizing:content-box;width:60px;padding:8px;white-space:pre-wrap;background:#000;color:#fff',
          },
          'Words words',
        ),
      'Words words',
    )
    expect(ratio).toBeGreaterThan(20)
  })

  it('⛔ an open dialog that paints nothing, over words an unnamed box hides, passes nothing over', async () => {
    const reading = await readingOf(() =>
      h('div', { style: 'position:relative' }, [
        h('div', { style: 'padding:8px;background:#fff;color:#000' }, 'Words'),
        h('div', { style: 'position:absolute;inset:0;background:#fff' }),
        h('dialog', {
          open: true,
          style:
            'position:absolute;inset:0;margin:0;padding:0;border:0;width:100%;height:100%;opacity:0;pointer-events:none;box-shadow:none',
        }),
      ]),
    )
    expect(reading).toBe('unread')
  })

  it('⛔ a see-through dialog over a line, opaque over its first third only: the words beyond it are read and fail', async () => {
    const reading = await readingOf(
      () =>
        h('div', { style: 'position:relative' }, [
          h(
            'div',
            { style: 'padding:8px;white-space:nowrap;background:#888;color:#777' },
            'Words words words words',
          ),
          h(
            'dialog',
            {
              open: true,
              style:
                'position:absolute;inset:0;margin:0;padding:0;border:0;width:100%;height:100%;background:transparent;box-shadow:none',
            },
            [
              h('div', {
                style: 'position:absolute;left:0;top:0;bottom:0;width:33%;background:#fff',
              }),
            ],
          ),
        ]),
      'Words words words words',
    )
    expect(fails(reading), String(reading)).toBe(true)
  })

  it('⛔ a named scrim that would dim by 28% but is drawn at half strength, without a blur, passes nothing over', async () => {
    const reading = await readingOf(() =>
      h('div', { style: 'position:relative' }, [
        h('div', { style: 'padding:8px;background:#888;color:#777' }, 'Words'),
        h('div', {
          class: 'drawer-scrim',
          style: 'position:absolute;inset:0;background:rgb(0 0 0 / 28%);filter:opacity(.5)',
        }),
      ]),
    )
    expect(fails(reading), String(reading)).toBe(true)
  })

  /** An absolute box held by a static ancestor with a transform that clips it, and one line of it
   * past that clip. */
  const heldByATransform = (ink: string) =>
    h(
      'div',
      { style: 'transform:translateX(0);overflow:hidden;height:40px;width:240px;background:#888' },
      [
        h('div', { style: `position:absolute;top:0;left:0;padding:8px;color:${ink}` }, [
          h('div', 'Words'),
          h('div', { style: 'margin-top:60px' }, 'Gone'),
        ]),
      ],
    )

  it('⚑ an absolute box clipped by the transformed box that holds it: what it cuts off is not read', async () => {
    expect(await readingOf(() => heldByATransform('#000'), 'Gone')).toBe('not found')
  })

  it('⛔ …and what it leaves showing is read: failing words fail', async () => {
    const reading = await readingOf(() => heldByATransform('#777'), 'Words')
    expect(fails(reading), String(reading)).toBe(true)
  })

  /** An absolute box inside a static box that clips and has `style`, both on a page that holds the
   * absolute box when the static one doesn't: one line inside the clip, one past it. */
  const heldOrNot = (style: string) =>
    h('div', { style: 'position:relative;height:140px;width:240px;background:#888' }, [
      h('div', { style: `${style};overflow:hidden;height:40px;width:240px;background:#888` }, [
        h('div', { style: 'position:absolute;top:0;left:0;padding:8px;color:#777' }, [
          h('div', 'Words'),
          h('div', { style: 'margin-top:60px' }, 'Gone'),
        ]),
      ]),
    ])

  it.each([
    'will-change: transform-origin',
    'will-change: perspective-origin',
    'will-change: --transform',
  ])(
    '⛔ %s does not make the box hold it: the line past its clip shows, and its failing words fail',
    async (style) => {
      const reading = await readingOf(() => heldOrNot(style), 'Gone')
      expect(fails(reading), String(reading)).toBe(true)
    },
  )

  it.each([
    'will-change: transform',
    'will-change: perspective',
    'will-change: filter',
    'will-change: transform-style',
    'contain: paint',
    'contain: layout',
    'contain: strict',
    'contain: content',
  ])('⚑ %s makes the box hold it: the line past its clip is not read', async (style) => {
    expect(await readingOf(() => heldOrNot(style), 'Gone')).toBe('not found')
  })
})
