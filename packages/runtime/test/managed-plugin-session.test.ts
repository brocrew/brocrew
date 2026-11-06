import { afterEach, expect, it, vi } from 'vitest'
import {
  withManagedPluginAttachments,
  PLUGIN_ATTACHMENT_WAIT_MS,
  MANAGED_PLUGIN_REOPEN_WITHIN_MS,
  StoppedBeforeSend,
  type ManagedPluginAttachment,
  type ManagedPluginAttachmentSource,
} from '../src/managed-plugin-session'
import type { AgentRuntime, SessionHandle } from '../src/runtime'
import { ResumeError } from '../src/runtime'
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

it('attaches a plugin served before the first input when the empty Codex thread cannot be resumed', async () => {
  // Unit actor only. Actual no-account app-server controls and the native smoke qualify the wire.
  const f = fixture(false, () => Promise.resolve())
  const fern = { ...route, pluginId: 'fern' }
  const chrome = { ...route, pluginId: 'chrome', name: 'plugin-chrome', capability: 'b'.repeat(64) }
  f.change({
    revision: 'starting',
    servers: [fern],
    plugins: { pending: ['chrome'], none: [], unknown: false },
  })
  const handle = await f.runtime.start(initial)
  vi.mocked(f.raw.resume).mockRejectedValue(
    new ResumeError(handle.ref!, 'fictional no rollout found', { noSuchSession: true }),
  )
  f.change({
    revision: 'ready',
    servers: [fern, chrome],
    plugins: { pending: [], none: [], unknown: false },
  })
  try {
    await handle.send('one original request')
    expect(f.opened[0]!.send).not.toHaveBeenCalled()
    const served = f.opened.filter((one) => one.send.mock.calls.length)
    expect(served).toHaveLength(1)
    expect(served[0]!.options).toMatchObject({ managedPluginMcp: [fern, chrome] })
    expect(served[0]!.send).toHaveBeenCalledExactlyOnceWith('one original request')
  } finally {
    await handle.close()
    await handle.awaitProcessExit?.()
  }
})

it.each(['used', 'resumed', 'unknown', 'other-ref'] as const)(
  'does not replace conversation history for a %s resume refusal',
  async (kind) => {
    const f = fixture(false, () => Promise.resolve())
    const saved = {
      provider: 'codex' as const,
      sessionId: 'fictional-thread',
      cwd: initial.cwd,
      rotation: 0,
    }
    const handle =
      kind === 'resumed' ? await f.runtime.resume(saved, initial) : await f.runtime.start(initial)
    if (kind === 'used') await handle.send('earlier input')
    const refusal =
      kind === 'unknown'
        ? new Error('fictional unknown launch failure')
        : new ResumeError(
            kind === 'other-ref' ? { ...saved, sessionId: 'another-thread' } : saved,
            'fictional missing rollout',
            { noSuchSession: true },
          )
    vi.mocked(f.raw.resume).mockRejectedValue(refusal)
    f.change({ revision: 'next', servers: [{ ...route, capability: 'b'.repeat(64) }] })
    try {
      await handle.send('one new input')
      expect(f.raw.start).toHaveBeenCalledTimes(kind === 'resumed' ? 0 : 1)
      expect(f.opened).toHaveLength(1)
      expect(f.opened[0]!.send).toHaveBeenLastCalledWith('one new input')
    } finally {
      await handle.close()
      await handle.awaitProcessExit?.()
    }
  },
)

it('does not replace provider-originated history before any caller input', async () => {
  const f = fixture(false, () => Promise.resolve())
  const handle = await f.runtime.start(initial)
  f.opened[0]!.queue.push({ type: 'provider_turn' })
  await Promise.resolve()
  vi.mocked(f.raw.resume).mockRejectedValue(
    new ResumeError(handle.ref!, 'missing', { noSuchSession: true }),
  )
  f.change({ revision: 'next', servers: [] })
  await handle.send('one new input')
  expect(f.raw.start).toHaveBeenCalledTimes(1)
  await handle.close()
})

