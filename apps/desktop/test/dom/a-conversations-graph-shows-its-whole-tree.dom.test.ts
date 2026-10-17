import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import ConversationMain from '../../src/renderer/src/components/ConversationMain.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import { conv, forestDrawn, task, viewOf } from './forest-fixture'
import { mount, unmountAll, type Mounted } from './harness'

afterEach(unmountAll)

const forest = () =>
  viewOf([
    conv('sess_other', null),
    conv('sess_other_child', 'sess_other'),
    task('sess_other', 'work_other', 'W2.1', 'Other tree work', null),
    conv('sess_root', null),
    conv('sess_middle', 'sess_root'),
    conv('sess_leaf', 'sess_middle'),
    conv('sess_sibling', 'sess_root'),
    task('sess_root', 'work_root', 'W1', 'Root work', null),
    task('sess_middle', 'work_middle', 'W1.1', 'Middle work', 'sess_root'),
    task('sess_leaf', 'work_leaf', 'W1.1.1', 'Leaf work', 'sess_middle'),
    conv('sess_after', null),
  ])

const OWN = ['sess_root', 'sess_middle', 'sess_leaf', 'sess_sibling']
const ALL = [...OWN, 'sess_other', 'sess_other_child', 'sess_after']
const cards = (m: Mounted) => [
  ...m.host.querySelectorAll<HTMLElement>('[data-cy^="forest-row-"][data-kind="a-conversation"]'),
]
const ids = (m: Mounted) =>
  cards(m)
    .map((row) => row.dataset.cy!.slice('forest-row-'.length))
    .sort()

async function graph(conversation: string, view = forest()): Promise<Mounted> {
  const m = mount(ConversationMain, { conversation, forest: view })
  m.q('main-tab-graph').click()
  await forestDrawn()
  await forestDrawn()
  return m
}

describe("a conversation's Graph shows only its whole top-level tree", () => {
  for (const current of ['sess_root', 'sess_middle', 'sess_leaf']) {
    it(`keeps the root, siblings, descendants and work when ${current} is current`, async () => {
      const m = await graph(current)
      expect(ids(m)).toEqual([...OWN].sort())
      expect(
        cards(m)
          .filter((row) => row.dataset.current === 'true')
          .map((row) => row.dataset.cy),
      ).toEqual([`forest-row-${current}`])
      expect(m.q('forest-row-sess_root').dataset.depth).toBe('0')
      expect(
        m
          .all('forest-task-number')
          .map((row) => row.textContent?.trim())
          .sort(),
      ).toEqual(['W1', 'W1.1', 'W1.1.1'])
      expect(m.q('forest-person').textContent).toContain("This conversation's tree")
      expect(m.q('forest-drawn').textContent).toContain('Workspace reading:')
    })
  }

  it('changes tree when another conversation is selected while Graph stays open', async () => {
    const current = ref('sess_middle')
    const Screen = defineComponent({
      setup: () => () => h(ConversationMain, { conversation: current.value, forest: forest() }),
    })
    const m = mount(Screen, {})
    m.q('main-tab-graph').click()
    await forestDrawn()
    expect(ids(m)).toEqual([...OWN].sort())
    current.value = 'sess_other_child'
    await forestDrawn()
    await forestDrawn()
    expect(ids(m)).toEqual(['sess_other', 'sess_other_child'])
    expect(m.q('forest-row-sess_other_child').dataset.current).toBe('true')
  })

  it('uses the replacement conversation at its existing place', async () => {
    const view = forest()
    const m = await graph('sess_before', {
      ...view,
      placeOf: new Map([['sess_before', 'sess_middle']]),
    })
    expect(ids(m)).toEqual([...OWN].sort())
    expect(m.q('forest-row-sess_middle').dataset.current).toBe('true')
  })

  it('does not fall back to other trees when the conversation is absent', async () => {
    const m = await graph('sess_missing')
    expect(ids(m)).toEqual([])
    expect(m.q('forest-empty').textContent).toContain(
      'This conversation is not in the current graph reading.',
    )
  })

  it('keeps the unread state until the forest arrives', async () => {
    const m = mount(ConversationMain, { conversation: 'sess_root', forest: null })
    m.q('main-tab-graph').click()
    await forestDrawn()
    expect(ids(m)).toEqual([])
    expect(m.all('forest-not-read')).toHaveLength(1)
  })

  it('keeps every tree on the Team page and leaves its caption unchanged', async () => {
    const m = mount(TeamWorkspace, { agents: null, store: {} as AgentStore, forest: forest() })
    m.q('team-tab-forest').click()
    await forestDrawn()
    await forestDrawn()
    expect(ids(m)).toEqual([...ALL].sort())
    expect(cards(m).every((row) => row.dataset.current === 'false')).toBe(true)
    expect(m.q('forest-person').textContent).toContain(
      'Everything this app started, and everything it started in turn',
    )
    expect(m.q('forest-drawn').textContent).not.toContain('Workspace reading:')
  })
})
