import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import { aWaitingPageWithEveryCard } from '../../test/dom/a-waiting-page-with-every-card'
import { boxOf, crop, scene } from '../capture'

scene('waiting-polish', async (stage) => {
  const m = await aWaitingPageWithEveryCard(stage.width, stage.height, true)
  const phase = import.meta.env['LOOK_PHASE'] ?? 'capture'
  if (import.meta.env['LOOK_PANEL'] !== 'true') {
    await crop(`stopped-${phase}`, boxOf(m.q('persons-queue-stalled')))
    const todo = m.q('waiting-todo-req_todo').closest('.wait')!
    todo.scrollIntoView({ block: 'center' })
    await new Promise((done) => requestAnimationFrame(done))
    await crop(`todo-card-${phase}`, boxOf(todo))
    m.q('waiting-on-you').scrollTop = 0
    window.scrollTo(0, 0)
  }
  if (import.meta.env['LOOK_PANEL'] === 'true') {
    const panel = stage.mount(OverlayHost, { label: 'Sample report' })
    await crop(`panel-${phase}`, boxOf(panel.q('persons-queue')))
  }
})
