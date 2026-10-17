import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { nextTick } from 'vue'
import ToolsRegister from '../../src/renderer/src/components/ToolsRegister.vue'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { contrastRatio, mixOklab, parseColour, type Rgba } from '../../src/shared/themes/colour'
import { SOLID_HOVER_ACCENT } from '../../src/shared/themes/contrast'
import { resolveTheme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import DEFINED_FILE from '../../resources/themes/defined/theme.json'
import type { AgentIdentities, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * A solid primary button, as the window draws it: a real one, the Tools page's Add server…, at
 * rest and under the pointer, in the content zone and in the frame's. Each fill is the
 * colour the readability check measures its text against, and the text reads on both.
 */

const BASE = (() => {
  const read = validateTheme(DEFINED_FILE, {
    assets: new Map(),
    builtIns: new Map(),
    builtIn: true,
  })
  if (!read.ok) throw new Error(JSON.stringify(read.problems))
  return read.theme
})()

const SOLID = (() => {
  const read = validateTheme(
    { format: 1, id: 'solid', name: 'Solid', extends: 'defined', shared: { accentStyle: 'solid' } },
    { assets: new Map(), builtIns: new Map([['defined', BASE]]) },
  )
  if (!read.ok) throw new Error(JSON.stringify(read.problems))
  return resolveTheme(read.theme, BASE)
})()

const NO_AGENTS: AgentIdentities = {
  identities: [],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
}

const canvas = document.createElement('canvas')
canvas.width = 1
canvas.height = 1
const ctx = canvas.getContext('2d', { willReadFrequently: true })!

/** The sRGB colour a computed colour paints. */
function painted(computed: string): Rgba {
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = computed
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return { r: d[0]!, g: d[1]!, b: d[2]!, a: 1 }
}

const near = (a: Rgba, b: Rgba): boolean =>
  Math.abs(a.r - b.r) <= 2 && Math.abs(a.g - b.g) <= 2 && Math.abs(a.b - b.b) <= 2

afterEach(() => {
  applyTheme(null)
  unmountAll()
})

describe('a solid button reads at rest and under the pointer', () => {
  it.each([
    ['content', SOLID.content!],
    ['frame', SOLID.frame!],
  ] as const)('in the %s zone', async (zone, seeds) => {
    applyTheme(SOLID)
    const button = await toolsButton(zone)

    const accent = parseColour(seeds.accent)!
    const paper = parseColour(seeds.paper)!
    const rest = painted(getComputedStyle(button!).backgroundColor)
    const ink = painted(getComputedStyle(button!).color)
    expect(rest, `${zone} rest fill`).toSatisfy((c: Rgba) => near(c, accent))
    expect(ink, `${zone} text`).toSatisfy((c: Rgba) => near(c, paper))

    await userEvent.hover(button!)
    const hover = painted(getComputedStyle(button!).backgroundColor)
    const measured = mixOklab(accent, SOLID_HOVER_ACCENT, paper)
    expect(hover, `${zone} hover fill`).toSatisfy((c: Rgba) => near(c, measured))
    expect(hover).not.toEqual(rest)

    for (const fill of [rest, hover]) expect(contrastRatio(ink, fill)).toBeGreaterThanOrEqual(4.5)
  })

  it('⛔ a dark accent override over a light seed: the hover is worked out from the override', async () => {
    // The stylesheet such a theme writes; whether the check accepts it is in the node tests.
    applyTheme(
      resolveTheme(
        {
          format: 1,
          id: 'override',
          name: 'Override',
          extends: 'defined',
          content: { ink: '#1b2238', paper: '#ffffff', accent: '#d0d0d0' },
          tokens: { content: { accent: '#2f2f2f' } },
          shared: { accentStyle: 'solid' },
        },
        BASE,
      ),
    )
    const button = await toolsButton('content')
    await userEvent.hover(button)
    const hover = painted(getComputedStyle(button).backgroundColor)
    const override = parseColour('#2f2f2f')!
    const paper = parseColour(BASE.content!.paper)!
    expect(hover).toSatisfy((c: Rgba) => near(c, mixOklab(override, SOLID_HOVER_ACCENT, paper)))
  })
})

/** The Tools page's real Add server… button, in the content zone or the frame's. */
async function toolsButton(zone: 'content' | 'frame'): Promise<HTMLElement> {
  const store = createAgentStore({
    agentIdentities: async () => NO_AGENTS,
  } as unknown as RuntimeBridge)
  await store.load()
  const m = mount(
    ToolsRegister,
    { store, capabilities: null, now: 0 },
    { width: 1100, height: 700 },
  )
  await nextTick()
  // The page is a light surface; without its light scope it takes the frame's colours.
  if (zone === 'frame') m.host.querySelector('.tools-surface')!.removeAttribute('data-chat-theme')
  const button = m.host.querySelector<HTMLElement>('[data-cy="tools-add-server"]')
  expect(button, 'the Tools page draws its primary button').not.toBeNull()
  return button!
}
