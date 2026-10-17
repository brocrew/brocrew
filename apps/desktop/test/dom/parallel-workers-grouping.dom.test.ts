import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, shallowReactive } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { conversationList, groupWorkers } from '../../src/renderer/src/lib/conversation-list'
import { createSessionRecord } from '../../src/renderer/src/lib/session-record'
import type { RuntimeStatesMessage } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'
import { assertDrawn, drawnReady, inkRects, lineCount } from './drawn'
import { identities, workerRows, store, activity } from './parallel-workers-fixture'

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  await drawnReady()
}
afterEach(() => {
  unmountAll()
  delete (window as { api?: unknown }).api
})
async function rail(rows = workerRows(), open: unknown[] = [], collapsed = false) {
  window.api = {
    runtime: { listResumable: async () => rows, listUnresumable: async () => [] },
  } as never
  const selected: string[] = []
  const m = mount(
    SideRail,
    {
      onSelect: (id: string) => selected.push(id),
      open,
      activeId: 'recipe-2',
      place: null,
      agents: identities(rows.length),
      collapsed,
    },
    { width: 251.68, height: 1000 },
  )
  await settle()
  return Object.assign(m, { selected })
}
async function team(rows = workerRows()) {
  const opened: string[] = []
  const props = shallowReactive({
    onOpenConversation: (id: string) => {
      opened.push(id)
    },
    agents: identities(rows.length),
    store,
    beingDone: activity(rows),
    conversations: conversationList({
      resumable: rows,
      unresumable: [],
      identities: identities().identities,
    }),
  })
  const shell = defineComponent(() => () => h(TeamWorkspace, props))
  const m = mount(shell, {}, { width: 760, height: 1200 })
  await settle()
  return { m, props, opened }
}
const ids = (elements: HTMLElement[]) => elements.map((el) => el.dataset.sessionId)

