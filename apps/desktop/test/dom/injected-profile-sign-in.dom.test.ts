import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, provide } from 'vue'
import type { ClientProviderApi } from '../../src/shared/client-provider-api'
import type { AuthState, ProviderSignInResult } from '../../src/shared/runtime-ipc'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import {
  forgetProfileSignIns,
  signInFact,
  useProfileSignIn,
  type ProfileSignIn,
} from '../../src/renderer/src/composables/useProfileSignIn'
import { createSignInGesture } from '../../src/renderer/src/lib/sign-in-gesture'
import { providersBridge } from '../../look/fixtures/providers'
import { mount, unmountAll } from './harness'

const pair = { provider: 'codex' as const, profileId: 'fern-worker' }
const usable: AuthState = { state: 'usable', login: 'account', expiresAt: null }
const absent: AuthState = { state: 'absent', reason: 'Fictional raw transport.' }

function client() {
  providersBridge()
  const raw = vi.spyOn(window.api.runtime, 'checkProviderAuth').mockResolvedValue(absent)
  const transport = {
    ...window.api.runtime,
    checkProviderAuth: vi.fn<ClientProviderApi['checkProviderAuth']>(async function (this: object) {
      expect(this).toBe(transport)
      return usable
    }),
    signInProvider: vi.fn<ClientProviderApi['signInProvider']>(async function (this: object) {
      expect(this).toBe(transport)
      return { success: true, state: usable }
    }),
    reprovisionProviderAuth: vi.fn<ClientProviderApi['reprovisionProviderAuth']>(async function (
      this: object,
    ) {
      expect(this).toBe(transport)
      return 'replaced'
    }),
    cancelProviderSignIn: vi.fn<ClientProviderApi['cancelProviderSignIn']>(async function (
      this: object,
    ) {
      expect(this).toBe(transport)
    }),
  }
  const api = createDesktopProviderApi(
    () => transport,
    () => undefined,
  )
  return { api, transport, raw }
}

function reader(api: ClientProviderApi, profileId = pair.profileId): ProfileSignIn {
  let answer!: ProfileSignIn
  const Child = defineComponent({
    setup() {
      answer = useProfileSignIn(pair.provider, profileId)
      return () => h('p', answer.auth?.state ?? 'unread')
    },
  })
  mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(Child)
      },
    }),
    {},
  )
  return answer
}

afterEach(() => {
  unmountAll()
  forgetProfileSignIns()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

describe('profile sign-in through the supplied provider client', () => {
  it('uses injected operations and their receiver even when the window gives the opposite answer', async () => {
    const { api, transport, raw } = client()
    const one = reader(api)
    await one.check()
    expect(one.auth).toEqual(usable)
    expect(transport.checkProviderAuth).toHaveBeenCalledExactlyOnceWith(pair)
    expect(raw).not.toHaveBeenCalled()
    await one.copyMachineSignIn()
    await vi.waitFor(() => expect(one.busy).toBe('idle'))
    expect(transport.reprovisionProviderAuth).toHaveBeenCalledExactlyOnceWith(pair)
    expect(one.notice).toBe('Copied your machine sign-in into this profile.')
    expect(transport.checkProviderAuth).toHaveBeenCalledTimes(2)
    transport.reprovisionProviderAuth.mockResolvedValueOnce('unchanged')
    await one.copyMachineSignIn()
    expect(one.notice).toBe(
      'Your machine sign-in is the same as this profile’s, so nothing changed.',
    )
    await vi.waitFor(() => expect(one.busy).toBe('idle'))
    transport.reprovisionProviderAuth.mockRejectedValueOnce(new Error('Fictional copy failed.'))
    await one.copyMachineSignIn()
    await vi.waitFor(() => expect(one.busy).toBe('idle'))
    expect(one.notice).toBe('Fictional copy failed.')
    expect(transport.checkProviderAuth).toHaveBeenCalledTimes(4)
    expect(raw).not.toHaveBeenCalled()
  })

  it('keeps the newest ticket when a second injected surface signs in before an older check answers', async () => {
    const { api, transport } = client()
    let finish!: (answer: AuthState) => void
    transport.checkProviderAuth.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const profile = reader(api)
    const old = profile.check()
    const launcher = createSignInGesture({
      pair: () => pair,
      bridge: () => api,
      fact: (asked) => signInFact(asked, api),
      words: { signedIn: () => 'Fictional sign-in finished.', unchanged: 'Same.' },
      checkWhileBusy: 'drop',
    })
    await launcher.signIn()
    expect(profile.auth).toEqual(usable)
    finish(absent)
    await old
    expect(profile.auth).toEqual(usable)
    expect(launcher.auth).toEqual(usable)
  })

  it('shares held identity per client and pair, without letting the first client capture later injection', async () => {
    const first = client()
    const second = client()
    second.transport.checkProviderAuth.mockResolvedValue(absent)
    const one = reader(first.api)
    expect(reader(first.api)).toBe(one)
    expect(reader(first.api, 'other-fern')).not.toBe(one)
    const other = reader(second.api)
    expect(other).not.toBe(one)
    await one.check()
    await other.check()
    expect(one.auth).toEqual(usable)
    expect(other.auth).toEqual(absent)
  })

  it('keeps cancel and a held check on the same gesture, then asks once after sign-in', async () => {
    const { api, transport, raw } = client()
    let finish!: (result: ProviderSignInResult) => void
    transport.signInProvider.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const one = reader(api)
    const signing = one.signIn()
    expect(one.busy).toBe('signing-in')
    await one.check()
    expect(transport.checkProviderAuth).not.toHaveBeenCalled()
    await one.cancel()
    expect(transport.cancelProviderSignIn).toHaveBeenCalledExactlyOnceWith(pair)
    finish({ success: true, state: usable })
    await signing
    await vi.waitFor(() => expect(one.busy).toBe('idle'))
    expect(one.notice).toBe('Signed in. This profile has its own sign-in again.')
    expect(one.auth).toEqual(usable)
    expect(transport.checkProviderAuth).toHaveBeenCalledExactlyOnceWith(pair)
    expect(raw).not.toHaveBeenCalled()
  })
})
