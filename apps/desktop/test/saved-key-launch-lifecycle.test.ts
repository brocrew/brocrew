import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FakeRuntime,
  untilCancelled,
  type CodexIncoming,
  type CodexTransport,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { ApiKeys } from '../src/main/runtime/api-keys'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { codexDesktopInputs } from '../src/main/providers/codex/desktop'
import { bringTheCodexKeyTo, codexModuleFactory } from '../src/main/providers/codex'
import { fixtureProviderConfig, neutralHostDeps, RecordingSink } from './lib/host-fixture'

function pendingKey(provider: Provider) {
  let answer!: (key: string) => void
  const native = new Promise<string>((resolve) => {
    answer = resolve
  })
  const open = vi.fn(() => native)
  const keys = new ApiKeys(
    {
      keptApiKey: (of) => (of === provider ? { sealed: 'fictional-seal', setAt: 1 } : null),
      keepSealedApiKey: () => {},
      forgetApiKey: () => false,
    },
    { available: () => true, seal: () => 'fictional-seal', open },
    Date.now,
    'darwin',
  )
  const runtime = new FakeRuntime(provider)
  const started = vi.spyOn(runtime, 'start')
  const listed = vi.spyOn(runtime, 'listModels')
  let homesCompleted = 0
  const host = new RuntimeHost({
    store: NULL_SESSION_STORE,
    ...neutralHostDeps(() => '/fictional-user-data'),
    createRuntime: () => runtime,
    prepareProviderHome: async (of, _profile, signal) => {
      await untilCancelled(keys.read(of), signal, 'reading a fictional key')
      homesCompleted += 1
      return join('/fictional-user-data', 'provider-homes', of)
    },
    providerHomePath: (of) => join('/fictional-user-data', 'provider-homes', of),
    resolveCwd: (_session, requested) => requested ?? '/fictional-work',
    newSessionId: () => 'sess_fictional-pending-key',
    readProviderConfig: fixtureProviderConfig,
    apiKeys: keys,
    closeDrainTimeoutMs: 40,
  })
  return {
    host,
    keys,
    open,
    started,
    listed,
    homesCompleted: () => homesCompleted,
    answer: () => answer('fictional-readable-key'),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function codexPreparation(holdKey: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'fictional-home-cancellation-'))
  const home = join(root, 'codex')
  const key = deferred<string>()
  const login = deferred<unknown>()
  const cleanup = deferred<void>()
  const open = vi.fn(() => (holdKey ? key.promise : Promise.resolve('fictional-key')))
  const keys = new ApiKeys(
    {
      keptApiKey: () => ({ sealed: 'fictional-seal', setAt: 1 }),
      keepSealedApiKey: () => {},
      forgetApiKey: () => false,
    },
    { available: () => true, seal: () => 'fictional-seal', open },
    Date.now,
    'darwin',
  )
  const wire: CodexTransport = {
    request: vi.fn(async (method) => {
      if (method === 'initialize') return { codexHome: home }
      if (method === 'account/login/start') return login.promise
      if (method === 'getAuthStatus') return { authMethod: 'apikey' }
      return {}
    }),
    notify: () => {},
    respond: () => {},
    respondError: () => {},
    incoming: async function* (): AsyncIterable<CodexIncoming> {
      yield* []
    },
    close: vi.fn(() => {
      login.reject(new Error('fictional child stopped'))
      return cleanup.promise
    }),
  }
  const transport = vi.fn(() => wire)
  const inputs = codexDesktopInputs(
    {
      isPackaged: false,
      resourcesPath: root,
      platform: 'darwin',
      arch: 'arm64',
      managedRoot: root,
      signal: new AbortController().signal,
      commandLine: { hasSwitch: () => false, getSwitchValue: () => '' },
      keys,
    },
    {
      resolveProgram: () => ({ path: '/fictional/codex', from: 'carried' }),
      transportFactory: () => transport,
    },
  )
  const strategy = codexModuleFactory.home(
    {
      managedRoot: root,
      defaultProfile: DEFAULT_PROFILE_ID,
      homeOf: () => home,
      profiles: () => [],
      assertMayOpen: () => {},
    },
    {
      ...inputs.home,
      provisionHome: (_root, target) => {
        mkdirSync(target, { recursive: true })
      },
    },
  )
  const runtime = new FakeRuntime('codex')
  const started = vi.spyOn(runtime, 'start')
  const listed = vi.spyOn(runtime, 'listModels')
  const host = new RuntimeHost({
    store: NULL_SESSION_STORE,
    ...neutralHostDeps(() => root),
    createRuntime: () => runtime,
    prepareProviderHome: (_provider, profile, signal) => strategy.prepare(profile, signal),
    providerHomePath: () => home,
    resolveCwd: (_session, requested) => requested ?? root,
    newSessionId: () => 'sess_fictional-actual-home',
    readProviderConfig: fixtureProviderConfig,
    apiKeys: keys,
    closeDrainTimeoutMs: 40,
  })
  return {
    host,
    strategy,
    home,
    keys,
    open,
    transport,
    wire,
    started,
    listed,
    login,
    cleanup,
    key,
    dispose: async () => {
      key.resolve('fictional-key')
      login.resolve({})
      cleanup.resolve()
      await vi.advanceTimersByTimeAsync(0)
      await host.closeAll()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

describe.each(['Quit', 'Stop'] as const)('actual Codex home preparation on %s', (action) => {
  function start(fixture: ReturnType<typeof codexPreparation>) {
    if (action === 'Quit') return fixture.host.providerModels(DEFAULT_PROFILE_ID, 'codex')
    return fixture.host
      .createSession(
        { provider: 'codex', cwd: fixture.home, launchKey: 'launch:actual-home' },
        new RecordingSink('window:actual-home'),
      )
      .catch((error: unknown) => error)
  }
  async function stop(fixture: ReturnType<typeof codexPreparation>) {
    if (action === 'Quit') fixture.host.recordOpenForQuit()
    else
      expect(await fixture.host.cancelLaunch('launch:actual-home', 'window:actual-home')).toBe(true)
  }

  it('does not start credential work when the shared native read answers after cancellation', async () => {
    vi.useFakeTimers()
    const fixture = codexPreparation(true)
    const outcome = start(fixture)
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(fixture.open).toHaveBeenCalledTimes(1)
      const shared = fixture.keys.current('codex')
      await stop(fixture)
      await vi.advanceTimersByTimeAsync(0)
      await outcome
      await fixture.host.closeAll()
      expect(fixture.open).toHaveBeenCalledTimes(1)
      fixture.key.resolve('fictional-key')
      expect(await shared).toEqual({ key: 'fictional-key', setAt: 1 })
      await vi.advanceTimersByTimeAsync(0)
      expect(fixture.transport).not.toHaveBeenCalled()
      expect(existsSync(join(fixture.home, 'brobot-api-key-login.json'))).toBe(false)
      expect(fixture.started).not.toHaveBeenCalled()
      expect(fixture.listed).not.toHaveBeenCalled()
    } finally {
      await fixture.dispose()
      await outcome
    }
  })

  it('keeps an already-started credential child owned until its cleanup settles', async () => {
    vi.useFakeTimers()
    const fixture = codexPreparation(false)
    const outcome = start(fixture)
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(fixture.wire.request).toHaveBeenCalledWith('account/login/start', {
        type: 'apiKey',
        apiKey: 'fictional-key',
      })
      await stop(fixture)
      let closed = false
      const closing = fixture.host.closeAll().then(() => {
        closed = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(fixture.wire.close).toHaveBeenCalled()
      expect(closed).toBe(false)
      fixture.cleanup.resolve()
      await vi.advanceTimersByTimeAsync(0)
      await closing
      await outcome
      expect(existsSync(join(fixture.home, 'brobot-api-key-login.json'))).toBe(false)
      expect(fixture.started).not.toHaveBeenCalled()
      expect(fixture.listed).not.toHaveBeenCalled()
    } finally {
      await fixture.dispose()
      await outcome
    }
  })
})

it('cancels a queued home subscriber without releasing the preceding credential operation', async () => {
  vi.useFakeTimers()
  const fixture = codexPreparation(false)
  const firstAbort = new AbortController()
  const queuedAbort = new AbortController()
  const first = fixture.strategy
    .prepare(DEFAULT_PROFILE_ID, firstAbort.signal)
    .catch((error: unknown) => error)
  let queued: unknown = 'pending'
  const second = fixture.strategy.prepare(DEFAULT_PROFILE_ID, queuedAbort.signal).then(
    (value) => {
      queued = value
    },
    (error: unknown) => {
      queued = error
    },
  )
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.transport).toHaveBeenCalledTimes(1)
    queuedAbort.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(queued).toBeInstanceOf(Error)
    const thirdAbort = new AbortController()
    const third = fixture.strategy
      .prepare(DEFAULT_PROFILE_ID, thirdAbort.signal)
      .catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.transport).toHaveBeenCalledTimes(1)
    thirdAbort.abort()
    firstAbort.abort()
    fixture.cleanup.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all([first, second, third])
    expect(fixture.transport).toHaveBeenCalledTimes(1)
    expect(existsSync(join(fixture.home, 'brobot-api-key-login.json'))).toBe(false)
  } finally {
    await fixture.dispose()
    await Promise.all([first, second])
  }
})

