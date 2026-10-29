export type AuthVerb = 'login' | 'logout' | 'status'

export interface FakeAuthCommand {
  readonly args: readonly ['auth', AuthVerb]
  readonly env: Readonly<{ CLAUDE_CONFIG_DIR: string }>
  readonly output: 'discard' | 'status-only'
  readonly signal: AbortSignal
}

/** A fixture port only; there is no native process implementation or release binding. */
export interface FakeClaudeAuthCli {
  readonly kind: 'fake-cli'
  run(command: FakeAuthCommand): Promise<{ readonly exitCode: number; readonly stdout?: string }>
}

export interface SafeNativeAuthStatus {
  readonly signedIn: boolean
  readonly accountSignal: 'present' | 'absent'
  readonly change: 'initial' | 'same' | 'changed'
}

export type NativeAuthPreparationResult =
  | { readonly kind: 'disabled' | 'busy' }
  | {
      readonly kind: 'failed'
      readonly stage: AuthVerb
      readonly reason:
        | 'command'
        | 'status-schema'
        | 'account-signal'
        | 'logout-not-confirmed'
        | 'login-not-confirmed'
        | 'cancelled'
        | 'timeout'
    }
  | { readonly kind: 'status'; readonly status: SafeNativeAuthStatus }
  | {
      readonly kind: 'switched'
      readonly status: SafeNativeAuthStatus
      readonly accountChange: 'same' | 'changed' | 'unknown'
      readonly requiresResumeConfirmation: true
    }

export interface ClaudeNativeAuthPreparation {
  readonly enabled: boolean
  status(signal?: AbortSignal): Promise<NativeAuthPreparationResult>
  switchAccount(signal?: AbortSignal): Promise<NativeAuthPreparationResult>
}

export interface NativeAuthPreparationFixtures {
  readonly cli: FakeClaudeAuthCli
  readonly configDirectory: string
  readonly apiKeySelected?: boolean
}

/** No production transport is installed; omission retains the disabled preparation. */
export function createClaudeNativeAuthPreparation(
  _fixtures?: NativeAuthPreparationFixtures,
): ClaudeNativeAuthPreparation {
  return {
    enabled: false,
    status: async () => ({ kind: 'disabled' }),
    switchAccount: async () => ({ kind: 'disabled' }),
  }
}

/** The supplied legacy resolver owns adopted and default-profile compatibility. */
export function claudeLegacyResumeRoute(
  _recordedHome: string | null | undefined,
  legacyHome: () => string,
): { readonly providerHome: string; readonly authHome: string } {
  const home = legacyHome()
  return { providerHome: home, authHome: home }
}