it.each(['carryOn', 'compact'] as const)(
  'never replaces history after %s work or uncertain acceptance',
  async (method) => {
    const f = fixture(false, () => Promise.resolve())
    const handle = await f.runtime.start(initial)
    Object.defineProperty(f.opened[0]!.handle, method, {
      value: () => {
        throw new Error('unknown work acceptance')
      },
    })
    expect(() => handle[method]!()).toThrow('unknown work acceptance')
    vi.mocked(f.raw.resume).mockRejectedValue(
      new ResumeError(handle.ref!, 'missing', { noSuchSession: true }),
    )
    f.change({ revision: 'next', servers: [] })
    await handle.send('later input')
    expect(f.raw.start).toHaveBeenCalledTimes(1)
    await handle.close()
  },
)

it('never forgets a fast-path send whose synchronous failure leaves acceptance unknown', async () => {
  const f = fixture(false, () => Promise.resolve())
  const handle = await f.runtime.start(initial)
  vi.spyOn(f.opened[0]!.handle, 'status').mockReturnValueOnce('working')
  f.opened[0]!.send.mockImplementationOnce(() => {
    throw new Error('unknown acceptance')
  })
  expect(() => handle.send('possibly accepted')).toThrow('unknown acceptance')
  vi.mocked(f.raw.resume).mockRejectedValue(
    new ResumeError(handle.ref!, 'missing', { noSuchSession: true }),
  )
  f.change({ revision: 'next', servers: [] })
  await handle.send('later input')
  expect(f.raw.start).toHaveBeenCalledTimes(1)
  await handle.close()
})

it('consumes the one fresh attempt even if start throws and keeps both requests unsent', async () => {
  const f = fixture(false, () => Promise.resolve())
  const handle = await f.runtime.start(initial)
  vi.mocked(f.raw.resume).mockRejectedValue(
    new ResumeError(handle.ref!, 'missing', { noSuchSession: true }),
  )
  vi.mocked(f.raw.start).mockRejectedValue(new Error('failed fresh allocation'))
  f.change({ revision: 'next', servers: [] })
  await expect(handle.send('first')).rejects.toBeInstanceOf(StoppedBeforeSend)
  await expect(handle.send('second')).rejects.toBeInstanceOf(StoppedBeforeSend)
  expect(f.raw.start).toHaveBeenCalledTimes(2)
  expect(f.opened[0]!.send).not.toHaveBeenCalled()
  await handle.close()
})

it('keeps interruption of a later read unsent after an earlier selected repair failed', async () => {
  const f = fixture(false, () => Promise.resolve())
  const handle = await f.runtime.start(initial)
  vi.mocked(f.raw.resume).mockRejectedValue(
    new ResumeError(handle.ref!, 'missing', { noSuchSession: true }),
  )
  vi.mocked(f.raw.start).mockRejectedValue(new Error('failed fresh allocation'))
  f.change({ revision: 'next', servers: [] })
  await expect(handle.send('first')).rejects.toBeInstanceOf(StoppedBeforeSend)
  let finish!: () => void
  const held = new Promise<ManagedPluginAttachment>((resolve) => {
    finish = () => resolve({ revision: 'later', servers: [] })
  })
  vi.mocked(f.source.read).mockReturnValue(held)
  const later = handle.send('later original input')
  void later.catch(() => {})
  await Promise.resolve()
  await handle.interrupt()
  try {
    await expect(later).rejects.toBeInstanceOf(StoppedBeforeSend)
    expect(f.opened[0]!.send).not.toHaveBeenCalled()
  } finally {
    finish()
    await handle.close()
  }
})

