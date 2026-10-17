import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, shallowReactive } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import WorkingTogether from '../../src/renderer/src/components/WorkingTogether.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { conversationList } from '../../src/renderer/src/lib/conversation-list'
import type { AgentIdentities, ResumableSessionInfo } from '../../src/shared/runtime-ipc'
import { assertDrawn, drawnReady } from './drawn'
import { mount, unmountAll } from './harness'
import { activity, identities, store, workerRows } from './parallel-workers-fixture'
import {
  IDS,
  OWNER,
  PROFILE,
  PROFILE_ID,
  panelIdentities,
  panelReading,
  panelRows,
} from './sub-agents-workers-fixture'

/**
 * The host names a parallel worker's identity by its id (`aid:travel-writing`), which is no name.
 * Every surface that titles a worker says the identity's name, else its slug: "Ana · W5.1.1".
 */

const cast = useWhoCalledWhom()

/** Everything a person can read or hear on a surface: its text, its hovers and its descriptions. */
function said(host: HTMLElement): string {
  const attributes = [...host.querySelectorAll('*')].flatMap((el) =>
    ['title', 'aria-label', 'aria-description'].map((name) => el.getAttribute(name) ?? ''),
  )
  return [host.textContent ?? '', ...attributes].join('\n')
}

afterEach(() => {
  unmountAll()
  cast.listedConversations.value = null
  delete (window as { api?: unknown }).api
})

const settle = async (): Promise<void> => {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
  await drawnReady()
}

/** The fixture's one identity, with the name a person gave it or none. */
function named(displayName: string | null): AgentIdentities {
  const read = identities(3)
  return { ...read, identities: [{ ...read.identities[0]!, displayName }] }
}

describe('Sub agents', () => {
  const band = async (displayName: string | null) => {
    cast.listedConversations.value = conversationList({ resumable: panelRows(), unresumable: [] })
    const m = mount(
      WorkingTogether,
      {
        reading: panelReading(),
        conversation: OWNER,
        identities: [{ ...panelIdentities()[0]!, displayName }],
        canOpen: true,
      },
      { width: 560, height: 1400 },
    )
    await settle()
    return m
  }

  it('titles a worker whose identity is an id with the identity’s name', async () => {
    expect(panelRows()[1]!.worker!.identity).toBe(PROFILE_ID)
    const m = await band('Ana')
    const name = m.q(`cast-tile-name-${IDS[1]}`)
    expect(name.textContent).toBe('Ana · W90.2')
    assertDrawn(name, 'the worker’s name', m.host)
    expect(said(m.host)).not.toContain(PROFILE_ID)
  })

  it('titles it with the slug when the identity has no name', async () => {
    const m = await band(null)
    expect(m.q(`cast-tile-name-${IDS[1]}`).textContent).toBe(`${PROFILE} · W90.2`)
    expect(said(m.host)).not.toContain(PROFILE_ID)
  })
})

describe('the rail', () => {
  const rail = async (agents: AgentIdentities, rows: ResumableSessionInfo[] = workerRows()) => {
    window.api = {
      runtime: { listResumable: async () => rows, listUnresumable: async () => [] },
    } as never
    const m = mount(
      SideRail,
      { open: [], activeId: null, place: null, agents, collapsed: false },
      { width: 251.68, height: 1000 },
    )
    await settle()
    return m
  }

  it('heads the workers with the identity’s name, and describes each by its slug', async () => {
    const m = await rail(named('Ana'))
    expect(m.q('rail-worker-heading').textContent?.trim()).toBe('Ana')
    expect(m.q('rail-worker-name-recipe-2').textContent).toBe('Ana · W90.2')
    expect(m.q('open-session-recipe-2').title).toBe('Worker: recipe-worker (2).')
    expect(m.q('open-session-recipe-1').getAttribute('aria-description')).toBe(
      'Worker: recipe-worker.',
    )
    expect(said(m.host)).not.toContain('aid:recipe-worker')
  })

  it('names it by the slug when the identity has no name', async () => {
    const m = await rail(named(null))
    expect(m.q('rail-worker-heading').textContent?.trim()).toBe('recipe-worker')
    expect(m.q('rail-worker-name-recipe-2').textContent).toBe('recipe-worker · W90.2')
    expect(said(m.host)).not.toContain('aid:recipe-worker')
  })
})

describe('Team', () => {
  const team = async (agents: AgentIdentities) => {
    const rows = workerRows()
    const props = shallowReactive({
      agents,
      store,
      beingDone: activity(rows),
      conversations: conversationList({
        resumable: rows,
        unresumable: [],
        identities: agents.identities,
      }),
    })
    const m = mount(
      defineComponent(() => () => h(TeamWorkspace, props)),
      {},
      { width: 760, height: 1200 },
    )
    await settle()
    return m
  }

  it('titles a worker with the identity’s name, and describes it by its slug', async () => {
    const m = await team(named('Ana'))
    const name = m.q('team-worker-name-recipe-2')
    expect(name.textContent).toBe('Ana · W90.2')
    expect(name.title).toBe('Ana · W90.2\nWorker: recipe-worker (2).')
    assertDrawn(name, 'the worker’s name on Team', m.host)
    expect(said(m.host)).not.toContain('aid:recipe-worker')
  })

  it('titles it with the slug when the identity has no name', async () => {
    const m = await team(named(null))
    expect(m.q('team-worker-name-recipe-2').textContent).toBe('recipe-worker · W90.2')
    expect(said(m.host)).not.toContain('aid:recipe-worker')
  })
})
