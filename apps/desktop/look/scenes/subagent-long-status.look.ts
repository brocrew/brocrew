import { scene } from '../capture'
import { rightPanelStage } from '../fixtures/right-panel'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { facetsOfState } from '../../src/renderer/src/lib/agent-state'
import { agentStateWords, type AgentState } from '../../src/shared/agent-state'

/**
 * 🎨 **The right panel's Sub agents, one of them waiting on an answer** — its state is longer than
 * the chip, beside a short name. Fake data: `fixtures/right-panel.ts`.
 */
scene('subagent-long-status', (stage) => {
  const panel = rightPanelStage({
    identities: [{ id: 'aid:designer', slug: 'designer', displayName: 'Ada' }],
  })
  const waiting: AgentState = { is: 'waiting-on-an-answer', from: 'BroBot' }
  const cast = useWhoCalledWhom()
  const rail = new Map(cast.railSays.value as Map<string, unknown>)
  rail.set('sess_ada', {
    ...(rail.get('sess_ada') as object),
    facets: facetsOfState(waiting),
    word: agentStateWords(waiting),
  })
  cast.railSays.value = rail as never
  stage.mount(panel, {})
})
