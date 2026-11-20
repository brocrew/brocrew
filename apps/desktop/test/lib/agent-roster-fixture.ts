import type { AgentIdentities } from '../../src/shared/runtime-ipc'

export function agentRosterForWire(): AgentIdentities {
  return {
    identities: [
      {
        id: 'aid:pm',
        slug: 'pm',
        displayName: null,
        createdAt: 1_700_000_000_000,
        createdBy: null,
        provider: null,
        externalMcpServerIds: [],
      },
    ],
    foldersWithoutARow: [],
    use: [],
    defaultApprovalMode: 'ask',
    externalMcpServers: [],
  }
}

interface RosterBridgeAnswers {
  list: AgentIdentities
  saved: unknown[]
  loadFails: string | null
  saveFails?: string | null
}

export function rosterSettingsBridge(read: () => RosterBridgeAnswers) {
  return {
    agentIdentities: async () => {
      const { list, loadFails } = read()
      if (loadFails !== null) throw new Error(loadFails)
      return list
    },
    setExternalMcpServers: async (input: unknown) => {
      // Electron checks the payload with structured clone, which rejects a Vue proxy.
      structuredClone(input)
      const { list, saved, saveFails } = read()
      saved.push(input)
      if (saveFails != null) throw new Error(saveFails)
      return list.identities[0] ?? null
    },
  }
}
