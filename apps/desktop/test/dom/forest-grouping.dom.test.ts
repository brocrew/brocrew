import { afterEach, describe, expect, it } from 'vitest'
import { nextTick, ref, defineComponent, h } from 'vue'
import TeamForest from '../../src/renderer/src/components/TeamForest.vue'
import { conv, forestDrawn, task, viewOf } from './forest-fixture'
import { mount, unmountAll } from './harness'

afterEach(unmountAll)

const fixture = () => viewOf([
  conv('aster', null),
  conv('teo-one', 'aster', { identity: 'teo', updatedAt: 10 }),
  task('teo-one', 'piece-one', 'W1.1', 'Check spacing', 'aster'),
  conv('teo-two', 'aster', { identity: 'teo', updatedAt: 20 }),
  task('teo-two', 'piece-two', 'W1.2', 'Check colours', 'aster'),
], null, new Map([
  ['teo-one', { facets: { doing: 'working' }, word: 'Working' }],
  ['teo-two', { facets: { doing: 'idle' }, word: 'Idle' }],
]))

describe('compact graph groups and navigation', () => {
  it('expands same-agent conversations and opens the exact pressed member', async () => {
    const pressed: string[] = []
    const m = mount(TeamForest, { view: fixture(), current: 'teo-one', onPress: (row: { conversation: string }) => pressed.push(row.conversation) })
    await forestDrawn()
    await forestDrawn()
    expect(m.all('forest-group')).toHaveLength(1)
    expect(m.q('forest-group').textContent).toContain('teo ×2')
    expect(m.q('forest-group-counts').textContent).toBe('1 active · 1 idle')
    expect(m.q('forest-group').textContent).toContain('Idle')
    expect(m.q('forest-group').classList.contains('current')).toBe(true)
    expect(m.all('forest-group-member')).toHaveLength(0)
    m.q('forest-group-toggle').click()
    await nextTick()
    expect(m.all('forest-group-member').map((member) => member.dataset.conversation)).toEqual(['teo-two', 'teo-one'])
    m.all('forest-group-member')[1]!.click()
    expect(pressed).toEqual(['teo-one'])
    m.q('forest-group-toggle').click()
    await nextTick()
    expect(m.all('forest-group-member')).toHaveLength(0)
    expect(pressed).toEqual(['teo-one'])
    expect(m.all('forest-person')).toHaveLength(0)
    expect(m.all('forest-covers')).toHaveLength(0)
    expect(m.q('forest-drawn').textContent).toBe('3 conversations')
    const toolbar = m.q('forest-toolbar').getBoundingClientRect()
    const zoom = m.q('forest-zoom-in').getBoundingClientRect()
    expect(zoom.top).toBeGreaterThanOrEqual(toolbar.top)
    expect(zoom.bottom).toBeLessThanOrEqual(toolbar.bottom)
  })

  it('keeps out-of-window parents openable and visibly faded', async () => {
    const view = fixture()
    const context = { ...view, rows: view.rows.map((row) => row.conversation === 'aster' ? { ...row, conversationRow: { ...row.conversationRow!, context: 'window' as const } } : row) }
    const pressed: string[] = []
    const m = mount(TeamForest, { view: context, onPress: (row: { conversation: string }) => pressed.push(row.conversation) })
    await forestDrawn()
    await forestDrawn()
    const parent = m.q('forest-row-aster')
    expect(parent.textContent).toContain('Outside window · parent')
    expect(getComputedStyle(parent.parentElement!).opacity).toBe('0.55')
    parent.querySelector<HTMLButtonElement>('[data-cy="forest-open"]')!.click()
    expect(pressed).toEqual(['aster'])
    expect(m.q('forest-drawn').textContent).toBe('2 conversations')
  })

  it('updates the newest status and remeasures expanded groups while retaining the viewport', async () => {
    const view = ref(fixture())
    const m = mount(defineComponent({ setup: () => () => h(TeamForest, { view: view.value }) }), {})
    await forestDrawn()
    await forestDrawn()
    m.q('forest-group-toggle').click()
    await forestDrawn()
    const transform = m.host.querySelector<HTMLElement>('.vue-flow__transformationpane')!.style.transform
    view.value = { ...view.value, rows: view.value.rows.map((row) => row.conversation === 'teo-one' && row.kind === 'a-conversation' ? { ...row, conversationRow: { ...row.conversationRow!, updatedAt: 30 } } : row) }
    await forestDrawn()
    await forestDrawn()
    expect(m.q('forest-group').textContent).toContain('Working')
    expect(m.all('forest-group-member')).toHaveLength(2)
    expect(m.host.querySelector<HTMLElement>('.vue-flow__transformationpane')!.style.transform).toBe(transform)
  })
})
