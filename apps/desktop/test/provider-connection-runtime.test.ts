import { afterEach, expect, it, vi } from 'vitest'
import { FakeRuntime, type AgentRuntime, type SessionHandle, type SessionRef } from '@brobot2/runtime'
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
  const create = vi.fn(() => {
    const runtime = new FakeRuntime(provider)
    runtimes.push(runtime)
    return runtime
  })
  const resolve = vi.fn((id?: string | null) => {
    if (id != null && id !== state.current.id) throw new Error('Connection unavailable')
    return state.current
  })
  return { runtime: bind(provider, create, resolve, selected, () => state.revision), state, runtimes, create, resolve }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: binding does no setup, then each legacy launch resolves the current method`, async () => {
    const f = fixture(provider)
    expect(f.create).not.toHaveBeenCalled()
    expect(f.resolve).not.toHaveBeenCalled()
    const first = await f.runtime.start({ cwd: '/fictional/fern', providerHome: '/fictional/fern/state' })
    handles.push(first)
    expect(Reflect.get(first, 'connectionId')).toBe(`${provider}:sign-in`)
    f.state.current = record(provider, 'api-key')
    const second = await f.runtime.start({ cwd: '/fictional/willow', providerHome: '/fictional/willow/state' })
    handles.push(second)
    expect(Reflect.get(second, 'connectionId')).toBe(`${provider}:api-key`)
    expect(Reflect.get(first, 'connectionId')).toBe(`${provider}:sign-in`)
    expect(f.runtimes).toHaveLength(2)
    expect(first.ref?.cwd).toBe('/fictional/fern')
    expect(second.ref?.cwd).toBe('/fictional/willow')
  })

  it(`${provider}: an explicit unavailable binding refuses before any runtime is created`, async () => {
    const f = fixture(provider, `${provider}:api-key`)
    await expect(f.runtime.start({ cwd: '/fictional/fern', providerHome: '/fictional/state' })).rejects.toThrow('Connection unavailable')
    expect(f.create).not.toHaveBeenCalled()
  })

  it(`${provider}: a fixed binding never falls back after its key is removed`, async () => {
    const f = fixture(provider, `${provider}:api-key`)
    f.state.current = record(provider, 'api-key')
    const handle = await f.runtime.start({ cwd: '/fictional/fern', providerHome: '/fictional/state' })
    handles.push(handle)
    f.state.current = record(provider, 'sign-in')
    await expect(f.runtime.resume(handle.ref!, { providerHome: '/fictional/state' })).rejects.toThrow('Connection unavailable')
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
    await expect(f.runtime.start({ cwd: '/fictional/fern', providerHome: '/fictional/state', signal: controller.signal })).rejects.toThrow()
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
      const arrived = new Promise<void>((resolve) => { entered = resolve })
      const held = new Promise<void>((resolve) => { release = resolve })
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
      const pending = f.runtime.start({ cwd: '/fictional/fern', providerHome: '/fictional/state', signal: controller.signal })
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
      await expect(f.runtime.start({ cwd: '/fictional/fern', providerHome: '/fictional/state' })).rejects.toThrow()
      expect(f.create).not.toHaveBeenCalled()
    })
  }

  it(`${provider}: a foreign transcript ref is refused without fallback or a child`, async () => {
    const f = fixture(provider)
    const ref: SessionRef = { provider: provider === 'claude' ? 'codex' : 'claude', sessionId: 'fictional-old', cwd: '/fictional/original', rotation: 0 }
    await expect(f.runtime.resume(ref, { providerHome: '/fictional/original-state' })).rejects.toThrow()
    expect(f.create).not.toHaveBeenCalled()
  })
}
