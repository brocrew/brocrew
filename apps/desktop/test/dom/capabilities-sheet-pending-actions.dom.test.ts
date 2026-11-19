import { createModelLists } from '../lib/provider-launch-fixture'
import type { ModelList } from '../../src/shared/model-choice-contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import type {
  AgentIdentities,
  AgentIdentity,
  AgentProviderSet,
  RuntimeBridge,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'

afterEach(unmountAll)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const words = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
const button = (m: Mounted, cy: string): HTMLButtonElement => m.q(cy) as HTMLButtonElement
const person = (): AgentIdentity => ({
  id: 'aid:fictional-worker',
  slug: 'fictional-worker',
  displayName: 'Fictional Worker',
  createdAt: 1_700_000_000_000,
  createdBy: null,
  provider: 'codex',
  externalMcpServerIds: [],
})

function sheetHost(externalMcpServers: AgentIdentities['externalMcpServers'] = []) {
  let identity = person()
  const host = {
    agentIdentities: vi.fn(async (): Promise<AgentIdentities> => ({
      identities: [identity],
      foldersWithoutARow: [],
      use: [],
      defaultApprovalMode: 'ask',
      externalMcpServers,
    })),
    setExternalMcpServers: vi.fn(
      async (input: Parameters<RuntimeBridge['setExternalMcpServers']>[0]) => {
        structuredClone(input)
        identity = { ...identity, externalMcpServerIds: [...input.externalMcpServerIds] }
        return identity
      },
    ),
    setAgentProvider: vi.fn(
      async (
        input: Parameters<RuntimeBridge['setAgentProvider']>[0],
      ): Promise<AgentProviderSet> => {
        structuredClone(input)
        identity = { ...identity, provider: input.provider }
        return { ...identity, modelChoiceCleared: null } satisfies AgentProviderSet
      },
    ),
    agentModelAndEffort: vi.fn(async () => null),
    agentInstructions: vi.fn(async () => ({
      own: { identity: 'fictional-worker', versions: [] },
      waiting: [],
      readAt: 1_700_000_000_000,
    })),
    modelList: vi.fn(async (): Promise<ModelList> => ({
      provider: 'codex',
      models: [],
      notAsked: null,
      standIn: null,
      lastPicked: null,
      startsOn: null,
    })),
    addHandAddedModel: vi.fn(async () => []),
    deleteHandAddedModel: vi.fn(async () => []),
  }
  const store = createAgentStore(host as unknown as RuntimeBridge)
  const close = vi.fn()
  const m = mount(CapabilitiesSheet, {
    profileSlug: 'fictional-worker',
    runsOn: 'codex',
    capabilities: { codex: { externalMcpServers: { state: 'available' } } },
    store,
    lists: createModelLists(() => host),
    onClose: close,
  })
  return { m, host, store, close }
}

async function pick(m: Mounted, cy: string, value: string): Promise<void> {
  const select = m.q(cy) as HTMLSelectElement
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}

function enter(m: Mounted, modifier: 'ctrlKey' | 'metaKey' | null): void {
  m.q('capabilities-sheet').dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      ...(modifier === null ? {} : { [modifier]: true }),
    }),
  )
}

