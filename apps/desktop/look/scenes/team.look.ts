import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentities, AgentIdentity } from '../../src/shared/runtime-ipc'
import { scene } from '../capture'

/**
 * 🎨 **The Team page** — every agent, its engine and its conversations.
 * ⚑ To make another: copy this file and change AGENTS (fake data only).
 */
const AGENTS: {
  slug: string
  displayName: string | null
  provider: 'claude' | 'codex' | null
  conversations: number
}[] = [
  { slug: 'default', displayName: 'BroBot', provider: 'claude', conversations: 2 },
  { slug: 'designer', displayName: 'Ada', provider: 'claude', conversations: 1 },
  { slug: 'developer', displayName: 'Ali', provider: 'codex', conversations: 3 },
  { slug: 'tester', displayName: null, provider: null, conversations: 0 },
]

const row = (one: (typeof AGENTS)[number]): AgentIdentity => ({
  id: `aid:${one.slug}`,
  slug: one.slug,
  displayName: one.displayName,
  createdAt: 0,
  createdBy: null,
  provider: one.provider,
  externalMcpServerIds: [],
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

const IDENTITIES: AgentIdentities = {
  identities: AGENTS.map(row),
  foldersWithoutARow: [],
  use: AGENTS.map((one) => ({
    slug: one.slug,
    conversations: one.conversations,
    thisAppMintsIt: one.slug === 'default',
    isLaunching: false,
    isStarting: false,
    runsOn:
      one.provider === null
        ? { provider: null, from: 'nothing-yet' as const }
        : { provider: one.provider, from: 'saved' as const },
  })),
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
}

const STORE = { renameTo: async () => null, remove: async () => null }

scene('team', (stage) => {
  stage.mount(TeamWorkspace, { agents: IDENTITIES, store: STORE })
})
