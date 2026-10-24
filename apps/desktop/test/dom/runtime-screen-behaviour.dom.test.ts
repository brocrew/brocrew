import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { AttentionSignals, ATTENTION_SIGNAL_INTERVAL_MS } from '../../src/main/attention-signals'
import { isAttentionSignal, type AttentionSignal } from '../../src/shared/attention-signals'
import { useAttentionSignals } from '../../src/renderer/src/composables/useAttentionSignals'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import {
  chainReading,
  escalationChain,
  NOTHING_NAMED_THE_WORK,
  type PersonsQuestion,
  type RoutedRequest,
} from '../../src/shared/questions'
import type { WorkIncident } from '../../src/shared/work-incidents'
import RuntimeScreen from '../../src/renderer/src/components/RuntimeScreen.vue'
import { createSessionStore, type SessionStore } from '../../src/renderer/src/lib/session-store'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentities, RuntimeBridge, ResumedSession } from '../../src/shared/runtime-ipc'
import type { ResolvedMessageLink } from '../../src/renderer/src/lib/message-links'
import { idlePanel } from './sub-agents-idle-fixture'
import { drawnReady } from './drawn'
import { conv, forestOf, forestDrawn } from './forest-fixture'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { mount, unmountAll, META } from './harness'

// Provider setup has its own tests; this screen fixture never enters sign-in.
vi.mock('../../src/renderer/src/components/ProviderSetupAtLaunch.vue', () => ({
  default: { render: () => null },
}))

let sessions: SessionStore
let agentStore: ReturnType<typeof createAgentStore>
const changeListeners = new Set<Parameters<RuntimeBridge['onChanged']>[0]>()
const changed: Parameters<RuntimeBridge['onChanged']>[0] = (change) => {
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
  theWholeForest: vi.fn<RuntimeBridge['theWholeForest']>(async () => ({
    readAt: 1,
    nodes: forestWalk(),
    conversations: 0,
    heldByNoAgent: 0,
  })),
}

beforeEach(() => {
  vi.clearAllMocks()
  runtime.resolveLink.mockReset()
  runtime.latestHistory.mockReset()
  changeListeners.clear()
  runtime.whoCalledWhom.mockReset().mockRejectedValue(new Error('No relationship reading supplied'))
  useWhoCalledWhom().reading.value = null
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
})

/** The window's Back, in its top strip. */
const backOf = (screen: { q: (cy: string) => HTMLElement }): HTMLButtonElement =>
  screen.q('nav-back') as HTMLButtonElement

async function screenWithLink(target = 'W2.1', working = false) {
  runtime.attachOpen.mockResolvedValueOnce([
    {
      ...META,
      sessionId: 'fictional-source',
      handover: 'attached',
      history: {
        entries: [
          ...(working
            ? [{ ordinal: 0, at: 1, event: { type: 'status', state: 'working' } as never }]
            : []),
          {
            ordinal: working ? 1 : 0,
            at: 1,
            event: { type: 'assistant_message', text: target } as never,
          },
        ],
        from: 0,
        hasOlder: false,
        turnAligned: true,
      },
    },
  ])
  expect(await sessions.attachOpen()).toEqual(['fictional-source'])
  const screen = mount(RuntimeScreen, {})
  await expect.poll(() => screen.all('message-link').length).toBe(1)
  return screen
}

it('opens a resolved conversation and returns to the original message without sending or starting', async () => {
  runtime.resolveLink.mockResolvedValueOnce({
    state: 'available',
    kind: 'piece',
    title: 'Draft',
    status: 'Idle',
    opens: { sessionId: 'fictional-target' },
  })
  const screen = await screenWithLink()
  // A click reads again, after the preview lookup.
  runtime.resolveLink.mockResolvedValueOnce({
    state: 'available',
    kind: 'piece',
    title: 'Draft',
    status: 'Idle',
    opens: { sessionId: 'fictional-target' },
  })
  screen.q('message-link').click()
  await expect.poll(() => screen.all('message-link').length).toBe(0)
  expect(runtime.look).toHaveBeenCalledWith({ sessionId: 'fictional-target', claim: true })
  expect(backOf(screen).disabled).toBe(false)
  backOf(screen).click()
  await expect.poll(() => screen.all('message-link').length).toBe(1)
  expect(runtime.startAndSend).not.toHaveBeenCalled()
  expect(runtime.send).not.toHaveBeenCalled()
  expect(runtime.resume).not.toHaveBeenCalled()
})

it('opens archived history read-only, with a way back, and never calls look or a start', async () => {
  const archived: ResolvedMessageLink = {
    state: 'archived',
    kind: 'conversation',
    title: 'Archived draft',
    status: 'Archived',
    opens: { sessionId: 'fictional-archive' },
  }
  runtime.resolveLink.mockResolvedValueOnce(archived)
  const screen = await screenWithLink('[Older draft](brocrew://conversation/fictional-archive)')
  runtime.resolveLink.mockResolvedValueOnce(archived)
  screen.q('message-link').click()
  await expect.poll(() => screen.all('linked-history').length).toBe(1)
  expect(runtime.latestHistory).toHaveBeenCalledWith({ sessionId: 'fictional-archive' })
  expect(screen.q('linked-history').querySelector('textarea')).toBeNull()
  expect(screen.q('linked-history').textContent).toContain('Archived draft')
  expect(runtime.look).not.toHaveBeenCalled()
  expect(runtime.startAndSend).not.toHaveBeenCalled()
  expect(runtime.resume).not.toHaveBeenCalled()
  expect(runtime.send).not.toHaveBeenCalled()
  backOf(screen).click()
  await expect.poll(() => screen.all('linked-history').length).toBe(0)
  expect(screen.q('message-link').textContent).toBe('Older draft')
})

