import { describe, expect, it, vi } from 'vitest'
import { createAgentStore, type AgentStore } from '../src/renderer/src/lib/agent-store'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import type { AgentIdentities, AgentIdentity, RuntimeBridge } from '../src/shared/runtime-ipc'
import { WHERE_AGENTS_ARE_CREATED } from '../src/renderer/src/lib/where-agents-are-created'

const identity = (slug: string): AgentIdentity => ({
  id: `identity:${slug}`,
  slug,
  displayName: slug,
  provider: null,
  createdAt: 1,
  createdBy: null,
  externalMcpServerIds: [],
  capabilities: DEFAULT_CAPABILITIES,
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

const roster = (identities: AgentIdentity[]): AgentIdentities => ({
  identities,
  foldersWithoutARow: ['not-registered'],
  use: [],
  externalMcpServers: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
})

const before = identity('worker')
const neighbour = identity('neighbour')
const saved = {
  ...before,
  displayName: 'New name',
  provider: 'codex' as const,
  capabilities: { ...DEFAULT_CAPABILITIES, maxDepth: 2 },
  modelChoiceCleared: { provider: 'claude' as const, model: 'sonnet', effort: 'high' },
}
const initial = roster([neighbour, before])
const missing = `There is no agent identity called worker, so there is nothing to configure. Create it ${WHERE_AGENTS_ARE_CREATED}, or one appears once a conversation has run as it.`

interface Action {
  name: string
  invoke(store: AgentStore): Promise<unknown>
  input: unknown
  success: unknown
  refusal(reason: string): unknown
  missing: unknown
}

const actions: Action[] = [
  {
    name: 'capabilities',
    invoke: (store) => store.save('worker', DEFAULT_CAPABILITIES, ['server']),
    input: { profileId: 'worker', grant: DEFAULT_CAPABILITIES, externalMcpServerIds: ['server'] },
    success: null,
    refusal: (reason) => reason,
    missing,
  },
  {
    name: 'provider',
    invoke: (store) => store.chooseProviderFor('worker', 'codex'),
    input: { profileId: 'worker', provider: 'codex' },
    success: { ok: true, cleared: saved.modelChoiceCleared },
    refusal: (reason) => ({ ok: false, reason }),
    missing: { ok: false, reason: missing },
  },
  {
    name: 'name',
    invoke: (store) => store.renameTo('worker', 'New name'),
    input: { profileId: 'worker', displayName: 'New name' },
    success: null,
    refusal: (reason) => reason,
    missing: 'There is no agent identity called worker, so there is nothing to rename.',
  },
]

function setup(held: AgentIdentities | null = initial) {
  const read = vi.fn(async (): Promise<AgentIdentities> => initial)
  const write = vi.fn<(input: unknown) => Promise<typeof saved | null>>(async () => saved)
  const store = createAgentStore({
    agentIdentities: read,
    setCapabilities: write,
    setAgentProvider: write,
    setAgentDisplayName: write,
  } as unknown as RuntimeBridge)
  store.identities.value = held
  return { store, read, write }
}

describe.each(actions)('$name identity update', (action) => {
  it('patches before refreshing and waits for the complete roster before answering', async () => {
    const { store, read, write } = setup()
    let finish!: (list: AgentIdentities) => void
    const refreshed = { ...roster([saved, neighbour]), spawningEnabled: false }
    read.mockImplementation(() => {
      expect(store.identities.value).toEqual({ ...initial, identities: [neighbour, saved] })
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    let answered = false
    const answer = action.invoke(store).then((result) => {
      answered = true
      return result
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(write.mock.calls).toEqual([[action.input]])
    expect(read).toHaveBeenCalledTimes(1)
    expect(answered).toBe(false)
    finish(refreshed)
    expect(await answer).toEqual(action.success)
    expect(store.identities.value).toEqual(refreshed)
    expect(store.loadError.value).toBeNull()
    expect(store.loaded.value).toBe(true)
  })

  it('keeps the saved row and successful action result when refresh fails', async () => {
    const { store, read } = setup()
    read.mockRejectedValue(new Error('roster unavailable'))
    expect(await action.invoke(store)).toEqual(action.success)
    expect(store.identities.value).toEqual({ ...initial, identities: [neighbour, saved] })
    expect(store.loadError.value).toBe('roster unavailable')
    expect(store.loaded.value).toBe(true)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it.each([null, roster([]), roster([neighbour])])(
    'does not invent a row in an unread or nonmatching roster (%j)',
    async (held) => {
      const { store, read } = setup(held)
      read.mockRejectedValue(new Error('roster unavailable'))
      expect(await action.invoke(store)).toEqual(action.success)
      expect(store.identities.value).toEqual(held)
      expect(read).toHaveBeenCalledTimes(1)
    },
  )

  it('keeps its missing-identity refusal without patching or refreshing', async () => {
    const { store, read, write } = setup()
    write.mockResolvedValue(null)
    expect(await action.invoke(store)).toEqual(action.missing)
    expect(store.identities.value).toEqual(initial)
    expect(read).not.toHaveBeenCalled()
    expect(store.loaded.value).toBe(false)
    expect(store.loadError.value).toBeNull()
  })

  it('keeps its action-specific error result without patching or refreshing', async () => {
    const { store, read, write } = setup()
    write.mockRejectedValue(
      new Error("Error invoking remote method 'runtime:command': Error: write refused"),
    )
    expect(await action.invoke(store)).toEqual(action.refusal('write refused'))
    expect(store.identities.value).toEqual(initial)
    expect(read).not.toHaveBeenCalled()
    expect(store.loaded.value).toBe(false)
    expect(store.loadError.value).toBeNull()
  })
})
