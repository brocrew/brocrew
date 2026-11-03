export const RECOVERY_RETENTION_CHANNELS = {
  read: 'app:recovery-retention:read',
  delete: 'app:recovery-retention:delete',
} as const

export interface RetainedRecoveryCopy {
  readonly id: string
  readonly appVersion: string
  readonly bytes: number
}

export interface RecoveryRetentionClient {
  read(): Promise<RetainedRecoveryCopy | null>
  deleteNow(id: string): Promise<void>
}
