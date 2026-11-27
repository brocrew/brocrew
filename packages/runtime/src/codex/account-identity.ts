/** The native account identifier as a persisted sign-in tag. */
export function nativeAccountTag(accountId: string): string {
  return `native-account:${accountId}`
}
