import { afterEach, expect, it, vi } from 'vitest'
import {
  withManagedPluginAttachments,
  PLUGIN_ATTACHMENT_WAIT_MS,
  MANAGED_PLUGIN_REOPEN_WITHIN_MS,
  type ManagedPluginAttachment,
  type ManagedPluginAttachmentSource,
} from '../src/managed-plugin-session'
import type { AgentRuntime, SessionHandle } from '../src/runtime'
import { AsyncQueue } from '../src/internal/async-queue'
import type { RuntimeEvent } from '../src/events'
import { TurnInProgress } from '../src/turn-in-progress'
import { ManagedPluginOwnership } from '../src/managed-plugin-ownership'

const route = { name: 'plugin-fern', url: 'http://127.0.0.1:8123/mcp', capability: 'a'.repeat(64) }
const initial = {
  cwd: '/fictional/willow',
  providerHome: '/fictional/home',
  externalMcp: {
    servers: [{ name: 'person-server', url: 'http://127.0.0.1:9234/mcp' }],
    reservedToolNames: [],
  },
  model: 'fictional-model',
}
afterEach(() => vi.useRealTimers())
function fixture(refresh = false, exitFactory?: (index: number) => Promise<void> | undefined) {
  let next: ManagedPluginAttachment = { revision: 'one', servers: [route] }
  const source: ManagedPluginAttachmentSource = {
    read: vi.fn(async () => next),
    close: vi.fn(async () => {}),
  }
  const opened: {
    options: unknown
    handle: SessionHandle
    send: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    queue: AsyncQueue<RuntimeEvent>
  }[] = []
  const make = (options: unknown) => {
    const queue = new AsyncQueue<RuntimeEvent>()
    const exit = exitFactory?.(opened.length)
    let ended = false
    const send = vi.fn(async () => {
      if (ended) throw new Error('fictional session ended')
    })
    const close = vi.fn(async () => {
      ended = true
      queue.close()
    })
    const handle = {
      ...(exitFactory ? { awaitProcessExit: () => exit } : {}),
      ref: { provider: 'codex', sessionId: 'fictional-thread', cwd: initial.cwd },
      status: () => (ended ? 'ended' : 'idle'),
      events: () => queue,
      send,
      close,
      interrupt: vi.fn(async () => {}),
      setPlanMode: vi.fn(async () => {}),
      setModel: vi.fn(async () => {}),
      setApprovalMode: vi.fn(async () => {}),
      setReasoningEffort: vi.fn(async () => {}),
      setWorkFolders: vi.fn(),
      ...(refresh ? { refreshManagedPlugins: vi.fn(async () => {}) } : {}),
    } as unknown as SessionHandle
    opened.push({ options, handle, send, close, queue })
    return Promise.resolve(handle)
  }
  const raw = {
    provider: 'codex',
    start: vi.fn(make),
    resume: vi.fn(async (_ref, options) => {
      const handle = await make(options)
      options.onSessionCreated?.(handle)
      return handle
    }),
  } as unknown as AgentRuntime
  return {
    source,
    opened,
    raw,
    runtime: withManagedPluginAttachments(raw, source),
    change(value: ManagedPluginAttachment) {
      next = value
    },
  }
}
it('supplies live scoped routes on fresh starts and resumes without changing personal servers', async () => {
  const f = fixture()
  const a = await f.runtime.start(initial)
  expect(f.opened[0]!.options).toMatchObject({
    managedPluginMcp: [route],
    externalMcp: initial.externalMcp,
  })
  await a.close()
  const g = fixture()
  const b = await g.runtime.resume(a.ref!, initial)
  expect(g.raw.resume).toHaveBeenCalledWith(
    a.ref,
    expect.objectContaining({ managedPluginMcp: [route], model: initial.model }),
  )
  await b.close()
})
it('refreshes supported providers only between turns and preserves the live handle', async () => {
  const f = fixture(true),
    a = await f.runtime.start(initial)
  f.change({ revision: 'two', servers: [{ ...route, capability: 'b'.repeat(64) }] })
  expect(f.opened[0]!.handle.refreshManagedPlugins).not.toHaveBeenCalled()
  await a.send('fictional words')
  expect(f.opened[0]!.handle.refreshManagedPlugins).toHaveBeenCalledWith([
    { ...route, capability: 'b'.repeat(64) },
  ])
  expect(f.raw.resume).not.toHaveBeenCalled()
  expect(f.opened[0]!.send).toHaveBeenCalledTimes(1)
  await a.close()
})
it.each(['resolve', 'reject'] as const)(
  'refuses a timed-out refresh before it later settles by %s',
  async (outcome) => {
    vi.useFakeTimers()
    const f = fixture(true)
    const a = await f.runtime.start(initial)
    let finish!: () => void
    vi.mocked(f.opened[0]!.handle.refreshManagedPlugins!).mockImplementation(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = () =>
            outcome === 'resolve' ? resolve() : reject(new Error('fictional refresh failure'))
        }),
    )
    f.change({ revision: 'two', servers: [] })
    const sending = a.send('fictional words')
    let refused: unknown
    void sending.catch((error) => {
      refused = error
    })
    await vi.advanceTimersByTimeAsync(PLUGIN_ATTACHMENT_WAIT_MS + 1)
    try {
      expect(refused).toBeInstanceOf(Error)
      expect((refused as Error).message).toContain("Your message wasn't sent")
      expect(f.opened[0]!.send).not.toHaveBeenCalled()
      expect(f.opened[0]!.close).toHaveBeenCalledOnce()
      await expect(a.send('another turn')).rejects.toThrow("wasn't sent")
    } finally {
      finish()
      await sending.catch(() => {})
      await a.close()
    }
    expect(f.opened[0]!.send).not.toHaveBeenCalled()
  },
)
it.each(['interrupt', 'close'] as const)(
  'never sends after %s during a slow supported refresh',
  async (stop) => {
    vi.useFakeTimers()
    const f = fixture(true)
    const a = await f.runtime.start(initial)
    let finish!: () => void
    vi.mocked(f.opened[0]!.handle.refreshManagedPlugins!).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    f.change({ revision: 'two', servers: [] })
    const sending = a.send('fictional words')
    let refused: unknown
    void sending.catch((error) => {
      refused = error
    })
    await vi.advanceTimersByTimeAsync(0)
    const stopping = a[stop]()
    await vi.advanceTimersByTimeAsync(0)
    try {
      expect(refused).toBeInstanceOf(Error)
      expect((refused as Error).message).toContain("wasn't sent")
      expect(f.opened[0]!.send).not.toHaveBeenCalled()
    } finally {
      finish()
      await sending.catch(() => {})
      await stopping
      await a.close()
    }
  },
)
it('a refresh that never settles refuses within the bound and retires its handle', async () => {
  vi.useFakeTimers()
  const f = fixture(true)
  const a = await f.runtime.start(initial)
  vi.mocked(f.opened[0]!.handle.refreshManagedPlugins!).mockImplementation(
    () => new Promise(() => {}),
  )
  f.change({ revision: 'two', servers: [] })
  let refused: unknown
  void a.send('fictional words').catch((error) => {
    refused = error
  })
  await vi.advanceTimersByTimeAsync(PLUGIN_ATTACHMENT_WAIT_MS + 1)
  expect(refused).toBeInstanceOf(Error)
  expect((refused as Error).message).toContain("Your message wasn't sent")
  expect(f.opened[0]!.send).not.toHaveBeenCalled()
  expect(f.opened[0]!.close).toHaveBeenCalledOnce()
  expect(a.status()).not.toBe('working')
  await a.close()
})
it('reopens an unsupported managed session at the next turn boundary and carries current settings', async () => {
  const f = fixture(),
    a = await f.runtime.start(initial)
  a.setModel('fictional-next')
  a.setWorkFolders(['/fictional/granted'])
  f.change({ revision: 'two', servers: [] })
  expect(f.raw.resume).not.toHaveBeenCalled()
  await a.send('fictional words')
  expect(f.opened[0]!.close).toHaveBeenCalledOnce()
  expect(f.opened[1]!.options).toMatchObject({
    model: 'fictional-next',
    workFolders: ['/fictional/granted'],
    externalMcp: initial.externalMcp,
    managedPluginMcp: [],
  })
  expect(f.opened[0]!.send).not.toHaveBeenCalled()
  expect(f.opened[1]!.send).toHaveBeenCalledOnce()
  await a.close()
})
it('a dead attachment source cannot stop an ordinary start or turn', async () => {
  const f = fixture()
  f.source.read = vi.fn(async () => {
    throw new Error('fictional transport error')
  })
  const a = await f.runtime.start(initial)
  await a.send('fictional words')
  expect(f.opened[0]!.options).toMatchObject({ managedPluginMcp: [] })
  expect(f.opened[0]!.send).toHaveBeenCalledOnce()
  await a.close()
})
it('bounds held discovery before ordinary start', async () => {
  vi.useFakeTimers()
  const f = fixture()
  f.source.read = vi.fn(() => new Promise<ManagedPluginAttachment>(() => {}))
  const opening = f.runtime.start(initial)
  await vi.advanceTimersByTimeAsync(PLUGIN_ATTACHMENT_WAIT_MS)
  const a = await opening
  expect(f.opened).toHaveLength(1)
  await a.close()
})
it('a cancelled refresh never sends a late turn and never reopens in the middle of it', async () => {
  const f = fixture(),
    a = await f.runtime.start(initial)
  let release!: (v: ManagedPluginAttachment) => void
  f.source.read = vi.fn(
    () =>
      new Promise<ManagedPluginAttachment>((resolve) => {
        release = resolve
      }),
  )
  const sending = a.send('fictional words')
  const refused = expect(sending).rejects.toThrow('stopped')
  await a.interrupt()
  release({ revision: 'late', servers: [] })
  await refused
  expect(f.opened[0]!.send).not.toHaveBeenCalled()
  expect(f.raw.resume).not.toHaveBeenCalled()
  await a.close()
})
it('concurrent sends cannot slip past a held attachment refresh', async () => {
  const f = fixture(),
    a = await f.runtime.start(initial)
  let release!: (v: ManagedPluginAttachment) => void
  f.source.read = vi.fn(
    () =>
      new Promise<ManagedPluginAttachment>((resolve) => {
        release = resolve
      }),
  )
  const first = a.send('first')
  await expect(a.send('second')).rejects.toThrow('turn is in progress')
  release({ revision: 'one', servers: [route] })
  await first
  expect(f.opened[0]!.send).toHaveBeenCalledTimes(1)
  await a.close()
})
it('malformed plugin routes are omitted while the person server and ordinary turn survive', async () => {
  const f = fixture()
  f.change({ revision: 'bad', servers: [{ ...route, name: 'person-server' }] })
  const a = await f.runtime.start(initial)
  expect(f.opened[0]!.options).toMatchObject({
    externalMcp: initial.externalMcp,
    managedPluginMcp: [],
  })
  await a.send('fictional words')
  await a.close()
})

