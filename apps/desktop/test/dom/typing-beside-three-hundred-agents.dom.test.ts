import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import RuntimeScreen from '../../src/renderer/src/components/RuntimeScreen.vue'
import { createSessionStore, type SessionStore } from '../../src/renderer/src/lib/session-store'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import type {
  AgentIdentities,
  ResumedSession,
  RuntimeBridge,
  RuntimeStatesMessage,
} from '../../src/shared/runtime-ipc'
import { agentStateWords } from '../../src/shared/agent-state'
import { aFakeBridge, type FakeBridge } from './fake-bridge'
import { META, mount, unmountAll, type Mounted } from './harness'
import { testWorkspace } from '../workspace-fixture'
import {
  OWNER,
  REALISTIC,
  childId,
  workspaceAtScale,
  type WorkspaceAtScale,
} from '../fixtures/workspace-at-scale'

/**
 * Typing beside the right panel while it shows a conversation's 300 children, in a workspace of
 * 700 conversations: the whole window, from the bridge to the Started here strip, with the real
 * stylesheet. A keystroke changes the draft and nothing else, so nothing about the workspace may be
 * looked at again; one agent's state moving changes that agent's card and nothing else, so the work
 * it costs grows with the workspace and never with children × conversations.
 *
 * Both ways a pane learns its state are covered: a conversation this window runs (its state derived
 * from its record and the waits) and one drawn from its ledger (the host's listed state).
 */

vi.mock('../../src/renderer/src/components/ProviderSetupAtLaunch.vue', () => ({
  default: { render: () => null },
}))

let sessions: SessionStore
let agentStore: ReturnType<typeof createAgentStore>
let modelLists: ReturnType<typeof createModelLists>
vi.mock('../../src/renderer/src/composables/useSessionStore', () => ({
  useSessionStore: () => sessions,
}))
vi.mock('../../src/renderer/src/composables/useAgentStore', () => ({
  useAgentStore: () => agentStore,
}))
vi.mock('../../src/renderer/src/composables/useModelLists', () => ({
  useModelLists: () => modelLists,
}))

let data: WorkspaceAtScale
let pushStates: ((message: RuntimeStatesMessage) => void) | null = null

/** What one bridge verb answers. */
type Answer<K extends keyof RuntimeBridge> = RuntimeBridge[K] extends (
  ...args: never[]
) => infer Reply
  ? Awaited<Reply>
  : never

/** A read this fixture does not answer: the host refused it, as the store then says. */
const notAnswered = (what: string): Promise<never> =>
  Promise.reject(new Error(`No ${what} in this fixture.`))

const emptyWalk = (walk: string) => ({ rows: [], walk, ledgers: 0, rowsUnread: 0 })

const history = { entries: [], from: 0, hasOlder: false, turnAligned: true }

