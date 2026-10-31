import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROFILE_ID, type RuntimeBridge } from '../src/shared/runtime-ipc'
import { createProviderAccess } from '../src/renderer/src/lib/provider-access'

function fixture() {
  const runtime = {
    checkProviderAuth: vi.fn<RuntimeBridge['checkProviderAuth']>(async () => ({
      state: 'usable',
      login: 'account',
      expiresAt: null,
    })),
    apiKeyStatus: vi.fn<RuntimeBridge['apiKeyStatus']>(async () => ({
      provider: 'claude',
      set: false,
      setAt: null,
      inUse: false,
    })),
  }
  const changed = vi.fn()
  return {
    runtime,
    changed,
    access: createProviderAccess(
      () => 'claude',
      changed,
      () => runtime,
    ),
  }
}
describe('the list and provider controls share one serialized login reading', () => {
  it('only an explicit probe sends the probe flag', async () => {
    const { access, runtime } = fixture()
    await access.check(true)
    expect(runtime.checkProviderAuth).toHaveBeenCalledExactlyOnceWith({
      provider: 'claude',
      profileId: DEFAULT_PROFILE_ID,
      probe: true,
    })
  })

  it('retains an explicit probe queued behind a passive reading', async () => {
    const { access, runtime } = fixture()
    let release!: (value: Awaited<ReturnType<RuntimeBridge['checkProviderAuth']>>) => void
    runtime.checkProviderAuth.mockImplementationOnce(
      () =>
        new Promise((done) => {
          release = done
        }),
    )
    const first = access.check()
    await access.check(true)
    expect(runtime.checkProviderAuth).toHaveBeenCalledTimes(1)
    release({ state: 'usable', login: 'account', expiresAt: null })
    await first
    await vi.waitFor(() => expect(runtime.checkProviderAuth).toHaveBeenCalledTimes(2))
    expect(runtime.checkProviderAuth.mock.calls[0]?.[0]).toEqual({
      provider: 'claude',
      profileId: DEFAULT_PROFILE_ID,
    })
    expect(runtime.checkProviderAuth).toHaveBeenLastCalledWith({
      provider: 'claude',
      profileId: DEFAULT_PROFILE_ID,
      probe: true,
    })
  })
  it('sends plain provider/profile arguments and shares the returned readings', async () => {
    const { runtime, changed, access } = fixture()
    await Promise.all([access.check(), access.readKey()])
    expect(runtime.checkProviderAuth).toHaveBeenCalledExactlyOnceWith({
      provider: 'claude',
      profileId: DEFAULT_PROFILE_ID,
    })
    expect(runtime.apiKeyStatus).toHaveBeenCalledExactlyOnceWith({ provider: 'claude' })
    expect(access.auth.value).toMatchObject({ state: 'usable', login: 'account' })
    expect(access.keyStatus.value).toMatchObject({ set: false })
    expect(changed).not.toHaveBeenCalled()
  })
  it('coalesces login notices received during a gesture into one check after it settles', async () => {
    const { runtime, changed, access } = fixture()
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const copying = access.withGesture('copying', () => held)
    await access.check()
    await access.check()
    expect(access.authBusy.value).toBe('copying')
    expect(runtime.checkProviderAuth).not.toHaveBeenCalled()
    release()
    await copying
    await vi.waitFor(() => expect(access.authBusy.value).toBe('idle'))
    expect(runtime.checkProviderAuth).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledTimes(1)
  })
  it('admits no second gesture while one is out, even if it later fails', async () => {
    const { changed, access } = fixture()
    let reject!: (error: Error) => void
    const held = new Promise<void>((_resolve, fail) => {
      reject = fail
    })
    const first = access.withGesture('signing-in', () => held)
    const outcome = first.catch((error: unknown) => error)
    const second = vi.fn(async () => {})
    await access.withGesture('copying', second)
    expect(second).not.toHaveBeenCalled()
    reject(new Error('Fictional sign-in failed.'))
    expect(await outcome).toBeInstanceOf(Error)
    expect(access.authBusy.value).toBe('idle')
    expect(changed).toHaveBeenCalledTimes(1)
  })
  it('keeps the last key status while recording a failed refresh', async () => {
    const { runtime, access } = fixture()
    await access.readKey()
    const previous = access.keyStatus.value
    runtime.apiKeyStatus.mockRejectedValueOnce(new Error('Fictional key status unavailable.'))
    await access.readKey()
    expect(access.keyStatus.value).toBe(previous)
    expect(access.keyError.value).toBe('Fictional key status unavailable.')
    await access.readKey()
    expect(access.keyError.value).toBeNull()
  })
  it('reports an unknown login when the bridge check fails', async () => {
    const { runtime, access } = fixture()
    runtime.checkProviderAuth.mockRejectedValueOnce(new Error('Fictional service unavailable.'))
    await access.check()
    expect(access.auth.value).toEqual({
      state: 'unknown',
      reason: 'Fictional service unavailable.',
    })
    expect(access.authBusy.value).toBe('idle')
  })
})
