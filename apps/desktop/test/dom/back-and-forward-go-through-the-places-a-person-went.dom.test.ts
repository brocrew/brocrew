import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { fictionalSkills } from '../../look/fixtures/skills'
import RuntimeScreen from '../../src/renderer/src/components/RuntimeScreen.vue'
import { createSessionStore, type SessionStore } from '../../src/renderer/src/lib/session-store'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentities, RuntimeBridge, ResumedSession } from '../../src/shared/runtime-ipc'
import type { ResolvedMessageLink } from '../../src/renderer/src/lib/message-links'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { mount, unmountAll, META } from './harness'

// The computer the window runs on, set by each test rather than read from the runner's.
const here = vi.hoisted(() => ({ platform: 'MacIntel' }))
vi.mock('../../src/renderer/src/lib/this-computer', async (original) => ({
  ...(await original<typeof import('../../src/renderer/src/lib/this-computer')>()),
  platformHere: () => here.platform,
}))

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
  skills: vi.fn<RuntimeBridge['skills']>(fictionalSkills().bridge),
  onEvent: vi.fn(() => () => {}),
  onLiveness: vi.fn(() => () => {}),
  onChanged: vi.fn((listener: Parameters<RuntimeBridge['onChanged']>[0]) => {
    hostSaysChanged = listener
    return () => {}
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
  providerVersions: vi.fn(async () => ({
    claude: { version: null, reason: 'No version in this fixture.' },
    codex: { version: null, reason: 'No version in this fixture.' },
  })),
  providerSetup: vi.fn(async () => ({})),
  providerUsage: vi.fn(async () => ({ claude: [], codex: [] })),
  providerResources: vi.fn(async () => ({
    claude: { running: 0, at: 1, rssBytes: 0, cpuPercent: 0 },
    codex: { running: 0, at: 1, rssBytes: 0, cpuPercent: 0 },
  })),
  onProvidersChanged: vi.fn(() => () => {}),
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
  runtime.resolveLink.mockImplementation(async () => ({
    state: 'unavailable',
    kind: 'piece',
    title: null,
    status: null,
    opens: null,
  }))
  runtime.look.mockImplementation(async ({ sessionId }): Promise<ResumedSession> => ({
    ...META,
    sessionId,
    handover: 'recorded',
    history: { entries: [], from: 0, hasOlder: false, turnAligned: true },
  }))
  runtime.latestHistory.mockImplementation(async () => ({
    entries: [],
    from: 0,
    hasOlder: false,
    turnAligned: true,
  }))
  runtime.agentIdentities.mockImplementation(async () => agents)
  here.platform = 'MacIntel'
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
    onNavigate: (listener: (direction: 'back' | 'forward') => void) => {
      navigateListener = listener
      return () => (navigateListener = null)
    },
  } as unknown as Window['api']
  sessions = createSessionStore(window.api.runtime as RuntimeBridge)
  agentStore = createAgentStore(window.api.runtime)
})

let hostSaysChanged: Parameters<RuntimeBridge['onChanged']>[0] | null = null
let navigateListener: ((direction: 'back' | 'forward') => void) | null = null

/**
 * Back and Forward through the places a person went in this window: screens, conversations with
 * their tab, a profile. Shown as two small arrows in the window's top strip, moved by ⌘[ and ⌘], a
 * mouse's side buttons, and what main hears (a trackpad swipe, a Windows Back key). Going there
 * again only reads; a popup holds the keys while it is open.
 */