/** What the screen asks of the host, answered at the fixture's size. */
function answers(): Partial<RuntimeBridge> {
  const agents: AgentIdentities = {
    identities: [...data.identities],
    use: [],
    foldersWithoutARow: [],
    spawningEnabled: true,
    defaultApprovalMode: 'ask',
    externalMcpServers: [],
  }
  return {
    onEvent: () => () => {},
    onLiveness: () => () => {},
    onChanged: () => () => {},
    onStates: (listener: (message: RuntimeStatesMessage) => void) => {
      pushStates = listener
      return () => {}
    },
    onLimitsDisplayChanged: () => () => {},
    onProvidersChanged: () => () => {},
    attachOpen: async (): Promise<ResumedSession[]> => [],
    look: async ({ sessionId }: { sessionId: string }): Promise<ResumedSession> => ({
      ...META,
      sessionId,
      handover: 'recorded',
      history,
    }),
    latestHistory: async () => history,
    stopLooking: async () => {},
    listResumable: async () => structuredClone(data.resumable),
    listUnresumable: async () => structuredClone(data.unresumable),
    agentIdentities: async () => agents,
    profiles: async () => [],
    capabilities: async () => ({}) as Answer<'capabilities'>,
    providerVersions: async () => ({
      claude: { version: null, reason: 'No version in this fixture.' },
      codex: { version: null, reason: 'No version in this fixture.' },
    }),
    providerSetup: async () => ({}) as Answer<'providerSetup'>,
    providerUsage: async () => ({ claude: [], codex: [] }),
    providerResources: async () => ({
      claude: { running: 0, at: 1, rssBytes: 0, cpuPercent: 0 },
      codex: { running: 0, at: 1, rssBytes: 0, cpuPercent: 0 },
    }),
    questionsForAPerson: async () =>
      emptyWalk('every-conversation-that-routed') as Answer<'questionsForAPerson'>,
    decisionsForAPerson: async () =>
      emptyWalk('every-conversation-that-routed') as Answer<'decisionsForAPerson'>,
    stalledWorkForAPerson: async () =>
      emptyWalk('every-conversation-that-routed') as Answer<'stalledWorkForAPerson'>,
    stoppedWorkForAPerson: async () =>
      emptyWalk('every-conversation-that-routed') as Answer<'stoppedWorkForAPerson'>,
    workIncidentsForAPerson: async () =>
      emptyWalk('every-conversation-that-routed') as Answer<'workIncidentsForAPerson'>,
    waitingOnWhoWroteForAPerson: async () =>
      emptyWalk('every-conversation-that-routed') as Answer<'waitingOnWhoWroteForAPerson'>,
    instructionAsksForAPerson: async () => [],
    mcpServerRequestsForAPerson: async () => [],
    readLimitsDisplay: () => notAnswered('limits'),
    readWorkspace: () => notAnswered('workspace'),
    // Reads this contract does not measure: the host refuses them, and each surface says so.
    agentRulesUnread: () => notAnswered('rules'),
    agentOwnNotesUnread: () => notAnswered('notes'),
    filesKept: () => notAnswered('files'),
    filesLibrary: () => notAnswered('files library'),
    teamProfileGraph: () => notAnswered('team graph'),
    workGivenBy: () => notAnswered('work given'),
    whatEachConversationIsWaitingOn: async () => structuredClone(data.waits),
    whatIsBeingDone: async () => structuredClone(data.atWork),
    theWholeForest: async () => structuredClone(data.forest),
    processMemory: async () => structuredClone(data.memory),
    whoCalledWhom: async ({ sessionId }) =>
      sessionId === OWNER ? structuredClone(data.cast) : notAnswered('who called whom'),
  }
}

let fake: FakeBridge

/** Installs a bridge answering `answers()` and these overrides, and the stores that read it. */
function useBridge(overrides: Partial<RuntimeBridge> = {}, options: { partial?: boolean } = {}) {
  fake = aFakeBridge({ ...answers(), ...overrides }, options)
  window.api = {
    runtime: fake.bridge,
    getAppInfo: async () => ({
      name: 'Fictional BroBot',
      windowTitle: 'Fictional BroBot',
      version: '0.0.0',
      step: 'test',
      workspace: { name: 'Fiction', path: '/fictional/work', isDefault: false },
      build: { id: 'test', commit: '', dirty: false, branches: null },
      db: { migrationsApplied: 0, providerSessionCount: 0 },
    }),
    onNavigate: () => () => {},
  } as unknown as Window['api']
  sessions = createSessionStore(window.api.runtime)
  agentStore = createAgentStore(window.api.runtime)
  modelLists = createModelLists(() => window.api.runtime)
}

beforeEach(() => {
  data = workspaceAtScale()
  pushStates = null
  useOverlays().close()
  localStorage.clear()
  useBridge()
})

afterEach(() => {
  unmountAll()
  sessions.dispose()
  useOverlays().close()
  localStorage.clear()
  // Every call the screen made, its teardown included, was one this test answered.
  expect(fake.unexpected.join(', ')).toBe('')
})

const settle = async (): Promise<void> => {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
  await new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done())),
  )
}

/** Component updates by name, and how many array elements the search methods visited. */
interface Counts {
  updates: Map<string, number>
  visits: number
}

const counts: Counts = { updates: new Map(), visits: 0 }

function countUpdates(app: App): void {
  app.mixin({
    updated(this: { $options: { __name?: string; name?: string } }) {
      const name = this.$options.__name ?? this.$options.name ?? 'anonymous'
      counts.updates.set(name, (counts.updates.get(name) ?? 0) + 1)
    },
  })
}

const SEARCHES = ['find', 'findIndex', 'findLast', 'some', 'every', 'filter'] as const

