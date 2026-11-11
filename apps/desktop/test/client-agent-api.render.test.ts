import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import type { ClientAgentApi } from '../src/shared/client-agent-api'
import type { ClientApi } from '../src/shared/client-api'
import type { AgentIdentities } from '../src/shared/runtime-ipc'
import {
  agentStoreForClient,
  forgetClientAgentStores,
} from '../src/renderer/src/client-provider/agent-store'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'
import { CLIENT_PROVIDERS } from '../src/renderer/src/client-provider/injection'
import { useAgentStore } from '../src/renderer/src/composables/useAgentStore'
import TeamWorkspace from '../src/renderer/src/components/TeamWorkspace.vue'

function fixture() {
  const list: AgentIdentities = {
    identities: [],
    foldersWithoutARow: [],
    use: [],
    externalMcpServers: [],
    spawningEnabled: false,
    defaultApprovalMode: 'ask',
  }
  const unused = (): never => {
    throw new Error('Unexpected agent operation')
  }
  const read = vi.fn(async () => list)
  const write = vi.fn(async ({ enabled }: { enabled: boolean }) => ({ spawningEnabled: enabled }))
  const agents: ClientAgentApi = {
    agentIdentities: read,
    setSpawningEnabled: write,
    setCapabilities: unused,
    setAgentProvider: unused,
    setAgentDisplayName: unused,
    agentInstructions: unused,
    instructAgent: unused,
    decideInstruction: unused,
    decideMcpServerRequest: unused,
    agentModelAndEffort: unused,
    setAgentModelAndEffort: unused,
    removeAgent: unused,
    createAgent: unused,
    registerExternalMcpServer: unused,
    removeExternalMcpServer: unused,
    setServicesOn: unused,
    setDefaultApprovalMode: unused,
  }
  const api: ClientApi = { ...createDesktopProviderApi(unused, () => undefined), agents }
  return { api, agents, read, write, list }
}

afterEach(forgetClientAgentStores)

describe('the agent store belongs to its injected client', () => {
  it('captures the desktop capability lazily without changing its receiver or pending answer', async () => {
    const { agents, list } = fixture()
    const pending = Promise.resolve(list)
    const transport: ClientAgentApi = {
      ...agents,
      agentIdentities() {
        expect(this).toBe(transport)
        return pending
      },
    }
    let current = transport
    const supplier = vi.fn(() => current)
    const api = createDesktopProviderApi(
      () => {
        throw new Error('Unexpected provider operation')
      },
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      supplier,
    )
    expect(supplier).not.toHaveBeenCalled()
    const store = agentStoreForClient(api)
    current = fixture().agents
    expect(agentStoreForClient(api)).toBe(store)
    expect(supplier).toHaveBeenCalledOnce()
    expect(transport.agentIdentities()).toBe(pending)
    await store.load()
    expect(store.identities.value?.spawningEnabled).toBe(false)
    expect(store.loadError.value).toBeNull()
  })

  it('constructs lazily and shares reads and writes for the same client', async () => {
    const { api, read, write } = fixture()
    const rail = agentStoreForClient(api)
    const sheet = agentStoreForClient(api)
    expect(sheet).toBe(rail)
    expect(read).not.toHaveBeenCalled()
    expect(rail.loaded.value).toBe(false)
    await rail.load()
    expect(sheet.loaded.value).toBe(true)
    expect(await sheet.setSpawning(true)).toBeNull()
    expect(rail.identities.value?.spawningEnabled).toBe(true)
    expect(write.mock.calls).toEqual([[{ enabled: true }]])
  })

  it('isolates distinct clients and their refused writes', async () => {
    const first = fixture()
    const second = fixture()
    const a = agentStoreForClient(first.api)
    const b = agentStoreForClient(second.api)
    expect(a).not.toBe(b)
    await Promise.all([a.load(), b.load()])
    second.write.mockRejectedValueOnce(new Error('Fictional write refusal'))
    expect(await b.setSpawning(true)).toBe('Fictional write refusal')
    expect(b.identities.value?.spawningEnabled).toBe(false)
    expect(await a.setSpawning(true)).toBeNull()
    expect(a.identities.value?.spawningEnabled).toBe(true)
    expect(b.identities.value?.spawningEnabled).toBe(false)
  })

  it('does not poison a client cache when its capability was absent', () => {
    const { api, agents } = fixture()
    const supplied: ClientApi = { ...api, agents: undefined }
    expect(() => agentStoreForClient(supplied)).toThrow(
      'The client does not provide agent reads and intents',
    )
    Object.assign(supplied, { agents })
    const available = agentStoreForClient(supplied)
    expect(agentStoreForClient(supplied)).toBe(available)
    expect(available.loaded.value).toBe(false)
  })

  it('the hot-reload reset forgets holders without loading their replacements', async () => {
    const { api, read } = fixture()
    const before = agentStoreForClient(api)
    await before.load()
    forgetClientAgentStores()
    const after = agentStoreForClient(api)
    expect(after).not.toBe(before)
    expect(after.loaded.value).toBe(false)
    expect(before.loaded.value).toBe(true)
    expect(read).toHaveBeenCalledOnce()
  })

  it('resolves the supplied client during setup without a window or eager read', async () => {
    const { api, read } = fixture()
    const probe = defineComponent({
      setup() {
        const store = useAgentStore()
        expect(store).toBe(agentStoreForClient(api))
        return () => h('p', store.loaded.value ? 'read' : 'not asked')
      },
    })
    const html = await renderToString(createSSRApp(probe).provide(CLIENT_PROVIDERS, api))
    expect(html).toContain('not asked')
    expect(read).not.toHaveBeenCalled()
  })

  it('a real Team surface with an explicit store never asks for the absent capability', async () => {
    const { api, list, read } = fixture()
    const store = agentStoreForClient(api)
    const missing: ClientApi = {
      ...api,
      get agents(): never {
        throw new Error('The explicit store must bypass this capability')
      },
    }
    const app = createSSRApp(TeamWorkspace, { agents: list, store })
    const html = await renderToString(app.provide(CLIENT_PROVIDERS, missing))
    expect(html).toContain('data-cy="team-workspace"')
    expect(html).toContain('data-cy="team-none"')
    expect(read).not.toHaveBeenCalled()
  })
})
