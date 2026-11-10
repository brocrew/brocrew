import type { ApiKeyStatus } from '../../../shared/runtime-ipc'

/** A key is saved and can't be used. */
export function keyCantBeRead(status: ApiKeyStatus | null | undefined): boolean {
  return status?.set === true && !status.inUse
}

/**
 * What the app says of a saved key it can't read: main's own sentence where it gave one, else the
 * card's. A saved key outranks the sign-in, so the provider starts nothing until it is saved again
 * or removed.
 */
export function unreadableKeySays(
  status: ApiKeyStatus,
  name: string,
  loginBehindTheKey: boolean,
): string {
  if (status.unreadableReason !== undefined) return status.unreadableReason
  return loginBehindTheKey
    ? `This computer can’t read it, so ${name} won’t start. Save it again, or remove it to use the sign-in.`
    : `This computer can’t read it, so ${name} won’t start. Save it again.`
}
