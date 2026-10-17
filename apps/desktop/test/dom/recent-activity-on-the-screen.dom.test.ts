import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import RuntimeScreen from '../../src/renderer/src/components/RuntimeScreen.vue'
import { createSessionStore, type SessionStore } from '../../src/renderer/src/lib/session-store'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentities, RuntimeBridge, ResumedSession } from '../../src/shared/runtime-ipc'
import type { ActivityLine, RecentActivityReading } from '../../src/shared/recent-activity'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { mount, unmountAll, META } from './harness'

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
const runtime = {
  onEvent: vi.fn(() => () => {}),
  onLiveness: vi.fn(() => () => {}),
  onChanged: vi.fn(() => () => {}),
  recentActivity: vi.fn<RuntimeBridge['recentActivity']>(),
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
  archiveConversation: vi.fn(async ({ sessionId }: { sessionId: string }) => ({
    done: true as const,
    conversations: [sessionId],
  })),
  startAndSend: vi.fn(),
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
  profiles: vi.fn(async () => []),
  capabilities: vi.fn(async () => ({})),
  providerVersions: vi.fn(async () => []),
  questionsForAPerson: vi.fn(async () => walk()),
  decisionsForAPerson: vi.fn(async () => walk()),
  stalledWorkForAPerson: vi.fn(async () => walk()),
  stoppedWorkForAPerson: vi.fn(async () => walk()),
  workIncidentsForAPerson: vi.fn(async () => walk()),
  waitingOnWhoWroteForAPerson: vi.fn(async () => walk()),
  instructionAsksForAPerson: vi.fn(async () => []),
  mcpServerRequestsForAPerson: vi.fn(async () => []),
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

/**
 * Recent activity and "Since you were last here", through the real screen: the last-seen record
 * the window keeps, the host's activity read, and the conversation each line opens.
 */

afterEach(() => {
  // What a test told the host to answer goes back to the fixture's own answers.
  for (const one of [runtime.look, runtime.recentActivity]) one.mockReset()
  applyTheme(null)
  unmountAll()
  sessions.dispose()
  useOverlays().close()
  localStorage.clear()
})

const settle = async (): Promise<void> => {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
  await new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done())),
  )
}

const MINUTE = 60_000
const LAST_SEEN = 'brocrew:last-seen:/fictional/work'

function line(id: string, what: ActivityLine['what'], minutesAgo: number): ActivityLine {
  return {
    id,
    at: Date.now() - minutesAgo * MINUTE,
    what,
    register: what === 'finished' || what === 'failed' ? 'claimed' : 'observed',
    piece: { id, label: `W1.${id}`, title: `Piece ${id}` },
    agent: 'Ada',
    conversation: `recorded-${id}`,
  }
}

const reading = (lines: ActivityLine[]): RecentActivityReading => ({
  window: { from: 0, to: Date.now() },
  read: { walk: 'one-window-over-every-agents-conversation', ledgers: 2, rowsUnread: 0 },
  lines,
  capped: false,
})

async function screen() {
  const m = mount(RuntimeScreen, {}, { width: 1200, height: 800 })
  await expect.poll(() => m.all('rail-waiting').length).toBe(1)
  await settle()
  return m
}

it('Waiting on you shows what finished or failed since the person was last here, each opening its conversation', async () => {
  const since = Date.now() - 40 * MINUTE
  localStorage.setItem(LAST_SEEN, String(since))
  runtime.recentActivity.mockResolvedValue(
    reading([line('1', 'finished', 5), line('2', 'failed', 10), line('3', 'started', 15)]),
  )
  const m = await screen()
  m.q('rail-waiting').click()
  await expect.poll(() => m.all('since-line').length).toBe(2)
  // The box asks for exactly the time since the person was last here.
  expect(runtime.recentActivity).toHaveBeenCalledWith({ from: since, to: expect.any(Number) })
  // Open requests stay below it.
  const box = m.q('since-last-here').getBoundingClientRect()
  expect(box.top).toBeLessThan(m.q('attention-clear').getBoundingClientRect().top)

  runtime.look.mockResolvedValueOnce({
    ...META,
    sessionId: 'recorded-2',
    handover: 'recorded',
    history: { entries: [], from: 0, hasOlder: false, turnAligned: true },
  } as ResumedSession)
  m.all('since-line')[1]!.click()
  await expect
    .poll(() => runtime.look.mock.calls.at(-1)?.[0])
    .toMatchObject({
      sessionId: 'recorded-2',
    })
})

it('See all goes to Recent activity, which reads the chosen window', async () => {
  localStorage.setItem(LAST_SEEN, String(Date.now() - 40 * MINUTE))
  runtime.recentActivity.mockResolvedValue(reading([line('1', 'finished', 5)]))
  const m = await screen()
  m.q('rail-waiting').click()
  await expect.poll(() => m.all('since-see-all').length).toBe(1)
  m.q('since-see-all').click()
  await expect.poll(() => m.all('recent-activity').length).toBe(1)
  await expect.poll(() => m.all('activity-line').length).toBe(1)
  runtime.recentActivity.mockClear()
  m.q(`activity-window-${String(7 * 24 * 3_600_000)}`).click()
  await expect.poll(() => runtime.recentActivity.mock.calls.length).toBeGreaterThan(0)
  const asked = runtime.recentActivity.mock.calls.at(-1)![0]
  expect(asked.to - asked.from).toBe(7 * 24 * 3_600_000)
})

