import { ref, shallowRef } from 'vue'
import type { ApiKeyStatus, AuthState, Provider, RuntimeBridge } from '../../../shared/runtime-ipc'
import { DEFAULT_PROFILE_ID } from '../../../shared/runtime-ipc'
import { readableError } from './session-record'

export type AuthPhase = 'idle' | 'checking' | 'copying' | 'signing-in'

/** One set of login/key readings for a provider row and its controls. Gestures stay serialized. */
export function createProviderAccess(
  provider: () => Provider,
  changed: () => void,
  bridge: () => Pick<RuntimeBridge, 'checkProviderAuth' | 'apiKeyStatus'>,
) {
  const auth = shallowRef<AuthState | null>(null)
  const authBusy = ref<AuthPhase>('idle')
  const keyStatus = shallowRef<ApiKeyStatus | null>(null)
  const keyError = ref<string | null>(null)
  let checkAgain = false
  let probeAgain = false

  const asked = () => ({ provider: provider(), profileId: DEFAULT_PROFILE_ID })

  async function withGesture(
    phase: Exclude<AuthPhase, 'idle'>,
    run: () => Promise<void>,
  ): Promise<void> {
    if (authBusy.value !== 'idle') return
    authBusy.value = phase
    try {
      await run()
    } finally {
      authBusy.value = 'idle'
      if (phase !== 'checking') changed()
      if (checkAgain) {
        const probe = probeAgain
        checkAgain = false
        probeAgain = false
        void check(probe)
      }
    }
  }

  async function check(probe = false): Promise<void> {
    if (authBusy.value !== 'idle') {
      checkAgain = true
      probeAgain ||= probe
      return
    }
    await withGesture('checking', async () => {
      try {
        auth.value = await bridge().checkProviderAuth(
          probe ? { ...asked(), probe: true as const } : asked(),
        )
      } catch (error) {
        auth.value = { state: 'unknown', reason: readableError(error) }
      }
    })
  }

  async function readKey(): Promise<void> {
    try {
      keyStatus.value = await bridge().apiKeyStatus({ provider: provider() })
      keyError.value = null
    } catch (error) {
      keyError.value = readableError(error)
    }
  }

  return { auth, authBusy, keyStatus, keyError, asked, withGesture, check, readKey }
}

export type ProviderAccess = ReturnType<typeof createProviderAccess>