it('a failed managed reopen keeps the old live inventory and retries at the next turn boundary', async () => {
  const f = fixture(),
    a = await f.runtime.start(initial)
  const saved = a.ref
  const before = f.opened[0]!
  vi.mocked(f.raw.resume).mockRejectedValueOnce(new Error('fictional plugin unavailable'))
  f.change({ revision: 'two', servers: [{ ...route, capability: 'b'.repeat(64) }] })
  await a.send('first fictional turn')
  expect(before.close).not.toHaveBeenCalled()
  expect(before.send).toHaveBeenCalledWith('first fictional turn')
  expect(before.options).toMatchObject({ managedPluginMcp: [route] })
  expect(f.raw.resume).toHaveBeenCalledTimes(1)
  expect(a.ref).toEqual(saved)
  await a.send('next fictional turn')
  expect(f.raw.resume).toHaveBeenCalledTimes(2)
  for (const [ref] of vi.mocked(f.raw.resume).mock.calls) expect(ref).toEqual(saved)
  expect(f.opened[1]!.send).toHaveBeenCalledWith('next fictional turn')
  expect(before.close).toHaveBeenCalledOnce()
  await a.close()
})
it('held discovery resolved inside the bound is offered on the first provider start', async () => {
  const f = fixture()
  let release!: (value: ManagedPluginAttachment) => void
  f.source.read = vi.fn(
    () =>
      new Promise<ManagedPluginAttachment>((resolve) => {
        release = resolve
      }),
  )
  const opening = f.runtime.start(initial)
  expect(f.opened).toHaveLength(0)
  release({ revision: 'ready', servers: [route] })
  const a = await opening
  expect(f.opened[0]!.options).toMatchObject({ managedPluginMcp: [route] })
  await a.close()
})
it('close cancels and joins an in-flight managed reopen before releasing the source', async () => {
  const f = fixture(),
    a = await f.runtime.start(initial)
  let started!: () => void
  const starting = new Promise<void>((resolve) => {
    started = resolve
  })
  let settled = false
  vi.mocked(f.raw.resume).mockImplementationOnce(async (_ref, options) => {
    started()
    await new Promise<void>((_resolve, reject) =>
      options.signal!.addEventListener(
        'abort',
        () => {
          settled = true
          reject(new Error('fictional cancelled'))
        },
        { once: true },
      ),
    )
    throw new Error('unreachable')
  })
  f.change({ revision: 'new', servers: [] })
  const sending = a.send('fictional words')
  const refusal = expect(sending).rejects.toThrow()
  await starting
  await a.close()
  await refusal
  expect(settled).toBe(true)
  expect(f.source.close).toHaveBeenCalledOnce()
  expect(f.opened[0]!.send).not.toHaveBeenCalled()
})

