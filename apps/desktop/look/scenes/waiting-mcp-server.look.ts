import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import { aFictionalMcpServerRequest } from '../fixtures/mcp-server-request'
import { scene } from '../capture'

scene('waiting-mcp-server', (stage) => {
  aFictionalMcpServerRequest()
  stage.mount(WaitingOnYou, { needsYou: [], clock: 1_790_000_060_000, agents: null })
})
