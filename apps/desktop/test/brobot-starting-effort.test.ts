import { afterEach, beforeEach, expect, it } from 'vitest'
import { type ModelChoice } from '@brobot2/runtime'
import { FakeProviderSessions } from '@brobot2/runtime/testing'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { CapturingRuntime, F093World } from './lib/f093-host'

let world: F093World
beforeEach(() => {
  world = new F093World()
})
afterEach(async () => world.dispose())

function aHostOffering(...efforts: string[]) {
  class Runtime extends CapturingRuntime {
    override async listModels(): Promise<ModelChoice[]> {
      return [
        {
          id: 'harbour',
          label: 'Harbour',
          isDefault: true,
          defaultEffort: 'low',
          efforts: efforts.map((id) => ({ id, label: id })),
        },
      ]
    }
  }
  const sessions = new FakeProviderSessions()
  return world.buildHost(false, {
    createRuntime: (provider) => new Runtime(provider, sessions, world.end),
  })
}

it('shows and starts BroBot at the provider default in a fresh workspace', async () => {
  const host = aHostOffering('low', 'medium', 'high')
  const { provider } = host.resolveProviderLaunch({
    askedProvider: null,
    providers: [
      { provider: 'claude', ready: true },
      { provider: 'codex', ready: true },
    ],
  })
  expect(provider).toBe('codex')
  const choices = await host.providerLaunchChoices(provider)
  expect(choices).toMatchObject({
    defaultModel: { model: 'harbour', effort: 'low' },
    defaultModelToSend: null,
    list: { models: [expect.objectContaining({ id: 'harbour', defaultEffort: 'low' })] },
  })

  const session = await world.open(host, provider, DEFAULT_PROFILE_ID, { inTheWorkspace: true })
  expect(world.end.newest()).toMatchObject({
    provider: 'codex',
    options: { model: 'harbour', reasoningEffort: 'low' },
  })
  expect(world.store.whatItRunsOn(session)).toMatchObject({
    model: 'harbour',
    reasoningEffort: 'low',
  })
})

it('uses an explicit effort and honours a saved last pick for later launches', async () => {
  const host = aHostOffering('low', 'medium', 'high')
  await host.createSession({ provider: 'codex', reasoningEffort: 'low' }, world.window)
  expect(world.end.newest().options.reasoningEffort).toBe('low')

  await host.aPersonPicked('codex', DEFAULT_PROFILE_ID, { model: 'harbour', effort: 'high' })
  expect((await host.providerLaunchChoices('codex')).defaultModel).toEqual({
    model: 'harbour',
    effort: 'high',
  })
  await world.open(host, 'codex', DEFAULT_PROFILE_ID)
  expect(world.end.newest().options.reasoningEffort).toBe('high')
})

it('keeps the provider effort for other profiles or a model without medium', async () => {
  let host = aHostOffering('low', 'medium')
  await world.open(host, 'codex', 'reader')
  expect(world.end.newest().options.reasoningEffort).toBe('low')

  host = aHostOffering('low', 'high')
  await world.open(host, 'codex', DEFAULT_PROFILE_ID)
  expect(world.end.newest().options.reasoningEffort).toBe('low')
})
