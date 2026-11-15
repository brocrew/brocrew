import { freeBytesOn } from '../archive/native-file'
import type { HostGateVerdict } from '../one-host-gate'
import {
  CheckpointFailed,
  inWords,
  prune,
  captureCheckpoint,
  type Checkpoint,
  type MakeCheckpointOptions,
} from './checkpoint'
import type { BuildMigration } from './database-facts'
import type { RecoveryFs } from './files'

interface ReplacementOptions {
  readonly userData: string
  readonly ownership: HostGateVerdict
  readonly appVersion: string
  readonly fs?: RecoveryFs
  readonly freeBytes?: (path: string) => number | null
  readonly signal?: AbortSignal
}

export async function captureAfterCompaction(
  options: Omit<MakeCheckpointOptions, 'reason' | 'beforeCopy'>,
): Promise<Checkpoint> {
  const captured = await captureCheckpoint({ ...options, reason: 'after-compaction' })
  return captured.finish()
}

/** Admission uses the output's existing budget, with its margin already applied once. */
export async function prepareCheckpointReplacement(
  options: ReplacementOptions,
  lineage: readonly BuildMigration[],
  neededBytes: number,
): Promise<void> {
  if (!Number.isSafeInteger(neededBytes) || neededBytes <= 0)
    throw new CheckpointFailed(
      'BroCrew could not determine the space needed for the new recovery data.',
      true,
    )
  const { userData } = options
  const freeBytes = options.freeBytes ?? freeBytesOn
  options.signal?.throwIfAborted()
  const removed = await prune(userData, lineage, {
    ownership: options.ownership,
    currentAppVersion: options.appVersion,
    fs: options.fs,
    replacing: true,
    beforeDelete: (estimatedFileBytes) => {
      options.signal?.throwIfAborted()
      const free = freeBytes(userData)
      if (free === null)
        throw new CheckpointFailed(
          'BroCrew could not determine the free space. Existing recovery files were kept.',
          true,
        )
      if (free + estimatedFileBytes < neededBytes)
        throw new CheckpointFailed(
          `BroCrew needs about ${inWords(neededBytes - free - estimatedFileBytes)} more space to replace its recovery copy. Existing recovery files were kept.`,
          true,
        )
    },
  })
  options.signal?.throwIfAborted()
  const free = freeBytes(userData)
  const previous =
    removed.length > 0
      ? ' Previous recovery files were removed; the live workspace is unchanged.'
      : ''
  if (free === null)
    throw new CheckpointFailed(`BroCrew could not determine the free space.${previous}`, true)
  if (free < neededBytes)
    throw new CheckpointFailed(
      `BroCrew needs about ${inWords(neededBytes - free)} more free space before making its recovery copy.${previous}`,
      true,
    )
}