afterEach(() => {
  // What a test told the host to answer goes back to the fixture's own answers.
  for (const one of [
    runtime.resolveLink,
    runtime.look,
    runtime.latestHistory,
    runtime.agentIdentities,
  ])
    one.mockReset()
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

/** The screen, showing one conversation with `messages` lines, and its Back and Forward. */
async function screen(messages = 1) {
  runtime.attachOpen.mockResolvedValueOnce([
    {
      ...META,
      sessionId: 'fictional-source',
      handover: 'attached',
      history: {
        entries: Array.from({ length: messages }, (_, ordinal) => ({
          ordinal,
          at: 1 + ordinal,
          event: {
            type: 'assistant_message',
            text: `A fictional line of the conversation, number ${String(ordinal + 1)}, long enough to wrap.`,
          } as never,
        })),
        from: 0,
        hasOlder: false,
        turnAligned: true,
      },
    },
  ])
  await sessions.attachOpen()
  const m = mount(RuntimeScreen, {}, { width: 1200, height: 800 })
  await expect.poll(() => m.all('main-tab-conversation').length).toBe(1)
  await settle()
  const back = () => m.q('nav-back') as HTMLButtonElement
  const forward = () => m.q('nav-forward') as HTMLButtonElement
  const press = async (cy: string) => {
    m.q(cy).click()
    await settle()
  }
  const on = (cy: string) => m.all(cy).length === 1
  return { m, back, forward, press, on }
}

const key = async (which: '[' | ']') => {
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: which,
      code: which === '[' ? 'BracketLeft' : 'BracketRight',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }),
  )
  await settle()
}

it('the arrows sit in the top strip, out of its drag region, and start with nowhere to go', async () => {
  const { m, back, forward } = await screen()
  expect(m.q('app-titlebar').contains(back())).toBe(true)
  expect(back().disabled).toBe(true)
  expect(forward().disabled).toBe(true)
  expect(getComputedStyle(back()).getPropertyValue('-webkit-app-region').trim()).toBe('no-drag')
  expect(back().title).toBe('Back (⌘[)')
  expect(m.all('message-link-back')).toHaveLength(0)
})

it.each(['Win32', 'Linux x86_64'])(
  'on %s the keys are Alt+← and Alt+→, and the titles say so',
  async (platform) => {
    here.platform = platform
    const { back, forward, on, press } = await screen()
    expect(back().title).toBe('Back (Alt+←)')
    await press('rail-waiting')
    await press('rail-team')
    expect(back().title).toBe('Back to Waiting on you (Alt+←)')
    await key('[')
    expect(on('team-workspace')).toBe(true)
    const alt = async (key: 'ArrowLeft' | 'ArrowRight') => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }),
      )
      await settle()
    }
    await alt('ArrowLeft')
    expect(on('waiting-on-you')).toBe(true)
    expect(forward().title).toBe('Forward to Team (Alt+→)')
    await alt('ArrowRight')
    expect(on('team-workspace')).toBe(true)
  },
)

it('walks screens and a conversation back and forward, naming where each goes', async () => {
  const { back, forward, press, on } = await screen()
  await press('rail-waiting')
  await press('rail-team')
  expect(back().title).toBe('Back to Waiting on you (⌘[)')
  await press('nav-back')
  expect(on('waiting-on-you')).toBe(true)
  expect(forward().title).toBe('Forward to Team (⌘])')
  await press('nav-back')
  expect(on('main-tab-conversation')).toBe(true)
  expect(back().disabled).toBe(true)
  await press('nav-forward')
  expect(on('waiting-on-you')).toBe(true)
  // A new place clears what Forward would return to.
  await press('rail-settings')
  expect(forward().disabled).toBe(true)
  expect(runtime.send).not.toHaveBeenCalled()
  expect(runtime.resume).not.toHaveBeenCalled()
  expect(runtime.startAndSend).not.toHaveBeenCalled()
})

it('a conversation’s tab is part of its place: kept, and never a step of its own', async () => {
  const { m, back, press } = await screen()
  await press('main-tab-graph')
  await press('main-tab-files')
  await press('rail-team')
  await press('nav-back')
  expect(m.q('main-tab-files').getAttribute('aria-selected')).toBe('true')
  // The two tab presses recorded nothing: the conversation is still the first place.
  expect(back().disabled).toBe(true)
})

