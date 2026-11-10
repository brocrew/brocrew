/** The native account identifier as a persisted sign-in tag. */
export function nativeAccountTag(accountId: string): string {
  return `native-account:${accountId}`
}

/** Whether a recorded tag names a native account in this namespace. */
export function isNativeAccountTag(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('native-account:') && value.length > 15
}
