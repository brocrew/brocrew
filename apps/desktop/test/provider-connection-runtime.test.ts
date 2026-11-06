import { afterEach, expect, it, vi } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  RejectedSessionLaunch,
  ResumeError,
  StoppedBeforeSend,
  withManagedPluginAttachments,
  type AgentRuntime,
  type SessionHandle,
  type SessionRef,
} from '@brobot2/runtime'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import * as providers from '../src/main/providers'

type Bind = (
  provider: Provider,
  create: () => AgentRuntime,
  resolve: (connectionId?: string | null) => ProviderConnection,
  connectionId?: string | null,
  revision?: () => number,
) => AgentRuntime

const handles: SessionHandle[] = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()))
})

function record(provider: Provider, method: 'sign-in' | 'api-key'): ProviderConnection {
  return {
    id: `${provider}:${method}`,
    provider,
    name: method === 'sign-in' ? 'subscription' : 'API key',
    authMethod: method,
    credentialSource: method === 'sign-in' ? 'provider-sign-in' : 'provider-api-key',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  }
}

function fixture(provider: Provider, selected?: string | null) {
  const bind = Reflect.get(providers, 'onProviderConnection') as Bind | undefined
  expect(bind, 'the registered connection runtime boundary').toBeTypeOf('function')
  if (!bind) throw new Error('Connection runtime boundary is absent')
  const state = { current: record(provider, 'sign-in'), revision: 0 }
  const runtimes: FakeRuntime[] = []
  const sessions = new FakeProviderSessions()
  const create = vi.fn(() => {
    const runtime = new FakeRuntime(provider, { sessions })
    runtimes.push(runtime)
    return runtime
  })
  const resolve = vi.fn((id?: string | null) => {
    if (id != null && id !== state.current.id) throw new Error('Connection unavailable')
    return state.current
  })
  return {
    runtime: bind(provider, create, resolve, selected, () => state.revision),
    state,
    runtimes,
    sessions,
    create,
    resolve,
  }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: binding does no setup, then each legacy launch resolves the current method`, async () => {
    const f = fixture(provider)
    expect(f.create).not.toHaveBeenCalled()
    expect(f.resolve).not.toHaveBeenCalled()
    const first = await f.runtime.start({
      cwd: '/fictional/fern',
      providerHome: '/fictional/fern/state',
    })
    handles.push(first)
    expect(Reflect.get(first, 'connectionId')).toBe(`${provider}:sign-in`)
    expect('connectionId' in first).toBe(true)
    f.state.current = record(provider, 'api-key')
    const second = await f.runtime.start({
      cwd: '/fictional/willow',
      providerHome: '/fictional/willow/state',
    })
    handles.push(second)
    expect(Reflect.get(second, 'connectionId')).toBe(`${provider}:api-key`)
    expect(Reflect.get(first, 'connectionId')).toBe(`${provider}:sign-in`)
    expect(f.runtimes).toHaveLength(2)
    expect(first.ref?.cwd).toBe('/fictional/fern')
    expect(second.ref?.cwd).toBe('/fictional/willow')
  })

  it(`${provider}: an explicit unavailable binding refuses before any runtime is created`, async () => {
    const f = fixture(provider, `${provider}:api-key`)
    await expect(
      f.runtime.start({ cwd: '/fictional/fern', providerHome: '/fictional/state' }),
    ).rejects.toThrow('Connection unavailable')
    expect(f.create).not.toHaveBeenCalled()
  })

  it(`${provider}: a fixed binding never falls back after its key is removed`, async () => {
    const f = fixture(provider, `${provider}:api-key`)
    f.state.current = record(provider, 'api-key')
    const handle = await f.runtime.start({
      cwd: '/fictional/fern',
      providerHome: '/fictional/state',
    })
    handles.push(handle)
    f.state.current = record(provider, 'sign-in')
    await expect(
      f.runtime.resume(handle.ref!, { providerHome: '/fictional/state' }),
    ).rejects.toThrow('Connection unavailable')
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(Reflect.get(handle, 'connectionId')).toBe(`${provider}:api-key`)
  })

  it(`${provider}: model listing uses the same admission and keeps the agent state context`, async () => {
    const f = fixture(provider)
    await f.runtime.listModels({ providerHome: '/fictional/fern/state' })
    expect(f.resolve).toHaveBeenCalledTimes(2)
    expect(f.create).toHaveBeenCalledTimes(1)
  })

  it(`${provider}: cancel before launch does no connection lookup or provider work`, async () => {
    const f = fixture(provider)
    const controller = new AbortController()
    controller.abort()
    await expect(
      f.runtime.start({
        cwd: '/fictional/fern',
        providerHome: '/fictional/state',
        signal: controller.signal,
      }),
    ).rejects.toThrow()
    expect(f.resolve).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })

  for (const change of ['method', 'cancel', 'changed-back'] as const) {
    it(`${provider}: ${change} across a launch await closes the child instead of returning false attribution`, async () => {
      const f = fixture(provider)
      const raw = new FakeRuntime(provider)
      const start = raw.start.bind(raw)
      let release!: () => void
      let entered!: () => void
      const arrived = new Promise<void>((resolve) => {
        entered = resolve
      })
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const close = vi.fn<() => Promise<void>>()
      vi.spyOn(raw, 'start').mockImplementation(async (options) => {
        const handle = await start(options)
        const original = handle.close.bind(handle)
        close.mockImplementation(original)
        handle.close = close
        handles.push(handle)
        entered()
        await held
        return handle
      })
      f.create.mockReturnValue(raw)
      const controller = new AbortController()
      const pending = f.runtime.start({
        cwd: '/fictional/fern',
        providerHome: '/fictional/state',
        signal: controller.signal,
      })
      await arrived
      if (change === 'method') f.state.current = record(provider, 'api-key')
      else if (change === 'cancel') controller.abort()
      else f.state.revision += 2
      release()
      await expect(pending).rejects.toThrow()
      expect(close).toHaveBeenCalledTimes(1)
      handles.pop()
    })
  }

  it(`${provider}: a model answer is not attributed after a credential revision changed`, async () => {
    const f = fixture(provider)
    const raw = new FakeRuntime(provider)
    vi.spyOn(raw, 'listModels').mockImplementation(async () => {
      f.state.revision++
      return [{ id: 'fictional-small', label: 'Small' }]
    })
    f.create.mockReturnValue(raw)
    await expect(f.runtime.listModels({ providerHome: '/fictional/state' })).rejects.toThrow()
  })

  it(`${provider}: concurrent teardown calls own the underlying close exactly once`, async () => {
    const f = fixture(provider)
    const handle = await f.runtime.start({
      cwd: '/fictional/fern',
      providerHome: '/fictional/state',
    })
    const issued = f.sessions.lookUp(handle.ref!.sessionId)
    expect(issued).toBeDefined()
    const innerClose = vi.spyOn(Object.getPrototypeOf(handle), 'close')
    try {
      await Promise.all([handle.close(), handle.close()])
      expect(innerClose).toHaveBeenCalledTimes(1)
    } finally {
      innerClose.mockRestore()
    }
  })

  for (const change of ['revision', 'abort'] as const) {
    it(`${provider}: retains a privately withheld start allocation after ${change} and handshake rejection`, async () => {
      const f = fixture(provider)
      const raw = new FakeRuntime(provider)
      const start = raw.start.bind(raw)
      const controller = new AbortController()
      let finishExit!: () => void
      const exit = new Promise<void>((resolve) => {
        finishExit = resolve
      })
      vi.spyOn(raw, 'start').mockImplementation(async (options) => {
        const handle = await start(options)
        handles.push(handle)
        Object.defineProperty(handle, 'awaitProcessExit', { configurable: true, value: () => exit })
        if (change === 'revision') f.state.revision++
        else controller.abort()
        options.onSessionCreated?.(handle)
        await handle.close()
        throw new Error('fictional rejected handshake')
      })
      f.create.mockReturnValue(raw)
      const callback = vi.fn()
      const error = await f.runtime
        .start({
          cwd: '/fictional/fern',
          providerHome: '/fictional/state',
          signal: controller.signal,
          onSessionCreated: callback,
        })
        .catch((error: unknown) => error)
      try {
        expect(callback).not.toHaveBeenCalled()
        expect(error).toBeInstanceOf(RejectedSessionLaunch)
        const refused = error as RejectedSessionLaunch
        expect(refused.processExit).toBe(exit)
        let terminated = false
        void refused.terminated.then(() => {
          terminated = true
        })
        await Promise.resolve()
        expect(terminated).toBe(false)
        finishExit()
        await refused.terminated
        expect(terminated).toBe(true)
      } finally {
        finishExit()
      }
    })
  }

  for (const withheld of [false, true]) {
    it(`${provider}: resume rejection ${withheld ? 'retains withheld exit proof' : 'preserves forwarded typed refusal'}`, async () => {
      const f = fixture(provider)
      const first = await f.runtime.start({
        cwd: '/fictional/fern',
        providerHome: '/fictional/state',
      })
      await first.close()
      const raw = new FakeRuntime(provider)
      const refusal = new ResumeError(first.ref!, 'fictional no rollout found', {
        noSuchSession: true,
      })
      let finish!: () => void
      const exit = new Promise<void>((resolve) => {
        finish = resolve
      })
      vi.spyOn(raw, 'resume').mockImplementation(async (_ref, options) => {
        const handle = await raw.start({ ...options, cwd: first.ref!.cwd })
        handles.push(handle)
        Object.defineProperty(handle, 'awaitProcessExit', { configurable: true, value: () => exit })
        if (withheld) f.state.revision++
        options.onSessionCreated?.(handle)
        await handle.close()
        throw refusal
      })
      f.create.mockReturnValue(raw)
      const callback = vi.fn()
      const error = await f.runtime
        .resume(first.ref!, {
          providerHome: '/fictional/state',
          onSessionCreated: callback,
        })
        .catch((error: unknown) => error)
      try {
        if (withheld) {
          expect(callback).not.toHaveBeenCalled()
          expect(error).toBeInstanceOf(RejectedSessionLaunch)
          expect((error as RejectedSessionLaunch).cause).toBe(refusal)
          expect((error as RejectedSessionLaunch).processExit).toBe(exit)
          let terminated = false
          void (error as RejectedSessionLaunch).terminated.then(() => {
            terminated = true
          })
          await Promise.resolve()
          expect(terminated).toBe(false)
          finish()
          await (error as RejectedSessionLaunch).terminated
        } else {
          expect(callback).toHaveBeenCalledTimes(1)
          expect(error).toBe(refusal)
          expect((error as ResumeError).noSuchSession).toBe(true)
        }
      } finally {
        finish()
      }
    })
  }

  for (const changed of [false, true]) {
    it(`${provider}: start callback ${changed ? 'withholds changed binding' : 'owns the same attributed handle'}`, async () => {
      const f = fixture(provider)
      const raw = new FakeRuntime(provider)
      const start = raw.start.bind(raw)
      const innerClose = vi.fn<() => Promise<void>>()
      vi.spyOn(raw, 'start').mockImplementation(async (options) => {
        const handle = await start(options)
        innerClose.mockImplementation(handle.close.bind(handle))
        handle.close = innerClose
        if (changed) f.state.revision++
        options.onSessionCreated?.(handle)
        return handle
      })
      f.create.mockReturnValue(raw)
      const callback = vi.fn()
      const pending = f.runtime.start({
        cwd: '/fictional/fern',
        providerHome: '/fictional/state',
        onSessionCreated: callback,
      })
      if (changed) {
        await expect(pending).rejects.toThrow()
        expect(callback).not.toHaveBeenCalled()
        expect(innerClose).toHaveBeenCalledTimes(1)
      } else {
        const handle = await pending
        handles.push(handle)
        expect(callback).toHaveBeenCalledTimes(1)
        expect(callback.mock.calls[0]![0]).toBe(handle)
        expect(Reflect.get(handle, 'connectionId')).toBe(`${provider}:sign-in`)
      }
    })
  }

  for (const changed of [false, true]) {
    it(`${provider}: resume callback ${changed ? 'withholds changed binding' : 'owns the same attributed handle'}`, async () => {
      const f = fixture(provider)
      const first = await f.runtime.start({
        cwd: '/fictional/fern',
        providerHome: '/fictional/state',
      })
      await first.close()
      const raw = new FakeRuntime(provider, { sessions: f.sessions })
      const resume = raw.resume.bind(raw)
      const innerClose = vi.fn<() => Promise<void>>()
      vi.spyOn(raw, 'resume').mockImplementation(async (ref, options) => {
        const handle = await resume(ref, options)
        innerClose.mockImplementation(handle.close.bind(handle))
        handle.close = innerClose
        if (changed) f.state.revision++
        options.onSessionCreated?.(handle)
        return handle
      })
      f.create.mockReturnValue(raw)
      const callback = vi.fn()
      const pending = f.runtime.resume(first.ref!, {
        providerHome: '/fictional/state',
        onSessionCreated: callback,
      })
      if (changed) {
        await expect(pending).rejects.toThrow()
        expect(callback).not.toHaveBeenCalled()
        expect(innerClose).toHaveBeenCalledTimes(1)
      } else {
        const handle = await pending
        handles.push(handle)
        expect(callback).toHaveBeenCalledTimes(1)
        expect(callback.mock.calls[0]![0]).toBe(handle)
        expect(handle.ref).toEqual(first.ref)
        expect(Reflect.get(handle, 'connectionId')).toBe(`${provider}:sign-in`)
      }
    })
  }

  for (const changed of [
    { provider: provider === 'claude' ? 'codex' : 'claude' },
    { id: 'fictional-extra' },
    { baseUrl: 'https://fictional.invalid' },
    { enabled: false },
    { credentialSource: 'provider-api-key' },
    { contractVersion: 2 },
  ]) {
    it(`${provider}: invalid connection metadata ${JSON.stringify(changed)} cannot open a child`, async () => {
      const f = fixture(provider)
      Object.assign(f.state.current, changed)
      await expect(
        f.runtime.start({ cwd: '/fictional/fern', providerHome: '/fictional/state' }),
      ).rejects.toThrow()
      expect(f.create).not.toHaveBeenCalled()
    })
  }

  it(`${provider}: a foreign transcript ref is refused without fallback or a child`, async () => {
    const f = fixture(provider)
    const ref: SessionRef = {
      provider: provider === 'claude' ? 'codex' : 'claude',
      sessionId: 'fictional-old',
      cwd: '/fictional/original',
      rotation: 0,
    }
    await expect(
      f.runtime.resume(ref, { providerHome: '/fictional/original-state' }),
    ).rejects.toThrow()
    expect(f.create).not.toHaveBeenCalled()
  })
}

it('composed privately withheld start allocation keeps aggregate cleanup pending until actual exit', async () => {
  const f = fixture('codex')
  const raw = new FakeRuntime('codex')
  const start = raw.start.bind(raw)
  let allocations = 0,
    finishExit!: () => void
  const exit = new Promise<void>((resolve) => {
    finishExit = resolve
  })
  const sent = vi.fn()
  vi.spyOn(raw, 'resume').mockImplementation(async (ref) => {
    throw new ResumeError(ref, 'fictional empty rollout', { noSuchSession: true })
  })
  vi.spyOn(raw, 'start').mockImplementation(async (options) => {
    const handle = await start(options)
    handle.send = sent
    allocations++
    if (allocations === 2) {
      Object.defineProperty(handle, 'awaitProcessExit', { configurable: true, value: () => exit })
      f.state.revision++
      options.onSessionCreated?.(handle)
      await handle.close()
      throw new Error('fictional refused late handshake')
    }
    Object.defineProperty(handle, 'awaitProcessExit', {
      configurable: true,
      value: () => Promise.resolve(),
    })
    return handle
  })
  f.create.mockReturnValue(raw)
  let reads = 0
  const route = {
    name: 'plugin-chrome',
    pluginId: 'chrome',
    url: 'http://127.0.0.1:8123/mcp',
    capability: 'a'.repeat(64),
  }
  const wrapped = withManagedPluginAttachments(f.runtime, {
    read: async () => ({ revision: String(++reads), servers: reads === 1 ? [] : [route] }),
    close: async () => {},
  })
  const handle = await wrapped.start({ cwd: '/fictional/fern', providerHome: '/fictional/state' })
  try {
    await expect(handle.send('One unsent input.')).rejects.toBeInstanceOf(StoppedBeforeSend)
    expect(sent).not.toHaveBeenCalled()
    await expect(handle.send('Explicit blocked retry.')).rejects.toBeInstanceOf(StoppedBeforeSend)
    expect(allocations).toBe(2)
    let settled = false
    await handle.close()
    const actualExit = handle.awaitProcessExit?.()
    expect(actualExit).toBeDefined()
    const quiesced = actualExit!.then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    finishExit()
    await quiesced
    expect(settled).toBe(true)
  } finally {
    finishExit()
    await handle.close()
  }
})