it.each(['source conversation', 'previous archive'])(
  'clears an archived conversation link failure when Back returns to the %s',
  async (returnsTo) => {
    const archive = (sessionId: string, title: string): ResolvedMessageLink => ({
      state: 'archived',
      kind: 'conversation',
      title,
      status: 'Archived',
      opens: { sessionId },
    })
    const first = archive('fictional-archive-a', 'Older draft')
    const second = archive('fictional-archive-b', 'Archived notes')
    const deleted: ResolvedMessageLink = {
      state: 'deleted',
      kind: 'piece',
      title: null,
      status: null,
      opens: null,
    }
    runtime.resolveLink.mockResolvedValueOnce(first).mockResolvedValueOnce(first)
    if (returnsTo === 'previous archive')
      runtime.resolveLink.mockResolvedValueOnce(second).mockResolvedValueOnce(second)
    runtime.resolveLink.mockResolvedValueOnce(deleted).mockResolvedValueOnce(deleted)
    if (returnsTo === 'previous archive')
      runtime.resolveLink.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const history = (text: string) => ({
      entries: [
        {
          ordinal: 0,
          at: 1,
          event: {
            type: 'assistant_message',
            text,
          } as never,
        },
      ],
      from: 0,
      hasOlder: false,
      turnAligned: true,
    })
    runtime.latestHistory.mockResolvedValueOnce(
      history(returnsTo === 'previous archive' ? 'W8.2' : 'W8.3'),
    )
    if (returnsTo === 'previous archive')
      runtime.latestHistory.mockResolvedValueOnce(history('W8.3'))
    const screen = await screenWithLink('W8.1')
    screen.q('message-link').click()
    await expect.poll(() => screen.q('linked-history').textContent).toContain('Older draft')
    const archiveLink = () =>
      screen.q('linked-history').querySelector<HTMLButtonElement>('[data-cy="message-link"]')!
    if (returnsTo === 'previous archive') {
      archiveLink().click()
      await expect.poll(() => screen.q('linked-history').textContent).toContain('Archived notes')
    }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    archiveLink().click()
    await expect.poll(() => screen.all('message-link-failure').length).toBe(1)
    expect(screen.q('message-link-failure').textContent).toContain('This work no longer exists.')
    backOf(screen).click()
    if (returnsTo === 'previous archive') {
      await expect.poll(() => screen.q('linked-history').textContent).toContain('Older draft')
    } else {
      await expect.poll(() => screen.all('linked-history').length).toBe(0)
      expect(screen.q('message-link').textContent).toBe('W8.1')
    }
    await nextTick()
    expect(screen.all('message-link-failure')).toHaveLength(0)
    expect(runtime.send).not.toHaveBeenCalled()
    expect(runtime.startAndSend).not.toHaveBeenCalled()
  },
)

it('opens an exact identity profile and its conversation shelf and can go back', async () => {
  const answer: ResolvedMessageLink = {
    state: 'available',
    kind: 'agent',
    title: 'Editor',
    status: 'Idle',
    opens: { identityId: 'agent:editor' },
  }
  runtime.resolveLink.mockResolvedValueOnce(answer)
  const screen = await screenWithLink('[Editor](brocrew://agent/agent%3Aeditor)')
  runtime.resolveLink.mockResolvedValueOnce(answer)
  screen.q('message-link').click()
  await expect.poll(() => screen.all('team-open-editor').length).toBe(1)
  expect(screen.q('team-name-editor').textContent).toBe('Editor')
  expect((screen.q('team-shelf-editor') as HTMLDetailsElement).open).toBe(true)
  expect(screen.q('team-shelf-editor').textContent).toContain(
    'No conversation on the list runs as it.',
  )
  backOf(screen).click()
  await expect.poll(() => screen.all('message-link').length).toBe(1)
  expect(runtime.look).not.toHaveBeenCalled()
  expect(runtime.send).not.toHaveBeenCalled()
})

it('follows a link out of archived history and returns through that history to the original message', async () => {
  const archive: ResolvedMessageLink = {
    state: 'archived',
    kind: 'piece',
    title: 'Archived draft',
    status: 'Archived',
    opens: { sessionId: 'fictional-archive' },
  }
  const target: ResolvedMessageLink = {
    state: 'available',
    kind: 'piece',
    title: 'Current draft',
    status: 'Idle',
    opens: { sessionId: 'fictional-target' },
  }
  runtime.resolveLink
    .mockResolvedValueOnce(archive)
    .mockResolvedValueOnce(archive)
    .mockResolvedValueOnce(target)
    .mockResolvedValueOnce(target)
    // Back to the archived page asks the host first whether it is still there.
    .mockResolvedValueOnce(archive)
  runtime.latestHistory.mockResolvedValueOnce({
    entries: [{ ordinal: 0, at: 1, event: { type: 'assistant_message', text: 'W8.2' } as never }],
    from: 0,
    hasOlder: false,
    turnAligned: true,
  })
  const screen = await screenWithLink('W8.1')
  screen.q('message-link').click()
  await expect.poll(() => screen.all('linked-history').length).toBe(1)
  const onward = screen
    .q('linked-history')
    .querySelector<HTMLButtonElement>('[data-cy="message-link"]')!
  await expect.poll(() => onward.dataset.linkState).toBe('available')
  onward.click()
  await expect.poll(() => screen.all('linked-history').length).toBe(0)
  expect(runtime.look).toHaveBeenCalledWith({ sessionId: 'fictional-target', claim: true })
  backOf(screen).click()
  await expect
    .poll(() => runtime.resolveLink.mock.calls.at(-1)?.[0])
    .toBe('brocrew://conversation/fictional-archive')
  await expect.poll(() => screen.all('linked-history').length).toBe(1)
  expect(screen.q('linked-history').textContent).toContain('Archived draft')
  expect(runtime.latestHistory).toHaveBeenCalledTimes(1)
  // The step ends once its page is drawn; a press before that is the same step's.
  await new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 0))),
  )
  backOf(screen).click()
  await expect.poll(() => screen.all('linked-history').length).toBe(0)
  expect(screen.q('message-link').textContent).toBe('W8.1')
  expect(backOf(screen).disabled).toBe(true)
  expect(runtime.resume).not.toHaveBeenCalled()
  expect(runtime.startAndSend).not.toHaveBeenCalled()
  expect(runtime.send).not.toHaveBeenCalled()
})

