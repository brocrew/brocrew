import { reactive } from 'vue'
import type { AuthState, Provider } from '../../../shared/runtime-ipc'
import { readableError } from '../lib/session-record'

/**
 * One profile's sign-in for one provider, and the gestures that renew it: check, sign in inside the
 * profile, copy the machine sign-in, cancel. The state is shared per provider and profile, so a
 * conversation and its agent card ask once and always agree.
 */
export interface ProfileSignIn {
  readonly provider: Provider
  /** The latest answer, or `null` before the first one. */
  auth: AuthState | null
  busy: 'idle' | 'checking' | 'copying' | 'signing-in'
  /** What the last gesture said, in the words of whoever produced it. Never a credential. */
  notice: string | null
  check(): Promise<void>
  signIn(): Promise<void>
  copyMachineSignIn(): Promise<void>
  cancel(): Promise<void>
}

const held = new Map<string, ProfileSignIn>()

export function useProfileSignIn(provider: Provider, profileId: string): ProfileSignIn {
  const key = `${provider}:${profileId}`
  const known = held.get(key)
  if (known) return known
  // A plain literal each time: a reactive proxy cannot cross the bridge.
  const asked = (): { provider: Provider; profileId: string } => ({ provider, profileId })
  let checkAgain = false

  async function withGesture(
    phase: 'checking' | 'copying' | 'signing-in',
    run: () => Promise<void>,
  ): Promise<void> {
    if (one.busy !== 'idle') {
      if (phase === 'checking') checkAgain = true
      return
    }
    one.busy = phase
    try {
      await run()
    } finally {
      one.busy = 'idle'
      if (phase !== 'checking' || checkAgain) {
        checkAgain = false
        void one.check()
      }
    }
  }

  const one: ProfileSignIn = reactive({
    provider,
    auth: null,
    busy: 'idle',
    notice: null,
    async check() {
      await withGesture('checking', async () => {
        try {
          one.auth = await window.api.runtime.checkProviderAuth(asked())
        } catch (error) {
          one.auth = { state: 'unknown', reason: readableError(error) }
        }
      })
    },
    async signIn() {
      await withGesture('signing-in', async () => {
        one.notice = 'Finish signing in in your browser, then come back.'
        try {
          const result = await window.api.runtime.signInProvider(asked())
          one.auth = result.state
          one.notice = result.success
            ? 'Signed in. This profile has its own sign-in again.'
            : (result.detail ?? 'The sign-in did not complete.')
        } catch (error) {
          one.notice = readableError(error)
        }
      })
    },
    async copyMachineSignIn() {
      await withGesture('copying', async () => {
        one.notice = null
        try {
          const outcome = await window.api.runtime.reprovisionProviderAuth(asked())
          one.notice =
            outcome === 'replaced'
              ? 'Copied your machine sign-in into this profile.'
              : 'Your machine sign-in is the same as this profile’s, so nothing changed.'
        } catch (error) {
          one.notice = readableError(error)
        }
      })
    },
    async cancel() {
      try {
        await window.api.runtime.cancelProviderSignIn(asked())
      } catch (error) {
        one.notice = readableError(error)
      }
    },
  })
  held.set(key, one)
  return one
}

/** Forget every held sign-in: for tests, where each mount is its own app run. */
export function forgetProfileSignIns(): void {
  held.clear()
}