it('uses the provider resume budget, joins a cancelled attempt, then keeps the old inventory', async () => {
  vi.useFakeTimers()
  const f = fixture(),
    a = await f.runtime.start(initial)
  let cancelled = false
  vi.mocked(f.raw.resume).mockImplementationOnce(async (_ref, options) => {
    await new Promise<void>((_resolve, reject) =>
      options.signal!.addEventListener(
        'abort',
        () => {
          cancelled = true
          reject(new Error('fictional resume timed out'))
        },
        { once: true },
      ),
    )
    throw new Error('unreachable')
  })
  f.change({ revision: 'new', servers: [] })
  const sending = a.send('fictional words')
  await vi.advanceTimersByTimeAsync(MANAGED_PLUGIN_REOPEN_WITHIN_MS - 1)
  expect(cancelled).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await sending
  expect(cancelled).toBe(true)
  expect(f.raw.resume).toHaveBeenCalledTimes(1)
  expect(f.opened).toHaveLength(1)
  expect(f.opened[0]!.close).not.toHaveBeenCalled()
  expect(f.opened[0]!.options).toMatchObject({ managedPluginMcp: [route] })
  expect(f.opened[0]!.send).toHaveBeenCalledOnce()
  await a.close()
})

it('unchanged actual inventory never reopens, including revision-only or ordering changes', async () => {
  const f = fixture()
  const other = { ...route, name: 'plugin-moss' }
  f.change({ revision: 'one', servers: [route, other] })
  const a = await f.runtime.start(initial)
  await a.send('first fictional turn')
  f.change({ revision: 'metadata-only', servers: [other, route] })
  await a.send('next fictional turn')
  expect(f.raw.resume).not.toHaveBeenCalled()
  expect(f.opened[0]!.send).toHaveBeenCalledTimes(2)
  expect(f.opened[0]!.close).not.toHaveBeenCalled()
  await a.close()
})
it('a changed inventory prepares the same thread before closing its previous handle', async () => {
  const f = fixture(),
    a = await f.runtime.start(initial)
  const saved = a.ref
  const opening = vi.mocked(f.raw.resume).getMockImplementation()!
  let preparedWhileOldOpen = false
  let resumedRef: unknown
  vi.mocked(f.raw.resume).mockImplementationOnce(async (ref, options) => {
    resumedRef = ref
    preparedWhileOldOpen = vi.mocked(f.opened[0]!.close).mock.calls.length === 0
    return opening(ref, options)
  })
  f.change({ revision: 'changed', servers: [] })
  await a.send('fictional continuation')
  expect(resumedRef).toEqual(saved)
  expect(preparedWhileOldOpen).toBe(true)
  expect(a.ref).toEqual(saved)
  expect(f.opened[0]!.close).toHaveBeenCalledOnce()
  expect(f.opened[1]!.send).toHaveBeenCalledWith('fictional continuation')
  await a.close()
})
it('an unsuccessful replacement emits one fixed unavailable notice and leaves every turn runnable', async () => {
  const f = fixture(),
    a = await f.runtime.start(initial)
  vi.mocked(f.raw.resume).mockRejectedValue(new Error('fictional unavailable'))
  f.change({ revision: 'changed', servers: [] })
  await a.send('first fictional turn')
  await a.send('next fictional turn')
  expect(f.opened[0]!.send).toHaveBeenCalledTimes(2)
  expect(f.opened[0]!.close).not.toHaveBeenCalled()
  expect(f.raw.resume).toHaveBeenCalledTimes(2)
  await a.close()
  const events = []
  for await (const event of a.events()) events.push(event)
  expect(events.filter((one) => JSON.stringify(one).includes('plugin/attachment'))).toHaveLength(1)
})