it('carries the latest settings, grants and original first-turn lead to the committed fresh handle', async () => {
  const f = fixture(false, () => Promise.resolve())
  const handle = await f.runtime.start({ ...initial, systemHint: 'fixture system context' })
  await handle.setModel('latest-model')
  await handle.setReasoningEffort('high')
  await handle.setApprovalMode('auto')
  handle.setWorkFolders(['/fictional/extra'])
  await handle.setPlanMode(false)
  vi.mocked(f.raw.resume).mockRejectedValue(
    new ResumeError(handle.ref!, 'missing', { noSuchSession: true }),
  )
  f.change({ revision: 'next', servers: [] })
  const message = 'original first-turn lead\nOriginal request.'
  await handle.send(message)
  expect(f.opened[1]!.options).toMatchObject({
    model: 'latest-model',
    reasoningEffort: 'high',
    approvalMode: 'auto',
    workFolders: ['/fictional/extra'],
    planMode: true,
    planModeEnded: true,
    externalMcp: initial.externalMcp,
    systemHint: 'fixture system context',
  })
  expect(f.opened[0]!.send).not.toHaveBeenCalled()
  expect(f.opened[1]!.send).toHaveBeenCalledExactlyOnceWith(message)
  await handle.close()
})

it.each(['interrupt', 'close', 'settings', 'provider activity', 'late rejection'] as const)(
  'owns a held fresh candidate through %s without publishing it or sending the input',
  async (change) => {
    let exited!: () => void
    const candidateExit = new Promise<void>((resolve) => {
      exited = resolve
    })
    const f = fixture(false, (index) => (index === 1 ? candidateExit : Promise.resolve()))
    const handle = await f.runtime.start(initial)
    const ordinaryStart = vi.mocked(f.raw.start).getMockImplementation()!
    let finish!: () => void
    const held = new Promise<void>((resolve) => {
      finish = resolve
    })
    vi.mocked(f.raw.resume).mockRejectedValue(
      new ResumeError(handle.ref!, 'missing', { noSuchSession: true }),
    )
    vi.mocked(f.raw.start).mockImplementation(async (options) => {
      const candidate = await ordinaryStart(options)
      options.onSessionCreated?.(candidate)
      f.opened[1]!.queue.push({ type: 'session', state: 'started', ref: candidate.ref! })
      await held
      if (change === 'late rejection') throw new Error('late failed handshake')
      return candidate
    })
    f.change({ revision: 'next', servers: [] })
    const seen: RuntimeEvent[] = []
    const pump = (async () => {
      for await (const event of handle.events()) seen.push(event)
    })()
    const sending = handle.send('queued input')
    void sending.catch(() => {})
    await vi.waitFor(() => expect(f.opened).toHaveLength(2))
    let closing: Promise<void> | undefined
    if (change === 'settings') await handle.setModel('latest-model')
    else if (change === 'close') closing = handle.close()
    else if (change === 'provider activity') {
      f.opened[0]!.queue.push({ type: 'provider_turn' })
      await Promise.resolve()
    } else await handle.interrupt()
    finish()
    await expect(sending).rejects.toBeInstanceOf(StoppedBeforeSend)
    await closing
    expect(f.opened.every((one) => one.send.mock.calls.length === 0)).toBe(true)
    expect(f.opened[1]!.close).toHaveBeenCalledTimes(1)
    expect(seen.some((one) => one.type === 'session')).toBe(false)
    await handle.close()
    let settled = false
    const exit = handle.awaitProcessExit!()!.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    exited()
    await exit
    await pump
  },
)

