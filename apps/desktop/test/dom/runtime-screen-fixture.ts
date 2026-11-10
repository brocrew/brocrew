import { vi } from 'vitest'
import { createSessionStore, type SessionStore } from '../../src/renderer/src/lib/session-store'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { screenFacts } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import { useAttentionSignals } from '../../src/renderer/src/composables/useAttentionSignals'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import {
  forgetProfileSignIns,
  useProfileSignIn,
} from '../../src/renderer/src/composables/useProfileSignIn'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import type {
  AgentIdentities,
  RuntimeBridge,
  ResumedSession,
  CreatedSession,
  RefusedLaunch,
} from '../../src/shared/runtime-ipc'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { META, unmountAll } from './harness'

// Provider setup has its own tests; this screen fixture never enters sign-in.
vi.mock('../../src/renderer/src/components/ProviderSetupAtLaunch.vue', () => ({
  default: { render: () => null },
}))

export let sessions: SessionStore
export let agentStore: ReturnType<typeof createAgentStore>
const changeListeners = new Set<Parameters<RuntimeBridge['onChanged']>[0]>()
export const changed: Parameters<RuntimeBridge['onChanged']>[0] = (change) => {
  for (const listener of [...changeListeners]) listener(change)
}
vi.mock('../../src/renderer/src/composables/useSessionStore', () => ({
  useSessionStore: () => sessions,
}))
vi.mock('../../src/renderer/src/composables/useAgentStore', () => ({
  useAgentStore: () => agentStore,
}))
vi.mock('../../src/renderer/src/composables/useModelLists', () => ({
  useModelLists: () => createModelLists(() => window.api.runtime),
}))