it('Settings tabs stay in one history place and Back returns to the conversation', async () => {
  const { m, back, forward, press, on } = await screen()
  await press('rail-settings')
  expect(on('settings-screen')).toBe(true)
  expect(m.q('settings-tab-providers').getAttribute('aria-selected')).toBe('true')
  await press('settings-tab-tools')
  expect(on('tools-register')).toBe(true)
  await press('settings-tab-skills')
  expect(on('skills-section')).toBe(true)
  expect(m.all('skill-row')).toHaveLength(2)
  expect(m.all('skill-detail')).toHaveLength(2)
  for (const detail of m.all('skill-detail')) {
    expect(detail.querySelector('summary')?.textContent).toBe('Skill text')
    ;(detail as HTMLDetailsElement).open = true
    expect(detail.querySelector('[data-cy="skill-source"]')?.textContent).toContain(
      'Check the flour',
    )
  }
  await press('settings-tab-general')
  expect(on('attention-signals-switch')).toBe(true)
  expect(back().title).toContain('Back to')
  await press('nav-back')
  expect(on('main-tab-conversation')).toBe(true)
  expect(back().disabled).toBe(true)
  await press('nav-forward')
  expect(on('settings-screen')).toBe(true)
  expect(m.q('settings-tab-general').getAttribute('aria-selected')).toBe('true')
  expect(forward().disabled).toBe(true)
})

it('palette entries for Tools and Providers open their Settings tabs', async () => {
  const { m, back } = await screen()
  const choose = async (id: 'go-tools' | 'go-providers') => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }),
    )
    await settle()
    const row = document.querySelector<HTMLElement>(`[data-cy="palette-row-${id}"]`)
    expect(row).not.toBeNull()
    row?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await settle()
  }
  await choose('go-tools')
  expect(m.q('settings-tab-tools').getAttribute('aria-selected')).toBe('true')
  await choose('go-providers')
  expect(m.q('settings-tab-providers').getAttribute('aria-selected')).toBe('true')
  expect(back().disabled).toBe(false)
  back().click()
  await settle()
  expect(m.all('main-tab-conversation')).toHaveLength(1)
})

it('a page is scrolled back to where it was left', async () => {
  const { m, press } = await screen(120)
  const stream = m.q('transcript')
  stream.scrollTop = 600
  stream.dispatchEvent(new Event('scroll'))
  await settle()
  const left = stream.scrollTop
  await press('rail-team')
  await press('nav-back')
  await expect.poll(() => Math.abs(m.q('transcript').scrollTop - left)).toBeLessThan(2)
})

it('⌘[ and ⌘] go back and forward; a mouse’s side buttons too', async () => {
  const { m, on, press } = await screen()
  await press('rail-waiting')
  await press('rail-team')
  m.q('team-workspace').querySelector<HTMLElement>('button')!.focus()
  await key('[')
  expect(on('waiting-on-you')).toBe(true)
  // Focus left with the Team page, so it goes to this page's heading rather than the body.
  expect(document.activeElement?.textContent).toBe('Waiting on you')
  await key(']')
  expect(on('team-workspace')).toBe(true)
  window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }))
  await settle()
  expect(on('waiting-on-you')).toBe(true)
  window.dispatchEvent(new MouseEvent('mouseup', { button: 4, bubbles: true, cancelable: true }))
  await settle()
  expect(on('team-workspace')).toBe(true)
})

it('what main hears moves it too, and a side button arriving both ways counts once', async () => {
  const { on, press } = await screen()
  await press('rail-waiting')
  await press('rail-team')
  await press('rail-settings')
  navigateListener?.('back')
  await settle()
  expect(on('team-workspace')).toBe(true)
  // A later press, its own: the side button moves it, and the same press heard by main just after
  // does not move it again.
  await new Promise((done) => setTimeout(done, 350))
  window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }))
  await settle()
  expect(on('waiting-on-you')).toBe(true)
  navigateListener?.('back')
  await settle()
  expect(on('waiting-on-you')).toBe(true)
})

it('while a popup is open the keys and buttons stay with it, and nothing moves', async () => {
  const { on, press } = await screen()
  await press('rail-waiting')
  await press('rail-team')
  useOverlays().open({ kind: 'newAgent' })
  await settle()
  await key('[')
  window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }))
  await settle()
  expect(on('team-workspace')).toBe(true)
  useOverlays().close()
  await settle()
  await key('[')
  expect(on('waiting-on-you')).toBe(true)
})

