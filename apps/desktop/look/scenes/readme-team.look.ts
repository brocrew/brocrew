import { commands } from 'vitest/browser'
import { README_STORE, readmeBeingDone, readmeRoster } from '../fixtures/readme-sample'
import { scene } from '../capture'
import { auditVisibleScene } from '../lib/audit-visible-scene'

const NOW = Date.now()
const roster = readmeRoster(NOW)
const beingDone = readmeBeingDone(NOW)
const store = README_STORE
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
scene('readme-team', async (stage) => {
  const m = stage.mount(TeamWorkspace, {
    agents: roster,
    store,
    beingDone,
    conversations: [],
    held: ['sample-0', 'sample-1'],
  })
  await auditVisibleScene(m.host, (import.meta.env as Record<string, string>).LOOK_OUT!, {
    save: commands.saveLook,
  })
})