it('shares the preparation deadline instead of granting the fresh attempt another minute', async () => {
  vi.useFakeTimers()
  const f = fixture(false, () => Promise.resolve())
  const handle = await f.runtime.start(initial)
  const ordinaryStart = vi.mocked(f.raw.start).getMockImplementation()!
  let finish!: () => void
  const held = new Promise<void>((resolve) => {
    finish = resolve
  })
  let freshSignal: AbortSignal | undefined
  vi.mocked(f.raw.resume).mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, MANAGED_PLUGIN_REOPEN_WITHIN_MS - 25))
    throw new ResumeError(handle.ref!, 'missing', { noSuchSession: true })
  })
  vi.mocked(f.raw.start).mockImplementation(async (options) => {
    const candidate = await ordinaryStart(options)
    options.onSessionCreated?.(candidate)
    freshSignal = options.signal
    await held
    return candidate
  })
  f.change({ revision: 'next', servers: [] })
  const sending = handle.send('queued input')
  void sending.catch(() => {})
  await vi.advanceTimersByTimeAsync(MANAGED_PLUGIN_REOPEN_WITHIN_MS - 25)
  expect(f.raw.start).toHaveBeenCalledTimes(2)
  expect(freshSignal?.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(25)
  expect(freshSignal?.aborted).toBe(true)
  finish()
  await expect(sending).rejects.toBeInstanceOf(StoppedBeforeSend)
  expect(f.opened.every((one) => one.send.mock.calls.length === 0)).toBe(true)
  await handle.close()
})

it('does not allocate or send while the failed resume candidate still lacks positive exit proof', async () => {
  let exited!: () => void
  const failedExit = new Promise<void>((resolve) => {
    exited = resolve
  })
  const f = fixture(false, (index) => (index === 1 ? failedExit : Promise.resolve()))
  const handle = await f.runtime.start(initial)
  const ordinaryResume = vi.mocked(f.raw.resume).getMockImplementation()!
  vi.mocked(f.raw.resume).mockImplementation(async (ref, options) => {
    await ordinaryResume(ref, options)
    throw new ResumeError(ref, 'missing', { noSuchSession: true })
  })
  f.change({ revision: 'next', servers: [] })
  await expect(handle.send('first')).rejects.toBeInstanceOf(StoppedBeforeSend)
  await expect(handle.send('still no exit proof')).rejects.toBeInstanceOf(StoppedBeforeSend)
  expect(f.raw.start).toHaveBeenCalledTimes(1)
  expect(f.opened.every((one) => one.send.mock.calls.length === 0)).toBe(true)
  exited()
  await handle.close()
  await handle.awaitProcessExit?.()
})
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
      ref: { provider: 'codex', sessionId: 'fictional-thread', cwd: initial.cwd, rotation: 0 },
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

