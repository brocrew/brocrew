import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { DEFAULT_CAPABILITIES, MAX_CAPABILITY_COUNT } from '../../src/shared/capabilities'
import type {
  AgentIdentities,
  AgentIdentity,
  AgentProviderSet,
  ModelList,
  RuntimeBridge,
} from '../../src/shared/runtime-ipc'
import { compatibilityConnections } from '../provider-connection-fixture'
import { mount, unmountAll, type Mounted } from './harness'

afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

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
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

function sheetHost() {
  let identity = person()
  let held: Awaited<ReturnType<RuntimeBridge['agentModelAndEffort']>> = null
  const host = {
    agentIdentities: vi.fn(async (): Promise<AgentIdentities> => ({
      identities: [identity],
      foldersWithoutARow: [],
      use: [],
      spawningEnabled: true,
      defaultApprovalMode: 'ask',
      externalMcpServers: [],
    })),
    setCapabilities: vi.fn(async (input: Parameters<RuntimeBridge['setCapabilities']>[0]) => {
      structuredClone(input)
      identity = {
        ...identity,
        capabilities: {
          ...identity.capabilities,
          canWriteRules: input.grant.canWriteRules ?? 'none',
        },
      }
      return identity
    }),
    setAgentProvider: vi.fn(
      async (
        input: Parameters<RuntimeBridge['setAgentProvider']>[0],
      ): Promise<AgentProviderSet> => {
        structuredClone(input)
        identity = { ...identity, provider: input.provider }
        return { ...identity, modelChoiceCleared: null } satisfies AgentProviderSet
      },
    ),
    providerConnections: vi.fn(async () => compatibilityConnections()),
    agentModelAndEffort: vi.fn(async () => held),
    setAgentModelAndEffort: vi.fn(async (
      input: Parameters<RuntimeBridge['setAgentModelAndEffort']>[0],
    ): Promise<Awaited<ReturnType<RuntimeBridge['setAgentModelAndEffort']>>> => {
      structuredClone(input)
      identity = { ...identity, provider: input.provider }
      held = input.provider === null ? null : {
        provider: input.provider,
        ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
        model: input.model!,
        effort: input.effort,
      }
      return { ok: true, choice: held }
    }),
    agentInstructions: vi.fn(async () => ({
      own: { identity: 'fictional-worker', versions: [] },
      waiting: [],
      readAt: 1_700_000_000_000,
    })),
    modelList: vi.fn(async ({ provider }: { provider: 'claude' | 'codex' }): Promise<ModelList> => ({
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
    })),
    addHandAddedModel: vi.fn(async () => []),
    deleteHandAddedModel: vi.fn(async () => []),
  }
  Reflect.set(window, 'api', { runtime: host })
  const store = createAgentStore(host as unknown as RuntimeBridge)
  const close = vi.fn()
  const m = mount(CapabilitiesSheet, {
    profileSlug: 'fictional-worker',
    runsOn: 'codex',
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
    expect(host.setCapabilities).not.toHaveBeenCalled()
  })

  it.each(['ctrlKey', 'metaKey'] as const)(
    '%s + Enter saves once while pending, leaves a refusal visible, and lets the next press retry',
    async (modifier) => {
      const { m, host, store, close } = sheetHost()
      await store.load()
      await nextTick()
      const pending = deferred<AgentIdentity>()
      host.setCapabilities.mockImplementationOnce((input) => {
        structuredClone(input)
        return pending.promise
      })
      await pick(m, 'capability-canMessage-select', 'any')
      enter(m, null)
      expect(host.setCapabilities).not.toHaveBeenCalled()
      enter(m, modifier)
      await nextTick()
      expect(words(m.q('capabilities-save'))).toBe('Saving…')
      expect(button(m, 'capabilities-save').disabled).toBe(true)
      button(m, 'capabilities-save').click()
      enter(m, modifier)
      expect(host.setCapabilities).toHaveBeenCalledTimes(1)
      expect(host.setCapabilities).toHaveBeenLastCalledWith({
        profileId: 'fictional-worker',
        externalMcpServerIds: [],
        grant: {
          maxDepth: null,
          canMessage: 'any',
          canAssignWork: null,
          canCreateAgents: null,
          canWriteRules: null,
        },
      })
      pending.reject(new Error('The fictional host did not save this grant.'))
      await expect.poll(() => m.all('capabilities-save-refusal').length).toBe(1)
      expect(words(m.q('capabilities-save-refusal'))).toBe(
        'The fictional host did not save this grant.',
      )
      expect(words(m.q('capabilities-save'))).toBe('Save')
      expect(button(m, 'capabilities-save').disabled).toBe(false)
      expect(close).not.toHaveBeenCalled()
      enter(m, modifier)
      await expect.poll(() => close.mock.calls.length).toBe(1)
      expect(host.setCapabilities).toHaveBeenCalledTimes(2)
      expect(m.all('capabilities-save-refusal')).toHaveLength(0)
    },
  )

  it.each([
    { typed: '-1', expected: 0 },
    { typed: String(MAX_CAPABILITY_COUNT + 1), expected: MAX_CAPABILITY_COUNT },
  ])(
    'corrects a count of $typed on screen and sends the corrected value',
    async ({ typed, expected }) => {
      const { m, host, store, close } = sheetHost()
      await store.load()
      await nextTick()
      const input = m.q('capability-maxDepth-input') as HTMLInputElement
      input.value = typed
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()
      expect(input.value).toBe(String(expected))
      expect(words(m.q('capability-maxDepth-state'))).toBe('Set on this identity')
      button(m, 'capabilities-save').click()
      await expect.poll(() => close.mock.calls.length).toBe(1)
      expect(host.setCapabilities.mock.calls[0]![0].grant.maxDepth).toBe(expected)
    },
  )

  it('keeps the last count when its input is cleared partway through editing', async () => {
    const { m, host, store, close } = sheetHost()
    await store.load()
    await nextTick()
    const input = m.q('capability-maxDepth-input') as HTMLInputElement
    for (const value of ['7', '']) {
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()
    }
    button(m, 'capabilities-save').click()
    await expect.poll(() => close.mock.calls.length).toBe(1)
    expect(host.setCapabilities.mock.calls[0]![0].grant.maxDepth).toBe(7)
  })

  it('disables the provider control while writing and restores the saved provider after a refusal', async () => {
    const { m, host, store } = sheetHost()
    await store.load()
    await nextTick()
    const pending = deferred<Awaited<ReturnType<RuntimeBridge['setAgentModelAndEffort']>>>()
    host.setAgentModelAndEffort.mockImplementationOnce((input) => {
      structuredClone(input)
      return pending.promise
    })
    await expect.poll(() => m.all('model-picker-face').length).toBe(1)
    button(m, 'model-picker-face').click()
    await expect.poll(() => m.all('model-picker-connection').length).toBe(1)
    await pick(m, 'model-picker-connection', 'claude:sign-in')
    await expect.poll(() => m.all('model-picker-row').length).toBe(1)
    m.q('model-picker-row').querySelector('input')!.click()
    await nextTick()
    const take = button(m, 'model-picker-take')
    take.click()
    await nextTick()
    expect(take.disabled).toBe(true)
    take.click()
    expect((m.q('model-picker-connection') as HTMLSelectElement).value).toBe('claude:sign-in')
    expect(host.setAgentModelAndEffort).toHaveBeenCalledExactlyOnceWith({
      profileId: 'fictional-worker',
      provider: 'claude',
      connectionId: 'claude:sign-in',
      model: 'fictional-model',
      effort: 'high',
    })
    expect(host.setAgentProvider).not.toHaveBeenCalled()
    expect(host.setCapabilities).not.toHaveBeenCalled()
    pending.reject(new Error('The fictional host kept the previous provider.'))
    await expect.poll(() => m.all('model-picker-refusal').length).toBe(1)
    expect(words(m.q('model-picker-refusal'))).toBe('The fictional host kept the previous provider.')
    expect(take.disabled).toBe(false)
    expect(words(m.q('model-picker-face'))).toContain('Codex')
    take.click()
    await expect.poll(() => m.q('model-picker-panel').matches(':popover-open')).toBe(false)
    await store.load()
    await nextTick()
    await expect.poll(() => words(m.q('model-picker-face'))).toBe(
      'Claude · Fictional subscription · fictional-model · high',
    )
    expect(store.identities.value?.identities[0]?.provider).toBe('claude')
    expect(host.setAgentModelAndEffort).toHaveBeenCalledTimes(2)
    expect(host.setCapabilities).not.toHaveBeenCalled()
  })
})