/** Counts each callback a search method runs, so a search per card per row shows as its product. */
function countSearches(): () => void {
  const methods = Array.prototype as unknown as Record<string, unknown>
  const originals = SEARCHES.map((name) => [name, methods[name]] as const)
  for (const [name, original] of originals) {
    Object.defineProperty(Array.prototype, name, {
      configurable: true,
      writable: true,
      value: function (
        this: unknown[],
        callback: (...args: unknown[]) => unknown,
        ...rest: unknown[]
      ) {
        return (original as (...args: unknown[]) => unknown).call(
          this,
          (...args: unknown[]) => {
            counts.visits += 1
            return callback(...args)
          },
          ...rest,
        )
      },
    })
  }
  return () => {
    for (const [name, original] of originals)
      Object.defineProperty(Array.prototype, name, {
        configurable: true,
        writable: true,
        value: original,
      })
  }
}

function resetCounts(): void {
  counts.updates.clear()
  counts.visits = 0
}

const updatesOf = (name: string): number => counts.updates.get(name) ?? 0

async function chipsDrawn(m: Mounted): Promise<void> {
  await expect
    .poll(() => m.host.querySelectorAll('[data-cy="cast-children-strip"] .agent-chip').length, {
      timeout: 20_000,
    })
    .toBe(REALISTIC.children)
  await settle()
}

/** The live branch: this window runs the owner, so its pane derives its own state. */
async function aConversationThisWindowRuns(): Promise<Mounted> {
  window.api.runtime.attachOpen = async () => [
    { ...META, sessionId: OWNER, handover: 'attached', history } as ResumedSession,
  ]
  await sessions.attachOpen()
  const m = mount(RuntimeScreen, {}, { width: 1440, height: 1000 }, countUpdates)
  await expect.poll(() => m.all(`open-session-${OWNER}`).length, { timeout: 20_000 }).toBe(1)
  // Arriving at the conversation from another page reads its band.
  m.q('rail-team').click()
  await settle()
  m.q(`open-session-${OWNER}`).click()
  await chipsDrawn(m)
  expect(sessions.live.value.find((record) => record.sessionId === OWNER)?.phase).toBe('open')
  return m
}

/** The recorded branch: the owner is drawn from its ledger, so its pane draws the host's state. */
async function aConversationDrawnFromItsLedger(): Promise<Mounted> {
  const m = mount(RuntimeScreen, {}, { width: 1440, height: 1000 }, countUpdates)
  await expect.poll(() => m.all(`open-session-${OWNER}`).length, { timeout: 20_000 }).toBe(1)
  m.q(`open-session-${OWNER}`).click()
  await chipsDrawn(m)
  return m
}

function composer(m: Mounted): HTMLTextAreaElement {
  const box = m.q('composer-band').querySelector('textarea')
  expect(box, 'the composer draws no text box').not.toBeNull()
  return box!
}

async function type(m: Mounted, text: string): Promise<number[]> {
  const box = composer(m)
  const frames: number[] = []
  for (const letter of text) {
    const started = performance.now()
    box.value += letter
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await new Promise<void>((done) => requestAnimationFrame(() => done()))
    frames.push(performance.now() - started)
  }
  await settle()
  return frames
}

const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0

