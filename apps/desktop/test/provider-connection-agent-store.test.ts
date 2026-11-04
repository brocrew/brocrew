import { expect, it, vi } from 'vitest'
import { createAgentStore } from '../src/renderer/src/lib/agent-store'
import type { RuntimeBridge } from '../src/shared/runtime-ipc'

it('the agent default save carries its canonical connection beside provider, model and effort', async () => {
  const choice = {
    provider: 'claude' as const,
    connectionId: 'claude:sign-in',
    model: 'fictional-small',
    effort: 'medium',
  }
  const save = vi.fn(async () => ({ ok: true, choice }))
  const store = createAgentStore({ setAgentModelAndEffort: save } as unknown as RuntimeBridge)
  expect(await store.chooseModelFor('fern', choice)).toEqual({ ok: true, held: choice })
  expect(save).toHaveBeenCalledExactlyOnceWith({ profileId: 'fern', ...choice })
})

it('the creation store carries a chosen connection while rebuilding a plain IPC payload', async () => {
  const create = vi.fn(async (input: unknown) => ({ input }))
  const agentIdentities = vi.fn(async () => ({ identities: [], foldersWithoutARow: [] }))
  const store = createAgentStore({
    createAgent: create,
    agentIdentities,
  } as unknown as RuntimeBridge)
  const said = {
    slug: 'willow',
    displayName: 'Willow',
    provider: 'codex' as const,
    connectionId: 'codex:sign-in',
  }
  expect(await store.create(said)).toBeNull()
  expect(create).toHaveBeenCalledExactlyOnceWith(said)
  expect(create.mock.calls[0]?.[0]).not.toBe(said)
})

it('legacy default and clear payloads retain their exact absent connection shape', async () => {
  const save = vi.fn(async () => ({ ok: true, choice: null }))
  const store = createAgentStore({ setAgentModelAndEffort: save } as unknown as RuntimeBridge)
  await store.chooseModelFor('fern', { provider: 'codex', model: 'fictional-small', effort: null })
  await store.chooseModelFor('fern', null)
  expect(save.mock.calls).toEqual([
    [{ profileId: 'fern', provider: 'codex', model: 'fictional-small', effort: null }],
    [{ profileId: 'fern', provider: null, model: null, effort: null }],
  ])
})

it('review regression: an omitted-connection save leaves the loaded roster exact', async () => {
  const roster = {
    identities: [
      { id: 'fictional-fern', slug: 'fern', provider: 'claude', connectionId: 'claude:sign-in' },
    ],
    foldersWithoutARow: [],
    use: [],
    spawningEnabled: true,
  }
  const store = createAgentStore({
    agentIdentities: async () => roster,
    setAgentModelAndEffort: async () => ({
      ok: true,
      choice: {
        provider: 'claude',
        connectionId: 'claude:api-key',
        model: 'fictional-small',
        effort: null,
      },
    }),
  } as unknown as RuntimeBridge)
  await store.load()
  const before = JSON.parse(JSON.stringify(store.identities.value))
  await store.chooseModelFor('fern', { provider: 'claude', model: 'fictional-small', effort: null })
  expect(store.identities.value).toEqual(before)
})
