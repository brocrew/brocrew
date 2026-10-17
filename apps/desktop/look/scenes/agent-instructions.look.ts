import AgentInstructionsSheet from '../../src/renderer/src/components/AgentInstructionsSheet.vue'
import type { InjectedInstruction, SessionInstructions } from '../../src/shared/runtime-ipc'
import type { WhoseText } from '../../src/shared/whose-text'
import { toldProps } from '../../test/dom/harness'
import { defineComponent, h } from 'vue'
import { scene } from '../capture'

/**
 * 🎨 **The agent-instructions sheet** — what an agent is told, by whom (F093's popup).
 * ⚑ To make another: copy this file and change PARTS and the other files (fake data only).
 */
const PARTS: { whose: WhoseText; heading: string | null; body: string }[] = [
  { whose: 'factory', heading: null, body: '# Your instructions' },
  {
    whose: 'factory',
    heading: 'How you work',
    body: '- Understand the request before acting.\n- Hand out focused pieces when work is large.',
  },
  {
    whose: 'configured',
    heading: 'Your own instructions',
    body: 'You are the designer of the bakery website. Keep the brand colours and use plain words.',
  },
  { whose: 'dynamic', heading: 'This conversation', body: '- You are running as `designer`.' },
]

function bundle(): InjectedInstruction {
  let text = ''
  const sections = PARTS.map((part, index) => {
    const start = text.length
    const rendered = part.heading === null ? part.body : `## ${part.heading}\n\n${part.body}`
    text += index === PARTS.length - 1 ? `${rendered}\n` : `${rendered}\n\n`
    return { whose: part.whose, heading: part.heading, start, end: text.length }
  })
  return {
    kind: 'profile-instructions',
    path: '/Users/someone/provider-homes/designer/brobot-instructions.md',
    text,
    bytes: text.length,
    truncated: false,
    sections,
  }
}

const TOLD: SessionInstructions = {
  injected: [bundle()],
  agentMemory: [
    {
      kind: 'agent-memory',
      path: '/Users/someone/provider-homes/designer/memory/MEMORY.md',
      text: '- The bakery prefers warm colours.\n',
      bytes: 34,
      truncated: false,
      reach: 'prompt',
    },
  ],
  provider: [{ path: '/Users/someone/work/CLAUDE.md', scope: 'project' }],
  refused: [],
  note: 'Read at launch and appended as text.',
  recallsReported: true,
  writesReported: false,
  composed: bundle().text,
}

// ⚑ The sheet on the overlay layer's light surface, as the window raises it (`OverlayHost`
// carries `data-chat-theme="light"` for every sheet).
const OnTheOverlay = defineComponent({
  setup: () => () =>
    h(
      'div',
      { 'data-chat-theme': 'light', style: 'width:100%;height:100%;background:var(--chat-bg)' },
      [h(AgentInstructionsSheet as never, toldProps(TOLD))],
    ),
})

scene('agent-instructions', (stage) => {
  stage.mount(OnTheOverlay, {}, { width: 880 })
})