const agents: AgentIdentities = {
  identities: [
    {
      id: 'agent:editor',
      slug: 'editor',
      displayName: 'Editor',
      createdAt: 1,
      createdBy: null,
      provider: 'codex',
      externalMcpServerIds: [],
      capabilities: { ...DEFAULT_CAPABILITIES },
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
      slug: 'editor',
      conversations: 0,
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
export const walk = () => ({
  rows: [],
  walk: 'every-conversation-that-routed' as const,
  ledgers: 0,
  rowsUnread: 0,
})
export const forestWalk = () => ({ ...walk(), walk: 'every-conversation-this-app-placed' as const })
export const runtime = {
  onEvent: vi.fn(() => () => {}),
  onLiveness: vi.fn(() => () => {}),
  onChanged: vi.fn((listener: Parameters<RuntimeBridge['onChanged']>[0]) => {
    changeListeners.add(listener)
    return () => {
      changeListeners.delete(listener)
    }
  }),
  onStates: vi.fn(() => () => {}),
  onLimitsDisplayChanged: vi.fn(() => () => {}),
  attachOpen: vi.fn(async (): Promise<ResumedSession[]> => []),
  resolveLink: vi.fn<RuntimeBridge['resolveLink']>(async () => ({
    state: 'unavailable',
    kind: 'piece',
    title: null,
    status: null,
    opens: null,
  })),
  look: vi.fn(async ({ sessionId }: { sessionId: string }): Promise<ResumedSession> => ({
    ...META,
    sessionId,
    handover: 'recorded',
    history: { entries: [], from: 0, hasOlder: false, turnAligned: true },
  })),
  latestHistory: vi.fn<RuntimeBridge['latestHistory']>(async () => ({
    entries: [],
    from: 0,
    hasOlder: false,
    turnAligned: true,
  })),
  startAndSend: vi.fn(),
  createSession:
    vi.fn<
      (
        input: Parameters<RuntimeBridge['createSession']>[0],
      ) => Promise<CreatedSession | RefusedLaunch>
    >(),
  cancelLaunch: vi.fn<RuntimeBridge['cancelLaunch']>(),
  stopLooking: vi.fn(async () => {}),
  send: vi.fn(),
  resume: vi.fn(),
  interrupt: vi.fn<RuntimeBridge['interrupt']>(async () => {}),
  setSpawningEnabled: vi.fn(async ({ enabled }: { enabled: boolean }) => ({
    spawningEnabled: enabled,
  })),
  listResumable: vi.fn(async () => []),
  listUnresumable: vi.fn(async () => []),
  agentIdentities: vi.fn(async () => agents),
  profiles: vi.fn<RuntimeBridge['profiles']>(async () => []),
  capabilities: vi.fn(async () => ({})),
  providerVersions: vi.fn(async () => []),
  questionsForAPerson: vi.fn<RuntimeBridge['questionsForAPerson']>(async () => walk()),
  decisionsForAPerson: vi.fn(async () => walk()),
  stalledWorkForAPerson: vi.fn(async () => walk()),
  stoppedWorkForAPerson: vi.fn(async () => walk()),
  workIncidentsForAPerson: vi.fn<RuntimeBridge['workIncidentsForAPerson']>(async () => walk()),
  waitingOnWhoWroteForAPerson: vi.fn(async () => walk()),
  instructionAsksForAPerson: vi.fn(async () => []),
  mcpServerRequestsForAPerson: vi.fn(async () => []),
  readLimitsDisplay: vi.fn(async () => null),
  readWorkspace: vi.fn(async () => null),
  filesKept: vi.fn<RuntimeBridge['filesKept']>(async () => ({ ok: true, files: [], added: [] })),
  whatEachConversationIsWaitingOn: vi.fn(async () => null),
  whoCalledWhom: vi.fn<RuntimeBridge['whoCalledWhom']>(),
  whatIsBeingDone: vi.fn<RuntimeBridge['whatIsBeingDone']>(async () => ({
    readAt: 1,
    conversations: [],
  })),
  processMemory: vi.fn<RuntimeBridge['processMemory']>(async () => ({ conversations: [] })),
  theWholeForest: vi.fn<RuntimeBridge['theWholeForest']>(async () => ({
    readAt: 1,
    nodes: forestWalk(),
    conversations: 0,
    heldByNoAgent: 0,
  })),
}

export function installRuntimeScreenFixture(): void {
  forgetProfileSignIns()
  for (const provider of ['claude', 'codex'] as const)
    useProfileSignIn(provider, DEFAULT_PROFILE_ID).auth = {
      state: 'usable',
      login: 'account',
      expiresAt: null,
    }
  vi.clearAllMocks()
  runtime.createSession.mockReset()
  runtime.cancelLaunch.mockReset().mockResolvedValue(true)
  runtime.resolveLink.mockReset()
  runtime.latestHistory.mockReset()
  changeListeners.clear()
  runtime.whoCalledWhom.mockReset().mockRejectedValue(new Error('No relationship reading supplied'))
  screenFacts().update({ reading: null })
  useOverlays().close()
  localStorage.clear()
  useAttentionSignals().value = true
  usePersonsQueue().forget()
  runtime.questionsForAPerson.mockReset().mockResolvedValue(walk())
  runtime.workIncidentsForAPerson.mockReset().mockResolvedValue(walk())
  window.api = {
    runtime,
    getAppInfo: async () => ({
      name: 'Fictional BroBot',
      windowTitle: 'Fictional BroBot',
      version: '0.0.0',
      step: 'test',
      workspace: { name: 'Fiction', path: '/fictional/work', isDefault: false },
      build: { id: 'test', commit: '', dirty: false, branches: null },
      db: { migrationsApplied: 0, providerSessionCount: 0 },
    }),
  } as unknown as Window['api']
  sessions = createSessionStore(window.api.runtime as RuntimeBridge)
  agentStore = createAgentStore(window.api.runtime)
}

export function disposeRuntimeScreenFixture(): void {
  applyTheme(null)
  unmountAll()
  sessions.dispose()
  vi.useRealTimers()
  useOverlays().close()
  for (const toast of useOverlays().toasts.value) useOverlays().dismiss(toast.id)
  localStorage.clear()
}

export function replaceFixtureAgentStore(store: ReturnType<typeof createAgentStore>): void {
  agentStore = store
}

export function agentBookAnswers() {
  const skills = vi.fn(async (raw: unknown) => {
    const request = raw as { operation: string; profileId: string }
    return request.operation === 'profile-list'
      ? {
          operation: 'profile-list',
          profileId: request.profileId,
          skills: [],
          nextOffset: null,
          readAt: 1700000000000,
        }
      : { operation: 'shared-list', skills: [] }
  })
  const book: Partial<RuntimeBridge> = {
    skills: skills as unknown as RuntimeBridge['skills'],
    agentInstructions: async () => ({
      own: { identity: 'editor', versions: [] },
      waiting: [],
      readAt: 1700000000000,
    }),
    agentRulesUnread: async () => ({ unread: false, seenThrough: 0, newestDirectVersion: 0 }),
    agentMethods: async () => ({
      state: 'missing',
      items: [],
      total: 0,
      offset: 0,
      nextOffset: null,
      indexState: 'absent',
      indexFingerprint: null,
      malformedLines: 0,
      truncated: false,
      readAt: 1700000000000,
    }),
    agentMethodChanges: async () => ({ ok: true, changes: [] }),
    agentMemory: async ({ profileId }) => ({
      profileId,
      stores: [],
      amendments: [],
      readAt: 1700000000000,
    }),
  }
  return { skills, book }
}
