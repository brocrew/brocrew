import type { Provider } from '../../../shared/runtime-ipc'

/** Also recognizes retry rows stored before sign-in failures shared one display row. */
export function isClaudeSignInRetry(provider: Provider | undefined, message: string): boolean {
  return provider === 'claude' && /^claude could not authenticate; retrying\b/.test(message)
}

export function isClaudeLoginRefused(
  provider: Provider | undefined,
  cause: string | undefined,
): boolean {
  return provider === 'claude' && cause === 'auth'
}
