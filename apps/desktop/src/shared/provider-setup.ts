import type { Provider } from '@brobot2/shared'

export type ProviderSetupPhase =
  | 'idle'
  | 'installing'
  | 'signing-in'
  | 'cancelling'
  | 'installed'
  | 'signed-in'
  | 'cancelled'
  | 'failed'

export type ProviderSetupError =
  | 'not-authorized'
  | 'unsupported-platform'
  | 'unsupported-provider'
  | 'busy'
  | 'not-found'
  | 'start-failed'
  | 'install-failed'
  | 'login-failed'
  | 'timed-out'
  | 'output-limit'
  | 'closed'

export interface ProviderSetupState {
  readonly provider: Provider
  readonly supported: { readonly install: boolean; readonly signIn: boolean }
  readonly phase: ProviderSetupPhase
  readonly available: boolean
  /** Fixed progress text, never raw sign-in output. */
  readonly progress: string
  /** Only a validated official authorization URL printed by the CLI, otherwise null. */
  readonly authUrl: string | null
  readonly error: ProviderSetupError | null
  /** Bounded installer diagnostics on failure only; never sign-in output. */
  readonly details: string | null
  readonly exitCode: number | null
}
export type ProviderSetupAction =
  { readonly ok: true } | { readonly ok: false; readonly reason: ProviderSetupError }

export interface ProviderSetupBridge {
  state(provider: Provider): Promise<ProviderSetupState>
  onState(listener: (state: ProviderSetupState) => void): () => void
  install(provider: Provider): Promise<ProviderSetupAction>
  signIn(provider: Provider): Promise<ProviderSetupAction>
  cancel(provider: Provider): Promise<ProviderSetupAction>
}
export const PROVIDER_SETUP_CHANNELS = {
  state: 'provider-setup:state',
  changed: 'provider-setup:changed',
  install: 'provider-setup:install',
  signIn: 'provider-setup:sign-in',
  cancel: 'provider-setup:cancel',
} as const
