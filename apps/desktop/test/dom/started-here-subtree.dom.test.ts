import { afterEach, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'
import WorkingTogether from '../../src/renderer/src/components/WorkingTogether.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { CastReading } from '../../src/renderer/src/lib/working-together'
import type { ListedConversation } from '../../src/renderer/src/lib/conversation-list'
import type { ForestNode } from '../../src/shared/the-whole-forest'
import { conv, forestOf } from './forest-fixture'
import { mount, unmountAll } from './harness'

const cast = useWhoCalledWhom()
const root = 'sess_workshop'
afterEach(() => {
  unmountAll()
  cast.forest.value = null
  cast.listedConversations.value = null
  cast.railSays.value = null
  localStorage.removeItem('brobot2.subAgents.latestFirst')
  localStorage.removeItem('brobot2.subAgents.showIdle')
})
function reading(children = ['sess_1']): CastReading {
  return {
    conversation: root,
    answered: true,
    atWork: null,
    read: {
      conversation: root,
      parent: null,
      readAt: 1,
      children: {
        rows: children.map((conversation) => ({
          conversation,
          identity: conversation.slice(5),
          provider: 'claude' as const,
          running: 'not-running' as const,
        })),
        walk: 'every-conversation-this-one-spawned',
        ledgers: children.length,
        rowsUnread: 0,
      },
      workGivenOut: {
        rows: [],
        walk: 'every-conversation-this-one-gave-work-to',
        ledgers: 0,
        rowsUnread: 0,
      },
      workTakenIn: {
        rows: [],
        walk: 'every-piece-of-work-this-one-was-given',
        ledgers: 0,
        rowsUnread: 0,
      },
    },
  }
}
function chain(length: number): ForestNode[] {
  return [
    conv(root, null),
    ...Array.from({ length }, (_, i) => conv(`sess_${i + 1}`, i === 0 ? root : `sess_${i}`)),
  ]
}
async function panel(rows: readonly ForestNode[] | null, read = reading(), canOpen = true) {
  cast.forest.value = rows === null ? null : forestOf(rows)
  const opened: string[] = []
  const props = reactive({
    reading: read,
    conversation: root,
    identities: null,
    canOpen,
    onOpenConversation: (id: string) => opened.push(id),
  })
  const wrapper = defineComponent({ setup: () => () => h(WorkingTogether, props) })
  const m = mount(wrapper, {}, { width: 360, height: 1800 })
  m.host.style.container = 'agent-card / inline-size'
  m.q('working-together').style.width = '360px'
  await nextTick()
  return Object.assign(m, { opened, props })
}
function cards(m: { host: HTMLElement }) {
  return [
    ...m.host.querySelectorAll<HTMLElement>('[data-cy="cast-children-strip"] [data-conversation]'),
  ]
}
const ids = (m: { host: HTMLElement }) => cards(m).map((card) => card.dataset.conversation)

it('shows the six-deep creation chain, its count, direction and working navigation', async () => {
  const m = await panel([
    ...chain(6),
    conv('sess_other', null),
    conv('sess_unrelated', 'sess_other', { identity: '1' }),
  ])
  expect(ids(m)).toEqual(['sess_1', 'sess_2', 'sess_3', 'sess_4', 'sess_5', 'sess_6'])
  expect(m.q('cast-sub-agents').querySelector('.count')?.textContent).toBe('(6)')
  expect(m.all('cast-tile-relation').map((el) => el.textContent)).toEqual([
    'Direct',
    'Level 2 · via 1',
    'Level 3 · via 2',
    'Level 4 · via 3',
    'Level 5 · via 4',
    'Level 6 · via 5',
  ])
  expect(cards(m).map((card) => card.parentElement?.dataset.depth)).toEqual([
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
  ])
  const left = cards(m).map((card) => card.getBoundingClientRect().left)
  expect(left[1]).toBeGreaterThan(left[0]!)
  expect(left[3]).toBeGreaterThan(left[2]!)
  expect(left[5]).toBe(left[3])
  for (const card of cards(m)) {
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
    card.click()
  }
  expect(m.opened).toEqual(ids(m))
})

it('keeps a parent beside its descendants when latest first sorts sibling groups', async () => {
  const m = await panel(
    [...chain(3), conv('sess_second', root)],
    reading(['sess_1', 'sess_second']),
  )
  // The panel already holds updated times in the rail listing. Only those facts are needed here.
  cast.listedConversations.value = [
    ['sess_second', 10],
    ['sess_1', 2],
    ['sess_2', 20],
    ['sess_3', 30],
  ].map(
    ([id, updated]) =>
      ({
        sessionId: String(id),
        updatedAt: Number(updated),
        provider: 'claude',
        label: String(id),
        identity: String(id),
        place: null,
        state: { is: 'idle' },
        named: null,
        inAnotherWindow: false,
      }) satisfies ListedConversation,
  )
  m.q('cast-latest-first').click()
  await nextTick()
  expect(ids(m)).toEqual(['sess_second', 'sess_1', 'sess_2', 'sess_3'])
})

it('keeps descendants visible with their recorded level when their idle parent is hidden', async () => {
  cast.railSays.value = new Map([
    ['sess_1', { facets: { doing: 'idle' }, word: 'idle' }],
    ['sess_2', { facets: { doing: 'working' }, word: 'working' }],
  ])
  const m = await panel(chain(2))
  m.q('cast-show-idle').click()
  await nextTick()
  expect(ids(m)).toEqual(['sess_2'])
  expect(m.q('cast-idle-hidden').textContent).toContain('1 idle hidden')
  expect(m.all('cast-tile-relation')[0]?.textContent).toBe('Level 2 · via 1')
  expect(m.q('cast-sub-agents').querySelector('.count')?.textContent).toBe('(2)')
})

it('discloses an absent, bounded or unread tree and keeps the direct-child fallback', async () => {
  const m = await panel(null)
  expect(ids(m)).toEqual(['sess_1'])
  expect(m.q('cast-tree-notice').textContent).toContain('rest of the tree loads')
  const forest = forestOf(chain(2))
  cast.forest.value = { ...forest, conversations: 600 }
  await nextTick()
  expect(ids(m)).toEqual(['sess_1', 'sess_2'])
  expect(m.q('cast-tree-notice').textContent).toContain('More agents may be missing')
  cast.forest.value = { ...forest, nodes: { ...forest.nodes, rowsUnread: 1 } }
  await nextTick()
  expect(m.all('cast-tree-notice')).toHaveLength(1)
  cast.forest.value = forest
  await nextTick()
  expect(m.all('cast-tree-notice')).toHaveLength(0)
})

it('walks a deep tree without recursion, renders bounded batches and resets them on navigation', async () => {
  const m = await panel(chain(499))
  expect(cards(m)).toHaveLength(40)
  expect(m.q('cast-sub-agents').querySelector('.count')?.textContent).toBe('(499)')
  while (m.all('cast-show-more').length) {
    m.q('cast-show-more').click()
    await nextTick()
  }
  expect(cards(m)).toHaveLength(499)
  expect(cards(m).at(-1)?.parentElement?.dataset.depth).toBe('499')
  m.props.conversation = 'sess_1'
  m.props.reading = {
    ...reading(['sess_2']),
    conversation: 'sess_1',
    read: { ...reading(['sess_2']).read, conversation: 'sess_1' },
  }
  await nextTick()
  expect(cards(m)).toHaveLength(40)
})

it('keeps descendants under a replacement, with one card per conversation and no cycle', async () => {
  const m = await panel([
    conv(root, null),
    conv('sess_1', root, { inItsPlace: { is: 'a-conversation', conversation: 'sess_new' } }),
    conv('sess_2', 'sess_1'),
    conv('sess_new', 'sess_1', { standsInFor: [{ is: 'a-conversation', conversation: 'sess_1' }] }),
    conv('sess_cycle', 'sess_cycle'),
  ])
  expect(ids(m)).toEqual(['sess_new', 'sess_2'])
  expect(m.all('cast-tile-relation').map((el) => el.textContent)).toEqual([
    'Direct',
    'Level 2 · via new',
  ])
})

it('has no navigation control where the caller cannot open an agent', async () => {
  const m = await panel(chain(2), reading(), false)
  expect(cards(m).every((card) => card.tagName === 'SPAN')).toBe(true)
  cards(m)[1]!.click()
  expect(m.opened).toEqual([])
  expect(m.all('cast-latest-first')).toHaveLength(0)
})

function omittedPredecessor(): ForestNode[] {
  const under = { is: 'a-conversation-this-reading-did-not-draw', conversation: 'sess_1' }
  return [
    conv(root, null),
    conv('sess_new', null, {
      under,
      standsInFor: [{ is: 'a-conversation-this-reading-did-not-draw', conversation: 'sess_1' }],
    }),
    conv('sess_2', null, { under }),
  ]
}

it('uses a present replacement when its direct predecessor is outside the bounded forest', async () => {
  const m = await panel(omittedPredecessor())
  expect(ids(m)).toEqual(['sess_new', 'sess_2'])
  expect(m.q('cast-sub-agents').querySelector('.count')?.textContent).toBe('(2)')
  expect(m.all('cast-tile-relation').map((el) => el.textContent)).toEqual([
    'Direct',
    'Level 2 · via new',
  ])
})

it.each(['sess_new', 'sess_1'])(
  'keeps inherited descendants when opening %s with its predecessor outside the forest',
  async (selected) => {
    const m = await panel(omittedPredecessor(), reading([]))
    m.props.conversation = selected
    m.props.reading = {
      ...reading([]),
      conversation: selected,
      read: { ...reading([]).read, conversation: selected },
    }
    await nextTick()
    expect(ids(m)).toEqual(['sess_2'])
    expect(m.all('cast-tile-relation').map((el) => el.textContent)).toEqual(['Direct'])
  },
)

it('normalizes every earlier conversation in a replacement chain outside the forest', async () => {
  const old = { is: 'a-conversation-this-reading-did-not-draw', conversation: 'sess_1' }
  const middle = { is: 'a-conversation-this-reading-did-not-draw', conversation: 'sess_middle' }
  const m = await panel([
    conv(root, null),
    conv('sess_new', null, { under: old, standsInFor: [old, middle] }),
    conv('sess_leaf', null, { under: middle }),
  ])
  expect(ids(m)).toEqual(['sess_new', 'sess_leaf'])
  expect(m.all('cast-tile-relation').map((el) => el.textContent)).toEqual([
    'Direct',
    'Level 2 · via new',
  ])
})
