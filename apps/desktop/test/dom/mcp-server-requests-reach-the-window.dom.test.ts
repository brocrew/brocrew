import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import type { WaitingOnWhoWrote } from '../../src/shared/waiting-on-who-wrote'
import RuntimeScreen from '../../src/renderer/src/components/RuntimeScreen.vue'
import { createSessionStore, type SessionStore } from '../../src/renderer/src/lib/session-store'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type {
  AgentIdentities,
  RuntimeBridge,
  McpServerRequestForAPerson,
} from '../../src/shared/runtime-ipc'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { mount, unmountAll } from './harness'

// Provider setup has its own tests; this screen fixture never enters sign-in.
vi.mock('../../src/renderer/src/components/ProviderSetupAtLaunch.vue', () => ({
  default: { render: () => null },
}))

let sessions: SessionStore
let agentStore: ReturnType<typeof createAgentStore>
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
const walk = () => ({
  rows: [],
  walk: 'every-conversation-that-routed' as const,
  ledgers: 0,
  rowsUnread: 0,
})
const forestWalk = () => ({ ...walk(), walk: 'every-conversation-this-app-placed' as const })
let owed: WaitingOnWhoWrote[] = []
let requests: McpServerRequestForAPerson[] = []
const request = (n: number): McpServerRequestForAPerson => ({
  conversation: `fictional-writer-${n}`,
  at: n,
  askerCalled: 'Fictional Writer',
  requested: {
    type: 'mcp_server_requested',
    requestId: `fictional-request-${n}`,
    name: `fictional-notes-${n}`,
    url: `http://127.0.0.1:8765/mcp/${n}`,
    reaches: 'Read fictional notes.',
    whoGetsIt: 'everyone',
    requestedBy: 'editor',
  },
})
const runtime = {
  onEvent: vi.fn(() => () => {}),
  onLiveness: vi.fn(() => () => {}),
  onChanged: vi.fn(() => () => {}),
  onStates: vi.fn(() => () => {}),
  onLimitsDisplayChanged: vi.fn(() => () => {}),
  attachOpen: vi.fn(async () => []),
  setSpawningEnabled: vi.fn(async ({ enabled }: { enabled: boolean }) => ({
    spawningEnabled: enabled,
  })),
  listResumable: vi.fn(async () => []),
  listUnresumable: vi.fn(async () => []),
  agentIdentities: vi.fn(async () => agents),
  profiles: vi.fn(async () => []),
  capabilities: vi.fn(async () => ({})),
  providerVersions: vi.fn(async () => []),
  questionsForAPerson: vi.fn(async () => walk()),
  decisionsForAPerson: vi.fn(async () => walk()),
  stalledWorkForAPerson: vi.fn(async () => walk()),
  stoppedWorkForAPerson: vi.fn(async () => walk()),
  workIncidentsForAPerson: vi.fn(async () => walk()),
  waitingOnWhoWroteForAPerson: vi.fn(async () => ({
    ...walk(),
    walk: 'every-conversation-that-was-given-work' as const,
    rows: owed,
  })),
  instructionAsksForAPerson: vi.fn(async () => []),
  mcpServerRequestsForAPerson: vi.fn(async () => requests),
  decideMcpServerRequest: vi.fn(async ({ requestId }: { requestId: string; approve: boolean }) => {
    requests = requests.filter((one) => one.requested.requestId !== requestId)
    return { outcome: 'taken' as const, reason: 'Registered. It offers: read_notes.' }
  }),
  readLimitsDisplay: vi.fn(async () => null),
  readWorkspace: vi.fn(async () => null),
  whatEachConversationIsWaitingOn: vi.fn(async () => null),
  whatIsBeingDone: vi.fn(async () => ({ readAt: 1, conversations: [] })),
  theWholeForest: vi.fn(async () => ({
    readAt: 1,
    nodes: forestWalk(),
    conversations: 0,
    heldByNoAgent: 0,
  })),
}

beforeEach(() => {
  vi.clearAllMocks()
  requests = []
  owed = []
  usePersonsQueue().forget()
  useOverlays().close()
  localStorage.clear()
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
})
afterEach(() => {
  usePersonsQueue().forget()
  applyTheme(null)
  unmountAll()
  sessions.dispose()
  useOverlays().close()
  localStorage.clear()
})

