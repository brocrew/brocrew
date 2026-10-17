/**
 * The live themes, rewritten as theme files: what each one did with CSS selectors, said with
 * settings. The files they name are described by facts (the host reads real bytes), and each
 * picture by the darkest and lightest colours the host would sample from it.
 */
import type { AssetFacts } from '../../src/shared/themes/assets'
import { parseColour, type Rgba } from '../../src/shared/themes/colour'
import type { PictureSamples } from '../../src/shared/themes/contrast'
import type { Theme } from '../../src/shared/themes/theme'
import type { ThemeContext } from '../../src/shared/themes/validate'

const rgb = (hex: string): Rgba => parseColour(hex)!

export const png = (width: number, height: number, bytes = 40_000): AssetFacts => ({
  type: 'png',
  bytes,
  width,
  height,
  animated: false,
})
export const jpeg = (width: number, height: number, bytes = 900_000): AssetFacts => ({
  type: 'jpeg',
  bytes,
  width,
  height,
  animated: false,
})
export const woff2 = (bytes = 60_000): AssetFacts => ({ type: 'woff2', bytes })
const samples = (darkest: string, lightest: string): PictureSamples => ({
  darkest: rgb(darkest),
  lightest: rgb(lightest),
})

/** The built-in base the samples extend. */
export const DEFINED: Theme = {
  format: 1,
  id: 'defined',
  name: 'Defined',
  frame: { ink: '#e3e8f4', paper: '#182135', accent: '#a7b7ff' },
  content: { ink: '#1b2238', paper: '#ffffff', accent: '#4f46e5' },
  shared: { page: 7, line: 16, tint: 10, shadow: { strength: 9 }, borderWidth: 1, radius: 12 },
}

/**
 * What a host would hand the validator for a theme's folder. These samples use the settings the
 * window doesn't paint yet, so they are read with them, by their own rules.
 */
export function contextFor(
  assets: Record<string, AssetFacts> = {},
  pictures: Record<string, PictureSamples> = {},
): ThemeContext {
  return {
    assets: new Map(Object.entries(assets)),
    pictures: new Map(Object.entries(pictures)),
    builtIns: new Map([['defined', DEFINED]]),
    readsHeld: true,
  }
}

/** A sample: the raw file, and the folder it would sit in. */
export interface Sample {
  readonly file: Record<string, unknown>
  readonly assets?: Record<string, AssetFacts>
  readonly pictures?: Record<string, PictureSamples>
}