describe('capabilities sheet pending actions', () => {
  it('shows a pending read, a refused read, and the recovered controls without offering Save early', async () => {
    const { m, host, store } = sheetHost()
    const pending = deferred<AgentIdentities>()
    host.agentIdentities.mockImplementationOnce(() => pending.promise)
    const reading = store.load()
    await nextTick()
    expect(words(m.q('capabilities-loading'))).toBe('Reading the agent identities…')
    expect(m.all('capabilities-save')).toHaveLength(0)
    expect(m.all('capabilities-provider-select')).toHaveLength(0)
    pending.reject(new Error('The fictional roster could not be read.'))
    await reading
    await nextTick()
    expect(words(m.q('capabilities-load-error'))).toBe('The fictional roster could not be read.')
    expect(m.all('capabilities-save')).toHaveLength(0)
    await store.load()
    await nextTick()
    expect(words(m.q('capabilities-title'))).toBe('Fictional Worker')
    expect(button(m, 'capabilities-save').disabled).toBe(false)
    expect(m.all('capabilities-load-error')).toHaveLength(0)
    expect(host.setExternalMcpServers).not.toHaveBeenCalled()
  })

  it.each(['ctrlKey', 'metaKey'] as const)(
    '%s + Enter saves once while pending, leaves a refusal visible, and lets the next press retry',
    async (modifier) => {
      const { m, host, store, close } = sheetHost()
      await store.load()
      await nextTick()
      const pending = deferred<AgentIdentity>()
      host.setExternalMcpServers.mockImplementationOnce((input) => {
        structuredClone(input)
        return pending.promise
      })
      enter(m, null)
      expect(host.setExternalMcpServers).not.toHaveBeenCalled()
      enter(m, modifier)
      await nextTick()
      expect(words(m.q('capabilities-save'))).toBe('Saving…')
      expect(button(m, 'capabilities-save').disabled).toBe(true)
      button(m, 'capabilities-save').click()
      enter(m, modifier)
      expect(host.setExternalMcpServers).toHaveBeenCalledTimes(1)
      expect(host.setExternalMcpServers).toHaveBeenLastCalledWith({
        profileId: 'fictional-worker',
        externalMcpServerIds: [],
      })
      pending.reject(new Error('The fictional host did not save these servers.'))
      await expect.poll(() => m.all('capabilities-save-refusal').length).toBe(1)
      expect(words(m.q('capabilities-save-refusal'))).toBe(
        'The fictional host did not save these servers.',
      )
      expect(words(m.q('capabilities-save'))).toBe('Save')
      expect(button(m, 'capabilities-save').disabled).toBe(false)
      expect(close).not.toHaveBeenCalled()
      enter(m, modifier)
      await expect.poll(() => close.mock.calls.length).toBe(1)
      expect(host.setExternalMcpServers).toHaveBeenCalledTimes(2)
      expect(m.all('capabilities-save-refusal')).toHaveLength(0)
    },
  )

  it('keeps a server checkbox edit made during a save visible and unsaved', async () => {
    const { m, host, store, close } = sheetHost([
      {
        id: 'ems:reference',
        name: 'reference',
        url: 'http://127.0.0.1:4010/mcp',
        registeredAt: 1,
        reach: 'restricted',
      },
    ])
    await store.load()
    await nextTick()
    const pending = deferred<void>()
    const write = host.setExternalMcpServers.getMockImplementation()!
    host.setExternalMcpServers.mockImplementationOnce(async (input) => {
      await pending.promise
      return write(input)
    })
    const checkbox = m.q('external-mcp-grant-reference').querySelector('input')!
    const save = button(m, 'capabilities-save')
    expect(checkbox.checked).toBe(false)
    checkbox.click()
    await nextTick()
    expect(checkbox.checked).toBe(true)
    save.click()
    await nextTick()
    expect(save.disabled).toBe(true)
    expect(checkbox.disabled).toBe(false)
    expect(host.setExternalMcpServers).toHaveBeenCalledExactlyOnceWith({
      profileId: 'fictional-worker',
      externalMcpServerIds: ['ems:reference'],
    })

    checkbox.click()
    await nextTick()
    expect(checkbox.checked).toBe(false)
    pending.resolve()
    await expect.poll(() => save.disabled).toBe(false)
    expect(host.setExternalMcpServers).toHaveBeenCalledTimes(1)
    expect(store.identities.value?.identities[0]?.externalMcpServerIds).toEqual(['ems:reference'])
    expect(checkbox.checked).toBe(false)
    expect(close).not.toHaveBeenCalled()

    save.click()
    await expect.poll(() => close.mock.calls.length).toBe(1)
    expect(host.setExternalMcpServers).toHaveBeenCalledTimes(2)
    expect(host.setExternalMcpServers).toHaveBeenLastCalledWith({
      profileId: 'fictional-worker',
      externalMcpServerIds: [],
    })
    expect(store.identities.value?.identities[0]?.externalMcpServerIds).toEqual([])
  })

  it('disables the provider control while writing and restores the saved provider after a refusal', async () => {
    const { m, host, store } = sheetHost()
    await store.load()
    await nextTick()
    const pending = deferred<AgentProviderSet>()
    host.setAgentProvider.mockImplementationOnce((input) => {
      structuredClone(input)
      return pending.promise
    })
    await pick(m, 'capabilities-provider-select', 'claude')
    const select = m.q('capabilities-provider-select') as HTMLSelectElement
    expect(select.disabled).toBe(true)
    expect(select.value).toBe('claude')
    expect(host.setAgentProvider).toHaveBeenCalledExactlyOnceWith({
      profileId: 'fictional-worker',
      provider: 'claude',
    })
    expect(host.setExternalMcpServers).not.toHaveBeenCalled()
    pending.reject(new Error('The fictional host kept the previous provider.'))
    await expect.poll(() => m.all('capabilities-provider-error').length).toBe(1)
    expect(words(m.q('capabilities-provider-error'))).toBe(
      'The fictional host kept the previous provider.',
    )
    expect(select.disabled).toBe(false)
    expect(select.value).toBe('codex')
    await pick(m, 'capabilities-provider-select', 'claude')
    await expect.poll(() => m.all('capabilities-provider-error').length).toBe(0)
    expect(select.disabled).toBe(false)
    expect(select.value).toBe('claude')
    expect(host.setAgentProvider).toHaveBeenCalledTimes(2)
    expect(host.setExternalMcpServers).not.toHaveBeenCalled()
  })
})