describe.each([
  ['a conversation this window runs', aConversationThisWindowRuns],
  ['a conversation drawn from its ledger', aConversationDrawnFromItsLedger],
])('beside %s with 300 children', (_branch, open) => {
  it('a keystroke looks at no agent again', async () => {
    const m = await open()
    const strip = m.q('cast-children-strip').innerHTML
    const restore = countSearches()
    resetCounts()
    let frames: number[]
    try {
      frames = await type(m, 'Fictional words typed beside the panel.')
    } finally {
      restore()
    }
    const keys = 'Fictional words typed beside the panel.'.length
    console.info(
      `typing beside ${String(REALISTIC.children)} children: median ${median(frames).toFixed(1)} ms per key (advisory)`,
    )
    expect(composer(m).value).toBe('Fictional words typed beside the panel.')
    expect(updatesOf('WorkingTogether'), 'the Started here strip drew again for a keystroke').toBe(
      0,
    )
    expect(counts.visits / keys, 'a keystroke searched the workspace').toBeLessThan(
      REALISTIC.conversations,
    )
    expect(m.q('cast-children-strip').innerHTML).toBe(strip)
  }, 180_000)

  it('one agent moving changes its own card, at a cost that grows with the workspace alone', async () => {
    const m = await open()
    const moved = childId(REALISTIC.children - 1)
    const still = childId(REALISTIC.children - 2)
    const stillChip = m.host.querySelector(`.agent-chip[data-conversation="${still}"]`)!.outerHTML
    const restore = countSearches()
    resetCounts()
    try {
      pushStates!({ moved: [{ conversation: moved, state: { is: 'needs-you' } }], kept: [] })
      await settle()
    } finally {
      restore()
    }
    await expect
      .poll(() => m.q(`cast-tile-word-${moved}`).textContent?.trim())
      .toBe(agentStateWords({ is: 'needs-you' }))
    expect(updatesOf('WorkingTogether')).toBeLessThanOrEqual(1)
    expect(counts.visits).toBeLessThanOrEqual(20 * REALISTIC.conversations)
    expect(m.host.querySelector(`.agent-chip[data-conversation="${still}"]`)!.outerHTML).toBe(
      stillChip,
    )
  }, 180_000)
})

describe('the screen owns the projection it provides', () => {
  /** One reply held until the test lets it go. */
  function held<T>(value: T) {
    let release: () => void = () => {}
    const answer = new Promise<T>((done) => {
      release = () => done(value)
    })
    return { answer: () => answer, release: () => release() }
  }

  it('a test starts with nothing read, whatever the test before it left', () => {
    expect(testWorkspace().listed()).toBeNull()
    expect(testWorkspace().waits()).toBeNull()
    expect(testWorkspace().cast()).toBeNull()
    // Left for the next case, which must not see it.
    testWorkspace().waitsRead(structuredClone(data.waits))
  })

  it('and the next one too', () => {
    expect(testWorkspace().waits()).toBeNull()
  })

  it('the screen creates its own projection where nothing above it provides one', async () => {
    const host = document.createElement('div')
    host.style.width = '1440px'
    host.style.height = '1000px'
    document.body.append(host)
    const app = createApp(RuntimeScreen)
    try {
      app.mount(host)
      await expect
        .poll(() => host.querySelectorAll(`[data-cy="open-session-${OWNER}"]`).length, {
          timeout: 20_000,
        })
        .toBe(1)
      // The rail drew from the screen's projection; the test's was never written.
      expect(testWorkspace().listed()).toBeNull()
    } finally {
      app.unmount()
      host.remove()
    }
  }, 60_000)

  it('a read the screen asked writes nothing once the screen has gone', async () => {
    const waits = held(structuredClone(data.waits))
    const memory = held(structuredClone(data.memory))
    const files = held({ ok: true as const, files: [], added: [] })
    useBridge({
      whatEachConversationIsWaitingOn: waits.answer,
      processMemory: memory.answer,
      filesKept: files.answer as never,
    })
    const m = await aConversationDrawnFromItsLedger()
    const before = { waits: testWorkspace().waits(), memory: testWorkspace().memory() }
    m.unmount()
    // The screen's reset leaves nothing behind; the replies arrive after it.
    expect(testWorkspace().listed()).toBeNull()
    waits.release()
    memory.release()
    files.release()
    await settle()
    expect(testWorkspace().waits()).toBeNull()
    expect(testWorkspace().memory().size).toBe(0)
    expect(testWorkspace().treeFiles()).toBeNull()
    expect(before.waits).toBeNull()
  }, 60_000)
})

describe('a read the test did not answer', () => {
  it('THE CONTROL — is named, though the screen goes on drawing as if the host had not answered', async () => {
    const rest = Object.fromEntries(
      Object.entries(answers()).filter(([verb]) => verb !== 'whatEachConversationIsWaitingOn'),
    ) as Partial<RuntimeBridge>
    fake = aFakeBridge(rest)
    window.api = { ...window.api, runtime: fake.bridge } as Window['api']
    sessions = createSessionStore(window.api.runtime)
    const m = await aConversationDrawnFromItsLedger()
    expect(m.all('cast-sub-agents')).toHaveLength(1)
    expect(fake.unexpected).toContain('whatEachConversationIsWaitingOn')
    // Answered here, so the file's own check passes.
    fake = aFakeBridge(answers())
  }, 60_000)
})
