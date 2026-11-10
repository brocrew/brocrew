import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { toRaw, watchSyncEffect, type Ref } from 'vue'
import type { AgentIdentities, RuntimeBridge } from '../src/shared/runtime-ipc'
import { useAgentStore } from '../src/renderer/src/composables/useAgentStore'
import { createAgentStore, type AgentStore } from '../src/renderer/src/lib/agent-store'

const roster = (): AgentIdentities => ({
  identities: [],
  foldersWithoutARow: ['worker'],
  use: [],
  spawningEnabled: false,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
})

function world() {
  const list = roster()
  const read = vi.fn<RuntimeBridge['agentIdentities']>().mockResolvedValue(list)
  const spawning = vi.fn<RuntimeBridge['setSpawningEnabled']>()
  const store = createAgentStore({
    agentIdentities: read,
    setSpawningEnabled: spawning,
  } as unknown as RuntimeBridge)
  return { list, read, spawning, store }
}

describe('agent store ownership', () => {
  it('exposes readonly state refs through both the factory and the singleton', () => {
    expectTypeOf<Pick<AgentStore, 'identities' | 'loaded' | 'loadError'>>().toEqualTypeOf<{
      readonly identities: Readonly<Ref<AgentIdentities | null>>
      readonly loaded: Readonly<Ref<boolean>>
      readonly loadError: Readonly<Ref<string | null>>
    }>()
    expectTypeOf<ReturnType<typeof createAgentStore>>().toEqualTypeOf<AgentStore>()
    expectTypeOf<ReturnType<typeof useAgentStore>>().toEqualTypeOf<AgentStore>()
  })

  it('keeps ref and roster identity, reactive updates and the last list after a failed read', async () => {
    const { store, list, read } = world()
    const { identities, loaded, loadError } = store
    const seen: boolean[] = []
    const stop = watchSyncEffect(() => {
      seen.push(store.loaded.value)
    })
    try {
      expect(store.identities.value).toBeNull()
      expect(store.loadError.value).toBeNull()
      await store.load()
      const held = store.identities.value
      expect(toRaw(held)).toBe(list)
      await store.load()
      expect(store.identities.value).toBe(held)
      read.mockRejectedValueOnce(new Error('roster unavailable'))
      await store.load()
      expect(store.identities.value).toBe(held)
      expect(store.loadError.value).toBe('roster unavailable')
      await store.load()
      expect(store.loadError.value).toBeNull()
      expect(store.identities).toBe(identities)
      expect(store.loaded).toBe(loaded)
      expect(store.loadError).toBe(loadError)
      expect(seen).toEqual([false, true])
      expect(read).toHaveBeenCalledTimes(4)
    } finally {
      stop()
    }
  })

  it('patches only through the operation and preserves list identity when the write fails', async () => {
    const { store, spawning, read } = world()
    await store.load()
    const held = store.identities.value
    const seen: (boolean | undefined)[] = []
    const stop = watchSyncEffect(() => {
      seen.push(store.identities.value?.spawningEnabled)
    })
    try {
      spawning.mockResolvedValueOnce({ spawningEnabled: true })
      expect(await store.setSpawning(true)).toBeNull()
      const changed = store.identities.value
      expect(changed).not.toBe(held)
      expect(changed?.identities).toBe(held?.identities)
      expect(changed?.foldersWithoutARow).toBe(held?.foldersWithoutARow)
      expect(changed?.spawningEnabled).toBe(true)
      spawning.mockRejectedValueOnce(new Error('write unavailable'))
      expect(await store.setSpawning(false)).toBe('write unavailable')
      expect(store.identities.value).toBe(changed)
      expect(seen).toEqual([false, true])
      expect(spawning.mock.calls).toEqual([[{ enabled: true }], [{ enabled: false }]])
      expect(read).toHaveBeenCalledTimes(1)
    } finally {
      stop()
    }
  })
})