it.each([true, false])(
  'recovers a confirmed stale attachment with identical metadata (public refresh %s)',
  async (refresh) => {
    const f = fixture(refresh),
      a = await f.runtime.start(initial)
    const before = f.opened[0]!,
      saved = a.ref
    const health = vi.fn(async () => [route.name])
    Object.assign(before.handle, { managedPluginHealth: health })
    await a.send('fictional next tool call')
    expect(health).toHaveBeenCalledWith([route])
    if (refresh) {
      expect(before.handle.refreshManagedPlugins).toHaveBeenCalledWith([route], [route.name])
      expect(f.raw.resume).not.toHaveBeenCalled()
      expect(before.send).toHaveBeenCalledOnce()
    } else {
      expect(f.raw.resume).toHaveBeenCalledWith(
        saved,
        expect.objectContaining({ managedPluginMcp: [route] }),
      )
      expect(before.send).not.toHaveBeenCalled()
      expect(before.close).toHaveBeenCalledOnce()
      expect(f.opened[1]!.send).toHaveBeenCalledWith('fictional next tool call')
    }
    expect(a.ref).toEqual(saved)
    await a.close()
  },
)
it.each(['ready', 'unknown', 'error', 'timeout'])(
  'does not rotate unchanged attachments on %s health',
  async (health) => {
    vi.useFakeTimers()
    const f = fixture(true),
      a = await f.runtime.start(initial)
    Object.assign(f.opened[0]!.handle, {
      managedPluginHealth: vi.fn(() => {
        if (health === 'error') return Promise.reject(new Error('fictional-private-marker'))
        if (health === 'timeout') return new Promise(() => {})
        return Promise.resolve(health === 'ready' ? [] : undefined)
      }),
    })
    for (let i = 0; i < 2; i++) {
      const sent = a.send('fictional ordinary turn')
      await vi.advanceTimersByTimeAsync(PLUGIN_ATTACHMENT_WAIT_MS)
      await sent
    }
    expect(f.raw.resume).not.toHaveBeenCalled()
    expect(f.opened[0]!.handle.refreshManagedPlugins).not.toHaveBeenCalled()
    expect(f.opened[0]!.send).toHaveBeenCalledTimes(2)
    await a.close()
  },
)
it('cancellation during a public health read cannot send or refresh after a late stale reply', async () => {
  const f = fixture(true),
    a = await f.runtime.start(initial)
  let release!: (value: string[]) => void
  let began!: () => void
  const started = new Promise<void>((resolve) => {
    began = resolve
  })
  Object.assign(f.opened[0]!.handle, {
    managedPluginHealth: () => {
      began()
      return new Promise<string[]>((resolve) => {
        release = resolve
      })
    },
  })
  const sent = a.send('fictional cancelled turn')
  const outcome = sent.then(
    () => undefined,
    (error: unknown) => error,
  )
  await Promise.race([started, outcome])
  expect(typeof release).toBe('function')
  await a.interrupt()
  release([route.name])
  expect(await outcome).toMatchObject({ message: expect.stringContaining('stopped') })
  expect(f.opened[0]!.send).not.toHaveBeenCalled()
  expect(f.opened[0]!.handle.refreshManagedPlugins).not.toHaveBeenCalled()
  await a.close()
})
it('does not inspect or refresh a managed connection during an active turn', async () => {
  const f = fixture(true),
    a = await f.runtime.start(initial)
  const health = vi.fn(async () => 'stale')
  Object.assign(f.opened[0]!.handle, { managedPluginHealth: health })
  vi.spyOn(f.opened[0]!.handle, 'status').mockReturnValue('working')
  await a.send('fictional active delivery')
  expect(health).not.toHaveBeenCalled()
  expect(f.opened[0]!.handle.refreshManagedPlugins).not.toHaveBeenCalled()
  expect(f.raw.resume).not.toHaveBeenCalled()
  await a.close()
})
it('stale health cannot bypass an unknown retired process exit', async () => {
  const f = fixture(false, () => undefined),
    a = await f.runtime.start(initial)
  Object.assign(f.opened[0]!.handle, { managedPluginHealth: async () => [route.name] })
  await a.send('fictional recovered turn')
  expect(f.opened).toHaveLength(2)
  Object.assign(f.opened[1]!.handle, { managedPluginHealth: async () => [route.name] })
  await a.send('fictional following turn')
  expect(f.raw.resume).toHaveBeenCalledOnce()
  expect(f.opened[1]!.send).toHaveBeenCalledTimes(2)
  await a.close()
})

it('a turn that becomes active during health discovery cannot be refreshed or replayed', async () => {
  const f = fixture(true),
    a = await f.runtime.start(initial)
  let release!: (value: string[]) => void
  let began!: () => void
  const started = new Promise<void>((resolve) => {
    began = resolve
  })
  Object.assign(f.opened[0]!.handle, {
    managedPluginHealth: () => {
      began()
      return new Promise<string[]>((resolve) => {
        release = resolve
      })
    },
  })
  const sent = a.send('fictional pending turn')
  const outcome = sent.then(
    () => undefined,
    (error: unknown) => error,
  )
  await Promise.race([started, outcome])
  expect(typeof release).toBe('function')
  vi.spyOn(f.opened[0]!.handle, 'status').mockReturnValue('working')
  release([route.name])
  expect(await outcome).toBeInstanceOf(TurnInProgress)
  expect(f.opened[0]!.handle.refreshManagedPlugins).not.toHaveBeenCalled()
  expect(f.opened[0]!.send).not.toHaveBeenCalled()
  expect(f.raw.resume).not.toHaveBeenCalled()
  await a.close()
})

