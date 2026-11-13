import { reactive } from 'vue'
import type { AuthState, Provider } from '../../../shared/runtime-ipc'
import type { ClientProviderApi } from '../../../shared/client-provider-api'
import { useClientProviders } from '../client-provider/injection'
import {
  createSignInGesture,
  observe,
  ticketFor,
  type SignInFact,
  type SignInPair,
  type SignInPhase,
} from '../lib/sign-in-gesture'

/**
 * One profile's sign-in for one provider, and the gestures that renew it: check, sign in inside the
 * profile, copy the machine sign-in, cancel. The state is shared per provider and profile, so a
 * conversation and its agent card ask once and always agree.
 */
export interface ProfileSignIn {
  readonly provider: Provider
  /** The latest answer, or `null` before the first one. */
  auth: AuthState | null
  readonly busy: SignInPhase
  /** What the last gesture said, in the words of whoever produced it. Never a credential. */
  readonly notice: string | null
  check(probe?: boolean): Promise<void>
  signIn(): Promise<void>
  copyMachineSignIn(): Promise<void>
  cancel(): Promise<void>
}

interface ProfileSignIns {
  readonly facts: Map<string, SignInFact>
  readonly held: Map<string, ProfileSignIn>
}
let clients = new WeakMap<ClientProviderApi, ProfileSignIns>()

function signInsFor(api: ClientProviderApi): ProfileSignIns {
  let shared = clients.get(api)
  if (shared === undefined) {
    shared = { facts: new Map(), held: new Map() }
    clients.set(api, shared)
  }
  return shared
}

const keyOf = (pair: SignInPair): string => `${pair.provider}:${pair.profileId}`

/**
 * What one provider×profile's sign-in is known to be, for every surface in the window: the agent
 * cards and the title bar read it, and the launcher's own gesture writes what it learns into it.
 */
function factFor(pair: SignInPair, { facts }: ProfileSignIns): SignInFact {
  const key = keyOf(pair)
  let fact = facts.get(key)
  if (fact === undefined) {
    fact = reactive({ auth: null, issued: 0, observed: 0 })
    facts.set(key, fact)
  }
  return fact
}

export function signInFact(
  pair: SignInPair,
  api: ClientProviderApi = useClientProviders(),
): SignInFact {
  return factFor(pair, signInsFor(api))
}

export function useProfileSignIn(
  provider: Provider,
  profileId: string,
  api: ClientProviderApi = useClientProviders(),
): ProfileSignIn {
  const shared = signInsFor(api)
  const { held } = shared
  const pair = { provider, profileId }
  const known = held.get(keyOf(pair))
  if (known) return known
  const fact = factFor(pair, shared)
  const gesture = createSignInGesture({
    pair: () => pair,
    bridge: () => api,
    fact: (pair) => factFor(pair, shared),
    keepsFailedChecks: true,
    words: {
      signedIn: () => 'Signed in. This profile has its own sign-in again.',
      unchanged: 'Your machine sign-in is the same as this profile’s, so nothing changed.',
    },
    checkWhileBusy: 'after',
    // Whatever a sign-in or a copy did, the profile is asked again.
    settled: (phase) => {
      if (phase !== 'checking') void gesture.check()
    },
  })
  const one: ProfileSignIn = reactive({
    provider,
    get auth() {
      return fact.auth
    },
    set auth(next: AuthState | null) {
      observe(fact, ticketFor(fact), next)
    },
    get busy() {
      return gesture.busy
    },
    get notice() {
      return gesture.notice
    },
    check: (probe = false) => gesture.check(undefined, probe),
    signIn: () => gesture.signIn(),
    copyMachineSignIn: () => gesture.copyMachineSignIn(),
    cancel: () => gesture.cancel(),
  })
  held.set(keyOf(pair), one)
  return one
}

/** Forget every held sign-in and what is known of it: for tests, where each mount is its own run. */
export function forgetProfileSignIns(): void {
  clients = new WeakMap()
}
