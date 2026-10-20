import { describe, expect, it } from 'vitest'
import { createPluginToolBroker, PluginBrokerError } from '../src/main/plugins/tool-broker'
import type {
  BrokerAgent,
  BrokerAudit,
  BrokerClock,
  BrokerInput,
  BrokerOptions,
  BrokerPerson,
  BrokerReply,
  BrokerRequest,
  BrokerValue,
  BrokerWorkspace,
  PluginExecution,
} from '../src/main/plugins/tool-broker'

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
class Clock implements BrokerClock {
  time = 0
  next = 0
  timers = new Map<number, { at: number; callback: () => void }>()
  now = () => this.time
  after = (ms: number, callback: () => void) => {
    const id = ++this.next
    this.timers.set(id, { at: this.time + ms, callback })
    return () => {
      this.timers.delete(id)
    }
  }
  advance(ms: number) {
    const until = this.time + ms
    for (;;) {
      const next = [...this.timers]
        .filter(([, item]) => item.at <= until)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (!next) break
      this.time = next[1].at
      this.timers.delete(next[0])
      next[1].callback()
    }
    this.time = until
  }
}
class Server {
  calls: Array<{
    operation: 'tool' | 'admin'
    request: BrokerRequest
    signal: AbortSignal
    result: ReturnType<typeof deferred<BrokerReply>>
    quiet: ReturnType<typeof deferred<void>>
    cancels: number
  }> = []
  cancelError: unknown
  startError: unknown
  start = (
    operation: 'tool' | 'admin',
    request: BrokerRequest,
    signal: AbortSignal,
  ): PluginExecution => {
    if (this.startError) throw this.startError
    const call = {
      operation,
      request,
      signal,
      result: deferred<BrokerReply>(),
      quiet: deferred<void>(),
      cancels: 0,
    }
    this.calls.push(call)
    return {
      result: call.result.promise,
      quiescent: call.quiet.promise,
      cancel: () => {
        call.cancels++
        if (this.cancelError) return Promise.reject(this.cancelError)
      },
    }
  }
  tool = (request: BrokerRequest, signal: AbortSignal) => this.start('tool', request, signal)
  admin = (request: BrokerRequest, signal: AbortSignal) => this.start('admin', request, signal)
  finish(index: number, value: BrokerValue = { done: true }) {
    this.calls[index]!.result.resolve({ ok: true, value })
    this.calls[index]!.quiet.resolve()
  }
}
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
const tracked = <T>(promise: Promise<T>): Promise<T> => {
  void promise.catch(() => undefined)
  return promise
}
function setup(change: (options: BrokerOptions) => BrokerOptions = (options) => options) {
  const clock = new Clock(),
    server = new Server(),
    audit: BrokerAudit[] = []
  const enabled = new Map<string, Set<'read' | 'write'>>([['fern', new Set(['read', 'write'])]])
  const prepare = (mode: 'read' | 'write') => (input: BrokerInput) => {
    if (typeof input.profile !== 'string') throw new Error('fixture input is invalid')
    return { input, resources: [{ resource: 'profiles', key: input.profile, mode }] }
  }
  const options: BrokerOptions = {
    binding: { pluginId: 'fictional-browser', installId: 'installation-fern', epoch: 'epoch-one' },
    reservedNamespace: 'fictional-host',
    hostToolNames: ['give_work'],
    occupiedNamespaces: [],
    occupiedQualifiedNames: [],
    tools: [
      {
        name: 'read_page',
        description: 'Read a fictional page.',
        inputSchema: { type: 'object' },
        prepare: prepare('read'),
      },
      {
        name: 'write_page',
        description: 'Write a fictional page.',
        inputSchema: { type: 'object' },
        prepare: prepare('write'),
      },
    ],
    adminOperations: ['enable_profile', 'open_window'],
    resources: [{ id: 'profiles', read: true, write: true }],
    isAllowed: (_identity, use) => enabled.get(use.key)?.has(use.mode) === true,
    clock,
    server,
    audit: (event) => audit.push(event),
  }
  const broker = createPluginToolBroker(change(options))
  const ws = broker.owner.attach('willow')
  const agent = broker.owner.grantAgent(ws, 'fern-life-one')
  const person = broker.owner.grantPerson(ws, 'person-view-one')
  const name = broker.agent.discover(agent)[0]!.qualifiedName
  const call = (who = agent, input: BrokerInput = { profile: 'fern' }, signal?: AbortSignal) =>
    tracked(broker.agent.call(who, name, input, signal))
  return { broker, options, clock, server, audit, enabled, ws, agent, person, name, call }
}