it('a plugin still starting or unknown keeps its attached route; only a committed off or a complete legacy set removes it', async () => {
  const fern = { ...route, pluginId: 'fern' }
  const f = fixture(true)
  f.change({ revision: 'one', servers: [fern] })
  const a = await f.runtime.start(initial)
  const refresh = f.opened[0]!.handle.refreshManagedPlugins!
  f.change({
    revision: 'two',
    servers: [],
    plugins: { pending: ['fern'], none: [], unknown: false },
  })
  await a.send('fictional words')
  expect(refresh).not.toHaveBeenCalled()
  f.change({ revision: 'three', servers: [], plugins: { pending: [], none: [], unknown: true } })
  await a.send('fictional words')
  expect(refresh).not.toHaveBeenCalled()
  f.change({
    revision: 'four',
    servers: [],
    plugins: { pending: [], none: ['fern'], unknown: false },
  })
  await a.send('fictional words')
  expect(refresh).toHaveBeenCalledWith([])
  await a.close()

  const g = fixture(true)
  g.change({ revision: 'one', servers: [fern] })
  const b = await g.runtime.start(initial)
  g.change({ revision: 'two', servers: [] })
  await b.send('fictional words')
  expect(g.opened[0]!.handle.refreshManagedPlugins).toHaveBeenCalledWith([])
  await b.close()
})

