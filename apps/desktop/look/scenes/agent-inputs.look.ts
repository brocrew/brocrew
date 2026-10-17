import { scene } from '../capture'
import { agentInputsStage } from '../fixtures/agent-inputs'

/** 🎨 **"What this agent receives"** (F093), on its Overview tab. Fake data: `fixtures/agent-inputs.ts`. */
scene('agent-inputs', (stage) => {
  stage.mount(agentInputsStage(), {})
})
