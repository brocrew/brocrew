import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { ApiKeys } from '../src/main/runtime/api-keys'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
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
    prepareProviderHome: async (of) => {
      await keys.read(of)
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
      .then(() => 'opened', (error: unknown) => error)
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
