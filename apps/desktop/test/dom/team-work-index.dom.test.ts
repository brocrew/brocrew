import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { screenFacts } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { conversationList } from '../../src/renderer/src/lib/conversation-list'
import type { ForestTask } from '../../src/shared/the-whole-forest'
import { workerRows, identities, activity, store } from './parallel-workers-fixture'
import { panelWork } from './sub-agents-workers-fixture'
import { forestOf } from './forest-fixture'
import { mount, unmountAll } from './harness'
afterEach(() => {
  unmountAll()
  screenFacts().update({ forest: null })
})
function props(rows = workerRows(32)) {
  const agents = identities(rows.length)
  return {
    agents,
    store,
    beingDone: activity(rows),
    conversations: conversationList({
      resumable: rows,
      unresumable: [],
      identities: agents.identities,
    }),
  }
}
describe('Team worker work index', () => {
  it('visits the forest once and reuses it for roster and search updates', async () => {
    const rows = workerRows(32)
    let visits = 0
    const nodes: ForestTask[] = Array.from({ length: 3000 }, (_, i) => ({
      get node(): 'a-task' {
        visits++
        return 'a-task'
      },
      under: { is: 'a-conversation', conversation: rows[i % rows.length]!.sessionId },
      givenBy: { is: 'the-person' },
      work: {
        ...panelWork()[0]!,
        piece: `fictional-${i}`,
        label: `W91.${i}`,
        title: `Fictional recipe ${i}`,
        to: rows[i % rows.length]!.sessionId,
      },
    }))
    screenFacts().update({ forest: forestOf(nodes) })
    visits = 0
    const held = ref<string[]>([])
    const input = props(rows)
    const m = mount(
      defineComponent(() => () => h(TeamWorkspace, { ...input, held: held.value })),
      {},
      { width: 1000, height: 900 },
    )
    await nextTick()
    expect(m.host.querySelectorAll('.team-workers .shelf-row')).toHaveLength(32)
    expect(visits).toBe(nodes.length)
    visits = 0
    held.value = [rows[0]!.sessionId]
    await nextTick()
    const search = m.q('team-controls').querySelector('input')!
    search.value = 'Mira'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(m.host.querySelectorAll('.team-workers .shelf-row')).toHaveLength(32)
    expect(visits).toBe(0)
  })
  it('keeps ordered, deduplicated extra titles and reacts to holder changes and missing readings', async () => {
    const rows = workerRows(3, true)
    rows[0] = { ...rows[0]!, named: { ...rows[0]!.named!, more: 3 } }
    rows[1] = { ...rows[1]!, named: { ...rows[1]!.named!, more: 3 } }
    rows[2] = { ...rows[2]!, named: { ...rows[2]!.named!, more: 1 } }
    const extra = (piece: string, title: string, givenAt: number): ForestTask => ({
      node: 'a-task',
      under: { is: 'a-conversation', conversation: rows[0]!.sessionId },
      givenBy: { is: 'the-person' },
      work: { ...panelWork()[0]!, piece, label: piece, title, to: rows[0]!.sessionId, givenAt },
    })
    const newer = extra('W91.3', 'Newer recipe', 2)
    const changing = reactive({ ...newer, work: { ...newer.work } })
    const finished = extra('W91.9', 'Finished recipe', 9)
    const closed = { ...finished, work: { ...finished.work, state: 'answered' as const } }
    screenFacts().update({
      forest: forestOf([
        extra('W91.2', 'Older recipe', 1),
        changing,
        extra('W91.3', 'Duplicate recipe', 0),
        extra('W90.1', 'Naming duplicate', 8),
        closed,
      ]),
    })
    const m = mount(TeamWorkspace, props(rows), { width: 1000, height: 900 })
    const titles = () =>
      [...m.q(`team-worker-${rows[0]!.sessionId}`).querySelectorAll('.team-worker-piece')].map(
        (el) => el.textContent?.trim(),
      )
    expect(titles()).toEqual([
      'Recipe',
      'W91.3 · Newer recipe',
      'W91.2 · Older recipe',
      'and 1 more',
    ])
    expect(m.q(`team-worker-${rows[1]!.sessionId}`).textContent).toContain('idle · answered')
    expect(m.q(`team-worker-${rows[1]!.sessionId}`).textContent).not.toContain('more')
    changing.work.title = 'Changed recipe'
    await nextTick()
    expect(titles()).toContain('W91.3 · Changed recipe')
    changing.work.to = rows[2]!.sessionId
    await nextTick()
    expect(titles()).toContain('W91.3 · Duplicate recipe')
    expect(titles()).not.toContain('W91.3 · Changed recipe')
    expect(m.q(`team-worker-${rows[2]!.sessionId}`).textContent).toContain('W91.3 · Changed recipe')
    changing.work.to = 'missing-holder'
    await nextTick()
    expect(m.q(`team-worker-${rows[2]!.sessionId}`).textContent).not.toContain('Changed recipe')
    screenFacts().update({ forest: null })
    await nextTick()
    expect(titles()).toEqual(['Recipe', 'and 3 more'])
    screenFacts().update({ forest: forestOf([extra('W91.4', 'Replacement recipe', 3)]) })
    await nextTick()
    expect(titles()).toEqual(['Recipe', 'W91.4 · Replacement recipe', 'and 2 more'])
  })
})
