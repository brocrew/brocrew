import type { ApiKeyStatus } from '../../../shared/runtime-ipc'

/** A key is saved and this computer can't read it; one not yet read is not that. */
export function keyCantBeRead(status: ApiKeyStatus | null | undefined): boolean {
  if (
    status == null ||
    !status.set ||
    status.readState === 'not-checked' ||
    status.readState === 'reading'
  )
    return false
  return status.readState === 'unreadable' || !status.inUse
}

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