describe.each(['claude', 'codex'] as const)('pending %s saved-key launches', (provider) => {
  it('quit releases model-home preparation even when the native read still has no answer', async () => {
    vi.useFakeTimers()
    const fixture = pendingKey(provider)
    let result: unknown = 'pending'
    const listing = fixture.host.providerModels(DEFAULT_PROFILE_ID, provider).then((value) => {
      result = value
      return value
    })
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(fixture.open).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(180_000)
      expect(result).toBe('pending')
      expect(fixture.keys.status(provider)).not.toHaveProperty('unreadableReason')
      expect(fixture.homesCompleted()).toBe(0)
      expect(fixture.listed).not.toHaveBeenCalled()

      fixture.host.recordOpenForQuit()
      await vi.advanceTimersByTimeAsync(0)
      expect(result).toEqual({ ok: false, reason: 'closing' })
      let closed = false
      const closing = fixture.host.closeAll().then(() => {
        closed = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(closed).toBe(true)
      expect(fixture.homesCompleted()).toBe(0)
      expect(fixture.open).toHaveBeenCalledTimes(1)
      await closing
    } finally {
      fixture.answer()
      await vi.advanceTimersByTimeAsync(0)
      await listing
      await fixture.host.closeAll()
      expect(fixture.listed).not.toHaveBeenCalled()
      expect(fixture.started).not.toHaveBeenCalled()
    }
  })

  it('Stop cancels the conversation waiting for the key without starting a late provider', async () => {
    vi.useFakeTimers()
    const fixture = pendingKey(provider)
    const sink = new RecordingSink('window:fictional')
    const outcome = fixture.host
      .createSession({ provider, cwd: '/fictional-work', launchKey: 'launch:fictional' }, sink)
      .then(
        () => 'opened',
        (error: unknown) => error,
      )
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(fixture.open).toHaveBeenCalledTimes(1)
      expect(fixture.started).not.toHaveBeenCalled()
      expect(await fixture.host.cancelLaunch('launch:fictional', sink.ownerId)).toBe(true)
      expect(await outcome).toBeInstanceOf(Error)
      expect(fixture.host.sessionIds).toEqual([])
      expect(fixture.homesCompleted()).toBe(0)
    } finally {
      fixture.answer()
      await vi.advanceTimersByTimeAsync(0)
      await outcome
      await fixture.host.closeAll()
      expect(fixture.started).not.toHaveBeenCalled()
    }
  })
})

