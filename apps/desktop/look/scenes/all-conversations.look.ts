import { scene } from '../capture'
import { mountLibrary } from '../fixtures/all-conversations'

/** 🎨 The All conversations library with three conversations. Fake data: `fixtures/all-conversations.ts`. */
scene('all-conversations', async (stage) => {
  await mountLibrary(stage)
})