it('a plugin served again under a new route replaces the one kept while it was starting', async () => {
  const fern = { ...route, pluginId: 'fern' }
  const fresh = { ...fern, capability: 'b'.repeat(64) }
  const f = fixture(true)
  f.change({ revision: 'one', servers: [fern] })
  const a = await f.runtime.start(initial)
  f.change({
    revision: 'two',
    servers: [],
    plugins: { pending: ['fern'], none: [], unknown: false },
  })
  await a.send('fictional words')
  f.change({
    revision: 'three',
    servers: [fresh],
    plugins: { pending: [], none: [], unknown: false },
  })
  await a.send('fictional words')
  expect(f.opened[0]!.handle.refreshManagedPlugins).toHaveBeenCalledWith([fresh])
  await a.close()
})
it('a turn may wait only on what the latest read served, even when its routes could not be applied', async () => {
  const fern = { ...route, pluginId: 'fern' }
  const aster = { ...route, name: 'plugin-aster', capability: 'c'.repeat(64), pluginId: 'aster' }
  const f = fixture()
  f.change({ revision: 'one', servers: [fern], plugins: { pending: [], none: [], unknown: false } })
  const a = await f.runtime.start(initial)
  const awaited = vi.fn()
  Object.assign(f.opened[0]!.handle, { awaitManagedPlugins: awaited })
  vi.mocked(f.raw.resume).mockRejectedValueOnce(new Error('fictional plugin unavailable'))
  f.change({
    revision: 'two',
    servers: [aster],
    plugins: { pending: ['fern'], none: [], unknown: false },
  })
  await a.send('fictional words')
  expect(f.raw.resume).toHaveBeenCalledTimes(1)
  expect(f.opened[0]!.send).toHaveBeenCalledWith('fictional words')
  expect(awaited).toHaveBeenLastCalledWith(['plugin-aster'])
  await a.close()
})
it('a read that fails says nothing new about what a turn may wait on', async () => {
  const fern = { ...route, pluginId: 'fern' }
  const f = fixture()
  f.change({ revision: 'one', servers: [fern], plugins: { pending: [], none: [], unknown: false } })
  const a = await f.runtime.start(initial)
  const awaited = vi.fn()
  Object.assign(f.opened[0]!.handle, { awaitManagedPlugins: awaited })
  await a.send('first fictional turn')
  expect(awaited).toHaveBeenCalledTimes(1)
  vi.mocked(f.source.read).mockRejectedValueOnce(new Error('fictional read failure'))
  await a.send('second fictional turn')
  expect(f.opened[0]!.send).toHaveBeenCalledWith('second fictional turn')
  expect(awaited).toHaveBeenCalledTimes(1)
  await a.close()
})
it('a plugin a named reply leaves out, without saying it is off, keeps its attached route', async () => {
  const fern = { ...route, pluginId: 'fern' }
  const f = fixture(true)
  f.change({ revision: 'one', servers: [fern], plugins: { pending: [], none: [], unknown: false } })
  const a = await f.runtime.start(initial)
  f.change({ revision: 'two', servers: [], plugins: { pending: [], none: [], unknown: false } })
  await a.send('fictional words')
  expect(f.opened[0]!.handle.refreshManagedPlugins).not.toHaveBeenCalled()
  expect(f.raw.resume).not.toHaveBeenCalled()
  f.change({
    revision: 'three',
    servers: [],
    plugins: { pending: [], none: ['fern'], unknown: false },
  })
  await a.send('fictional words again')
  expect(f.opened[0]!.handle.refreshManagedPlugins).toHaveBeenCalledWith([])
  await a.close()
})
it('a route from a reply that named no plugin stays while a named reply cannot speak for it', async () => {
  const f = fixture(true)
  f.change({ revision: 'one', servers: [route] })
  const a = await f.runtime.start(initial)
  const refresh = f.opened[0]!.handle.refreshManagedPlugins!
  const awaited = vi.fn()
  Object.assign(f.opened[0]!.handle, { awaitManagedPlugins: awaited })
  f.change({ revision: 'two', servers: [], plugins: { pending: [], none: [], unknown: true } })
  await a.send('fictional words while unknown')
  f.change({
    revision: 'three',
    servers: [],
    plugins: { pending: ['fern'], none: ['aster'], unknown: false },
  })
  await a.send('fictional words while starting')
  expect(refresh).not.toHaveBeenCalled()
  expect(f.raw.resume).not.toHaveBeenCalled()
  expect(awaited).toHaveBeenLastCalledWith([])
  // The same address, now served under its plugin: nothing to change, and it is awaited again.
  const fern = { ...route, pluginId: 'fern' }
  f.change({ revision: 'four', servers: [fern], plugins: { pending: [], none: [], unknown: true } })
  await a.send('fictional words once named')
  expect(refresh).not.toHaveBeenCalled()
  expect(f.raw.resume).not.toHaveBeenCalled()
  expect(awaited).toHaveBeenLastCalledWith([route.name])
  // Named now, it goes as any named route does: when its plugin is off.
  f.change({
    revision: 'five',
    servers: [],
    plugins: { pending: [], none: ['fern'], unknown: false },
  })
  await a.send('fictional words once off')
  expect(refresh).toHaveBeenCalledWith([])
  expect(f.opened[0]!.send).toHaveBeenCalledTimes(4)
  await a.close()
})
it('a route kept while its scope could not be read is not awaited, and is awaited again once served', async () => {
  const fern = { ...route, pluginId: 'fern' }
  const f = fixture()
  f.change({ revision: 'one', servers: [fern], plugins: { pending: [], none: [], unknown: false } })
  const a = await f.runtime.start(initial)
  const awaited = vi.fn()
  Object.assign(f.opened[0]!.handle, { awaitManagedPlugins: awaited })
  f.change({ revision: 'two', servers: [], plugins: { pending: [], none: [], unknown: true } })
  await a.send('fictional words while unknown')
  expect(awaited).toHaveBeenLastCalledWith([])
  f.change({
    revision: 'three',
    servers: [fern],
    plugins: { pending: [], none: [], unknown: false },
  })
  await a.send('fictional words once served')
  expect(awaited).toHaveBeenLastCalledWith([route.name])
  expect(f.raw.resume).not.toHaveBeenCalled()
  await a.close()
})
