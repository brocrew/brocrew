import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import WorkingTogether from '../../src/renderer/src/components/WorkingTogether.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import {
  type AgentFacets,
  type RailSays,
  facetsOfState,
} from '../../src/renderer/src/lib/agent-state'
import { conversationList } from '../../src/renderer/src/lib/conversation-list'
import type { CastReading } from '../../src/renderer/src/lib/working-together'
import type { WorkEdge } from '../../src/shared/who-called-whom'
import { forestOf, task } from './forest-fixture'
import { mount, unmountAll } from './harness'
import { assertDrawn, drawnReady, inkRects, lineCount } from './drawn'
import {
  IDS,
  OWNER,
  PROFILE,
  TITLES,
  panelRows,
  panelIdentities,
  panelReading,
  panelWork,
} from './sub-agents-workers-fixture'

const cast = useWhoCalledWhom()
afterEach(() => {
  unmountAll()
  localStorage.removeItem('brobot2.subAgents.latestFirst')
  localStorage.removeItem('brobot2.subAgents.showIdle')
  cast.listedConversations.value = null
  cast.forest.value = null
  cast.railSays.value = null
  delete (window as { api?: unknown }).api
})
async function settle() {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
  await drawnReady()
}
async function band(width = 360, reading: CastReading = panelReading(), canOpen = true) {
  const opened: string[] = []
  const m = mount(
    WorkingTogether,
    {
      reading,
      conversation: OWNER,
      identities: panelIdentities(),
      canOpen,
      onOpenConversation: (conversation: string) => {
        opened.push(conversation)
      },
    },
    { width, height: 1400 },
  )
  m.host.style.containerType = 'inline-size'
  m.host.style.containerName = 'agent-card'
  m.q('working-together').style.width = `${width}px`
  await settle()
  return Object.assign(m, { opened })
}
function listed(rows = panelRows()) {
  cast.listedConversations.value = conversationList({ resumable: rows, unresumable: [] })
}

