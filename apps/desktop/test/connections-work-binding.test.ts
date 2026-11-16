import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { providerDescriptor, type Provider } from '@brobot2/shared'
import { resolveProviderConnection } from '../src/main/connections/records'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { PROVIDER_NAME } from '../src/shared/runtime-ipc'
import type { RuntimeHostDeps } from '../src/main/runtime/runtime-host'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { join } from 'node:path'

let world: AServiceWorld
let keySaved: boolean

beforeEach(() => {
  world = aServiceWorld()
  keySaved = true
})
afterEach(async () => world.cleanUp())

function connectedHost() {
  const host = world.aHost()
  const deps = Reflect.get(host, 'deps') as RuntimeHostDeps
  deps.connectionFor = (provider, connectionId) =>
    resolveProviderConnection(world.db, { provider, connectionId, keySaved })
  return host
}

function dispatchState() {
  return {
    identities: world.store.agentIdentities().length,
    conversations: world.conversationsRecorded(),
    pieces: world.db.prepare('SELECT 1 FROM work').all().length,
    queuedOrGiven: world.db
      .prepare("SELECT 1 FROM events WHERE type IN ('message_queued', 'work_given')")
      .all().length,
    profiles: world.db.prepare('SELECT * FROM profile_execution').all(),
  }
}

