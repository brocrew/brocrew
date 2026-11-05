import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import {
  createSignInGesture,
  type SignInFact,
  type SignInPair,
} from '../src/renderer/src/lib/sign-in-gesture'
import type { AuthState, ProviderSignInResult } from '../src/shared/runtime-ipc'

/**
 * # An older check never undoes a newer sign-in
 *
 * Two surfaces sign one profile in through their own gestures and share what each learns. Their
 * gestures do not wait for each other, and the host answers a check whenever it is asked, so a check
 * asked before a sign-in finished can answer after it. The shared answer keeps the newest
 * observation: a check counts from when it was asked, and a sign-in from when it completed.
 */

const PAIR: SignInPair = { provider: 'codex', profileId: 'default' }
const ABSENT: AuthState = { state: 'absent', reason: 'This profile has never been signed in.' }
const USABLE: AuthState = { state: 'usable', login: 'account', expiresAt: null }
const STALE: AuthState = { state: 'stale', reason: 'The test sign-in has expired.' }

function aGate<T>(): { promise: Promise<T>; open: (value: T) => void } {
  let open: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

/** One pair's shared fact, and a bridge whose answers the test hands out in order. */
function twoSurfaces() {
  const fact: SignInFact = reactive({ auth: null, issued: 0, observed: 0 })
  const checks: Promise<AuthState>[] = []
  const signIns: Promise<ProviderSignInResult>[] = []
  const bridge = {
    checkProviderAuth: () => checks.shift() ?? Promise.resolve(ABSENT),
    signInProvider: () => signIns.shift() ?? Promise.reject(new Error('no sign-in staged')),
    reprovisionProviderAuth: async () => 'unchanged' as const,
    cancelProviderSignIn: async () => {},
  }
  const make = () =>
    createSignInGesture({
      pair: () => PAIR,
      bridge: () => bridge,
      fact: () => fact,
      words: { signedIn: () => 'Signed in.', unchanged: 'Nothing changed.' },
      checkWhileBusy: 'drop',
    })
  return { fact, checks, signIns, launcher: make(), profile: make() }
}

describe('the shared sign-in keeps the newest observation', () => {
  it('a check asked before a sign-in finished does not replace what the sign-in learned', async () => {
    const { fact, checks, signIns, launcher, profile } = twoSurfaces()
    const old = aGate<AuthState>()
    checks.push(old.promise)
    const held = launcher.check()

    signIns.push(Promise.resolve({ success: true, state: USABLE }))
    await profile.signIn()
    checks.push(Promise.resolve(USABLE))
    await profile.check()
    expect(fact.auth).toEqual(USABLE)

    old.open(ABSENT)
    await held
    expect(fact.auth).toEqual(USABLE)
  })

  it('a sign-in that started before a check but finished after it still counts as newer', async () => {
    const { fact, checks, signIns, launcher, profile } = twoSurfaces()
    const signIn = aGate<ProviderSignInResult>()
    signIns.push(signIn.promise)
    const signingIn = profile.signIn()

    checks.push(Promise.resolve(ABSENT))
    await launcher.check()
    expect(fact.auth).toEqual(ABSENT)

    signIn.open({ success: true, state: USABLE })
    await signingIn
    expect(fact.auth).toEqual(USABLE)
  })

  it('a check asked after the sign-in can still change it', async () => {
    const { fact, checks, signIns, launcher, profile } = twoSurfaces()
    signIns.push(Promise.resolve({ success: true, state: USABLE }))
    await profile.signIn()
    expect(fact.auth).toEqual(USABLE)

    checks.push(Promise.resolve(STALE))
    await launcher.check()
    expect(fact.auth).toEqual(STALE)
  })

  it('the surface that asked still draws its own answer', async () => {
    const { fact, checks, signIns, launcher, profile } = twoSurfaces()
    const old = aGate<AuthState>()
    checks.push(old.promise)
    const held = launcher.check()
    signIns.push(Promise.resolve({ success: true, state: USABLE }))
    await profile.signIn()

    old.open(ABSENT)
    await held
    expect(launcher.auth).toEqual(ABSENT)
    expect(fact.auth).toEqual(USABLE)
  })
})