describe('Sub agents: distinct parallel workers and their pieces', () => {
  it.each([360, 560])(
    'names the owner and three workers with readable pieces at %s',
    async (width) => {
      listed()
      const m = await band(width)
      expect(m.q('cast-tile-name-' + OWNER).textContent).toBe('Ada · W90.1')
      expect(m.all('cast-tile-owner-' + OWNER)).toHaveLength(1)
      expect(m.q('cast-tile-owner-' + OWNER).textContent).toBe('this conversation')
      assertDrawn(m.q('cast-tile-owner-' + OWNER), 'the exact owner marker', m.host)
      for (let index = 0; index < IDS.length; index++) {
        const id = IDS[index]!
        const name = m.q('cast-tile-name-' + id)
        expect(name.textContent).toBe(`Ada · W90.${index + 1}`)
        assertDrawn(name, 'the worker name', m.host)
        const piece = m.q(`cast-tile-piece-${id}-W90.${index + 1}`)
        expect(piece.textContent).toBe(TITLES[index])
        assertDrawn(piece, 'the held piece label and title', m.host)
        expect(m.q(`cast-tile-profile-${id}`).textContent).toBe(PROFILE)
        if (id !== OWNER) expect(m.all('cast-tile-owner-' + id)).toHaveLength(0)
        m.host.querySelector<HTMLElement>(`[data-conversation="${id}"].agent-chip`)!.click()
      }
      expect(m.opened).toEqual(IDS)
    },
  )

  it('does not infer a worker number from identity or card position', async () => {
    cast.listedConversations.value = null
    const m = await band()
    expect(m.q('cast-tile-name-ada-worker-2').textContent).toBe('Ada')
    expect(m.all('cast-tile-owner-ada-worker-2')).toHaveLength(0)
    listed(panelRows().map((row) => ({ ...row, worker: undefined })))
    await nextTick()
    expect(m.q('cast-tile-name-ada-worker-3').textContent).toBe('Ada')
    listed()
    await nextTick()
    expect(m.q('cast-tile-name-ada-worker-2').textContent).toBe('Ada · W90.2')
  })

  it('keeps the last piece and title on a finished worker', async () => {
    const rows = panelRows()
    rows[1] = {
      ...rows[1]!,
      running: 'not-running',
      status: 'idle',
      state: { is: 'idle' },
      named: { ...rows[1]!.named!, ended: 'answered' },
    }
    listed(rows)
    const work = panelWork()
    work[1] = { ...work[1]!, state: 'answered', endedAt: 1800000000000 }
    const m = await band(360, panelReading(work))
    expect(m.q('cast-tile-name-ada-worker-2').textContent).toBe('Ada · W90.2')
    expect(m.q('cast-tile-piece-ada-worker-2-W90.2').textContent).toBe('Read the menu')
  })

  it('shows every open piece for the exact holder, including known forest work, once', async () => {
    const work = panelWork()
    const another: WorkEdge = {
      ...work[1]!,
      piece: 'extra-menu',
      label: 'W90.5',
      title: 'Read another menu',
      state: 'stalled',
    }
    cast.forest.value = forestOf([
      task('ada-worker-2', work[1]!.piece, work[1]!.label, work[1]!.title, OWNER),
      task(
        'ada-worker-2',
        'from-other-giver',
        'W91.1',
        'Check the ingredient notes',
        'other-giver',
      ),
    ])
    const rows = panelRows()
    rows[1] = { ...rows[1]!, named: { ...rows[1]!.named!, more: 2 } }
    listed(rows)
    const m = await band(360, panelReading([...work, another]))
    expect(m.all('cast-tile-piece-ada-worker-2-W90.2')).toHaveLength(1)
    expect(m.q('cast-tile-piece-ada-worker-2-extra-menu').textContent).toBe(
      'W90.5 · Read another menu',
    )
    assertDrawn(m.q('cast-tile-piece-ada-worker-2-extra-menu'), 'the additional open piece', m.host)
    assertDrawn(
      m.q('cast-tile-piece-ada-worker-2-from-other-giver'),
      'the other known giver’s piece',
      m.host,
    )
    expect(m.all('cast-tile-piece-ada-worker-3-extra-menu')).toHaveLength(0)
  })

  it('does not draw cards or piece subtitles from a different conversation reading', async () => {
    listed()
    const m = await band(360, { ...panelReading(), conversation: 'another-conversation' })
    expect(m.all('cast-children-strip')).toHaveLength(0)
    expect(m.all('cast-tile-owner-' + OWNER)).toHaveLength(0)
  })

  it('keeps card actions absent when the panel cannot open conversations', async () => {
    listed()
    const m = await band(360, panelReading(), false)
    const card = m.host.querySelector<HTMLElement>('.agent-chip[data-conversation="ada-worker-2"]')!
    expect(card.tagName).toBe('SPAN')
    card.click()
    expect(m.opened).toEqual([])
  })

  it('takes exact worker metadata from the existing rail read, including stopped rows', async () => {
    const rows = panelRows()
    rows[1] = {
      ...rows[1]!,
      running: 'not-running',
      status: 'idle',
      state: { is: 'idle' },
      named: { ...rows[1]!.named!, ended: 'answered' },
    }
    const listResumable = vi.fn(async () => rows)
    const listUnresumable = vi.fn(async () => [])
    window.api = { runtime: { listResumable, listUnresumable } } as never
    const rail = mount(
      SideRail,
      { open: [], activeId: OWNER, place: null, agents: null },
      { width: 251.68, height: 1000 },
    )
    await settle()
    expect(
      cast.listedConversations.value?.find((row) => row.sessionId === 'ada-worker-2')?.worker,
    ).toEqual(rows[1]!.worker)
    const m = await band()
    expect(m.q('cast-tile-name-ada-worker-2').textContent).toBe('Ada · W90.2')
    expect(listResumable).toHaveBeenCalledTimes(1)
    expect(listUnresumable).toHaveBeenCalledTimes(1)
    rail.unmount()
    expect(cast.listedConversations.value).toBeNull()
  })
})

