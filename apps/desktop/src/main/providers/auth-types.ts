import type { AuthState } from '@brobot2/runtime'

/** A sign-in in flight, with its native flow owned and cancelled by the provider. */
export interface ProviderSignIn {
  authUrl: string
  completed: Promise<{ success: boolean; error?: string; state: AuthState }>
  cancel(): Promise<void>
}

/** Existing provenance words cross the host unchanged. */
export type SignInCopySource = 'the-computers' | 'brobots-own'