it('Stop joins and closes a replacement that returns after cancellation without sending a turn', async () => {
  const f = fixture(),
    a = await f.runtime.start(initial)
  const opening = vi.mocked(f.raw.resume).getMockImplementation()!
  let release!: () => void
  let began!: () => void
  const ready = new Promise<void>((resolve) => {
    began = resolve
  })
  vi.mocked(f.raw.resume).mockImplementationOnce(async (ref, options) => {
    began()
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return opening(ref, options)
  })
  f.change({ revision: 'changed', servers: [] })
  const sending = a.send('fictional continuation')
  const refusal = expect(sending).rejects.toThrow('stopped')
  await ready
  let closed = false
  const closing = a.close().then(() => {
    closed = true
  })
  await Promise.resolve()
  expect(closed).toBe(false)
  release()
  await closing
  await refusal
  expect(f.opened).toHaveLength(2)
  expect(f.opened[0]!.send).not.toHaveBeenCalled()
  expect(f.opened[1]!.send).not.toHaveBeenCalled()
  expect(f.opened[1]!.close).toHaveBeenCalledOnce()
  expect(f.source.close).toHaveBeenCalledOnce()
})

it('Stop during held resume leaves the old handle usable for the next ordinary send', async () => {
  const f = fixture(),
    a = await f.runtime.start(initial)
  const saved = a.ref
  let began!: () => void
  const preparing = new Promise<void>((resolve) => {
    began = resolve
  })
  vi.mocked(f.raw.resume).mockImplementationOnce(async (_ref, options) => {
    began()
    await new Promise<void>((_resolve, reject) =>
      options.signal!.addEventListener('abort', () => reject(new Error('fictional cancelled')), {
        once: true,
      }),
    )
    throw new Error('unreachable')
  })
  f.change({ revision: 'changed', servers: [] })
  const sending = a.send('fictional stopped message')
  const refusal = expect(sending).rejects.toThrow('fictional cancelled')
  await preparing
  await a.interrupt()
  await refusal
  expect(f.opened[0]!.close).not.toHaveBeenCalled()
  expect(f.opened[0]!.send).not.toHaveBeenCalled()
  expect(a.status()).toBe('idle')
  await a.send('fictional next message')
  expect(a.ref).toEqual(saved)
  expect(f.opened[1]!.send).toHaveBeenCalledWith('fictional next message')
  expect(f.opened[1]!.send).toHaveBeenCalledOnce()
  await a.close()
})

