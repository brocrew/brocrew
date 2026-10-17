import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { createSessionStore, type SessionStore } from '../../src/renderer/src/lib/session-store'
import { fullTime } from '../../src/renderer/src/lib/clock'
import { listenProviderStates } from '../../src/renderer/src/lib/provider-limit-facts'
import type { ProviderBlockFacts } from '../../src/renderer/src/lib/provider-limit-status'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import type { ListedConversation } from '../../src/renderer/src/lib/conversation-list'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type {
  AgentIdentities,
  ResumableSessionInfo,
  ResumedSession,
  RuntimeBridge,
  RuntimeStatesMessage,
  SessionLivenessMessage,
} from '../../src/shared/runtime-ipc'
import { createAttachmentBook, draftKey } from '../../src/renderer/src/lib/drafts'
import { META, mount, unmountAll } from './harness'

const NOW = Date.now()
const current = {
  providerBlockStatus: 'current',
  providerBlock: { provider: 'claude', resetsAt: NOW + 3600000 },
} as const
const clear = { providerBlockStatus: 'current', providerBlock: null } as const
const unavailable = { providerBlockStatus: 'unavailable' } as const
const cleanups: (() => void)[] = []
afterEach(() => {
  unmountAll()
  for (const clean of cleanups.splice(0)) clean()
  delete (window as { api?: unknown }).api
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
function descriptor(
  facts: ProviderBlockFacts,
  handover: 'attached' | 'recorded' = 'attached',
): ResumedSession {
  return {
    ...META,
    ...facts,
    handover,
    history: {
      from: 0,
      hasOlder: false,
      turnAligned: true,
      entries: [{ ordinal: 0, at: NOW, event: { type: 'status', state: 'idle' } }],
    },
  }
}
function listed(facts: ProviderBlockFacts): ResumableSessionInfo {
  return {
    provider: 'claude',
    sessionId: META.sessionId,
    cwd: '/made-up/bakery',
    status: 'idle',
    state: { is: 'idle' },
    named: null,
    running: 'not-running',
    profileId: META.profileId,
    reasoningEffort: null,
    model: null,
    planMode: null,
    adoptedAt: null,
    hasTranscript: true,
    child: null,
    lastEnding: 'completed',
    updatedAt: NOW,
    approvalMode: 'ask',
    ref: META.ref!,
    resumeRefusal: null,
    ...facts,
  }
}
const slug = META.profileId!
const agents: AgentIdentities = {
  identities: [
    {
      id: `aid:${slug}`,
      slug,
      displayName: 'Recipe agent',
      createdAt: 0,
      createdBy: null,
      provider: 'claude',
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
  foldersWithoutARow: [],
  use: [
    {
      slug,
      conversations: 1,
      thisAppMintsIt: true,
      isLaunching: false,
      isStarting: false,
      runsOn: { provider: 'claude', from: 'saved' },
    },
  ],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
}
interface Rail {
  hearStates(message: RuntimeStatesMessage): void
  refreshResumable(): Promise<void>
  theOneList: readonly ListedConversation[] | null
}
async function screens() {
  const wire: {
    states?: (message: RuntimeStatesMessage) => void
    liveness?: (message: SessionLivenessMessage) => void
  } = {}
  let listReply = async () => [listed(current)]
  let lookReply = async () => descriptor(current, 'recorded')
  const forbidden = async () => {
    throw new Error('Reading provider status must not start or send')
  }
  const bridge = {
    onEvent: () => () => {},
    onLiveness: (receive: (message: SessionLivenessMessage) => void) => {
      wire.liveness = receive
      return () => {
        delete wire.liveness
      }
    },
    onStates: (receive: (message: RuntimeStatesMessage) => void) => {
      wire.states = receive
      return () => {
        delete wire.states
      }
    },
    attachOpen: async () => [descriptor(current)],
    listResumable: () => listReply(),
    listUnresumable: async () => [],
    createSession: forbidden,
    resume: forbidden,
    send: forbidden,
    close: async () => ({ ok: true }),
    look: () => lookReply(),
  } as unknown as RuntimeBridge
  ;(window as { api?: unknown }).api = { runtime: bridge }
  const store: SessionStore = createSessionStore(bridge)
  cleanups.push(() => store.dispose())
  await store.attachOpen()
  const record = store.get(META.sessionId)!
  const rail = ref<Rail | null>(null)
  cleanups.push(listenProviderStates(bridge, store, (message) => rail.value?.hearStates(message)))
  const handing = createAttachmentBook().handing(draftKey(record.sessionId))
  const shell = defineComponent(
    () => () =>
      h('div', [
        h(SideRail, {
          ref: rail,
          open: store.live.value,
          onScreen: record,
          providerBlocks: store.providerBlocks,
          activeId: record.sessionId,
          place: null,
        }),
        h(ConversationPane, {
          record,
          mode: 'normal',
          debug: false,
          drawerOpen: true,
          drawerTab: 'open',
          cwd: '/made-up/bakery',
          capabilities: null,
          draft: '',
          handing,
          listedState: rail.value?.theOneList?.find((one) => one.sessionId === record.sessionId)
            ?.state,
          providerBlock: store.providerBlocks.get(record.sessionId),
        }),
        h(TeamWorkspace, {
          agents,
          store: { renameTo: forbidden, remove: forbidden } as unknown as AgentStore,
          conversations: rail.value?.theOneList ?? null,
          held: [record.sessionId],
        }),
      ]),
  )
  const m = mount(shell, {}, { width: 1700, height: 1100 })
  await settle()
  ;(m.q(`team-conversations-${slug}`).parentElement as HTMLDetailsElement).open = true
  function check(word: 'stop' | 'clear' | 'unavailable') {
    const header = m.q('session-status').textContent!.trim()
    const railLine = m.host.querySelector<HTMLElement>(`#rail-state-${record.sessionId}`)!
    const railWord = railLine.textContent!.replace(/\s+/g, ' ').trim()
    const teamWord = m
      .q(`team-conversation-${record.sessionId}`)
      .querySelector('.team-now')!
      .textContent!.trim()
    expect(header).toEqual(
      word === 'clear'
        ? 'Idle'
        : word === 'unavailable'
          ? 'Current limit status unavailable'
          : expect.stringContaining('Stopped: Claude’s limit'),
    )
    const short =
      word === 'clear' ? 'idle' : word === 'unavailable' ? 'Limit unavailable' : 'Claude limit'
    expect(railWord).toBe(['claude', short, railLine.dataset.place].filter(Boolean).join(' · '))
    expect(teamWord).toBe(short)
    const list = rail.value!.theOneList
    expect(list).not.toBeNull()
    const facts = list!.find((one) => one.sessionId === record.sessionId)!
    expect(facts.providerBlockStatus).toBe(word === 'unavailable' ? 'unavailable' : 'current')
    const go = m.q(`team-conversation-go-${record.sessionId}`)
    go.focus()
    expect(document.activeElement).toBe(go)
    const explanation = go.getAttribute('aria-description')
    if (word === 'stop')
      expect(explanation).toBe(
        `Stopped: Claude’s limit · Reported reset: ${fullTime(current.providerBlock.resetsAt)}`,
      )
    else if (word === 'unavailable') {
      const history = facts.providerBlockLastKnown
      expect(explanation).toBe(
        'The current limit status could not be read.' +
          (history == null
            ? ''
            : ` · Last known: stopped at Claude’s limit · as of ${fullTime(history.asOf)}`),
      )
    } else expect(explanation).toBeNull()
    expect(go.getAttribute('title')).toBe(explanation)
    if (word === 'clear') expect(facts.providerBlock).toBeNull()
  }
  return {
    page: m,
    store,
    record,
    rail,
    check,
    state: async (facts: ProviderBlockFacts) => {
      wire.states!({
        moved: [{ conversation: record.sessionId, state: { is: 'idle' }, ...facts }],
        kept: [],
      })
      await settle()
    },
    live: async (facts: ProviderBlockFacts) => {
      wire.liveness!({
        sessionId: record.sessionId,
        liveness: { state: 'live', since: NOW, ...facts },
      })
      await settle()
    },
    list: (reply: () => Promise<ResumableSessionInfo[]>) => {
      listReply = reply
    },
    look: (reply: () => Promise<ResumedSession>) => {
      lookReply = reply
    },
  }
}
describe('Root channel ordering stays the same across pane, rail and Team', () => {
  it.each(['state', 'liveness'] as const)(
    '%s history retirement survives a late list and remains separate from current status',
    async (door) => {
      const s = await screens()
      const previous = {
        ...unavailable,
        providerBlockLastKnown: { provider: 'claude', resetsAt: NOW + 3600000, asOf: NOW - 1000 },
      } as const
      await (door === 'state' ? s.state(previous) : s.live(previous))
      s.check('unavailable')
      const lines = () =>
        s.page.host.querySelectorAll<HTMLElement>('[data-cy="provider-limit-history"]')
      expect(lines()).toHaveLength(2)
      for (const line of lines())
        expect(line.textContent).toContain('Last known: stopped at Claude’s limit · as of ')
      const team = () =>
        s.page.q(`team-conversation-${s.record.sessionId}`).querySelector<HTMLElement>('.team-now')!
      expect(team().title).toContain('Last known: stopped at Claude’s limit')
      const old = deferred<ResumableSessionInfo[]>()
      s.list(() => old.promise)
      const reading = s.rail.value!.refreshResumable()
      const retired = { providerBlockLastKnown: null }
      await (door === 'state' ? s.live(retired) : s.state(retired))
      s.check('unavailable')
      expect(lines()).toHaveLength(0)
      expect(team().title).not.toContain('Last known:')
      old.resolve([listed(previous)])
      await reading
      await settle()
      await s.state({})
      s.check('unavailable')
      expect(lines()).toHaveLength(0)
      expect(team().title).not.toContain('Last known:')
      expect(s.store.providerBlocks.get(s.record.sessionId)?.providerBlockLastKnown).toBeNull()
    },
  )
  it('a recorded descriptor cannot revive history retired by a newer root push', async () => {
    const s = await screens()
    const previous = {
      ...unavailable,
      providerBlockLastKnown: { provider: 'claude', resetsAt: null, asOf: NOW },
    } as const
    await s.live(previous)
    await s.store.close(s.record.sessionId)
    const old = deferred<ResumedSession>()
    s.look(() => old.promise)
    const reading = s.store.look(s.record.sessionId, 'again')
    await s.state({ providerBlockLastKnown: null })
    old.resolve(descriptor(previous, 'recorded'))
    expect(await reading).toBe(s.record.sessionId)
    await settle()
    s.check('unavailable')
    expect(s.page.host.querySelectorAll('[data-cy="provider-limit-history"]')).toHaveLength(0)
    expect(s.store.providerBlocks.get(s.record.sessionId)?.providerBlockLastKnown).toBeNull()
  })
  it.each(['state-first', 'liveness-first'] as const)(
    '%s: latest explicit fact wins; omission cannot renew a stale fact',
    async (order) => {
      const s = await screens()
      s.check('stop')
      if (order === 'state-first') {
        await s.state(current)
        await s.live(clear)
        s.check('clear')
      } else {
        await s.live(clear)
        s.check('clear')
        await s.state(current)
        s.check('stop')
      }
      await s.live(unavailable)
      s.check('unavailable')
      await s.state({})
      s.check('unavailable')
      await s.state({ providerBlockStatus: 'current' })
      s.check('unavailable')
      await s.state(clear)
      s.check('clear')
      await s.live({})
      s.check('clear')
      await s.state(current)
      s.check('stop')
    },
  )
  it('an in-flight old list cannot undo a push, while a fresh list can supersede an older record', async () => {
    const s = await screens()
    const old = deferred<ResumableSessionInfo[]>()
    s.list(() => old.promise)
    const refresh = s.rail.value!.refreshResumable()
    await s.live(clear)
    s.check('clear')
    old.resolve([listed(current)])
    await refresh
    await settle()
    s.check('clear')
    s.list(async () => [listed(current)])
    await s.rail.value!.refreshResumable()
    await settle()
    s.check('stop')
    expect(s.record.meta!.providerBlock).toBeNull()
  })
  it('becoming recorded does not resurrect cached list/state facts; later fresh reads still update every surface', async () => {
    const s = await screens()
    await s.state(current)
    await s.live(clear)
    s.check('clear')
    expect(await s.store.close(s.record.sessionId)).toBe(true)
    await settle()
    expect(s.record.phase).toBe('recorded')
    expect(s.store.live.value).toHaveLength(0)
    s.check('clear')
    await s.state(unavailable)
    s.check('unavailable')
    s.list(async () => [listed(current)])
    await s.rail.value!.refreshResumable()
    await settle()
    s.check('stop')
    await s.live(clear)
    s.check('clear')
  })
  it('a recorded descriptor begun before a later push cannot restore its old stop', async () => {
    const s = await screens()
    await s.store.close(s.record.sessionId)
    const old = deferred<ResumedSession>()
    s.look(() => old.promise)
    const reading = s.store.look(s.record.sessionId, 'again')
    await s.state(clear)
    s.check('clear')
    old.resolve(descriptor(current, 'recorded'))
    expect(await reading).toBe(s.record.sessionId)
    await settle()
    s.check('clear')
    s.look(async () => descriptor(current, 'recorded'))
    await s.store.look(s.record.sessionId, 'again')
    await settle()
    s.check('stop')
  })
})