it('without a last-seen record there is no box, and nothing is guessed', async () => {
  runtime.recentActivity.mockResolvedValue(reading([line('1', 'finished', 5)]))
  const m = await screen()
  m.q('rail-waiting').click()
  await settle()
  await settle()
  expect(m.all('waiting-on-you')).toHaveLength(1)
  expect(m.all('since-last-here')).toHaveLength(0)
})

it('a read that fails draws no box, rather than an empty one', async () => {
  localStorage.setItem(LAST_SEEN, String(Date.now() - 40 * MINUTE))
  runtime.recentActivity.mockRejectedValue(new Error('The read could not be made.'))
  const m = await screen()
  m.q('rail-waiting').click()
  await expect.poll(() => runtime.recentActivity.mock.calls.length).toBeGreaterThan(0)
  await settle()
  expect(m.all('since-last-here')).toHaveLength(0)
  m.q('rail-away').click()
  await expect.poll(() => m.all('activity-not-read').length).toBe(1)
})

/** Every activity read waits until the test answers it, in the order they were asked. */
function heldReplies() {
  const waiting: ((value: RecentActivityReading) => void)[] = []
  runtime.recentActivity.mockImplementation(
    () =>
      new Promise((done) => {
        waiting.push(done)
      }),
  )
  return waiting
}

const H = 3_600_000

it('a reply for another window never speaks for the one chosen', async () => {
  const replies = heldReplies()
  const m = await screen()
  m.q('rail-away').click()
  await expect.poll(() => replies.length).toBe(1)
  replies[0]!(reading([]))
  await expect.poll(() => m.all('activity-empty').length).toBe(1)
  expect(m.q('activity-empty').textContent).toContain('12 hours')
  // The next window is chosen and its reply is still out: the 12-hour reading is not its.
  m.q(`activity-window-${String(7 * 24 * H)}`).click()
  await expect.poll(() => replies.length).toBe(2)
  await settle()
  expect(m.all('activity-empty')).toHaveLength(0)
  expect(m.all('activity-not-read')).toHaveLength(1)
  replies[1]!(reading([line('1', 'finished', 5)]))
  await expect.poll(() => m.all('activity-line').length).toBe(1)
})

it('an older reply arriving last is dropped, however the windows were chosen', async () => {
  const replies = heldReplies()
  const m = await screen()
  m.q('rail-away').click()
  await expect.poll(() => replies.length).toBe(1)
  m.q(`activity-window-${String(24 * H)}`).click()
  m.q(`activity-window-${String(12 * H)}`).click()
  await expect.poll(() => replies.length).toBe(3)
  replies[2]!(reading([line('1', 'finished', 5)]))
  await expect.poll(() => m.all('activity-line').length).toBe(1)
  // The 24-hour reply, then the first 12-hour one, both arrive after the newest.
  replies[1]!(reading([line('2', 'failed', 5), line('3', 'failed', 6)]))
  replies[0]!(reading([]))
  await settle()
  await settle()
  expect(m.all('activity-line')).toHaveLength(1)
  expect(m.all('activity-empty')).toHaveLength(0)
})

it('a reply for an earlier "last here" is dropped once the boundary moved', async () => {
  const first = Date.now() - 60 * MINUTE
  const later = Date.now() - 20 * MINUTE
  localStorage.setItem(LAST_SEEN, String(first))
  const replies = heldReplies()
  const m = await screen()
  m.q('rail-waiting').click()
  await expect.poll(() => replies.length).toBe(1)
  // Another window of the workspace moves the boundary while the first reply is out.
  localStorage.setItem(LAST_SEEN, String(later))
  window.dispatchEvent(new StorageEvent('storage', { key: LAST_SEEN }))
  await expect.poll(() => replies.length).toBe(2)
  expect(runtime.recentActivity.mock.calls.at(-1)![0].from).toBe(later)
  replies[1]!(reading([line('1', 'finished', 5)]))
  await expect.poll(() => m.all('since-line').length).toBe(1)
  replies[0]!(
    reading([line('2', 'finished', 30), line('3', 'failed', 40), line('4', 'failed', 50)]),
  )
  await settle()
  await settle()
  expect(m.all('since-line')).toHaveLength(1)
})

it('a page read still out when the person moves to Waiting on you starts no read for the box', async () => {
  localStorage.setItem(LAST_SEEN, String(Date.now() - 60 * MINUTE))
  const replies = heldReplies()
  const m = await screen()
  m.q('rail-away').click()
  await expect.poll(() => replies.length).toBe(1)
  m.q('rail-waiting').click()
  await expect.poll(() => replies.length).toBe(2)
  replies[1]!(reading([line('1', 'finished', 1)]))
  await expect.poll(() => m.all('since-line').length).toBe(1)
  // The page's reply arrives last: it asks for nothing more and changes nothing.
  replies[0]!(reading([]))
  await settle()
  await settle()
  expect(replies).toHaveLength(2)
  expect(m.all('since-line')).toHaveLength(1)
})