it('a released planning phase resumes with the canonical left pair', async () => {
  const f = fixture(),
    a = await f.runtime.start({ ...initial, planMode: true })
  await a.setPlanMode(false)
  f.change({ revision: 'changed', servers: [] })
  await a.send('fictional approved work')
  expect(f.opened[1]!.options).toMatchObject({ planMode: true, planModeEnded: true })
  await a.close()
})
it('planning again clears a previously ended phase before the same-thread reopen', async () => {
  const f = fixture(),
    a = await f.runtime.start({ ...initial, planMode: true, planModeEnded: true })
  await a.setPlanMode(true)
  f.change({ revision: 'changed', servers: [] })
  await a.send('fictional planning request')
  expect(f.opened[1]!.options).toMatchObject({ planMode: true, planModeEnded: false })
  await a.close()
})
it('a never-planned phase stays never when the provider rejects a planning change', async () => {
  const f = fixture(),
    a = await f.runtime.start(initial)
  vi.mocked(f.opened[0]!.handle.setPlanMode).mockRejectedValueOnce(new Error('fictional refusal'))
  await expect(a.setPlanMode(true)).rejects.toThrow('fictional refusal')
  f.change({ revision: 'changed', servers: [] })
  await a.send('fictional ordinary work')
  expect(f.opened[1]!.options).not.toHaveProperty('planMode')
  expect(f.opened[1]!.options).not.toHaveProperty('planModeEnded')
  await a.close()
})

