import type { Provider } from '../../../shared/runtime-ipc'

/**
 * How a provider's tool is installed and signed in on this computer, as main reports it. While the
 * bridge has no `providerSetup`, {@link readProviderSetup} answers `null` and the guide says the
 * guidance is not available yet.
 */
export interface ProviderSetupSays {
  /** The tool that holds the login, by its own name. */
  readonly tool: string
  /** How to install it here, or `null` when there is nothing to install. */
  readonly install: { readonly command: string; readonly docs: string } | null
  /** The command that signs in, and renews an expired login, as typed in {@link shell}. */
  readonly signInCommand: string
  /** The computer the steps are for: `macOS` or `Windows`. */
  readonly platform: 'macOS' | 'Windows'
  /** The shell `signInCommand` is typed for. */
  readonly shell: 'PowerShell' | 'Terminal'
}

type SetupBridge = {
  providerSetup?: () => Promise<Readonly<Partial<Record<Provider, ProviderSetupSays>>>>
}

/** Every provider's setup facts, or `null` when main does not report them or the read fails. */
export async function readProviderSetup(): Promise<Readonly<
  Partial<Record<Provider, ProviderSetupSays>>
> | null> {
  const bridge = (globalThis as { api?: { runtime?: SetupBridge } }).api?.runtime
  if (bridge?.providerSetup === undefined) return null
  try {
    return await bridge.providerSetup()
  } catch {
    return null
  }
}

/** Why there is no usable login, when main names it beside its sentence. */
export function whyNoLogin(state: unknown): string | undefined {
  const why = (state as { why?: unknown } | null)?.why
  return typeof why === 'string' ? why : undefined
}
