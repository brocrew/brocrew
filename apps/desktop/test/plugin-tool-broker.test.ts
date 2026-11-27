import { describe, expect, it } from 'vitest'
import { PluginBrokerError } from '../src/main/plugins/tool-broker'
import type { BrokerAgent, BrokerOptions, BrokerReply } from '../src/main/plugins/tool-broker'
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
  it('agent calls cannot reach an unpublished name or change identity with in-band fields', async () => {
    const h = setup()
    await expect(h.broker.agent.call(h.agent, 'enable_profile', {})).rejects.toMatchObject({
      code: 'denied',
    })
    const p = h.call(h.agent, {
      profile: 'fern',
      identity: { kind: 'person' },
      method: 'admin',
      name: 'enable_profile',
    })
    await tick()
    expect(h.server.calls[0]!.request.identity).toEqual({
      pluginId: 'fictional-browser',
      installId: 'installation-fern',
      epoch: 'epoch-one',
      workspaceId: 'willow',
      incarnation: 'fern-life-one',
    })
    h.server.finish(0)
    await p
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
  })
})

describe('package inputs at execution', () => {
  it('forwards inputs without cloning or freezing transport-owned values', async () => {
    const h = setup()
    const input = { profile: 'fern', nested: { title: 'before' } }
    const pending = h.call(h.agent, input)
    const request = h.server.calls[0]!.request
    expect(request.input).toBe(input)
    expect(Object.isFrozen(request.input.nested)).toBe(false)
    expect(Object.isFrozen(request.identity)).toBe(true)
    h.server.finish(0)
    await pending
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

describe('every admitted call starts at once', () => {
  it('a call that never answers does not delay another agent in the same or another workspace', async () => {
    const h = setup()
    const neighbour = h.broker.owner.grantAgent(h.ws, 'cedar-life-one')
    const elsewhere = h.broker.owner.grantAgent(h.broker.owner.attach('birch'), 'aspen-life-one')
    let hungSettled = false
    const hung = h.call()
    void hung.finally(() => {
      hungSettled = true
    })
    const sameWorkspace = h.call(neighbour)
    const otherWorkspace = h.call(elsewhere)
    expect(
      h.server.calls.map(
        (c) => `${c.request.identity.workspaceId}:${c.request.identity.incarnation}`,
      ),
    ).toEqual(['willow:fern-life-one', 'willow:cedar-life-one', 'birch:aspen-life-one'])
    h.server.finish(1, 'neighbour done')
    h.server.finish(2, 'elsewhere done')
    await expect(sameWorkspace).resolves.toBe('neighbour done')
    await expect(otherWorkspace).resolves.toBe('elsewhere done')
    await tick()
    expect(hungSettled).toBe(false)
    expect(h.broker.status()).toMatchObject({ available: true, executing: true })
    expect(h.audit.filter((event) => event.event === 'refused')).toEqual([])
    h.server.finish(0)
    await expect(hung).resolves.toEqual({ done: true })
    expect(h.broker.status()).toMatchObject({ executing: false, awaitingQuiescence: false })
  })
  it('runs many calls from one agent at the same time', async () => {
    const h = setup()
    const pending = Array.from({ length: 10 }, () => h.call())
    expect(h.server.calls).toHaveLength(10)
    expect(h.broker.status()).toMatchObject({ available: true, executing: true })
    for (let i = 9; i >= 0; i--) h.server.finish(i, i)
    await expect(Promise.all(pending)).resolves.toEqual([...Array(10).keys()])
    expect(h.broker.status()).toMatchObject({ available: true, executing: false })
  })
  it('caps running plus uncertain work at 64 even for one agent', async () => {
    const h = setup()
    const pending = Array.from({ length: 64 }, () => h.call())
    expect(h.server.calls).toHaveLength(64)
    await expect(h.call()).rejects.toMatchObject({ code: 'busy' })
    expect(h.server.calls).toHaveLength(64)
    h.broker.owner.invalidate()
    for (const result of await Promise.allSettled(pending))
      expect(result).toMatchObject({ status: 'rejected', reason: { code: 'unavailable' } })
    expect(h.broker.status()).toMatchObject({ available: false, executing: false })
    expect(h.broker.owner.hasCompletionProof()).toBe(false)
    for (const call of h.server.calls) call.quiet.resolve()
    await tick()
    expect(h.broker.owner.hasCompletionProof()).toBe(true)
  })
  it('cancelling a hung call releases it while the others keep running', async () => {
    const h = setup()
    const signal = new AbortController()
    const hung = h.call(h.agent, { profile: 'fern' }, signal.signal)
    const other = h.call(h.broker.owner.grantAgent(h.ws, 'cedar-life-one'))
    signal.abort()
    await expect(hung).rejects.toMatchObject({ code: 'cancelled' })
    expect(h.server.calls[0]!.signal.aborted).toBe(true)
    expect(h.server.calls[0]!.cancels).toBe(1)
    expect(h.server.calls[1]!.signal.aborted).toBe(false)
    expect(h.broker.status()).toMatchObject({ executing: true, awaitingQuiescence: true })
    h.server.calls[0]!.result.resolve({ ok: true, value: 'late' })
    h.server.finish(1)
    await expect(other).resolves.toEqual({ done: true })
    expect(h.broker.status()).toMatchObject({ executing: false, awaitingQuiescence: true })
    h.server.calls[0]!.quiet.resolve()
    await tick()
    expect(h.broker.status()).toMatchObject({ executing: false, awaitingQuiescence: false })
  })
  it('does not admit an already-cancelled call', async () => {
    const h = setup(),
      signal = new AbortController()
    signal.abort()
    await expect(h.call(h.agent, { profile: 'fern' }, signal.signal)).rejects.toMatchObject({
      code: 'cancelled',
    })
    expect(h.server.calls).toHaveLength(0)
  })
  it('host exit settles every running call', async () => {
    const exited = deferred<void>()
    const h = setup((options) => ({ ...options, hostExited: exited.promise }))
    const pending = [h.call(), h.call(), h.call(h.broker.owner.grantAgent(h.ws, 'cedar'))]
    exited.resolve()
    for (const result of await Promise.allSettled(pending))
      expect(result).toMatchObject({ status: 'rejected', reason: { code: 'unavailable' } })
    expect(h.broker.status()).toEqual({
      available: false,
      executing: false,
      awaitingQuiescence: false,
      unknownCalls: [],
    })
    expect(h.broker.owner.hasCompletionProof()).toBe(true)
    expect(h.audit.filter((event) => event.call?.state === 'host-exited')).toHaveLength(3)
  })
  it('answers only once both the result and quiescence arrive', async () => {
    const h = setup()
    let answered = false
    const first = h.call()
    void first.finally(() => {
      answered = true
    })
    h.server.calls[0]!.quiet.resolve()
    await tick()
    expect(answered).toBe(false)
    h.server.calls[0]!.result.resolve({ ok: true, value: { page: 'fictional' } })
    await expect(first).resolves.toEqual({ page: 'fictional' })
    const early = h.call()
    h.server.calls[1]!.result.resolve({ ok: true, value: 'early-result' })
    await tick()
    expect(h.broker.status()).toMatchObject({ executing: true })
    h.server.calls[1]!.quiet.resolve()
    await expect(early).resolves.toBe('early-result')
  })
  it('detaching one workspace cancels its work, while another workspace keeps running', async () => {
    const h = setup()
    const first = h.call()
    const second = h.call()
    const other = h.broker.owner.grantAgent(h.broker.owner.attach('birch'), 'aspen')
    const next = h.call(other)
    h.broker.owner.detach(h.ws)
    await expect(first).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(second).rejects.toMatchObject({ code: 'unauthorized' })
    expect(h.server.calls[2]!.signal.aborted).toBe(false)
    h.server.finish(2)
    await expect(next).resolves.toEqual({ done: true })
  })
})

describe('secret-free failures and diagnostics', () => {
  const secret = 'fictional-downstream-secret-never-for-logs'
  it('preserves server failure causes while keeping cancellation and audit facts', async () => {
    const h = setup()
    h.server.startError = new Error(secret)
    const error = (await h.call().catch((e: unknown) => e)) as PluginBrokerError
    expect(error).toMatchObject({
      code: 'unavailable',
      message: `Tool read_page failed: unavailable; completion is unknown. ${secret}`,
      cause: h.server.startError,
    })
    expect(String(error.stack)).toContain(secret)
    expect(JSON.stringify(h.audit)).not.toContain(secret)
    const rejected = setup()
    const pending = rejected.call()
    await tick()
    const original = new Error(secret)
    rejected.server.calls[0]!.result.reject(original)
    rejected.server.calls[0]!.quiet.resolve()
    await tick()
    await expect(pending).rejects.toMatchObject({
      code: 'downstream',
      message: expect.stringContaining(secret),
      cause: original,
    })
    expect(rejected.broker.status().available).toBe(true)
    const cancel = setup()
    cancel.server.cancelError = new Error(secret)
    const signal = new AbortController()
    const stopped = cancel.call(cancel.agent, { profile: 'fern' }, signal.signal)
    await tick()
    signal.abort()
    await tick()
    await expect(stopped).rejects.toMatchObject({ code: 'cancelled' })
    expect(cancel.broker.status().available).toBe(true)
    expect(cancel.audit).toContainEqual(
      expect.objectContaining({ event: 'refused', code: 'downstream', reason: 'cancel-failed' }),
    )
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
        Object.keys(event).every((key) => ['event', 'code', 'reason', 'call'].includes(key)),
      ).toBe(true)
    for (const event of h.audit)
      if (event.reason !== undefined)
        expect([
          'call-state',
          'proof-rejected',
          'cancel-failed',
          'execution-invalid',
          'reply-invalid',
          'owner-invalidated',
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
  it('forwards large input and output without broker conversion', async () => {
    const h = setup()
    const input = { profile: 'fern', large: 'x'.repeat(65536) }
    const pending = h.call(h.agent, input)
    await tick()
    expect(h.server.calls[0]!.request.input).toBe(input)
    const reply = { large: 'x'.repeat(8 * 1024 * 1024), nested: { title: 'unchanged' } }
    h.server.finish(0, reply)
    await expect(pending).resolves.toBe(reply)
    expect(Object.isFrozen(reply.nested)).toBe(false)
  })
  it('isolates invalid plugin replies without a raw error', async () => {
    const h = setup()
    const pending = h.call()
    await tick()
    h.server.calls[0]!.result.resolve({ ok: false, error: secret } as unknown as BrokerReply)
    h.server.calls[0]!.quiet.resolve()
    await expect(pending).rejects.toMatchObject({ code: 'downstream' })
    expect(JSON.stringify(h.audit)).not.toContain(secret)
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
      },
    }))
    revoke = () => h.broker.owner.revoke(h.agent)
    const first = h.call()
    await tick()
    await expect(first).rejects.toMatchObject({ code: 'unauthorized' })
    expect(h.server.calls[0]!.signal.aborted).toBe(true)
    expect(h.server.calls[0]!.cancels).toBe(1)
    expect(h.broker.status()).toMatchObject({ executing: false, awaitingQuiescence: true })
    h.server.calls[0]!.quiet.resolve()
    await tick()
    expect(h.broker.status()).toMatchObject({ available: true, awaitingQuiescence: false })
  })
  it('invalidating an epoch stops every running call, and late success cannot restore it', async () => {
    const h = setup()
    const first = h.call()
    const next = h.call()
    h.broker.owner.invalidate()
    await expect(first).rejects.toMatchObject({ code: 'unavailable' })
    await expect(next).rejects.toMatchObject({ code: 'unavailable' })
    h.server.finish(0, 'late')
    h.server.finish(1, 'late')
    await tick()
    expect(h.broker.status()).toEqual({
      available: false,
      executing: false,
      awaitingQuiescence: false,
      unknownCalls: [],
    })
    expect(() => h.broker.agent.discover(h.agent)).toThrow(PluginBrokerError)
  })
  it('a rejected quiescence receipt fails only its own call and keeps it uncertain', async () => {
    const h = setup()
    const first = h.call()
    const second = h.call()
    h.server.calls[0]!.quiet.reject(new Error('fictional-quiescence-secret'))
    await expect(first).rejects.toMatchObject({
      code: 'downstream',
      message: expect.stringContaining('completion is unknown'),
    })
    expect(h.audit).toContainEqual(
      expect.objectContaining({ event: 'refused', code: 'downstream', reason: 'proof-rejected' }),
    )
    h.server.finish(1)
    await expect(second).resolves.toEqual({ done: true })
    expect(h.broker.status()).toMatchObject({ available: true, awaitingQuiescence: true })
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
    'pluginId',
    'workspaceId',
  ])
  expect(JSON.stringify(h.audit)).not.toContain('fictional-extra-secret')
  h.server.finish(0)
  await pending
})

it('offers replacement authority only after a failed call positively completes', async () => {
  const h = setup()
  const pending = h.call()
  h.server.calls[0]!.result.resolve({ ok: false, cause: 'stalled' })
  await expect(pending).rejects.toMatchObject({ code: 'downstream' })
  expect(h.broker.status()).toMatchObject({ available: true, awaitingQuiescence: true })
  expect(h.broker.owner.hasCompletionProof()).toBe(false)
  h.broker.owner.invalidate()
  expect(h.broker.owner.hasCompletionProof()).toBe(false)
  h.server.calls[0]!.quiet.resolve()
  await tick()
  expect(h.broker.status()).toMatchObject({ available: false, executing: false })
  expect(h.broker.owner.hasCompletionProof()).toBe(true)
})

it('uses positive exact-host exit after a rejected call proof, never a rejected host proof', async () => {
  const host = deferred<void>()
  const h = setup((options) => Object.assign(options, { hostExited: host.promise }))
  const pending = h.call()
  h.server.calls[0]!.quiet.reject(new Error('fictional unproved remote call'))
  await expect(pending).rejects.toMatchObject({ code: 'downstream' })
  expect(h.broker.owner.hasCompletionProof()).toBe(false)
  host.resolve()
  await tick()
  expect(h.broker.owner.hasCompletionProof()).toBe(true)
  expect(h.broker.status()).toMatchObject({ available: false, executing: false })

  const unknown = deferred<void>()
  const other = setup((options) => Object.assign(options, { hostExited: unknown.promise }))
  const active = other.call()
  unknown.reject(new Error('fictional unknown host exit'))
  other.server.calls[0]!.result.resolve({ ok: false, cause: 'stalled' })
  await expect(active).rejects.toThrow()
  expect(other.audit).toContainEqual(
    expect.objectContaining({ event: 'refused', reason: 'host-exit-unproven' }),
  )
  expect(other.broker.owner.hasCompletionProof()).toBe(false)
  expect(other.broker.status()).toMatchObject({ available: true, awaitingQuiescence: true })
})

it('preserves original construction and submission exceptions', async () => {
  const construction = new Error('fictional inventory getter failure')
  expect(() =>
    setup((options) =>
      Object.defineProperty(options, 'tools', {
        get() {
          throw construction
        },
      }),
    ),
  ).toThrow(construction)
  const h = setup()
  const submission = new Error('fictional signal getter failure')
  const signal = Object.defineProperty(new AbortController().signal, 'aborted', {
    get() {
      throw submission
    },
  })
  await expect(h.call(h.agent, { profile: 'fern' }, signal)).rejects.toBe(submission)
  expect(h.server.calls).toHaveLength(0)
})

it.each(['cause', 'error'] as const)(
  'settles a failed reply with a throwing %s getter',
  async (field) => {
    const h = setup()
    const pending = h.call()
    await tick()
    const original = new Error(`fictional ${field} getter failure`)
    h.server.calls[0]!.result.resolve(
      Object.defineProperty({ ok: false as const }, field, {
        get() {
          throw original
        },
      }),
    )
    h.server.calls[0]!.quiet.resolve()
    await expect(pending).rejects.toMatchObject({
      cause: original,
      message: expect.stringContaining(original.message),
    })
  },
)

it.each(['proof-first', 'result-first'])(
  'extracts a throwing success value before answering (%s)',
  async (order) => {
    const h = setup()
    const pending = h.call()
    await tick()
    const call = h.server.calls[0]!
    const original = new Error('fictional success value getter failure')
    if (order === 'proof-first') {
      call.quiet.resolve()
      await tick()
    }
    call.result.resolve({
      ok: true,
      get value(): never {
        throw original
      },
    })
    await tick()
    if (order === 'result-first') call.quiet.resolve()
    await expect(pending).rejects.toMatchObject({
      code: 'downstream',
      cause: original,
      message: expect.stringContaining(original.message),
    })
    expect(h.broker.status().available).toBe(true)
  },
)
it('keeps the first failed result cause when quiescence also rejects', async () => {
  const h = setup()
  const pending = h.call()
  await tick()
  const original = new Error('fictional first call failure')
  h.server.calls[0]!.result.resolve({ ok: false, error: original })
  await tick()
  h.server.calls[0]!.quiet.reject(new Error('fictional later proof failure'))
  await expect(pending).rejects.toMatchObject({
    code: 'downstream',
    cause: original,
    message: expect.stringContaining(original.message),
  })
  expect(h.broker.status().available).toBe(true)
})
