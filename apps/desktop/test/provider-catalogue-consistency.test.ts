import { describe, expect, it, vi } from 'vitest'
import type { Provider } from '@brobot2/shared'
import type { ModelChoice } from '@brobot2/runtime'
import { ModelCatalogues } from '../src/main/runtime/model-catalogues'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

const oldModels: ModelChoice[] = [
  { id: 'default', label: 'Default (recommended)', resolvesTo: 'claude-sonnet-5-5', isDefault: true },
  { id: 'fable', label: 'Fable', resolvesTo: 'claude-fable-5-1' },
]
const currentModels: ModelChoice[] = [
  { id: 'default', label: 'Default (recommended)', resolvesTo: 'claude-opus-5-5', isDefault: true },
  { id: 'fable', label: 'Fable 5.2', resolvesTo: 'claude-fable-5-2' },
]

function catalogue(read: (provider: Provider, profile: string) => Promise<ModelChoice[]>) {
  const probe = vi.fn(async (provider: Provider, profile: string) => ({
    ok: true as const,
    models: await read(provider, profile),
  }))
  const holder = new ModelCatalogues(
    NULL_SESSION_STORE,
    () => [DEFAULT_PROFILE_ID, 'fern'],
    probe,
    () => false,
    () => null,
    () => 100,
    () => {},
    String,
  )
  return { holder, probe }
}

describe('one current catalogue per provider', () => {
  it('gives the drawer and an agent the same provider-reported Default and Fable', async () => {
    const { holder, probe } = catalogue(async (_provider, profile) =>
      profile === DEFAULT_PROFILE_ID ? currentModels : oldModels,
    )
    const agent = await holder.modelList('claude', 'fern')
    const drawer = await holder.modelList('claude')
    expect(agent.models).toEqual(currentModels.map((row) => ({ ...row, addedBy: 'the-provider' })))
    expect(drawer.models).toEqual(agent.models)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith('claude', DEFAULT_PROFILE_ID)
  })

  it('a sign-in change from any profile refreshes the provider catalogue for every screen', async () => {
    let models = oldModels
    const { holder } = catalogue(async () => models)
    await holder.modelList('claude')
    await holder.modelList('claude', 'fern')
    models = currentModels
    holder.forgetModels('claude', 'fern')
    const drawer = await holder.modelList('claude')
    const agent = await holder.modelList('claude', 'fern')
    expect(drawer.models).toEqual(currentModels.map((row) => ({ ...row, addedBy: 'the-provider' })))
    expect(agent.models).toEqual(drawer.models)
  })

  it('an answer from before sign-in changed cannot restore the old catalogue', async () => {
    let release!: (models: ModelChoice[]) => void
    let first = true
    const { holder } = catalogue(async () => {
      if (!first) return currentModels
      first = false
      return new Promise<ModelChoice[]>((resolve) => { release = resolve })
    })
    const before = holder.modelList('claude')
    holder.forgetModels('claude', DEFAULT_PROFILE_ID)
    const after = holder.modelList('claude')
    release(oldModels)
    expect((await before).models).toEqual((await after).models)
    expect((await holder.modelList('claude', 'fern')).models).toEqual((await after).models)
  })
})
