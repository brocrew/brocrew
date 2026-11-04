import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { ItsProvider } from '../../src/shared/agent-roster'
import type { AgentIdentities, AgentIdentity, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { compatibilityConnections } from '../provider-connection-fixture'
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

function storeOver(list: AgentIdentities) {
  let held: Awaited<ReturnType<RuntimeBridge['agentModelAndEffort']>> = null
  const host = {
    providerConnections: async () => compatibilityConnections(),
    agentIdentities: async () => list,
    setCapabilities: async () => list.identities[0] ?? null,
    setSpawningEnabled: async () => ({ spawningEnabled: true }),
    setAgentProvider: vi.fn(async () => null),
    agentModelAndEffort: async () => held,
    setAgentModelAndEffort: vi.fn(async (
      input: Parameters<RuntimeBridge['setAgentModelAndEffort']>[0],
    ): Promise<Awaited<ReturnType<RuntimeBridge['setAgentModelAndEffort']>>> => {
      structuredClone(input)
      const { provider, model, effort, connectionId } = input
      if (provider === null || model === null || connectionId === undefined) {
        throw new Error('choose a fictional connection and model')
      }
      held = { provider, connectionId, model, effort }
      list = {
        ...list,
        identities: list.identities.map((one) =>
          one.slug === input.profileId ? { ...one, provider, connectionId } : one,
        ),
        use: list.use.map((one) =>
          one.slug === input.profileId
            ? { ...one, runsOn: { provider, from: 'saved' as const } }
            : one,
        ),
      }
      return { ok: true, choice: held }
    }),
    modelList: async ({ provider }: { provider: 'claude' | 'codex' }) => ({
      provider,
      models: [{
        id: 'fictional-model',
        label: 'Fictional model',
        addedBy: 'the-provider',
        efforts: [{ id: 'high', label: 'High' }],
        defaultEffort: 'high',
      }],
      notAsked: null,
      standIn: null,
      lastPicked: null,
      startsOn: null,
    }),
  } as unknown as RuntimeBridge
  Reflect.set(window, 'api', { runtime: host })
  return { store: createAgentStore(host), lists: createModelLists(() => host), host }
}

afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

describe('the sheet says it first', () => {
  it('a mixed agent’s sheet says to choose, and how many conversations ran on each', async () => {
    const { store, lists, host } = storeOver(roster(MIXED))
    await store.load()
    const m = mount(CapabilitiesSheet, { profileSlug: 'ana', runsOn: 'codex', store, lists })
    await nextTick()

    expect(m.all('capabilities-provider-select')).toHaveLength(0)
    expect(m.all('capabilities-provider-note')).toHaveLength(0)
    expect(m.all('capabilities-provider-not-chosen')).toHaveLength(0)
    expect(m.q('capabilities-title').textContent?.trim()).toBe('Ana')
    await expect.poll(() => m.all('model-picker-face').length).toBe(1)
    m.q('model-picker-face').click()
    await expect.poll(() => m.all('model-picker-connection').length).toBe(1)
    const select = m.q('model-picker-connection') as HTMLSelectElement
    expect([...select.options].map((one) => one.textContent?.trim())).toEqual([
      'Claude · Fictional subscription',
      'Codex · Fictional subscription',
    ])
    select.value = 'codex:sign-in'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    await expect.poll(() => m.all('model-picker-row').length).toBe(1)
    m.q('model-picker-row').querySelector('input')!.click()
    await nextTick()
    m.q('model-picker-take').click()
    await expect.poll(() => m.q('model-picker-panel').matches(':popover-open')).toBe(false)
    expect(host.setAgentModelAndEffort).toHaveBeenCalledExactlyOnceWith({
      profileId: 'ana',
      provider: 'codex',
      connectionId: 'codex:sign-in',
      model: 'fictional-model',
      effort: 'high',
    })
    expect(host.setAgentProvider).not.toHaveBeenCalled()
    await store.load()
    await nextTick()
    expect(store.identities.value?.identities.find((one) => one.slug === 'ana')?.provider).toBe(
      'codex',
    )
    expect(m.q('model-picker-face').textContent).toContain('fictional-model')
  })

  it('the control: an agent its conversations name says what they ran on, and no warning', async () => {
    const { store, lists } = storeOver(roster({ provider: 'claude', from: 'its-conversations' }))
    await store.load()
    const m = mount(CapabilitiesSheet, { profileSlug: 'ana', runsOn: 'claude', store, lists })
    await nextTick()

    expect(m.all('capabilities-provider-not-chosen')).toEqual([])
    expect(m.all('capabilities-provider-note')).toHaveLength(0)
    expect(m.all('capabilities-provider-select')).toHaveLength(0)
    await expect.poll(() => m.all('model-picker-face').length).toBe(1)
    m.q('model-picker-face').click()
    await expect.poll(() => m.all('model-picker-connection').length).toBe(1)
    expect((m.q('model-picker-connection') as HTMLSelectElement).value).toBe('claude:sign-in')
    await expect.poll(() => m.all('model-picker-row').length).toBe(1)
    expect(m.q('model-picker-row').textContent).toContain('Fictional model')
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
