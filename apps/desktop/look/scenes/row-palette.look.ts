import CommandPalette from '../../src/renderer/src/components/CommandPalette.vue'
import { scene } from '../capture'
import { ROW_CONVERSATIONS } from '../fixtures/one-conversation'

/** 🎨 The command palette's conversation rows. Fake data: `fixtures/one-conversation.ts`. */
scene('row-palette', async (stage) => {
  const palette = stage.mount(CommandPalette, {
    conversations: ROW_CONVERSATIONS.map((one, index) => ({
      sessionId: one.id,
      provider: index === 1 ? 'codex' : 'claude',
      label: one.label,
      named: { label: one.title.split(' · ')[0], title: one.title.split(' · ')[1] },
      word: index === 0 ? 'working' : 'idle',
      facets: { doing: index === 0 ? 'working' : 'idle' },
      opening: null,
      place: 'brobot-workspace',
    })),
    looked: true,
    listError: null,
    activeId: 'sess_ada',
    agent: null,
  })
  ;(palette.vm['toggle'] as () => void)()
  await new Promise((done) => setTimeout(done, 80))
})
