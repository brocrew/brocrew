import type { AgentIdentities } from '../../src/shared/runtime-ipc'

/** 🎨 The three made-up agents the README scenes show. Fake data only. */
export const README_NAMES = ['Glint', 'Loom', 'Pebble']

export function readmeRoster(now: number): AgentIdentities {
  return {
    identities: README_NAMES.map((name, i) => ({
      id: `sample-${i}`,
      slug: name.toLowerCase(),
      displayName: name,
      createdAt: now - 86400000,
      createdBy: null,
      provider: i === 1 ? 'codex' : 'claude',
      externalMcpServerIds: [],
    })),
    foldersWithoutARow: [],
    use: README_NAMES.map((name, i) => ({
      slug: name.toLowerCase(),
      conversations: 1,
      thisAppMintsIt: false,
      isLaunching: false,
      isStarting: false,
      runsOn: {
        provider: i === 1 ? ('codex' as const) : ('claude' as const),
        from: 'saved' as const,
      },
    })),
    defaultApprovalMode: 'ask',
    externalMcpServers: [],
  }
}

/** What each sample agent is doing, for the team and delegation scenes. */
export function readmeBeingDone(now: number) {
  return {
    readAt: now,
    conversations: README_NAMES.map((name, i) => ({
      conversation: `sample-${i}`,
      identity: name.toLowerCase(),
      told:
        i === 1
          ? { said: 'an-activity', phase: 'thinking', detail: null }
          : i === 0
            ? { said: 'an-activity', phase: 'waiting', detail: null }
            : { said: 'nothing', because: 'no-activity-right-now' },
      status: ['waiting_permission', 'working', 'idle'][i],
      streaming: false,
      since: now - 60000,
      context: null,
    })),
  }
}

export const README_STORE = { renameTo: async () => null, remove: async () => null }