it('returns through a recorded conversation even after the window released its record', async () => {
  const a: ResolvedMessageLink = {
    state: 'available',
    kind: 'piece',
    title: 'Recorded A',
    status: 'Idle',
    opens: { sessionId: 'recorded-a' },
  }
  const b: ResolvedMessageLink = {
    state: 'available',
    kind: 'piece',
    title: 'Recorded B',
    status: 'Idle',
    opens: { sessionId: 'recorded-b' },
  }
  const handedA: ResumedSession = {
    ...META,
    sessionId: 'recorded-a',
    handover: 'recorded',
    history: {
      entries: [{ ordinal: 0, at: 1, event: { type: 'assistant_message', text: 'W9.2' } as never }],
      from: 0,
      hasOlder: false,
      turnAligned: true,
    },
  }
  runtime.look
    .mockResolvedValueOnce(handedA)
    .mockResolvedValueOnce({
      ...handedA,
      sessionId: 'recorded-b',
      history: { entries: [], from: 0, hasOlder: false, turnAligned: true },
    })
    .mockResolvedValueOnce(handedA)
  runtime.resolveLink
    .mockResolvedValueOnce(a)
    .mockResolvedValueOnce(a)
    .mockResolvedValueOnce(b)
    .mockResolvedValueOnce(b)
  const screen = await screenWithLink('W9.1')
  screen.q('message-link').click()
  await expect.poll(() => screen.all('message-link')[0]?.textContent).toBe('W9.2')
  await expect.poll(() => screen.q('message-link').dataset.linkState).toBe('available')
  screen.q('message-link').click()
  await expect.poll(() => sessions.get('recorded-a')).toBeNull()
  backOf(screen).click()
  await expect.poll(() => screen.all('message-link')[0]?.textContent).toBe('W9.2')
  expect(runtime.look).toHaveBeenCalledWith({ sessionId: 'recorded-a', claim: false })
  // The step ends once its page is drawn; a press before that is the same step's.
  await new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 0))),
  )
  backOf(screen).click()
  await expect.poll(() => screen.all('message-link')[0]?.textContent).toBe('W9.1')
  expect(runtime.resume).not.toHaveBeenCalled()
  expect(runtime.startAndSend).not.toHaveBeenCalled()
  expect(runtime.send).not.toHaveBeenCalled()
})

it('leaves a closed history page closed when a link look finishes late', async () => {
  const archive: ResolvedMessageLink = {
    state: 'archived',
    kind: 'piece',
    title: 'Archived draft',
    status: 'Archived',
    opens: { sessionId: 'fictional-archive' },
  }
  const target: ResolvedMessageLink = {
    state: 'available',
    kind: 'piece',
    title: 'Current draft',
    status: 'Idle',
    opens: { sessionId: 'fictional-target' },
  }
  runtime.resolveLink
    .mockResolvedValueOnce(archive)
    .mockResolvedValueOnce(archive)
    .mockResolvedValueOnce(target)
    .mockResolvedValueOnce(target)
  runtime.latestHistory.mockResolvedValueOnce({
    entries: [{ ordinal: 0, at: 1, event: { type: 'assistant_message', text: 'W8.2' } as never }],
    from: 0,
    hasOlder: false,
    turnAligned: true,
  })
  let finish!: (result: ResumedSession) => void
  runtime.look.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done
      }),
  )
  const screen = await screenWithLink('W8.1')
  screen.q('message-link').click()
  await expect.poll(() => screen.all('linked-history').length).toBe(1)
  const onward = screen
    .q('linked-history')
    .querySelector<HTMLButtonElement>('[data-cy="message-link"]')!
  await expect.poll(() => onward.dataset.linkState).toBe('available')
  onward.click()
  await expect.poll(() => runtime.look.mock.calls.length).toBe(1)
  backOf(screen).click()
  await expect.poll(() => screen.all('linked-history').length).toBe(0)
  finish({
    ...META,
    sessionId: 'fictional-target',
    handover: 'recorded',
    history: { entries: [], from: 0, hasOlder: false, turnAligned: true },
  })
  await expect.poll(() => onward.hasAttribute('aria-busy')).toBe(false)
  await nextTick()
  // Two reads of each link, and none after Back: Back keeps focus on its own button, not the link.
  expect(runtime.resolveLink).toHaveBeenCalledTimes(4)
  expect(screen.q('message-link').textContent).toBe('W8.1')
  expect(backOf(screen).disabled).toBe(true)
  expect(screen.all('message-link-failure')).toHaveLength(0)
})