const handed = (sessionId: string, text: string): ResumedSession => ({
  ...META,
  sessionId,
  handover: 'recorded',
  history: {
    entries: [{ ordinal: 0, at: 1, event: { type: 'assistant_message', text } as never }],
    from: 0,
    hasOlder: false,
    turnAligned: true,
  },
})

const linkTo = (sessionId: string, title: string): ResolvedMessageLink => ({
  state: 'available',
  kind: 'piece',
  title,
  status: 'Idle',
  opens: { sessionId },
})

/**
 * The screen showing recorded conversation A, opened from a link in the attached one, then on
 * `after`: A is let go once it is off screen. `host` answers what the host says of each link now.
 */
async function visitedA(after: string, host: (target: string) => ResolvedMessageLink) {
  runtime.look.mockResolvedValueOnce(handed('recorded-a', 'Words of A.'))
  runtime.resolveLink.mockImplementation(async (target) => host(target))
  runtime.attachOpen.mockResolvedValueOnce([
    { ...handed('fictional-source', 'W9.1'), handover: 'attached' },
  ])
  await sessions.attachOpen()
  const m = mount(RuntimeScreen, {}, { width: 1200, height: 800 })
  await expect.poll(() => m.all('message-link').length).toBe(1)
  await expect.poll(() => m.q('message-link').dataset.linkState).toBe('available')
  m.q('message-link').click()
  await expect.poll(() => m.q('transcript').textContent).toContain('Words of A.')
  m.q(after).click()
  await expect.poll(() => sessions.get('recorded-a')).toBeNull()
  await settle()
  return m
}

const unavailable: ResolvedMessageLink = {
  state: 'unavailable',
  kind: 'conversation',
  title: null,
  status: null,
  opens: null,
}

/** The host's answers: W9.1 opens A; of A itself, `a`. */
const hostSays =
  (a: ResolvedMessageLink['state']) =>
  (target: string): ResolvedMessageLink =>
    target === 'W9.1'
      ? linkTo('recorded-a', 'Recorded A')
      : target === 'brocrew://conversation/recorded-a'
        ? { ...linkTo('recorded-a', 'Recorded A'), state: a }
        : unavailable

it('a window that opens on the launcher can come back to it', async () => {
  const m = mount(RuntimeScreen, {}, { width: 1200, height: 800 })
  await expect.poll(() => m.all('launcher-column').length).toBe(1)
  await settle()
  m.q('rail-team').click()
  await settle()
  const back = m.q('nav-back') as HTMLButtonElement
  expect(back.title).toBe('Back to New conversation (⌘[)')
  back.click()
  await settle()
  expect(m.all('launcher-column')).toHaveLength(1)
})

it('the command palette holds the keys, the side buttons and main’s push too', async () => {
  const { on, press } = await screen()
  await press('rail-waiting')
  await press('rail-team')
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }),
  )
  await settle()
  const palette = () => document.querySelectorAll('[data-cy="palette-scrim"]').length
  expect(palette()).toBe(1)
  await key('[')
  window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }))
  await settle()
  navigateListener?.('back')
  await settle()
  expect(on('team-workspace')).toBe(true)
  expect(palette()).toBe(1)
})