it('does not enter home preparation for an already-canceled owner', async () => {
  vi.useFakeTimers()
  const fixture = codexPreparation(true)
  const abort = new AbortController()
  abort.abort()
  const outcome = fixture.strategy
    .prepare(DEFAULT_PROFILE_ID, abort.signal)
    .catch((error: unknown) => error)
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.open).not.toHaveBeenCalled()
    expect(existsSync(fixture.home)).toBe(false)
    expect(await outcome).toBeInstanceOf(Error)
  } finally {
    await fixture.dispose()
    await outcome
  }
})

it('handles a native rejection after Quit without reviving the canceled preparation', async () => {
  vi.useFakeTimers()
  const fixture = codexPreparation(true)
  const outcome = fixture.host.providerModels(DEFAULT_PROFILE_ID, 'codex')
  try {
    await vi.advanceTimersByTimeAsync(0)
    const shared = fixture.keys.current('codex').catch((error: unknown) => error)
    fixture.host.recordOpenForQuit()
    await vi.advanceTimersByTimeAsync(0)
    expect(await outcome).toEqual({ ok: false, reason: 'closing' })
    fixture.key.reject(new Error('fictional native read failure'))
    expect(await shared).toBeInstanceOf(Error)
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.transport).not.toHaveBeenCalled()
    expect(fixture.listed).not.toHaveBeenCalled()
    expect(fixture.keys.status('codex').readState).toBe('unreadable')
  } finally {
    await fixture.dispose()
    await outcome
  }
})

