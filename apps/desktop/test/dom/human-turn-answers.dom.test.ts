import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive, type Component } from 'vue'
import AgentCard from '../../src/renderer/src/components/AgentCard.vue'
import AssistantMessage from '../../src/renderer/src/components/AssistantMessage.vue'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

afterEach(unmountAll)
function stateOf(events: TranscriptEvent[]) {
  const state = reactive(createTranscript())
  events.forEach((event, ordinal) => applyEvent(state, event, 1000 + ordinal, ordinal))
  return state
}
const first: TranscriptEvent[] = [
  { type: 'user_turn', text: 'My **human prompt**\n\n`detail`', humanInitiated: true },
  { type: 'assistant_message', text: 'Working', phase: 'commentary' },
  { type: 'assistant_message', text: '## Human answer\n\n- Item\n\n```js\nconst ok = true\n```\n\n<script>bad()</script>', phase: 'final' },
  { type: 'turn', state: 'completed' },
  { type: 'user_turn', text: 'Agent update', attribution: 'app_authored', relayedFrom: 'sess_other' },
  { type: 'assistant_message', text: 'Later app answer', phase: 'final' },
  { type: 'turn', state: 'completed' },
]

describe('human final answer surfaces', () => {
  it('opens the matching full prompt and final Markdown, keeps the popup paired, and closes with Escape', async () => {
    const state = stateOf(first)
    const navigated: string[] = []
    const host = defineComponent({ setup: () => () => h(AgentCard as Component, {
      state, shown: state, mode: 'normal', conversation: 's', who: 'Fictional agent',
      onNavigate: (id: string) => navigated.push(id),
    }) })
    const m = mount(host, {}, { width: 360, height: 900 })
    expect(m.q('card-latest-words').textContent).toContain('Human answer')
    m.q('card-latest').click(); await nextTick()
    expect(m.q('human-answer-prompt').querySelector('strong')?.textContent).toBe('human prompt')
    expect(m.q('human-answer-final').querySelector('h2')?.textContent).toBe('Human answer')
    expect(m.q('human-answer-final').querySelector('pre code')?.textContent).toContain('const ok = true')
    expect(m.q('human-answer-final').querySelector('script')).toBeNull()
    expect(m.q('human-answer-final').textContent).not.toContain('Later app answer')
    applyEvent(state, { type: 'user_turn', text: 'Second question', humanInitiated: true }, 2000, 7)
    applyEvent(state, { type: 'assistant_message', text: 'Second answer', phase: 'final' }, 2001, 8)
    await nextTick()
    expect(m.q('human-answer-prompt').textContent).toContain('human prompt')
    expect(m.q('card-latest-words').textContent).toBe('Second answer')
    expect(navigated).toEqual([])
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(m.all('human-answer-dialog')).toHaveLength(0)
  })

  it.each(['no human', 'pending', 'interrupted'] as const)('preserves the existing click for %s', async (which) => {
    const events: TranscriptEvent[] = [{ type: 'assistant_message', text: 'Current response' }]
    if (which !== 'no human') events.push({ type: 'user_turn', text: 'Question', humanInitiated: true })
    if (which === 'interrupted') events.push({ type: 'turn', state: 'interrupted' })
    const state = stateOf(events)
    const navigated: string[] = []
    const m = mount(AgentCard, { state, shown: state, mode: 'normal', conversation: 's', onNavigate: (id: string) => navigated.push(id) }, { width: 360, height: 800 })
    m.q('card-latest').click(); await nextTick()
    expect(m.q('card-latest-words').textContent).toBe('Current response')
    expect(navigated).toEqual([state.items.find((item) => item.kind === 'assistant')!.id])
    expect(m.all('human-answer-dialog')).toHaveLength(0)
  })

  it.each(['dark', 'light'] as const)('highlights only human finals using readable %s theme tokens', async (theme) => {
    const state = stateOf(first)
    const assistants = state.items.filter((item) => item.kind === 'assistant')
    const host = defineComponent({ setup: () => () => h('div', { style: {
      '--panel': theme === 'dark' ? '#202344' : '#ffffff', '--text': theme === 'dark' ? '#ffffff' : '#14152a',
      '--text-soft': theme === 'dark' ? '#e7e8f1' : '#323348', '--accent': theme === 'dark' ? '#a5b4fc' : '#4338ca',
    } }, assistants.map((item) => h(AssistantMessage as Component, { item }))) })
    const m = mount(host, {}, { width: 900, height: 900 })
    await nextTick()
    const highlighted = m.host.querySelectorAll('[data-human-final="true"]')
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0]!.textContent).toContain('Answer to you')
    const column = highlighted[0]!.querySelector('.msg-column')!
    expect(getComputedStyle(column).borderInlineStartWidth).toBe('3px')
    expect(getComputedStyle(column).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(highlighted[0]!.querySelector('.final-label')!).color).toBe(theme === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(20, 21, 42)')
  })
})
