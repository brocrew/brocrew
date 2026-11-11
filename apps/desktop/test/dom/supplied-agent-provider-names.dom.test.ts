import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, ref, type Component } from 'vue'
import { providerDescriptor } from '@brobot2/shared'
import type { ClientApi } from '../../src/shared/client-api'
import type { ClientAgentApi } from '../../src/shared/client-agent-api'
import type { AgentModelChoice as Choice } from '../../src/shared/model-choice-contracts'
import type { AgentIdentities, AgentIdentity, Provider } from '../../src/shared/runtime-ipc'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { agentStoreForClient } from '../../src/renderer/src/client-provider/agent-store'
import AgentModelChoice from '../../src/renderer/src/components/AgentModelChoice.vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import NewAgent from '../../src/renderer/src/components/NewAgent.vue'
import StartAsAgent from '../../src/renderer/src/components/StartAsAgent.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { mount, unmountAll, type Mounted } from './harness'

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

function identity(provider: Provider | null): AgentIdentity {
  return {
    id: 'aid:worker',
    slug: 'worker',
    displayName: 'Worker',
    createdAt: 1700000000000,
    createdBy: null,
    provider,
    externalMcpServerIds: [],
    capabilities: DEFAULT_CAPABILITIES,
    chosen: {
      maxDepth: 'default',
      canMessage: 'default',
      canAssignWork: 'default',
      canCreateAgents: 'default',
      canWriteRules: 'default',
    },
  }
}

function fixture(names = ['Fern', 'Birch'], held: Choice | null = null) {
  let row = identity('claude')
  const catalogue = (['claude', 'codex'] as const).map((id, index) => ({
    ...providerDescriptor(id),
    displayName: names[index]!,
  }))
  const reading = (): AgentIdentities => ({
    identities: [row],
    foldersWithoutARow: [],
    use: [],
    spawningEnabled: true,
    defaultApprovalMode: 'ask',
    externalMcpServers: [],
  })
  const createAgent = vi.fn(async () => row)
  const setAgentProvider = vi.fn(
    async (input: { profileId: string; provider: Provider | null }) => {
      const cleared =
        held && input.provider !== null && held.provider !== input.provider ? held : null
      row = { ...row, provider: input.provider }
      if (cleared) held = null
      return { ...row, modelChoiceCleared: cleared }
    },
  )
  const agents = {
    agentIdentities: async () => reading(),
    createAgent,
    setAgentProvider,
    agentModelAndEffort: async () => held,
    agentInstructions: async () => {
      throw new Error('No instruction reading in this fixture')
    },
  } as unknown as ClientAgentApi
  const providerCatalogue = vi.fn(async () => catalogue)
  const client: ClientApi = {
    ...createDesktopProviderApi(
      (): never => {
        throw new Error('Unexpected provider operation')
      },
      () => undefined,
    ),
    agents,
    providerCatalogue,
  }
  const rawCatalogue = vi.fn(async () =>
    (['claude', 'codex'] as const).map((id) => providerDescriptor(id)),
  )
  vi.stubGlobal('api', { runtime: { providerCatalogue: rawCatalogue } })
  return {
    client,
    providerCatalogue,
    rawCatalogue,
    catalogue,
    createAgent,
    setAgentProvider,
    reading,
  }
}

function ancestor(client: ClientApi, component: Component, props: () => Record<string, unknown>) {
  return defineComponent({
    setup() {
      provide(CLIENT_PROVIDERS, client)
      return () => h(component, props())
    },
  })
}

async function mountedCapabilitiesSheet(f: ReturnType<typeof fixture>): Promise<Mounted> {
  const store = agentStoreForClient(f.client)
  await store.load()
  const view = mount(
    ancestor(f.client, CapabilitiesSheet, () => ({
      profileSlug: 'worker',
      runsOn: 'claude',
      fields: [],
      store,
    })),
    {},
  )
  return view
}

async function change(element: HTMLElement, value: string, event = 'change') {
  ;(element as HTMLInputElement).value = value
  element.dispatchEvent(new Event(event, { bubbles: true }))
  await nextTick()
}

