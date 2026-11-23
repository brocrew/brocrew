import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { identities, workerRows } from '../../test/dom/parallel-workers-fixture'
import { scene } from '../capture'

/** 🎨 The rail with three workers given the same piece. Fake data: the workers fixture. */
scene('row-rail-workers', async (stage) => {
  const rows = workerRows()
  window.api = {
    runtime: { listResumable: async () => rows, listUnresumable: async () => [] },
  } as never
  stage.mount(
    SideRail,
    { open: [], activeId: null, place: null, agents: identities(rows.length) },
    { width: 251.68 },
  )
  await new Promise((done) => setTimeout(done, 80))
})
