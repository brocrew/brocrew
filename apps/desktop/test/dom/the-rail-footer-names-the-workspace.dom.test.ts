import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { mount, unmountAll } from './harness'

/**
 * # 🔴 A0 · the rail's footer names the workspace, never a person
 *
 * The footer drew a person's name and initials, written into the window. It now draws
 * `AppInfo.workspace`: its name, the name's first letter as the avatar, "Local workspace" beneath,
 * and its folder on hover. ⚑ Every assertion is paired with a second, non-default workspace, so a
 * footer that drew a constant could not pass.
 */

type Api = {
  runtime: { listResumable: () => Promise<never[]>; listUnresumable: () => Promise<never[]> }
}
const stubbed = (): { api?: Api } => window as unknown as { api?: Api }

afterEach(() => {
  unmountAll()
  delete stubbed().api
})

const railWith = async (workspaceFolder: unknown) => {
  stubbed().api = {
    runtime: {
      listResumable: () => Promise.resolve([]),
      listUnresumable: () => Promise.resolve([]),
    },
  }
  const rail = mount(
    SideRail,
    { open: [], activeId: null, place: null, workspaceFolder },
    { width: 251.68 },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return rail
}

const text = (element: Element | null): string =>
  element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

describe('A0 · the rail’s footer names the workspace', () => {
  it('🔴 the default workspace: its name, its first letter, and its folder on hover', async () => {
    const rail = await railWith({
      name: 'Default',
      path: '/Users/someone/Library/Application Support/@brobot2/desktop',
      isDefault: true,
    })
    const footer = rail.q('rail-workspace')
    expect(text(rail.q('rail-workspace-name'))).toBe('Default')
    expect(text(rail.q('rail-workspace-initial'))).toBe('D')
    expect(footer.getAttribute('title')).toBe(
      '/Users/someone/Library/Application Support/@brobot2/desktop',
    )
    expect(text(footer)).toContain('Local workspace')
  })

  it('⚑ …and a workspace with a name of its own says that name, not a constant', async () => {
    const rail = await railWith({
      name: 'research',
      path: '/Users/x/brobot-research',
      isDefault: false,
    })
    expect(text(rail.q('rail-workspace-name'))).toBe('research')
    expect(text(rail.q('rail-workspace-initial'))).toBe('R')
    expect(rail.q('rail-workspace').getAttribute('title')).toBe('/Users/x/brobot-research')
  })

  it('⛔ before the app has said, the footer names nobody', async () => {
    const rail = await railWith(null)
    const footer = rail.q('rail-workspace')
    expect(text(footer)).toBe('Local workspace')
    expect(footer.hasAttribute('title')).toBe(false)
  })
})
