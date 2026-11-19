import { afterEach, expect, it } from 'vitest'
import { nextTick, reactive } from 'vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import { mount, unmountAll } from './harness'

afterEach(unmountAll)

it.each(['commentary', 'final'] as const)(
  'draws one %s answer when mail arrives between its partial and final text',
  async (phase) => {
    const state = reactive(createTranscript())
    applyEvent(state, { type: 'assistant_delta', text: 'The tool reply says par' })
    const view = mount(TranscriptView, { items: state.items })
    await nextTick()
    const answers = (): Element[] => [...view.host.querySelectorAll('[data-cy=assistant-message]')]
    expect(answers()).toHaveLength(1)
    applyEvent(state, {
      type: 'message_queued',
      messageId: 'mail',
      kind: 'work',
      text: 'Another reply is waiting.',
    })
    applyEvent(state, { type: 'assistant_delta', text: 'tial words.' })
    await nextTick()
    expect(answers()).toHaveLength(1)
    applyEvent(state, { type: 'assistant_message', text: 'The complete tool reply.', phase })
    await nextTick()
    expect(answers()).toHaveLength(1)
    expect(answers()[0]?.textContent).toContain('The complete tool reply.')
    expect(view.host.textContent).not.toContain('partial words.')
  },
)
