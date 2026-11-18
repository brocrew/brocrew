/** Why a conversation that was sent something cannot run now; what was recorded stays recorded. */
export type CannotRun = {
  readonly code: 'provider-file-missing' | 'could-not-start'
  readonly reason: string
}
