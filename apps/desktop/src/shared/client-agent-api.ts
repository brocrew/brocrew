import type { RuntimeBridge } from './runtime-ipc'

/** The identity reads and intents used by the window's agent store. */
export type ClientAgentApi = Pick<
  RuntimeBridge,
  | 'agentIdentities'
  | 'setCapabilities'
  | 'setAgentProvider'
  | 'setAgentDisplayName'
  | 'agentInstructions'
  | 'instructAgent'
  | 'decideInstruction'
  | 'decideMcpServerRequest'
  | 'agentModelAndEffort'
  | 'setAgentModelAndEffort'
  | 'removeAgent'
  | 'createAgent'
  | 'registerExternalMcpServer'
  | 'removeExternalMcpServer'
  | 'setServicesOn'
  | 'setSpawningEnabled'
  | 'setDefaultApprovalMode'
>