describe('Sub agents view preferences', () => {
  it('keeps a never-used stable number and accounts for unread other pieces', async () => {
    const rows = panelRows()
    rows[1] = { ...rows[1]!, named: { label: 'W90.9', title: 'Latest menu', more: 3 } }
    rows[2] = { ...rows[2]!, named: null }
    listed(rows)
    const m = await band(360, panelReading([]))
    expect(m.q('cast-tile-name-ada-worker-2').textContent).toBe('Ada · W90.9')
    expect(m.q('cast-tile-piece-ada-worker-2-W90.9').textContent).toBe('Latest menu')
    expect(m.q('cast-tile-piece-ada-worker-2-more').textContent).toBe('and 3 more')
    expect(m.q('cast-tile-name-ada-worker-3').textContent).toBe('Ada (3)')
  })
  it('sorts by current activity only when pressed and remembers both preferences', async () => {
    const rows = panelRows().map((row, index) => ({ ...row, updatedAt: index * 100 }))
    listed(rows)
    const m = await band()
    const order = () =>
      [...m.host.querySelectorAll<HTMLElement>('.agent-chip')].map((el) => el.dataset.conversation)
    const original = order()
    assertDrawn(m.q('cast-latest-first'), 'latest first toggle', m.host)
    assertDrawn(m.q('cast-show-idle'), 'show idle toggle', m.host)
    m.q('cast-latest-first').click()
    await settle()
    expect(order()).toEqual([...IDS].reverse())
    listed(
      rows.map((row) => ({ ...row, updatedAt: row.sessionId === OWNER ? 999 : row.updatedAt })),
    )
    await settle()
    expect(order()[0]).toBe(OWNER)
    m.q('cast-latest-first').click()
    await settle()
    expect(order()).toEqual(original)
    m.q('cast-latest-first').click()
    m.q('cast-show-idle').click()
    await settle()
    m.unmount()
    const again = await band()
    expect(again.q('cast-latest-first').getAttribute('aria-pressed')).toBe('true')
    expect(again.q('cast-show-idle').getAttribute('aria-pressed')).toBe('false')
  })
  it('hides every idle card, including the owner and a worker with an unfinished piece; questions stay', async () => {
    const rows = panelRows().map((row) => ({
      ...row,
      state: { is: 'idle' as const },
      named: { ...row.named!, ended: 'answered' as const },
    }))
    listed(rows)
    cast.railSays.value = new Map(
      IDS.map((id) => [
        id,
        {
          facets: facetsOfState({ is: id === 'ada-worker-3' ? 'needs-you' : 'idle' }),
          word: id === 'ada-worker-3' ? 'needs you' : 'idle',
        },
      ]),
    )
    const work = panelWork()
      .filter((piece) => piece.to === 'ada-worker-4' || piece.to === OWNER)
      .map((piece) =>
        piece.to === OWNER
          ? { ...piece, state: 'answered' as const, endedAt: 1800000000000 }
          : piece,
      )
    const m = await band(360, panelReading(work))
    m.q('cast-show-idle').click()
    await settle()
    expect(m.all('cast-tile-name-ada-worker-2')).toHaveLength(0)
    expect(m.all('cast-tile-name-' + OWNER)).toHaveLength(0)
    expect(m.all('cast-tile-name-ada-worker-3')).toHaveLength(1)
    expect(m.all('cast-tile-name-ada-worker-4')).toHaveLength(0)
    expect(m.q('cast-idle-hidden').textContent).toBe('3 idle hidden')
    assertDrawn(m.q('cast-idle-hidden'), 'hidden idle count', m.host)
    cast.listedConversations.value = null
    await settle()
    expect(m.all('cast-tile-name-ada-worker-2')).toHaveLength(0)
    expect(m.q('cast-idle-hidden').textContent).toBe('3 idle hidden')
  })
  it.each<{ label: string; facets: AgentFacets }>([
    { label: 'waiting on an answer', facets: { doing: 'idle', waiting: 'waiting-on-an-answer' } },
    { label: 'waiting on work', facets: { doing: 'idle', waiting: 'waiting-on-a-worker' } },
    { label: 'owing an answer', facets: { doing: 'idle', owes: ['another-conversation'] } },
    { label: 'a question for the person', facets: { doing: 'idle', needing: 'question' } },
    { label: 'scheduled work', facets: { doing: 'idle', scheduled: true } },
    { label: 'background work', facets: { doing: 'idle', detached: true } },
    { label: 'unknown activity', facets: { doing: 'unknown' } },
    { label: 'unread activity', facets: {} },
  ])('keeps $label even when the listing says idle', async ({ facets }) => {
    const rows = panelRows().map((row) => ({
      ...row,
      state: { is: 'idle' as const },
      named: { ...row.named!, ended: 'answered' as const },
    }))
    listed(rows)
    cast.railSays.value = new Map(
      IDS.map((id) => [
        id,
        { facets: id === 'ada-worker-2' ? facets : facetsOfState({ is: 'idle' }), word: 'idle' },
      ]),
    )
    const ownerWork = panelWork()
      .filter((piece) => piece.to === OWNER)
      .map((piece) => ({ ...piece, state: 'answered' as const, endedAt: 1800000000000 }))
    const m = await band(360, panelReading(ownerWork))
    m.q('cast-show-idle').click()
    await settle()
    expect(m.all('cast-tile-name-ada-worker-2')).toHaveLength(1)
    assertDrawn(m.q('cast-tile-name-ada-worker-2'), 'worker retained by its facets', m.host)
    expect(m.all('cast-tile-name-ada-worker-3')).toHaveLength(0)
    expect(m.all('cast-tile-name-' + OWNER)).toHaveLength(0)
  })

  it('offers ordinary-card preferences and applies the saved filter without adding read-only presses', async () => {
    listed(panelRows().map((row) => ({ ...row, worker: undefined })))
    const legacy = await band()
    expect(legacy.all('cast-controls')).toHaveLength(1)
    legacy.unmount()
    listed(
      panelRows().map((row) => ({
        ...row,
        state: { is: 'idle' as const },
        named: { ...row.named!, ended: 'answered' as const },
      })),
    )
    cast.railSays.value = new Map(
      IDS.map((id) => [id, { facets: facetsOfState({ is: 'idle' }), word: 'idle' }]),
    )
    localStorage.setItem('brobot2.subAgents.showIdle', 'false')
    const ownerWork = panelWork()
      .filter((piece) => piece.to === OWNER)
      .map((piece) => ({ ...piece, state: 'answered' as const, endedAt: 1800000000000 }))
    const passive = await band(360, panelReading(ownerWork), false)
    expect(passive.all('cast-controls')).toHaveLength(1)
    expect(passive.q('working-together').querySelectorAll('button.agent-chip')).toHaveLength(0)
    expect(passive.all('cast-tile-name-ada-worker-2')).toHaveLength(0)
    expect(passive.all('cast-show-idle')).toHaveLength(0)
    expect(passive.q('working-together').querySelectorAll('button')).toHaveLength(0)
  })
  it.each([320, 380])('moves a long worker state below the complete name at %s', async (width) => {
    listed()
    const word = 'waiting on an answer from another conversation'
    cast.railSays.value = new Map(
      IDS.map((id) => [
        id,
        { facets: { doing: 'idle' as const, waiting: 'waiting-on-an-answer' as const }, word },
      ]),
    )
    const m = await band(width)
    const name = m.q('cast-tile-name-ada-worker-2')
    const state = m.q('cast-tile-word-ada-worker-2')
    const card = m.host.querySelector<HTMLElement>('[data-conversation="ada-worker-2"].agent-chip')!
    expect(card.hasAttribute('data-worker')).toBe(true)
    assertDrawn(name, 'the complete piece-labelled name within its worker card', card)
    expect(lineCount(name)).toBe(1)
    expect(inkRects(state)[0]!.top).toBeGreaterThanOrEqual(inkRects(name)[0]!.bottom)
    expect(state.title).toBe(word)
    expect(lineCount(state)).toBeLessThanOrEqual(2)
    assertDrawn(state, 'the two-line state within the worker card', card)
    cast.railSays.value = new Map(
      IDS.map((id) => [id, { facets: facetsOfState({ is: 'active' }), word: 'active' }]),
    )
    await settle()
    assertDrawn(name, 'the complete name beside a short state', card)
    assertDrawn(state, 'the short state at the top right', card)
    expect(lineCount(name)).toBe(1)
    expect(lineCount(state)).toBe(1)
    expect(inkRects(state)[0]!.left).toBeGreaterThan(inkRects(name)[0]!.right)
    expect(inkRects(state)[0]!.top).toBeLessThan(inkRects(name)[0]!.bottom)
  })

  it.each([false, true])(
    'keeps the name and lone state dot together before a rail row arrives, worker metadata=%s',
    async (workerKnown) => {
      if (workerKnown) listed()
      cast.railSays.value = new Map<string, RailSays>()
      const m = await band(320)
      const name = m.q('cast-tile-name-ada-worker-2')
      const card = name.closest<HTMLElement>('.agent-chip')!
      const dot = card.querySelector<HTMLElement>('.chip-dot')!
      expect(m.all('cast-tile-word-ada-worker-2')).toHaveLength(0)
      expect(card.hasAttribute('data-worker')).toBe(workerKnown)
      assertDrawn(name, 'agent name beside its lone dot before the rail row arrives', card)
      expect(inkRects(name)[0]!.right).toBeLessThanOrEqual(dot.getBoundingClientRect().left)
      expect(lineCount(name)).toBe(1)
    },
  )
})
