import { afterEach, describe, expect, it } from 'vitest'
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import {
  channelGap,
  contrast,
  luminance,
  mount,
  over,
  parseColor,
  show,
  unmountAll,
  type Rgba,
} from './harness'

/**
 * The ground the light surfaces sit on, and how far the header band may stand from it.
 *
 * The light surfaces are paper with BroCrew's faint network drawn over it: `--paper-wash` is a picture
 * of thin lines on a transparent ground, so it tints no colour the contrast pairs read. The dark ramp
 * carries no wash at all (a wash there once took the faded prose's contrast from 3:1 to 1.16:1). The
 * header band is an opaque fill close to the page, and `theme-scope.dom.test.ts` requires the two to
 * stay within 16 levels, or the band reads as a grey, disabled strip instead of part of the page.
 */
afterEach(unmountAll)

/**
 * The launcher, mounted the way it now ships (417, HO-022 §2).
 *
 * ⚑ **A fixture repair, not a change of subject.** This file mounted it as
 * `{ providers: ['codex'], profiles: [] }` — two props the component never declared even then, and
 * both long gone from what `RuntimeScreen` hands it. What it measures is the SURFACE's own paint:
 * `--chat-bg`, `--paper-wash` and the bound a translucent header imposes on the page behind them,
 * none of which any removed control ever touched.
 */
const asLauncher = (): Record<string, unknown> => ({
  busy: false,
  error: null,
  debug: false,
  draft: '',
  handing: createAttachmentBook().handing(NEW_CONVERSATION),
  defaultProvider: 'codex',
  // ⚑ **The front door's three choices, unanswered** (435) — `NO_LAUNCH_CHOICES` is what an
  // untouched door holds, and `models: null` is *nobody has answered yet*. Both are required
  // props for `handing`'s reason: the typechecker is the only reader of `RuntimeScreen`'s
  // bindings, so a silently-absent one is a silently-absent control.
  models: null,
  choices: NO_LAUNCH_CHOICES,
  // 🔴 **579 · required since `500` and never passed here** — omitted it arrives as `undefined`,
  // which `launchApprovalView` takes down its non-null branch: the control draws with no state
  // class and an empty heading. ⚑ Paint measured on a state the app cannot produce is paint
  // measured on nothing.
  defaultApprovalMode: 'ask',
  capabilities: allProviderCapabilities(),
})

/** The page and the band, read off the shipped stylesheet rather than restated. */
function tokens(scope: Element): { paper: Rgba; wash: string; band: Rgba } {
  const style = getComputedStyle(scope)
  const paper = parseColor(style.getPropertyValue('--paper-bg').trim())
  const band = parseColor(style.getPropertyValue('--surface-header-bg').trim())
  expect(paper, 'the paper token did not resolve — the stylesheet did not load').not.toBeNull()
  expect(band, 'the header band token did not resolve').not.toBeNull()
  return { paper: paper!, wash: style.getPropertyValue('--paper-wash').trim(), band: band! }
}

/**
 * The darkest colour the wash puts on the paper, as Chromium draws it: the picture rasterised at
 * three times its size over the paper, so every place where a line and a node, or two lines,
 * overlap is composited as painted, and then the darkest pixel.
 */
async function darkestPointOf(wash: string, paper: Rgba): Promise<Rgba> {
  const src = /^url\("(data:image\/svg\+xml,.*)"\)$/.exec(wash)?.[1]
  expect(src, 'the wash is not an SVG picture').toBeDefined()
  const picture = new Image()
  picture.src = src!
  await picture.decode()
  const scale = 3
  const canvas = document.createElement('canvas')
  canvas.width = picture.naturalWidth * scale
  canvas.height = picture.naturalHeight * scale
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = `rgb(${paper[0]}, ${paper[1]}, ${paper[2]})`
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(picture, 0, 0, canvas.width, canvas.height)
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let darkest: Rgba = [px[0]!, px[1]!, px[2]!, 1]
  let low = luminance(darkest)
  for (let i = 4; i < px.length; i += 4) {
    const colour: Rgba = [px[i]!, px[i + 1]!, px[i + 2]!, 1]
    const l = luminance(colour)
    if (l < low) {
      low = l
      darkest = colour
    }
  }
  return darkest
}