it('a conversation archived from its header comes back as its read-only history', async () => {
  runtime.latestHistory.mockResolvedValueOnce({
    entries: [
      { ordinal: 0, at: 1, event: { type: 'assistant_message', text: 'Kept words.' } as never },
    ],
    from: 0,
    hasOlder: false,
    turnAligned: true,
  })
  const { m, back, press } = await screen()
  await press('archive-conversation')
  await expect.poll(() => back().disabled).toBe(false)
  await press('nav-back')
  // The host can't say what the conversation is now; the archive done here says it.
  await expect.poll(() => m.all('linked-history').length).toBe(1)
  expect(m.q('linked-history').textContent).toContain('Kept words.')
  expect(runtime.look).not.toHaveBeenCalled()
  // Every archive in the window goes through the one that marks the history.
  const source = (await import('../../src/renderer/src/components/RuntimeScreen.vue?raw')).default
  expect([...source.matchAll(/@archived="(\w+)"/g)].map(([, name]) => name).sort()).toEqual([
    'archivedFromTheSheet',
    'archivedHere',
  ])
  expect(source).toMatch(/function archivedFromTheSheet[^}]*archivedHere\(conversations\)/)
  expect(source).toMatch(/const archiveOfActive[\s\S]*?archivedHere\(outcome\.conversations\)/)
  expect(source).toMatch(/if \(left !== null\) \{\s*archivedHere\(\[left\]\)/)
})

it('a conversation archived elsewhere since it was visited comes back as its read-only history', async () => {
  const m = await visitedA('rail-team', hostSays('available'))
  runtime.resolveLink.mockImplementation(async (target) => hostSays('archived')(target))
  runtime.latestHistory.mockResolvedValueOnce({
    entries: [
      { ordinal: 0, at: 1, event: { type: 'assistant_message', text: 'Kept A.' } as never },
    ],
    from: 0,
    hasOlder: false,
    turnAligned: true,
  })
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => m.all('linked-history').length).toBe(1)
  expect(m.q('linked-history').textContent).toContain('Kept A.')
  expect(runtime.look).toHaveBeenCalledTimes(1)
})

it('a conversation deleted elsewhere since it was visited is gone past and named', async () => {
  const m = await visitedA('rail-team', hostSays('deleted'))
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => m.all('message-link')[0]?.textContent).toBe('W9.1')
  await expect.poll(() => m.all('toast').length).toBe(1)
  expect(m.q('toast').textContent).toContain('A conversation was deleted, so Back went past it.')
  // It was never looked at again: only the link that first opened it did.
  expect(runtime.look).toHaveBeenCalledTimes(1)
  expect((m.q('nav-back') as HTMLButtonElement).disabled).toBe(true)
})

it('past a profile removed meanwhile, the conversation reached is opened, not guessed', async () => {
  const toEditor: ResolvedMessageLink = {
    state: 'available',
    kind: 'agent',
    title: 'Editor',
    status: null,
    opens: { identityId: 'agent:editor' },
  }
  runtime.look.mockResolvedValueOnce(handed('recorded-a', 'W9.2'))
  runtime.resolveLink.mockImplementation(async (target) =>
    target === 'W9.2' ? toEditor : hostSays('available')(target),
  )
  runtime.attachOpen.mockResolvedValueOnce([
    { ...handed('fictional-source', 'W9.1'), handover: 'attached' },
  ])
  await sessions.attachOpen()
  const m = mount(RuntimeScreen, {}, { width: 1200, height: 800 })
  await expect.poll(() => m.q('message-link').dataset.linkState).toBe('available')
  m.q('message-link').click()
  await expect.poll(() => m.all('message-link')[0]?.textContent).toBe('W9.2')
  await expect.poll(() => m.q('message-link').dataset.linkState).toBe('available')
  m.q('message-link').click()
  await expect.poll(() => m.all('team-workspace').length).toBe(1)
  m.q('rail-settings').click()
  await expect.poll(() => sessions.get('recorded-a')).toBeNull()
  await settle()
  runtime.agentIdentities.mockResolvedValue({ ...agents, identities: [] })
  runtime.look.mockResolvedValueOnce(handed('recorded-a', 'W9.2'))
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => m.all('message-link')[0]?.textContent).toBe('W9.2')
  expect(m.all('launcher-column')).toHaveLength(0)
  expect(runtime.look).toHaveBeenCalledTimes(2)
  await expect.poll(() => m.all('toast').length).toBe(1)
  expect(m.q('toast').textContent).toContain('Editor was deleted, so Back went past it.')
})