it('one MCP request appears on Waiting, its rail badge and the overlay corner exactly once', async () => {
  requests = [request(1)]
  const m = mount(RuntimeScreen, {}, { width: 1200, height: 900 })
  await expect.poll(() => m.all('waiting-badge')[0]?.textContent?.trim()).toBe('1')
  m.q('rail-waiting').click()
  await expect
    .poll(() => m.all('waiting-server-request-approve-fictional-request-1').length)
    .toBe(1)
  expect(m.q('server-requests-count').textContent).toBe('1')
  expect(m.host.textContent).not.toContain('The person approved')
  m.q('rail-team').click()
  await expect.poll(() => m.all('team-workspace').length).toBe(1)
  m.q('team-tab-roster').click()
  await nextTick()
  m.q('team-open-editor').click()
  await expect.poll(() => m.all('overlay-host').length).toBe(1)
  expect(m.q('persons-queue-count').textContent).toBe('1')
  expect(m.all('persons-queue-server-request-approve-fictional-request-1')).toHaveLength(1)
  expect(m.host.querySelector('.request-url')?.textContent).toBe(request(1).requested.url)
})

it('the actual screen sends only id and approve and removes the count before its next poll', async () => {
  requests = [request(1), request(2)]
  const m = mount(RuntimeScreen, {})
  await expect.poll(() => m.all('waiting-badge')[0]?.textContent?.trim()).toBe('2')
  m.q('rail-waiting').click()
  await expect
    .poll(() => m.all('waiting-server-request-approve-fictional-request-1').length)
    .toBe(1)
  m.q('waiting-server-request-approve-fictional-request-1').click()
  await expect.poll(() => runtime.decideMcpServerRequest.mock.calls.length).toBe(1)
  expect(runtime.decideMcpServerRequest).toHaveBeenCalledWith({
    requestId: 'fictional-request-1',
    approve: true,
  })
  expect(Object.keys(runtime.decideMcpServerRequest.mock.calls[0]![0]).sort()).toEqual([
    'approve',
    'requestId',
  ])
  await expect
    .poll(() => m.all('waiting-server-request-settled-fictional-request-1').length)
    .toBe(1)
  expect(m.q('waiting-badge').textContent?.trim()).toBe('1')
  expect(m.q('server-requests-count').textContent).toBe('1')
  expect(m.q('waiting-server-request-settled-fictional-request-1').textContent).toBe(
    'Registered. It offers: read_notes.',
  )
  expect(m.all('waiting-server-request-approve-fictional-request-1')).toHaveLength(0)
  expect(m.all('waiting-server-request-approve-fictional-request-2')).toHaveLength(1)
})

it('the healthy empty screen has no MCP group, badge or floating request count', async () => {
  const m = mount(RuntimeScreen, {})
  await expect.poll(() => runtime.mcpServerRequestsForAPerson.mock.calls.length).toBeGreaterThan(0)
  m.q('rail-waiting').click()
  await nextTick()
  expect(m.all('waiting-badge')).toHaveLength(0)
  expect(m.all('waiting-server-requests')).toHaveLength(0)
  expect(m.all('server-requests-count')).toHaveLength(0)
  expect(m.all('persons-queue-count')).toHaveLength(0)
})

it('an MCP request and a reply owed to a person count once each across distinct groups', async () => {
  requests = [request(1)]
  owed = [
    {
      piece: 'fictional-work',
      label: 'W99.1',
      title: 'Draft fictional pages',
      owner: 'fictional-other',
      ownerName: 'Fictional Editor',
      answeredAt: 100,
    },
  ]
  const m = mount(RuntimeScreen, {}, { width: 1200, height: 900 })
  await expect.poll(() => m.all('waiting-badge')[0]?.textContent?.trim()).toBe('2')
  m.q('rail-waiting').click()
  await expect
    .poll(() => m.all('waiting-server-request-approve-fictional-request-1').length)
    .toBe(1)
  expect(m.q('server-requests-count').textContent).toBe('1')
  expect(m.host.textContent).toContain('Draft fictional pages')
  expect(m.all('waiting-server-request-fictional-request-1')).toHaveLength(1)
  m.q('rail-team').click()
  await expect.poll(() => m.all('team-workspace').length).toBe(1)
  m.q('team-tab-roster').click()
  await nextTick()
  m.q('team-open-editor').click()
  await expect.poll(() => m.all('overlay-host').length).toBe(1)
  expect(m.q('persons-queue-count').textContent).toBe('2')
  expect(m.all('persons-queue-server-request-fictional-request-1')).toHaveLength(1)
  expect(m.host.textContent).toContain('Draft fictional pages')
})
