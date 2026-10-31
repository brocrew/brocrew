import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import PromptComposer from '../../src/renderer/src/components/PromptComposer.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { SessionRecord } from '../../src/renderer/src/lib/session-record'
import type { ForestTask } from '../../src/shared/the-whole-forest'
import { workerRows } from './parallel-workers-fixture'
import { panelWork } from './sub-agents-workers-fixture'
import { forestOf } from './forest-fixture'
import { mount, unmountAll } from './harness'

const cast = useWhoCalledWhom()
afterEach(() => {
  unmountAll()
  cast.forest.value = null
  Reflect.deleteProperty(window, 'api')
  localStorage.clear()
})

async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

describe('Worker titles in a large conversation rail', () => {
  it('visits each forest node once and does no forest walk on selection or composer input', async () => {
    const rows = workerRows(32)
    Reflect.set(window, 'api', {
      runtime: {
        listResumable: async () => rows,
        listUnresumable: async () => [],
      },
    })
    let visits = 0
    const nodes: ForestTask[] = Array.from({ length: 3000 }, (_, index) => ({
      get node(): 'a-task' {
        visits++
        return 'a-task'
      },
      under: { is: 'a-conversation', conversation: rows[index % rows.length]!.sessionId },
      givenBy: { is: 'the-person' },
      work: {
        ...panelWork()[0]!,
        piece: `fictional-history-${index}`,
        label: `W91.${index}`,
        title: `Fictional recipe ${index}`,
        to: rows[index % rows.length]!.sessionId,
      },
    }))
    cast.forest.value = forestOf(nodes)
    visits = 0
    const active = ref(rows[0]!.sessionId)
    const draft = ref('')
    const open: SessionRecord[] = []
    const railUpdated = vi.fn()
    const view = mount(
      defineComponent({
        setup: () => () =>
          h('div', [
            h(SideRail, {
              open,
              activeId: active.value,
              place: null,
              onVnodeUpdated: railUpdated,
            }),
            h(PromptComposer, {
              state: 'busy',
              draft: draft.value,
              'onUpdate:draft': (value: string) => {
                draft.value = value
              },
            }),
          ]),
      }),
      {},
      { width: 1200, height: 900 },
    )
    await settled()
    expect(view.host.querySelectorAll('[data-worker]')).toHaveLength(rows.length)
    expect(visits).toBe(nodes.length)
    visits = 0
    railUpdated.mockClear()
    for (const row of rows.slice(1, 6)) {
      active.value = row.sessionId
      await nextTick()
      expect(view.q(`open-session-${row.sessionId}`).getAttribute('data-active')).toBe('true')
    }
    expect(railUpdated).toHaveBeenCalledTimes(5)
    const input = view.q('prompt-input')
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('The composer has no textarea')
    for (const word of ['Please', 'Please read', 'Please read the recipe']) {
      input.value = word
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()
      expect(draft.value).toBe(word)
    }
    expect(visits).toBe(0)
    expect(railUpdated).toHaveBeenCalledTimes(5)
  })

  it('refreshes extra titles on replacement and in-place edits, and keeps ended and unread wording', async () => {
    const rows = workerRows(3)
    rows[0] = { ...rows[0]!, named: { ...rows[0]!.named!, more: 2 } }
    rows[1] = { ...rows[1]!, named: { ...rows[1]!.named!, more: 2, ended: 'answered' } }
    Reflect.set(window, 'api', {
      runtime: { listResumable: async () => rows, listUnresumable: async () => [] },
    })
    cast.forest.value = null
    const view = mount(SideRail, { open: [], activeId: null, place: null }, { width: 251.68 })
    await settled()
    const first = view.q(`open-session-${rows[0]!.sessionId}`)
    const finished = view.q(`open-session-${rows[1]!.sessionId}`)
    expect(first.textContent).toContain('and 2 more')
    expect(finished.textContent).not.toContain('more')
    const extra = (piece: string, title: string, givenAt: number): ForestTask => ({
      node: 'a-task',
      under: { is: 'a-conversation', conversation: rows[0]!.sessionId },
      givenBy: { is: 'the-person' },
      work: { ...panelWork()[0]!, piece, label: piece, title, to: rows[0]!.sessionId, givenAt },
    })
    const newer = extra('W91.3', 'Newer recipe', 2)
    const changing = reactive({ ...newer, work: { ...newer.work } })
    cast.forest.value = forestOf([extra('W91.2', 'Older recipe', 1), changing])
    await nextTick()
    expect(
      [...first.querySelectorAll('.rail-worker-piece')].map((node) => node.textContent),
    ).toEqual(['Recipe', 'W91.3 · Newer recipe', 'W91.2 · Older recipe'])
    changing.work.title = 'Changed recipe'
    await nextTick()
    expect(first.textContent).toContain('Changed recipe')
    expect(first.textContent).not.toContain('Newer recipe')
    changing.work.to = rows[2]!.sessionId
    await nextTick()
    expect(first.textContent).not.toContain('Changed recipe')
    expect(first.textContent).toContain('and 1 more')
    cast.forest.value = null
    await nextTick()
    expect(first.textContent).not.toContain('Older recipe')
    expect(first.textContent).toContain('and 2 more')
    expect(finished.textContent).toContain('Menu')
    expect(finished.textContent).not.toContain('more')
  })
})
