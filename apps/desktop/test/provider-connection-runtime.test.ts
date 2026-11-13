import { afterEach, expect, it, vi } from 'vitest'
import {
  FakeRuntime,
  RejectedSessionLaunch,
  ResumeError,
  StoppedBeforeSend,
  withManagedPluginAttachments,
  type SessionHandle,
  type SessionRef,
} from '@brobot2/runtime'
import { ClaudeRuntime } from '@brobot2/runtime/claude'
import { CodexRuntime } from '@brobot2/runtime/codex'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import { createProviderModules } from '../src/main/providers'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ScriptedAppServer } from './lib/scripted-codex-host'
import { codexAppServerArgs } from '../../../packages/runtime/src/codex/codex-runtime'

const handles: SessionHandle[] = []
const homes: string[] = []

function keyBoundRuntime(failure?: 'rejected' | 'malformed' | 'subscription' | 'waiting') {
  const home = mkdtempSync(join(tmpdir(), 'brocrew-key-runtime-'))
  homes.push(home)
  mkdirSync(home, { recursive: true })
  const original = '{"auth_mode":"chatgpt","tokens":{"account_id":"fictional-first"}}'
  writeFileSync(join(home, 'auth.json'), original)
  const server = new ScriptedAppServer(home)
  const request = server.request.bind(server)
  const health = vi.fn(() => ({ ok: false, reason: 'Subscription file health is not API auth' }))
  let enter!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  let rejectLogin: ((reason: Error) => void) | undefined
  server.request = (method, params) => {
    if (method === 'account/login/start') {
      enter()
      if (failure === 'rejected') return Promise.reject(new Error('fictional native login refused'))
      if (failure === 'malformed') return Promise.resolve({})
      if (failure === 'waiting')
        return new Promise((_resolve, reject) => {
          rejectLogin = reject
        })
    }
    if (failure === 'subscription' && method === 'getAuthStatus')
      return Promise.resolve({ authMethod: 'chatgpt' })
    if (failure === 'subscription' && method === 'account/read')
      return Promise.resolve({ account: { type: 'chatgpt', email: 'fixture@example.invalid' } })
    return request(method, params)
  }
  const close = server.close.bind(server)
  const closed = vi.spyOn(server, 'close').mockImplementation(() => {
    rejectLogin?.(new Error('fictional cancelled native login'))
    close()
  })
  const factory = vi.fn(() => server)
  const runtime = new CodexRuntime(factory, health, 'fictional-once-selected')
  return { home, original, server, runtime, factory, health, closed, entered }
}

it('requests the native ephemeral backend only for API-bound child arguments', () => {
  expect(codexAppServerArgs()).toEqual(['app-server'])
  expect(codexAppServerArgs(true)).toEqual([
    '-c',
    'cli_auth_credentials_store="ephemeral"',
    'app-server',
  ])
})

for (const operation of ['start', 'resume', 'models'] as const) {
  it(`Codex ${operation} logs in the selected key on the same child before work`, async () => {
    const f = keyBoundRuntime()
    if (operation === 'models') {
      await f.runtime.listModels({ providerHome: f.home })
    } else {
      const handle =
        operation === 'start'
          ? await f.runtime.start({ providerHome: f.home, cwd: f.home })
          : await f.runtime.resume(
              { provider: 'codex', sessionId: 'th_1', cwd: f.home, rotation: 0 },
              { providerHome: f.home },
            )
      handles.push(handle)
      writeFileSync(
        join(f.home, 'auth.json'),
        '{"auth_mode":"chatgpt","tokens":{"account_id":"fictional-second"}}',
      )
      await expect(handle.checkSignIn?.()).resolves.toBe(false)
      writeFileSync(join(f.home, 'auth.json'), f.original)
    }
    expect(f.factory).toHaveBeenCalledWith(
      expect.objectContaining({ providerHome: f.home, apiKeyBound: true }),
    )
    expect(f.health).not.toHaveBeenCalled()
    const requests = f.server.requests
    const login = requests.findIndex((one) => one.method === 'account/login/start')
    const work = requests.findIndex((one) =>
      ['thread/start', 'thread/resume', 'model/list'].includes(one.method),
    )
    expect(requests[0]?.method).toBe('initialize')
    expect(login).toBeGreaterThan(0)
    expect(requests[login]?.params).toEqual({ type: 'apiKey', apiKey: 'fictional-once-selected' })
    expect(work).toBeGreaterThan(login)
    expect(requests.slice(login + 1, work).map((one) => one.method)).toEqual([
      'getAuthStatus',
      'account/read',
    ])
    expect(readFileSync(join(f.home, 'auth.json'), 'utf8')).toBe(f.original)
    if (operation === 'models') expect(f.closed).toHaveBeenCalled()
  })
}