it('an archived page that can’t be read leaves the window and its step where they were', async () => {
  const m = await visitedA('rail-team', hostSays('archived'))
  const back = () => m.q('nav-back') as HTMLButtonElement
  const title = back().title
  runtime.latestHistory.mockRejectedValueOnce(new Error('That history could not be read.'))
  back().click()
  await expect.poll(() => m.all('toast').length).toBe(1)
  expect(m.q('toast').textContent).toContain('That history could not be read.')
  expect(m.all('team-workspace')).toHaveLength(1)
  expect(back().title).toBe(title)
  // Pressed again, it is read again.
  back().click()
  await expect.poll(() => m.all('linked-history').length).toBe(1)
})

it('a step still reading when the person goes elsewhere is dropped', async () => {
  const m = await visitedA('rail-team', hostSays('archived'))
  let finish!: (page: Awaited<ReturnType<RuntimeBridge['latestHistory']>>) => void
  runtime.latestHistory.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done
      }),
  )
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => runtime.latestHistory.mock.calls.length).toBe(1)
  // A second Back during the step does nothing of its own.
  ;(m.q('nav-back') as HTMLButtonElement).click()
  m.q('rail-settings').click()
  await settle()
  finish({ entries: [], from: 0, hasOlder: false, turnAligned: true })
  await settle()
  await settle()
  expect(m.all('settings-screen')).toHaveLength(1)
  expect(m.all('linked-history')).toHaveLength(0)
  expect((m.q('nav-back') as HTMLButtonElement).title).toBe('Back to Team (⌘[)')
})

/** Back to A's archived page with its read held back; resolves it when told. */
async function backHeldBack(m: Awaited<ReturnType<typeof visitedA>>) {
  let finish!: (page: Awaited<ReturnType<RuntimeBridge['latestHistory']>>) => void
  runtime.latestHistory.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done
      }),
  )
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => runtime.latestHistory.mock.calls.length).toBe(1)
  return () => finish({ entries: [], from: 0, hasOlder: false, turnAligned: true })
}

it('a Back pressed during a step is that step’s, and moves nothing more', async () => {
  const m = await visitedA('rail-team', hostSays('archived'))
  const resolve = await backHeldBack(m)
  ;(m.q('nav-back') as HTMLButtonElement).click()
  resolve()
  await expect.poll(() => m.all('linked-history').length).toBe(1)
  await settle()
  await settle()
  expect(m.all('linked-history')).toHaveLength(1)
  expect((m.q('nav-forward') as HTMLButtonElement).title).toBe('Forward to Team (⌘])')
})

it('a Back pressed during a step does nothing, even after the person goes elsewhere', async () => {
  const m = await visitedA('rail-settings', hostSays('archived'))
  const resolve = await backHeldBack(m)
  ;(m.q('nav-back') as HTMLButtonElement).click()
  resolve()
  // The step lands; before its frames are drawn, the person chooses Team.
  await expect.poll(() => m.all('linked-history').length).toBe(1)
  m.q('rail-team').click()
  await settle()
  await settle()
  expect(m.all('team-workspace')).toHaveLength(1)
})

it('Backs pressed during a step, then a dialog opened and closed, leave one Back one step', async () => {
  const m = await visitedA('rail-team', hostSays('archived'))
  const resolve = await backHeldBack(m)
  ;(m.q('nav-back') as HTMLButtonElement).click()
  ;(m.q('nav-back') as HTMLButtonElement).click()
  resolve()
  await expect.poll(() => m.all('linked-history').length).toBe(1)
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }),
  )
  await settle()
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
  await settle()
  expect(document.querySelectorAll('[data-cy="palette-scrim"]')).toHaveLength(0)
  expect(m.all('linked-history')).toHaveLength(1)
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => m.all('message-link')[0]?.textContent).toBe('W9.1')
  await settle()
  // One step: from A's page to the conversation the link was in, and no further.
  expect((m.q('nav-back') as HTMLButtonElement).disabled).toBe(true)
  expect((m.q('nav-forward') as HTMLButtonElement).title).toContain('Forward to')
})