describe('plugin authority and all-agent reach', () => {
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

describe('current resource policy at execution', () => {
  it('refuses disabled resources and read-only writes, while keeping discovery available', async () => {
    const h = setup()
    h.enabled.set('fern', new Set(['read']))
    await expect(h.call(h.agent, { profile: 'cedar' })).rejects.toMatchObject({ code: 'denied' })
    await expect(
      h.broker.agent.call(h.agent, h.name.replace('read_page', 'write_page'), { profile: 'fern' }),
    ).rejects.toMatchObject({ code: 'denied' })
    expect(h.server.calls).toHaveLength(0)
    expect(h.broker.agent.discover(h.agent)).toHaveLength(2)
  })
  it('checks choices after waiting, rather than trusting enqueue-time permission', async () => {
    const h = setup()
    const first = h.call()
    await tick()
    const queued = h.call()
    h.enabled.delete('fern')
    h.server.finish(0)
    await first
    await tick()
    await expect(queued).rejects.toMatchObject({ code: 'denied' })
    expect(h.server.calls).toHaveLength(1)
    expect(h.broker.status()).toMatchObject({ queued: 0, executing: false })
  })
  it('rechecks a queued request after a person mutation changes its choices', async () => {
    const h = setup()
    const first = h.broker.person.call(h.person, 'enable_profile', {})
    await tick()
    const pending = h.call()
    h.enabled.clear()
    h.server.finish(0)
    await first
    await tick()
    await expect(pending).rejects.toMatchObject({ code: 'denied' })
    expect(h.server.calls.map((c) => c.operation)).toEqual(['admin'])
  })
  it('rejects undeclared resources or modes outside the verified package permissions', async () => {
    const h = setup((o) => ({
      ...o,
      resources: [{ id: 'profiles', read: true, write: false }],
      isAllowed: () => true,
    }))
    await expect(
      h.broker.agent.call(h.agent, h.name.replace('read_page', 'write_page'), { profile: 'fern' }),
    ).rejects.toMatchObject({ code: 'denied' })
    const absent = setup((o) => ({ ...o, resources: [] }))
    await expect(absent.call()).rejects.toMatchObject({ code: 'denied' })
    expect(h.server.calls).toHaveLength(0)
    expect(absent.server.calls).toHaveLength(0)
  })
  it('clones queued inputs and freezes execution identity, arguments and resource claims', async () => {
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
    expect(request.resources).toEqual([{ resource: 'profiles', key: 'fern', mode: 'read' }])
    expect(Object.isFrozen(request.input.nested)).toBe(true)
    expect(Object.isFrozen(request.identity)).toBe(true)
    expect(Object.isFrozen(request.resources[0])).toBe(true)
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
  it('caps waiting requests at eight per workspace and 64 in total', async () => {
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
    expect(h.broker.status().queued).toBe(64)
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
      message: 'Plugin unavailable. Try again.',
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
    expect(h.broker.status()).toMatchObject({ available: false, executing: true })
    expect(h.server.calls).toHaveLength(1)
    h.server.calls[0]!.quiet.resolve()
    await tick()
    expect(h.broker.status()).toMatchObject({ available: false, executing: false })
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
  it('marks the plugin unavailable after a one-second missing-proof grace, and rejects new calls', async () => {
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
    await expect(queued).rejects.toMatchObject({ code: 'unavailable' })
    await expect(h.call()).rejects.toMatchObject({ code: 'unavailable' })
    expect(h.server.calls).toHaveLength(1)
    h.server.finish(0)
    await tick()
    expect(h.broker.status().available).toBe(false)
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
  it('does not start a job if policy evaluation crosses the queue deadline', async () => {
    const h = setup((o) => ({
      ...o,
      isAllowed: () => {
        ;(o.clock as Clock).time += 120_000
        return true
      },
    }))
    await expect(h.call()).rejects.toMatchObject({ code: 'deadline' })
    expect(h.server.calls).toHaveLength(0)
  })
})

describe('secret-free failures and diagnostics', () => {
  const secret = 'fictional-downstream-secret-never-for-logs'
  it('sanitizes server throws, cancellation errors, result rejections and malformed outcomes', async () => {
    const h = setup()
    h.server.startError = new Error(secret)
    const error = (await h.call().catch((e: unknown) => e)) as PluginBrokerError
    expect(error).toMatchObject({ code: 'unavailable', message: 'Plugin unavailable. Try again.' })
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
  it('never puts policy exceptions, identities, arguments or outputs in audit events', async () => {
    const h = setup((o) => ({
      ...o,
      isAllowed: () => {
        throw new Error(secret)
      },
    }))
    await expect(h.call(h.agent, { profile: 'fern', payload: secret })).rejects.toMatchObject({
      code: 'denied',
    })
    expect(JSON.stringify(h.audit)).not.toMatch(
      /fictional-downstream|fern|willow|incarnation|payload/,
    )
    for (const event of h.audit)
      expect(
        Object.keys(event).every((key) => ['event', 'operation', 'queued', 'code'].includes(key)),
      ).toBe(true)
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
  it('rechecks authority if the resource callback revokes it synchronously', async () => {
    let revoke = () => {}
    const h = setup((o) => ({
      ...o,
      isAllowed: () => {
        revoke()
        return true
      },
    }))
    revoke = () => h.broker.owner.revoke(h.agent)
    await expect(h.call()).rejects.toMatchObject({ code: 'unauthorized' })
    expect(h.server.calls).toHaveLength(0)
    expect(h.clock.timers.size).toBe(0)
  })
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
it('does not dispatch when the caller aborts during preparation', async () => {
  const signal = new AbortController()
  const h = setup((o) => ({
    ...o,
    isAllowed: () => {
      signal.abort()
      return true
    },
  }))
  await expect(h.call(h.agent, { profile: 'fern' }, signal.signal)).rejects.toMatchObject({
    code: 'cancelled',
  })
  expect(h.server.calls).toHaveLength(0)
  expect(h.broker.status()).toMatchObject({ executing: false, queued: 0 })
  expect(h.clock.timers.size).toBe(0)
})
