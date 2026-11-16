import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Provider } from '@brobot2/shared'
import { listProviderConnections, resolveProviderConnection } from '../src/main/connections/records'
import { runtimeCommandSchema, executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHostDeps } from '../src/main/runtime/runtime-host'
import { RecordingSink } from './lib/host-fixture'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

let world: AServiceWorld
beforeEach(() => {
  world = aServiceWorld()
})
afterEach(async () => world.cleanUp())

function fixture(provider: Provider) {
  world.anAgent('fern', 'normal', provider)
  world.store.setModelChoice('fern', {
    provider,
    model: `fake-${provider}-a`,
    effort: 'medium',
    connectionId: `${provider}:sign-in`,
  })
  const host = world.aHost()
  const deps = Reflect.get(host, 'deps') as RuntimeHostDeps
  deps.listConnections = () =>
    (['claude', 'codex'] as const).flatMap((name) => listProviderConnections(world.db, name))
  deps.connectionFor = (name, connectionId) =>
    resolveProviderConnection(world.db, { provider: name, connectionId, keySaved: true })
  const models = vi.spyOn(host, 'modelList').mockResolvedValue({
    provider,
    models: [],
    lastPicked: null,
    startsOn: null,
    standIn: null,
    notAsked: { ok: false, reason: 'no-profile' },
  })
  const auth = vi.spyOn(host, 'checkProviderAuth').mockResolvedValue({
    state: 'absent',
    reason: 'Fictional account not ready',
  })
  return { host, models, auth }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: launch choices retain declared routes and the agent connection without making it ready`, async () => {
    const { host } = fixture(provider)
    const choices = await host.providerLaunchChoices(provider, 'fern')
    expect(choices).toMatchObject({
      ready: false,
      defaultConnectionId: `${provider}:sign-in`,
      connections: [
        { id: `${provider}:sign-in`, provider },
        { id: `${provider}:api-key`, provider },
      ],
    })
    expect(host.sessionIds).toEqual([])
  })

  it(`${provider}: an explicit not-ready named connection survives decoding and never falls back to another provider`, async () => {
    const { host, models, auth } = fixture(provider)
    world.db
      .prepare('UPDATE provider_connection SET name=? WHERE id=?')
      .run('Fern subscription', `${provider}:sign-in`)
    const other = provider === 'claude' ? 'codex' : 'claude'
    const command = runtimeCommandSchema.parse({
      kind: 'resolveProviderLaunch',
      profileId: 'fern',
      askedProvider: provider,
      askedConnectionId: 'Fern subscription',
      providers: [
        { provider, ready: false },
        { provider: other, ready: true },
      ],
    })
    expect(await executeRuntimeCommand(host, new RecordingSink('fern'), command)).toMatchObject({
      provider,
      pickerProvider: provider,
      connectionId: `${provider}:sign-in`,
      readiness: [
        { provider, ready: false },
        { provider: other, ready: true },
      ],
    })
    expect(models).not.toHaveBeenCalled()
    expect(auth).not.toHaveBeenCalled()
    expect(host.sessionIds).toEqual([])
  })

  it(`${provider}: resolving an agent default keeps its connection despite global compatibility choosing the API route`, () => {
    const { host, models, auth } = fixture(provider)
    const answer = host.resolveProviderLaunch({
      profileId: 'fern',
      askedProvider: null,
      providers: [{ provider, ready: true }],
    })
    expect(answer).toMatchObject({ provider, connectionId: `${provider}:sign-in` })
    expect(world.store.modelChoiceOf('fern')?.connectionId).toBe(`${provider}:sign-in`)
    expect(models).not.toHaveBeenCalled()
    expect(auth).not.toHaveBeenCalled()
  })
  it(`${provider}: an unavailable stored default reports its existing error instead of a fallback`, () => {
    const { host, models, auth } = fixture(provider)
    world.db
      .prepare('UPDATE provider_connection SET enabled=0 WHERE id=?')
      .run(`${provider}:sign-in`)
    expect(() =>
      host.resolveProviderLaunch({
        profileId: 'fern',
        askedProvider: null,
        providers: [{ provider, ready: true }],
      }),
    ).toThrow('The selected connection is unavailable')
    expect(models).not.toHaveBeenCalled()
    expect(auth).not.toHaveBeenCalled()
    expect(host.sessionIds).toEqual([])
  })

  it(`${provider}: an explicit route wins over an unavailable agent default`, async () => {
    const { host } = fixture(provider)
    world.db
      .prepare('UPDATE provider_connection SET enabled=0 WHERE id=?')
      .run(`${provider}:sign-in`)
    const command = runtimeCommandSchema.parse({
      kind: 'resolveProviderLaunch',
      profileId: 'fern',
      askedProvider: provider,
      askedConnectionId: `${provider}:api-key`,
      providers: [{ provider, ready: false }],
    })
    expect(await executeRuntimeCommand(host, new RecordingSink('fern'), command)).toMatchObject({
      provider,
      pickerProvider: provider,
      connectionId: `${provider}:api-key`,
    })
    expect(world.store.modelChoiceOf('fern')?.connectionId).toBe(`${provider}:sign-in`)
  })

  it(`${provider}: asking another provider ignores this agent's different-provider connection default`, () => {
    const { host } = fixture(provider)
    const other = provider === 'claude' ? 'codex' : 'claude'
    expect(
      host.resolveProviderLaunch({
        profileId: 'fern',
        askedProvider: other,
        providers: [{ provider: other, ready: true }],
      }),
    ).toMatchObject({ provider: other, connectionId: `${other}:api-key` })
    expect(world.store.modelChoiceOf('fern')?.connectionId).toBe(`${provider}:sign-in`)
  })
}
