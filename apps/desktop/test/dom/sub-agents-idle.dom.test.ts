import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import WorkingTogether from '../../src/renderer/src/components/WorkingTogether.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { conversationList } from '../../src/renderer/src/lib/conversation-list'
import { mount, unmountAll } from './harness'
import { assertDrawn, drawnReady } from './drawn'
import { idlePanel, OWNER } from './sub-agents-idle-fixture'

const cast = useWhoCalledWhom()
afterEach(() => {
  unmountAll()
  localStorage.removeItem('brobot2.subAgents.showIdle')
  localStorage.removeItem('brobot2.subAgents.latestFirst')
  cast.railSays.value = null
  cast.listedConversations.value = null
  cast.forest.value = null
})
async function settle() {
  await nextTick()
  await drawnReady()
}
function supply(data: ReturnType<typeof idlePanel>) {
  cast.listedConversations.value = conversationList({ resumable: data.rows, unresumable: [] })
  cast.railSays.value = data.rail()
}
function show(data: ReturnType<typeof idlePanel>, canOpen = true) {
  supply(data)
  const opened = vi.fn()
  const view = mount(
    WorkingTogether,
    {
      conversation: OWNER,
      reading: data.reading,
      identities: data.identities,
      canOpen,
      telemetry: data.telemetry,
      onOpenConversation: opened,
    },
    { width: 560, height: 1000 },
  )
  return Object.assign(view, { opened })
}
function count(view: ReturnType<typeof show>) {
  return view.q('cast-sub-agents').querySelector('.count')?.textContent
}
function cards(view: ReturnType<typeof show>) {
  return [...view.host.querySelectorAll<HTMLElement>('.agent-chip')].map(
    (card) => card.dataset.conversation,
  )
}
function totals(view: ReturnType<typeof show>) {
  return [...view.q('cast-sub-agents-totals').querySelectorAll('.team-total')]
    .map((one) => one.textContent?.replace(/\s+/g, ' ').trim())
    .join(' ')
}

it.each([true, false])(
  'hides all ordinary idle cards with navigation enabled %s and keeps an honest total through toggles',
  async (canOpen) => {
    localStorage.setItem('brobot2.subAgents.showIdle', 'false')
    const view = show(idlePanel(), canOpen)
    await settle()
    expect(count(view)).toBe('(3)')
    expect(totals(view)).toBe('0 active 3 idle')
    expect(cards(view)).toEqual([])
    expect(view.q('cast-idle-hidden').textContent).toBe('3 idle hidden')
    expect(view.all('cast-idle-empty')).toHaveLength(1)
    expect(view.q('cast-idle-empty').textContent?.trim()).toBe('All sub agents are idle.')
    expect(view.all('cast-children-empty')).toHaveLength(0)
    if (!canOpen) {
      expect(view.q('working-together').querySelectorAll('button')).toHaveLength(0)
      expect(view.opened).not.toHaveBeenCalled()
      return
    }
    assertDrawn(view.q('cast-show-idle'), 'the idle toggle remains available', view.host)
    view.q('cast-show-idle').click()
    await settle()
    expect(cards(view)).toEqual(['fictional-reader-1', 'fictional-reader-2', 'fictional-reader-3'])
    expect(count(view)).toBe('(3)')
    expect(totals(view)).toBe('0 active 3 idle')
    expect(view.all('cast-idle-hidden')).toEqual([])
    expect(view.all('cast-idle-empty')).toEqual([])
    view.q('cast-show-idle').click()
    await settle()
    expect(cards(view)).toEqual([])
    expect(view.opened).not.toHaveBeenCalled()
    expect(localStorage.getItem('brobot2.subAgents.showIdle')).toBe('false')
  },
)

