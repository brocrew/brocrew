export type CreatedBy = 'agent' | 'panel'
export interface ProfileRecord {
  /** Local capability-mode epoch; persisted with flags so failed registry writes cannot admit ABA. */
  authorizationEpoch?: string
  name: string
  /** Person-facing label only; name remains the immutable storage/tool key. */
  displayName?: string
  deleting?: boolean
  enabled: boolean
  allowExtensions: boolean
  allowSettings: boolean
  allowSync: boolean
  createdAt: string
  createdBy: CreatedBy
  description: string
  temporary: boolean
  /**
   * The person's switch for the BroCrew helper. off: never loaded until they turn it on.
   * turning-on: they pressed Turn on, which beats Chrome's older record of the switch until the
   * helper is running again.
   */
  helper: HelperSwitch
}
export type HelperSwitch = 'on' | 'off' | 'turning-on'
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
