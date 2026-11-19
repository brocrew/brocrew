import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import type { AgentIdentities, AgentIdentity } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'

const identity = (slug: string): AgentIdentity => ({
  id: `agp:default:${slug}`,
  slug,
  displayName: null,
  createdAt: 1_700_000_000_000,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  provider: null,
  // ⚑ **516** — presence IS the grant, so an empty list is *granted none*, not *not chosen*.
  externalMcpServerIds: [],
})

const agents = (over: Partial<AgentIdentities> = {}): AgentIdentities => ({
  identities: [identity('pm'), identity('worker')],
  foldersWithoutARow: [],
  use: [],
  // 500 · required on `AgentIdentities`; none of these fixtures is about the launch default.
  defaultApprovalMode: 'ask',
  // ⚑ **516** — the global registry, carried on the same read; empty is a real answer.
  externalMcpServers: [],
  ...over,
})

async function page(
  identities: AgentIdentities | null = agents(),
): Promise<{ m: Mounted; opened: string[] }> {
  const opened: string[] = []
  const m = mount(
    TeamWorkspace,
    {
      agents: identities,
      onOpen: (slug: string) => opened.push(slug),
      store: {
        renameTo: () => {
          throw new Error('this file presses no write door')
        },
        remove: () => {
          throw new Error('this file presses no write door')
        },
      },
    },
    { width: 1100, height: 900 },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return { m, opened }
}

afterEach(unmountAll)

describe('Team directory', () => {
  it('⚑ an identity row opens its own sheet', async () => {
    const { m, opened } = await page()
    // ⚠️ **570 · the DOOR moved with the row and it is the same door.** The rail's agent row was
    // the only opener of the capability sheet in the whole renderer; `RuntimeScreen` listens to
    // this page's `open` now and raises exactly the overlay the rail used to raise.
    m.q('team-open-pm').click()
    await nextTick()
    expect(opened).toEqual(['pm'])
  })

  /** ⛔ §4's trap, on the surface a person actually meets it on. */
  it('⛔ names a folder with no identity, without offering it as one', async () => {
    const { m } = await page(agents({ foldersWithoutARow: ['half-typed'] }))
    expect(m.q('team-other-home-folders').textContent).toContain('half-typed')
    expect(m.all('team-card-half-typed')).toHaveLength(0)
    // ⚑ The pair: an identity that DOES have a row is a row you can press.
    expect(m.all('team-card-pm')).toHaveLength(1)
    // ⚠️ **570 · and the page says what to DO about it**, which the rail's version also did —
    // `EXT-008` §2 listed that sentence as prose in navigation and §3 said where it belongs.
    expect(m.q('team-other-home-folders-says').textContent?.replace(/\s+/g, ' ')).toContain(
      'Create one with the same name to give it its row',
    )
  })

  it('⛔ is not marked "soon"', async () => {
    const m = mount(SideRail, { open: [], activeId: null, place: null, agents: agents() })
    await nextTick()
    expect(m.q('rail-team').getAttribute('data-wired')).toBe('true')
    expect(m.q('rail-team').closest('[data-wired="false"]')).toBe(null)
  })

  it('distinguishes pending and empty identity lists', async () => {
    const { m } = await page(null)
    expect(m.q('team-loading').textContent).toContain('Reading identities')
    expect(m.all('team-count')).toHaveLength(0)
    expect(m.all('team-none')).toHaveLength(0)

    const { m: empty } = await page({
      identities: [],
      foldersWithoutARow: [],
      use: [],
      // ⚑ **516** — an ANSWER carries the registry too, and an empty one is a real answer.
      externalMcpServers: [],
      defaultApprovalMode: 'ask',
    })
    expect(empty.all('team-loading')).toHaveLength(0)
    expect(empty.q('team-count').textContent).toBe('0')
    expect(empty.q('team-none').textContent).toContain('No agent identities yet')
  })
})
