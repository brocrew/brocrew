const HEADROOM_SHARE = 1.1
const HEADROOM_BYTES = 64 * 1024 * 1024

export class CheckpointFailed extends Error {
  constructor(
    message: string,
    readonly canRetry: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CheckpointFailed'
  }
}

export class CheckpointNoRoom extends CheckpointFailed {
  constructor(
    readonly needed: number,
    readonly free: number,
  ) {
    super(
      `A recovery copy of this workspace's data needs about ${inWords(needed)} free on its disk, ` +
        `and ${inWords(free)} is free.`,
      true,
    )
    this.name = 'CheckpointNoRoom'
  }
}

export function failureFrom(error: unknown): CheckpointFailed {
  if (error instanceof CheckpointFailed) return error
  return new CheckpointFailed(
    `BroCrew could not make a recovery copy of this workspace's data: ${error instanceof Error ? error.message : String(error)}`,
    true,
    { cause: error },
  )
}

export function inWords(bytes: number): string {
  return bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : `${String(Math.max(1, Math.round(bytes / 1e6)))} MB`
}

export function checkpointSpaceNeeded(databaseBytes: number): number {
  return Math.ceil(databaseBytes * HEADROOM_SHARE) + HEADROOM_BYTES
}

export function checkFreeSpace(
  userData: string,
  databaseBytes: number,
  freeBytes: (path: string) => number | null,
): void {
  const needed = checkpointSpaceNeeded(databaseBytes)
  const free = freeBytes(userData)
  if (free === null)
    throw new CheckpointFailed(
      'BroCrew could not determine the free space for a recovery copy.',
      true,
    )
  if (free < needed) throw new CheckpointNoRoom(needed, free)
}