for (const failure of ['rejected', 'malformed', 'subscription'] as const) {
  it(`Codex ${failure} native API login closes without subscription fallback or thread work`, async () => {
    const f = keyBoundRuntime(failure)
    await expect(f.runtime.start({ providerHome: f.home, cwd: f.home })).rejects.toThrow()
    expect(
      f.server.requests.some((one) =>
        ['thread/start', 'thread/resume', 'model/list'].includes(one.method),
      ),
    ).toBe(false)
    expect(f.closed).toHaveBeenCalled()
    expect(readFileSync(join(f.home, 'auth.json'), 'utf8')).toBe(f.original)
  })
}

it('Codex cancellation during native key login closes the same child before thread work', async () => {
  const f = keyBoundRuntime('waiting')
  const controller = new AbortController()
  const result = f.runtime
    .start({ providerHome: f.home, cwd: f.home, signal: controller.signal })
    .then(
      () => null,
      (error: unknown) => error,
    )
  await f.entered
  controller.abort()
  expect(await result).toBeInstanceOf(Error)
  expect(f.closed).toHaveBeenCalled()
  expect(f.server.requests.some((one) => one.method === 'thread/start')).toBe(false)
  expect(readFileSync(join(f.home, 'auth.json'), 'utf8')).toBe(f.original)
})

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()))
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function record(provider: Provider, method: 'sign-in' | 'api-key'): ProviderConnection {
  return {
    id: `${provider}:${method}`,
    provider,
    name: method === 'sign-in' ? 'subscription' : 'API key',
    authMethod: method,
    credentialSource: method === 'api-key' ? 'provider-api-key' : 'provider-sign-in',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  }
}