it('Back from archived history returns to the working conversation without interrupting it', async () => {
  const archive: ResolvedMessageLink = {
    state: 'archived',
    kind: 'piece',
    title: 'Archived draft',
    status: 'Archived',
    opens: { sessionId: 'fictional-archive' },
  }
  runtime.resolveLink.mockResolvedValueOnce(archive).mockResolvedValueOnce(archive)
  const screen = await screenWithLink('W8.1', true)
  expect(sessions.get('fictional-source')?.control.status).toBe('working')
  screen.q('message-link').click()
  await expect.poll(() => screen.all('linked-history').length).toBe(1)
  backOf(screen).click()
  await expect.poll(() => screen.all('linked-history').length).toBe(0)
  expect(runtime.interrupt).not.toHaveBeenCalled()
  expect(runtime.send).not.toHaveBeenCalled()
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
  await expect.poll(() => runtime.interrupt.mock.calls.length).toBe(1)
  expect(runtime.interrupt).toHaveBeenCalledWith({ sessionId: 'fictional-source' })
})
afterEach(() => {
  applyTheme(null)
  unmountAll()
  sessions.dispose()
  vi.useRealTimers()
  useOverlays().close()
  localStorage.clear()
})

it('opens Team from the rail and reads its work only when that page is shown', async () => {
  const m = mount(RuntimeScreen, {})
  await nextTick()
  expect(runtime.theWholeForest).not.toHaveBeenCalled()
  m.q('rail-team').click()
  await expect.poll(() => m.all('team-workspace').length).toBe(1)
  await expect.poll(() => runtime.theWholeForest.mock.calls.length).toBe(1)
  expect(m.q('team-workspace').textContent).toContain('Team')
})

it('opens an agent sheet from Team and closes back to the same page', async () => {
  const m = mount(RuntimeScreen, {})
  m.q('rail-team').click()
  await expect.poll(() => m.all('team-open-editor').length).toBe(1)
  m.q('team-tab-roster').click()
  await nextTick()
  m.q('team-open-editor').click()
  await expect.poll(() => m.all('capabilities-sheet').length).toBe(1)
  expect(m.q('overlay-host').getAttribute('aria-label')).toBe('Editor')
  expect(m.q('capabilities-slug').textContent).toBe('editor')
  m.q('close-overlay').click()
  await nextTick()
  expect(m.all('overlay-host')).toHaveLength(0)
  expect(m.q('team-workspace')).toBeTruthy()
})

it('opens the create-agent form from Team and cancels without creating an agent', async () => {
  const m = mount(RuntimeScreen, {})
  m.q('rail-team').click()
  await nextTick()
  m.q('team-create').click()
  await nextTick()
  expect(m.q('new-agent-create').hasAttribute('disabled')).toBe(true)
  m.q('new-agent-cancel').click()
  await nextTick()
  expect(m.all('new-agent')).toHaveLength(0)
  expect(m.q('team-workspace')).toBeTruthy()
})

it('refreshes Team after work changes and stops requesting its forest on another page', async () => {
  const m = mount(RuntimeScreen, {})
  m.q('rail-team').click()
  await expect.poll(() => m.all('forest-empty').length).toBe(1)
  runtime.theWholeForest.mockResolvedValueOnce({
    readAt: 2,
    nodes: forestWalk(),
    conversations: 0,
    heldByNoAgent: 7,
  })
  changed({ what: 'work' })
  await expect.poll(() => m.all('forest-outside')[0]?.textContent).toContain('7 more conversations')
  m.q('new-conversation').click()
  await nextTick()
  const reads = runtime.theWholeForest.mock.calls.length
  changed({ what: 'work' })
  await nextTick()
  expect(runtime.theWholeForest).toHaveBeenCalledTimes(reads)
  expect(m.all('team-workspace')).toHaveLength(0)
  expect(m.q('prompt-input')).toBeTruthy()
})

it('shows a failed startup read without hiding the successful app information', async () => {
  runtime.capabilities.mockRejectedValueOnce(new Error('The capability list could not be read'))
  const m = mount(RuntimeScreen, {})
  await expect
    .poll(() => m.all('startup-error')[0]?.textContent)
    .toContain('The capability list could not be read')
  expect(m.q('window-title').textContent).toContain('Fictional BroBot')
  m.q('rail-team').click()
  await expect.poll(() => m.all('team-workspace').length).toBe(1)
})

it('says the forest could not be read instead of displaying an empty Team', async () => {
  runtime.theWholeForest.mockRejectedValueOnce(new Error('The work ledger is unavailable'))
  const m = mount(RuntimeScreen, {})
  m.q('rail-team').click()
  await expect.poll(() => runtime.theWholeForest.mock.calls.length).toBe(1)
  await nextTick()
  expect(m.q('forest-not-read').textContent).toContain('Nothing has been read')
  expect(m.all('forest-empty')).toHaveLength(0)
})

it('keeps the launcher open when a Team read finishes after the person leaves', async () => {
  let finish!: (answer: Awaited<ReturnType<typeof runtime.theWholeForest>>) => void
  runtime.theWholeForest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const m = mount(RuntimeScreen, {})
  m.q('rail-team').click()
  await expect.poll(() => runtime.theWholeForest.mock.calls.length).toBe(1)
  m.q('new-conversation').click()
  await nextTick()
  finish({ readAt: 3, nodes: forestWalk(), conversations: 0, heldByNoAgent: 9 })
  await nextTick()
  await nextTick()
  expect(m.q('prompt-input')).toBeTruthy()
  expect(m.all('team-workspace')).toHaveLength(0)
  expect(m.all('forest-outside')).toHaveLength(0)
})

