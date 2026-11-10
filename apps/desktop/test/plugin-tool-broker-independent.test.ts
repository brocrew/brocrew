import { describe, expect, it } from 'vitest'
import { PluginBrokerError } from '../src/main/plugins/tool-broker'
import type { BrokerValue } from '../src/main/plugins/tool-broker'
import { deferred, tick, tracked, setup } from './helpers/plugin-tool-broker'

describe('independent transport calls', () => {
  it('counts an active call already retained as uncertain only once during cancellation', async () => {
    const h = setup((options) => ({
      ...options,
      server: { ...options.server, independentToolCalls: true },
    }))
    for (let i = 0; i < 62; i++) {
      const pending = h.call()
      await tick()
      h.server.calls[i]!.result.resolve({ ok: false, cause: 'stalled' })
      h.server.calls[i]!.quiet.reject(new Error('unproved'))
      await expect(pending).rejects.toMatchObject({ code: 'downstream' })
      await tick()
    }
    let admitted: Promise<BrokerValue> | undefined
    const active = h.call()
    await tick()
    h.server.onCancel = () => {
      h.server.onCancel = undefined
      admitted = h.call()
    }
    h.server.calls[62]!.result.resolve({ ok: false, cause: 'stalled' })
    await expect(active).rejects.toMatchObject({ code: 'downstream' })
    await tick()
    expect(h.server.calls).toHaveLength(64)
    await expect(h.call()).rejects.toMatchObject({ code: 'busy' })
    h.server.finish(63)
    await expect(admitted).resolves.toEqual({ done: true })
  })
  it('retains only a known activity stage and clears its visible record on positive host exit', async () => {
    const exited = deferred<void>()
    const h = setup((options) => ({
      ...options,
      hostExited: exited.promise,
      server: { ...options.server, independentToolCalls: true },
    }))
    const pending = h.call()
    await tick()
    h.server.calls[0]!.onprogress?.({ progress: 1, message: 'fictional-page-title' })
    h.server.calls[0]!.onprogress?.({ progress: 2, message: 'screenshot-captured' })
    h.server.calls[0]!.result.resolve({ ok: false, cause: 'stalled' })
    h.server.calls[0]!.quiet.reject(new Error('unproved'))
    await expect(pending).rejects.toMatchObject({ code: 'downstream' })
    expect(h.broker.status().unknownCalls).toEqual([
      expect.objectContaining({
        tool: 'read_page',
        lastStage: 'screenshot-captured',
        state: 'completion-unknown',
        startedAt: expect.any(String),
      }),
    ])
    expect(JSON.stringify(h.audit)).not.toContain('fictional-page-title')
    exited.resolve()
    await tick()
    expect(h.broker.status().unknownCalls).toEqual([])
    expect(h.broker.owner.hasCompletionProof()).toBe(true)
  })
  it.each(['reply-first', 'proof-first'])(
    'releases a successful reply with rejected proof (%s)',
    async (order) => {
      const h = setup((options) => ({
        ...options,
        server: { ...options.server, independentToolCalls: true },
      }))
      let outcome: unknown
      void h.call().then(
        (value) => {
          outcome = value
        },
        (error) => {
          outcome = error
        },
      )
      await tick()
      const call = h.server.calls[0]!
      const original = new Error('close failed')
      if (order === 'reply-first') call.result.resolve({ ok: true, value: 'remote reply' })
      else call.quiet.reject(original)
      await tick()
      if (order === 'reply-first') call.quiet.reject(original)
      else call.result.resolve({ ok: true, value: 'remote reply' })
      await tick()
      expect(outcome).toMatchObject({
        message: expect.stringContaining('completion is unknown'),
        cause: original,
      })
      expect(outcome).toMatchObject({ message: expect.stringContaining('close failed') })
      expect(h.broker.status()).toMatchObject({
        available: true,
        executing: false,
        awaitingQuiescence: true,
      })
      const second = h.call()
      await tick()
      expect(h.server.calls).toHaveLength(2)
      h.server.finish(1)
      await second
      h.broker.owner.invalidate()
      expect(h.broker.owner.hasCompletionProof()).toBe(false)
    },
  )
  it('counts active admin work together with uncertain and queued calls', async () => {
    const h = setup((options) => ({
      ...options,
      server: { ...options.server, independentToolCalls: true },
    }))
    for (let i = 0; i < 63; i++) {
      const call = h.call()
      await tick()
      h.server.calls[i]!.result.resolve({ ok: false, cause: 'stalled' })
      h.server.calls[i]!.quiet.reject(new Error('unproved'))
      await expect(call).rejects.toMatchObject({ code: 'downstream' })
      await tick()
    }
    const admin = tracked(h.broker.person.call(h.person, 'open_window', {}))
    await tick()
    let refused = false
    void h.call().catch((error) => {
      refused = error.code === 'busy'
    })
    await tick()
    expect(refused).toBe(true)
    h.server.finish(63)
    await admin
  })
  it('retains unknown completion across later successful calls until exact host exit', async () => {
    const exited = deferred<void>()
    const h = setup((options) => ({
      ...options,
      hostExited: exited.promise,
      server: { ...options.server, independentToolCalls: true },
    }))
    const first = tracked(h.call())
    await tick()
    h.server.calls[0]!.quiet.reject(new PluginBrokerError('downstream', 'read_page', 'stalled'))
    h.server.calls[0]!.result.resolve({ ok: false, cause: 'stalled' })
    await expect(first).rejects.toMatchObject({
      code: 'downstream',
      message:
        'Tool read_page took too long; completion is unknown. The operation may still be running.',
    })
    await tick()
    const second = h.call()
    await tick()
    expect(h.server.calls).toHaveLength(2)
    h.server.finish(1)
    await second
    expect(h.broker.status()).toMatchObject({ available: true, awaitingQuiescence: true })
    expect(h.audit).toContainEqual(
      expect.objectContaining({
        call: expect.objectContaining({
          tool: 'read_page',
          state: 'completion-unknown',
          lastStage: 'unknown',
          startedAt: expect.any(String),
        }),
      }),
    )
    h.broker.owner.invalidate()
    expect(h.broker.owner.hasCompletionProof()).toBe(false)
    exited.resolve()
    await tick()
    expect(h.broker.owner.hasCompletionProof()).toBe(true)
    expect(h.audit).toContainEqual(
      expect.objectContaining({
        call: expect.objectContaining({ tool: 'read_page', state: 'host-exited' }),
      }),
    )
  })
  it('bounds retained uncertainty with the existing total capacity', async () => {
    const h = setup((options) => ({
      ...options,
      server: { ...options.server, independentToolCalls: true },
    }))
    for (let i = 0; i < 64; i++) {
      const pending = tracked(h.call())
      await tick()
      h.server.calls[i]!.result.resolve({ ok: false, cause: 'stalled' })
      h.server.calls[i]!.quiet.reject(new Error('unproved'))
      await expect(pending).rejects.toMatchObject({ code: 'downstream' })
      await tick()
    }
    await expect(h.call()).rejects.toMatchObject({ code: 'busy' })
    expect(h.broker.status().available).toBe(true)
    expect(h.server.calls).toHaveLength(64)
  })
})