it('an unproved retired exit blocks only another reopen and stays in the owner aggregate', async () => {
  let release!: () => void
  const oldExit = new Promise<void>((resolve) => {
    release = resolve
  })
  const f = fixture(false, (index) => (index === 0 ? oldExit : Promise.resolve()))
  const a = await f.runtime.start(initial)
  const owned = a.awaitProcessExit!()!
  expect(a.awaitProcessExit!()).toBe(owned)
  let proved = false
  void owned.then(() => {
    proved = true
  })
  f.change({ revision: 'two', servers: [] })
  await a.send('fictional second inventory')
  expect(f.opened[0]!.close).toHaveBeenCalledOnce()
  f.change({ revision: 'three', servers: [route] })
  await a.send('fictional turn while old exit is unknown')
  expect(f.raw.resume).toHaveBeenCalledTimes(1)
  expect(f.opened[1]!.send).toHaveBeenCalledTimes(2)
  expect(a.awaitProcessExit!()).toBe(owned)
  await a.close()
  await Promise.resolve()
  expect(proved).toBe(false)
  release()
  await owned
  expect(proved).toBe(true)
})
it('proof of a retired exit allows the next changed-inventory reopen', async () => {
  let release!: () => void
  const f = fixture(false, (index) =>
    index === 0
      ? new Promise<void>((resolve) => {
          release = resolve
        })
      : Promise.resolve(),
  )
  const a = await f.runtime.start(initial)
  f.change({ revision: 'two', servers: [] })
  await a.send('fictional second inventory')
  release()
  await new Promise<void>((resolve) => setImmediate(resolve))
  f.change({ revision: 'three', servers: [route] })
  await a.send('fictional third inventory')
  expect(f.raw.resume).toHaveBeenCalledTimes(2)
  await a.close()
  await a.awaitProcessExit!()
})
it('a cancelled allocated resume keeps its exit witness even though no handle was returned', async () => {
  let release!: () => void
  const f = fixture(false, (index) =>
    index === 1
      ? new Promise<void>((resolve) => {
          release = resolve
        })
      : Promise.resolve(),
  )
  const a = await f.runtime.start(initial)
  const make = vi.mocked(f.raw.resume).getMockImplementation()!
  vi.mocked(f.raw.resume).mockImplementationOnce(async (ref, options) => {
    await make(ref, options)
    throw new Error('fictional handshake failure')
  })
  f.change({ revision: 'two', servers: [] })
  await a.send('fictional ordinary turn after failed handshake')
  expect(f.opened[1]!.close).toHaveBeenCalledOnce()
  expect(f.opened[0]!.close).not.toHaveBeenCalled()
  await a.send('fictional next ordinary turn')
  expect(f.raw.resume).toHaveBeenCalledTimes(1)
  expect(f.opened[0]!.send).toHaveBeenCalledTimes(2)
  const owned = a.awaitProcessExit!()!
  let proved = false
  void owned.then(() => {
    proved = true
  })
  await a.close()
  await Promise.resolve()
  expect(proved).toBe(false)
  release()
  await owned
})
it('Stop while old cleanup is held keeps the prepared same-thread handle usable', async () => {
  const f = fixture(false, () => Promise.resolve()),
    a = await f.runtime.start(initial)
  let release!: () => void
  let began!: () => void
  const closing = new Promise<void>((resolve) => {
    began = resolve
  })
  const oldClose = vi.mocked(f.opened[0]!.close).getMockImplementation() as () => Promise<void>
  vi.mocked(f.opened[0]!.close).mockImplementationOnce(async () => {
    began()
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return oldClose()
  })
  f.change({ revision: 'two', servers: [] })
  const sending = a.send('fictional stopped message')
  const refused = expect(sending).rejects.toThrow('stopped')
  await closing
  await a.interrupt()
  release()
  await refused
  expect(f.opened[1]!.send).not.toHaveBeenCalled()
  expect(a.status()).toBe('idle')
  await a.send('fictional ordinary next message')
  expect(f.opened[1]!.send).toHaveBeenCalledWith('fictional ordinary next message')
  await a.close()
  await a.awaitProcessExit!()
})

