import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref, shallowRef } from 'vue'
import ConversationMain from '../../src/renderer/src/components/ConversationMain.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import { conversationGraphFixture, siblingIds } from './conversation-graph-layout-fixture'
import { forestDrawn } from './forest-fixture'
import { mount, unmountAll, type Mounted } from './harness'

afterEach(unmountAll)

const box = (m: Mounted, id: string) => m.q(`forest-row-${id}`).getBoundingClientRect()
async function settled() {
  await forestDrawn()
  await forestDrawn()
}
async function draw(current = ref(siblingIds[0]!), view = shallowRef(conversationGraphFixture())) {
  const Screen = defineComponent({
    setup: () => () =>
      h('div', { style: { display: 'grid', width: '100%', height: '100%' } }, [
        h(ConversationMain, {
          conversation: current.value,
          forest: view.value,
        }),
      ]),
  })
  const m = mount(Screen, {}, { width: 1200, height: 1000 })
  m.q('main-tab-graph').click()
  await settled()
  expect(Math.abs(m.q('conversation-graph').getBoundingClientRect().width - 1200)).toBeLessThan(1)
  return m
}

function stacked(m: Mounted) {
  const rectangles = siblingIds.map((id) => box(m, id)).sort((a, b) => a.top - b.top)
  for (let i = 0; i < rectangles.length; i += 1) {
    const one = rectangles[i]!
    expect(one.width).toBeGreaterThan(100)
    expect(Math.abs(one.left - rectangles[0]!.left)).toBeLessThan(1)
    if (i > 0) expect(one.top - rectangles[i - 1]!.bottom).toBeGreaterThan(5)
  }
}

describe('a conversation graph grows from left to right', () => {
  it('puts three generations in successive columns and keeps the selected card and ports', async () => {
    const m = await draw()
    const root = box(m, 'sess_brobot')
    const child = box(m, siblingIds[0]!)
    const leaf = box(m, 'sess_reader')
    expect(child.left - root.right).toBeGreaterThan(10)
    expect(leaf.left - child.right).toBeGreaterThan(10)
    expect(Math.abs(box(m, 'sess_editor').left - leaf.left)).toBeLessThan(1)
    const leaves = [leaf, box(m, 'sess_editor')].sort((a, b) => a.top - b.top)
    expect(leaves[1]!.top - leaves[0]!.bottom).toBeGreaterThan(5)
    expect(m.all('forest-row-sess_other')).toHaveLength(0)
    expect(m.q(`forest-row-${siblingIds[0]!}`).dataset.current).toBe('true')
    const node = m.q(`forest-row-${siblingIds[0]!}`).closest('.vue-flow__node')!
    expect(node.querySelector('.vue-flow__handle-left')).not.toBeNull()
    expect(node.querySelector('.vue-flow__handle-right')).not.toBeNull()
  })

  it('stacks eight siblings without overlap, including when a card expands', async () => {
    const m = await draw()
    stacked(m)
    const card = m.q(`forest-row-${siblingIds[0]!}`)
    const before = card.getBoundingClientRect().height
    expect(card.querySelectorAll('[data-cy="forest-task-number"]')).toHaveLength(3)
    card.querySelector<HTMLElement>('[data-cy="forest-more"]')!.click()
    await settled()
    expect(card.querySelectorAll('[data-cy="forest-task-number"]')).toHaveLength(6)
    expect(card.getBoundingClientRect().height - before).toBeGreaterThan(10)
    stacked(m)
  })

  it('preserves the viewport within a tree and brings a different tree into view', async () => {
    const current = ref(siblingIds[0]!)
    const view = shallowRef(conversationGraphFixture())
    const m = await draw(current, view)
    m.q('forest-zoom-in').click()
    await settled()
    const pane = m.host.querySelector<HTMLElement>('.vue-flow__pane')!
    pane.dispatchEvent(new WheelEvent('wheel', { deltaY: 6000, bubbles: true, cancelable: true }))
    await settled()
    const drawing = m.q('forest-rows').getBoundingClientRect()
    expect(box(m, siblingIds[0]!).bottom).toBeLessThan(drawing.top)
    const viewport = () => m.host.querySelector<HTMLElement>('.vue-flow__transformationpane')!
    const transform = viewport().style.transform
    expect(transform).not.toBe('')
    const width = box(m, 'sess_brobot').width

    view.value = conversationGraphFixture()
    current.value = siblingIds[1]!
    await settled()
    expect(viewport().style.transform).toBe(transform)
    expect(Math.abs(box(m, 'sess_brobot').width - width)).toBeLessThan(0.5)
    expect(m.q(`forest-row-${siblingIds[1]!}`).dataset.current).toBe('true')

    current.value = 'sess_other_helper'
    await settled()
    const selected = box(m, current.value)
    const nextDrawing = m.q('forest-rows').getBoundingClientRect()
    expect(selected.right).toBeGreaterThan(nextDrawing.left)
    expect(selected.left).toBeLessThan(nextDrawing.right)
    expect(selected.bottom).toBeGreaterThan(nextDrawing.top)
    expect(selected.top).toBeLessThan(nextDrawing.bottom)
    expect(viewport().style.transform).not.toBe(transform)
    expect(m.q('forest-row-sess_other_helper').dataset.current).toBe('true')
    expect(m.all('forest-row-sess_brobot')).toHaveLength(0)
  })

  it('keeps the viewport when a stand-in replaces the root at the same place', async () => {
    const view = shallowRef(conversationGraphFixture())
    const m = await draw(ref(siblingIds[0]!), view)
    m.q('forest-zoom-in').click()
    await settled()
    const pane = m.host.querySelector<HTMLElement>('.vue-flow__pane')!
    pane.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, bubbles: true, cancelable: true }))
    await settled()
    const viewport = m.host.querySelector<HTMLElement>('.vue-flow__transformationpane')!
    const transform = viewport.style.transform
    view.value = {
      ...view.value,
      rows: view.value.rows.map((row) =>
        row.conversation === 'sess_brobot'
          ? {
              ...row,
              conversation: 'sess_replacement',
              key: row.kind === 'a-conversation' ? 'sess_replacement' : row.key,
            }
          : row,
      ),
      placeOf: new Map([['sess_brobot', 'sess_replacement']]),
    }
    await settled()
    expect(m.all('forest-row-sess_replacement')).toHaveLength(1)
    expect(m.host.querySelector('.vue-flow__transformationpane')).toBe(viewport)
    expect(viewport.style.transform).toBe(transform)
  })

  it('keeps the Team graph in rows of generations with every tree and its original ports', async () => {
    const m = mount(
      TeamWorkspace,
      {
        agents: null,
        store: {} as AgentStore,
        forest: conversationGraphFixture(),
      },
      { width: 1600, height: 1000 },
    )
    m.q('team-tab-forest').click()
    await settled()
    const root = box(m, 'sess_brobot')
    const child = box(m, siblingIds[0]!)
    const leaf = box(m, 'sess_reader')
    expect(child.top - root.bottom).toBeGreaterThan(5)
    expect(leaf.top - child.bottom).toBeGreaterThan(5)
    for (const id of siblingIds) expect(Math.abs(box(m, id).top - child.top)).toBeLessThan(1)
    expect(m.all('forest-row-sess_other')).toHaveLength(1)
    expect(m.all('forest-row-sess_other_helper')).toHaveLength(1)
    const node = m.q(`forest-row-${siblingIds[0]!}`).closest('.vue-flow__node')!
    expect(node.querySelector('.vue-flow__handle-top')).not.toBeNull()
    expect(node.querySelector('.vue-flow__handle-bottom')).not.toBeNull()
  })
})
