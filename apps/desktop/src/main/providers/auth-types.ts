import type { AuthState } from '@brobot2/runtime'

/** A sign-in in flight, with its native flow owned and cancelled by the provider. */
export interface ProviderSignIn {
  authUrl: string
  completed: Promise<{ success: boolean; error?: string; state: AuthState }>
  cancel(): Promise<void>
}

/** Existing provenance words cross the host unchanged. */
export type SignInCopySource = 'the-computers' | 'brobots-own'

/** A provider's existing login renewal result, with no native credential facts attached. */
export type LoginRenewalOutcome = 'renewed' | 'not-needed' | 'not-installed' | 'not-renewed'

/** The caller owns launch admission and cancellation around the actual renewal. */
export interface LoginRenewalOperations {
  readonly launchLabel: string
  renew(): Promise<LoginRenewalOutcome>
  prepare(
    prepare: () => string | Promise<string>,
    renew: () => Promise<LoginRenewalOutcome>,
  ): Promise<{ readonly home: string; readonly loginRenewed: boolean }>
}