it('an old handle that becomes busy during preparation is not closed or sent another turn', async () => {
  const f = fixture(false, () => Promise.resolve()),
    a = await f.runtime.start(initial)
  const make = vi.mocked(f.raw.resume).getMockImplementation()!
  vi.mocked(f.raw.resume).mockImplementationOnce(async (ref, options) => {
    const candidate = await make(ref, options)
    f.opened[0]!.handle.status = () => 'working'
    return candidate
  })
  f.change({ revision: 'two', servers: [] })
  const outcome = await a.send('fictional next message').then(
    () => false,
    (error) => error instanceof TurnInProgress,
  )
  expect(outcome).toBe(true)
  expect(f.opened[0]!.close).not.toHaveBeenCalled()
  expect(f.opened[1]!.close).toHaveBeenCalledOnce()
  expect(f.opened[0]!.send).not.toHaveBeenCalled()
  expect(f.opened[1]!.send).not.toHaveBeenCalled()
  await a.close()
})

function holdResume(f: ReturnType<typeof fixture>) {
  const make = vi.mocked(f.raw.resume).getMockImplementation()!
  let release!: () => void
  let began!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const ready = new Promise<void>((resolve) => {
    began = resolve
  })
  vi.mocked(f.raw.resume).mockImplementationOnce(async (ref, options) => {
    began()
    await held
    return make(ref, options)
  })
  return { ready, release }
}

it('tightening approval during held preparation keeps the next tool call asking', async () => {
  const f = fixture(false, () => Promise.resolve())
  const a = await f.runtime.start({ ...initial, approvalMode: 'auto' })
  const asked: string[] = []
  let mode = 'auto'
  vi.mocked(f.opened[0]!.handle.setApprovalMode).mockImplementation(async (next) => {
    mode = next
  })
  f.opened[0]!.send.mockImplementation(async () => {
    if (mode === 'ask') asked.push('fictional-permission')
  })
  const hold = holdResume(f)
  f.change({ revision: 'two', servers: [] })
  const sending = a.send('fictional tool call')
  await hold.ready
  await a.setApprovalMode('ask')
  hold.release()
  await sending
  expect(asked).toEqual(['fictional-permission'])
  expect(f.opened[1]!.send).not.toHaveBeenCalled()
  expect(f.opened[1]!.close).toHaveBeenCalledOnce()
  expect(f.opened[0]!.close).not.toHaveBeenCalled()
  await a.send('fictional next turn')
  expect(f.opened[2]!.options).toMatchObject({ approvalMode: 'ask' })
  await a.close()
})

it.each([
  [
    'model',
    async (a: SessionHandle) => {
      await a.setModel('fictional-next')
    },
    { model: 'fictional-next' },
  ],
  [
    'effort',
    async (a: SessionHandle) => {
      await a.setReasoningEffort('high')
    },
    { reasoningEffort: 'high' },
  ],
  [
    'plan',
    async (a: SessionHandle) => {
      await a.setPlanMode(false)
    },
    { planMode: true, planModeEnded: true },
  ],
  [
    'folders',
    async (a: SessionHandle) => {
      a.setWorkFolders(['/fictional/narrow'])
    },
    { workFolders: ['/fictional/narrow'] },
  ],
] as const)(
  'a successful %s change during held preparation discards the stale candidate',
  async (_name, change, expected) => {
    const f = fixture(false, () => Promise.resolve())
    const a = await f.runtime.start({ ...initial, planMode: true })
    const hold = holdResume(f)
    f.change({ revision: 'two', servers: [] })
    const sending = a.send('fictional continuation')
    await hold.ready
    await change(a)
    hold.release()
    await sending
    expect(f.opened[0]!.send).toHaveBeenCalledOnce()
    expect(f.opened[0]!.close).not.toHaveBeenCalled()
    expect(f.opened[1]!.send).not.toHaveBeenCalled()
    expect(f.opened[1]!.close).toHaveBeenCalledOnce()
    await a.send('fictional next turn')
    expect(f.opened[2]!.options).toMatchObject(expected)
    await a.close()
  },
)