function fixture(provider: Provider) {
  let current = record(provider, 'sign-in')
  const resolve = vi.fn(() => current)
  const key = vi.fn(() => {
    throw new Error('No credential read in a composition test')
  })
  const modules = createProviderModules(
    (one) => ({
      managedRoot: '/fictional/homes',
      defaultProfile: 'fern',
      homeOf: (profile) => `/fictional/${profile}/${one}`,
      profiles: () => ['fern'],
      assertMayOpen: () => {},
    }),
    {
      claude: { runtime: { program: () => '/fictional/claude', key }, home: {}, auth: {} },
      codex: {
        runtime: { command: () => '/fictional/codex' },
        home: {},
        auth: { command: () => '/fictional/codex' },
      },
    },
    () => ({ list: () => [current], resolve }),
  )
  const selected = modules[provider].connections!.resolve()
  return {
    runtime: modules[provider].createRuntime(),
    resolve,
    key,
    selected,
    change: () => {
      current = record(provider, 'api-key')
    },
  }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: constructs the concrete adapter without a connection runtime wrapper`, () => {
    const f = fixture(provider)
    expect(f.runtime).toBeInstanceOf(provider === 'claude' ? ClaudeRuntime : CodexRuntime)
    expect(f.resolve).toHaveBeenCalledTimes(1)
    expect(f.key).not.toHaveBeenCalled()
  })

  it(`${provider}: forwards the original handle and allocation callback after metadata changes`, async () => {
    const f = fixture(provider)
    const raw = await new FakeRuntime(provider).start({
      cwd: '/fictional/fern',
      providerHome: '/fictional/state',
    })
    handles.push(raw)
    const start = vi.spyOn(f.runtime, 'start').mockImplementation(async (options) => {
      f.change()
      options.onSessionCreated?.(raw)
      return raw
    })
    const callback = vi.fn()
    const options = {
      cwd: '/fictional/fern',
      providerHome: '/fictional/state',
      onSessionCreated: callback,
    }
    const handle = await f.runtime.start(options)
    expect(handle).toBe(raw)
    expect(callback).toHaveBeenCalledExactlyOnceWith(raw)
    expect(start).toHaveBeenCalledExactlyOnceWith(options)
    expect(f.resolve).toHaveBeenCalledTimes(1)
    expect(handle).not.toHaveProperty('connectionId')
    expect(f.selected.authMethod).toBe('sign-in')
  })

  it(`${provider}: forwards model results and native failures without re-resolving metadata`, async () => {
    const f = fixture(provider)
    const models = [{ id: 'fictional-small', label: 'Small' }]
    const context = { providerHome: '/fictional/state' }
    const list = vi.spyOn(f.runtime, 'listModels').mockImplementation(async () => {
      f.change()
      return models
    })
    expect(await f.runtime.listModels(context)).toBe(models)
    expect(list).toHaveBeenCalledExactlyOnceWith(context)
    const failure = new Error('fictional native model error')
    list.mockRejectedValueOnce(failure)
    await expect(f.runtime.listModels(context)).rejects.toBe(failure)
    expect(f.resolve).toHaveBeenCalledTimes(1)
  })

  it(`${provider}: preserves the native typed resume refusal and its thread identity`, async () => {
    const f = fixture(provider)
    const ref: SessionRef = {
      provider,
      sessionId: 'fictional-old',
      cwd: '/fictional/original',
      rotation: 0,
    }
    const refusal = new ResumeError(ref, 'fictional missing rollout', { noSuchSession: true })
    const resume = vi.spyOn(f.runtime, 'resume').mockRejectedValueOnce(refusal)
    const context = { providerHome: '/fictional/state' }
    await expect(f.runtime.resume(ref, context)).rejects.toBe(refusal)
    expect(resume).toHaveBeenCalledExactlyOnceWith(ref, context)
    expect(refusal.noSuchSession).toBe(true)
    expect(f.resolve).toHaveBeenCalledTimes(1)
  })

  it(`${provider}: a pre-cancelled start and foreign transcript stay native pre-launch refusals`, async () => {
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
    await expect(
      f.runtime.resume(
        {
          provider: provider === 'claude' ? 'codex' : 'claude',
          sessionId: 'fictional-old',
          cwd: '/fictional/original',
          rotation: 0,
        },
        { providerHome: '/fictional/state' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
    expect(f.key).not.toHaveBeenCalled()
  })

  it(`${provider}: preserves an allocated native refusal and actual exit proof without replacement`, async () => {
    const f = fixture(provider)
    const handle = await new FakeRuntime(provider).start({
      cwd: '/fictional/fern',
      providerHome: '/fictional/state',
    })
    handles.push(handle)
    let finish!: () => void
    const exit = new Promise<void>((resolve) => {
      finish = resolve
    })
    Object.defineProperty(handle, 'awaitProcessExit', { value: () => exit })
    const refused = new RejectedSessionLaunch(
      new Error('fictional handshake refusal'),
      handle,
      handle.close(),
    )
    vi.spyOn(f.runtime, 'start').mockImplementation(async (options) => {
      options.onSessionCreated?.(handle)
      throw refused
    })
    const callback = vi.fn()
    try {
      await expect(
        f.runtime.start({
          cwd: '/fictional/fern',
          providerHome: '/fictional/state',
          onSessionCreated: callback,
        }),
      ).rejects.toBe(refused)
      expect(callback).toHaveBeenCalledExactlyOnceWith(handle)
      expect(refused.processExit).toBe(exit)
      let exited = false
      void refused.terminated.then(() => {
        exited = true
      })
      await Promise.resolve()
      expect(exited).toBe(false)
      finish()
      await refused.terminated
      expect(exited).toBe(true)
    } finally {
      finish()
    }
  })
}

it('exposes the native recovery capability without lazy factory state', () => {
  const f = fixture('codex')
  expect(f.runtime.canRecreateMissingUnusedSession).toBe(true)
  expect(f.runtime).toBeInstanceOf(CodexRuntime)
  expect(f.resolve).toHaveBeenCalledTimes(1)
})

it('native start allocation keeps aggregate cleanup pending until actual exit', async () => {
  const raw = new FakeRuntime('codex')
  Object.defineProperty(raw, 'canRecreateMissingUnusedSession', { value: true })
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
  let reads = 0
  const route = {
    name: 'plugin-chrome',
    pluginId: 'chrome',
    url: 'http://127.0.0.1:8123/mcp',
    capability: 'a'.repeat(64),
  }
  const wrapped = withManagedPluginAttachments(raw, {
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
