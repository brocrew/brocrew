import type { ProfileRecord } from './store.js'
export interface SharedProfileAdmission {
  profile: ProfileRecord
  identity: string
  authorization: string
}
export interface SharedLeaseHandle {
  release(): boolean | void
}
export interface SharedProfileAccess {
  /** One synchronous registry/native observation; every call starts fresh. */
  admission(name: string): SharedProfileAdmission
  acquire(name: string): SharedLeaseHandle
  /** The callback is synchronous; the reservation covers its entire filesystem operation. */
  withDiskAccess<T>(name: string, write: boolean, work: () => T): T
  identity(name: string): string
  authorization(name: string): string
  view(name: string): Record<string, unknown>
  confirmation(name: string): string
  remove(name: string, confirmation: string): void
  restoreName(name: string): string
}
