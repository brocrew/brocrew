import type { ApiKeyStatus } from '../../../shared/runtime-ipc'

/** A key is saved and can't be used. */
export function keyCantBeRead(status: ApiKeyStatus | null | undefined): boolean {
  return status?.set === true && !status.inUse
}

/**
 * What the app says of a saved key it can't read: main's own sentence where it gave one, else the
 * card's. This describes only API-key connections; choosing a sign-in connection is explicit.
 */
export function unreadableKeySays(
  status: ApiKeyStatus,
  name: string,
  loginBehindTheKey: boolean,
): string {
  if (status.unreadableReason !== undefined) return status.unreadableReason
  return loginBehindTheKey
    ? `This computer can’t read it, so the ${name} API-key connection won’t start. Save it again, or choose a sign-in connection for a new conversation.`
    : `This computer can’t read it, so the ${name} API-key connection won’t start. Save it again.`
}
