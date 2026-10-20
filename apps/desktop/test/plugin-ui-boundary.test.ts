import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginUiAssets, PLUGIN_CSP, PLUGIN_SCHEME } from '../src/main/plugins/ui/assets'
import { PluginUiRpc, matchesUiSchema, type PluginUiPeer } from '../src/main/plugins/ui/rpc'
import {
  boundedJson,
  pluginUiPacket,
  PLUGIN_UI_CHANNEL,
  PLUGIN_UI_LIMITS,
} from '../src/shared/plugin-ui'
import { uiFixture } from './plugin-ui-fixtures'
const a = '11111111-1111-4111-8111-111111111111',
  b = '22222222-2222-4222-8222-222222222222'
const packet = (method = 'read', requestId = 'request', payload: unknown = {}) => ({
  channel: PLUGIN_UI_CHANNEL,
  method,
  requestId,
  payload,
  configRevision: 3,
})
const rpcs: PluginUiRpc[] = []
afterEach(() => {
  for (const rpc of rpcs.splice(0)) rpc.close()
  vi.useRealTimers()
})
function rpcFixture() {
  const { binding, verified } = uiFixture(),
    emit = vi.fn(),
    propose = vi.fn(),
    stop = vi.fn()
  let current = true,
    time = 0,
    push: (data: unknown) => void = () => {}
  const peer: PluginUiPeer = {
    read: vi.fn(async () => ({ loaves: 2 })),
    subscribe: vi.fn(async (_payload, _revision, _binding, _signal, send) => {
      push = send
      return stop
    }),
    proposeConfig: vi.fn(async () => ({ resources: ['fictional-recipes'] })),
  }
  const rpc = new PluginUiRpc({
    binding,
    schemas: verified.manifest.ui!.methodSchemas,
    peer,
    current: () => current,
    now: () => time,
    emit,
    propose,
  })
  rpcs.push(rpc)
  return {
    rpc,
    peer,
    binding,
    emit,
    propose,
    stop,
    push: (data: unknown) => push(data),
    advance: () => {
      time += 1000
    },
    revoke: () => {
      current = false
    },
  }
}
describe('per-view verified assets', () => {
  it('serves only its admitted GET/HEAD assets with CSP and exact per-view URLs', async () => {
    const { verified } = uiFixture(),
      first = new PluginUiAssets(verified, a),
      second = new PluginUiAssets(verified, b)
    expect(first.origin).not.toBe(second.origin)
    const response = first.response({ url: first.entry, method: 'GET' })
    expect(await response.text()).toContain('Fictional bakery')
    expect(response.headers.get('content-security-policy')).toBe(PLUGIN_CSP)
    for (const rule of [
      "default-src 'none'",
      "script-src 'self'",
      "connect-src 'none'",
      "frame-src 'none'",
      "worker-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ])
      expect(PLUGIN_CSP).toContain(rule)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await first.response({ url: first.entry, method: 'HEAD' }).text()).toBe('')
    for (const url of [
      second.entry,
      first.entry + '?query',
      first.entry + '#fragment',
      first.origin + '/plugin.json',
      'file:///fictional',
      'https://example.invalid/',
    ])
      expect(first.response({ url, method: 'GET' }).status).toBe(404)
    expect(first.response({ url: first.entry, method: 'POST' }).status).toBe(404)
    expect(PLUGIN_SCHEME.privileges).toMatchObject({
      standard: true,
      secure: true,
      bypassCSP: false,
      allowServiceWorkers: false,
    })
  })
})
describe('strict and bounded own-plugin RPC', () => {
  it('routes read to the fixed binding only, and returns data without private authority', async () => {
    const f = rpcFixture()
    const answer = await f.rpc.invoke(packet())
    expect(answer).toEqual({ loaves: 2 })
    expect(f.peer.read).toHaveBeenCalledWith({}, 3, f.binding, expect.any(AbortSignal))
    expect(JSON.stringify(answer)).not.toContain(f.binding.leaseId)
    await expect(f.rpc.invoke({ ...packet(), pluginId: 'other' })).rejects.toThrow()
    await expect(f.rpc.invoke(packet('app:info'))).rejects.toThrow()
    expect(f.peer.read).toHaveBeenCalledTimes(1)
    f.rpc.close()
  })
  it('checks exact packets, JSON type/size and declared schema before calling the peer', async () => {
    const f = rpcFixture()
    for (const value of [
      packet('read', 'bad id'),
      { ...packet(), configRevision: -1 },
      packet('read', 'x', { hidden: 1 }),
      packet('read', 'x', 'x'.repeat(PLUGIN_UI_LIMITS.request)),
      { ...packet(), extra: 1 },
    ])
      await expect(f.rpc.invoke(value)).rejects.toThrow()
    expect(f.peer.read).not.toHaveBeenCalled()
    expect(pluginUiPacket({ ...packet(), payload: new Map() })).toBe(false)
    expect(boundedJson({ n: Infinity }, 100)).toBeNull()
    expect(boundedJson(Array(2), 100)).toBeNull()
    expect(boundedJson({ a: '🙂', b: '"' }, 26)).toBe(JSON.stringify({ a: '🙂', b: '"' }))
    expect(boundedJson(['x'.repeat(80), 'x'.repeat(80)], 100)).toBeNull()
    expect(
      matchesUiSchema(['a'], {
        type: 'array',
        maxItems: 1,
        items: { type: 'string', maxLength: 1 },
      }),
    ).toBe(true)
    expect(
      matchesUiSchema(['ab'], {
        type: 'array',
        maxItems: 1,
        items: { type: 'string', maxLength: 1 },
      }),
    ).toBe(false)
    f.rpc.close()
  })
  it('caps four pending requests and rejects duplicate request IDs', async () => {
    const f = rpcFixture()
    f.peer.read = vi.fn(() => new Promise(() => {}))
    const pending = [0, 1, 2, 3].map((index) =>
      f.rpc.invoke(packet('read', String(index))).catch((error) => error.message),
    )
    const fifth = f.rpc.invoke(packet('read', '4')).catch((error) => error.message)
    await Promise.resolve()
    await Promise.resolve()
    expect(f.peer.read).toHaveBeenCalledOnce()
    expect(await fifth).toContain('Plugin busy.')
    await expect(f.rpc.invoke(packet('read', '0'))).rejects.toThrow('Plugin busy.')
    f.rpc.close()
    expect(await Promise.all(pending)).toHaveLength(4)
  })
  it('caps subscriptions at two, scopes unsubscribe locally and stops them on teardown', async () => {
    const f = rpcFixture()
    await f.rpc.invoke(packet('subscribe', 'one'))
    await f.rpc.invoke(packet('subscribe', 'two'))
    await expect(f.rpc.invoke(packet('subscribe', 'three'))).rejects.toThrow('Plugin busy.')
    await expect(
      f.rpc.invoke(packet('unsubscribe', 'bad', { subscriptionId: 'foreign' })),
    ).rejects.toThrow()
    await f.rpc.invoke(packet('unsubscribe', 'stop', { subscriptionId: 'one' }))
    expect(f.stop).toHaveBeenCalledTimes(1)
    f.rpc.close()
    expect(f.stop).toHaveBeenCalledTimes(2)
  })
  it('bounds snapshot bytes and rate, and ignores revoked subscription pushes', async () => {
    const f = rpcFixture()
    await f.rpc.invoke(packet('subscribe', 'one'))
    f.push({ loaves: 1 })
    f.push({ loaves: 2 })
    expect(f.emit).toHaveBeenCalledTimes(1)
    f.advance()
    f.push({ loaves: 3 })
    expect(f.emit).toHaveBeenCalledTimes(2)
    f.advance()
    f.push('x'.repeat(PLUGIN_UI_LIMITS.reply))
    expect(f.stop).toHaveBeenCalledOnce()
    f.rpc.close()
    f.advance()
    f.push({ loaves: 4 })
    expect(f.emit).toHaveBeenCalledTimes(2)
  })
  it('waits for the snapshot slot after a successful Apply instead of reporting a false failure', async () => {
    vi.useFakeTimers()
    const f = rpcFixture()
    await f.rpc.invoke(packet('read', 'before'))
    await f.rpc.invoke(packet('proposeConfig', 'apply', { loaves: 3 }))
    let finished = false
    const refresh = f.rpc.invoke(packet('read', 'after')).then(
      (value) => {
        finished = true
        return { ok: true, value }
      },
      () => ({ ok: false, value: null }),
    )
    await vi.advanceTimersByTimeAsync(999)
    expect(finished).toBe(false)
    f.advance()
    await vi.advanceTimersByTimeAsync(1)
    expect(await refresh).toEqual({ ok: true, value: { loaves: 2 } })
  })
  it('reads fresh state when its slot opens instead of buffering a pre-Apply snapshot', async () => {
    vi.useFakeTimers()
    const f = rpcFixture()
    await f.rpc.invoke(packet('read', 'before'))
    let loaves = 3
    f.peer.read = vi.fn(async () => ({ loaves }))
    const refresh = f.rpc.invoke(packet('read', 'queued')).catch(() => null)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.peer.read).not.toHaveBeenCalled()
    loaves = 4
    f.advance()
    await vi.advanceTimersByTimeAsync(1000)
    expect(await refresh).toEqual({ loaves: 4 })
  })
  it('cancels a queued refresh on close, without publishing a late snapshot', async () => {
    vi.useFakeTimers()
    const f = rpcFixture()
    await f.rpc.invoke(packet('read', 'before'))
    const refresh = f.rpc.invoke(packet('read', 'queued')).catch((error) => error.message)
    await vi.advanceTimersByTimeAsync(0)
    f.rpc.close()
    expect(await refresh).toBe('Plugin unavailable. Try again.')
    f.advance()
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.emit).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('paces concurrent refreshes and prevents subscription pushes from starving them', async () => {
    vi.useFakeTimers()
    const f = rpcFixture()
    await f.rpc.invoke(packet('subscribe', 'sub'))
    f.push({ loaves: 1 })
    const replies: number[] = []
    const refreshes = ['one', 'two'].map((id) =>
      f.rpc.invoke(packet('read', id)).then(
        () => replies.push(replies.length + 1),
        () => undefined,
      ),
    )
    await vi.advanceTimersByTimeAsync(0)
    f.advance()
    f.push({ loaves: 8 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(replies).toEqual([1])
    expect(f.emit).toHaveBeenCalledTimes(1)
    f.advance()
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all(refreshes)
    expect(replies).toEqual([1, 2])
  })
  it('times out and cancels a hung peer without forwarding raw failures', async () => {
    vi.useFakeTimers()
    const f = rpcFixture()
    let signal: AbortSignal | undefined
    f.peer.read = vi.fn((_payload, _revision, _binding, seen) => {
      signal = seen
      return new Promise(() => {})
    })
    const pending = f.rpc.invoke(packet()).catch((error) => error.message)
    await vi.advanceTimersByTimeAsync(PLUGIN_UI_LIMITS.timeout)
    expect(await pending).toBe('Plugin unavailable. Try again.')
    expect(signal?.aborted).toBe(true)
    f.rpc.close()
  })
  it('bounds queued reads by the same deadline and permits a fresh read after a hung predecessor', async () => {
    vi.useFakeTimers()
    const f = rpcFixture()
    f.peer.read = vi.fn(() => new Promise(() => {}))
    const pending = ['hung', 'queued'].map((id) =>
      f.rpc.invoke(packet('read', id)).catch((error) => error.message),
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(f.peer.read).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(PLUGIN_UI_LIMITS.timeout)
    expect(await Promise.all(pending)).toEqual([
      'Plugin unavailable. Try again.',
      'Plugin unavailable. Try again.',
    ])
    f.peer.read = vi.fn(async () => ({ loaves: 5 }))
    expect(await f.rpc.invoke(packet('read', 'fresh'))).toEqual({ loaves: 5 })
  })
  it.each(['resolve', 'reject'] as const)(
    'a reused subscription survives the timed-out owner’s late %s',
    async (completion) => {
      vi.useFakeTimers()
      const f = rpcFixture(),
        stopA = vi.fn(),
        stopB = vi.fn()
      let resolveA: (stop: () => void) => void = () => {},
        rejectA: (error: Error) => void = () => {},
        resolveB: (stop: () => void) => void = () => {},
        pushB: (value: unknown) => void = () => {}
      const signals: AbortSignal[] = []
      f.peer.subscribe = vi
        .fn()
        .mockImplementationOnce((_payload, _revision, _binding, signal: AbortSignal) => {
          signals.push(signal)
          return new Promise<() => void>((resolve, reject) => {
            resolveA = resolve
            rejectA = reject
          })
        })
        .mockImplementationOnce(
          (_payload, _revision, _binding, signal: AbortSignal, send: (value: unknown) => void) => {
            signals.push(signal)
            pushB = send
            return new Promise<() => void>((resolve) => {
              resolveB = resolve
            })
          },
        )
      const first = f.rpc.invoke(packet('subscribe', 'reused')).catch((error) => error.message)
      await vi.advanceTimersByTimeAsync(PLUGIN_UI_LIMITS.timeout)
      expect(await first).toBe('Plugin unavailable. Try again.')
      expect(signals[0]?.aborted).toBe(true)
      const second = f.rpc.invoke(packet('subscribe', 'reused')).then(
        (data) => ({ ok: true, data }),
        () => ({ ok: false }),
      )
      if (completion === 'resolve') resolveA(stopA)
      else rejectA(new Error('fictional late refusal'))
      await vi.advanceTimersByTimeAsync(0)
      expect(signals[1]?.aborted).toBe(false)
      expect(stopA).toHaveBeenCalledTimes(completion === 'resolve' ? 1 : 0)
      resolveB(stopB)
      expect(await second).toEqual({ ok: true, data: { subscriptionId: 'reused' } })
      pushB({ loaves: 7 })
      expect(f.emit).toHaveBeenCalledWith('reused', { loaves: 7 })
      expect(stopB).not.toHaveBeenCalled()
      f.rpc.close()
      expect(stopB).toHaveBeenCalledOnce()
    },
  )
  it('revalidates identity after awaiting, and a proposal never commits configuration', async () => {
    const f = rpcFixture()
    expect(await f.rpc.invoke(packet('proposeConfig', 'p', { loaves: 3 }))).toEqual({
      proposed: true,
    })
    expect(f.propose).toHaveBeenCalledWith({ resources: ['fictional-recipes'] }, 3)
    f.peer.read = vi.fn(async () => {
      f.revoke()
      return { raw: 'fictional-private-detail' }
    })
    await expect(f.rpc.invoke(packet())).rejects.toThrow('Plugin unavailable. Try again.')
    f.rpc.close()
  })
})
