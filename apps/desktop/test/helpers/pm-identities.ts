import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentities } from '../../src/shared/runtime-ipc'

export function pmIdentities(createdAt: number): AgentIdentities {
  return {
    identities: [
      {
        id: 'agp:default:pm',
        slug: 'pm',
        displayName: null,
        createdAt,
        createdBy: null,
        provider: null,
        externalMcpServerIds: [],
        capabilities: { ...DEFAULT_CAPABILITIES },
        chosen: { maxDepth: 'default', canCreateAgents: 'default', canWriteRules: 'default' },
      },
    ],
    foldersWithoutARow: [],
    use: [],
    spawningEnabled: true,
    defaultApprovalMode: 'ask',
    externalMcpServers: [],
  }
}