it('keeps the stop-spawning switch usable while an agent form is open', async () => {
  const m = mount(RuntimeScreen, {})
  m.q('rail-team').click()
  await expect.poll(() => m.all('team-open-editor').length).toBe(1)
  m.q('team-create').click()
  await nextTick()
  expect(m.q('overlay-spawning').getAttribute('aria-pressed')).toBe('true')
  m.q('overlay-spawning').click()
  await expect.poll(() => m.q('overlay-spawning').getAttribute('aria-pressed')).toBe('false')
  expect(runtime.setSpawningEnabled).toHaveBeenCalledWith({ enabled: false })
  expect(m.q('new-agent')).toBeTruthy()
  m.q('new-agent-cancel').click()
  await nextTick()
})

it('preserves an unsent draft when the new-conversation shortcut returns from Team', async () => {
  const m = mount(RuntimeScreen, {})
  const box = m.q('prompt-input') as HTMLTextAreaElement
  box.value = 'Please review this fictional draft'
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  m.q('rail-team').click()
  await nextTick()
  expect(m.q('team-workspace')).toBeTruthy()
  const key = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, cancelable: true })
  window.dispatchEvent(key)
  await nextTick()
  expect(key.defaultPrevented).toBe(true)
  expect((m.q('prompt-input') as HTMLTextAreaElement).value).toBe(
    'Please review this fictional draft',
  )
  expect(m.all('team-workspace')).toHaveLength(0)
})