it('names both NewAgent options from its selected client while retaining the create provider ID', async () => {
  const f = fixture()
  await agentStoreForClient(f.client).load()
  const view = mount(
    ancestor(f.client, NewAgent, () => ({})),
    {},
  )
  const select = view.q('new-agent-provider') as HTMLSelectElement
  await vi.waitFor(() =>
    expect([...select.options].map((option) => option.textContent?.trim())).toEqual([
      'Not chosen yet',
      'Fern',
      'Birch',
    ]),
  )
  expect([...select.options].map((option) => option.value)).toEqual(['', 'claude', 'codex'])
  await change(view.q('new-agent-slug'), 'another-worker', 'input')
  await change(select, 'codex')
  view.q('new-agent-create').click()
  await vi.waitFor(() =>
    expect(f.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'another-worker', provider: 'codex' }),
    ),
  )
  expect(f.rawCatalogue).not.toHaveBeenCalled()
})

it('keeps two selected clients separate and fills late names without restoring compiled labels', async () => {
  const first = fixture()
  const second = fixture(['Willow', 'Elm'])
  let answer!: (rows: typeof first.catalogue) => void
  first.providerCatalogue.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve
      }),
  )
  await agentStoreForClient(first.client).load()
  await agentStoreForClient(second.client).load()
  expect(first.providerCatalogue).not.toHaveBeenCalled()
  const a = mount(
    ancestor(first.client, NewAgent, () => ({})),
    {},
  )
  const b = mount(
    ancestor(second.client, NewAgent, () => ({})),
    {},
  )
  expect(a.q('new-agent-provider').textContent).not.toMatch(/Claude|Codex/)
  expect(a.q('new-agent-provider').textContent).toContain('Provider 1 (name not read)')
  expect(a.q('new-agent-provider').textContent).toContain('Provider 2 (name not read)')
  await vi.waitFor(() => expect(b.q('new-agent-provider').textContent).toContain('Willow'))
  await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
  answer(first.catalogue)
  await vi.waitFor(() => expect(a.q('new-agent-provider').textContent).toContain('Fern'))
  expect(b.q('new-agent-provider').textContent).not.toContain('Fern')
  expect(first.rawCatalogue).not.toHaveBeenCalled()
  expect(second.rawCatalogue).not.toHaveBeenCalled()
})

it('names the StartAsAgent current/default provider and follows the live default prop', async () => {
  const f = fixture()
  const store = agentStoreForClient(f.client)
  await store.load()
  const provider = ref<Provider>('claude')
  const view = mount(
    ancestor(f.client, StartAsAgent, () => ({
      profileSlug: 'worker',
      agents: store,
      provider: provider.value,
      defaultApprovalMode: 'ask',
      capabilities: null,
    })),
    {},
  )
  await vi.waitFor(() =>
    expect(view.q('start-as-agent').textContent).toContain('It will run on Fern'),
  )
  expect(view.q('start-as-agent').textContent).toContain('Default: Fern')
  provider.value = 'codex'
  await vi.waitFor(() =>
    expect(view.q('start-as-agent').textContent).toContain('It will run on Birch'),
  )
  expect(view.q('start-as-agent').textContent).toContain('Default: Birch')
  expect(f.setAgentProvider).not.toHaveBeenCalled()
  expect(f.rawCatalogue).not.toHaveBeenCalled()
})

it('names the held/default choice and the before/after clear without changing the provider intent', async () => {
  const held: Choice = { provider: 'claude', model: 'held-model', effort: 'high' }
  const f = fixture(undefined, held)
  const view = await mountedCapabilitiesSheet(f)
  await vi.waitFor(() =>
    expect(view.q('capabilities-provider-will-clear').textContent).toContain('other than Fern'),
  )
  expect(view.q('capabilities-provider-select').textContent).toContain('Birch')
  expect(view.q('capabilities-provider-note').textContent).toContain('is Fern')
  expect(view.q('agent-model-reaches').textContent).toContain('on Fern')
  await change(view.q('capabilities-provider-select'), 'codex')
  await vi.waitFor(() =>
    expect(f.setAgentProvider).toHaveBeenCalledExactlyOnceWith({
      profileId: 'worker',
      provider: 'codex',
    }),
  )
  await vi.waitFor(() =>
    expect(view.q('capabilities-provider-cleared').textContent).toContain('on Fern'),
  )
  expect(view.q('capabilities-provider-cleared').textContent).toContain('now Birch')
  expect(view.host.querySelector('[data-cy="capabilities-provider-will-clear"]')).toBeNull()
  expect(f.rawCatalogue).not.toHaveBeenCalled()
})

