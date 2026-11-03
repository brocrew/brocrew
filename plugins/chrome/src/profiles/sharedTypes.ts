export interface SharedLeaseHandle {
  release(): boolean | void
}
export interface SharedProfileAccess {
  acquire(name: string): SharedLeaseHandle
  /** The callback is synchronous; the reservation covers its entire filesystem operation. */
  withDiskAccess<T>(name: string, write: boolean, work: () => T): T
  identity(name: string): string
  resolveSaved(
    name: string,
    identity: string | undefined,
    legacy: boolean,
  ): { name: string; identity: string } | undefined
  authorization(name: string): string
  view(name: string): Record<string, unknown>
  confirmation(name: string): string
  remove(name: string, confirmation: string): void
  restoreName(name: string): string
}