it('an unresolved setter at preparation completion prevents stale promotion without blocking the turn', async () => {
  const f = fixture(false, () => Promise.resolve())
  const a = await f.runtime.start(initial)
  const hold = holdResume(f)
  let applied!: () => void
  vi.mocked(f.opened[0]!.handle.setApprovalMode).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        applied = resolve
      }),
  )
  f.change({ revision: 'two', servers: [] })
  const sending = a.send('fictional continuation')
  await hold.ready
  const setting = a.setApprovalMode('ask')
  hold.release()
  await sending
  expect(f.opened[0]!.send).toHaveBeenCalledOnce()
  expect(f.opened[1]!.close).toHaveBeenCalledOnce()
  expect(f.opened[1]!.send).not.toHaveBeenCalled()
  applied()
  await setting
  await a.send('fictional next turn')
  expect(f.opened[2]!.options).toMatchObject({ approvalMode: 'ask' })
  await a.close()
})

it('a setter already in flight defers only the reopen and never delays ordinary turns', async () => {
  const f = fixture()
  const a = await f.runtime.start(initial)
  let applied!: () => void
  vi.mocked(f.opened[0]!.handle.setApprovalMode).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        applied = resolve
      }),
  )
  const setting = a.setApprovalMode('ask')
  f.change({ revision: 'two', servers: [] })
  await a.send('fictional continuation')
  expect(f.raw.resume).not.toHaveBeenCalled()
  expect(f.opened[0]!.send).toHaveBeenCalledOnce()
  applied()
  await setting
  await a.send('fictional next turn')
  expect(f.opened[1]!.options).toMatchObject({ approvalMode: 'ask' })
  await a.close()
})

it('a rejected setting never poisons the next managed resume settings', async () => {
  const f = fixture()
  const a = await f.runtime.start(initial)
  vi.mocked(f.opened[0]!.handle.setModel).mockRejectedValueOnce(new Error('fictional refusal'))
  await expect(a.setModel('fictional-refused')).rejects.toThrow('fictional refusal')
  f.change({ revision: 'two', servers: [] })
  await a.send('fictional continuation')
  expect(f.opened[1]!.options).toMatchObject({ model: initial.model })
  await a.close()
})

it('a setter started during cleanup admission prevents preparation with an unsettled cache', async () => {
  const f = fixture(false, () => Promise.resolve())
  const a = await f.runtime.start({ ...initial, approvalMode: 'auto' })
  let release!: (value: boolean) => void
  let began!: () => void
  const ready = new Promise<void>((resolve) => {
    began = resolve
  })
  const admission = vi
    .spyOn(ManagedPluginOwnership.prototype, 'mayReopen')
    .mockImplementationOnce(() => {
      began()
      return new Promise<boolean>((resolve) => {
        release = resolve
      })
    })
  let applied!: () => void
  vi.mocked(f.opened[0]!.handle.setApprovalMode).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        applied = resolve
      }),
  )
  const make = vi.mocked(f.raw.resume).getMockImplementation()!
  let setting!: Promise<void>
  vi.mocked(f.raw.resume).mockImplementationOnce(async (ref, options) => {
    applied()
    await setting
    return make(ref, options)
  })
  try {
    f.change({ revision: 'two', servers: [] })
    const sending = a.send('fictional continuation')
    await ready
    setting = a.setApprovalMode('ask')
    release(true)
    await sending
    expect(f.raw.resume).not.toHaveBeenCalled()
    expect(f.opened[0]!.send).toHaveBeenCalledOnce()
    applied()
    await setting
    await a.send('fictional next turn')
    expect(f.opened[1]!.options).toMatchObject({ approvalMode: 'ask' })
    await a.close()
  } finally {
    admission.mockRestore()
  }
})