it('the conversation list refreshing while a step reads does not stop the step', async () => {
  // A busy app refreshes its conversation list all the time; the place on screen is the same.
  const m = await visitedA('rail-team', hostSays('available'))
  runtime.look.mockResolvedValueOnce(handed('recorded-a', 'Words of A.'))
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => m.q('transcript').textContent).toContain('Words of A.')
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => m.all('message-link')[0]?.textContent).toBe('W9.1')
  await expect.poll(() => sessions.get('recorded-a')).toBeNull()
  await settle()
  let finish!: (answer: ResumedSession) => void
  runtime.look.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done
      }),
  )
  ;(m.q('nav-forward') as HTMLButtonElement).click()
  await expect.poll(() => runtime.look.mock.calls.length).toBe(3)
  hostSaysChanged?.({ what: 'conversations' } as never)
  await settle()
  await settle()
  finish(handed('recorded-a', 'Words of A.'))
  await expect.poll(() => m.q('transcript').textContent).toContain('Words of A.')
})

it('another tab chosen while a step reads stops the step', async () => {
  const m = await visitedA('rail-team', hostSays('available'))
  runtime.look.mockResolvedValueOnce(handed('recorded-a', 'Words of A.'))
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => m.q('transcript').textContent).toContain('Words of A.')
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => m.all('message-link')[0]?.textContent).toBe('W9.1')
  await expect.poll(() => sessions.get('recorded-a')).toBeNull()
  await settle()
  let finish!: (answer: ResumedSession) => void
  runtime.look.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done
      }),
  )
  ;(m.q('nav-forward') as HTMLButtonElement).click()
  await expect.poll(() => runtime.look.mock.calls.length).toBe(3)
  // The person chooses the Files tab of the conversation they are on: a move of their own.
  m.q('main-tab-files').click()
  await settle()
  finish(handed('recorded-a', 'Words of A.'))
  await settle()
  await settle()
  expect(m.q('main-tab-files').getAttribute('aria-selected')).toBe('true')
  expect(sessions.get('recorded-a')).toBeNull()
  expect(m.q('transcript').textContent).not.toContain('Words of A.')
  // A tab is part of its place, not a step: A is still there to go Forward to.
  expect((m.q('nav-forward') as HTMLButtonElement).title).toContain('Forward to')
})

it('a dialog opened while a step was reading stops the step', async () => {
  const m = await visitedA('rail-team', hostSays('archived'))
  const title = (m.q('nav-back') as HTMLButtonElement).title
  let finish!: (page: Awaited<ReturnType<RuntimeBridge['latestHistory']>>) => void
  runtime.latestHistory.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done
      }),
  )
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => runtime.latestHistory.mock.calls.length).toBe(1)
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }),
  )
  await settle()
  expect(document.querySelectorAll('[data-cy="palette-scrim"]')).toHaveLength(1)
  finish({ entries: [], from: 0, hasOlder: false, turnAligned: true })
  await settle()
  expect(m.all('team-workspace')).toHaveLength(1)
  expect(m.all('linked-history')).toHaveLength(0)
  expect((m.q('nav-back') as HTMLButtonElement).title).toBe(title)
})

it('an archived page already read, deleted elsewhere since, is gone past and named', async () => {
  const m = await visitedA('rail-team', hostSays('archived'))
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => m.all('linked-history').length).toBe(1)
  m.q('rail-settings').click()
  await settle()
  runtime.resolveLink.mockImplementation(async (target) => hostSays('deleted')(target))
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => m.all('message-link')[0]?.textContent).toBe('W9.1')
  expect(m.all('linked-history')).toHaveLength(0)
  await expect.poll(() => m.all('toast').length).toBe(1)
  expect(m.q('toast').textContent).toContain('was deleted, so Back went past it.')
})

