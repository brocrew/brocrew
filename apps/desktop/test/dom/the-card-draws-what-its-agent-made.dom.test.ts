import { afterEach, describe, expect, it } from 'vitest'
import SessionPanel from '../../src/renderer/src/components/SessionPanel.vue'
import type { PanelAsset } from '../../src/renderer/src/lib/session-panel'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible } from './harness'

/**
 * # ⚑ The agent card draws the images its agent made
 *
 * The Images section counts its files and draws one tile per file, with picture, filename,
 * file kind, and a press that opens it.
 *
 * ⛔ The controls: a picture whose file will not load draws the image mark rather than a broken
 * one, and a conversation that made nothing draws no Images at all.
 *
 * ⚑ **UI-002 (`07-where-resources-show` §2)** — the section was *Resources* until the files kept on
 * an agent's work needed that word: *Images* is what these tiles are, so *Files* means one thing.
 */

afterEach(() => unmountAll())

const made = (...paths: string[]) => {
  const state = createTranscript()
  paths.forEach((path, index) => {
    applyEvent(state, {
      type: 'image',
      imageId: `img_${String(index)}`,
      path,
      prompt: `picture ${String(index)}`,
    } as unknown as TranscriptEvent)
  })
  return state
}

const panel = (state: ReturnType<typeof createTranscript>, opened: PanelAsset[] = []) =>
  mount(
    SessionPanel,
    {
      state,
      mode: 'normal',
      facets: { doing: 'idle', being: 'live' },
      who: 'Ana',
      onOpenAsset: (asset: PanelAsset) => opened.push(asset),
    },
    { width: 380, height: 900 },
  )

const said = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('the agent card draws what its agent made', () => {
  it('🔴 one tile per file — its name and its kind, under a counted Images heading', () => {
    const m = panel(made('/work/shots/state-a.png', '/work/shots/state-b.png'))
    const section = m.q('panel-assets')
    expect(said(section.querySelector('.title')!)).toBe('Images')
    expect(said(section.querySelector('.count')!)).toBe('(2)')
    // ⚑ …and headed by the picture mark, the one a tile falls back to — not the file mark.
    expect(section.querySelector('.head use')!.getAttribute('href')).toBe('#i-image')
    const tiles = m.all('panel-asset')
    expect(tiles.map((tile) => said(tile.querySelector('.tile-name')!))).toEqual([
      'state-a.png',
      'state-b.png',
    ])
    expect(tiles.map((tile) => said(tile.querySelector('.tile-kind')!))).toEqual(['Image', 'Image'])
    expect(tiles[0]!.getAttribute('title')).toBe('Open this image — picture 0')
    // ⚑ Side by side, as the mock draws them, while the column has room.
    expect(tiles[0]!.getBoundingClientRect().top).toBe(tiles[1]!.getBoundingClientRect().top)
  })

  it('🔴 a press opens the file', () => {
    const opened: PanelAsset[] = []
    const m = panel(made('/work/shots/state-a.png'), opened)
    m.q('panel-asset').click()
    expect(opened.map((asset) => asset.name)).toEqual(['state-a.png'])
  })

  it('⛔ THE CONTROL — a picture that will not load draws the image mark, never a broken one', async () => {
    const m = panel(made('/nowhere/gone.png'))
    const thumb = m.q('panel-asset').querySelector<HTMLElement>('.thumb')!
    await expect.poll(() => thumb.querySelector('svg.icon') !== null).toBe(true)
    expect(thumb.querySelector('img')).toBeNull()
    expect(visible(thumb.querySelector('svg.icon')!)).toBe(true)
  })

  it('⛔ THE CONTROL — a conversation that made nothing draws no Images', () => {
    const m = panel(createTranscript())
    expect(m.q('session-bot')).toBeTruthy()
    expect(m.all('panel-assets')).toHaveLength(0)
  })
})