export const SAMPLES: Record<string, Sample> = {
  sober: {
    file: {
      format: 1,
      id: 'sober',
      name: 'Sober',
      extends: 'defined',
      frame: { ink: '#e4e5e8', paper: '#1e1f22', accent: '#8fa6bf' },
      content: { ink: '#24262b', paper: '#ffffff', accent: '#3e5a78' },
      shared: {
        page: 3,
        line: 12,
        tint: 8,
        shadow: { strength: 6 },
        fonts: { body: ['system-ui'] },
      },
      rail: { background: '#222326' },
    },
  },
  synthwave: {
    file: {
      format: 1,
      id: 'synthwave',
      name: 'Synthwave',
      extends: 'defined',
      status: { waiting: '#fffb96', success: '#05ffa1', danger: '#ff8fb0', auto: '#ffb36b' },
      frame: { ink: '#f6efff', paper: '#120a26', accent: '#01cdfe' },
      content: {
        ink: '#f6efff',
        paper: '#221345',
        accent: '#ff71ce',
        accent2: '#01cdfe',
        scheme: 'dark',
      },
      shared: { shadow: { style: 'glow', color: '#ff71ce' } },
      rail: {
        background: {
          layers: [
            {
              gradient: {
                type: 'linear',
                angle: 180,
                stops: [
                  { color: '#1c0f3a', at: 0 },
                  { color: '#2b1150', at: 55 },
                  { color: '#4a1460', at: 100 },
                ],
              },
            },
          ],
        },
      },
      conversation: {
        background: {
          color: '#160c2e',
          layers: [
            { pattern: { kind: 'grid', color: 'rgb(255 113 206 / 14%)', size: 40, thickness: 1 } },
          ],
        },
      },
      tokens: { content: { 'accent-text': '#ff9fe0' } },
    },
  },
  cartoon: {
    file: {
      format: 1,
      id: 'cartoon',
      name: 'Cartoon',
      extends: 'defined',
      status: { waiting: '#553500', success: '#024a33', danger: '#7a1824', auto: '#663000' },
      frame: { ink: '#ffffff', paper: '#5b2bd9', accent: '#ffd23f' },
      content: { ink: '#111111', paper: '#ffffff', accent: '#2f6bff' },
      shared: {
        borderWidth: 2,
        radius: 18,
        shadow: { style: 'hard', strength: 30 },
        fonts: { body: ['Chalkboard SE', 'Comic Neue', 'cursive'] },
      },
      rail: {
        background: {
          color: '#5b2bd9',
          layers: [
            { pattern: { kind: 'dots', color: 'rgb(255 255 255 / 10%)', size: 12, thickness: 2 } },
          ],
        },
      },
      conversation: {
        background: {
          color: '#ffe873',
          layers: [
            { pattern: { kind: 'dots', color: 'rgb(255 120 40 / 28%)', size: 16, thickness: 2.5 } },
          ],
        },
      },
      tokens: {
        frame: {
          muted: '#ece2ff',
          faint: '#ece2ff',
          'accent-text': '#fff3b8',
          waiting: '#ffe9b0',
          success: '#7dffc8',
          danger: '#ffd6de',
          auto: '#ffdfbf',
        },
        content: {
          'accent-solid-bg': '#2e66f1',
          'accent-2-text': '#5c428b',
          muted: '#333333',
          faint: '#333333',
          'focus-ring-color': '#1d4fd6',
          'accent-text': '#1a3fb0',
        },
      },
    },
  },
  kids: {
    file: {
      format: 1,
      id: 'kids',
      name: 'Kids',
      extends: 'defined',
      frame: { ink: '#2b2350', paper: '#b9a6ff', accent: '#5a2fe0' },
      content: { ink: '#2b2350', paper: '#ffffff', accent: '#7c4dff' },
      shared: {
        radius: 22,
        borderWidth: 2,
        fonts: { body: ['ui-rounded', 'SF Pro Rounded', 'sans-serif'] },
      },
      titlebar: {
        background: {
          layers: [
            {
              gradient: {
                type: 'linear',
                angle: 90,
                stops: [
                  { color: '#ff8fa3', at: 0 },
                  { color: '#ffe066', at: 50 },
                  { color: '#b49bff', at: 100 },
                ],
              },
            },
          ],
        },
        ink: '#1f1838',
      },
      rail: {
        background: {
          layers: [
            {
              gradient: {
                type: 'linear',
                stops: [
                  { color: '#c8b8ff', at: 0 },
                  { color: '#ffc7e3', at: 60 },
                  { color: '#ffd9b8', at: 100 },
                ],
              },
            },
          ],
        },
      },
      brand: { mark: '#ffe066', markInk: '#5a2fe0' },
      conversation: { background: '#e8f6ff' },
      tokens: { frame: { muted: '#4a3f7a', faint: '#4a3f7a', 'accent-text': '#3a1a9c' } },
      effects: [
        {
          type: 'drift',
          zone: 'rail',
          image: 'assets/star.png',
          direction: 'down',
          period: 14,
          size: 120,
        },
        {
          type: 'float',
          zone: 'conversation',
          image: 'assets/rainbow.png',
          anchor: 'bottom-right',
          x: 600,
          y: 230,
          size: 300,
          amplitude: 6,
          period: 3.5,
        },
      ],
    },
    assets: { 'assets/star.png': png(120, 140), 'assets/rainbow.png': png(600, 340) },
  },
  luxury: {
    file: {
      format: 1,
      id: 'luxury',
      name: 'Luxury',
      extends: 'defined',
      frame: { ink: '#f2ead8', paper: '#0b0a08', accent: '#d4b26a' },
      content: { ink: '#1a1712', paper: '#fdfbf6', accent: '#8a6a2f' },
      shared: {
        borderWidth: 1,
        shadow: { strength: 14 },
        fonts: { body: ['Avenir Next', 'Avenir', 'Helvetica Neue'] },
      },
      type: {
        display: { font: ['Didot', 'Bodoni 72', 'serif'], weight: 700, letterSpacing: 0.01 },
      },
      rail: {
        background: {
          color: '#0b0a08',
          layers: [
            { pattern: { kind: 'lines', color: 'rgb(212 178 106 / 5%)', size: 6, angle: 90 } },
          ],
        },
      },
      brand: {
        mark: {
          layers: [
            {
              gradient: {
                type: 'linear',
                angle: 115,
                stops: [
                  { color: '#7a5c2a', at: 0 },
                  { color: '#f6e7bf', at: 50 },
                  { color: '#7a5c2a', at: 100 },
                ],
              },
            },
          ],
        },
        markInk: '#0b0a08',
        markEdge: 'rgb(246 231 191 / 50%)',
      },
      conversation: { background: '#f4efe4' },
      effects: [{ type: 'shimmer', target: 'brand-mark', color: '#f6e7bf', period: 7 }],
    },
  },
  beach: {
    file: {
      format: 1,
      id: 'beach',
      name: 'Beach',
      extends: 'defined',
      status: { waiting: '#3d2600', success: '#013324', danger: '#5c0f18', auto: '#4a2300' },
      localOnly: true,
      frame: { ink: '#ffffff', paper: '#03303f', accent: '#5fe3ea' },
      content: { ink: '#0c2a33', paper: 'rgb(255 255 255 / 84%)', accent: '#0a96a8' },
      window: {
        background: { layers: [{ image: 'assets/beach.jpg', size: 'cover', position: 'center' }] },
      },
      rail: { background: 'rgb(3 46 64 / 80%)', glass: { blur: 14, saturate: 1.2 } },
      conversation: { background: 'rgb(255 255 255 / 86%)', glass: { blur: 10, saturate: 1.15 } },
      tokens: {
        frame: {
          muted: '#d3f1f7',
          faint: '#d3f1f7',
          waiting: '#ffd27a',
          success: '#7dffc8',
          danger: '#ffb3c0',
          auto: '#ffc48a',
        },
        content: {
          'accent-solid-bg': '#116e7c',
          'accent-text': '#055f6b',
          'paper-link': '#055f6b',
          muted: '#2f525c',
          faint: '#2f525c',
          'focus-ring-color': '#067482',
        },
      },
    },
    assets: { 'assets/beach.jpg': jpeg(2000, 1333) },
    pictures: { 'assets/beach.jpg': samples('#1d3b2a', '#f4f1e8') },
  },
  valentine: {
    file: {
      format: 1,
      id: 'valentine',
      name: 'Valentine',
      extends: 'defined',
      frame: { ink: '#fff2f5', paper: '#3d0a1a', accent: '#ff8fab' },
      content: { ink: '#3a1020', paper: '#fffafb', accent: '#d6336c' },
      type: {
        display: {
          font: ['Baskerville', 'Libre Baskerville', 'serif'],
          style: 'italic',
          weight: 600,
        },
        brand: { font: ['assets/fonts/script.woff2'] },
      },
      rail: {
        background: {
          color: '#5a0f26',
          layers: [{ image: 'assets/hearts.png', size: 64, repeat: true }],
        },
      },
      brand: {
        mark: {
          color: '#c2185b',
          layers: [{ image: 'assets/heart.png', size: '70%', repeat: false }],
        },
        markInk: 'transparent',
      },
      conversation: { background: '#fdf0f3' },
      tokens: {
        content: { 'accent-solid-bg': '#cd3168' },
        frame: { muted: '#ffc9d6', faint: '#ffc9d6' },
      },
      effects: [
        {
          type: 'drift',
          zone: 'conversation',
          image: 'assets/heart.png',
          direction: 'up',
          period: 40,
          opacity: 0.4,
        },
      ],
    },
    assets: {
      'assets/hearts.png': png(128, 128),
      'assets/heart.png': png(64, 64),
      'assets/fonts/script.woff2': woff2(),
    },
    pictures: {
      'assets/hearts.png': samples('#5a0f26', '#7a1432'),
      'assets/heart.png': samples('#c2185b', '#ff4d7d'),
    },
  },
  'retro-desktop': {
    file: {
      format: 1,
      id: 'retro-desktop',
      name: 'Retro Desktop',
      extends: 'defined',
      localOnly: true,
      status: { waiting: '#553500', success: '#024a33', danger: '#7a1824', auto: '#663000' },
      frame: { ink: '#000000', paper: '#c0c0c0', accent: '#000080' },
      content: { ink: '#000000', paper: '#ffffff', accent: '#000080' },
      shared: {
        radius: 0,
        shadow: { style: 'hard', strength: 0 },
        fonts: { body: ['Microsoft Sans Serif', 'Tahoma', 'Verdana'], mono: ['Courier New'] },
      },
      window: { background: '#008080' },
      titlebar: { background: '#000080', ink: '#ffffff' },
      rail: {
        background: '#c0c0c0',
        item: {
          active: { fill: '#000080', ink: '#ffffff' },
          hover: { fill: '#000080', ink: '#ffffff' },
        },
      },
      brand: {
        mark: {
          color: '#c0c0c0',
          layers: [{ image: 'assets/flag.png', size: 'contain', repeat: false, pixelated: true }],
        },
        markInk: 'transparent',
      },
      drawer: {
        background: '#7fcfcf',
        tabs: '#c0c0c0',
        card: { fill: '#c0c0c0', ink: '#000000', line: '#808080' },
      },
      controls: { style: 'bevel', bevel: { light: '#ffffff', dark: '#0a0a0a' } },
      scrollbar: {
        style: 'bevel',
        thumb: '#767676',
        track: {
          color: '#dfdfdf',
          layers: [{ pattern: { kind: 'checker', color: '#ffffff', size: 2 } }],
        },
      },
      conversation: { background: '#ffffff' },
    },
    assets: { 'assets/flag.png': png(256, 224) },
    pictures: { 'assets/flag.png': samples('#000000', '#ffffff') },
  },
  paper: {
    file: {
      format: 1,
      id: 'paper',
      name: 'Paper',
      extends: 'defined',
      status: { waiting: '#553500', success: '#024a33', danger: '#7a1824', auto: '#663000' },
      frame: { ink: '#111111', paper: '#f3f1ec', accent: '#111111' },
      content: { ink: '#111111', paper: '#f7f5f0', accent: '#111111' },
      shared: { shadow: { strength: 0 }, fonts: { body: ['Iowan Old Style', 'Charter', 'serif'] } },
      pictures: { tone: 'grey' },
      motion: { transitions: 'none' },
    },
  },
  notebook: {
    file: {
      format: 1,
      id: 'notebook',
      name: 'Notebook',
      extends: 'defined',
      status: { waiting: '#553500', success: '#024a33', danger: '#7a1824', auto: '#663000' },
      frame: { ink: '#2a1a08', paper: '#c69c6d', accent: '#b71c1c' },
      content: { ink: '#1f3a8a', paper: '#fffefa', accent: '#c62828' },
      shared: { fonts: { body: ['Noteworthy', 'Bradley Hand', 'cursive'] } },
      titlebar: { background: '#4a3520', ink: '#fff8ec' },
      rail: {
        edge: { layers: [{ pattern: { kind: 'dots', color: '#3b3b3b', size: 14, thickness: 3 } }] },
      },
      conversation: {
        background: {
          color: '#fdfbf4',
          layers: [
            {
              gradient: {
                type: 'linear',
                angle: 90,
                stops: [
                  { color: 'transparent', at: 0 },
                  { color: 'transparent', at: 8 },
                  { color: 'rgb(229 115 115 / 30%)', at: 8 },
                  { color: 'transparent', at: 8.2 },
                ],
              },
            },
            { pattern: { kind: 'lines', color: 'rgb(120 160 220 / 22%)', size: 28 } },
          ],
        },
      },
      drawer: { background: '#dcc199', card: { fill: '#fff59d', ink: '#2a1a08' } },
      tokens: {
        frame: {
          muted: '#4a3416',
          faint: '#4a3416',
          'accent-text': '#5c0a0a',
          'focus-ring-color': '#5c0a0a',
        },
        content: {
          'accent-2-text': '#42439a',
          'text-soft': '#2a448f',
          muted: '#4b4b4b',
          faint: '#4b4b4b',
          'focus-ring-color': '#8e1b1b',
          'accent-text': '#5c0a0a',
        },
      },
    },
  },
  brocrew: {
    file: {
      format: 1,
      id: 'brocrew',
      name: 'BroCrew',
      extends: 'defined',
      status: { waiting: '#553500', success: '#024a33', danger: '#7a1824', auto: '#663000' },
      frame: { ink: '#f1f2ff', paper: '#14173a', accent: '#ff8a5c' },
      content: { ink: '#171a3a', paper: '#ffffff', accent: '#e8572a' },
      shared: { fonts: { body: ['Inter', 'Avenir Next', 'sans-serif'] } },
      type: {
        display: { font: ['Avenir Next', 'Avenir', 'Inter'], weight: 700, letterSpacing: -0.01 },
        brand: { font: ['Avenir Next'], weight: 700 },
      },
      titlebar: { background: '#10132f', ink: '#e9eaff' },
      rail: {
        background: {
          color: '#1b1f4b',
          layers: [{ image: 'assets/network.png', size: 280, repeat: true }],
        },
      },
      brand: {
        mark: { layers: [{ image: 'assets/crew.png', size: 'contain', repeat: false }] },
        markInk: 'transparent',
      },
      conversation: {
        background: {
          color: '#fbfaf7',
          layers: [{ image: 'assets/network-light.png', size: 280, repeat: true }],
        },
      },
      tokens: {
        content: {
          'accent-solid-bg': '#cf4719',
          'accent-text': '#a8380a',
          'paper-link': '#a8380a',
        },
      },
    },
    assets: {
      'assets/network.png': png(560, 660),
      'assets/network-light.png': png(560, 660),
      'assets/crew.png': png(96, 96),
    },
    pictures: {
      'assets/network.png': samples('#1b1f4b', '#2a2f66'),
      'assets/network-light.png': samples('#ece9f4', '#fbfaf7'),
      'assets/crew.png': samples('#14173a', '#ff8a5c'),
    },
  },
  'green-sky': {
    file: {
      format: 1,
      id: 'green-sky',
      name: 'Green Sky',
      extends: 'defined',
      status: { waiting: '#3d2600', success: '#013324', danger: '#5c0f18', auto: '#4a2300' },
      localOnly: true,
      frame: { ink: '#ffffff', paper: '#122260', accent: '#ffb02e' },
      content: { ink: '#13204d', paper: 'rgb(255 255 255 / 88%)', accent: '#e8630a' },
      type: {
        display: { font: ['Avenir Next'], weight: 800, style: 'italic' },
        brand: { font: ['Impact', 'Avenir Next Condensed'] },
      },
      window: { background: { layers: [{ image: 'assets/sky.png', size: 'cover' }] } },
      titlebar: { background: '#4a1a08', ink: '#ffffff', inkGlow: 'rgb(120 40 0 / 50%)' },
      rail: { background: 'rgb(18 34 96 / 88%)', glass: { blur: 10, saturate: 1.2 } },
      conversation: { background: 'rgb(246 255 240 / 88%)', glass: { blur: 7, saturate: 1.2 } },
      effects: [
        {
          type: 'float',
          zone: 'conversation',
          image: 'assets/orbs.png',
          anchor: 'top-right',
          x: 40,
          y: 40,
          size: 220,
          amplitude: 8,
          period: 7,
        },
      ],
      tokens: {
        frame: { waiting: '#ffd27a', success: '#7dffc8', danger: '#ffb3c0', auto: '#ffc48a' },
        content: {
          'accent-solid-bg': '#a4543e',
          'accent-text': '#9a3d00',
          'paper-link': '#9a3d00',
          muted: '#3c4670',
          faint: '#3c4670',
          'focus-ring-color': '#b84a00',
        },
      },
    },
    assets: { 'assets/sky.png': png(2400, 1350, 3_500_000), 'assets/orbs.png': png(440, 300) },
    pictures: { 'assets/sky.png': samples('#1f3d2a', '#d8f0c8') },
  },
  zen: {
    file: {
      format: 1,
      id: 'zen',
      name: 'Zen',
      extends: 'defined',
      status: { waiting: '#553500', success: '#024a33', danger: '#7a1824', auto: '#663000' },
      frame: { ink: '#f3eee2', paper: '#17213a', accent: '#f0a090' },
      content: { ink: '#1f1d1a', paper: '#faf6ec', accent: '#c8372d' },
      shared: { radius: 4, shadow: { strength: 4 } },
      rail: {
        background: {
          color: '#17213a',
          layers: [{ image: 'assets/seigaiha.png', size: 48, repeat: true }],
        },
      },
      conversation: { background: '#efe8d8' },
      effects: [
        {
          type: 'float',
          zone: 'conversation',
          image: 'assets/enso.png',
          anchor: 'bottom-right',
          x: 620,
          y: 360,
          size: 300,
          amplitude: 0,
        },
      ],
    },
    assets: { 'assets/seigaiha.png': png(96, 48), 'assets/enso.png': png(680, 680) },
    pictures: { 'assets/seigaiha.png': samples('#17213a', '#26324f') },
  },
  mario: {
    file: {
      format: 1,
      id: 'mario',
      name: 'Mario',
      extends: 'defined',
      status: { waiting: '#3d2600', success: '#013324', danger: '#5c0f18', auto: '#4a2300' },
      localOnly: true,
      frame: { ink: '#ffffff', paper: '#000000', accent: '#fbd000' },
      content: { ink: '#1d1a2e', paper: '#fff8e7', accent: '#e52521' },
      shared: { borderWidth: 2, radius: 4 },
      titlebar: { background: '#000000' },
      rail: {
        background: {
          layers: [
            {
              gradient: {
                type: 'linear',
                stops: [
                  { color: 'rgb(20 6 0 / 74%)', at: 0 },
                  { color: 'rgb(20 6 0 / 74%)', at: 100 },
                ],
              },
            },
            { image: 'assets/brick.png', size: 32, repeat: true, pixelated: true },
          ],
        },
      },
      brand: {
        mark: {
          layers: [{ image: 'assets/block.png', size: 'contain', repeat: false, pixelated: true }],
        },
        markInk: 'transparent',
      },
      conversation: {
        background: '#86aefc',
        textBacking: { fill: 'rgb(0 0 0 / 62%)', ink: '#fff4e0' },
      },
      composer: {
        surround: {
          layers: [
            // The bricks, dimmed under a cream wash so the hint over them reads.
            {
              gradient: {
                type: 'linear',
                stops: [
                  { color: 'rgb(255 248 231 / 82%)', at: 0 },
                  { color: 'rgb(255 248 231 / 82%)', at: 100 },
                ],
              },
            },
            { image: 'assets/brick.png', size: 32, repeat: true, pixelated: true },
          ],
        },
        field: { fill: '#fff8e7', ink: '#1d1a2e' },
      },
      motion: { underReduceMotion: 'stepped' },
      effects: [
        {
          type: 'band',
          edge: 'conversation-top',
          image: 'assets/clouds.png',
          height: 112,
          period: 60,
          steps: 4,
        },
        {
          type: 'band',
          edge: 'above-composer',
          image: 'assets/hills.png',
          height: 160,
          period: 90,
          steps: 4,
          sprites: [{ image: 'assets/goomba.png', frames: 2, period: 0.5, speed: 24 }],
        },
      ],
      tokens: {
        frame: {
          muted: '#ffe2b8',
          faint: '#ffe2b8',
          waiting: '#ffd27a',
          success: '#7dffc8',
          danger: '#ffb3c0',
          auto: '#ffc48a',
        },
        content: {
          'accent-solid-bg': '#da2825',
          'accent-2-text': '#3f3062',
          faint: '#3a3652',
          muted: '#3a3652',
          'focus-ring-color': '#1d1a2e',
          'accent-text': '#6e0b0a',
        },
      },
    },
    assets: {
      'assets/brick.png': png(16, 16, 300),
      'assets/block.png': png(16, 16, 300),
      'assets/clouds.png': png(688, 56),
      'assets/hills.png': png(688, 80),
      'assets/goomba.png': png(32, 16, 300),
    },
    pictures: {
      'assets/brick.png': samples('#000000', '#ffcec5'),
      'assets/block.png': samples('#000000', '#fbd000'),
    },
  },
}