it('lets an uncanceled home owner receive the same native read after another owner stops', async () => {
  vi.useFakeTimers()
  const fixture = codexPreparation(true)
  const abort = new AbortController()
  let firstResult: unknown = 'pending'
  const first = fixture.strategy
    .prepare(DEFAULT_PROFILE_ID, abort.signal)
    .catch((error: unknown) => error)
  void first.then((value) => {
    firstResult = value
  })
  const second = fixture.strategy.prepare(DEFAULT_PROFILE_ID)
  try {
    await vi.advanceTimersByTimeAsync(0)
    abort.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(firstResult).toBeInstanceOf(Error)
    expect(fixture.open).toHaveBeenCalledTimes(1)
    fixture.key.resolve('fictional-key')
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.transport).toHaveBeenCalledTimes(1)
    fixture.login.resolve({})
    fixture.cleanup.resolve()
    expect(await second).toBe(fixture.home)
    expect(existsSync(join(fixture.home, 'brobot-api-key-login.json'))).toBe(true)
    expect(fixture.open).toHaveBeenCalledTimes(1)
  } finally {
    await fixture.dispose()
    await Promise.all([first, second])
  }
})

it.each(['current-stamp', 'no-key'] as const)(
  'cancellation prevents the %s continuation',
  async (kind) => {
    vi.useFakeTimers()
    const home = mkdtempSync(join(tmpdir(), 'fictional-cancel-before-stamp-'))
    const read = deferred<{ key: string; setAt: number } | null>()
    const change = vi.fn(async () => ({ ok: true as const, authMethod: 'apikey' }))
    writeFileSync(join(home, 'auth.json'), '{}', { mode: 0o600 })
    writeFileSync(join(home, 'brobot-api-key-login.json'), '{"setAt":1}\n', { mode: 0o600 })
    const abort = new AbortController()
    let result: unknown = 'pending'
    const outcome = bringTheCodexKeyTo(
      home,
      { current: () => read.promise, change },
      abort.signal,
    ).then(
      (value) => {
        result = value
      },
      (error: unknown) => {
        result = error
      },
    )
    try {
      await vi.advanceTimersByTimeAsync(0)
      abort.abort()
      await vi.advanceTimersByTimeAsync(0)
      expect(result).toBeInstanceOf(Error)
      read.resolve(kind === 'no-key' ? null : { key: 'fictional-key', setAt: 1 })
      await vi.advanceTimersByTimeAsync(0)
      await outcome
      expect(change).not.toHaveBeenCalled()
      expect(existsSync(join(home, 'brobot-api-key-login.json'))).toBe(true)
    } finally {
      read.resolve(null)
      await outcome
      rmSync(home, { recursive: true, force: true })
    }
  },
)

it('does not stamp a key-change result that arrives after its owner canceled', async () => {
  vi.useFakeTimers()
  const home = mkdtempSync(join(tmpdir(), 'fictional-cancel-after-change-'))
  const changed = deferred<{ ok: true; authMethod: string }>()
  const change = vi.fn(() => changed.promise)
  const abort = new AbortController()
  const outcome = bringTheCodexKeyTo(
    home,
    {
      current: () => ({ key: 'fictional-key', setAt: 1 }),
      change,
    },
    abort.signal,
  ).catch((error: unknown) => error)
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(change).toHaveBeenCalledTimes(1)
    abort.abort()
    changed.resolve({ ok: true, authMethod: 'apikey' })
    expect(await outcome).toBeInstanceOf(Error)
    expect(existsSync(join(home, 'brobot-api-key-login.json'))).toBe(false)
  } finally {
    changed.resolve({ ok: true, authMethod: 'apikey' })
    await outcome
    rmSync(home, { recursive: true, force: true })
  }
})

it.each([true, false])(
  'fallback provisioning preserves cancellation=%s through completion',
  async (cancel) => {
    vi.useFakeTimers()
    const root = mkdtempSync(join(tmpdir(), 'fictional-fallback-cancellation-'))
    const home = join(root, 'codex')
    const provisioned = deferred<void>()
    const steps: string[] = []
    const abort = new AbortController()
    const strategy = codexModuleFactory.home(
      {
        managedRoot: root,
        defaultProfile: DEFAULT_PROFILE_ID,
        homeOf: () => home,
        profiles: () => [],
        assertMayOpen: () => {},
      },
      {
        key: { current: () => null, change: async () => ({ ok: true, authMethod: null }) },
        provisionHome: (_root, target) => {
          mkdirSync(target, { recursive: true })
        },
        provisionCodexAuth: async () => {
          steps.push('started')
          await provisioned.promise
          steps.push('finished')
        },
      },
    )
    const outcome = strategy
      .prepare(DEFAULT_PROFILE_ID, abort.signal)
      .catch((error: unknown) => error)
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(steps).toEqual(['started'])
      if (cancel) abort.abort()
      provisioned.resolve()
      const result = await outcome
      expect(steps).toEqual(['started', 'finished'])
      if (cancel) expect(result).toBeInstanceOf(Error)
      else expect(result).toBe(home)
    } finally {
      provisioned.resolve()
      await outcome
      rmSync(root, { recursive: true, force: true })
    }
  },
)
