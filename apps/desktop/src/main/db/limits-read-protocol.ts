import { providerSchema } from '@brobot2/shared'
import { z } from 'zod'

export const LIMITS_READ_BOUNDS = Object.freeze({
  rows: 32_768,
  bytes: 32 * 1024 * 1024,
  cellBytes: 512 * 1024,
  replyBytes: 2 * 1024 * 1024,
})

const instant = z.number().finite()
const count = z.number().int().nonnegative().safe()
const text = z.string().max(LIMITS_READ_BOUNDS.cellBytes)
const usage = z
  .object({
    window: z.string().max(1024),
    usedPercent: instant.nullable(),
    resetsAt: instant.nullable(),
    at: instant,
  })
  .strict()

export const limitsReadInput = z
  .object({
    operation: count,
    databaseEpoch: count,
    signInEpoch: count,
    capturedAt: instant,
    signInChangedAt: z.object({ claude: instant.optional(), codex: instant.optional() }).strict(),
    usage: z
      .object({
        claude: z.array(usage).max(64).optional(),
        codex: z.array(usage).max(64).optional(),
      })
      .strict(),
  })
  .strict()

const wall = z
  .object({
    provider: providerSchema,
    window: text,
    standing: z.enum(['about-to-stop', 'stopped']),
    resetsAt: instant.nullable(),
    said: text,
    at: instant,
  })
  .strict()

const walk = z
  .object({
    walk: z.literal('every-provider-wall-recently-recorded'),
    rows: z.array(wall).max(LIMITS_READ_BOUNDS.rows),
    ledgers: count,
    rowsUnread: count,
    ledgersSkipped: count.optional(),
  })
  .strict()

export const limitsReadResult = z
  .object({
    operation: count,
    databaseEpoch: count,
    signInEpoch: count,
    inputCapturedAt: instant,
    readStartedAt: instant,
    snapshotPinStartedAt: instant,
    snapshotPinnedAt: instant,
    evaluatedAt: instant,
    readFinishedAt: instant,
    canonical: walk,
    display: walk,
    measured: z.object({ rows: count, bytes: count, statements: count }).strict(),
  })
  .strict()
  .refine(
    (read) =>
      read.readStartedAt <= read.snapshotPinStartedAt &&
      read.snapshotPinStartedAt <= read.snapshotPinnedAt &&
      read.snapshotPinnedAt <= read.evaluatedAt &&
      read.evaluatedAt <= read.readFinishedAt,
  )

export type LimitsReadInput = z.infer<typeof limitsReadInput>
export type LimitsReadResult = z.infer<typeof limitsReadResult>

export class LimitsReadUnavailable extends Error {
  constructor(
    readonly why: 'closed' | 'busy' | 'cancelled' | 'deadline' | 'changed' | 'failed' | 'overflow',
  ) {
    super(`Limits reading unavailable (${why})`)
  }
}