it('paints a theme’s window background behind everything, and the app’s own without one', async () => {
  const m = mount(RuntimeScreen, {})
  await nextTick()
  const app = m.host.querySelector('.app')!
  const own = getComputedStyle(app).backgroundColor
  expect(getComputedStyle(app).backgroundImage).toBe('none')
  applyTheme({
    format: 1,
    id: 'night-window',
    name: 'Night window',
    window: {
      background: {
        color: '#0b1020',
        layers: [
          {
            gradient: {
              type: 'linear',
              angle: 180,
              stops: [
                { color: '#0b1020', at: 0 },
                { color: '#1b2a4a', at: 100 },
              ],
            },
          },
        ],
      },
    },
  })
  expect(getComputedStyle(app).backgroundColor).toBe('rgb(11, 16, 32)')
  expect(getComputedStyle(app).backgroundImage).toMatch(
    /^linear-gradient\(rgb\(11, 16, 32\) 0%, rgb\(27, 42, 74\) 100%\)$/,
  )
  applyTheme(null)
  expect(getComputedStyle(app).backgroundColor).toBe(own)
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

async function panelScreen(withSecond = false) {
  runtime.attachOpen.mockResolvedValueOnce([
    ...(withSecond
      ? [
          {
            ...META,
            sessionId: 'fictional-target',
            handover: 'attached' as const,
            history: { entries: [], from: 0, hasOlder: false, turnAligned: true },
          },
        ]
      : []),
    {
      ...META,
      sessionId: 'fictional-source',
      handover: 'attached',
      history: { entries: [], from: 0, hasOlder: false, turnAligned: true },
    },
  ])
  await sessions.attachOpen()
  const screen = mount(RuntimeScreen, {})
  screen.q('new-conversation').click()
  await nextTick()
  screen.q('nav-back').click()
  return screen
}
function panelRead(count = 1) {
  const read = idlePanel(count).reading.read
  return { ...read, conversation: 'fictional-source' }
}

it.each(['activity', 'forest'] as const)(
  'shows the first relationship answer before slow %s finishes',
  async (slow) => {
    const answer = deferred<Awaited<ReturnType<RuntimeBridge['whoCalledWhom']>>>()
    const activity = deferred<Awaited<ReturnType<RuntimeBridge['whatIsBeingDone']>>>()
    const forest = deferred<Awaited<ReturnType<RuntimeBridge['theWholeForest']>>>()
    runtime.whoCalledWhom.mockReturnValueOnce(answer.promise)
    runtime.whatIsBeingDone.mockImplementationOnce(() =>
      slow === 'activity' ? activity.promise : Promise.resolve({ readAt: 2, conversations: [] }),
    )
    runtime.theWholeForest.mockImplementationOnce(() =>
      slow === 'forest'
        ? forest.promise
        : Promise.resolve({ readAt: 2, nodes: forestWalk(), conversations: 0, heldByNoAgent: 0 }),
    )
    const screen = await panelScreen()
    try {
      await expect.poll(() => screen.all('cast-loading').length).toBe(1)
      expect(screen.q('cast-loading').getAttribute('role')).toBe('status')
      expect(screen.all('cast-not-read')).toHaveLength(0)
      expect(screen.all('cast-sub-agents')).toHaveLength(0)
      answer.resolve(panelRead())
      await expect.poll(() => screen.all('cast-sub-agents').length).toBe(1)
      expect(screen.all('cast-loading')).toHaveLength(0)
      expect(screen.all('cast-not-read')).toHaveLength(0)
      expect(screen.q('cast-sub-agents').querySelector('.count')?.textContent).toBe('(1)')
      expect(useWhoCalledWhom().reading.value?.answered).toBe(true)
      expect(runtime.whoCalledWhom).toHaveBeenCalledTimes(1)
    } finally {
      activity.resolve({ readAt: 3, conversations: [] })
      forest.resolve({ readAt: 3, nodes: forestWalk(), conversations: 0, heldByNoAgent: 0 })
    }
    await expect
      .poll(() => useWhoCalledWhom().reading.value?.atWork?.readAt)
      .toBe(slow === 'activity' ? 3 : 2)
  },
)

it('ends first-read loading on a refusal and keeps the unread line distinct from a real empty answer', async () => {
  const answer = deferred<Awaited<ReturnType<RuntimeBridge['whoCalledWhom']>>>()
  runtime.whoCalledWhom.mockReturnValueOnce(answer.promise)
  const screen = await panelScreen()
  await expect.poll(() => screen.all('cast-loading').length).toBe(1)
  // The bridge rejects; the session store returns null, rather than an invented empty list.
  runtime.whoCalledWhom.mockRejectedValueOnce(new Error('fictional read refused'))
  changed({ what: 'work' })
  await expect.poll(() => screen.all('cast-not-read').length).toBe(1)
  expect(screen.all('cast-loading')).toHaveLength(0)
  expect(screen.all('cast-children-empty')).toHaveLength(0)
  answer.resolve(panelRead())
  await drawnReady()
  expect(screen.all('cast-not-read')).toHaveLength(1)
  runtime.whoCalledWhom.mockResolvedValueOnce(panelRead(0))
  changed({ what: 'work' })
  await expect.poll(() => screen.all('cast-children-empty').length).toBe(1)
  expect(screen.all('cast-loading')).toHaveLength(0)
  expect(screen.all('cast-not-read')).toHaveLength(0)
})

it('ignores old graph and activity refinements after a newer relationship reading', async () => {
  const oldActivity = deferred<Awaited<ReturnType<RuntimeBridge['whatIsBeingDone']>>>()
  const oldForest = deferred<Awaited<ReturnType<RuntimeBridge['theWholeForest']>>>()
  runtime.whoCalledWhom.mockResolvedValueOnce(panelRead())
  runtime.whatIsBeingDone.mockReturnValueOnce(oldActivity.promise)
  runtime.theWholeForest.mockReturnValueOnce(oldForest.promise)
  const screen = await panelScreen()
  try {
    await expect.poll(() => screen.all('cast-sub-agents').length).toBe(1)
    runtime.whoCalledWhom.mockResolvedValueOnce(panelRead(2))
    runtime.whatIsBeingDone.mockResolvedValueOnce({ readAt: 200, conversations: [] })
    runtime.theWholeForest.mockResolvedValueOnce({
      readAt: 200,
      nodes: forestWalk(),
      conversations: 0,
      heldByNoAgent: 0,
    })
    changed({ what: 'work' })
    await expect.poll(() => useWhoCalledWhom().reading.value?.atWork?.readAt).toBe(200)
    expect(screen.q('cast-sub-agents').querySelector('.count')?.textContent).toBe('(2)')
    oldActivity.resolve({ readAt: 100, conversations: [] })
    oldForest.resolve({ readAt: 100, nodes: forestWalk(), conversations: 0, heldByNoAgent: 0 })
    await drawnReady()
    expect(useWhoCalledWhom().forest.value?.readAt).toBe(200)
    expect(useWhoCalledWhom().reading.value?.atWork?.readAt).toBe(200)
  } finally {
    oldActivity.resolve({ readAt: 100, conversations: [] })
    oldForest.resolve({ readAt: 100, nodes: forestWalk(), conversations: 0, heldByNoAgent: 0 })
  }
})

it.each(['B', 'A'] as const)(
  'keeps A’s late answer out of a direct A→B→A switch when it arrives on %s',
  async (arrival) => {
    const firstA = deferred<Awaited<ReturnType<RuntimeBridge['whoCalledWhom']>>>()
    const secondA = deferred<Awaited<ReturnType<RuntimeBridge['whoCalledWhom']>>>()
    const answerB = deferred<Awaited<ReturnType<RuntimeBridge['whoCalledWhom']>>>()
    let readsA = 0
    runtime.whoCalledWhom.mockImplementation(({ sessionId }) => {
      if (sessionId === 'fictional-source') return ++readsA === 1 ? firstA.promise : secondA.promise
      if (sessionId === 'fictional-target') return answerB.promise
      throw new Error('Unexpected fictional conversation')
    })
    const screen = await panelScreen(true)
    const a1 = { ...panelRead(1), readAt: 100 }
    const a2 = { ...panelRead(3), readAt: 300 }
    const b = { ...panelRead(2), conversation: 'fictional-target', readAt: 200 }
    const count = () => screen.q('cast-sub-agents').querySelector('.count')?.textContent
    try {
      await expect.poll(() => readsA).toBe(1)
      expect(screen.all('cast-loading')).toHaveLength(1)
      screen.q('open-session-fictional-target').click()
      await expect.poll(() => useWhoCalledWhom().loadingFor.value).toBe('fictional-target')
      answerB.resolve(b)
      await expect
        .poll(() => useWhoCalledWhom().reading.value?.conversation)
        .toBe('fictional-target')
      expect(count()).toBe('(2)')
      if (arrival === 'B') {
        firstA.resolve(a1)
        await drawnReady()
        expect(useWhoCalledWhom().reading.value?.conversation).toBe('fictional-target')
        expect(useWhoCalledWhom().reading.value?.read.readAt).toBe(200)
        expect(count()).toBe('(2)')
      }
      screen.q('open-session-fictional-source').click()
      await expect.poll(() => readsA).toBe(2)
      expect(screen.all('cast-loading')).toHaveLength(1)
      secondA.resolve(a2)
      await expect.poll(() => useWhoCalledWhom().reading.value?.read.readAt).toBe(300)
      expect(count()).toBe('(3)')
      if (arrival === 'A') {
        firstA.resolve(a1)
        await drawnReady()
      }
      expect(useWhoCalledWhom().reading.value?.conversation).toBe('fictional-source')
      expect(useWhoCalledWhom().reading.value?.read.readAt).toBe(300)
      expect(count()).toBe('(3)')
      expect(runtime.whoCalledWhom.mock.calls.map(([input]) => input.sessionId)).toEqual([
        'fictional-source',
        'fictional-target',
        'fictional-source',
      ])
      expect(runtime.send).not.toHaveBeenCalled()
      expect(runtime.resume).not.toHaveBeenCalled()
      expect(runtime.startAndSend).not.toHaveBeenCalled()
    } finally {
      firstA.resolve(a1)
      secondA.resolve(a2)
      answerB.resolve(b)
    }
  },
)

it('keeps Graph unread until the independent forest arrives, then draws the current tree', async () => {
  useWhoCalledWhom().forest.value = null
  const forest = deferred<Awaited<ReturnType<RuntimeBridge['theWholeForest']>>>()
  const complete = forestOf([
    conv('fictional-source', null, { identity: 'editor' }),
    conv('fictional-reader-1', 'fictional-source', { identity: 'reader-1' }),
  ])
  runtime.whoCalledWhom.mockResolvedValueOnce(panelRead())
  runtime.theWholeForest.mockReturnValueOnce(forest.promise)
  const screen = await panelScreen()
  try {
    await expect.poll(() => screen.all('cast-sub-agents').length).toBe(1)
    expect(useWhoCalledWhom().forest.value).toBeNull()
    screen.q('main-tab-graph').click()
    await forestDrawn()
    expect(screen.all('forest-not-read')).toHaveLength(1)
    expect(screen.all('forest-row-fictional-source')).toHaveLength(0)
    forest.resolve(complete)
    await expect.poll(() => screen.all('forest-row-fictional-source').length).toBe(1)
    await forestDrawn()
    expect(screen.all('forest-not-read')).toHaveLength(0)
    expect(screen.all('forest-row-fictional-reader-1')).toHaveLength(1)
    expect(screen.q('forest-row-fictional-source').dataset.current).toBe('true')
    expect(runtime.theWholeForest).toHaveBeenCalledTimes(1)
    expect(runtime.send).not.toHaveBeenCalled()
    expect(runtime.resume).not.toHaveBeenCalled()
  } finally {
    forest.resolve(complete)
  }
})

it('reads the two file lists once per conversation opening, including mount', async () => {
  runtime.resolveLink.mockResolvedValueOnce({
    state: 'available',
    kind: 'piece',
    title: 'Target',
    status: 'Idle',
    opens: { sessionId: 'fictional-target' },
  })
  const screen = await screenWithLink()
  await expect.poll(() => runtime.filesKept.mock.calls.length).toBe(1)
  expect(runtime.filesKept).toHaveBeenCalledWith({
    scope: 'tree',
    conversation: 'fictional-source',
    withAdded: true,
  })
  runtime.resolveLink.mockResolvedValueOnce({
    state: 'available',
    kind: 'piece',
    title: 'Target',
    status: 'Idle',
    opens: { sessionId: 'fictional-target' },
  })
  screen.q('message-link').click()
  await expect.poll(() => runtime.filesKept.mock.calls.length).toBe(2)
  expect(runtime.filesKept).toHaveBeenLastCalledWith({
    scope: 'tree',
    conversation: 'fictional-target',
    withAdded: true,
  })
  await nextTick()
  expect(runtime.filesKept.mock.calls).toHaveLength(2)
})

it('retries a failed paired file read on the next work notice', async () => {
  await screenWithLink()
  await expect.poll(() => runtime.filesKept.mock.calls.length).toBe(1)
  const previous = useWhoCalledWhom().treeFiles.value?.files
  runtime.filesKept.mockRejectedValueOnce(new Error('fictional read failure'))
  changed({ what: 'work' })
  await expect.poll(() => useWhoCalledWhom().treeFiles.value?.answered).toBe(false)
  expect(runtime.filesKept.mock.calls).toHaveLength(2)
  expect(useWhoCalledWhom().treeFiles.value?.files).toEqual(previous)
  changed({ what: 'work' })
  await expect.poll(() => runtime.filesKept.mock.calls.length).toBe(3)
  await expect.poll(() => useWhoCalledWhom().treeFiles.value?.answered).toBe(true)
})

function deferredAttentionRead<T>() {
  let complete: (value: T) => void = () => {
    throw new Error('Deferred not initialized.')
  }
  const promise = new Promise<T>((resolve) => {
    complete = resolve
  })
  return { promise, resolve: (value: T) => complete(value) }
}

function todoQuestion(id: string): PersonsQuestion {
  const request: RoutedRequest = {
    requestId: id,
    askedBy: 'fictional-requester',
    parent: null,
    went: { is: 'the-person-the-asker-named', to: 'a-person' },
    at: 1,
    state: 'open',
    endedAt: null,
    escalatedAt: null,
  }
  const chain = escalationChain(request, () => null)
  return {
    request,
    chain,
    reading: chainReading(chain, () => 'A fictional agent'),
    sentence: 'An agent asks for a fictional action.',
    aPersonsSince: 1,
    work: [],
    about: NOTHING_NAMED_THE_WORK,
    raisedBy: 'the-provider',
    offered: null,
    asked: null,
    action: { text: 'Do a fictional action.', files: [] },
  }
}

function incident(id: string): WorkIncident {
  return {
    piece: id,
    label: 'W1',
    title: 'Fictional work',
    holder: 'fictional-holder',
    holderName: 'An agent',
    giver: null,
    giverName: null,
    kind: 'stopped',
    since: 1,
  }
}

function nativeAttention(platform = 'darwin') {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  let now = 0
  const effects = {
    platform,
    isFocused: vi.fn(() => false),
    badge: vi.fn(),
    bounce: vi.fn(() => 7),
    cancelBounce: vi.fn(),
    flash: vi.fn(),
    overlay: vi.fn(),
  }
  const native = new AttentionSignals(effects, () => now)
  const packets: AttentionSignal[] = []
  window.api = {
    ...window.api,
    attentionSignals: async (packet: AttentionSignal) => {
      if (!isAttentionSignal(packet)) throw new Error('Invalid attention signal.')
      packets.push(packet)
      native.update(packet)
    },
  }
  return {
    effects,
    native,
    packets,
    advance: () => {
      now += ATTENTION_SIGNAL_INTERVAL_MS
    },
    summons: () =>
      platform === 'darwin'
        ? effects.bounce.mock.calls.length
        : effects.flash.mock.calls.filter(([on]) => on === true).length,
  }
}

async function nextAttentionPoll() {
  await vi.advanceTimersByTimeAsync(5_000)
  await nextTick()
}

async function badgeAt(native: ReturnType<typeof nativeAttention>, count: number) {
  await expect.poll(() => native.packets.at(-1)?.count, { timeout: 750 }).toBe(count)
}

it.each(['darwin', 'win32'])(
  'real screen packets cannot replay a summons on %s',
  async (platform) => {
    const native = nativeAttention(platform)
    runtime.workIncidentsForAPerson.mockResolvedValue({ ...walk(), rows: [incident('old')] })
    mount(RuntimeScreen, {})
    await badgeAt(native, 1)
    expect(native.summons()).toBe(0)
    runtime.workIncidentsForAPerson.mockResolvedValue({ ...walk(), rows: [incident('new')] })
    native.advance()
    await nextAttentionPoll()
    await expect.poll(native.summons, { timeout: 750 }).toBe(1)
    const packet = native.packets.at(-1)
    if (packet === undefined) throw new Error('The screen did not publish an arrival.')
    for (let repeat = 0; repeat < 3; repeat++) {
      native.advance()
      await window.api.attentionSignals(packet)
    }
    expect(native.summons()).toBe(1)
  },
)

it.each(['todos', 'incidents'] as const)(
  'launch and reload baseline existing %s from the real queue silently',
  async (kind) => {
    const native = nativeAttention()
    const oldQuestions = { ...walk(), rows: kind === 'todos' ? [todoQuestion('old')] : [] }
    const oldIncidents = { ...walk(), rows: kind === 'incidents' ? [incident('old')] : [] }
    for (let life = 0; life < 2; life++) {
      const questions =
        deferredAttentionRead<Awaited<ReturnType<RuntimeBridge['questionsForAPerson']>>>()
      const incidents =
        deferredAttentionRead<Awaited<ReturnType<RuntimeBridge['workIncidentsForAPerson']>>>()
      runtime.questionsForAPerson
        .mockResolvedValue(oldQuestions)
        .mockReturnValueOnce(questions.promise)
      runtime.workIncidentsForAPerson
        .mockResolvedValue(oldIncidents)
        .mockReturnValueOnce(incidents.promise)
      const screen = mount(RuntimeScreen, {})
      await badgeAt(native, 0)
      // These are the real queue's initial flags; neither means a successful read happened.
      expect(usePersonsQueue().workWaits.value.todos.unread).toBe(false)
      expect(usePersonsQueue().workWaits.value.incidents.unread).toBe(false)
      questions.resolve(oldQuestions)
      incidents.resolve(oldIncidents)
      await badgeAt(native, 1)
      expect(native.summons()).toBe(life)
      if (kind === 'todos') {
        runtime.questionsForAPerson.mockResolvedValue({
          ...walk(),
          rows: [todoQuestion('old'), todoQuestion('new')],
        })
      } else {
        runtime.workIncidentsForAPerson.mockResolvedValue({
          ...walk(),
          rows: [incident('old'), incident('new')],
        })
      }
      native.advance()
      await nextAttentionPoll()
      await badgeAt(native, 2)
      expect(native.summons()).toBe(life + 1)
      screen.unmount()
      native.native.reloaded()
    }
  },
)

it('two consecutive same-count replacements reach native through the real screen, while unchanged reads stay quiet', async () => {
  const native = nativeAttention()
  runtime.workIncidentsForAPerson.mockResolvedValue({ ...walk(), rows: [incident('a')] })
  mount(RuntimeScreen, {})
  await badgeAt(native, 1)
  const baseline = native.packets.at(-1)?.arrival ?? -1
  for (const id of ['b', 'c']) {
    native.advance()
    runtime.workIncidentsForAPerson.mockResolvedValue({ ...walk(), rows: [incident(id)] })
    await nextAttentionPoll()
  }
  await expect.poll(native.summons, { timeout: 750 }).toBe(2)
  const arrivals = native.packets.filter((packet) => packet.arrival > baseline)
  expect(arrivals).toHaveLength(2)
  expect(arrivals[0]?.arrival).toBeLessThan(arrivals[1]?.arrival ?? -1)
  const calls = native.packets.length
  await nextAttentionPoll()
  expect(native.packets).toHaveLength(calls)
  expect(native.summons()).toBe(2)
})

it('a focused same-count replacement cannot hide the next unfocused arrival', async () => {
  const native = nativeAttention()
  runtime.workIncidentsForAPerson.mockResolvedValue({ ...walk(), rows: [incident('a')] })
  mount(RuntimeScreen, {})
  await badgeAt(native, 1)
  native.effects.isFocused.mockReturnValue(true)
  runtime.workIncidentsForAPerson.mockResolvedValue({ ...walk(), rows: [incident('b')] })
  await nextAttentionPoll()
  expect(native.summons()).toBe(0)
  native.effects.isFocused.mockReturnValue(false)
  runtime.workIncidentsForAPerson.mockResolvedValue({ ...walk(), rows: [incident('c')] })
  await nextAttentionPoll()
  await expect.poll(native.summons, { timeout: 750 }).toBe(1)
})
