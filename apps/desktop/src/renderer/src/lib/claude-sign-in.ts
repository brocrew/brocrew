import type { Provider } from '../../../shared/runtime-ipc'
import { providerDescriptor } from '@brobot2/shared'

/** Also recognizes retry rows stored before sign-in failures shared one display row. */
export function isClaudeSignInRetry(provider: Provider | undefined, message: string): boolean {
  const pattern = provider === undefined ? null : providerDescriptor(provider).signIn.retryPattern
  return pattern !== null && new RegExp(pattern).test(message)
}

export function isClaudeLoginRefused(
  provider: Provider | undefined,
  cause: string | undefined,
): boolean {
  return provider !== undefined && providerDescriptor(provider).signIn.refusalCause === cause
}