for (const provider of ['claude', 'codex'] as const satisfies readonly Provider[]) {
  for (const different of [false, true]) {
    it(`${provider}: overlapping gives ${different ? 'separate different' : 'share the same'} connection while preparation waits`, async () => {
      world.anAgent('fern', 'normal', provider)
      world.anAgent('moss', 'nothing kept')
      const host = connectedHost()
      const caller = await world.aPersonOpens(host, 'moss')
      let release!: () => void
      world.startsWait = new Promise<void>((resolve) => {
        release = resolve
      })
      const first = world.gives(host, caller, 'fern', { connectionId: `${provider}:sign-in` })
      try {
        await vi.waitFor(() =>
          expect(world.preparedIn.some((home) => home.endsWith(join('fern', provider)))).toBe(true),
        )
        const second = world.gives(host, caller, 'fern', {
          connectionId: `${provider}:${different ? 'api-key' : 'sign-in'}`,
        })
        release()
        const [one, two] = await Promise.all([first, second])
        expect(one.ok).toBe(true)
        expect(two.ok).toBe(true)
        if (!one.ok || !two.ok) throw new Error('The fictional gives must be accepted')
        if (different) expect(two.owner).not.toBe(one.owner)
        else expect(two.owner).toBe(one.owner)
        expect(world.store.connectionOf(one.owner)).toBe(`${provider}:sign-in`)
        expect(world.store.connectionOf(two.owner)).toBe(
          `${provider}:${different ? 'api-key' : 'sign-in'}`,
        )
        expect(world.startedAs.filter((profile) => profile === 'fern')).toHaveLength(
          different ? 2 : 1,
        )
      } finally {
        release()
        await first
      }
    })
  }

  it(`${provider}: an explicit connection finds a separate worker while omission keeps its usual conversation`, async () => {
    world.anAgent('fern', 'normal', provider)
    world.anAgent('moss', 'nothing kept')
    const host = connectedHost()
    const caller = await world.aPersonOpens(host, 'moss')
    const first = await world.gives(host, caller, 'fern')
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.refusal.reason)
    expect(world.store.connectionOf(first.owner)).toBe(`${provider}:api-key`)

    const selected = await world.gives(host, caller, 'fern', {
      connectionId: `${provider}:sign-in`,
    })
    expect(selected.ok).toBe(true)
    if (!selected.ok) throw new Error(selected.refusal.reason)
    expect(selected.owner).not.toBe(first.owner)
    expect(world.store.connectionOf(selected.owner)).toBe(`${provider}:sign-in`)
    expect(world.store.connectionOf(first.owner)).toBe(`${provider}:api-key`)

    const repeated = await world.gives(host, caller, 'fern', {
      connectionId: `${provider}:sign-in`,
    })
    expect(repeated).toMatchObject({ ok: true, owner: selected.owner })
    const ordinary = await world.gives(host, caller, 'fern')
    expect(ordinary).toMatchObject({ ok: true, owner: first.owner })
    expect(world.store.connectionOf(first.owner)).toBe(`${provider}:api-key`)
  })

  for (const explicit of [false, true]) {
    it(`${provider}: a new service records ${explicit ? 'the explicit connection over its default' : 'its agent default'} before its first start`, async () => {
      world.anAgent('fern', 'service', provider)
      world.anAgent('moss', 'nothing kept')
      world.store.setModelChoice('fern', {
        provider,
        model: `fake-${provider}-a`,
        effort: 'medium',
        connectionId: `${provider}:sign-in`,
      })
      const host = connectedHost()
      const caller = await world.aPersonOpens(host, 'moss')
      const given = await world.gives(
        host,
        caller,
        'fern',
        explicit ? { connectionId: `${provider}:api-key` } : {},
      )
      expect(given.ok).toBe(true)
      if (!given.ok) throw new Error(given.refusal.reason)
      const expected = `${provider}:${explicit ? 'api-key' : 'sign-in'}`
      expect(world.store.connectionOf(given.owner)).toBe(expected)
      keySaved = false
      expect(world.store.connectionOf(given.owner)).toBe(expected)
    })
  }

  it(`${provider}: an existing service keeps its recorded connection and reports an explicit mismatch`, async () => {
    keySaved = false
    world.anAgent('fern', 'service', provider)
    world.anAgent('moss', 'nothing kept')
    const host = connectedHost()
    const caller = await world.aPersonOpens(host, 'moss')
    const first = await world.gives(host, caller, 'fern')
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.refusal.reason)
    await vi.waitFor(() =>
      expect(world.store.connectionOf(first.owner)).toBe(`${provider}:sign-in`),
    )
    keySaved = true
    const given = await world.gives(host, caller, 'fern', { connectionId: `${provider}:api-key` })
    expect(given).toMatchObject({ ok: true, owner: first.owner })
    expect(world.store.connectionOf(first.owner)).toBe(`${provider}:sign-in`)
    const notice = Reflect.get(given, 'connectionNotice')
    expect(notice).toEqual(expect.stringContaining(`${provider}:sign-in`))
    expect(notice).toEqual(expect.stringContaining(`${provider}:api-key`))
    expect(String(notice).split('\n')).toHaveLength(1)
  })
  for (const name of [false, true]) {
    it(`${provider}: create_agent records ${name ? 'a named connection for a service' : 'a connection ID for a normal agent'} with its default model`, async () => {
      world.anAgent('moss', 'nothing kept')
      world.db
        .prepare('UPDATE provider_connection SET name=? WHERE id=?')
        .run('Fern subscription', `${provider}:sign-in`)
      const host = connectedHost()
      const caller = await world.aPersonOpens(host, 'moss')
      const tool = agentToolsFor(host, caller).tools.find((entry) => entry.name === 'create_agent')!
      const result = await tool.call({
        profile_slug: 'fern',
        provider,
        model: `fake-${provider}-a`,
        effort: 'medium',
        connectionId: name ? 'Fern subscription' : `${provider}:sign-in`,
        ...(name ? { kind: 'service' } : {}),
      })
      expect(result.structured).toMatchObject({ outcome: 'ok' })
      expect(world.store.modelChoiceOf('fern')).toMatchObject({
        provider,
        model: `fake-${provider}-a`,
        effort: 'medium',
        connectionId: `${provider}:sign-in`,
      })
      expect(world.startedAs.filter((profile) => profile === 'fern')).toEqual([])
    })
  }

  for (const lastPick of [false, true]) {
    it(`${provider}: a connection-only create_agent records and reports ${lastPick ? 'the current last pick' : 'its provider default'}`, async () => {
      world.anAgent('moss', 'nothing kept')
      const host = connectedHost()
      const caller = await world.aPersonOpens(host, 'moss')
      const expected = lastPick
        ? { model: `fake-${provider}-a`, effort: 'high' }
        : (providerDescriptor(provider).defaultModelByName ?? {
            model: `fake-${provider}-a`,
            effort: 'medium',
          })
      if (lastPick) world.store.aPersonPicked(provider, expected, world.clock++)
      const tool = agentToolsFor(host, caller).tools.find((entry) => entry.name === 'create_agent')!
      const result = await tool.call({
        profile_slug: 'fern',
        provider,
        connectionId: `${provider}:sign-in`,
      })
      const choice = { provider, ...expected, connectionId: `${provider}:sign-in` }
      expect(result.structured).toMatchObject({ outcome: 'ok', default_model: choice })
      expect(world.store.modelChoiceOf('fern')).toEqual(choice)
      expect(result.text).toContain(
        `Its new conversations start on “${expected.model}” at ${expected.effort} effort.`,
      )
      expect(world.startedAs.filter((profile) => profile === 'fern')).toEqual([])
    })
  }

  for (const invalid of ['unknown', 'disabled', 'cross-provider'] as const) {
    it(`${provider}: ${invalid} connection returns a selection refusal before create_agent writes an identity`, async () => {
      world.anAgent('moss', 'nothing kept')
      const host = connectedHost()
      const caller = await world.aPersonOpens(host, 'moss')
      if (invalid === 'disabled')
        world.db
          .prepare('UPDATE provider_connection SET enabled=0 WHERE id=?')
          .run(`${provider}:sign-in`)
      const selected =
        invalid === 'unknown'
          ? 'missing-fern-connection'
          : invalid === 'disabled'
            ? `${provider}:sign-in`
            : `${provider === 'claude' ? 'codex' : 'claude'}:sign-in`
      const tool = agentToolsFor(host, caller).tools.find((entry) => entry.name === 'create_agent')!
      const result = await tool.call({
        profile_slug: 'fern',
        provider,
        model: `fake-${provider}-a`,
        connectionId: selected,
      })
      const reason =
        invalid === 'cross-provider'
          ? `This connection belongs to ${PROVIDER_NAME[provider === 'claude' ? 'codex' : 'claude']}; the request named ${PROVIDER_NAME[provider]}.`
          : 'The selected connection is unavailable'
      expect(result.structured).toMatchObject({
        outcome: 'refused',
        rail: 'malformed-request',
        reason,
      })
      expect(result.text).toContain(reason)
      expect(world.store.agentIdentities().some((entry) => entry.slug === 'fern')).toBe(false)
    })
  }

  it(`${provider}: create_agent preserves an unexpected resolver failure without minting an identity`, async () => {
    world.anAgent('moss', 'nothing kept')
    const host = connectedHost()
    const caller = await world.aPersonOpens(host, 'moss')
    const error = new TypeError('Fictional connection reader failed')
    const deps = Reflect.get(host, 'deps') as RuntimeHostDeps
    deps.connectionFor = (name, connectionId) => {
      if (connectionId !== undefined) throw error
      return resolveProviderConnection(world.db, { provider: name, keySaved })
    }
    const tool = agentToolsFor(host, caller).tools.find((entry) => entry.name === 'create_agent')!
    await expect(
      tool.call({
        profile_slug: 'fern',
        provider,
        model: `fake-${provider}-a`,
        connectionId: `${provider}:sign-in`,
      }),
    ).rejects.toBe(error)
    expect(world.store.agentIdentities().some((entry) => entry.slug === 'fern')).toBe(false)
  })
  for (const service of [false, true]) {
    for (const disabled of [false, true]) {
      it(`${provider}: give_work refuses ${disabled ? 'a disabled' : 'an unknown'} connection for ${service ? 'a service' : 'a new normal agent'} before any dispatch`, async () => {
        if (service) world.anAgent('fern', 'service', provider)
        world.anAgent('moss', 'nothing kept')
        const host = connectedHost()
        const caller = await world.aPersonOpens(host, 'moss')
        if (disabled)
          world.db
            .prepare('UPDATE provider_connection SET enabled=0 WHERE id=?')
            .run(`${provider}:sign-in`)
        const before = dispatchState()
        const tool = agentToolsFor(host, caller).tools.find((entry) => entry.name === 'give_work')!
        const result = await tool.call({
          profile: 'fern',
          provider,
          ...(service ? {} : { new: true }),
          title: 'Fictional refusal proof',
          brief: 'Return a fictional result.',
          definition_of_done: 'The result is recorded.',
          connectionId: disabled ? `${provider}:sign-in` : 'missing-fern-connection',
        })
        expect(result.structured).toMatchObject({
          outcome: 'refused',
          rail: 'malformed-request',
          detail: { problems: ['The selected connection is unavailable'] },
        })
        expect(result.text).toContain('The selected connection is unavailable')
        expect(dispatchState()).toEqual(before)
        expect(world.startedAs.filter((profile) => profile === 'fern')).toEqual([])
        expect(world.sent.filter((turn) => turn.as === 'fern')).toEqual([])
      })
    }

    it(`${provider}: give_work preserves an unexpected ${service ? 'service' : 'fresh'} resolver error without dispatch`, async () => {
      if (service) world.anAgent('fern', 'service', provider)
      world.anAgent('moss', 'nothing kept')
      const host = connectedHost()
      const caller = await world.aPersonOpens(host, 'moss')
      const error = new TypeError('Fictional give connection lookup failed')
      const deps = Reflect.get(host, 'deps') as RuntimeHostDeps
      deps.connectionFor = (name, connectionId) => {
        if (connectionId !== undefined) throw error
        return resolveProviderConnection(world.db, { provider: name, keySaved })
      }
      const before = dispatchState()
      const tool = agentToolsFor(host, caller).tools.find((entry) => entry.name === 'give_work')!
      await expect(
        tool.call({
          profile: 'fern',
          provider,
          ...(service ? {} : { new: true }),
          title: 'Fictional resolver proof',
          brief: 'Return a fictional result.',
          definition_of_done: 'The result is recorded.',
          connectionId: `${provider}:sign-in`,
        }),
      ).rejects.toBe(error)
      expect(dispatchState()).toEqual(before)
      expect(world.sent.filter((turn) => turn.as === 'fern')).toEqual([])
    })
  }
}
