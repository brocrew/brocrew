import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

afterEach(unmountAll)
function stateOf(events: TranscriptEvent[]) {
  const state = createTranscript()
  events.forEach((event, ordinal) => applyEvent(state, event, 1000 + ordinal, ordinal))
  return state
}

describe('empty Codex messages in the conversation', () => {
  it.each(['normal', 'debug'] as const)('shows actual final prose once and keeps malformed diagnostics in %s', (mode) => {
    const state = stateOf([
      { type: 'user_turn', text: 'Fictional question', humanInitiated: true },
      { type: 'assistant_message', text: 'Actual **answer**', phase: 'final' },
      { type: 'assistant_message', text: '', phase: 'final' },
      { type: 'assistant_message', text: '\n\t ', phase: 'final' },
      { type: 'unknown', provider: 'codex', category: 'unrecognized', label: 'agentMessage', raw: { type: 'agentMessage', text: '', phase: 'final_answer', memoryCitation: null, delivery: null, questions: null } },
      { type: 'unknown', provider: 'codex', category: 'unrecognized', label: 'agentMessage', raw: { type: 'agentMessage', text: null } },
      { type: 'turn', state: 'completed' },
    ])
    const m = mount(TranscriptView, { items: state.items, mode }, { width: 900, height: 700 })
    expect(m.all('assistant-message')).toHaveLength(1)
    expect(m.q('assistant-message').querySelector('strong')?.textContent).toBe('answer')
    expect(m.host.querySelectorAll('[data-human-final="true"]')).toHaveLength(1)
    expect(m.all('unknown-entry')).toHaveLength(1)
    m.q('unknown-entry').querySelector<HTMLButtonElement>('button')!.click()
    expect(m.q('unknown-entry').textContent).toContain('Unmodeled event')
    expect(m.q('unknown-entry').textContent).toContain('"text": null')
  })

  it('keeps a structured-only question actionable and renders its citation without a human final', async () => {
    const state = stateOf([
      { type: 'user_turn', text: 'Fictional question', humanInitiated: true },
      { type: 'assistant_message', text: '', phase: 'final', questions: [{ title: 'Which recipe?', options: ['Bread', 'Cake'] }] },
      { type: 'memory_recall', source: 'memoryCitation', entries: [{ path: 'fictional.md', note: 'Fictional recipe context' }] },
    ])
    const answered: string[] = []
    const m = mount(TranscriptView, { items: state.items, mode: 'normal', canAnswerQuestions: true, onSendAnswer: (text: string) => answered.push(text) }, { width: 900, height: 700 })
    expect(m.all('asked-choice').map((one) => one.textContent?.trim())).toEqual(['Bread', 'Cake'])
    expect(m.q('memory-recall').textContent).toContain('fictional.md')
    expect(m.host.querySelectorAll('[data-human-final="true"]')).toHaveLength(0)
    m.q('asked-choice').click(); await nextTick()
    expect(answered).toHaveLength(1)
    expect(answered[0]).toContain('Bread')
  })
})
