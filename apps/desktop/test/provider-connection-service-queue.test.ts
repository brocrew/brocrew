import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Provider } from '@brobot2/shared'
import type { AgentRuntime } from '@brobot2/runtime'
import { onProviderConnection } from '../src/main/providers'
import {
  resolveNamedProviderConnection,
  resolveProviderConnection,
} from '../src/main/db/provider-connections'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import type { GiveOutcome } from '../src/main/runtime/runtime-host'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { giverStallNotices } from './helpers/giver-notice-host'

let world: AServiceWorld
beforeEach(() => {
  world = aServiceWorld()
})
afterEach(async () => {
  world.startsFail = false
  await world.cleanUp()
})

function accepted(result: GiveOutcome) {
  expect(result).toMatchObject({ ok: true })
  if (!result.ok) throw new Error(result.refusal.reason)
  return result
}

async function fixture(provider: Provider) {
  world.anAgent('fern-service', 'service', provider)
  world.anAgent('caller', 'nothing kept')
  let revision = 0
  const resolve = (kind: Provider, id?: string | null) => {
    const found = resolveProviderConnection(world.db, { provider: kind, connectionId: id })
    if (found.id !== resolveProviderConnection(world.db, { provider: kind }).id)
      throw new Error('The selected connection is unavailable')
    return found
  }
  const connectionRouting = {
    connectionFor: (kind: Provider, id?: string | null) => resolve(kind, id).id,
    connectionNamed: (connection: string, kind?: Provider) =>
      resolveNamedProviderConnection(world.db, { connection, provider: kind }),
    connectionRevision: () => revision,
    wrap: (runtime: AgentRuntime, kind: Provider, id?: string) =>
      onProviderConnection(
        kind,
        () => runtime,
        (asked) => resolve(kind, asked),
        id,
      ),
  }
  const host = world.aHost({ connectionRouting })
  const caller = await world.aPersonOpens(host, 'caller')
  const queue = (connection: string) => {
    host.setServicesOn(true)
    const pending = world.gives(host, caller, 'fern-service', { connection })
    host.setServicesOn(false)
    return pending
  }
  const useKey = () => {
    world.db
      .prepare('INSERT OR REPLACE INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)')
      .run(provider, 'fictional-sealed-key', 1)
    revision++
  }
  return { host, caller, queue, useKey, connectionRouting }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: a connection-only service give is durable through services-off and restart`, async () => {
    const f = await fixture(provider)
    const given = accepted(await f.queue(`${provider}:sign-in`))
    expect(world.store.connectionOf(given.owner)).toBeNull()
    expect(world.store.recordedOne(given.owner)?.neverStarted).toBe(true)
    expect(world.startedAs).toEqual(['caller'])
    expect(world.ledger(given.owner).find((row) => row.type === 'work_given')).toMatchObject({
      connectionId: `${provider}:sign-in`,
    })
    expect(world.store.piecesOwnedBy(given.owner)[0]).toMatchObject({
      connectionId: `${provider}:sign-in`,
    })
    const other = provider === 'claude' ? 'codex' : 'claude'
    world.store.setAgentConnection('fern-service', other, `${other}:sign-in`)
    await f.host.closeAll()
    const restarted = world.aHost({ servicesOn: false, connectionRouting: f.connectionRouting })
    expect(world.store.connectionOf(given.owner)).toBeNull()
    restarted.setServicesOn(true)
    await vi.waitFor(() =>
      expect(world.store.connectionOf(given.owner)).toBe(`${provider}:sign-in`),
    )
    expect(world.store.recordedOne(given.owner)?.provider).toBe(provider)
  })

  it(`${provider}: a later conflicting queued selection cannot replace the first accepted intent`, async () => {
    const f = await fixture(provider)
    const first = accepted(await f.queue(`${provider}:sign-in`))
    f.useKey()
    const before = world.store.piecesOwnedBy(first.owner)
    expect((await f.queue(`${provider}:api-key`)).ok).toBe(false)
    expect(world.store.piecesOwnedBy(first.owner)).toEqual(before)
    expect(world.store.connectionOf(first.owner)).toBeNull()
    expect(world.startedAs).toEqual(['caller'])
  })

  it(`${provider}: a key conflict before first launch abandons the brief without binding or provider start`, async () => {
    const f = await fixture(provider)
    const first = accepted(await f.queue(`${provider}:sign-in`))
    f.useKey()
    const preparedBefore = [...world.preparedIn]
    f.host.setServicesOn(true)
    await vi.waitFor(() =>
      expect(
        world
          .ledger(first.owner)
          .some((row) => row.type === 'message_unqueued' && row.reason === 'abandoned'),
      ).toBe(true),
    )
    expect(world.store.connectionOf(first.owner)).toBeNull()
    expect(world.startedAs).toEqual(['caller'])
    expect(world.store.piecesOwnedBy(first.owner)[0]?.state).toBe('stalled')
    expect(world.preparedIn).toEqual(preparedBefore)
    await vi.waitFor(() => expect(giverStallNotices(world.store, f.caller)).toHaveLength(1))
  })

  it(`${provider}: taking back the unlaunched head lets a later explicit selection stand on its own`, async () => {
    const f = await fixture(provider)
    const first = accepted(await f.queue(`${provider}:sign-in`))
    const withdraw = agentToolsFor(f.host, f.caller).tools.find(
      (tool) => tool.name === 'withdraw_task',
    )!
    const taken = await withdraw.call({ piece: first.label })
    expect(taken.structured).toMatchObject({ outcome: 'ok' })
    f.useKey()
    const next = accepted(await f.queue(`${provider}:api-key`))
    expect(next.owner).toBe(first.owner)
    f.host.setServicesOn(true)
    await vi.waitFor(() => expect(world.store.connectionOf(next.owner)).toBe(`${provider}:api-key`))
  })

  it(`${provider}: a failed first launch leaves the chosen connection unbound and ends its brief unsent`, async () => {
    const f = await fixture(provider)
    const given = accepted(await f.queue(`${provider}:sign-in`))
    world.startsFail = true
    f.host.setServicesOn(true)
    await vi.waitFor(() =>
      expect(
        world
          .ledger(given.owner)
          .some((row) => row.type === 'message_unqueued' && row.reason === 'abandoned'),
      ).toBe(true),
    )
    expect(world.store.connectionOf(given.owner)).toBeNull()
    expect(world.store.recordedOne(given.owner)?.neverStarted).toBe(true)
  })
}