it('uses both supplied names for a held choice that is not in force', async () => {
  const f = fixture(undefined, { provider: 'claude', model: 'held-model', effort: 'high' })
  const store = agentStoreForClient(f.client)
  await store.load()
  const view = mount(
    ancestor(f.client, AgentModelChoice, () => ({
      profileSlug: 'worker',
      runsOn: 'codex',
      itsProvider: 'codex',
      store,
    })),
    {},
  )
  await vi.waitFor(() =>
    expect(view.q('agent-model-other-provider').textContent).toContain('It is for Fern'),
  )
  expect(view.q('agent-model-other-provider').textContent).toContain('runs on Birch')
  expect(view.q('agent-model-held').textContent).toContain('on Fern')
  expect(view.q('agent-model-not-in-force').textContent).toContain('not in force')
  expect(view.host.querySelector('[data-cy="agent-model-reaches"]')).toBeNull()
})

it('uses supplied names on the TeamWorkspace engine fact without changing the provider key', async () => {
  const f = fixture()
  const store = agentStoreForClient(f.client)
  await store.load()
  const view = mount(
    ancestor(f.client, TeamWorkspace, () => ({ agents: f.reading(), store })),
    {},
  )
  await vi.waitFor(() => expect(view.q('team-provider-worker').textContent).toBe('Fern'))
  expect(f.reading().identities[0]?.provider).toBe('claude')
  expect(f.setAgentProvider).not.toHaveBeenCalled()
})

it('refreshes an already cleared choice notice when the selected catalogue answers late', async () => {
  const f = fixture(undefined, { provider: 'claude', model: 'held-model', effort: 'high' })
  let answer!: (rows: typeof f.catalogue) => void
  f.providerCatalogue.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve
      }),
  )
  const view = await mountedCapabilitiesSheet(f)
  await vi.waitFor(() =>
    expect(view.q('capabilities-provider-will-clear').textContent).toContain('the provider'),
  )
  expect(view.q('capabilities-provider-select').textContent).toContain('Provider 2 (name not read)')
  await change(view.q('capabilities-provider-select'), 'codex')
  await vi.waitFor(() =>
    expect(view.q('capabilities-provider-cleared').textContent).toContain('now the provider'),
  )
  expect(f.setAgentProvider).toHaveBeenCalledExactlyOnceWith({
    profileId: 'worker',
    provider: 'codex',
  })
  answer(f.catalogue)
  await vi.waitFor(() =>
    expect(view.q('capabilities-provider-cleared').textContent).toContain('now Birch'),
  )
  expect(view.q('capabilities-provider-cleared').textContent).toContain('on Fern')
  expect(f.setAgentProvider).toHaveBeenCalledTimes(1)
  expect(view.host.querySelector('[data-cy="capabilities-provider-will-clear"]')).toBeNull()
})

it('keeps an answered empty catalogue generic without disabling or changing provider options', async () => {
  const f = fixture()
  f.providerCatalogue.mockResolvedValue([])
  await agentStoreForClient(f.client).load()
  const view = mount(
    ancestor(f.client, NewAgent, () => ({})),
    {},
  )
  await vi.waitFor(() => expect(f.providerCatalogue).toHaveBeenCalledTimes(1))
  const select = view.q('new-agent-provider') as HTMLSelectElement
  expect([...select.options].map((option) => option.value)).toEqual(['', 'claude', 'codex'])
  expect(select.textContent).toContain('Provider 1 (name not read)')
  expect(select.textContent).toContain('Provider 2 (name not read)')
  expect(select.textContent).not.toMatch(/Claude|Codex|Fern|Birch/)
  expect(select.disabled).toBe(false)
})
