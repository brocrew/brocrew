import { nextTick } from 'vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { conversationList } from '../../src/renderer/src/lib/conversation-list'
import { activity, identities, store, workerRows } from '../../test/dom/parallel-workers-fixture'
import { scene } from '../capture'

/** 🎨 The team page with each agent's conversations unfolded. Fake data: the workers fixture. */
scene('row-team', async (stage) => {
  const rows = workerRows()
  const m = stage.mount(TeamWorkspace, {
    agents: identities(rows.length),
    store,
    beingDone: activity(rows),
    conversations: conversationList({
      resumable: rows,
      unresumable: [],
      identities: identities().identities,
    }),
  })
  await new Promise((done) => setTimeout(done, 50))
  for (const one of m.host.querySelectorAll('details')) one.setAttribute('open', '')
  await nextTick()
  await new Promise((done) => setTimeout(done, 50))
})
