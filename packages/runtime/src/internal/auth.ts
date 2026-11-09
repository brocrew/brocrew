/** A managed provider credential is missing/unhealthy — the caller must surface it, not fall back. */
export class AuthUnavailableError extends Error {
  readonly provider: 'claude' | 'codex'

  constructor(provider: 'claude' | 'codex', message: string) {
    super(message)
    this.name = 'AuthUnavailableError'
    this.provider = provider
  }
}

/** A provider's managed-credential health; `reason` is a human string when not ok. */
export interface AuthHealth {
  ok: boolean
  reason?: string
}

/** How a person puts a provider's own login on this computer, for the Providers screen to say. */
export interface ProviderSetup {
  /** The tool that holds the login. */
  readonly tool: string
  /** How to install the tool here, and where its own instructions are. */
  readonly install: { readonly command: string; readonly docs: string }
  /** The command that signs in, and that renews an expired login, as typed in {@link shell}. */
  readonly signInCommand: string
  /** Guidance for completing the interactive sign-in after the command opens. */
  readonly signInInstructions?: string
  /** The computer the steps are for, as a person names it. */
  readonly platform: SetupPlatform
  /** The app a person opens to run the commands, which they are written for. */
  readonly shell: 'PowerShell' | 'Terminal'
}

/** The two systems this app runs on, by the names a person knows them by. */
export type SetupPlatform = 'macOS' | 'Windows'

/** What a re-provision did. `unchanged` means the profile already held those exact bytes. */
export type ReprovisionOutcome = 'replaced' | 'unchanged'