describe('parallel workers beside their agent', () => {
  it('passes through exact host bindings on both lists, without inventing legacy bindings', () => {
    const [a, b] = workerRows(2)
    const legacy = { ...a!, sessionId: 'legacy', worker: undefined }
    const rows = conversationList({
      resumable: [a!, legacy],
      unresumable: [
        { ...b!, reason: 'No reference', foundInUserHome: false, restoredFromBundle: false },
      ],
    })
    expect(rows.find((one) => one.sessionId === a!.sessionId)!.worker).toBe(a!.worker)
    expect(rows.find((one) => one.sessionId === b!.sessionId)!.worker).toBe(b!.worker)
    expect(rows.find((one) => one.sessionId === 'legacy')!.worker).toBeUndefined()
  })

  it.each([1, 3])(
    'the rail groups %s workers in durable order, with work and state intact',
    async (count) => {
      const m = await rail(workerRows(count))
      expect(m.all('rail-worker-heading')).toHaveLength(1)
      expect(m.q('rail-worker-heading').textContent).toBe('Mira')
      assertDrawn(m.q('rail-worker-heading'), 'the agent heading', m.host)
      const rows = [...m.q('rail-rows-agents').querySelectorAll<HTMLElement>('[data-session-id]')]
      expect(ids(rows)).toEqual(Array.from({ length: count }, (_, i) => `recipe-${i + 1}`))
      for (let i = 1; i <= count; i++) {
        const label = m.q(`rail-worker-name-recipe-${i}`)
        expect(label.textContent).toBe(`Mira · W90.${i}`)
        assertDrawn(label, 'the numbered worker name', m.host)
        expect(lineCount(label)).toBe(1)
        expect(m.q(`open-session-recipe-${i}`).title).toBe(
          i === 1 ? 'Worker: recipe-worker.' : `Worker: recipe-worker (${i}).`,
        )
        expect(m.q(`open-session-recipe-${i}`).textContent).toContain(`W90.${i}`)
        expect(m.q(`open-session-recipe-${i}`).dataset.worker).toBe('true')
        expect(m.q(`open-session-recipe-${i}`).classList.contains('active')).toBe(i === 2)
        expect(m.q(`rail-state-word-recipe-${i}`).textContent).toBe('active')
      }
      m.q('open-session-recipe-1').click()
      expect(m.selected).toEqual(['recipe-1'])
      expect(inkRects(m.q('rail-worker-name-recipe-1'))[0]!.left).toBeGreaterThan(
        inkRects(m.q('rail-worker-heading'))[0]!.left,
      )
    },
  )

  it('separates giver pools and legacy conversations of the same profile', async () => {
    const rows = workerRows()
    rows[1] = { ...rows[1]!, worker: { ...rows[1]!.worker!, giver: 'other-menu' } }
    rows.push({ ...rows[0]!, sessionId: 'legacy', worker: undefined, updatedAt: 0 })
    const m = await rail(rows)
    expect(
      m
        .all('rail-worker-heading')
        .map((el) => el.dataset.giver)
        .sort(),
    ).toEqual(['menu-conversation', 'other-menu'])
    expect(m.q('open-session-legacy').hasAttribute('data-worker')).toBe(false)
    expect(
      groupWorkers(conversationList({ resumable: rows, unresumable: [] }), (row) => row.sessionId),
    ).toHaveLength(3)
  })

  it('keeps a finished worker’s last piece beside active workers', async () => {
    const m = await rail(workerRows(3, true))
    expect(m.q('rail-worker-name-recipe-2').textContent).toBe('Mira · W90.2')
    const name = m.q('rail-worker-name-recipe-2')
    expect(m.q('open-session-recipe-2').querySelector('.rail-copy > strong')).toBe(name)
    expect(lineCount(name)).toBe(1)
    expect(getComputedStyle(name).textOverflow).toBe('ellipsis')
    expect(getComputedStyle(name).whiteSpace).toBe('nowrap')
    expect(name.title).toContain('Mira · W90.2')

    expect(m.q('rail-state-word-recipe-2').textContent).toBe('idle · answered')
    assertDrawn(m.q('rail-state-word-recipe-2'), 'the ended idle state', m.host)
    expect(lineCount(m.q('rail-state-word-recipe-2'))).toBe(1)
    expect(m.q('open-session-recipe-2').textContent).toContain('idle · answered')
    expect(m.q('open-session-recipe-2').getAttribute('data-active')).toBe('true')
  })

  it('a state push keeps the worker in its group and preserves row selection', async () => {
    const m = await rail()
    const heard: RuntimeStatesMessage = {
      moved: [{ conversation: 'recipe-2', state: { is: 'needs-you' } }],
      kept: [],
    }
    ;(m.vm.hearStates as (message: RuntimeStatesMessage) => void)(heard)
    await nextTick()
    expect(m.q('rail-state-word-recipe-2').textContent).toBe('needs you')
    expect(m.q('rail-worker-name-recipe-2').textContent).toBe('Mira · W90.2')
    expect(m.q('open-session-recipe-2').getAttribute('aria-label')).toContain('W90.2')
  })

  it('held rows use the same host binding; a held row absent from the host stays ungrouped', async () => {
    const record = createSessionRecord('recipe-2')
    record.meta = {
      provider: 'codex',
      profileId: 'recipe-worker',
      cwd: '/made-up/bakery',
      liveness: { state: 'live', since: 1800000000000 },
    } as never
    const absent = createSessionRecord('unlisted')
    absent.meta = record.meta
    const m = await rail(workerRows(), [record, absent])
    expect(m.q('rail-worker-name-recipe-2').textContent).toBe('Mira · W90.2')
    expect(m.q('open-session-unlisted').hasAttribute('data-worker')).toBe(false)
  })

  it('collapsed rows keep the full work title and worker hover with their normal avatar alignment', async () => {
    const m = await rail(workerRows(), [], true)
    expect(getComputedStyle(m.q('rail-worker-heading')).display).toBe('none')
    expect(getComputedStyle(m.q('open-session-recipe-2')).paddingLeft).toBe('0px')
    const button = m.q('open-session-recipe-2')
    expect(getComputedStyle(button.querySelector<HTMLElement>('.rail-copy')!).display).toBe('none')
    expect(button.title).toBe('Mira · W90.2\nW90.2 · Menu\nWorker: recipe-worker (2).')
    expect(button.title).toContain('W90.2 · Menu')
    expect(button.title).toContain('Worker: recipe-worker (2).')
    expect(m.q('open-session-recipe-1').title).toBe(
      'Mira · W90.1\nW90.1 · Recipe\nWorker: recipe-worker.',
    )
  })

  it.each([1, 3])(
    'Team shows %s workers under one agent, without changing their open actions',
    async (count) => {
      const { m, opened } = await team(workerRows(count))
      expect(m.all('team-worker-group')).toHaveLength(1)
      const names = [...m.q('team-worker-group').querySelectorAll<HTMLElement>('.team-worker-name')]
      expect(names.map((el) => el.textContent)).toEqual(
        Array.from({ length: count }, (_, i) => `Mira · W90.${i + 1}`),
      )
      for (const el of names) assertDrawn(el, 'the Team worker name', m.host)
      for (let i = 1; i <= count; i++) {
        const button = m.q(`team-worker-go-recipe-${i}`)
        expect(button.textContent).toContain('Open the conversation')
        assertDrawn(button, 'the existing conversation action', m.host)
        button.click()
        expect(m.q(`team-worker-recipe-${i}`).textContent).toContain(`W90.${i}`)
        expect(m.q(`team-worker-name-recipe-${i}`).title).toContain(`Mira · W90.${i}`)
        expect(m.q(`team-worker-recipe-${i}`).textContent).toMatch(/active|Nothing published/)
        expect(m.all(`team-go-recipe-${i}`)).toHaveLength(0)
      }
      expect(opened).toEqual(Array.from({ length: count }, (_, i) => `recipe-${i + 1}`))
    },
  )

  it('Team keeps a finished worker and updates its existing state/detail', async () => {
    const { m, props } = await team()
    props.conversations = conversationList({ resumable: workerRows(3, true), unresumable: [] })
    props.beingDone = activity(workerRows(3, true))
    await nextTick()
    expect(m.q('team-worker-name-recipe-2').textContent).toBe('Mira · W90.2')
    expect(m.q('team-worker-recipe-2').textContent).toContain('idle')
    expect(m.q('team-worker-recipe-2').textContent).toContain('idle · answered')
    assertDrawn(m.q('team-worker-name-recipe-2'), 'the retained worker name', m.host)
  })

  it('Team keeps unbound conversations in the ordinary conversation shelf', async () => {
    const legacy = { ...workerRows(1)[0]!, sessionId: 'legacy', worker: undefined }
    const { m } = await team([legacy])
    expect(m.all('team-worker-group')).toHaveLength(0)
    ;(m.q('team-shelf-recipe-worker') as HTMLDetailsElement).open = true
    await nextTick()
    expect(m.q('team-conversation-legacy').textContent).toContain('W90.1')
  })
})
