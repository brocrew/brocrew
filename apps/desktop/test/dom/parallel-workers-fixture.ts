import { NOTHING_HAS_ARRIVED, type WhatIsBeingDone } from '../../src/shared/what-is-being-done'
import type { AgentIdentities, ResumableSessionInfo } from '../../src/shared/runtime-ipc'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'

export const NOW = 1800000000000
export const RECIPE_ID = 'aid:recipe-worker'
export function workerRows(count = 3, finished = false): ResumableSessionInfo[] {
  return Array.from({ length: count }, (_, at) => {
    const number = at + 1
    const done = finished && number === 2
    const sessionId = `recipe-${number}`
    return {
      sessionId,
      provider: 'codex',
      cwd: '/made-up/bakery',
      profileId: 'recipe-worker',
      // The host names a worker's identity by its id, as it does in a real workspace.
      worker: { identity: RECIPE_ID, giver: 'menu-conversation', number, bornAs: sessionId },
      state: { is: done ? 'idle' : 'active' },
      running: done ? 'not-running' : 'unwatched',
      status: done ? 'idle' : 'working',
      named: {
        label: `W90.${number}`,
        title: ['Recipe', 'Menu', 'Shopping'][at] ?? 'Recipe',
        ...(done ? { ended: 'answered' as const } : {}),
      },
      approvalMode: 'ask',
      reasoningEffort: null,
      model: null,
      planMode: null,
      adoptedAt: null,
      hasTranscript: true,
      child: null,
      lastEnding: 'completed',
      updatedAt: NOW + number,
      ref: { provider: 'codex', sessionId: `fake-${number}`, cwd: '/made-up/bakery', rotation: 0 },
      resumeRefusal: null,
    }
  })
}
export function identities(count = 3): AgentIdentities {
  return {
    identities: [
      {
        id: RECIPE_ID,
        slug: 'recipe-worker',
        displayName: 'Mira',
        createdAt: 0,
        createdBy: null,
        provider: 'codex',
        externalMcpServerIds: [],
        capabilities: DEFAULT_CAPABILITIES,
        chosen: {
          maxDepth: 'default',
          canMessage: 'default',
          canAssignWork: 'default',
          canCreateAgents: 'default',
          canWriteRules: 'default',
        },
      },
    ],
    use: [
      {
        slug: 'recipe-worker',
        conversations: count,
        thisAppMintsIt: false,
        isLaunching: false,
        isStarting: false,
        runsOn: { provider: 'codex', from: 'saved' },
      },
    ],
    foldersWithoutARow: [],
    spawningEnabled: true,
    defaultApprovalMode: 'ask',
    externalMcpServers: [],
  }
}
export const store = {
  renameTo: async () => null,
  remove: async () => null,
} as unknown as AgentStore

export function activity(rows: readonly ResumableSessionInfo[]): WhatIsBeingDone {
  return {
    readAt: NOW,
    conversations: rows
      .filter((row) => row.running !== 'not-running')
      .map((row) => ({
        conversation: row.sessionId,
        identity: 'recipe-worker',
        told: NOTHING_HAS_ARRIVED,
        status: 'working',
        streaming: false,
        since: NOW - 60000,
        context: null,
      })),
  }
}
