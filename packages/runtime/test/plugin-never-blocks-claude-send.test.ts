import { afterEach, expect, it, vi } from 'vitest'
import {
  withManagedPluginAttachments,
  PLUGIN_ATTACHMENT_WAIT_MS,
  type ManagedPluginAttachment,
  type ManagedPluginAttachmentSource,
} from '../src/managed-plugin-session'
import type { AgentRuntime, SessionHandle } from '../src/runtime'
import { AsyncQueue } from '../src/internal/async-queue'
import type { RuntimeEvent } from '../src/events'

// W4.1476 item 8: an optional plugin never blocks Send. The live 0.2.4 symptom was Claude's
// "Your message wasn't sent" after a pending plugin refresh outlasted the 1500 ms wrapper wait
// (managed-plugin-session.ts refreshRefusal). These controls use a Claude-shaped fictional
// handle: it has refreshManagedPlugins, so no Codex reopen path is involved.

const route = { name: 'plugin-fern', url: 'http://127.0.0.1:8123/mcp', capability: 'a'.repeat(64) }
const changed = { ...route, capability: 'b'.repeat(64) }
const initial = { cwd: '/fictional/willow', providerHome: '/fictional/home', model: 'fictional' }

afterEach(() => vi.useRealTimers())

function claudeFixture() {
  let next: ManagedPluginAttachment = { revision: 'one', servers: [route] }
  const source: ManagedPluginAttachmentSource = {
    read: vi.fn(async () => next),
    close: vi.fn(async () => {}),
  }
  const queue = new AsyncQueue<RuntimeEvent>()
  let ended = false
  let settleRefresh: { resolve: () => void; reject: (error: Error) => void } | undefined
  const send = vi.fn(async () => {
    if (ended) throw new Error('fictional session ended')
  })
  const close = vi.fn(async () => {
    ended = true
    queue.close()
  })
  // The first refresh hangs until the test settles it; a later retry applies at once.
  const refreshManagedPlugins = vi.fn(async () => {})
  refreshManagedPlugins.mockImplementationOnce(
    () =>
      new Promise<void>((resolve, reject) => {
        settleRefresh = { resolve, reject }
      }),
  )
  const handle = {
    ref: null,
    status: () => (ended ? 'ended' : 'idle'),
    events: () => queue,
    send,
    close,
    interrupt: vi.fn(async () => {}),
    refreshManagedPlugins,
  } as unknown as SessionHandle
  const raw = {
    provider: 'claude',
    start: vi.fn(async () => handle),
    resume: vi.fn(async () => handle),
  } as unknown as AgentRuntime
  return {
    runtime: withManagedPluginAttachments(raw, source),
    source,
    raw,
    send,
    close,
    refreshManagedPlugins,
    change(value: ManagedPluginAttachment) {
      next = value
    },
    settle: () => settleRefresh!,
  }
}

it('delivers the message once on the live Claude handle when a plugin refresh hangs past the wait', async () => {
  vi.useFakeTimers()
  const f = claudeFixture()
  const a = await f.runtime.start(initial)
  f.change({ revision: 'two', servers: [changed] })
  let outcome: unknown = 'pending'
  void a.send('fictional words').then(
    () => (outcome = 'sent'),
    (error: unknown) => (outcome = error),
  )
  await vi.advanceTimersByTimeAsync(PLUGIN_ATTACHMENT_WAIT_MS + 1)
  try {
    expect(outcome).toBe('sent')
    expect(f.send).toHaveBeenCalledTimes(1)
    expect(f.send).toHaveBeenCalledWith('fictional words')
    // A usable handle is never retired just because plugin tools are late.
    expect(f.close).not.toHaveBeenCalled()
    expect(f.raw.start).toHaveBeenCalledTimes(1)
    expect(a.status()).not.toBe('ended')
    // The next message also goes out, without stacking a second concurrent refresh.
    await a.send('second words')
    expect(f.send).toHaveBeenCalledTimes(2)
    expect(f.refreshManagedPlugins).toHaveBeenCalledTimes(1)
  } finally {
    f.settle().resolve()
    await a.close()
  }
})

it.each(['resolve', 'reject'] as const)(
  'a refresh that later settles by %s neither resends nor retires the handle',
  async (late) => {
    vi.useFakeTimers()
    const f = claudeFixture()
    const a = await f.runtime.start(initial)
    f.change({ revision: 'two', servers: [changed] })
    const sending = a.send('fictional words')
    await vi.advanceTimersByTimeAsync(PLUGIN_ATTACHMENT_WAIT_MS + 1)
    try {
      await expect(sending).resolves.toBeUndefined()
      if (late === 'resolve') f.settle().resolve()
      else f.settle().reject(new Error('fictional refresh failure'))
      await vi.advanceTimersByTimeAsync(0)
      expect(f.send).toHaveBeenCalledTimes(1)
      expect(f.close).not.toHaveBeenCalled()
      await a.send('second words')
      expect(f.send).toHaveBeenCalledTimes(2)
    } finally {
      await a.close()
    }
  },
)

it('Stop during a slow refresh keeps that message unsent but leaves the next Send working', async () => {
  vi.useFakeTimers()
  const f = claudeFixture()
  const a = await f.runtime.start(initial)
  f.change({ revision: 'two', servers: [changed] })
  let outcome: unknown = 'pending'
  void a.send('stopped words').then(
    () => (outcome = 'sent'),
    (error: unknown) => (outcome = error),
  )
  await vi.advanceTimersByTimeAsync(0)
  await a.interrupt()
  await vi.advanceTimersByTimeAsync(0)
  try {
    // Stop keeps its meaning: the stopped message is not delivered.
    expect(outcome).toBeInstanceOf(Error)
    expect(f.send).not.toHaveBeenCalled()
    // But the plugin's unsettled refresh does not end the conversation.
    expect(f.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(PLUGIN_ATTACHMENT_WAIT_MS + 1)
    await a.send('next words')
    expect(f.send).toHaveBeenCalledTimes(1)
    expect(f.send).toHaveBeenCalledWith('next words')
  } finally {
    f.settle().resolve()
    await a.close()
  }
})

it('a hung route read delays only the first send; the next does not wait and adopts it later', async () => {
  vi.useFakeTimers()
  const f = claudeFixture()
  const a = await f.runtime.start(initial)
  let answer!: (value: ManagedPluginAttachment) => void
  // This case is about the read; the refresh applies at once.
  f.refreshManagedPlugins.mockReset()
  f.refreshManagedPlugins.mockImplementation(async () => {})
  const reads = vi.mocked(f.source.read)
  reads.mockImplementationOnce(
    () =>
      new Promise<ManagedPluginAttachment>((resolve) => {
        answer = resolve
      }),
  )
  try {
    const first = a.send('first words')
    await vi.advanceTimersByTimeAsync(PLUGIN_ATTACHMENT_WAIT_MS + 1)
    await first
    expect(f.send).toHaveBeenCalledTimes(1)
    // The read is still hung: the second message goes out with no wait at all.
    let second = false
    void a.send('second words').then(() => (second = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(second).toBe(true)
    expect(f.send).toHaveBeenCalledTimes(2)
    expect(reads).toHaveBeenCalledTimes(2)
    // Once it answers, the next send adopts it instead of reading again.
    answer({ revision: 'two', servers: [changed] })
    await vi.advanceTimersByTimeAsync(0)
    await a.send('third words')
    expect(reads).toHaveBeenCalledTimes(2)
    expect(f.refreshManagedPlugins).toHaveBeenCalledWith([changed])
    expect(f.send).toHaveBeenCalledTimes(3)
  } finally {
    await a.close()
  }
})
