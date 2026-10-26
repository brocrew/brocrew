import { describe, expect, it } from 'vitest'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { visibleItems } from '../src/renderer/src/lib/transcript-mode'
import { panelWords } from '../src/renderer/src/lib/latest-words'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

function fold(events: TranscriptEvent[]) {
  const state = createTranscript()
  events.forEach((event, ordinal) => applyEvent(state, event, 1000 + ordinal, ordinal))
  return state
}
const empty: TranscriptEvent = { type: 'assistant_message', text: '', phase: 'final' }
const legacy: Extract<TranscriptEvent, { type: 'unknown' }> = {
  type: 'unknown', provider: 'codex', category: 'unrecognized', label: 'agentMessage',
  raw: { type: 'agentMessage', id: 'fictional', text: '', phase: 'final_answer', memoryCitation: null, delivery: null, questions: null },
}

describe('empty authoritative assistant messages', () => {
  it.each(['normal', 'debug'] as const)('settles streamed text without a blank answer or final pair in %s', (mode) => {
    const state = fold([
      { type: 'user_turn', text: 'Fictional question', humanInitiated: true },
      { type: 'assistant_delta', text: 'Unconfirmed progress' }, empty,
      { type: 'turn', state: 'completed' },
    ])
    expect(visibleItems(mode, state.items).filter((item) => item.kind === 'assistant')).toEqual([])
    expect(state.streamingId).toBeNull()
    expect(state.humanAnswers.latest?.final).toBeNull()
    expect(panelWords(state)).toBeNull()
  })

  it('keeps the genuine final exactly once after another empty or whitespace final', () => {
    const state = fold([
      { type: 'user_turn', text: 'Fictional question', humanInitiated: true },
      { type: 'assistant_message', text: 'Actual answer', phase: 'final' },
      empty, { type: 'assistant_message', text: '\n\t ', phase: 'final' },
      { type: 'turn', state: 'completed' },
    ])
    expect(visibleItems('normal', state.items).filter((item) => item.kind === 'assistant').map((item) => item.text)).toEqual(['Actual answer'])
    expect(state.items.filter((item) => item.kind === 'assistant' && item.humanFinal)).toHaveLength(1)
    expect(panelWords(state)?.text).toBe('Actual answer')
  })

  it('drops provisional delta prose after a tool boundary when the authoritative message is empty', () => {
    const state = fold([
      { type: 'user_turn', text: 'Question', humanInitiated: true },
      { type: 'assistant_delta', text: 'Unconfirmed progress' },
      { type: 'tool_call', id: 'fictional-tool', name: 'fictional', summary: 'Fictional work' },
      empty, { type: 'turn', state: 'completed' },
    ])
    expect(visibleItems('normal', state.items).filter((item) => item.kind === 'assistant')).toEqual([])
    expect(state.items.some((item) => item.kind === 'tool')).toBe(true)
    expect(state.provisionalId).toBeNull()
    expect(state.humanAnswers.latest?.final).toBeNull()
  })

  it('keeps latestWords fallback after a newer human empty final without selecting the older pair', () => {
    const state = fold([
      { type: 'user_turn', text: 'Earlier question', humanInitiated: true },
      { type: 'assistant_message', text: 'Earlier answer', phase: 'final' },
      { type: 'turn', state: 'completed' },
      { type: 'user_turn', text: 'New question', humanInitiated: true }, empty,
      { type: 'turn', state: 'completed' },
    ])
    expect(state.humanAnswers.latest).toMatchObject({ prompt: 'New question', final: null })
    expect(panelWords(state)?.text).toBe('Earlier answer')
    expect(visibleItems('normal', state.items).filter((item) => item.kind === 'assistant')).toHaveLength(1)
  })

  it('retains structured-only questions and memory recall without creating a human final', () => {
    const state = fold([
      { type: 'user_turn', text: 'Question', humanInitiated: true },
      { type: 'assistant_message', text: '', questions: [{ title: 'Bread or cake?' }], phase: 'final' },
      { type: 'memory_recall', entries: [{ path: 'fictional.md' }], source: 'memoryCitation' },
    ])
    expect(visibleItems('normal', state.items).some((item) => item.kind === 'assistant' && item.questions?.[0]?.title === 'Bread or cake?')).toBe(true)
    expect(state.humanAnswers.latest?.final).toBeNull()
    expect(state.items.some((item) => item.kind === 'memoryRecall')).toBe(true)
  })

  it('quiets only the old plain-empty Codex diagnostic and preserves its original raw data', () => {
    const before = JSON.stringify(legacy)
    const state = fold([legacy])
    expect(state.items.find((item) => item.kind === 'unknown')).toMatchObject({ category: 'activity', raw: legacy.raw })
    expect(visibleItems('normal', state.items)).toEqual([])
    expect(visibleItems('debug', state.items)).toEqual([])
    expect(JSON.stringify(legacy)).toBe(before)
    expect(state.humanAnswers.latest).toBeNull()
  })

  it.each([
    { ...legacy, provider: 'claude' as const },
    { ...legacy, raw: { type: 'agentMessage' } },
    { ...legacy, raw: { type: 'agentMessage', text: null } },
    { ...legacy, raw: { type: 'agentMessage', text: 'Actual words' } },
    { ...legacy, raw: { type: 'futureMessage', text: '' } },
    { ...legacy, raw: { type: 'agentMessage', text: '', questions: [{ title: 'Unparsed old question' }] } },
    { ...legacy, raw: { type: 'agentMessage', text: '', memoryCitation: { entries: [{ path: 'old.md' }] } } },
  ])('keeps other unknown payloads inspectable and prominent: %j', (event) => {
    const state = fold([event])
    expect(visibleItems('normal', state.items)).toHaveLength(1)
    expect(state.items[0]).toMatchObject({ kind: 'unknown', category: 'unrecognized', raw: event.raw })
  })
})