/** The wash with one more line, drawn in the network's own stroke, straight through a node. */
const throughANode = (wash: string): string =>
  wash.replace('%3C/g%3E', "%3Cline x1='70' y1='150' x2='110' y2='150'/%3E%3C/g%3E")

describe('the light surfaces sit on paper, with only the network drawn over it', () => {
  it('⚑ the launcher paints the opaque paper, and only the network over it', () => {
    const m = mount(NewConversation, asLauncher(), { width: 1200 })
    const root = m.q('new-conversation-surface')
    const style = getComputedStyle(root)
    // The colour is the paper, which keeps `chat-theme.test.ts` able to resolve `--chat-bg` as a
    // page for its contrast pairs.
    expect(parseColor(style.backgroundColor)).toEqual(tokens(root).paper)
    // ⚑ The one image is the wash, a picture, and never a gradient that could tint the page.
    expect(style.backgroundImage).toBe(tokens(root).wash)
    expect(style.backgroundImage).toMatch(/^url\("data:image\/svg\+xml/)
    expect(style.backgroundImage).not.toMatch(/gradient/)
  })

  it('⛔ …and no wash returns in dark', () => {
    const m = mount(NewConversation, asLauncher(), { width: 1200 })
    const root = m.q('new-conversation-surface')
    // ⚑ The control: light really carries the network, so the absence below is dark's own.
    expect(tokens(root).wash).not.toBe('none')
    root.setAttribute('data-chat-theme', 'dark')
    expect(getComputedStyle(root).backgroundImage).toBe('none')
    expect(getComputedStyle(root).getPropertyValue('--paper-wash').trim()).toBe('none')
  })

  /**
   * 🔴 **The rule's protective half, kept in the network's form.** The wash once took faded prose
   * from 3:1 to 1.16:1, which is why it was `none`. The network may only exist if the text over it
   * still clears its floor against the wash's DARKEST point as drawn, overlaps included. The lines
   * stop short of the nodes, so nothing in the network is painted twice.
   */
  it('🔴 the text inks clear 4.5:1 against the darkest point of the wash', async () => {
    const m = mount(NewConversation, asLauncher(), { width: 1200 })
    const root = m.q('new-conversation-surface')
    const { paper, wash } = tokens(root)
    const darkest = await darkestPointOf(wash, paper)
    // ⚑ The premise: the wash really darkens the paper somewhere, or the floor below measures paper.
    expect(luminance(darkest)).toBeLessThan(luminance(paper))
    const style = getComputedStyle(root)
    for (const ink of ['--text', '--text-soft', '--muted', '--faint']) {
      const colour = parseColor(style.getPropertyValue(ink).trim())
      expect(colour, `${ink} did not parse`).not.toBeNull()
      expect(
        contrast(colour!, darkest),
        `${ink} on the wash's darkest point ${show(darkest)}`,
      ).toBeGreaterThanOrEqual(4.5)
    }
    const faint = parseColor(style.getPropertyValue('--faint').trim())!
    // ⛔ **The controls: each can go red.** The same network at ten times the line opacity takes
    // --faint under the floor…
    const loud = await darkestPointOf(
      wash.replace(/stroke-opacity='[\d.]+'/, "stroke-opacity='0.6'"),
      paper,
    )
    expect(contrast(faint, loud)).toBeLessThan(4.5)
    // …and so does one line of the network's own stroke run under one of its own nodes, at the
    // shipped opacities, though the line alone and the node alone each clear it.
    const overlap = await darkestPointOf(throughANode(wash), paper)
    expect(
      contrast(faint, overlap),
      `--faint where a line runs under a node ${show(overlap)}`,
    ).toBeLessThan(4.5)
  })

  it('🔴 the header band stays within 16 levels of the page, and is still a band', () => {
    const m = mount(NewConversation, asLauncher(), { width: 1200 })
    const root = m.q('new-conversation-surface')
    const { paper, band } = tokens(root)
    const page = over(band, paper)
    const gap = channelGap(page, paper)
    expect(
      gap,
      `a header of ${show(band)} on a page of ${show(paper)} is ${gap} away`,
    ).toBeLessThanOrEqual(16)
    // The control: the band is not the page itself, so the bound above is about a real edge.
    expect(gap, 'the header band is the page colour — there is no band to measure').toBeGreaterThan(
      0,
    )
  })
})
