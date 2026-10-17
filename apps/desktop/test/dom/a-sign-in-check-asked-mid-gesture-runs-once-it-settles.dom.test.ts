import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  forgetProfileSignIns,
  useProfileSignIn,
} from '../../src/renderer/src/composables/useProfileSignIn'

/**
 * # A profile's sign-in gestures · a check asked while another gesture is out runs once it settles
 *
 * `useProfileSignIn` runs one gesture at a time per provider and profile. A check asked while
 * another gesture is out is not dropped: it runs once that gesture settles. Every gesture that is
 * not a check checks after it, and a check alone does not check again.
 *
 * | § | what it pins | why the existing tests do not reach it |
 * |---|---|---|
 * | 1 | a check asked during a check runs once more after it; a lone check runs once | the Providers card's tests pin the card's own copy of this rule, not this composable's |
 * | 2 | a check asked during a sign-in is not run then, and the sign-in's own check runs after it | same |
 */

const PROFILE = 'bakery-builder'
const STALE = { state: 'stale', reason: 'The test sign-in has expired.' } as const
const USABLE = { state: 'usable', login: 'a test account', expiresAt: null } as const

/** A promise the test settles by hand. */
function aGate<T>(): { promise: Promise<T>; open: (value: T) => void } {
  let open: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

const settled = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}

afterEach(() => {
  forgetProfileSignIns()
  delete (window as unknown as { api?: unknown }).api
})

describe('§1 · a check asked during a check', () => {
  it('⚑ a lone check asks main once; ⛔ a check asked while one is out is not dropped: main is asked once more after it', async () => {
    let first = aGate<typeof STALE>()
    const runtime = {
      checkProviderAuth: vi.fn(() => first.promise),
    }
    ;(window as unknown as { api: unknown }).api = { runtime }

    const lone = useProfileSignIn('codex', PROFILE)
    first.open(STALE)
    await lone.check()
    await settled()
    expect(runtime.checkProviderAuth).toHaveBeenCalledTimes(1)
    expect(lone.auth).toEqual(STALE)

    forgetProfileSignIns()
    runtime.checkProviderAuth.mockClear()
    first = aGate<typeof STALE>()
    const one = useProfileSignIn('codex', PROFILE)
    const out = one.check()
    await settled()
    expect(one.busy).toBe('checking')
    await one.check()
    expect(runtime.checkProviderAuth).toHaveBeenCalledTimes(1)

    first.open(STALE)
    await out
    await settled()
    expect(runtime.checkProviderAuth).toHaveBeenCalledTimes(2)
    expect(one.busy).toBe('idle')
  })
})

describe('§2 · a check asked during a sign-in', () => {
  it('⛔ not run while the sign-in is out; ⚑ main is asked once the sign-in settles', async () => {
    const signedIn = aGate<{ success: boolean; state: typeof USABLE; detail: null }>()
    const runtime = {
      checkProviderAuth: vi.fn(async () => USABLE),
      signInProvider: vi.fn(() => signedIn.promise),
    }
    ;(window as unknown as { api: unknown }).api = { runtime }

    const one = useProfileSignIn('codex', PROFILE)
    const out = one.signIn()
    await settled()
    expect(one.busy).toBe('signing-in')
    await one.check()
    expect(runtime.checkProviderAuth).not.toHaveBeenCalled()

    signedIn.open({ success: true, state: USABLE, detail: null })
    await out
    await settled()
    expect(runtime.checkProviderAuth).toHaveBeenCalledTimes(1)
    expect(runtime.checkProviderAuth).toHaveBeenCalledWith({
      provider: 'codex',
      profileId: PROFILE,
    })
    expect(one.busy).toBe('idle')
  })
})
