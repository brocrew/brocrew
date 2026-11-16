import type { SnapshotFoldAnswers } from './ledger-fold-state'

export function windowFoldCache(_bytes = 48 * 1024 * 1024): SnapshotFoldAnswers {
  return new Map()
}