it('keeps active, needs-you and both kinds of wait while hiding exactly the idle conversations', async () => {
  localStorage.setItem('brobot2.subAgents.showIdle', 'false')
  const data = idlePanel(6)
  data.state(1, { is: 'active' })
  data.state(2, { is: 'needs-you' })
  data.state(3, { is: 'waiting-on-an-answer', from: 'Maple' })
  data.rows[4] = {
    ...data.rows[4]!,
    waitingOnPurpose: { label: 'W95.5', status: 'Waiting for the fictional draft.' },
  }
  const view = show(data)
  await settle()
  expect(cards(view)).toEqual(data.rows.slice(1, 5).map((row) => row.sessionId))
  expect(count(view)).toBe('(6)')
  expect(totals(view)).toBe('4 active 2 idle')
  expect(view.q('cast-idle-hidden').textContent).toBe('2 idle hidden')
  expect(view.q('cast-tile-word-fictional-reader-5').textContent).toBe('waiting on purpose')
  view.q('cast-show-idle').click()
  await settle()
  expect(cards(view)).toEqual(data.rows.map((row) => row.sessionId))
  expect(totals(view)).toBe('4 active 2 idle')
  view.q('cast-show-idle').click()
  await settle()
  data.state(0, { is: 'active' })
  supply(data)
  await settle()
  expect(cards(view)).toEqual(data.rows.slice(0, 5).map((row) => row.sessionId))
  expect(view.q('cast-idle-hidden').textContent).toBe('1 idle hidden')
  expect(totals(view)).toBe('5 active 1 idle')
})

it('counts fifteen ordinary conversations and twenty-four parallel workers in the same population', async () => {
  localStorage.setItem('brobot2.subAgents.showIdle', 'false')
  const data = idlePanel(15, 24)
  const view = show(data)
  await settle()
  expect(count(view)).toBe('(39)')
  expect(totals(view)).toBe('0 active 39 idle')
  expect(cards(view)).toEqual([])
  expect(view.q('cast-idle-hidden').textContent).toBe('39 idle hidden')
  view.q('cast-show-idle').click()
  await settle()
  expect(cards(view)).toEqual(data.rows.map((row) => row.sessionId))
  expect(new Set(cards(view)).size).toBe(39)
  expect(view.host.querySelectorAll('.agent-chip[data-worker]')).toHaveLength(24)
  expect(count(view)).toBe('(39)')
  expect(totals(view)).toBe('0 active 39 idle')
  expect(view.all('cast-idle-hidden')).toEqual([])
  view.q('cast-show-idle').click()
  await settle()
  expect(cards(view)).toEqual([])
  expect(view.q('cast-idle-hidden').textContent).toBe('39 idle hidden')
})

it('retains an unread state without calling it idle or inventing an active total', async () => {
  localStorage.setItem('brobot2.subAgents.showIdle', 'false')
  const data = idlePanel()
  const view = show(data)
  const partial = new Map(data.rail())
  partial.delete('fictional-reader-2')
  cast.railSays.value = partial
  await settle()
  expect(cards(view)).toEqual(['fictional-reader-2'])
  expect(count(view)).toBe('(3)')
  expect(view.q('cast-idle-hidden').textContent).toBe('2 idle hidden')
  expect(view.all('cast-sub-agents-totals')).toEqual([])
})

it('hides an idle worker even when its named root has no ending', async () => {
  localStorage.setItem('brobot2.subAgents.showIdle', 'false')
  const data = idlePanel(1, 1)
  data.rows[1] = {
    ...data.rows[1]!,
    named: { label: 'W95.2', title: 'A continuing fictional root' },
  }
  const view = show(data)
  await settle()
  expect(cards(view)).toEqual([])
  expect(count(view)).toBe('(2)')
  expect(view.q('cast-idle-hidden').textContent).toBe('2 idle hidden')
})

it('distinguishes a real empty population from hidden idle cards', async () => {
  localStorage.setItem('brobot2.subAgents.showIdle', 'false')
  const view = show(idlePanel(0))
  await settle()
  expect(count(view)).toBe('(0)')
  expect(cards(view)).toEqual([])
  expect(view.all('cast-children-empty')).toHaveLength(1)
  expect(view.all('cast-idle-empty')).toEqual([])
  expect(view.all('cast-idle-hidden')).toEqual([])
})
