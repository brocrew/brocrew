import { describe, expect, it } from 'vitest'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'

describe('incoming mail during an assistant answer', () => {
  it.each(['commentary', 'final'] as const)(
    'replaces the partial %s answer once after queued mail',
    (phase) => {
      const state = createTranscript()
      const prefix = '[Ada](brocrew://conversation/sess_f'
      const text = `${prefix}ictional)`
      applyEvent(state, { type: 'assistant_delta', text: prefix })
      const id = state.streamingId
      for (const [index, kind] of (['work', 'notice'] as const).entries()) {
        applyEvent(state, {
          type: 'message_queued',
          messageId: `mail-${index}`,
          kind,
          text: 'A reply is waiting.',
        })
        applyEvent(state, { type: 'assistant_delta', text: 'provisional' })
      }
      expect(state.items.filter((item) => item.kind === 'assistant')).toEqual([
        expect.objectContaining({ id, text: `${prefix}provisionalprovisional`, streaming: true }),
      ])
      applyEvent(state, { type: 'assistant_message', text, phase })
      expect(state.items.filter((item) => item.kind === 'assistant')).toEqual([
        expect.objectContaining({ id, text, streaming: false }),
      ])
      expect(state.items.filter((item) => item.kind === 'queued')).toHaveLength(2)
      expect(state.streamingId).toBeNull()
      expect(state.provisionalId).toBeNull()
    },
  )

  it('preserves identical answers in separate turns after mail is delivered', () => {
    const state = createTranscript()
    for (const text of ['The test is done.', 'The test is done.']) {
      applyEvent(state, { type: 'user_turn', text: 'Report the result.' })
      applyEvent(state, { type: 'assistant_delta', text: 'The test' })
      applyEvent(state, { type: 'assistant_message', text, phase: 'final' })
      applyEvent(state, { type: 'turn', state: 'completed' })
    }
    expect(state.items.filter((item) => item.kind === 'assistant')).toHaveLength(2)
  })
})