it('an archived page already read is not shown again when the host can’t say it is there', async () => {
  const m = await visitedA('rail-team', hostSays('archived'))
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => m.all('linked-history').length).toBe(1)
  m.q('rail-settings').click()
  await settle()
  runtime.resolveLink.mockImplementation(async (target) => hostSays('unavailable')(target))
  runtime.latestHistory.mockRejectedValueOnce(new Error('That history could not be read.'))
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => m.all('toast').length).toBe(1)
  expect(m.q('toast').textContent).toContain('That history could not be read.')
  expect(m.all('settings-screen')).toHaveLength(1)
  expect(m.all('linked-history')).toHaveLength(0)
})

it('a press heard only by the mouse, just after a press heard both ways, moves again', async () => {
  const { on, press } = await screen()
  await press('rail-waiting')
  await press('rail-team')
  await press('rail-settings')
  let clock = 1_000_000
  const time = vi.spyOn(Date, 'now').mockImplementation(() => clock)
  try {
    navigateListener?.('back')
    await settle()
    clock += 30
    window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }))
    await settle()
    expect(on('team-workspace')).toBe(true)
    clock += 60
    window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }))
    await settle()
    expect(on('waiting-on-you')).toBe(true)
  } finally {
    time.mockRestore()
  }
})

it.each([
  ['main', 'mouse'],
  ['mouse', 'main'],
] as const)(
  'two quick presses, each heard first from %s and then from %s, move twice',
  async (first, second) => {
    const { on, press } = await screen()
    await press('rail-waiting')
    await press('rail-team')
    await press('rail-settings')
    let clock = 1_000_000
    const time = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const hear = async (from: 'main' | 'mouse', at: number) => {
      clock = 1_000_000 + at
      if (from === 'main') navigateListener?.('back')
      else
        window.dispatchEvent(
          new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }),
        )
      await settle()
    }
    try {
      await hear(first, 0)
      await hear(second, 30)
      expect(on('team-workspace')).toBe(true)
      await hear(first, 160)
      await hear(second, 190)
      expect(on('waiting-on-you')).toBe(true)
    } finally {
      time.mockRestore()
    }
  },
)

it('a side button heard from main first and then as its own press moves once', async () => {
  const { on, press } = await screen()
  await press('rail-waiting')
  await press('rail-team')
  await press('rail-settings')
  navigateListener?.('back')
  await settle()
  expect(on('team-workspace')).toBe(true)
  window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }))
  await settle()
  expect(on('team-workspace')).toBe(true)
})

it('a conversation that can’t be opened again keeps the window where it is and says why', async () => {
  const a = linkTo('recorded-a', 'Recorded A')
  const b = linkTo('recorded-b', 'Recorded B')
  runtime.look
    .mockResolvedValueOnce(handed('recorded-a', 'W9.2'))
    .mockResolvedValueOnce(handed('recorded-b', 'Nothing more.'))
  runtime.resolveLink
    .mockResolvedValueOnce(a)
    .mockResolvedValueOnce(a)
    .mockResolvedValueOnce(b)
    .mockResolvedValueOnce(b)
  runtime.attachOpen.mockResolvedValueOnce([
    { ...handed('fictional-source', 'W9.1'), handover: 'attached' },
  ])
  await sessions.attachOpen()
  const m = mount(RuntimeScreen, {}, { width: 1200, height: 800 })
  await expect.poll(() => m.all('message-link').length).toBe(1)
  m.q('message-link').click()
  await expect.poll(() => m.all('message-link')[0]?.textContent).toBe('W9.2')
  await expect.poll(() => m.q('message-link').dataset.linkState).toBe('available')
  m.q('message-link').click()
  await expect.poll(() => sessions.get('recorded-a')).toBeNull()
  runtime.look.mockRejectedValueOnce(new Error('That conversation is open in another window.'))
  ;(m.q('nav-back') as HTMLButtonElement).click()
  await expect.poll(() => m.all('toast').length).toBe(1)
  expect(m.q('toast').textContent).toContain('another window')
  expect(m.all('message-link')).toHaveLength(0)
  expect((m.q('nav-back') as HTMLButtonElement).disabled).toBe(false)
  expect(runtime.send).not.toHaveBeenCalled()
})
