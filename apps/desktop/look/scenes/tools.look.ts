import SettingsScreen from '../../src/renderer/src/components/SettingsScreen.vue'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import type {
  AgentIdentities,
  RuntimeBridge,
  ProviderCapabilityMap,
} from '../../src/shared/runtime-ipc'
import { scene } from '../capture'
import { aFictionalMcpServerRequest } from '../fixtures/mcp-server-request'

const CAPABILITY_FIXTURE = {
  claude: {
    externalMcpServers: {
      state: 'available',
      note: 'A server this identity may use is passed to the session as a known MCP server. In a conversation that asks you first, each of its tool calls asks you before it runs, whatever the server says about the tool — unless you allowed that tool for the conversation or kept a rule that allows it — and a form the server sends reaches you to answer.',
    },
  },
  codex: {
    externalMcpServers: {
      state: 'available',
      note: "A server this identity may use is declared to the conversation, and its tools reach the agent through Codex's own code mode. In a conversation that asks you first, Codex asks before one of them runs, naming the server, the tool and what it is given — except a tool the server itself marks as only reading, or as destroying nothing and reaching nothing outside, or one you chose to always allow, which Codex runs without asking, as it runs every tool in a conversation that does not ask. A request the server makes of its own names the server and not the call.",
    },
  },
} as unknown as ProviderCapabilityMap

const NOW = 1_790_000_000_000
const REGISTER: AgentIdentities = {
  identities: [],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [
    {
      id: 'ems:local-docs',
      name: 'local-docs',
      url: 'http://127.0.0.1:8765/mcp',
      reach: 'everyone',
      registeredAt: NOW - 172_800_000,
    },
    {
      id: 'ems:project-search',
      name: 'project-search',
      url: 'http://127.0.0.1:8770/projects/sample-site/search/mcp',
      reach: 'restricted',
      registeredAt: NOW - 3_600_000,
    },
  ],
}

scene('tools', async (stage) => {
  aFictionalMcpServerRequest()
  const store = createAgentStore({
    agentIdentities: async () => REGISTER,
  } as unknown as RuntimeBridge)
  await store.load()
  stage.mount(SettingsScreen, {
    tab: 'tools',
    store,
    capabilities: CAPABILITY_FIXTURE,
    warnings: null,
    clock: NOW,
    toolsNow: NOW,
  })
})
