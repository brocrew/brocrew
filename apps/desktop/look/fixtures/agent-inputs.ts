import { defineComponent, h } from 'vue'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { record } from '../../test/dom/harness'
import { givenAnswer } from '../../test/dom/what-this-agent-was-given.fixture'

/**
 * 🎨 **"What this agent receives"** (F093) on the overlay it opens on, its reads answered by the
 * fake answer the DOM tests use. ⛔ Fake only: no provider home, no real memory.
 */
const EVENTS = [
  {
    type: 'user_turn',
    text: 'Make the header warmer, and keep the logo where it is.',
    sent: 'Make the header warmer, and keep the logo where it is.',
  },
] as unknown as TranscriptEvent[]

export function agentInputsStage(): ReturnType<typeof defineComponent> {
  window.api = {
    runtime: {
      whatThisAgentWasGiven: async () => givenAnswer(),
      listResumable: async () => [],
      listUnresumable: async () => [],
    },
  } as never
  const state = record(EVENTS).transcript
  return defineComponent({
    render: () =>
      h(
        OverlayHost,
        { label: 'What this agent receives' },
        {
          default: () =>
            h(AgentInputPopup, {
              sessionId: 'sess_1',
              provider: 'claude',
              who: 'Designer',
              profile: 'designer',
              state,
              startLoaded: true,
            }),
        },
      ),
  })
}
