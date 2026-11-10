import { describe, expect, it } from 'vitest'
import { PluginBrokerError } from '../src/main/plugins/tool-broker'
import type {
  BrokerAgent,
  BrokerInput,
  BrokerOptions,
  BrokerPerson,
  BrokerReply,
  BrokerValue,
  BrokerWorkspace,
} from '../src/main/plugins/tool-broker'
import { deferred, tick, setup } from './helpers/plugin-tool-broker'

describe('plugin authority and all-agent reach', () => {
  it('publishes a long tool description unchanged and keeps the tool callable', async () => {
    const description = 'Read a fictional page. '.repeat(100)
    const h = setup((o) => ({
      ...o,
      tools: o.tools.map((tool) => ({ ...tool, description })),
    }))
    expect(h.broker.agent.discover(h.agent)[0]!.description).toBe(description)
    const result = h.call()
    await tick()
    expect(h.server.calls).toHaveLength(1)
    h.server.finish(0)
    await expect(result).resolves.toEqual({ done: true })
  })
  it('offers tools to every existing/new agent in every attached workspace, without per-agent grants or provider choices', async () => {
    const h = setup()
    const newAgent = h.broker.owner.grantAgent(h.ws, 'cedar-life-one')
    const other = h.broker.owner.grantAgent(h.broker.owner.attach('birch'), 'aspen-life-one')
    expect(h.broker.agent.discover(newAgent)).toEqual(h.broker.agent.discover(h.agent))
    expect(h.broker.agent.discover(other)).toEqual(h.broker.agent.discover(h.agent))
    const first = h.call(other)
    await tick()
    expect(h.server.calls[0]!.request.identity).toEqual({
      pluginId: 'fictional-browser',
      installId: 'installation-fern',
      epoch: 'epoch-one',
      workspaceId: 'birch',
      kind: 'agent',
      incarnation: 'aspen-life-one',
    })
    h.server.finish(0)
    await expect(first).resolves.toEqual({ done: true })
    const second = h.call(newAgent)
    await tick()
    h.server.finish(1)
    await second
  })
  it('refuses forged, copied, foreign-installation and stale-epoch capabilities', async () => {
    const h = setup(),
      other = setup((o) => ({
        ...o,
        binding: { ...o.binding, installId: 'installation-birch', epoch: 'epoch-two' },
      }))
    for (const cap of [
      {},
      { workspaceId: 'willow', kind: 'agent', incarnation: 'fern-life-one' },
      structuredClone(h.agent),
      other.agent,
    ]) {
      expect(() => h.broker.agent.discover(cap as BrokerAgent)).toThrow(PluginBrokerError)
      await expect(h.call(cap as BrokerAgent)).rejects.toMatchObject({ code: 'unauthorized' })
    }
    h.broker.owner.invalidate()
    await expect(other.call(h.agent)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(h.server.calls).toHaveLength(0)
  })
  it('agent paths cannot call admin even with a person capability or in-band identity fields', async () => {
    const h = setup()
    await expect(h.broker.agent.call(h.agent, 'enable_profile', {})).rejects.toMatchObject({
      code: 'denied',
    })
    await expect(
      h.broker.agent.call(h.person as unknown as BrokerAgent, h.name, { profile: 'fern' }),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(
      h.broker.person.call(h.agent as unknown as BrokerPerson, 'enable_profile', {}),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    const p = h.call(h.agent, {
      profile: 'fern',
      identity: { kind: 'person' },
      method: 'admin',
      name: 'enable_profile',
    })
    await tick()
    expect(h.server.calls[0]!.operation).toBe('tool')
    expect(h.server.calls[0]!.request.identity.kind).toBe('agent')
    h.server.finish(0)
    await p
    expect(h.server.calls.some((c) => c.operation === 'admin')).toBe(false)
  })
  it('person mutations share the serial lock and never overlap an agent call', async () => {
    const h = setup()
    const first = h.call()
    await tick()
    const admin = h.broker.person.call(h.person, 'open_window', { profile: 'fern' })
    await tick()
    expect(h.server.calls).toHaveLength(1)
    h.server.finish(0)
    await first
    await tick()
    expect(h.server.calls[1]!.operation).toBe('admin')
    expect(h.server.calls[1]!.request.identity.kind).toBe('person')
    h.server.finish(1)
    await admin
  })
  it('revokes stopped incarnations and does not recreate one under its old name', async () => {
    const h = setup()
    h.broker.owner.revoke(h.agent)
    await expect(h.call()).rejects.toMatchObject({ code: 'unauthorized' })
    expect(() => h.broker.owner.grantAgent(h.ws, 'fern-life-one')).toThrow(PluginBrokerError)
    expect(h.broker.owner.grantAgent(h.ws, 'fern-life-two')).not.toBe(h.agent)
  })
  it('detached workspaces cannot regain access through an old capability', async () => {
    const h = setup()
    h.broker.owner.detach(h.ws)
    const reopened = h.broker.owner.attach('willow')
    expect(reopened).not.toBe(h.ws)
    expect(() => h.broker.owner.grantAgent(h.ws, 'new-life')).toThrow(PluginBrokerError)
    await expect(h.call()).rejects.toMatchObject({ code: 'unauthorized' })
  })
  it('uses the host reserved-name/collision rules and refuses ambiguous inventories', () => {
    expect(() => setup((o) => ({ ...o, reservedNamespace: 'plugin-fictional-browser' }))).toThrow(
      PluginBrokerError,
    )
    expect(() => setup((o) => ({ ...o, hostToolNames: ['READ_PAGE'] }))).toThrow(PluginBrokerError)
    expect(() =>
      setup((o) => ({ ...o, occupiedQualifiedNames: ['PLUGIN-FICTIONAL-BROWSER__READ_PAGE'] })),
    ).toThrow(PluginBrokerError)
    expect(() => setup((o) => ({ ...o, tools: [...o.tools, o.tools[0]!] }))).toThrow(
      PluginBrokerError,
    )
    expect(() => setup((o) => ({ ...o, adminOperations: ['read_page'] }))).toThrow(
      PluginBrokerError,
    )
  })
})

describe('package inputs at execution', () => {




  it('clones queued inputs and freezes execution identity, and arguments', async () => {
    const h = setup()
    const first = h.call()
    await tick()
    const input = { profile: 'fern', nested: { title: 'before' } }
    const queued = h.call(h.agent, input)
    input.profile = 'cedar'
    input.nested.title = 'after'
    h.server.finish(0)
    await first
    await tick()
    const request = h.server.calls[1]!.request
    expect(request.input).toEqual({ profile: 'fern', nested: { title: 'before' } })
    expect(Object.isFrozen(request.input.nested)).toBe(true)
    expect(Object.isFrozen(request.identity)).toBe(true)
    h.server.finish(1)
    await queued
  })
  it('does not publish unsupported resources/prompts or let a caller select another surface', async () => {
    const h = setup()
    expect(Object.keys(h.broker.agent)).toEqual(['discover', 'call'])
    await expect(h.broker.agent.call(h.agent, '/v1/profiles', {})).rejects.toMatchObject({
      code: 'denied',
    })
    await expect(h.broker.agent.call(h.agent, 'resources/read', {})).rejects.toMatchObject({
      code: 'denied',
    })
    expect(h.server.calls).toHaveLength(0)
  })
})

describe('bounded fair serial queue', () => {
  it('round-robins workspaces, then agents, even when one floods first', async () => {
    const h = setup()
    const secondAgent = h.broker.owner.grantAgent(h.ws, 'cedar')
    const birch = h.broker.owner.grantAgent(h.broker.owner.attach('birch'), 'aspen')
    const oak = h.broker.owner.grantAgent(h.broker.owner.attach('oak'), 'elm')
    const first = h.call()
    await tick()
    const pending = [
      h.call(),
      h.call(),
      h.call(secondAgent),
      h.call(secondAgent),
      h.call(birch),
      h.call(birch),
      h.call(oak),
    ]
    expect(h.server.calls).toHaveLength(1)
    for (let i = 0; i < 8; i++) {
      h.server.finish(i)
      await tick()
    }
    await Promise.all([first, ...pending])
    expect(
      h.server.calls.map(
        (c) => `${c.request.identity.workspaceId}:${c.request.identity.incarnation}`,
      ),
    ).toEqual([
      'willow:fern-life-one',
      'birch:aspen',
      'oak:elm',
      'willow:cedar',
      'birch:aspen',
      'willow:fern-life-one',
      'willow:cedar',
      'willow:fern-life-one',
    ])
    expect(h.clock.timers.size).toBe(0)
  })
  it('caps waiting requests at two per agent, without duplicate-grant quota evasion', async () => {
    const h = setup()
    const first = h.call()
    await tick()
    const same = h.broker.owner.grantAgent(h.ws, 'fern-life-one')
    expect(same).toBe(h.agent)
    const two = [h.call(), h.call(same)]
    await expect(h.call(same)).rejects.toMatchObject({
      code: 'busy',
      message: 'Plugin busy. Try again.',
    })
    expect(h.broker.status().queued).toBe(2)
    h.broker.owner.invalidate()
    await Promise.allSettled([first, ...two])
    h.server.calls[0]!.quiet.resolve()
    await tick()
  })
  it('caps waiting requests at eight per workspace and active plus queued work at 64', async () => {
    const h = setup()
    const first = h.call()
    await tick()
    const pending: Promise<BrokerValue>[] = []
    const spaces: BrokerWorkspace[] = []
    for (let w = 0; w < 8; w++) {
      const workspace = h.broker.owner.attach(`fictional-space-${w}`)
      spaces.push(workspace)
      for (let a = 0; a < 4; a++) {
        const cap = h.broker.owner.grantAgent(workspace, `fictional-agent-${a}`)
        pending.push(h.call(cap), h.call(cap))
      }
      const excess = h.broker.owner.grantAgent(workspace, 'one-too-many')
      await expect(h.call(excess)).rejects.toMatchObject({ code: 'busy' })
    }
    expect(h.broker.status().queued).toBe(63)
    await expect(pending.at(-1)).rejects.toMatchObject({ code: 'busy' })
    const extra = h.broker.owner.grantAgent(h.broker.owner.attach('overflow'), 'extra')
    await expect(h.call(extra)).rejects.toMatchObject({ code: 'busy' })
    h.broker.owner.invalidate()
    await Promise.allSettled([first, ...pending])
    h.server.calls[0]!.quiet.resolve()
    await tick()
    expect(h.broker.status()).toMatchObject({ available: false, queued: 0, executing: false })
  })
  it('cancels queued calls promptly and never sends them to the server', async () => {
    const h = setup()
    const first = h.call()
    await tick()
    const signal = new AbortController()
    const pending = h.call(h.agent, { profile: 'fern' }, signal.signal)
    signal.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    expect(h.broker.status().queued).toBe(0)
    h.server.finish(0)
    await first
    await tick()
    expect(h.server.calls).toHaveLength(1)
    expect(h.clock.timers.size).toBe(0)
  })
  it('does not admit an already-cancelled call', async () => {
    const h = setup(),
      signal = new AbortController()
    signal.abort()
    await expect(h.call(h.agent, { profile: 'fern' }, signal.signal)).rejects.toMatchObject({
      code: 'cancelled',
    })
    expect(h.broker.status().queued).toBe(0)
  })
  it('expires queued requests after 120 seconds without executing them', async () => {
    const h = setup()
    const pending = h.call()
    h.clock.advance(120_000)
    await tick()
    await expect(pending).rejects.toMatchObject({ code: 'deadline' })
    expect(h.server.calls).toHaveLength(0)
    expect(h.clock.timers.size).toBe(0)
  })
})

describe('deadline, cancellation and independent quiescence proof', () => {
  it('answers an active deadline at 120 seconds but holds the slot until quiescence', async () => {
    const h = setup()
    const first = h.call()
    await tick()
    h.clock.advance(5000)
    const queued = h.call()
    h.clock.advance(115_000)
    await tick()
    await expect(first).rejects.toMatchObject({
      code: 'deadline',
      message:
        'Tool read_page took too long; completion is unknown. The operation may still be running.',
    })
    expect(h.server.calls[0]!.signal.aborted).toBe(true)
    expect(h.server.calls[0]!.cancels).toBe(1)
    expect(h.server.calls).toHaveLength(1)
    h.server.calls[0]!.quiet.resolve()
    await tick()
    expect(h.server.calls).toHaveLength(2)
    h.server.finish(1)
    await queued
  })
  it('a settled result or resolved cancellation request is not proof of stopped execution', async () => {
    const h = setup()
    const first = h.call()
    await tick()
    h.server.calls[0]!.result.resolve({ ok: true, value: 'early-result' })
    await tick()
    const queued = h.call()
    await tick()
    expect(h.server.calls).toHaveLength(1)
    h.clock.advance(120_000)
    await tick()
    await expect(first).rejects.toMatchObject({ code: 'deadline' })
    h.clock.advance(1000)
    await tick()
    await expect(queued).rejects.toMatchObject({ code: expect.any(String) })
    expect(h.broker.status()).toMatchObject({
      available: true,
      executing: false,
      awaitingQuiescence: true,
    })
    expect(h.server.calls).toHaveLength(1)
    h.server.calls[0]!.quiet.resolve()
    await tick()
    expect(h.broker.status()).toMatchObject({
      available: true,
      executing: false,
      awaitingQuiescence: false,
    })
  })
  it('a normal result plus quiescence releases the slot unchanged', async () => {
    const h = setup()
    const first = h.call()
    await tick()
    const second = h.call()
    h.server.calls[0]!.quiet.resolve()
    await tick()
    expect(h.server.calls).toHaveLength(1)
    h.server.calls[0]!.result.resolve({ ok: true, value: { page: 'fictional' } })
    await tick()
    await expect(first).resolves.toEqual({ page: 'fictional' })
    expect(h.server.calls).toHaveLength(2)
    h.server.finish(1)
    await second
  })
  it('cancels a stopped caller, ignores late results and resumes only after proof', async () => {
    const h = setup()
    const signal = new AbortController()
    const first = h.call(h.agent, { profile: 'fern' }, signal.signal)
    await tick()
    const second = h.call()
    signal.abort()
    await tick()
    await expect(first).rejects.toMatchObject({ code: 'cancelled' })
    h.server.calls[0]!.result.resolve({ ok: true, value: 'late' })
    await tick()
    expect(h.server.calls).toHaveLength(1)
    h.server.calls[0]!.quiet.resolve()
    await tick()
    expect(h.server.calls).toHaveLength(2)
    h.server.finish(1)
    await second
  })
  it('retains missing proof after its observation grace and lets later calls proceed', async () => {
    const h = setup()
    const signal = new AbortController()
    const first = h.call(h.agent, { profile: 'fern' }, signal.signal)
    await tick()
    const queued = h.call()
    signal.abort()
    await tick()
    h.clock.advance(1000)
    await tick()
    await expect(first).rejects.toMatchObject({ code: 'cancelled' })
    expect(h.server.calls).toHaveLength(2)
    expect(h.broker.status()).toMatchObject({ available: true, awaitingQuiescence: true })
    h.server.finish(1)
    await expect(queued).resolves.toEqual({ done: true })
    h.broker.owner.invalidate()
    expect(h.broker.owner.hasCompletionProof()).toBe(false)
    h.server.finish(0)
    await tick()
    expect(h.broker.status().available).toBe(false)
    expect(h.broker.owner.hasCompletionProof()).toBe(true)
  })
  it('detaching one workspace cancels its work, while another workspace proceeds after proof', async () => {
    const h = setup()
    const first = h.call()
    await tick()
    const queued = h.call()
    const other = h.broker.owner.grantAgent(h.broker.owner.attach('birch'), 'aspen')
    const next = h.call(other)
    h.broker.owner.detach(h.ws)
    await tick()
    await expect(first).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(queued).rejects.toMatchObject({ code: 'unauthorized' })
    h.server.calls[0]!.quiet.resolve()
    await tick()
    expect(h.server.calls[1]!.request.identity.workspaceId).toBe('birch')
    h.server.finish(1)
    await next
  })

})

describe('secret-free failures and diagnostics', () => {
  const secret = 'fictional-downstream-secret-never-for-logs'
  it('sanitizes server throws, cancellation errors, result rejections and malformed outcomes', async () => {
    const h = setup()
    h.server.startError = new Error(secret)
    const error = (await h.call().catch((e: unknown) => e)) as PluginBrokerError
    expect(error).toMatchObject({
      code: 'unavailable',
      message: 'Tool read_page failed: unavailable; completion is unknown.',
    })
    expect(String(error.stack)).not.toContain(secret)
    expect(JSON.stringify(h.audit)).not.toContain(secret)
    const rejected = setup()
    const pending = rejected.call()
    await tick()
    rejected.server.calls[0]!.result.reject(new Error(secret))
    rejected.server.calls[0]!.quiet.resolve()
    await tick()
    await expect(pending).rejects.toMatchObject({ code: 'downstream' })
    expect(rejected.broker.status().available).toBe(true)
    const cancel = setup()
    cancel.server.cancelError = new Error(secret)
    const signal = new AbortController()
    const stopped = cancel.call(cancel.agent, { profile: 'fern' }, signal.signal)
    await tick()
    signal.abort()
    await tick()
    await expect(stopped).rejects.toMatchObject({ code: 'cancelled' })
    expect(cancel.broker.status().available).toBe(false)
    expect(JSON.stringify(cancel.audit)).not.toContain(secret)
  })
  it('keeps execution errors, identities, arguments and outputs out of audit events', async () => {
    const h = setup()
    h.server.startError = new Error(secret)
    await expect(h.call(h.agent, { profile: 'fern', payload: secret })).rejects.toMatchObject({
      code: 'unavailable',
    })
    expect(JSON.stringify(h.audit)).not.toMatch(
      /fictional-downstream|fern|willow|incarnation|payload/,
    )
    for (const event of h.audit)
      expect(
        Object.keys(event).every((key) =>
          ['event', 'operation', 'queued', 'code', 'reason', 'call'].includes(key),
        ),
      ).toBe(true)
    for (const event of h.audit)
      if (event.reason !== undefined)
        expect([
          'call-state',
          'proof-rejected',
          'proof-timeout',
          'cancel-failed',
          'execution-invalid',
          'reply-invalid',
          'owner-invalidated',
          'queue-deadline',
          'call-deadline',
        ]).toContain(event.reason)
    const logger = setup((o) => ({
      ...o,
      audit: () => {
        throw new Error(secret)
      },
    }))
    const result = logger.call()
    await tick()
    logger.server.finish(0, secret)
    await expect(result).resolves.toBe(secret)
  })
  it('bounds input, isolates invalid plugin replies and handles cyclic data without a raw error', async () => {
    const h = setup()
    await expect(
      h.call(h.agent, { profile: 'fern', large: 'x'.repeat(65536) }),
    ).rejects.toMatchObject({ code: 'invalid' })
    const cycle: Record<string, unknown> = { profile: 'fern' }
    cycle.self = cycle
    await expect(h.call(h.agent, cycle as BrokerInput)).rejects.toBeInstanceOf(PluginBrokerError)
    expect(h.server.calls).toHaveLength(0)
    const pending = h.call()
    await tick()
    h.server.calls[0]!.result.resolve({ ok: false, error: secret } as unknown as BrokerReply)
    h.server.calls[0]!.quiet.resolve()
    await expect(pending).rejects.toMatchObject({ code: 'downstream' })
    expect(JSON.stringify(h.audit)).not.toContain(secret)
    expect(h.clock.timers.size).toBe(0)
  })
})

describe('revocation and malformed downstream boundaries', () => {

  it('cancels when authority is revoked inside dispatch, before the handle returns', async () => {
    let revoke = () => {}
    const h = setup((o) => ({
      ...o,
      server: {
        tool(request, signal) {
          revoke()
          return o.server.tool(request, signal)
        },
        admin: o.server.admin,
      },
    }))
    revoke = () => h.broker.owner.revoke(h.agent)
    const first = h.call()
    await tick()
    await expect(first).rejects.toMatchObject({ code: 'unauthorized' })
    expect(h.server.calls[0]!.signal.aborted).toBe(true)
    expect(h.server.calls[0]!.cancels).toBe(1)
    expect(h.broker.status()).toMatchObject({ executing: true, awaitingQuiescence: true })
    h.server.calls[0]!.quiet.resolve()
    await tick()
    expect(h.broker.status()).toMatchObject({ available: true, executing: false })
    expect(h.clock.timers.size).toBe(0)
  })
  it('invalidating an epoch stops active/queued work, and late success cannot restore it', async () => {
    const h = setup()
    const first = h.call()
    await tick()
    const next = h.call()
    h.broker.owner.invalidate()
    await tick()
    await expect(first).rejects.toMatchObject({ code: 'unavailable' })
    await expect(next).rejects.toMatchObject({ code: 'unavailable' })
    h.server.finish(0, 'late')
    await tick()
    expect(h.broker.status()).toEqual({
      available: false,
      queued: 0,
      executing: false,
      awaitingQuiescence: false,
      unknownCalls: [],
    })
    expect(() => h.broker.agent.discover(h.agent)).toThrow(PluginBrokerError)
  })
  it('does not trust a rejected quiescence receipt, and never starts the next call', async () => {
    const h = setup()
    const first = h.call()
    await tick()
    const second = h.call()
    h.server.calls[0]!.quiet.reject(new Error('fictional-quiescence-secret'))
    await tick()
    await expect(first).rejects.toMatchObject({ code: 'unavailable' })
    await expect(second).rejects.toMatchObject({ code: 'unavailable' })
    expect(h.server.calls).toHaveLength(1)
    expect(h.audit).toContainEqual(
      expect.objectContaining({ event: 'unavailable', reason: 'proof-rejected' }),
    )
    expect(h.audit.filter((e) => e.event === 'refused' && e.code === 'unavailable')).toHaveLength(2)
    expect(JSON.stringify(h.audit)).not.toContain('fictional-quiescence-secret')
  })
  it('handles throwing result getters as a fixed failure with no unhandled secret exception', async () => {
    const h = setup()
    const first = h.call()
    await tick()
    const reply = Object.defineProperty({}, 'ok', {
      get() {
        throw new Error('fictional-result-secret')
      },
    })
    h.server.calls[0]!.result.resolve(reply as BrokerReply)
    h.server.calls[0]!.quiet.resolve()
    await tick()
    await expect(first).rejects.toMatchObject({ code: 'downstream' })
    expect(JSON.stringify(h.audit)).not.toContain('fictional-result-secret')
  })
  it('captures a result once and does not let later upstream mutation change it', async () => {
    const h = setup()
    const first = h.call()
    await tick()
    const payload = { page: 'original' }
    h.server.calls[0]!.result.resolve({ ok: true, value: payload })
    await tick()
    payload.page = 'changed'
    h.server.calls[0]!.quiet.resolve()
    await expect(first).resolves.toEqual({ page: 'original' })
  })
  it('keeps error codes closed even if a caller throws a forged broker error from serialization', async () => {
    const h = setup()
    const payload = {
      toJSON() {
        throw new PluginBrokerError('fictional-code-secret' as never)
      },
    }
    const result = await h
      .call(h.agent, payload as unknown as BrokerInput)
      .catch((error: unknown) => error)
    expect(result).toMatchObject({ code: 'invalid', message: 'Plugin unavailable. Try again.' })
    expect(JSON.stringify(h.audit)).not.toContain('fictional-code-secret')
    expect(h.server.calls).toHaveLength(0)
  })
})
it('a stale detach cannot remove a newer attachment for the same workspace', async () => {
  const h = setup()
  h.broker.owner.detach(h.ws)
  const current = h.broker.owner.attach('willow')
  const agent = h.broker.owner.grantAgent(current, 'new-life')
  h.broker.owner.detach(h.ws)
  expect(h.broker.owner.attach('willow')).toBe(current)
  const pending = h.call(agent)
  await tick()
  h.server.finish(0)
  await pending
})
it('supports full-length catalogue IDs with a stable bounded namespace and refuses occupied namespaces', () => {
  const id = 'a'.repeat(64)
  const h = setup((o) => ({ ...o, binding: { ...o.binding, pluginId: id } }))
  const namespace = h.broker.agent.discover(h.agent)[0]!.namespace
  expect(namespace).toHaveLength(64)
  expect(namespace).not.toContain('__')
  expect(setup((o) => ({ ...o, binding: { ...o.binding, pluginId: id } })).name).toContain(
    namespace,
  )
  expect(() => setup((o) => ({ ...o, occupiedNamespaces: ['PLUGIN-FICTIONAL-BROWSER'] }))).toThrow(
    PluginBrokerError,
  )
})
it('attribution copies only installation identity fields from owner metadata', async () => {
  const h = setup((o) => ({
    ...o,
    binding: { ...o.binding, credential: 'fictional-extra-secret' } as BrokerOptions['binding'],
  }))
  const pending = h.call()
  await tick()
  expect(Object.keys(h.server.calls[0]!.request.identity).sort()).toEqual([
    'epoch',
    'incarnation',
    'installId',
    'kind',
    'pluginId',
    'workspaceId',
  ])
  expect(JSON.stringify(h.audit)).not.toContain('fictional-extra-secret')
  h.server.finish(0)
  await pending
})


it('distinguishes a queue deadline from a dispatched call deadline using fixed reasons', async () => {
  const h = setup()
  const first = h.call(),
    second = h.call()
  await tick()
  h.clock.advance(120000)
  await expect(first).rejects.toMatchObject({ code: 'deadline' })
  await expect(second).rejects.toMatchObject({ code: 'deadline' })
  expect(h.audit).toContainEqual(
    expect.objectContaining({ event: 'refused', reason: 'call-deadline' }),
  )
  expect(h.audit).toContainEqual(
    expect.objectContaining({ event: 'refused', reason: 'queue-deadline' }),
  )
  h.server.calls[0]!.quiet.resolve()
  await tick()
})

it('offers replacement authority only after a failed call positively completes', async () => {
  const h = setup()
  const pending = h.call()
  await tick()
  h.clock.advance(120000)
  await expect(pending).rejects.toMatchObject({ code: 'deadline' })
  h.clock.advance(1000)
  expect(h.broker.status()).toMatchObject({ available: true, awaitingQuiescence: true })
  expect(h.broker.owner.hasCompletionProof()).toBe(false)
  h.broker.owner.invalidate()
  h.server.calls[0]!.quiet.resolve()
  await tick()
  expect(h.broker.status()).toMatchObject({ available: false, executing: false })
  expect(h.broker.owner.hasCompletionProof()).toBe(true)
})

it('uses positive exact-host exit after a rejected call proof, never a rejected host proof', async () => {
  const host = deferred<void>()
  const h = setup((options) => Object.assign(options, { hostExited: host.promise }))
  const pending = h.call()
  await tick()
  h.server.calls[0]!.quiet.reject(new Error('fictional unproved remote call'))
  await expect(pending).rejects.toMatchObject({ code: 'unavailable' })
  expect(h.broker.owner.hasCompletionProof()).toBe(false)
  host.resolve()
  await tick()
  expect(h.broker.owner.hasCompletionProof()).toBe(true)
  expect(h.broker.status()).toMatchObject({ available: false, executing: false })

  const unknown = deferred<void>()
  const other = setup((options) => Object.assign(options, { hostExited: unknown.promise }))
  const active = other.call()
  await tick()
  unknown.reject(new Error('fictional unknown host exit'))
  other.clock.advance(120000)
  await expect(active).rejects.toThrow()
  other.clock.advance(1000)
  expect(other.broker.owner.hasCompletionProof()).toBe(false)
  expect(other.broker.status()).toMatchObject({ available: true, awaitingQuiescence: true })
})
