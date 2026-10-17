import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { ItsProvider } from '../../src/shared/agent-roster'
import type { AgentIdentities, AgentIdentity, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * An agent whose conversations ran on both providers, with none saved, can be started by no agent
 * until a person chooses — so a person is told where they look: on its sheet, on its Team card, and
 * on "Waiting on you" as something of theirs to settle, with a door to the sheet.
 */

const MIXED: ItsProvider = {
  provider: null,
  from: 'its-conversations-differ',
  startedOn: { claude: 2, codex: 1 },
}

const identity = (slug: string, over: Partial<AgentIdentity> = {}): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName: null,
  createdAt: 1_700_000_000_000,
  createdBy: null,
  provider: null,
  externalMcpServerIds: [],
  capabilities: DEFAULT_CAPABILITIES,
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
  ...over,
})

const use = (slug: string, runsOn: ItsProvider) => ({
  slug,
  conversations: 3,
  thisAppMintsIt: false,
  isLaunching: false,
  isStarting: false,
  runsOn,
})

const roster = (runsOn: ItsProvider): AgentIdentities => ({
  identities: [identity('ana', { displayName: 'Ana' }), identity('ida', { displayName: 'Ida' })],
  foldersWithoutARow: [],
  use: [use('ana', runsOn), use('ida', { provider: 'codex', from: 'its-conversations' })],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
})

const storeOver = (list: AgentIdentities): AgentStore =>
  createAgentStore({
    agentIdentities: async () => list,
    setCapabilities: async () => list.identities[0] ?? null,
    setSpawningEnabled: async () => ({ spawningEnabled: true }),
    setAgentProvider: async () => null,
  } as unknown as RuntimeBridge)

afterEach(unmountAll)

describe('the sheet says it first', () => {
  it('a mixed agent’s sheet says to choose, and how many conversations ran on each', async () => {
    const store = storeOver(roster(MIXED))
    await store.load()
    const m = mount(CapabilitiesSheet, { profileSlug: 'ana', runsOn: 'codex', store })
    await nextTick()

    expect(m.q('capabilities-provider-not-chosen').textContent?.trim()).toBe(
      'Choose a provider for this agent: its conversations ran on Claude (2) and Codex (1), so no agent can start a new conversation with it until a person chooses one on its sheet.',
    )
    expect(m.all('capabilities-provider-note')).toEqual([])
    const empty = m.q('capabilities-provider-select').querySelector('option[value=""]')
    expect(empty?.textContent?.trim()).toBe('Not chosen: its conversations ran on both')
  })

  it('the control: an agent its conversations name says what they ran on, and no warning', async () => {
    const store = storeOver(roster({ provider: 'claude', from: 'its-conversations' }))
    await store.load()
    const m = mount(CapabilitiesSheet, { profileSlug: 'ana', runsOn: 'claude', store })
    await nextTick()

    expect(m.all('capabilities-provider-not-chosen')).toEqual([])
    expect(m.q('capabilities-provider-note').textContent).toContain('Claude')
    const empty = m.q('capabilities-provider-select').querySelector('option[value=""]')
    expect(empty?.textContent?.trim()).toBe('Not saved: its conversations ran on Claude')
  })
})

describe('the Team card names it', () => {
  it('its engine line says it is not chosen, with its conversations on both', () => {
    const list = roster(MIXED)
    const m = mount(TeamWorkspace, {
      agents: list,
      store: { renameTo: vi.fn(), remove: vi.fn() } as unknown as AgentStore,
    })
    expect(m.q('team-provider-ana').textContent?.trim()).toBe(
      'Not chosen: its conversations ran on both',
    )
    expect(m.q('team-provider-ida').textContent?.trim()).toBe('codex')
  })
})

describe('"Waiting on you" counts it as a person’s to settle, with a door to its sheet', () => {
  it('a line names the agent, it is counted, and its door opens that agent’s sheet', async () => {
    const opened: string[] = []
    const m = mount(WaitingOnYou, {
      agents: roster(MIXED),
      clock: 1_700_000_000_000,
      onOpenAgent: (slug: string) => opened.push(slug),
    })

    expect(m.q('waiting-provider-not-chosen-ana').textContent).toContain(
      'Choose a provider for Ana: its conversations ran on Claude (2) and Codex (1)',
    )
    expect(m.all('waiting-provider-not-chosen-ida')).toEqual([])
    // ⚑ A person's to settle: counted in the group and in what they owe.
    expect(m.q('provider-not-chosen-count').textContent?.trim()).toBe('1')
    expect(m.q('waiting-stat').textContent?.trim()).toBe('1 item')

    m.q('waiting-provider-choose-ana').click()
    await nextTick()
    expect(opened).toEqual(['ana'])
  })

  it('the control: nothing is drawn when no agent is mixed, or the roster is not read yet', () => {
    const none = mount(WaitingOnYou, {
      agents: roster({ provider: 'claude', from: 'saved' }),
      clock: 1_700_000_000_000,
    })
    expect(none.all('waiting-provider-not-chosen')).toEqual([])
    unmountAll()
    const unread = mount(WaitingOnYou, { agents: null, clock: 1_700_000_000_000 })
    expect(unread.all('waiting-provider-not-chosen')).toEqual([])
  })
})
